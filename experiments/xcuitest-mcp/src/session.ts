/**
 * Session manager - owns the lifecycle of (simulator + engine) so the
 * agent can drive an iOS UI test session end-to-end through MCP tool calls
 * instead of needing a human to run xcodebuild.
 *
 * Two backends:
 *   - "macos"  - real path: xcrun simctl + xcodebuild test
 *   - "mock"   - Linux-friendly path: just spawns mock-engine.ts
 *
 * Backend is auto-selected by platform but can be forced with XCUI_DEV_MODE
 * (mock | macos). The mock backend is what the test-client uses to verify
 * the orchestration logic without a Mac.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { EngineClient } from "./engine-client.ts";

const execFile = promisify(execFileCb);

export type StartOpts = {
  /** Path to .xcodeproj or .xcworkspace (macOS only). */
  project?: string;
  /** UI test scheme (macOS only). */
  scheme?: string;
  /** Sim device name like "iPhone 15" (macOS only). */
  deviceName?: string;
  /** App under test bundle id (used by callers, not by simctl directly). */
  bundleId?: string;
  /** Test identifier, e.g. "MyAppUITests/InteractiveEngineTests/testRunForever". */
  testIdentifier?: string;
  /** Engine HTTP port (default 8765). */
  enginePort?: number;
};

export type SessionStatus = {
  running: boolean;
  backend: "macos" | "mock";
  sim?: { udid: string; name: string };
  enginePid?: number;
  engineUrl?: string;
  app?: { bundleId: string };
  startedAt?: string;
};

type State = {
  backend: "macos" | "mock";
  proc?: ChildProcess;
  sim?: { udid: string; name: string };
  app?: { bundleId: string };
  engineUrl?: string;
  startedAt?: string;
};

const HEALTH_TIMEOUT_MS = 60_000;
const HEALTH_INTERVAL_MS = 250;

export class SessionManager {
  private state: State = { backend: detectBackend() };
  /** Serialize start/stop so the agent can't get into half-states. */
  private mutex: Promise<unknown> = Promise.resolve();

  constructor() {
    // make sure spawned children don't outlive us
    process.on("exit", () => this.killChild());
    process.on("SIGINT", () => { this.killChild(); process.exit(130); });
    process.on("SIGTERM", () => { this.killChild(); process.exit(143); });
  }

  status(): SessionStatus {
    return {
      running: !!this.state.proc && !this.state.proc.killed,
      backend: this.state.backend,
      sim: this.state.sim,
      enginePid: this.state.proc?.pid,
      engineUrl: this.state.engineUrl,
      app: this.state.app,
      startedAt: this.state.startedAt,
    };
  }

  async start(opts: StartOpts): Promise<SessionStatus> {
    return this.serialize(async () => {
      if (this.state.proc && !this.state.proc.killed) {
        throw new Error("session already running; call session_stop first");
      }
      const port = opts.enginePort ?? 8765;
      const engineUrl = `http://127.0.0.1:${port}`;

      if (this.state.backend === "macos") {
        await this.startMacOS(opts, port);
      } else {
        await this.startMock(port);
      }

      // Wait for the engine HTTP service to come up.
      const client = new EngineClient(engineUrl);
      const deadline = Date.now() + HEALTH_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (await client.ping()) {
          this.state.engineUrl = engineUrl;
          this.state.startedAt = new Date().toISOString();
          if (opts.bundleId) this.state.app = { bundleId: opts.bundleId };
          return this.status();
        }
        if (this.state.proc?.exitCode != null) {
          throw new Error(`engine process exited (code=${this.state.proc.exitCode}) before becoming ready`);
        }
        await sleep(HEALTH_INTERVAL_MS);
      }
      this.killChild();
      throw new Error(`engine did not become ready within ${HEALTH_TIMEOUT_MS}ms`);
    });
  }

  async stop(): Promise<SessionStatus> {
    return this.serialize(async () => {
      this.killChild();
      if (this.state.backend === "macos" && this.state.sim?.udid) {
        // Best-effort sim shutdown; ignore errors.
        try {
          await execFile("xcrun", ["simctl", "shutdown", this.state.sim.udid]);
        } catch {
          // ignore
        }
      }
      this.state = { backend: this.state.backend };
      return this.status();
    });
  }

  // --- macOS backend ---

  private async startMacOS(opts: StartOpts, port: number) {
    if (!opts.project) throw new Error("project required on macOS backend");
    if (!opts.scheme) throw new Error("scheme required on macOS backend");
    if (!opts.deviceName) throw new Error("deviceName required on macOS backend");
    if (!opts.testIdentifier) throw new Error("testIdentifier required on macOS backend");

    const sim = await pickSimulator(opts.deviceName);
    this.state.sim = sim;

    // Boot is idempotent when the sim is already booted (returns non-zero
    // with "Unable to boot device in current state: Booted"). Tolerate it.
    try {
      await execFile("xcrun", ["simctl", "boot", sim.udid]);
    } catch (e) {
      if (!`${e}`.includes("Booted")) throw e;
    }

    const projectFlag = opts.project.endsWith(".xcworkspace") ? "-workspace" : "-project";
    const args = [
      "test",
      projectFlag, opts.project,
      "-scheme", opts.scheme,
      "-destination", `id=${sim.udid}`,
      "-only-testing:" + opts.testIdentifier,
      // pass the port through env to the test (Swift code reads it via ProcessInfo)
    ];
    const child = spawn("xcodebuild", args, {
      env: { ...process.env, XCUI_ENGINE_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });
    this.attachLogging(child, "xcodebuild");
    this.state.proc = child;
  }

  // --- Mock backend (Linux-runnable) ---

  private async startMock(port: number) {
    const mockPath = new URL("./mock-engine.ts", import.meta.url).pathname;
    const child = spawn("bun", ["run", mockPath], {
      env: { ...process.env, XCUI_MOCK_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });
    this.attachLogging(child, "mock-engine");
    this.state.proc = child;
    this.state.sim = { udid: "MOCK-SIMULATOR", name: "Linux Mock" };
  }

  // --- helpers ---

  private attachLogging(child: ChildProcess, tag: string) {
    child.stdout?.on("data", (d) => process.stderr.write(`[${tag}] ${d}`));
    child.stderr?.on("data", (d) => process.stderr.write(`[${tag}] ${d}`));
    child.on("exit", (code, sig) => {
      console.error(`[${tag}] exited code=${code} sig=${sig}`);
    });
  }

  private killChild() {
    const p = this.state.proc;
    if (!p || p.killed) return;
    try { p.kill("SIGTERM"); } catch { /* ignore */ }
    // give it a moment, then SIGKILL
    setTimeout(() => { try { if (!p.killed) p.kill("SIGKILL"); } catch { /* ignore */ } }, 2_000).unref();
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.mutex.then(fn, fn);
    this.mutex = next.catch(() => undefined);
    return next;
  }
}

// --- module-level helpers ---

function detectBackend(): "macos" | "mock" {
  const forced = process.env.XCUI_DEV_MODE;
  if (forced === "macos" || forced === "mock") return forced;
  return process.platform === "darwin" ? "macos" : "mock";
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

type SimDevice = { udid: string; name: string; state: string; runtime: string };

export async function listSimulators(): Promise<SimDevice[]> {
  if (detectBackend() === "mock") {
    return [
      { udid: "MOCK-SIMULATOR", name: "Linux Mock (iPhone 15)", state: "Shutdown", runtime: "iOS-mock" },
    ];
  }
  const { stdout } = await execFile("xcrun", ["simctl", "list", "devices", "--json"]);
  const data = JSON.parse(stdout) as { devices: Record<string, Array<{ udid: string; name: string; state: string }>> };
  const out: SimDevice[] = [];
  for (const [runtime, devices] of Object.entries(data.devices)) {
    for (const d of devices) out.push({ ...d, runtime });
  }
  return out;
}

async function pickSimulator(name: string): Promise<{ udid: string; name: string }> {
  const all = await listSimulators();
  // prefer exact name match, newest runtime first
  const matches = all
    .filter((d) => d.name === name)
    .sort((a, b) => b.runtime.localeCompare(a.runtime));
  const best = matches[0];
  if (!best) throw new Error(`no simulator found with name "${name}"`);
  return { udid: best.udid, name: best.name };
}

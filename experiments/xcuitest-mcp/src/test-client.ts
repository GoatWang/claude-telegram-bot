#!/usr/bin/env bun
/**
 * End-to-end smoke test:
 *   test-client (this) ──MCP stdio──▶ server.ts ──spawn──▶ mock-engine.ts
 *
 * The MCP server now owns the engine lifecycle, so we no longer need to
 * start mock-engine.ts by hand. We force XCUI_DEV_MODE=mock so session_start
 * spawns the mock instead of trying to run xcodebuild.
 *
 * Run:
 *   bun run experiments/xcuitest-mcp/src/test-client.ts
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", new URL("./server.ts", import.meta.url).pathname],
    env: {
      ...process.env,
      XCUI_DEV_MODE: "mock",
      XCUI_ENGINE_URL: "http://127.0.0.1:8765",
    },
  });

  const client = new Client({ name: "xcui-test-client", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log(`✓ discovered ${tools.tools.length} tools`);

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
    if (r.isError) throw new Error(`${name} failed: ${text}`);
    return text ? JSON.parse(text) : null;
  };

  try {
    console.log("\n=== Phase 1: session lifecycle ===");

    console.log("→ listing simulators");
    const sims = await call("xcui_sim_list");
    console.log(`   found ${sims.length}: ${sims.map((s: { name: string }) => s.name).join(", ")}`);

    console.log("→ checking status before start");
    console.log("  ", await call("xcui_session_status"));

    console.log("→ starting session (mock backend spawns mock-engine)");
    const started = await call("xcui_session_start", {
      bundleId: "com.example.demo",
      enginePort: 8765,
    });
    console.log(`   running=${started.running} backend=${started.backend} pid=${started.enginePid}`);

    console.log("\n=== Phase 2: drive the app ===");

    console.log("→ launching app");
    console.log("  ", await call("xcui_launch_app", { bundleId: "com.example.demo" }));

    const tree = await call("xcui_dump_hierarchy");
    const fields = (tree.children ?? []).map((c: { type: string; identifier?: string }) => `${c.type}#${c.identifier ?? ""}`);
    console.log("→ hierarchy:", fields.join(", "));

    console.log("→ login flow");
    await call("xcui_type_text", { text: "alice", query: { identifier: "usernameField" } });
    await call("xcui_type_text", { text: "hunter2", query: { identifier: "passwordField" } });
    await call("xcui_tap", { query: { identifier: "loginButton" } });

    const welcome = await call("xcui_wait_for", { query: { type: "staticText", labelContains: "Welcome" }, timeoutMs: 1000 });
    console.log("  ", welcome.element.label);

    const shot = await call("xcui_screenshot");
    console.log(`→ screenshot: ${shot.png.length} bytes base64`);

    console.log("\n=== Phase 3: tear down ===");

    console.log("→ stopping session");
    console.log("  ", await call("xcui_session_stop"));

    console.log("→ confirming stopped");
    console.log("  ", await call("xcui_session_status"));

    console.log("\n✅ full lifecycle OK");
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error("\n❌", e);
  process.exit(1);
});

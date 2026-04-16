/**
 * Thin HTTP client used by the MCP server to talk to the engine.
 *
 * The engine URL defaults to http://127.0.0.1:8765 — that's the port the
 * Swift side opens (and the mock-engine.ts bind to for end-to-end tests on
 * Linux). Override with XCUI_ENGINE_URL.
 */

import { randomUUID } from "node:crypto";
import type { EngineRequest, EngineResponse, Op } from "./protocol.ts";

const DEFAULT_URL = "http://127.0.0.1:8765";

export class EngineClient {
  constructor(private readonly baseUrl: string = process.env.XCUI_ENGINE_URL ?? DEFAULT_URL) {}

  async send<T = unknown>(op: Op, timeoutMs = 30_000): Promise<T> {
    const req: EngineRequest = { id: randomUUID(), ...op };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(`${this.baseUrl}/command`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
        signal: ctrl.signal,
      });
      if (!resp.ok) {
        throw new Error(`engine HTTP ${resp.status}: ${await resp.text()}`);
      }
      const body = (await resp.json()) as EngineResponse;
      if (!body.ok) throw new Error(body.error);
      return body.result as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.send({ op: "ping" }, 2_000);
      return true;
    } catch {
      return false;
    }
  }
}

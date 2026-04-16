#!/usr/bin/env bun
/**
 * Mock XCUITest engine - Linux-runnable stand-in for the real macOS engine.
 *
 * Speaks the same HTTP protocol as the Swift InteractiveEngine, but instead
 * of driving an iOS simulator it pretends one exists: it keeps an in-memory
 * accessibility tree, mutates it on tap/type, and returns a 1x1 PNG for
 * screenshots. Lets us verify the MCP server end-to-end on this Linux box.
 */

import { serve } from "bun";
import type {
  Element,
  ElementQuery,
  EngineRequest,
  EngineResponse,
} from "./protocol.ts";

// --- fake app state ---

let currentApp: string | null = null;

const initialTree = (): Element => ({
  type: "application",
  identifier: "com.example.demo",
  enabled: true,
  children: [
    {
      type: "navigationBar",
      label: "Login",
      enabled: true,
      children: [],
    },
    {
      type: "textField",
      identifier: "usernameField",
      label: "Username",
      value: "",
      enabled: true,
    },
    {
      type: "secureTextField",
      identifier: "passwordField",
      label: "Password",
      value: "",
      enabled: true,
    },
    {
      type: "button",
      identifier: "loginButton",
      label: "Log in",
      enabled: true,
    },
  ],
});

let tree: Element = initialTree();
let focused: Element | null = null;

// --- helpers ---

function* walk(node: Element): Iterable<Element> {
  yield node;
  for (const c of node.children ?? []) yield* walk(c);
}

function findAll(query: ElementQuery): Element[] {
  const matches: Element[] = [];
  for (const n of walk(tree)) {
    if (query.type && query.type !== "any" && n.type !== query.type) continue;
    if (query.identifier && n.identifier !== query.identifier) continue;
    if (query.label && n.label !== query.label) continue;
    if (query.labelContains && !(n.label ?? "").includes(query.labelContains)) continue;
    matches.push(n);
  }
  return matches;
}

function findOne(query: ElementQuery): Element | null {
  const all = findAll(query);
  return all[query.index ?? 0] ?? null;
}

// 1x1 transparent PNG
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

// --- op handlers ---

function handle(req: EngineRequest): EngineResponse {
  try {
    switch (req.op) {
      case "ping":
        return { id: req.id, ok: true, result: { pong: true } };

      case "launch_app":
        currentApp = req.bundleId;
        tree = initialTree();
        focused = null;
        return { id: req.id, ok: true, result: { launched: req.bundleId } };

      case "terminate_app":
        if (currentApp !== req.bundleId) {
          return { id: req.id, ok: false, error: `app ${req.bundleId} not running` };
        }
        currentApp = null;
        focused = null;
        return { id: req.id, ok: true, result: { terminated: req.bundleId } };

      case "tap": {
        const el = findOne(req.query);
        if (!el) return { id: req.id, ok: false, error: `no element matched ${JSON.stringify(req.query)}` };
        // simple state machine: tapping login when both fields filled "succeeds"
        if (el.identifier === "loginButton") {
          const u = findOne({ identifier: "usernameField" });
          const p = findOne({ identifier: "passwordField" });
          if (u?.value && p?.value) {
            tree = {
              type: "application",
              enabled: true,
              children: [
                { type: "staticText", label: `Welcome ${u.value}`, enabled: true },
                { type: "button", identifier: "logoutButton", label: "Log out", enabled: true },
              ],
            };
            focused = null;
          }
        } else if (el.type === "textField" || el.type === "secureTextField") {
          focused = el;
        }
        return { id: req.id, ok: true, result: { tapped: el.identifier ?? el.label ?? el.type } };
      }

      case "double_tap": {
        const el = findOne(req.query);
        if (!el) return { id: req.id, ok: false, error: "no match" };
        return { id: req.id, ok: true, result: { doubleTapped: el.identifier ?? el.label } };
      }

      case "type_text": {
        let target = focused;
        if (req.query) {
          target = findOne(req.query);
          if (target) focused = target;
        }
        if (!target) return { id: req.id, ok: false, error: "no focused element to type into" };
        target.value = (target.value ?? "") + req.text;
        return { id: req.id, ok: true, result: { typed: req.text, into: target.identifier ?? target.label } };
      }

      case "swipe":
        return { id: req.id, ok: true, result: { swiped: req.direction } };

      case "screenshot":
        return { id: req.id, ok: true, result: { png: TINY_PNG_B64, width: 1, height: 1 } };

      case "dump_hierarchy":
        return { id: req.id, ok: true, result: tree };

      case "wait_for": {
        // mock: instant resolve if present, otherwise fail after timeout (no real polling needed)
        const el = findOne(req.query);
        if (el) return { id: req.id, ok: true, result: { found: true, element: el } };
        return { id: req.id, ok: false, error: `wait_for timed out after ${req.timeoutMs}ms` };
      }

      case "press_button":
        return { id: req.id, ok: true, result: { pressed: req.button } };
    }
  } catch (e) {
    return { id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// --- HTTP server ---

const port = Number(process.env.XCUI_MOCK_PORT ?? 8765);

serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/command") {
      const body = (await req.json()) as EngineRequest;
      const resp = handle(body);
      return new Response(JSON.stringify(resp), {
        headers: { "content-type": "application/json" },
      });
    }
    if (url.pathname === "/health") {
      return new Response("ok");
    }
    return new Response("not found", { status: 404 });
  },
});

console.error(`mock engine listening on http://127.0.0.1:${port}`);

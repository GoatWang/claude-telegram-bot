#!/usr/bin/env bun
/**
 * XCUITest MCP server.
 *
 * Exposes the engine's operations as MCP tools so an agent can drive an iOS
 * simulator/device interactively. The server itself is platform-agnostic; the
 * macOS-side engine does the actual XCUITest work.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { EngineClient } from "./engine-client.ts";
import type { ElementQuery } from "./protocol.ts";
import { SessionManager, listSimulators } from "./session.ts";

const engine = new EngineClient();
const session = new SessionManager();

const server = new Server(
  { name: "xcuitest", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

const elementQuerySchema = {
  type: "object" as const,
  properties: {
    type: { type: "string", description: "XCUIElement type, e.g. 'button', 'textField', 'any'" },
    identifier: { type: "string", description: "Accessibility identifier" },
    label: { type: "string", description: "Exact label / visible text" },
    labelContains: { type: "string", description: "Substring match against label" },
    index: { type: "number", description: "Pick the Nth match (default 0)" },
  },
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "xcui_session_start",
      description:
        "Boot the simulator, build the UI test target, and launch the long-lived XCUITest engine. After this returns the other xcui_* tools are usable. On non-macOS hosts (or with XCUI_DEV_MODE=mock) this spawns the mock engine instead.",
      inputSchema: {
        type: "object" as const,
        properties: {
          project: { type: "string", description: "Path to .xcodeproj or .xcworkspace (macOS only)" },
          scheme: { type: "string", description: "UI test scheme (macOS only)" },
          deviceName: { type: "string", description: "Simulator device name, e.g. 'iPhone 15' (macOS only)" },
          bundleId: { type: "string", description: "App-under-test bundle id (recorded for later use)" },
          testIdentifier: {
            type: "string",
            description: "e.g. 'MyAppUITests/InteractiveEngineTests/testRunForever' (macOS only)",
          },
          enginePort: { type: "number", default: 8765 },
        },
      },
    },
    {
      name: "xcui_session_stop",
      description: "Tear down the running engine (and shut down the sim if we booted it).",
      inputSchema: { type: "object" as const, properties: {} },
    },
    {
      name: "xcui_session_status",
      description: "Report whether a session is running, plus sim/engine info.",
      inputSchema: { type: "object" as const, properties: {} },
    },
    {
      name: "xcui_sim_list",
      description: "List available iOS simulators (macOS) or the mock device (other platforms).",
      inputSchema: { type: "object" as const, properties: {} },
    },
    {
      name: "xcui_launch_app",
      description: "Launch the iOS app with the given bundle identifier.",
      inputSchema: {
        type: "object" as const,
        properties: { bundleId: { type: "string" } },
        required: ["bundleId"],
      },
    },
    {
      name: "xcui_terminate_app",
      description: "Terminate the iOS app with the given bundle identifier.",
      inputSchema: {
        type: "object" as const,
        properties: { bundleId: { type: "string" } },
        required: ["bundleId"],
      },
    },
    {
      name: "xcui_tap",
      description: "Tap the first element matching the query.",
      inputSchema: {
        type: "object" as const,
        properties: { query: elementQuerySchema },
        required: ["query"],
      },
    },
    {
      name: "xcui_type_text",
      description: "Type text. If a query is given, the matching element is tapped first to focus it.",
      inputSchema: {
        type: "object" as const,
        properties: {
          text: { type: "string" },
          query: elementQuerySchema,
        },
        required: ["text"],
      },
    },
    {
      name: "xcui_swipe",
      description: "Swipe in a direction, optionally on a specific element.",
      inputSchema: {
        type: "object" as const,
        properties: {
          direction: { type: "string", enum: ["up", "down", "left", "right"] },
          query: elementQuerySchema,
        },
        required: ["direction"],
      },
    },
    {
      name: "xcui_screenshot",
      description: "Capture a PNG screenshot. Returned as base64 inside the result text.",
      inputSchema: { type: "object" as const, properties: {} },
    },
    {
      name: "xcui_dump_hierarchy",
      description: "Return the current accessibility tree as JSON (good for letting the agent see what's on screen).",
      inputSchema: { type: "object" as const, properties: {} },
    },
    {
      name: "xcui_wait_for",
      description: "Block until an element matching the query exists, or until timeoutMs elapses.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: elementQuerySchema,
          timeoutMs: { type: "number", default: 5000 },
        },
        required: ["query"],
      },
    },
    {
      name: "xcui_press_button",
      description: "Press a hardware button (home, volume_up, volume_down, lock).",
      inputSchema: {
        type: "object" as const,
        properties: {
          button: { type: "string", enum: ["home", "volume_up", "volume_down", "lock"] },
        },
        required: ["button"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const args = (rawArgs ?? {}) as Record<string, unknown>;

  try {
    let result: unknown;
    switch (name) {
      case "xcui_session_start":
        result = await session.start({
          project: args.project as string | undefined,
          scheme: args.scheme as string | undefined,
          deviceName: args.deviceName as string | undefined,
          bundleId: args.bundleId as string | undefined,
          testIdentifier: args.testIdentifier as string | undefined,
          enginePort: args.enginePort as number | undefined,
        });
        break;
      case "xcui_session_stop":
        result = await session.stop();
        break;
      case "xcui_session_status":
        result = session.status();
        break;
      case "xcui_sim_list":
        result = await listSimulators();
        break;
      case "xcui_launch_app":
        result = await engine.send({ op: "launch_app", bundleId: String(args.bundleId) });
        break;
      case "xcui_terminate_app":
        result = await engine.send({ op: "terminate_app", bundleId: String(args.bundleId) });
        break;
      case "xcui_tap":
        result = await engine.send({ op: "tap", query: args.query as ElementQuery });
        break;
      case "xcui_type_text":
        result = await engine.send({
          op: "type_text",
          text: String(args.text),
          query: args.query as ElementQuery | undefined,
        });
        break;
      case "xcui_swipe":
        result = await engine.send({
          op: "swipe",
          direction: args.direction as "up" | "down" | "left" | "right",
          query: args.query as ElementQuery | undefined,
        });
        break;
      case "xcui_screenshot":
        result = await engine.send({ op: "screenshot" });
        break;
      case "xcui_dump_hierarchy":
        result = await engine.send({ op: "dump_hierarchy" });
        break;
      case "xcui_wait_for":
        result = await engine.send(
          {
            op: "wait_for",
            query: args.query as ElementQuery,
            timeoutMs: Number(args.timeoutMs ?? 5000),
          },
          Number(args.timeoutMs ?? 5000) + 5_000,
        );
        break;
      case "xcui_press_button":
        result = await engine.send({
          op: "press_button",
          button: args.button as "home" | "volume_up" | "volume_down" | "lock",
        });
        break;
      default:
        throw new Error(`unknown tool: ${name}`);
    }
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text" as const, text: `engine error: ${message}` }],
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`xcuitest MCP server running (engine=${process.env.XCUI_ENGINE_URL ?? "http://127.0.0.1:8765"})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

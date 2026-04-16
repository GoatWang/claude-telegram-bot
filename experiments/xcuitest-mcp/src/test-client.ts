#!/usr/bin/env bun
/**
 * End-to-end smoke test:
 *   test-client (this) ──MCP stdio──▶ server.ts ──HTTP──▶ mock-engine.ts
 *
 * Spawns the MCP server as a subprocess and walks through a fake login flow,
 * proving the entire wire path works on Linux without any macOS dependencies.
 *
 * Run:
 *   bun run experiments/xcuitest-mcp/src/mock-engine.ts &
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
      XCUI_ENGINE_URL: process.env.XCUI_ENGINE_URL ?? "http://127.0.0.1:8765",
    },
  });

  const client = new Client({ name: "xcui-test-client", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log(`✓ discovered ${tools.tools.length} tools:`, tools.tools.map((t) => t.name).join(", "));

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
    if (r.isError) throw new Error(`${name} failed: ${text}`);
    return text ? JSON.parse(text) : null;
  };

  console.log("→ launching app");
  console.log("  ", await call("xcui_launch_app", { bundleId: "com.example.demo" }));

  console.log("→ dumping hierarchy");
  const tree = await call("xcui_dump_hierarchy");
  const fields = (tree.children ?? []).map((c: { type: string; identifier?: string }) => `${c.type}#${c.identifier ?? ""}`);
  console.log("  ", fields.join(", "));

  console.log("→ typing username");
  console.log("  ", await call("xcui_type_text", { text: "alice", query: { identifier: "usernameField" } }));

  console.log("→ typing password");
  console.log("  ", await call("xcui_type_text", { text: "hunter2", query: { identifier: "passwordField" } }));

  console.log("→ tapping login");
  console.log("  ", await call("xcui_tap", { query: { identifier: "loginButton" } }));

  console.log("→ waiting for welcome message");
  console.log("  ", await call("xcui_wait_for", { query: { type: "staticText", labelContains: "Welcome" }, timeoutMs: 1000 }));

  console.log("→ taking screenshot");
  const shot = await call("xcui_screenshot");
  console.log(`   png ${shot.png.length} bytes (base64), ${shot.width}x${shot.height}`);

  await client.close();
  console.log("\n✅ end-to-end OK");
}

main().catch((e) => {
  console.error("\n❌", e);
  process.exit(1);
});

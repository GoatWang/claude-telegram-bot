# XCUITest as an interactive engine, fronted by MCP

**Branch:** `claude/xcuitest-script-cli-research-KAFh6`
**Status:** Research + working Linux prototype. macOS engine = skeleton only.
**Prototype:** [`experiments/xcuitest-mcp/`](../../experiments/xcuitest-mcp/)

## TL;DR

**Yes, XCUITest can be wrapped into an interactive engine that an MCP server
exposes to an agent.** The trick is to keep a single `XCTestCase` method
alive forever and let an embedded HTTP service inside it accept commands one
at a time. This pattern already exists in production as
[WebDriverAgent](https://github.com/appium/WebDriverAgent) (used by Appium);
this experiment shows how to compose the same idea with MCP, and includes a
working Linux loop you can run today to validate the protocol without a Mac.

## Background — why this isn't trivial

XCUITest is **script-based**: you write `XCTestCase` subclasses in Swift,
compile them into an `.xctest` bundle, and run the bundle through
`xcodebuild test` (or Xcode). Each test method runs to completion and the
runner exits. There is no built-in REPL, no daemon mode, no public IPC that
lets an external process steer the test mid-run.

That's a poor fit for an agent loop, where every step is "look at the screen
→ pick one action → observe → decide next action." Re-launching the runner
per action is too slow (5–15 s cold start) and loses simulator state.

So we need to **keep one test method running forever** and feed it commands
from outside. Three viable architectures:

| # | Architecture | Pros | Cons |
|---|--------------|------|------|
| **A** | **MCP wrapper around WebDriverAgent** | WDA is mature, real-device-capable, well-documented WebDriver API | Adds a heavy dep; WDA's API is iOS-flavored WebDriver, not idiomatic XCUITest |
| **B** | **Custom XCUITest engine + MCP** *(this experiment)* | Tight, minimal surface; expose exactly what the agent needs; ~300 LOC Swift | You maintain the engine; fewer features than WDA out of the box |
| **C** | **MCP wrapper around `idb` / `simctl`** | No XCUITest at all; works without a test target | No accessibility-tree introspection; limited to coordinate-level taps |

Option B is what's prototyped here. The architecture is identical to A, just
with a custom engine you control.

## Architecture

```
┌──────────┐  MCP/stdio  ┌───────────┐   HTTP/JSON   ┌───────────────────┐
│  Agent   │────────────▶│ MCP server│──────────────▶│ XCUITest engine   │
└──────────┘             │  (TS/Bun) │               │ (long-lived test) │
                         └───────────┘               └─────────┬─────────┘
                                                               │ XCUI APIs
                                                               ▼
                                                       ┌──────────────┐
                                                       │ iOS Simulator│
                                                       │   or device  │
                                                       └──────────────┘
```

### The engine (macOS)

`engine-swift/InteractiveEngine.swift` defines a single test method,
`testRunForever`, that:

1. Opens an `NWListener` on `127.0.0.1:8765`.
2. Calls `RunLoop.main.run()` so the test runner doesn't exit.
3. For every incoming HTTP POST `/command`, parses the JSON envelope,
   dispatches it to `XCUIApplication` / `XCUIElementQuery` on the **main
   thread** (XCUITest APIs require this), and writes back a JSON response.

Why an embedded HTTP server and not stdio? `xcodebuild` captures the test
runner's stdio for its own log format (xcresult). HTTP avoids fighting that.
We chose `Network.framework` over a third-party dep so the engine stays a
single file. For richer features (chunked uploads, websockets) you'd swap in
`GCDWebServer` or `Embassy`.

### The MCP server (any platform)

`src/server.ts` is a stdio MCP server using the official
`@modelcontextprotocol/sdk`. It exposes 9 tools that map 1:1 onto engine
operations: `xcui_launch_app`, `xcui_tap`, `xcui_type_text`, `xcui_swipe`,
`xcui_screenshot`, `xcui_dump_hierarchy`, `xcui_wait_for`,
`xcui_press_button`, `xcui_terminate_app`.

The element selector is a small declarative `query` shape:

```ts
{
  type?: "button" | "textField" | "secureTextField" | "staticText" | "any";
  identifier?: string;     // accessibility identifier
  label?: string;          // exact visible text
  labelContains?: string;  // substring
  index?: number;          // pick Nth match
}
```

Three reasons to make queries declarative rather than freeform XPath:

1. The agent generates fewer errors — no XPath syntax to get wrong.
2. The engine can map cleanly onto `XCUIElementQuery`, which is the natural
   XCUITest abstraction.
3. Result JSON stays small enough that `xcui_dump_hierarchy` followed by a
   query is cheap.

### The wire protocol

A single HTTP POST per command, JSON in/out:

```json
// request
{ "id": "uuid", "op": "tap", "query": { "identifier": "loginButton" } }

// response
{ "id": "uuid", "ok": true, "result": { "tapped": "Log in" } }
```

Errors are surfaced as `{ "ok": false, "error": "<message>" }` and the MCP
server forwards them as tool errors. See `src/protocol.ts` for the full
shape.

## Validating on Linux without a Mac

The constraint that XCUITest only runs on macOS makes iteration slow. To
break that loop, the experiment ships a Linux-runnable mock engine
(`src/mock-engine.ts`) that speaks the same wire protocol, plus a test
client (`src/test-client.ts`) that drives the MCP server through a fake
login flow.

Running it on this Linux box produces:

```
✓ discovered 9 tools: xcui_launch_app, xcui_terminate_app, xcui_tap, ...
→ launching app                 → { launched: 'com.example.demo' }
→ dumping hierarchy             → navigationBar#, textField#usernameField, ...
→ typing username               → { typed: 'alice', into: 'usernameField' }
→ typing password               → { typed: 'hunter2', into: 'passwordField' }
→ tapping login                 → { tapped: 'loginButton' }
→ waiting for welcome message   → { found: true, element: { ... 'Welcome alice' ... } }
→ taking screenshot             → png 92 bytes (base64), 1x1
✅ end-to-end OK
```

This proves the MCP↔engine wire path works. Swapping the mock for the real
Swift engine is a matter of pointing `XCUI_ENGINE_URL` at the device.

## Trade-offs and open questions

| Topic | Note |
|-------|------|
| **Concurrency** | The test runner is single-threaded for UI ops. The MCP server should serialize tool calls per engine — a queue, not a fan-out. |
| **Lifecycle** | If the engine crashes (test runner dies), the MCP server's first failed request should restart `xcodebuild test`. Not implemented in the skeleton. |
| **Screenshots** | Returning base64 PNGs through MCP works, but every screenshot is ~50–500 KB of context. Consider returning a file path to `/tmp/...` and a thumbnail by default, full PNG on demand. |
| **Hierarchy dumps** | XCUITest's `debugDescription` is human text, not JSON. The skeleton uses it as a placeholder; production code should walk `XCUIElement.children` and build the JSON tree explicitly. |
| **Real devices** | Same engine works on physical devices via `xcodebuild test -destination 'id=<UDID>'`, but you need a wired/wireless connection and a provisioning profile. |
| **Vs WDA** | If you don't need a custom protocol, wrap WDA instead. WDA already has the long-running session, accessibility queries, screenshot streaming, swipe/pinch primitives, and 5+ years of edge-case fixes. |
| **Sandbox** | The test runner is sandboxed by Apple. Don't expect to shell out to arbitrary binaries from inside the engine — use the host MCP server for that. |

## Recommendation

For **research / a controlled demo**, the custom engine in this experiment is
the right shape: small surface, no dependencies, the protocol is yours to
evolve.

For **anything user-facing**, wrap [WebDriverAgent](https://github.com/appium/WebDriverAgent)
behind a similar MCP server. The MCP tool surface designed here translates
directly onto WDA's WebDriver endpoints (`/element`, `/element/{id}/click`,
`/screenshot`, etc.); only the `EngineClient` swap is needed.

Either way, the answer to the original question — *can XCUITest be turned
into an interactive engine that an MCP server exposes to an agent?* — is
**yes, and the wire protocol is small enough to validate without a Mac**.

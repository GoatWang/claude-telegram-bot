# XCUITest ⇄ MCP — interactive engine experiment

Proof of concept for wrapping XCUITest in an interactive engine an LLM agent
can drive over MCP.

## Why

XCUITest is normally script-based: write a test, compile, run, exit. That's
not how an agent wants to work — an agent wants to send one tap, see the
result, decide the next move. To bridge the two worlds we keep a single
XCUITest test method alive forever and let an embedded HTTP server inside it
accept commands one at a time.

```
┌──────────┐  MCP/stdio  ┌───────────┐   HTTP/JSON   ┌───────────────────┐
│  Agent   │────────────▶│ MCP server│──────────────▶│ XCUITest engine   │
└──────────┘             │  (this)   │               │ (long-lived test) │
                         └───────────┘               └─────────┬─────────┘
                                                               │ XCUI APIs
                                                               ▼
                                                       ┌──────────────┐
                                                       │ iOS Simulator│
                                                       │   or device  │
                                                       └──────────────┘
```

## Layout

| Path                              | Role                                                         |
| --------------------------------- | ------------------------------------------------------------ |
| `src/protocol.ts`                 | Wire types shared by MCP server and engine                   |
| `src/server.ts`                   | MCP server (stdio); exposes 13 tools                         |
| `src/session.ts`                  | Simulator + engine lifecycle (real macOS path + Linux mock)  |
| `src/engine-client.ts`            | HTTP client used by the MCP server                           |
| `src/mock-engine.ts`              | Linux-runnable fake engine for end-to-end tests              |
| `src/test-client.ts`              | Drives the MCP server through full lifecycle + login flow    |
| `engine-swift/InteractiveEngine.swift` | The macOS side: long-lived `XCTestCase` + embedded HTTP |

## Run on Linux (mock loop)

The MCP server now owns the engine lifecycle, so a single command runs the
whole flow (start session → drive UI → stop session):

```bash
bun run experiments/xcuitest-mcp/src/test-client.ts
```

Expected output (abridged):

```
✓ discovered 13 tools

=== Phase 1: session lifecycle ===
→ listing simulators            → 1: Linux Mock (iPhone 15)
→ checking status before start  → { running: false, backend: 'mock' }
→ starting session              → running=true backend=mock pid=10242

=== Phase 2: drive the app ===
→ launching app                 → { launched: 'com.example.demo' }
→ hierarchy                     → navigationBar#, textField#usernameField, ...
→ login flow                    → Welcome alice
→ screenshot                    → 92 bytes base64

=== Phase 3: tear down ===
→ stopping session              → SIGTERM mock-engine
✅ full lifecycle OK
```

## Run on macOS (real loop)

1. Add `engine-swift/InteractiveEngine.swift` to a UI Testing target in your
   Xcode project.
2. Wire the MCP server into your agent's MCP client config (no env needed —
   `darwin` auto-selects the macOS backend):
   ```jsonc
   { "mcpServers": { "xcuitest": { "command": "bun",
       "args": ["run", "/path/to/experiments/xcuitest-mcp/src/server.ts"] } } }
   ```
3. From the agent, call `xcui_session_start` with the project info:
   ```json
   {
     "project": "/path/to/MyApp.xcodeproj",
     "scheme": "MyAppUITests",
     "deviceName": "iPhone 15",
     "bundleId": "com.example.demo",
     "testIdentifier": "MyAppUITests/InteractiveEngineTests/testRunForever"
   }
   ```
   The session manager boots the sim, runs `xcodebuild test ...`, polls
   `/health`, and only returns once the engine is ready. Subsequent
   `xcui_*` calls go straight to it. `xcui_session_stop` tears everything down.

If you'd rather drive things by hand, the old way still works — start the
engine via `xcodebuild test` yourself and skip `xcui_session_start`.

## MCP tools exposed

**Session / orchestration** (owned by `src/session.ts`):

| Tool                  | Args                                                                          | Result                                  |
| --------------------- | ----------------------------------------------------------------------------- | --------------------------------------- |
| `xcui_session_start`  | `project`, `scheme`, `deviceName`, `bundleId`, `testIdentifier`, `enginePort?`| `{ running, backend, sim, enginePid, engineUrl }` |
| `xcui_session_stop`   | —                                                                             | `{ running:false }`                     |
| `xcui_session_status` | —                                                                             | current state                           |
| `xcui_sim_list`       | —                                                                             | array of `{ udid, name, state, runtime }` |

**Interaction** (forwarded to the engine):

| Tool                  | Args                                  | Result                          |
| --------------------- | ------------------------------------- | ------------------------------- |
| `xcui_launch_app`     | `bundleId`                            | `{ launched }`                  |
| `xcui_terminate_app`  | `bundleId`                            | `{ terminated }`                |
| `xcui_tap`            | `query`                               | `{ tapped }`                    |
| `xcui_type_text`      | `text`, `query?`                      | `{ typed }`                     |
| `xcui_swipe`          | `direction`, `query?`                 | `{ swiped }`                    |
| `xcui_screenshot`     | —                                     | `{ png(base64), width, height }`|
| `xcui_dump_hierarchy` | —                                     | accessibility tree JSON         |
| `xcui_wait_for`       | `query`, `timeoutMs`                  | `{ found, element }`            |
| `xcui_press_button`   | `home \| volume_up \| volume_down`    | `{ pressed }`                   |

`query` is `{ type?, identifier?, label?, labelContains?, index? }`.

## Backends

| Backend | Selected when                                | Behaviour                                                  |
| ------- | -------------------------------------------- | ---------------------------------------------------------- |
| `macos` | `process.platform === 'darwin'` (default)    | `xcrun simctl boot` + `xcodebuild test`                    |
| `mock`  | non-Darwin, or `XCUI_DEV_MODE=mock`          | spawns `mock-engine.ts` so the wire path can be exercised  |

Force a backend with `XCUI_DEV_MODE=mock` (useful on a Mac for local dev
without paying the xcodebuild cold-start tax).

## Caveats

- **Single client.** The HTTP server inside the test runner is single-tenant.
  Don't share an engine across agents.
- **Test-host limits.** XCUITest runs in a separate test runner process that
  Apple sandboxes; you cannot, e.g., shell out to arbitrary system commands
  from inside the test on a real device.
- **Production alternative.** [WebDriverAgent](https://github.com/appium/WebDriverAgent)
  already implements this pattern with a richer API. For real work, consider
  writing the MCP server as a thin wrapper around WDA instead of maintaining
  your own engine.
- **Mock vs real.** The mock engine fakes a tiny in-memory UI tree to verify
  the wire protocol. It does NOT validate XCUITest semantics — only the
  Swift engine does that.

See [docs/research/xcuitest-mcp.md](../../docs/research/xcuitest-mcp.md) for
the full architecture write-up and trade-offs.

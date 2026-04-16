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
| `src/server.ts`                   | MCP server (stdio); exposes 9 tools                          |
| `src/engine-client.ts`            | HTTP client used by the MCP server                           |
| `src/mock-engine.ts`              | Linux-runnable fake engine for end-to-end tests              |
| `src/test-client.ts`              | Drives the MCP server through a fake login flow              |
| `engine-swift/InteractiveEngine.swift` | The macOS side: long-lived `XCTestCase` + embedded HTTP |

## Run on Linux (mock loop)

```bash
# 1. mock engine in one shell
bun run experiments/xcuitest-mcp/src/mock-engine.ts

# 2. end-to-end test in another shell
bun run experiments/xcuitest-mcp/src/test-client.ts
```

Expected output:

```
✓ discovered 9 tools: xcui_launch_app, ...
→ launching app
   { launched: 'com.example.demo' }
→ dumping hierarchy
   navigationBar#, textField#usernameField, secureTextField#passwordField, button#loginButton
→ typing username
→ typing password
→ tapping login
→ waiting for welcome message
→ taking screenshot
   png 92 bytes (base64), 1x1
✅ end-to-end OK
```

## Run on macOS (real loop)

1. Add `engine-swift/InteractiveEngine.swift` to a UI Testing target in your
   Xcode project.
2. Boot a simulator and launch the engine:
   ```bash
   xcodebuild test \
     -scheme MyAppUITests \
     -destination 'platform=iOS Simulator,name=iPhone 15' \
     -only-testing:MyAppUITests/InteractiveEngineTests/testRunForever
   ```
3. Point the MCP server at it (default URL works):
   ```bash
   XCUI_ENGINE_URL=http://127.0.0.1:8765 \
     bun run experiments/xcuitest-mcp/src/server.ts
   ```
4. Wire the MCP server into your agent's MCP client config.

## MCP tools exposed

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

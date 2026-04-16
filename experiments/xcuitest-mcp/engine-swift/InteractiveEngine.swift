// InteractiveEngine.swift
//
// Long-lived XCUITest test that turns XCUITest into an interactive engine.
// The trick: a single XCTestCase method (`testRunForever`) blocks on a
// RunLoop while a tiny embedded HTTP server accepts JSON command envelopes
// and dispatches them on the test thread.
//
// Build target: a UI Testing Bundle in your Xcode project. Run with:
//
//   xcodebuild test \
//     -scheme MyAppUITests \
//     -destination 'platform=iOS Simulator,name=iPhone 15' \
//     -only-testing:MyAppUITests/InteractiveEngineTests/testRunForever
//
// Then your MCP server (XCUI_ENGINE_URL=http://127.0.0.1:8765) can drive it.
//
// NOTE: This file is a SKELETON. It compiles in spirit, not on this Linux box
// (no XCTest available). The Network framework is used for the HTTP server to
// avoid pulling in third-party deps; in practice you may prefer GCDWebServer
// or Embassy for a more complete HTTP implementation.

import XCTest
import Foundation
import Network

// MARK: - Wire types (mirror src/protocol.ts)

private struct Envelope: Codable {
    let id: String
    let op: String
    // op-specific fields are decoded ad hoc from a raw JSON dict
}

private struct Query: Codable {
    var type: String?
    var identifier: String?
    var label: String?
    var labelContains: String?
    var index: Int?
}

// MARK: - Engine

final class InteractiveEngineTests: XCTestCase {

    private var app: XCUIApplication?
    private let queue = DispatchQueue(label: "xcui.engine.dispatch")
    private var listener: NWListener?

    /// The single test method that keeps the runner alive.
    func testRunForever() throws {
        let port: NWEndpoint.Port = 8765
        try startHTTP(on: port)
        // Block forever - the HTTP handlers do all the work.
        // RunLoop.main lets XCTest's own machinery (screenshots, attachments) work.
        RunLoop.main.run()
    }

    // MARK: HTTP server

    private func startHTTP(on port: NWEndpoint.Port) throws {
        let params = NWParameters.tcp
        let listener = try NWListener(using: params, on: port)
        listener.newConnectionHandler = { [weak self] conn in
            conn.start(queue: self?.queue ?? .main)
            self?.receive(on: conn)
        }
        listener.start(queue: queue)
        self.listener = listener
        NSLog("xcui engine listening on 127.0.0.1:\(port.rawValue)")
    }

    private func receive(on conn: NWConnection) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { [weak self] data, _, isComplete, error in
            guard let self, let data, error == nil else { conn.cancel(); return }
            // crude HTTP parse: assume single request, find \r\n\r\n
            guard let req = String(data: data, encoding: .utf8),
                  let bodyRange = req.range(of: "\r\n\r\n") else {
                self.write(conn, status: 400, body: "bad request")
                return
            }
            let body = String(req[bodyRange.upperBound...])
            self.handle(jsonBody: body) { responseJSON in
                self.write(conn, status: 200, body: responseJSON, contentType: "application/json")
            }
            if !isComplete { self.receive(on: conn) }
        }
    }

    private func write(_ conn: NWConnection, status: Int, body: String, contentType: String = "text/plain") {
        let resp = """
        HTTP/1.1 \(status) OK\r
        Content-Type: \(contentType)\r
        Content-Length: \(body.utf8.count)\r
        Connection: close\r
        \r
        \(body)
        """
        conn.send(content: resp.data(using: .utf8), completion: .contentProcessed { _ in
            conn.cancel()
        })
    }

    // MARK: Command dispatch

    private func handle(jsonBody: String, reply: @escaping (String) -> Void) {
        DispatchQueue.main.async { // XCUITest APIs must be used on the main thread
            let result = self.dispatch(jsonBody: jsonBody)
            reply(result)
        }
    }

    private func dispatch(jsonBody: String) -> String {
        guard let data = jsonBody.data(using: .utf8),
              let any = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = any["id"] as? String,
              let op = any["op"] as? String else {
            return #"{"id":"","ok":false,"error":"bad envelope"}"#
        }

        do {
            switch op {
            case "ping":
                return ok(id, ["pong": true])

            case "launch_app":
                guard let bundleId = any["bundleId"] as? String else { return err(id, "bundleId required") }
                let app = XCUIApplication(bundleIdentifier: bundleId)
                app.launch()
                self.app = app
                return ok(id, ["launched": bundleId])

            case "terminate_app":
                guard let bundleId = any["bundleId"] as? String else { return err(id, "bundleId required") }
                let app = XCUIApplication(bundleIdentifier: bundleId)
                app.terminate()
                return ok(id, ["terminated": bundleId])

            case "tap":
                let q = decodeQuery(any["query"])
                guard let el = try resolve(q) else { return err(id, "no element matched") }
                el.tap()
                return ok(id, ["tapped": el.label])

            case "type_text":
                guard let text = any["text"] as? String else { return err(id, "text required") }
                if let qDict = any["query"] {
                    let q = decodeQuery(qDict)
                    guard let el = try resolve(q) else { return err(id, "no element matched") }
                    el.tap()
                    el.typeText(text)
                } else {
                    self.app?.typeText(text)
                }
                return ok(id, ["typed": text])

            case "swipe":
                guard let dir = any["direction"] as? String else { return err(id, "direction required") }
                let target: XCUIElement
                if let qDict = any["query"], let el = try resolve(decodeQuery(qDict)) {
                    target = el
                } else {
                    guard let app = self.app else { return err(id, "no app launched") }
                    target = app
                }
                switch dir {
                case "up":    target.swipeUp()
                case "down":  target.swipeDown()
                case "left":  target.swipeLeft()
                case "right": target.swipeRight()
                default: return err(id, "unknown direction")
                }
                return ok(id, ["swiped": dir])

            case "screenshot":
                let shot = XCUIScreen.main.screenshot()
                let b64 = shot.pngRepresentation.base64EncodedString()
                return ok(id, ["png": b64, "width": Int(shot.image.size.width), "height": Int(shot.image.size.height)])

            case "dump_hierarchy":
                guard let app = self.app else { return err(id, "no app launched") }
                // Trade-off: debugDescription is human-friendly text, not JSON. For real
                // use, walk the element tree explicitly with XCUIElementQuery.
                return ok(id, ["debug": app.debugDescription])

            case "wait_for":
                let q = decodeQuery(any["query"])
                let timeoutMs = (any["timeoutMs"] as? Double) ?? 5000
                guard let el = try resolve(q) else { return err(id, "no element matched") }
                let exists = el.waitForExistence(timeout: timeoutMs / 1000.0)
                return exists ? ok(id, ["found": true]) : err(id, "timeout")

            case "press_button":
                guard let button = any["button"] as? String else { return err(id, "button required") }
                switch button {
                case "home": XCUIDevice.shared.press(.home)
                default: return err(id, "unsupported button: \(button)")
                }
                return ok(id, ["pressed": button])

            default:
                return err(id, "unknown op: \(op)")
            }
        } catch {
            return err(id, "\(error)")
        }
    }

    // MARK: Element resolution

    private func decodeQuery(_ raw: Any?) -> Query {
        guard let dict = raw as? [String: Any] else { return Query() }
        return Query(
            type: dict["type"] as? String,
            identifier: dict["identifier"] as? String,
            label: dict["label"] as? String,
            labelContains: dict["labelContains"] as? String,
            index: dict["index"] as? Int
        )
    }

    private func resolve(_ q: Query) throws -> XCUIElement? {
        guard let app = self.app else { return nil }
        var query: XCUIElementQuery
        switch q.type {
        case "button":         query = app.buttons
        case "textField":      query = app.textFields
        case "secureTextField":query = app.secureTextFields
        case "staticText":     query = app.staticTexts
        case "cell":           query = app.cells
        case "navigationBar":  query = app.navigationBars
        case "any", nil:       query = app.descendants(matching: .any)
        default:               query = app.descendants(matching: .any)
        }
        if let id = q.identifier { query = query.matching(identifier: id) }
        if let label = q.label { query = query.matching(NSPredicate(format: "label == %@", label)) }
        if let sub = q.labelContains { query = query.matching(NSPredicate(format: "label CONTAINS %@", sub)) }
        let element = query.element(boundBy: q.index ?? 0)
        return element.exists ? element : nil
    }

    // MARK: Reply helpers

    private func ok(_ id: String, _ result: [String: Any]) -> String {
        encode(["id": id, "ok": true, "result": result])
    }
    private func err(_ id: String, _ message: String) -> String {
        encode(["id": id, "ok": false, "error": message])
    }
    private func encode(_ obj: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: obj, options: []),
              let s = String(data: data, encoding: .utf8) else {
            return #"{"ok":false,"error":"encode failed"}"#
        }
        return s
    }
}

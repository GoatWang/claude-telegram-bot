/**
 * Wire protocol shared by the MCP server and the XCUITest "engine".
 *
 * The engine (running inside a long-lived XCTestCase on macOS) exposes a
 * tiny HTTP service. Every request is a single JSON envelope describing one
 * operation against the simulator/device under test. Responses are JSON too.
 *
 * Keeping the surface this small means the Swift side stays under ~300 LOC
 * and the MCP server just translates tool calls into envelopes.
 */

export type ElementQuery = {
  /** XCUIElement.ElementType raw name, e.g. "button", "textField", "any". */
  type?: string;
  /** XCUIElement.identifier (accessibility identifier, set in the app code). */
  identifier?: string;
  /** XCUIElement.label (visible text). */
  label?: string;
  /** Substring match against label, when an exact match is too brittle. */
  labelContains?: string;
  /** Pick the Nth match (default 0). */
  index?: number;
};

export type SwipeDirection = "up" | "down" | "left" | "right";
export type HardwareButton = "home" | "volume_up" | "volume_down" | "lock";

export type Op =
  | { op: "ping" }
  | { op: "launch_app"; bundleId: string }
  | { op: "terminate_app"; bundleId: string }
  | { op: "tap"; query: ElementQuery }
  | { op: "double_tap"; query: ElementQuery }
  | { op: "type_text"; text: string; query?: ElementQuery }
  | { op: "swipe"; direction: SwipeDirection; query?: ElementQuery }
  | { op: "screenshot" }
  | { op: "dump_hierarchy" }
  | { op: "wait_for"; query: ElementQuery; timeoutMs: number }
  | { op: "press_button"; button: HardwareButton };

export type EngineRequest = { id: string } & Op;

export type EngineResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string };

/** A node in the accessibility hierarchy snapshot. */
export type Element = {
  type: string;
  identifier?: string;
  label?: string;
  value?: string;
  enabled: boolean;
  selected?: boolean;
  frame?: { x: number; y: number; w: number; h: number };
  children?: Element[];
};

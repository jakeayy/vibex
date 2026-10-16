// Messages between VibeX in the page and the extension's bridge content
// script. They travel over window.postMessage, so they carry a marker key.

export const MARKER = "__vibexBridge";

/** Page -> bridge: which network rulesets should be on (ruleset id -> on). */
export interface RulesetsMessage {
    [MARKER]: "rulesets";
    rules: Record<string, boolean>;
}

/** Bridge -> page: the bridge is listening (it may load after the page script). */
export interface ReadyMessage {
    [MARKER]: "ready";
}

export type BridgeMessage = RulesetsMessage | ReadyMessage;

export const isBridgeMessage = (data: unknown): data is BridgeMessage =>
    !!data && typeof data === "object" && MARKER in data;

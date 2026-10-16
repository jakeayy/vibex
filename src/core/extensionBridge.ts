// Talks to the browser extension (extension builds only): keeps its network
// block rulesets in line with VibeX's plugin settings.
import { MARKER, isBridgeMessage, type RulesetsMessage } from "../extension/protocol";
import { networkRuleState } from "../plugins/manager";
import { onSettingsChange } from "../utils/storage";

export function initExtensionBridge() {
    if (VIBEX_TARGET === "userscript") return;

    let sent = "";
    const send = (force = false) => {
        const rules = networkRuleState();
        const key = JSON.stringify(rules);
        if (!force && key === sent) return;
        sent = key;
        const message: RulesetsMessage = { [MARKER]: "rulesets", rules };
        window.postMessage(message, location.origin);
    };

    // The bridge content script may start after this; it says when it's listening.
    window.addEventListener("message", event => {
        if (event.source === window && isBridgeMessage(event.data) && event.data[MARKER] === "ready") send(true);
    });
    onSettingsChange(() => send());
    send(true);
}

/// <reference types="chrome" />
// Extension content script in the isolated world: relays VibeX's requests
// from the page (which has no extension APIs) to the background script.
import { MARKER, isBridgeMessage } from "./protocol";

window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!isBridgeMessage(data) || data[MARKER] !== "rulesets") return;
    if (!data.rules || typeof data.rules !== "object") return;
    chrome.runtime.sendMessage({ type: "rulesets", rules: data.rules }).catch(() => { /* background restarting */ });
});

// The page script may have posted before this listener existed; ask it to resend.
window.postMessage({ [MARKER]: "ready" }, location.origin);

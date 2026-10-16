/// <reference types="chrome" />
// Extension background script (service worker in Chrome, event page in Firefox).

/** Ruleset ids declared in the manifest (extension/rules/<id>.json). */
const RULESETS = new Set(
    (chrome.runtime.getManifest().declarative_net_request?.rule_resources ?? []).map(r => r.id),
);

// Network rulesets follow VibeX's plugin settings, sent from the page through
// the bridge. Enabled rulesets persist across restarts, so blocking applies
// from X's very first request on the next visit.
chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type !== "rulesets" || !sender.tab || typeof message.rules !== "object") return;
    const enableRulesetIds: string[] = [], disableRulesetIds: string[] = [];
    for (const [id, on] of Object.entries(message.rules)) {
        if (RULESETS.has(id)) (on ? enableRulesetIds : disableRulesetIds).push(id);
    }
    chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds })
        .catch(e => console.error("[VibeX] couldn't update rulesets", e));
});

// Toolbar button: open VibeX's settings on X.
chrome.action.onClicked.addListener(() => {
    chrome.tabs.create({ url: "https://x.com/settings/vibex" });
});

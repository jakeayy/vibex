import { addInterceptor, apiPath, type InterceptedRequest } from "../utils/network";
import { getPluginSetting, isEnabled } from "./manager";
import { definePlugin } from "./types";

const NAME = "SponsorBegone";
const setting = (key: string) => !!getPluginSetting(NAME, key);

/**
 * X's telemetry endpoints (API paths, without the `/i/api` prefix), as used
 * by its scribe client, error/perf loggers, span tracer and ad-impression
 * logger. Several hide behind "graphql/" or "flow/" names; X's own
 * telemetry list (failure-rate tracking) uses the same set.
 */
const TRACKING = /^\/1\.1\/(?:jot\/|graphql\/(?:viewer_context|user_flow|app_context|error_log|ces\/p2)|flow\/(?:timeline|viewer)|promoted_content\/log)/;

const stats = { requestsBlocked: 0, adsRemoved: 0, requestsRewritten: 0 };

/** Turns `includePromotedContent` off in GraphQL variables, so X doesn't send ads. */
function noPromotedVariables(vars: any): boolean {
    if (vars && typeof vars === "object" && vars.includePromotedContent === true) {
        vars.includePromotedContent = false;
        return true;
    }
    return false;
}

function interceptor({ url, method, body }: InterceptedRequest) {
    if (!isEnabled(NAME) || !/(^|\.)(x|twitter)\.com$/.test(url.hostname)) return;
    const path = apiPath(url);

    if (setting("blockTracking") && TRACKING.test(path)) {
        stats.requestsBlocked++;
        return { block: true } as const;
    }

    if (!setting("removeAds") || !path.includes("/graphql/")) return;

    // GET: variables live in the query string.
    const v = url.searchParams.get("variables");
    if (v?.includes('"includePromotedContent":true')) {
        try {
            const vars = JSON.parse(v);
            if (noPromotedVariables(vars)) {
                const next = new URL(url);
                next.searchParams.set("variables", JSON.stringify(vars));
                stats.requestsRewritten++;
                return { url: next };
            }
        } catch { /* not JSON; leave alone */ }
    }

    // POST: variables live in the JSON body.
    if (method === "POST" && typeof body === "string" && body.includes('"includePromotedContent":true')) {
        try {
            const json = JSON.parse(body);
            if (noPromotedVariables(json.variables)) {
                stats.requestsRewritten++;
                return { body: JSON.stringify(json) };
            }
        } catch { /* not JSON; leave alone */ }
    }
}

export default definePlugin({
    name: NAME,
    description: "Removes promoted posts, promoted accounts and trends, and other ads, and blocks X's tracking requests.",
    authors: ["VibeX"],
    startEarly: true,
    networkRules: { telemetry: s => !!s.blockTracking },
    settings: {
        removeAds: {
            type: "boolean",
            section: "Ads",
            description: "Remove promoted posts, accounts, trends and other ads",
            default: true,
        },
        blockTracking: {
            type: "boolean",
            section: "Tracking",
            description: "Block X's analytics, client-event and ad-impression logging",
            default: true,
        },
    },
    patches: [
        {
            // X's timeline entry pipeline (also applies ad spacing): every
            // entry and module item of every timeline passes through this
            // callback. Returning null drops it before it reaches the store.
            find: "shouldCountTowardsAdSpacing",
            replacement: {
                match: /entries:([\w$]+)\(([\w$]+),\(\{entry:([\w$]+),parentModule:([\w$]+)\}\)=>\{/,
                replace: "entries:$1($2,({entry:$3,parentModule:$4})=>{if($self.isAd($3))return null;",
            },
        },
    ],

    stats,

    isAd(entry: any): boolean {
        if (!isEnabled(NAME) || !setting("removeAds") || !entry) return false;
        const ad = !!entry.content?.promotedMetadata || entry.type === "ui_immersiveAd";
        if (ad) stats.adsRemoved++;
        return ad;
    },

    start({ onStop }) {
        // Starts at document-start (startEarly) so X's very first requests
        // already go through the interceptor.
        onStop(addInterceptor(interceptor));
    },
});

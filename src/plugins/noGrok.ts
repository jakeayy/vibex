import { addSwitchResolver, withValue } from "../core/featureSwitches";
import { addInterceptor, addResponseObserver, apiPath } from "../utils/network";
import { getPluginSetting, isEnabled } from "./manager";
import { definePlugin } from "./types";

const NAME = "NoGrok";
const setting = (key: string) => isEnabled(NAME) && !!getPluginSetting(NAME, key);

/* ------------------------------- Grok posts -------------------------------- */

// Only account-level signals: a post that merely contains the word "Grok"
// may well be unrelated to the bot, so it is kept.
const GROK_ACCOUNT = "grok";
const BY_GROK = 1, MENTIONS_GROK = 2;

/** Post id -> BY_GROK | MENTIONS_GROK bit flags, filled from API responses. */
const grokPosts = new Map<string, number>();

const isGrok = (name: unknown) => typeof name === "string" && name.toLowerCase() === GROK_ACCOUNT;

/** Classifies a GraphQL tweet result (and the posts it retweets or quotes). */
function classify(result: any, depth = 0): number {
    if (!result || depth > 3) return 0;
    if (result.__typename === "TweetWithVisibilityResults") result = result.tweet;
    const legacy = result?.legacy;
    if (!legacy || typeof result.rest_id !== "string") return 0;

    const user = result.core?.user_results?.result;
    let flags = isGrok(user?.core?.screen_name ?? user?.legacy?.screen_name) ? BY_GROK : 0;
    if (isGrok(legacy.in_reply_to_screen_name)
        || legacy.entities?.user_mentions?.some((m: any) => isGrok(m?.screen_name))) flags |= MENTIONS_GROK;

    // A retweet or quote of a Grok post counts as a Grok post.
    const inner = classify(legacy.retweeted_status_result?.result, depth + 1)
        | classify(result.quoted_status_result?.result, depth + 1);
    if (inner & BY_GROK) flags |= BY_GROK;
    if (inner & MENTIONS_GROK && legacy.retweeted_status_result) flags |= MENTIONS_GROK;

    if (flags) grokPosts.set(result.rest_id, flags);
    return flags;
}

function scan(node: unknown, depth = 0) {
    if (!node || typeof node !== "object" || depth > 60) return;
    if (Array.isArray(node)) {
        for (const item of node) scan(item, depth + 1);
        return;
    }
    const o = node as Record<string, any>;
    if (o.tweet_results?.result) classify(o.tweet_results.result);
    for (const k in o) scan(o[k], depth + 1);
}

/** Id of the post opened at /<user>/status/<id>; never hidden, or its page would be empty. */
const focalId = () => location.pathname.match(/\/status\/(\d+)/)?.[1];

function shouldHide(entry: any) {
    const id = entry.content?.id;
    const flags = id ? grokPosts.get(id) ?? 0 : 0;
    if (!flags || id === focalId()) return false;
    return !!((flags & BY_GROK && setting("hideGrokPosts")) || (flags & MENTIONS_GROK && setting("hideGrokMentions")));
}

/** Pages where you're looking for Grok on purpose: @grok's profile, searches mentioning Grok. */
function exemptRoute() {
    const path = location.pathname.toLowerCase();
    if (path === `/${GROK_ACCOUNT}` || path.startsWith(`/${GROK_ACCOUNT}/`)) return true;
    return path.startsWith("/search") && /grok/i.test(new URLSearchParams(location.search).get("q") ?? "");
}

/*
 * Most Grok UI in X is gated behind server-sent feature switches
 * (responsive_web_grok_*, *_imagine_*, xchat_ask_grok_enabled, ...), all read
 * through one FeatureSwitches class. Answering `false` for those switches
 * makes X itself skip rendering the Grok buttons, menus, cards and prompts.
 */
const GROK_SWITCH = /grok|imagine/i;
/** Switches that must keep their value. */
const KEEP = new Set([
    // Enables the "Block modifications by Grok" media option this plugin turns on.
    "responsive_web_grok_media_block_edit_enabled",
]);
/** Inverted switches (true = Grok feature off) are left alone. */
const INVERTED = /disable|hide|holdback|block/i;
const TRANSLATION = /translat/i;

// Registered at load (not in start) because X reads switches from its very
// first render; the resolver checks the plugin's settings itself.
addSwitchResolver((name, result) => {
    if (!result || result.value !== true || !setting("hideGrok")) return result;
    if (!GROK_SWITCH.test(name) || KEEP.has(name) || INVERTED.test(name)) return result;
    if (TRANSLATION.test(name) && !setting("hideTranslations")) return result;
    return withValue(result, false);
});

/* ------------------------------ Grok requests ------------------------------ */

// Background requests X makes for Grok even with its UI hidden: account
// tokens, subscription status and grok.com checkout sessions.
const GROK_HOST = /(^|\.)(grok\.com|x\.ai)$/;
const GROK_GRAPHQL = /\/graphql\/[^/]+\/grok\w*$/i;

export default definePlugin({
    name: NAME,
    description: "Removes Grok and Grok Imagine from X (sidebar, post buttons, floating button, edit-image buttons, prompts) and blocks Grok edits of the media you post by default.",
    authors: ["VibeX"],
    settings: {
        hideGrok: {
            type: "boolean",
            description: "Remove Grok and Grok Imagine everywhere in X",
            default: true,
            restartNeeded: true,
        },
        hideTranslations: {
            type: "boolean",
            description: "Also remove Grok-powered translations (\"Translated by Grok\")",
            default: true,
            restartNeeded: true,
            disabled: s => !s.hideGrok,
        },
        blockGrokRequests: {
            type: "boolean",
            description: "Block X's background requests to Grok (account tokens, subscription and checkout calls)",
            default: true,
        },
        blockEditsByDefault: {
            type: "boolean",
            description: "Turn on \"Block modifications by Grok\" for every image and video you attach",
            default: true,
        },
        hideGrokPosts: {
            type: "boolean",
            section: "Posts",
            description: "Hide posts by @grok, and retweets or quotes of them",
            default: true,
        },
        hideGrokMentions: {
            type: "boolean",
            section: "Posts",
            description: "Hide posts that mention or reply to @grok",
            default: true,
        },
    },
    startEarly: true,
    patches: [
        {
            // X's timeline entry pipeline (also used by SponsorBegone): filter the
            // whole incoming batch up front, so filterBatch can see when nothing
            // would be left (see its comment).
            find: "shouldCountTowardsAdSpacing",
            replacement: {
                match: /=>\{let ([\w$]+)=-1,([\w$]+)=null,([\w$]+)=0,([\w$]+)=\[\];return\{entries:([\w$]+)\(([\w$]+),/,
                replace: "=>{$6=$self.filterBatch($6);let $1=-1,$2=null,$3=0,$4=[];return{entries:$5($6,",
            },
        },
        {
            // Floating Grok drawer (bottom right): not switch-gated. Its container
            // renders the expanded drawer, the collapsed button, or null.
            find: 'id:"GrokDrawer"',
            replacement: {
                match: /\)\?\(0,([\w$]+)\.jsx\)\(([\w$]+),\{\.\.\.([\w$]+)\}\):([\w$]+)===([\w$]+)\.v\.COLLAPSED\?/,
                replace: ")&&!$self.hideDrawer()?(0,$1.jsx)($2,{...$3}):!$self.hideDrawer()&&$4===$5.v.COLLAPSED?",
            },
        },
        {
            // Media editor toggle + attachment badge: a missing value means "blocked".
            find: "grokActions?.blockGrokEdit",
            all: true,
            replacement: [
                { match: /!!([\w$.?[\]]+)\.grokActions\?\.blockGrokEdit/g, replace: "$self.blocked($1.grokActions)" },
                { match: /([\w$.?[\]]+)\.grokActions\?\.blockGrokEdit\?\?!1/g, replace: "$self.blocked($1.grokActions)" },
            ],
        },
        {
            // Post builder: sends grok_actions with the media metadata only when
            // grokActions is set, so default it for media the user didn't touch.
            find: "block_grok_edit:",
            replacement: {
                match: /([\w$]+)=([\w$]+)\?\.mediaMetadata\?\.grokActions,/,
                replace: "$1=$self.grokActions($2?.mediaMetadata?.grokActions),",
            },
        },
    ],

    hideDrawer: () => setting("hideGrok"),

    stats: {
        postsHidden: 0,
        get postsClassified() { return grokPosts.size; },
    },

    /**
     * Removes Grok posts from a batch of timeline entries (top-level posts and
     * posts inside modules such as reply threads).
     *
     * If that would leave a batch that had posts with none at all, the batch is
     * returned unfiltered: X treats an empty batch as "load more" and keeps
     * fetching, which on a Grok-heavy timeline would loop through requests.
     */
    filterBatch(entries: any[]) {
        if (!Array.isArray(entries) || exemptRoute()) return entries;
        if (!setting("hideGrokPosts") && !setting("hideGrokMentions")) return entries;

        let hadPosts = false, keptPosts = false, removed = 0;
        const out: any[] = [];
        for (const entry of entries) {
            if (entry?.type === "tweet") {
                hadPosts = true;
                if (shouldHide(entry)) { removed++; continue; }
                keptPosts = true;
                out.push(entry);
            } else if (entry?.type === "timelineModule" && Array.isArray(entry.content?.items)) {
                const all: any[] = entry.content.items;
                const items = all.filter(item => !(item?.type === "tweet" && shouldHide(item)));
                const hasPosts = all.some(item => item?.type === "tweet");
                hadPosts ||= hasPosts;
                keptPosts ||= items.some(item => item?.type === "tweet");
                removed += all.length - items.length;
                if (hasPosts && !items.some(item => item?.type === "tweet")) continue;
                out.push(items.length === all.length ? entry : { ...entry, content: { ...entry.content, items } });
            } else {
                out.push(entry);
            }
        }
        if (!removed || (hadPosts && !keptPosts)) return entries;
        (this.stats as { postsHidden: number }).postsHidden += removed;
        return out;
    },

    /** Feeds a GraphQL response through the classifier (also used for testing). */
    ingest(json: unknown) {
        scan(json);
    },

    start(this: { ingest(json: unknown): void }, { onStop }) {
        onStop(addInterceptor(({ url }) => {
            if (!setting("blockGrokRequests")) return;
            if (GROK_HOST.test(url.hostname)) return { block: true, respond: "{}" };
            // X's own API: answer Grok GraphQL queries with an empty result it can parse.
            if (/(^|\.)(x|twitter)\.com$/.test(url.hostname) && GROK_GRAPHQL.test(apiPath(url))) {
                return { block: true, respond: '{"data":{}}' };
            }
        }));
        // Starts at document-start, so the observer sees X's very first API
        // responses. It runs before X's own load handler, so posts are
        // classified by the time they reach the timeline pipeline.
        onStop(addResponseObserver(res => {
            if (res.status !== 200 || !res.url.pathname.includes("/graphql/")) return;
            if (!setting("hideGrokPosts") && !setting("hideGrokMentions")) return;
            this.ingest(res.json());
        }));
    },

    blocked(grokActions: { blockGrokEdit?: boolean } | undefined): boolean {
        return grokActions?.blockGrokEdit ?? setting("blockEditsByDefault");
    },

    grokActions(grokActions: { blockGrokEdit?: boolean } | undefined) {
        if (grokActions || !setting("blockEditsByDefault")) return grokActions;
        return { blockGrokEdit: true };
    },
});

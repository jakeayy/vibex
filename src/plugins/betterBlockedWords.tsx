import { useState, useSyncExternalStore } from "@vibex/react";
import { findByProps } from "../webpack";
import { getStore } from "../webpack/common";
import { addResponseObserver } from "../utils/network";
import { Logger } from "../utils/logger";
import { getPluginSetting, isEnabled } from "./manager";
import { Button, Description, InfoRow, Text } from "./settings/components";
import { definePlugin, type CustomSettingApi } from "./types";
import { css } from "../utils/css";

const NAME = "BetterBlockedWords";
const logger = new Logger(NAME);
const setting = (key: string) => getPluginSetting(NAME, key);

type Action = "hide" | "block";

interface Rule {
    pattern: string;
    regex: boolean;
    action: Action;
}

/* ------------------------------ X's muted words ----------------------------- */

interface MutedKeyword {
    keyword: string;
    valid_until?: string | null;
    mute_options?: string[];
}

const NATIVE_KEY = "vibex:BetterBlockedWords:native";
const REFRESH_EVERY = 10 * 60_000;

/** Last known copy of your muted words, so posts can be filtered from X's first request. */
let nativeWords: MutedKeyword[] = (() => {
    try { return JSON.parse(localStorage.getItem(NATIVE_KEY) ?? "[]"); } catch { return []; }
})();
let lastRefresh = 0;
let refreshing = false;

function setNativeWords(list: unknown) {
    if (!Array.isArray(list)) return;
    nativeWords = list.filter(k => typeof k?.keyword === "string");
    lastRefresh = Date.now();
    compiled = null;
    try { localStorage.setItem(NATIVE_KEY, JSON.stringify(nativeWords)); } catch { /* storage full */ }
    notifyStats();
}

/** X's API client, from the extra argument of its Redux thunks. */
function apiClient(): { get(path: string, params: object, opts: object): Promise<any> } | undefined {
    try {
        return (getStore()?.dispatch(((_d: unknown, _g: unknown, extra: any) => extra) as any) as any)?.api?.apiClient;
    } catch { return undefined; }
}

/** Same read-only request X's "Muted words" page makes. */
async function refreshNativeWords(force = false) {
    if (refreshing || (!force && Date.now() - lastRefresh < REFRESH_EVERY)) return;
    const client = apiClient();
    if (!client) return;
    refreshing = true;
    try {
        setNativeWords((await client.get("mutes/keywords/list", {}, {}))?.muted_keywords);
    } catch (e) {
        logger.warn("Couldn't load your muted words", e);
        lastRefresh = Date.now();
    } finally {
        refreshing = false;
    }
}

/* ---------------------------------- rules ----------------------------------- */

interface Matcher {
    re: RegExp;
    label: string;
    action: Action;
    /** X's "Only from people you don't follow" option. */
    skipFollowing: boolean;
}

/** Whole-word, case-insensitive match, like X's muted words. */
function phraseRegex(phrase: string) {
    const escaped = phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "iu");
}

/** `/source/flags`, or a bare pattern matched case-insensitively. */
export function parseRegex(pattern: string): RegExp {
    const m = pattern.match(/^\/(.+)\/([a-z]*)$/s);
    return m ? new RegExp(m[1], m[2]) : new RegExp(pattern, "iu");
}

let compiled: Matcher[] | null = null;
let compiledFrom: unknown[] = [];

function matchers(): Matcher[] {
    const rules = (setting("rules") as Rule[] | undefined) ?? [];
    const sources = [rules, setting("useNative"), setting("nativeAction"), setting("skipFollowing")];
    if (compiled && sources.every((s, i) => s === compiledFrom[i])) return compiled;

    const out: Matcher[] = [];
    if (setting("useNative")) {
        const now = Date.now();
        for (const k of nativeWords) {
            if (k.valid_until && Number(k.valid_until) < now) continue; // expired mute
            if (!k.keyword.trim()) continue;
            out.push({
                re: phraseRegex(k.keyword),
                label: k.keyword,
                action: setting("nativeAction") === "block" ? "block" : "hide",
                skipFollowing: !!k.mute_options?.includes("exclude_following_accounts"),
            });
        }
    }
    for (const rule of rules) {
        if (!rule?.pattern?.trim()) continue;
        try {
            out.push({
                re: rule.regex ? parseRegex(rule.pattern) : phraseRegex(rule.pattern),
                label: rule.regex ? `/${rule.pattern.replace(/^\/(.+)\/[a-z]*$/s, "$1")}/` : rule.pattern,
                action: rule.action === "block" ? "block" : "hide",
                skipFollowing: !!setting("skipFollowing"),
            });
        } catch (e) {
            logger.warn(`Skipping invalid regex ${rule.pattern}`, e);
        }
    }
    compiledFrom = sources;
    return (compiled = out);
}

/* ---------------------------------- posts ----------------------------------- */

interface Post {
    id: string;
    text: string;
    author?: { id: string; screenName: string; following: boolean; blocking: boolean };
    /** The retweeted and quoted posts, checked too. */
    inner: Post[];
}

const MAX_POSTS = 5000;
/** Post id -> text and author, filled from X's GraphQL responses. */
const posts = new Map<string, Post>();

function readPost(result: any, depth = 0): Post | undefined {
    if (!result || depth > 3) return;
    if (result.__typename === "TweetWithVisibilityResults") result = result.tweet;
    const legacy = result?.legacy;
    if (!legacy || typeof result.rest_id !== "string") return;

    const user = result.core?.user_results?.result;
    const rel = user?.relationship_perspectives ?? {};
    const urls = (legacy.entities?.urls ?? []).map((u: any) => u?.expanded_url).filter(Boolean);
    const post: Post = {
        id: result.rest_id,
        // Long posts carry their full text separately; expanded links stand in for t.co ones.
        text: [result.note_tweet?.note_tweet_results?.result?.text ?? legacy.full_text ?? "", ...urls].join(" "),
        author: user?.rest_id ? {
            id: user.rest_id,
            screenName: user.core?.screen_name ?? user.legacy?.screen_name ?? "",
            following: !!(rel.following ?? user.legacy?.following),
            blocking: !!(rel.blocking ?? user.legacy?.blocking),
        } : undefined,
        inner: [],
    };
    for (const inner of [legacy.retweeted_status_result?.result, result.quoted_status_result?.result]) {
        const p = readPost(inner, depth + 1);
        if (p) post.inner.push(p);
    }
    if (posts.size >= MAX_POSTS) posts.delete(posts.keys().next().value!);
    posts.set(post.id, post);
    return post;
}

function scan(node: unknown, depth = 0) {
    if (!node || typeof node !== "object" || depth > 60) return;
    if (Array.isArray(node)) {
        for (const item of node) scan(item, depth + 1);
        return;
    }
    const o = node as Record<string, any>;
    if (o.tweet_results?.result) readPost(o.tweet_results.result);
    for (const k in o) scan(o[k], depth + 1);
}

/*
 * X also shows posts it never fetched in this page load: the home timeline is
 * restored from X's saved copy of the last session. Those only exist in X's
 * Redux entities, so posts are looked up there too. The pipeline runs inside
 * a reducer, where getState() throws, so the last state seen is kept.
 */
let lastState: any;
let subscribed = false;

/** Subscribes once X's store exists; must not run inside a reducer. */
function watchStore() {
    if (subscribed) return true;
    const root = document.getElementById("react-root");
    if (!root || !Object.keys(root).some(k => k.startsWith("__reactContainer$"))) return false;
    const store = getStore();
    if (!store) return false;
    try {
        store.subscribe(() => { try { lastState = store.getState(); } catch { /* mid-dispatch */ } });
        lastState = store.getState();
        subscribed = true;
    } catch { /* called mid-dispatch; retried later */ }
    return subscribed;
}

function xState() {
    if (!subscribed) return lastState;
    try { return (lastState = getStore()!.getState()); } catch { return lastState; }
}

function postFromEntities(id: string, state: any, depth = 0): Post | undefined {
    const tweet = state?.entities?.tweets?.entities?.[id];
    if (!tweet || depth > 3) return;
    const user = state.entities.users?.entities?.[tweet.user];
    const urls = (tweet.entities?.urls ?? []).map((u: any) => u?.expanded_url).filter(Boolean);
    return {
        id,
        text: [tweet.note_tweet?.text ?? tweet.full_text ?? "", ...urls].join(" "),
        author: user ? { id: user.id_str, screenName: user.screen_name ?? "", following: !!user.following, blocking: !!user.blocking } : undefined,
        inner: [tweet.retweeted_status, tweet.quoted_status]
            .map(inner => typeof inner === "string" ? postFromEntities(inner, state, depth + 1) : undefined)
            .filter((p): p is Post => !!p),
    };
}

const findPost = (id: string) => posts.get(id) ?? postFromEntities(id, xState());

const viewerId = () => xState()?.session?.user_id as string | undefined;

/** Id of the post opened at /<user>/status/<id>; never hidden, or its page would be empty. */
const focalId = () => location.pathname.match(/\/status\/(\d+)/)?.[1];

interface Hit {
    matcher: Matcher;
    /** The post that contains the phrase: the retweeted or quoted one, if that's where it is. */
    post: Post;
}

function check(post: Post, self = viewerId()): Hit | undefined {
    const authorOk = !post.author || post.author.id !== self;
    if (authorOk) {
        for (const matcher of matchers()) {
            if (matcher.skipFollowing && post.author?.following) continue;
            if (matcher.re.test(post.text)) return { matcher, post };
        }
    }
    for (const inner of post.inner) {
        const hit = check(inner, self);
        if (hit) return hit;
    }
}

/* ------------------------------ blocking queue ------------------------------ */

const BLOCK_INTERVAL = 3000;
/** Safety cap per page load, so a broad rule can't mass-block accounts. */
const MAX_BLOCKS_PER_LOAD = 50;

const queued = new Set<string>();
const queue: { id: string; screenName: string; phrase: string }[] = [];
let blocksThisLoad = 0;
let capWarned = false;
let timer: ReturnType<typeof setTimeout> | undefined;

function enqueueBlock(post: Post, phrase: string) {
    const a = post.author;
    if (!a || a.following || a.blocking || a.id === viewerId() || queued.has(a.id)) return;
    if (blocksThisLoad + queue.length >= MAX_BLOCKS_PER_LOAD) {
        if (!capWarned) logger.warn(`Reached ${MAX_BLOCKS_PER_LOAD} blocks for this page load; only hiding from now on`);
        capWarned = true;
        return;
    }
    queued.add(a.id);
    queue.push({ id: a.id, screenName: a.screenName, phrase });
    notifyStats();
    timer ??= setTimeout(drainQueue, 0);
}

/** X's Users entity module: its `block` action calls the API and updates X's own state. */
let users: any;

async function drainQueue() {
    const next = queue.shift();
    if (!next || !isEnabled(NAME)) {
        timer = undefined;
        return;
    }
    users ??= findByProps("block", "unblock", "selectLoggedInUser", "fetchOneByScreenName");
    const store = getStore();
    try {
        if (!users || !store) throw new Error("X's Users module or store not found");
        const known = users.select?.(store.getState(), next.id);
        if (!known?.blocking && !known?.following) {
            await store.dispatch(users.block(next.id));
            blocksThisLoad++;
            recordBlock(next);
            logger.info(`Blocked @${next.screenName} for "${next.phrase}"`);
        }
    } catch (e) {
        logger.error(`Couldn't block @${next.screenName}`, e);
    }
    notifyStats();
    timer = setTimeout(drainQueue, BLOCK_INTERVAL);
}

/* ---------------------------------- stats ----------------------------------- */

interface Stats {
    postsHidden: number;
    usersBlocked: number;
    recent: { screenName: string; phrase: string; at: number }[];
}

const STATS_KEY = "vibex:BetterBlockedWords:stats";
const RECENT = 20;

let stats: Stats = (() => {
    try { return { postsHidden: 0, usersBlocked: 0, recent: [], ...JSON.parse(localStorage.getItem(STATS_KEY) ?? "{}") }; }
    catch { return { postsHidden: 0, usersBlocked: 0, recent: [] }; }
})();
/** Posts already counted, so a post that renders again isn't counted twice. */
const counted = new Set<string>();
const statListeners = new Set<() => void>();
let statsVersion = 0;

function notifyStats() {
    statsVersion++;
    statListeners.forEach(fn => fn());
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function saveStats() {
    stats = { ...stats };
    notifyStats();
    saveTimer ??= setTimeout(() => {
        saveTimer = undefined;
        try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch { /* storage full */ }
    }, 1000);
}

function recordHidden(id: string) {
    if (counted.has(id)) return;
    counted.add(id);
    stats.postsHidden++;
    saveStats();
}

function recordBlock({ screenName, phrase }: { screenName: string; phrase: string }) {
    stats.usersBlocked++;
    stats.recent = [{ screenName, phrase, at: Date.now() }, ...stats.recent].slice(0, RECENT);
    saveStats();
}

const subscribeStats = (fn: () => void) => { statListeners.add(fn); return () => statListeners.delete(fn); };

function StatsPanel() {
    useSyncExternalStore(subscribeStats, () => statsVersion);
    const now = Date.now();
    const active = nativeWords.filter(k => k.keyword.trim() && !(k.valid_until && Number(k.valid_until) < now)).length;
    return <>
        <h3 className="vx-subhead">Activity</h3>
        <InfoRow label="Posts hidden" value={stats.postsHidden.toLocaleString()} />
        <InfoRow label="Users blocked" value={stats.usersBlocked.toLocaleString()} />
        {queue.length > 0 && <InfoRow label="Waiting to be blocked" value={String(queue.length)} />}
        <InfoRow label="Muted words from X" value={setting("useNative") ? `${active} active` : "Not used"} />
        {stats.recent.length > 0 && <>
            <div className="vx-field"><label>Recently blocked</label></div>
            {stats.recent.map(r => (
                <div key={`${r.screenName}-${r.at}`} className="vx-bbw-recent">
                    <Text link={`/${r.screenName}`} color="primary">{`@${r.screenName}`}</Text>
                    <span className="vx-value">{`"${r.phrase}" · ${new Date(r.at).toLocaleString()}`}</span>
                </div>
            ))}
        </>}
        <div className="vx-buttons">
            <Button onClick={() => refreshNativeWords(true)}>Reload muted words</Button>
            {(stats.postsHidden > 0 || stats.usersBlocked > 0) && <Button kind="danger" onClick={() => {
                if (!confirm("Reset the counters? Nobody gets unblocked.")) return;
                stats = { postsHidden: 0, usersBlocked: 0, recent: [] };
                counted.clear();
                saveStats();
            }}>Reset counters</Button>}
        </div>
    </>;
}

/* ------------------------------- rules editor ------------------------------- */

const ACTIONS: { label: string; value: Action }[] = [
    { label: "Hide posts", value: "hide" },
    { label: "Block the author", value: "block" },
];

function ruleError(rule: Rule) {
    if (!rule.pattern.trim()) return "Enter a word or phrase";
    if (!rule.regex) return;
    try { parseRegex(rule.pattern); } catch (e) { return (e as Error).message; }
}

function RuleList({ value, set }: CustomSettingApi<Rule[]>) {
    const rules = value ?? [];
    const [draft, setDraft] = useState<Rule>({ pattern: "", regex: false, action: "hide" });
    const [error, setError] = useState<string>();
    const update = (i: number, patch: Partial<Rule>) => set(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));

    const add = () => {
        const err = ruleError(draft);
        if (err) return setError(err);
        set([...rules, { ...draft, pattern: draft.pattern.trim() }]);
        setDraft({ ...draft, pattern: "" });
        setError(undefined);
    };

    return <>
        <Description>
            {"Your own phrases, on top of X's muted words. A phrase matches whole words, ignoring case. A regex matches anywhere and ignores case unless written as /pattern/flags."}
        </Description>
        {rules.map((rule, i) => (
            <div key={i} className="vx-field vx-bbw-rule">
                <span className="vx-mono">{rule.regex ? rule.pattern : `"${rule.pattern}"`}</span>
                {ruleError(rule) && <span className="vx-tag vx-warn">Invalid</span>}
                <label className="vx-bbw-check">
                    <input type="checkbox" checked={rule.regex} onChange={e => update(i, { regex: e.currentTarget.checked })} />
                    Regex
                </label>
                <select className="vx-select" value={rule.action} aria-label="Action"
                    onChange={e => update(i, { action: e.currentTarget.value as Action })}>
                    {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
                <button type="button" className="vx-btn vx-danger" onClick={() => set(rules.filter((_, j) => j !== i))}>Remove</button>
            </div>
        ))}
        {!rules.length && <div className="vx-empty">No phrases yet.</div>}
        <div className="vx-field vx-bbw-rule">
            <input className="vx-input" placeholder={draft.regex ? "Regex, e.g. crypto\\s*giveaway" : "Word or phrase"} value={draft.pattern}
                onChange={e => { setDraft({ ...draft, pattern: e.currentTarget.value }); setError(undefined); }}
                onKeyDown={e => { if (e.key === "Enter") add(); }} />
            <label className="vx-bbw-check">
                <input type="checkbox" checked={draft.regex} onChange={e => setDraft({ ...draft, regex: e.currentTarget.checked })} />
                Regex
            </label>
            <select className="vx-select" value={draft.action} aria-label="Action"
                onChange={e => setDraft({ ...draft, action: e.currentTarget.value as Action })}>
                {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
            <button type="button" className="vx-btn vx-primary" onClick={add}>Add</button>
        </div>
        {error && <div className="vx-empty" style={{ color: "rgb(244, 33, 46)" }}>{error}</div>}
    </>;
}

/** Hides (and maybe blocks) a post if any rule matches; returns whether to drop it. */
/** Posts the pipeline saw before their text was known; rechecked after X's update. */
const pending = new Set<string>();
let recheckQueued = false;

/** Matching rule for a timeline entry, if any. */
function hitFor(entry: any): Hit | undefined {
    const id = entry?.content?.id;
    if (!id || id === focalId()) return;
    const post = findPost(id);
    if (!post) {
        pending.add(id);
        // A microtask runs once X's update is done but before the browser paints.
        if (!recheckQueued) { recheckQueued = true; queueMicrotask(recheck); }
        return;
    }
    return check(post);
}

function apply(id: string, hit: Hit) {
    recordHidden(id);
    if (hit.matcher.action === "block") enqueueBlock(hit.post, hit.matcher.label);
}

const tweetIds = (entries: any[]): string[] => entries.flatMap(e =>
    e?.type === "tweet" ? [e.content?.id]
        : e?.type === "timelineModule" ? (e.content?.items ?? []).filter((i: any) => i?.type === "tweet").map((i: any) => i.content?.id)
            : []).filter(Boolean);

/**
 * Second pass for posts whose text wasn't known yet: X restores the home
 * timeline together with its posts in one update, so they can only be read
 * once it's done. Matches are removed with X's own REMOVE_TWEETS action.
 */
function recheck() {
    recheckQueued = false;
    const ids = [...pending];
    pending.clear();
    const store = getStore();
    const timelines = xState()?.urt;
    if (!store || !timelines || !isEnabled(NAME)) return;

    for (const [timelineId, timeline] of Object.entries<any>(timelines)) {
        const present = tweetIds(timeline?.entries ?? []);
        const remove: Record<string, true> = {};
        const hits: [string, Hit][] = [];
        for (const id of ids) {
            if (!present.includes(id)) continue;
            const post = findPost(id);
            const hit = post && id !== focalId() ? check(post) : undefined;
            if (hit) { remove[id] = true; hits.push([id, hit]); }
        }
        // Never empty a timeline (see filterEntries).
        if (!hits.length || present.every(id => remove[id])) continue;
        hits.forEach(([id, hit]) => apply(id, hit));
        store.dispatch({ type: "rweb/urt/REMOVE_TWEETS", meta: { timelineId }, payload: remove });
    }
}

/**
 * Removes matching posts from a batch of timeline entries (top-level posts
 * and posts inside modules such as reply threads).
 *
 * If that would leave a batch that had posts with none at all, the batch is
 * returned unfiltered: X treats an empty batch as "load more" and keeps
 * fetching, which could loop through requests.
 */
function filterEntries(entries: any[]) {
    if (!Array.isArray(entries) || !isEnabled(NAME)) return entries;
    // Runs inside X's reducer, where dispatching (to reach the API client) throws.
    setTimeout(refreshNativeWords);
    if (!matchers().length) return entries;

    let hadPosts = false, keptPosts = false;
    const hits: [string, Hit][] = [];
    const drop = (entry: any) => {
        const hit = hitFor(entry);
        if (hit) hits.push([entry.content.id, hit]);
        return !!hit;
    };
    const out: any[] = [];
    for (const entry of entries) {
        if (entry?.type === "tweet") {
            hadPosts = true;
            if (drop(entry)) continue;
            keptPosts = true;
            out.push(entry);
        } else if (entry?.type === "timelineModule" && Array.isArray(entry.content?.items)) {
            const all: any[] = entry.content.items;
            const items = all.filter(item => !(item?.type === "tweet" && drop(item)));
            const hasPosts = all.some(item => item?.type === "tweet");
            hadPosts ||= hasPosts;
            keptPosts ||= items.some(item => item?.type === "tweet");
            if (hasPosts && !items.some(item => item?.type === "tweet")) continue;
            out.push(items.length === all.length ? entry : { ...entry, content: { ...entry.content, items } });
        } else {
            out.push(entry);
        }
    }
    if (!hits.length || (hadPosts && !keptPosts)) return entries;
    hits.forEach(([id, hit]) => apply(id, hit));
    return out;
}

/* ---------------------------------- plugin ---------------------------------- */

export default definePlugin({
    name: NAME,
    description: "Hides or blocks posts that contain your muted words, plus your own phrases and regexes, each with its own action.",
    authors: ["VibeX"],
    startEarly: true,
    css: css`.vx-bbw-rule { grid-template-columns: 1fr auto auto auto; align-items: center; border-top: 1px solid var(--vx-border); }
.vx-bbw-rule .vx-select { width: auto; }
.vx-bbw-check { display: flex; gap: 6px; align-items: center; white-space: nowrap; }
.vx-bbw-recent { display: flex; justify-content: space-between; gap: 12px; padding: 4px 16px; }
.vx-mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 13px !important; overflow-wrap: anywhere; }`,
    settingsPanel: StatsPanel,
    settings: {
        useNative: {
            type: "boolean",
            section: "X's muted words",
            description: "Act on the words you muted in X's settings (Privacy and safety → Mute and block → Muted words)",
            default: true,
        },
        nativeAction: {
            type: "select",
            section: "X's muted words",
            description: "What to do with posts that contain them",
            default: "hide",
            options: ACTIONS,
            disabled: s => !s.useNative,
        },
        rules: {
            type: "custom",
            section: "Your phrases",
            description: "Phrases",
            default: [] as Rule[],
            component: RuleList,
        },
        skipFollowing: {
            type: "boolean",
            section: "Your phrases",
            description: "Ignore posts from people you follow",
            default: true,
        },
    },
    patches: [
        {
            // X's timeline entry pipeline (also patched by SponsorBegone and
            // NoGrok, which this match leaves intact): filter each incoming batch.
            find: "shouldCountTowardsAdSpacing",
            replacement: {
                match: /let ([\w$]+)=-1,([\w$]+)=null,([\w$]+)=0,([\w$]+)=\[\];return\{entries:([\w$]+)\(([\w$]+),/,
                replace: "$6=$self.filterBatch($6);let $1=-1,$2=null,$3=0,$4=[];return{entries:$5($6,",
            },
        },
    ],

    filterBatch(entries: any[]) {
        // Runs inside X's timeline reducer: an exception here would break the timeline.
        try {
            return filterEntries(entries);
        } catch (e) {
            logger.error("Filtering failed", e);
            return entries;
        }
    },

    /** Feeds a GraphQL response through the post index (also used for testing). */
    ingest(json: unknown) {
        scan(json);
    },

    start(this: { ingest(json: unknown): void }, { onStop }) {
        // Starts at document-start, so the observer sees X's very first API
        // responses, before they reach the timeline pipeline.
        onStop(addResponseObserver(res => {
            if (res.status !== 200) return;
            const path = res.url.pathname;
            if (path.includes("/graphql/")) this.ingest(res.json());
            else if (path.endsWith("/mutes/keywords/list.json")) setNativeWords((res.json() as any)?.muted_keywords);
            // You changed your muted words: fetch the new list.
            else if (/\/mutes\/keywords\/(create|destroy|update)\.json$/.test(path)) setTimeout(() => refreshNativeWords(true), 500);
        }));
        // X's store appears with its first render; watch it from then on.
        const poll = setInterval(() => { if (watchStore()) clearInterval(poll); }, 50);
        onStop(() => {
            clearInterval(poll);
            queue.length = 0;
            queued.clear();
        });
    },
});

import { getPluginSetting } from "./manager";
import { definePlugin } from "./types";
import { css } from "../utils/css";

const NAME = "OldTwitterBranding";
const setting = (key: string) => !!getPluginSetting(NAME, key);

const X_LOGO = "M21.742 21.75l-7.563-11.179 7.056-8.321h-2.456l-5.691 6.714-4.54-6.714H2.359l7.29 10.776L2.25 21.75h2.456l6.035-7.118 4.818 7.118h6.191-.008zM7.739 3.818L18.81 20.182h-2.447L5.29 3.818h2.447z";
const BIRD_LOGO = "M23.643 4.937c-.835.37-1.732.62-2.675.733.962-.576 1.7-1.49 2.048-2.578-.9.534-1.897.922-2.958 1.13-.85-.904-2.06-1.47-3.4-1.47-2.572 0-4.658 2.086-4.658 4.66 0 .364.042.718.12 1.06-3.873-.195-7.304-2.05-9.602-4.868-.4.69-.63 1.49-.63 2.342 0 1.616.823 3.043 2.072 3.878-.764-.025-1.482-.234-2.11-.583v.06c0 2.257 1.605 4.14 3.737 4.568-.392.106-.803.162-1.227.162-.3 0-.593-.028-.877-.082.593 1.850 2.313 3.198 4.352 3.234-1.595 1.250-3.604 1.995-5.786 1.995-.376 0-.747-.022-1.112-.065 2.062 1.323 4.510 2.093 7.140 2.093 8.570 0 13.255-7.098 13.255-13.254 0-.2-.005-.402-.014-.602.910-.658 1.700-1.477 2.323-2.410z";

const X_BLUE = /#1D9BF0/gi;
const X_BLUE_RGB = /(rgba?\(\s*)29(\s*,\s*)155(\s*,\s*)240/g;
const TWITTER_BLUE = "#1DA1F2";

/* ------------------------------- text rewrite ------------------------------- */

// Applied to X's English string catalog. Order matters: "X Corp." before "X".
const TEXT_RULES: [RegExp, string | ((...m: string[]) => string)][] = [
    [/\bX Corp\./g, "Twitter, Inc."],
    [/\bRepost(s|ed|ing)?\b/g, (_, s = "") => `Retweet${s}`],
    [/\brepost(s|ed|ing)?\b/g, (_, s = "") => `retweet${s}`],
    [/\bPost(s|ed|ing)?\b/g, (_, s = "") => `Tweet${s}`],
    [/\bpost(s|ed|ing)?\b/g, (_, s = "") => `tweet${s}`],
    // "X" as a word: "on X", "X Rules", the logo's label, the " / X" title suffix.
    [/(^|[\s(“"'/])X(?=$|[\s.,!?:;’'”")])/g, "$1Twitter"],
];

const rename = (text: string) => TEXT_RULES.reduce((v, [re, to]) => v.replace(re, to as any), text);

/**
 * Rewrites the string literals in a catalog module's source. Literals are
 * tokenized left to right (so an apostrophe inside "Don't" can't pair up
 * with a later quote), code between them is left alone, literals used as
 * object keys are skipped (they're lookup keys), and `${}` expressions inside
 * template literals are kept as-is.
 */
function renameCatalog(source: string) {
    return source.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, (lit, offset: number) => {
        if (/^\s*:/.test(source.slice(offset + lit.length, offset + lit.length + 8))) return lit;
        const q = lit[0], inner = lit.slice(1, -1);
        if (q !== "`") return q + rename(inner) + q;
        return q + inner.split(/(\$\{[^}]*\})/).map(part => (part.startsWith("${") ? part : rename(part))).join("") + q;
    });
}

/** Decodes the body of a single-quoted JS string literal. */
function unescapeJs(body: string) {
    const simple: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", 0: "\0" };
    return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r\n|[\s\S])/g, (_, e: string) => {
        if (e[0] === "u") return String.fromCodePoint(parseInt(e[1] === "{" ? e.slice(2, -1) : e.slice(1), 16));
        if (e[0] === "x") return String.fromCharCode(parseInt(e.slice(1), 16));
        if (e === "\n" || e === "\r\n") return "";
        return simple[e] ?? e;
    });
}

/**
 * Rewrites the values of a `JSON.parse('{"source text":"translation"}')` catalog.
 * Parsed properly instead of by regex: keys are lookup keys and must survive
 * untouched, and the JSON contains escaped quotes that trip up pattern matching.
 */
function renameJsonCatalog(source: string) {
    return source.replace(/JSON\.parse\('((?:[^'\\]|\\[\s\S])*)'\)/, (m, body: string) => {
        try {
            const map = JSON.parse(unescapeJs(body)) as Record<string, unknown>;
            for (const k in map) if (typeof map[k] === "string") map[k] = rename(map[k] as string);
            return `JSON.parse(${JSON.stringify(JSON.stringify(map))})`;
        } catch {
            return m;
        }
    });
}

/* ---------------------------------- plugin ---------------------------------- */

// Patch replacements run at page load, when X's modules are installed, and
// read the settings then. That's why every setting below needs a reload.
export default definePlugin({
    name: NAME,
    description: "Brings back the Twitter bird, the classic blue, blue Tweet buttons, and Tweet / Retweet / Twitter wording.",
    authors: ["VibeX"],
    settings: {
        birdLogo: {
            type: "boolean",
            description: "Bird logo and favicon instead of the X",
            default: true,
            restartNeeded: true,
        },
        blueLogo: {
            type: "boolean",
            description: "Color the sidebar bird Twitter blue",
            default: true,
        },
        classicBlue: {
            type: "boolean",
            description: "Classic Twitter blue (#1DA1F2) and blue Tweet buttons",
            default: true,
            restartNeeded: true,
        },
        twitterNames: {
            type: "boolean",
            description: "Say Tweet, Retweet and Twitter instead of Post, Repost and X",
            default: true,
            restartNeeded: true,
        },
    },
    patches: [
        {
            // The X logo icon component.
            find: X_LOGO,
            replacement: { match: X_LOGO, replace: () => (setting("birdLogo") ? BIRD_LOGO : X_LOGO) },
        },
        {
            // Document title + favicon manager: it swaps between twitter.3.ico and
            // twitter-pip.3.ico (unread dot). Version 2 of both is the bird.
            find: '"-pip.3.ico"',
            replacement: { match: /\.3(\\\\)?\.ico/g, replace: (m: string) => (setting("birdLogo") ? m.replace("3", "2") : m) },
        },
        {
            // Colour palettes and accent definitions that use X's blue (hex form)...
            find: /#1D9BF0/i,
            all: true,
            replacement: { match: X_BLUE, replace: (m: string) => (setting("classicBlue") ? TWITTER_BLUE : m) },
        },
        {
            // ...and rgb()/rgba() form.
            find: /rgba?\(\s*29\s*,\s*155\s*,\s*240/,
            all: true,
            replacement: {
                match: X_BLUE_RGB,
                replace: (m: string, a: string, b: string, c: string) => (setting("classicBlue") ? `${a}29${b}161${c}242` : m),
            },
        },
        {
            // Sidebar "Post" button: X's black/white style -> blue, like the old Tweet button.
            find: 'testID:"SideNav_NewTweet_Button"',
            replacement: {
                match: /(size:[\w$]+,testID:[\w$]+,type:)"primaryFilled"/,
                replace: (m: string, pre: string) => (setting("classicBlue") ? `${pre}"brandFilled"` : m),
            },
        },
        {
            // Composer "Post" / "Reply" button.
            find: '"tweetButtonInline"',
            replacement: {
                match: /(testID:[\w$]+\?"tweetButton":"tweetButtonInline",type:)"primaryFilled"/,
                replace: (m: string, pre: string) => (setting("classicBlue") ? `${pre}"brandFilled"` : m),
            },
        },
        {
            // X's English string catalog (one big list of o("key","text") calls).
            find: '._register("en",',
            replacement: {
                match: /^[\s\S]*$/,
                replace: (src: string) => (setting("twitterNames") ? renameCatalog(src) : src),
            },
        },
        {
            // Newer strings: a JSON map of "English source text": "translation".
            // Keys are lookup keys, so only values are rewritten.
            find: "{appStarRating}/5.0 stars",
            replacement: {
                match: /^[\s\S]*$/,
                replace: (src: string) => (setting("twitterNames") ? renameJsonCatalog(src) : src),
            },
        },
        {
            // English catalogs of X's newer sub-apps (Grok, payments, …): object
            // literals of "source text": "translation"; renameCatalog skips keys.
            find: '"Post on X":',
            replacement: { match: /^[\s\S]*$/, replace: (src: string) => (setting("twitterNames") ? renameCatalog(src) : src) },
        },
        {
            find: '"Monetize on X":',
            replacement: { match: /^[\s\S]*$/, replace: (src: string) => (setting("twitterNames") ? renameCatalog(src) : src) },
        },
        {
            // Sidebar footer copyright line.
            find: "X Corp.`",
            replacement: { match: "X Corp.`", replace: () => (setting("twitterNames") ? "Twitter, Inc.`" : "X Corp.`") },
        },
    ],

    start({ settings, addStyle, onStop }) {
        if (settings.blueLogo) {
            addStyle(css`header h1[role="heading"] a[href="/home"] svg { color: ${TWITTER_BLUE} !important; }`);
        }
        if (!settings.birdLogo) return;

        // The loading splash and the initial favicon come from X's HTML, not
        // its bundles, so they're swapped in the DOM.
        const swap = () => {
            document.querySelectorAll<SVGPathElement>(`path[d="${X_LOGO}"]`).forEach(p => p.setAttribute("d", BIRD_LOGO));
            const icon = document.querySelector<HTMLLinkElement>('link[rel="shortcut icon"]');
            if (icon && /\.3\.ico$/.test(icon.href)) icon.href = icon.href.replace(/\.3\.ico$/, ".2.ico");
        };
        swap();
        const mo = new MutationObserver(swap);
        mo.observe(document.documentElement, { childList: true, subtree: true });
        // The splash is gone a few seconds after load; the patched bundles handle the rest.
        const t = setTimeout(() => mo.disconnect(), 10_000);
        onStop(() => { mo.disconnect(); clearTimeout(t); });
    },
});

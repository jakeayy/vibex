// Builds VibeX for every target from the same source:
//   dist/vibex.user.js     userscript (Tampermonkey / Violentmonkey)
//   dist/chrome/           Chrome / Chromium extension (Manifest V3), + vibex-chrome.zip
//   dist/firefox/          Firefox extension (Manifest V3), + vibex-firefox.zip
//
//   node build.mjs [--watch] [--target=userscript,chrome,firefox]
import * as esbuild from "esbuild";
import { transform as transformCss } from "lightningcss";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const watch = process.argv.includes("--watch");
const only = process.argv.find(a => a.startsWith("--target="))?.slice(9).split(",");

const MATCHES = ["https://x.com/*", "https://twitter.com/*"];
const RULES_DIR = "src/extension/rules";

/* --------------------------------- CSS minify -------------------------------- */

// Browsers VibeX supports; lets Lightning CSS use modern syntax.
const CSS_TARGETS = { chrome: 111 << 16, firefox: 128 << 16, safari: 16 << 16 };

/** Parses a template literal starting right after its opening backtick. */
function readTemplate(src, start) {
    const quasis = [], exprs = [];
    let i = start, chunk = start;
    while (i < src.length) {
        const ch = src[i];
        if (ch === "\\") { i += 2; continue; }
        if (ch === "`") { quasis.push(src.slice(chunk, i)); return { quasis, exprs, end: i + 1 }; }
        if (ch === "$" && src[i + 1] === "{") {
            quasis.push(src.slice(chunk, i));
            let depth = 1, j = i + 2, quote = null;
            for (; j < src.length && depth; j++) {
                const c = src[j];
                if (quote) {
                    if (c === "\\") j++;
                    else if (c === quote) quote = null;
                } else if (c === "'" || c === '"' || c === "`") quote = c;
                else if (c === "{") depth++;
                else if (c === "}") depth--;
            }
            exprs.push(src.slice(i + 2, j - 1));
            i = chunk = j;
            continue;
        }
        i++;
    }
    throw new Error("Unterminated css template");
}

const placeholder = i => `__vxi${i}__`;
const escapeTemplate = s => s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

/** Minifies one css`...` template; returns the replacement source (an untagged template), or null to keep it. */
function minifyTemplate({ quasis, exprs }, file, stats) {
    // Lightning CSS may unquote a string around a placeholder, which would
    // break values with spaces: leave such templates alone.
    if (quasis.slice(0, -1).some(q => /["']$/.test(q))) {
        stats.skipped++;
        return null;
    }
    // Cook the raw template text (escapes such as \\201C) the way JS would.
    const raw = quasis.map((q, i) => q + (i < exprs.length ? placeholder(i) : "")).join("");
    const cooked = new Function(`return \`${raw}\`;`)();
    const { code, warnings } = transformCss({ filename: file, code: Buffer.from(cooked), minify: true, targets: CSS_TARGETS });
    for (const w of warnings) console.warn(`[css] ${path.relative(".", file)}: ${w.message}`);

    let out = escapeTemplate(code.toString());
    exprs.forEach((expr, i) => {
        if (out.split(placeholder(i)).length !== 2) throw new Error(`css interpolation #${i} was lost by the minifier`);
        out = out.replace(placeholder(i), () => `\${${expr}}`);
    });
    stats.templates++;
    stats.before += cooked.length;
    stats.after += out.length;
    return `\`${out}\``;
}

/** Minifies every css`...` tagged template in our sources and drops the tag. */
function minifyCssPlugin({ report }) {
    const stats = { templates: 0, before: 0, after: 0, skipped: 0 };
    return {
        name: "minify-css-templates",
        setup(build) {
            build.onStart(() => { Object.assign(stats, { templates: 0, before: 0, after: 0, skipped: 0 }); });
            build.onLoad({ filter: /[\\/]src[\\/].*\.tsx?$/ }, async ({ path: file }) => {
                const src = await readFile(file, "utf8");
                const loader = file.endsWith("x") ? "tsx" : "ts";
                if (!src.includes("css`")) return { contents: src, loader };

                let out = "", last = 0;
                for (const m of src.matchAll(/(?<![\w$.])css`/g)) {
                    if (m.index < last) continue;
                    const tpl = readTemplate(src, m.index + 4);
                    let replacement;
                    try {
                        replacement = minifyTemplate(tpl, file, stats);
                    } catch (e) {
                        const line = src.slice(0, m.index).split("\n").length;
                        return { errors: [{ text: `Invalid CSS: ${e.message}`, location: { file, line } }] };
                    }
                    if (replacement == null) continue;
                    out += src.slice(last, m.index) + replacement;
                    last = tpl.end;
                }
                return { contents: out + src.slice(last), loader };
            });
            build.onEnd(() => {
                if (!report || !stats.templates) return;
                const pct = Math.round((1 - stats.after / stats.before) * 100);
                console.log(`  css: ${stats.templates} templates minified, ${stats.before} → ${stats.after} bytes (-${pct}%)`
                    + (stats.skipped ? `, ${stats.skipped} left as-is` : ""));
            });
        },
    };
}

/* ---------------------------------- targets ---------------------------------- */

const userscriptHeader = `// ==UserScript==
// @name         VibeX
// @namespace    https://github.com/vibex
// @version      ${pkg.version}
// @description  ${pkg.description}
${MATCHES.map(m => `// @match        ${m}`).join("\n")}
// @run-at       document-start
// @noframes
// @grant        none
// @inject-into  page
// ==/UserScript==
`;

const rulesets = readdirSync(RULES_DIR).filter(f => f.endsWith(".json")).map(f => path.basename(f, ".json"));

/** Manifest V3, shared by both browsers; `browser` adds the differences. */
function manifest(browser) {
    const m = {
        manifest_version: 3,
        name: "VibeX",
        version: pkg.version,
        description: pkg.description,
        // VibeX itself runs in the page's own JS world, where X's webpack and
        // React live; the browser guarantees it starts before any page script.
        content_scripts: [
            { matches: MATCHES, js: ["vibex.js"], run_at: "document_start", world: "MAIN" },
            // Isolated-world bridge between the page and the extension APIs.
            { matches: MATCHES, js: ["bridge.js"], run_at: "document_start" },
        ],
        // Network-level blocking that follows VibeX's plugin settings.
        permissions: ["declarativeNetRequest"],
        declarative_net_request: {
            rule_resources: rulesets.map(id => ({ id, enabled: false, path: `rules/${id}.json` })),
        },
        action: { default_title: "VibeX settings" },
    };
    if (browser === "chrome") {
        m.minimum_chrome_version = "111"; // content_scripts "world": "MAIN"
        m.background = { service_worker: "background.js" };
    } else {
        m.background = { scripts: ["background.js"] };
        m.browser_specific_settings = {
            gecko: {
                id: "vibex@jakeayy.ch",
                strict_min_version: "128.0", // content_scripts "world": "MAIN"
                data_collection_permissions: { required: ["none"] },
            },
        };
    }
    return m;
}

const common = {
    bundle: true,
    minify: !watch,
    target: "es2022",
    charset: "utf8",
    legalComments: "none",
    logLevel: "info",
};

const define = target => ({
    VIBEX_VERSION: JSON.stringify(pkg.version),
    VIBEX_BUILD_TIME: JSON.stringify(new Date().toISOString()),
    VIBEX_TARGET: JSON.stringify(target),
});

const targets = {
    userscript: () => [{
        ...common,
        entryPoints: ["src/index.ts"],
        outfile: "dist/vibex.user.js",
        format: "iife",
        banner: { js: userscriptHeader },
        define: define("userscript"),
        plugins: [minifyCssPlugin({ report: true })],
    }],
    chrome: () => extension("chrome"),
    firefox: () => extension("firefox"),
};

function extension(browser) {
    const outdir = `dist/${browser}`;
    rmSync(outdir, { recursive: true, force: true });
    mkdirSync(`${outdir}/rules`, { recursive: true });
    writeFileSync(`${outdir}/manifest.json`, JSON.stringify(manifest(browser), null, 2));
    for (const id of rulesets) copyFileSync(`${RULES_DIR}/${id}.json`, `${outdir}/rules/${id}.json`);
    return [
        { ...common, entryPoints: ["src/index.ts"], outfile: `${outdir}/vibex.js`, format: "iife", define: define(browser), plugins: [minifyCssPlugin({ report: false })] },
        { ...common, entryPoints: ["src/extension/bridge.ts"], outfile: `${outdir}/bridge.js`, format: "iife" },
        { ...common, entryPoints: ["src/extension/background.ts"], outfile: `${outdir}/background.js`, format: "iife" },
    ];
}

/* ------------------------------------ zip ------------------------------------ */

/** Minimal zip writer (deflate), for store uploads. */
function zipDir(dir, outFile) {
    const files = [];
    const walk = rel => {
        for (const name of readdirSync(path.join(dir, rel))) {
            const r = rel ? `${rel}/${name}` : name;
            if (statSync(path.join(dir, r)).isDirectory()) walk(r);
            else files.push(r);
        }
    };
    walk("");
    const local = [], central = [];
    let offset = 0;
    for (const name of files.sort()) {
        const data = readFileSync(path.join(dir, name));
        const deflated = zlib.deflateRawSync(data, { level: 9 });
        const crc = zlib.crc32(data);
        const nameBuf = Buffer.from(name);
        const fields = (sig, extra) => {
            const b = Buffer.alloc(extra ? 46 : 30);
            let o = 0;
            const u32 = v => { b.writeUInt32LE(v >>> 0, o); o += 4; };
            const u16 = v => { b.writeUInt16LE(v, o); o += 2; };
            u32(sig);
            if (extra) u16(20);                     // version made by
            u16(20); u16(0x0800); u16(8);           // version needed, UTF-8 names, deflate
            u16(0); u16(0x21);                      // time, date (1980-01-01): reproducible
            u32(crc); u32(deflated.length); u32(data.length);
            u16(nameBuf.length); u16(0);
            if (extra) { u16(0); u16(0); u16(0); u32(0); u32(offset); }
            return b;
        };
        const header = fields(0x04034b50, false);
        local.push(header, nameBuf, deflated);
        central.push(fields(0x02014b50, true), nameBuf);
        offset += header.length + nameBuf.length + deflated.length;
    }
    const cd = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(cd.length, 12);
    end.writeUInt32LE(offset, 16);
    writeFileSync(outFile, Buffer.concat([...local, cd, end]));
}

/* ----------------------------------- build ----------------------------------- */

mkdirSync("dist", { recursive: true });
const chosen = Object.keys(targets).filter(t => !only || only.includes(t));

if (watch) {
    for (const t of chosen) for (const options of targets[t]()) await (await esbuild.context(options)).watch();
} else {
    for (const t of chosen) {
        await Promise.all(targets[t]().map(options => esbuild.build(options)));
        if (t !== "userscript") {
            zipDir(`dist/${t}`, `dist/vibex-${t}.zip`);
            console.log(`  ${t}: dist/${t}/ and dist/vibex-${t}.zip`);
        }
    }
}

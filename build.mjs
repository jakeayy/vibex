import * as esbuild from "esbuild";
import { transform as transformCss } from "lightningcss";
import { readFileSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const watch = process.argv.includes("--watch");

const header = `// ==UserScript==
// @name         VibeX
// @namespace    https://github.com/vibex
// @version      ${pkg.version}
// @description  ${pkg.description}
// @match        https://x.com/*
// @match        https://twitter.com/*
// @run-at       document-start
// @noframes
// @grant        none
// @inject-into  page
// ==/UserScript==
`;

/* --------------------------------- CSS minify -------------------------------- */

// Chrome-family browsers the userscript runs in; lets Lightning CSS use modern syntax.
const CSS_TARGETS = { chrome: 110 << 16, firefox: 115 << 16, safari: 16 << 16 };
const cssStats = { templates: 0, before: 0, after: 0, skipped: 0 };

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

/** Minifies one css`...` template; returns the replacement source (an untagged template). */
function minifyTemplate({ quasis, exprs }, file) {
    // Lightning CSS may unquote a string around a placeholder, which would
    // break values with spaces: leave such templates alone.
    if (quasis.slice(0, -1).some(q => /["']$/.test(q))) {
        cssStats.skipped++;
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
    cssStats.templates++;
    cssStats.before += cooked.length;
    cssStats.after += out.length;
    return `\`${out}\``;
}

/** Minifies every css`...` tagged template in our sources and drops the tag. */
const minifyCssPlugin = {
    name: "minify-css-templates",
    setup(build) {
        build.onStart(() => { Object.assign(cssStats, { templates: 0, before: 0, after: 0, skipped: 0 }); });
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
                    replacement = minifyTemplate(tpl, file);
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
            if (!cssStats.templates) return;
            const pct = Math.round((1 - cssStats.after / cssStats.before) * 100);
            console.log(`  css: ${cssStats.templates} templates minified, ${cssStats.before} → ${cssStats.after} bytes (-${pct}%)`
                + (cssStats.skipped ? `, ${cssStats.skipped} left as-is` : ""));
        });
    },
};

/* ----------------------------------- build ----------------------------------- */

mkdirSync("dist", { recursive: true });

const options = {
    entryPoints: ["src/index.ts"],
    outfile: "dist/vibex.user.js",
    bundle: true,
    minify: !watch,
    format: "iife",
    target: "es2022",
    charset: "utf8",
    legalComments: "none",
    banner: { js: header },
    define: {
        VIBEX_VERSION: JSON.stringify(pkg.version),
        VIBEX_BUILD_TIME: JSON.stringify(new Date().toISOString()),
    },
    plugins: [minifyCssPlugin],
    logLevel: "info",
};

if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
} else {
    await esbuild.build(options);
}

import * as esbuild from "esbuild";
import { readFileSync, mkdirSync } from "node:fs";

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
    logLevel: "info",
};

if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
} else {
    await esbuild.build(options);
}

// Signs the built Firefox extension through addons.mozilla.org (AMO), so it can
// be installed permanently in release Firefox instead of as a temporary add-on.
//
//   node scripts/sign-firefox.mjs [--channel unlisted|listed]
//     [--source <zip>] [--no-source] [--license <spdx>]
//     [--category <slug> ...] [--amo-metadata <json>]
//
// Reads dist/firefox/ (run `npm run build -- --target=firefox` first; the
// `sign:firefox` npm script does this for you) and uploads it to AMO.
//
//   --channel unlisted  (default)  Self-distribution: AMO signs the add-on and
//                                   returns the signed .xpi, copied to
//                                   dist/vibex-firefox.xpi. You host it yourself
//                                   and users install the file directly.
//   --channel listed               Submit to the public AMO store for review.
//                                   Mozilla hosts and distributes it; no signed
//                                   file is returned here.
//
// For the listed channel, Mozilla needs the source for its reviewers because the
// build is bundled/minified. By default this uploads an archive of the committed
// source (HEAD) built with `git archive`; override it with --source <zip> or skip
// it with --no-source (e.g. to attach the source through the AMO web UI instead).
// A listed add-on also needs a license and 1-3 category slugs: by default the
// package.json license is sent as the SPDX slug and a sensible category set is
// used. Override with --license <slug> and --category <slug> (repeatable), or
// pass a full metadata file with --amo-metadata <json> (AMO submission format).
//
// Credentials come from the environment, or a .env file in the project root
// (generate them at https://addons.mozilla.org/developers/addon/api/key/):
//   AMO_JWT_ISSUER / AMO_JWT_SECRET   (or WEB_EXT_API_KEY / WEB_EXT_API_SECRET)
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import webExt from "web-ext";

const SOURCE_DIR = "dist/firefox";
const ARTIFACTS_DIR = "dist";
const SIGNED_COPY = "dist/vibex-firefox.xpi";
const SOURCE_ARCHIVE = "dist/vibex-source.zip";
const METADATA_FILE = "dist/amo-metadata.json";
// AMO requires 1-3 category slugs for a listed add-on (per app). See the slug
// list at https://mozilla.github.io/addons-server/topics/api/categories.html .
const DEFAULT_CATEGORIES = ["social-communication", "appearance"];

// Load .env from the project root if present; real env vars (e.g. in CI) win.
try { process.loadEnvFile(); } catch { /* no .env: use the environment as-is */ }

/* -------------------------------- arguments -------------------------------- */

const args = process.argv.slice(2);
let channel = "unlisted";
let sourceArchive;      // explicit --source path
let includeSource = true;
let license;            // SPDX slug for listed versions (defaults to package.json)
let metadataFile;       // explicit --amo-metadata path (full control)
const categories = [];  // --category slugs (repeatable); defaults applied below
for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--channel") channel = args[++i];
    else if (a.startsWith("--channel=")) channel = a.slice("--channel=".length);
    else if (a === "--source") sourceArchive = args[++i];
    else if (a.startsWith("--source=")) sourceArchive = a.slice("--source=".length);
    else if (a === "--no-source") includeSource = false;
    else if (a === "--license") license = args[++i];
    else if (a.startsWith("--license=")) license = a.slice("--license=".length);
    else if (a === "--category") categories.push(args[++i]);
    else if (a.startsWith("--category=")) categories.push(a.slice("--category=".length));
    else if (a === "--amo-metadata") metadataFile = args[++i];
    else if (a.startsWith("--amo-metadata=")) metadataFile = a.slice("--amo-metadata=".length);
    else { console.error(`Unknown argument: ${a}`); process.exit(2); }
}
if (channel !== "unlisted" && channel !== "listed") {
    console.error(`--channel must be "unlisted" or "listed", got "${channel}"`);
    process.exit(2);
}

/* ------------------------------- credentials ------------------------------- */

const apiKey = process.env.AMO_JWT_ISSUER || process.env.WEB_EXT_API_KEY;
const apiSecret = process.env.AMO_JWT_SECRET || process.env.WEB_EXT_API_SECRET;
if (!apiKey || !apiSecret) {
    console.error(
        "Missing AMO credentials. Set AMO_JWT_ISSUER and AMO_JWT_SECRET in the\n" +
        "environment or a .env file (API key + secret from\n" +
        "https://addons.mozilla.org/developers/addon/api/key/).",
    );
    process.exit(1);
}

if (!existsSync(path.join(SOURCE_DIR, "manifest.json"))) {
    console.error(`${SOURCE_DIR}/manifest.json not found. Build it first:\n  npm run build -- --target=firefox`);
    process.exit(1);
}

/* ------------------------------ source archive ----------------------------- */

// Reviewers rebuild from this and diff against the signed xpi, so it must be the
// source the build came from. We archive HEAD; warn if the tree has drifted.
function buildSourceArchive() {
    mkdirSync(ARTIFACTS_DIR, { recursive: true });
    let dirty = "";
    try {
        dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
        execFileSync("git", ["archive", "--format=zip", "-o", SOURCE_ARCHIVE, "HEAD"]);
    } catch (err) {
        console.error(
            `\nCould not create the source archive with git: ${err.message}\n` +
            "Pass a prepared archive with --source <zip>, or --no-source to skip it.",
        );
        process.exit(1);
    }
    if (dirty) {
        console.warn(
            "Warning: the working tree has uncommitted changes. The source archive is\n" +
            "built from HEAD and may not match the signed build, which AMO review checks.\n" +
            "Commit (and ideally tag) before a listed submission.",
        );
    }
    return SOURCE_ARCHIVE;
}

let uploadSourceCode;
if (channel === "listed" && includeSource) {
    uploadSourceCode = sourceArchive ?? buildSourceArchive();
    if (!existsSync(uploadSourceCode)) {
        console.error(`Source archive not found: ${uploadSourceCode}`);
        process.exit(1);
    }
} else if (sourceArchive) {
    console.warn("--source is only used on the listed channel; ignoring it.");
}

/* ---------------------------- listing metadata ----------------------------- */

// AMO rejects a listed version without a license. Send one (an SPDX slug such as
// MIT, Apache-2.0, GPL-3.0-or-later); the rest of the listing is filled on AMO.
let amoMetadata;
if (channel === "listed") {
    if (metadataFile) {
        amoMetadata = metadataFile;
        if (!existsSync(amoMetadata)) {
            console.error(`AMO metadata file not found: ${amoMetadata}`);
            process.exit(1);
        }
    } else {
        const slug = license || JSON.parse(readFileSync("package.json", "utf8")).license;
        if (!slug) {
            console.error("No license for the listed version. Pass --license <SPDX slug> or set one in package.json.");
            process.exit(1);
        }
        const cats = categories.length ? categories : DEFAULT_CATEGORIES;
        mkdirSync(ARTIFACTS_DIR, { recursive: true });
        writeFileSync(METADATA_FILE, JSON.stringify({
            categories: { firefox: cats },
            version: { license: slug },
        }, null, 2));
        amoMetadata = METADATA_FILE;
    }
} else if (metadataFile || license || categories.length) {
    console.warn("--license / --category / --amo-metadata only apply to the listed channel; ignoring them.");
}

/* ---------------------------------- sign ----------------------------------- */

// web-ext's package.json isn't exported, but it sits next to its resolved entry.
const webextPkg = path.join(path.dirname(createRequire(import.meta.url).resolve("web-ext")), "package.json");
const webextVersion = JSON.parse(readFileSync(webextPkg, "utf8")).version;

console.log(`Signing ${SOURCE_DIR} on the "${channel}" channel…`);
if (uploadSourceCode) console.log(`Attaching source for review: ${uploadSourceCode}`);
if (amoMetadata) console.log(`Listing metadata: ${amoMetadata}`);
let result;
try {
    result = await webExt.cmd.sign({
        apiKey,
        apiSecret,
        channel,
        sourceDir: SOURCE_DIR,
        artifactsDir: ARTIFACTS_DIR,
        uploadSourceCode,
        amoMetadata,
        webextVersion,
    });
} catch (err) {
    console.error(`\nSigning failed: ${err.message}`);
    process.exit(1);
}

const [downloaded] = result.downloadedFiles ?? [];
if (downloaded) {
    // web-ext returns the bare filename; the file is written under artifactsDir.
    const signed = existsSync(downloaded) ? downloaded : path.join(ARTIFACTS_DIR, downloaded);
    copyFileSync(signed, SIGNED_COPY);
    console.log(`\nSigned: ${signed}\n     → ${SIGNED_COPY}`);
    if (result.id) console.log(`Add-on id: ${result.id}`);
} else {
    // Listed submissions are reviewed and distributed by Mozilla; nothing to download.
    console.log("\nSubmitted to AMO. It will be distributed once Mozilla's review completes.");
    if (result.id) console.log(`Add-on id: ${result.id}`);
}

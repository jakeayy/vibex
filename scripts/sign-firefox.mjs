// Signs the built Firefox extension through addons.mozilla.org (AMO), so it can
// be installed permanently in release Firefox instead of as a temporary add-on.
//
//   node scripts/sign-firefox.mjs [--channel unlisted|listed] [--source <zip>] [--no-source]
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
//
// Credentials come from the environment, or a .env file in the project root
// (generate them at https://addons.mozilla.org/developers/addon/api/key/):
//   AMO_JWT_ISSUER / AMO_JWT_SECRET   (or WEB_EXT_API_KEY / WEB_EXT_API_SECRET)
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import webExt from "web-ext";

const SOURCE_DIR = "dist/firefox";
const ARTIFACTS_DIR = "dist";
const SIGNED_COPY = "dist/vibex-firefox.xpi";
const SOURCE_ARCHIVE = "dist/vibex-source.zip";

// Load .env from the project root if present; real env vars (e.g. in CI) win.
try { process.loadEnvFile(); } catch { /* no .env: use the environment as-is */ }

/* -------------------------------- arguments -------------------------------- */

const args = process.argv.slice(2);
let channel = "unlisted";
let sourceArchive;      // explicit --source path
let includeSource = true;
for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--channel") channel = args[++i];
    else if (a.startsWith("--channel=")) channel = a.slice("--channel=".length);
    else if (a === "--source") sourceArchive = args[++i];
    else if (a.startsWith("--source=")) sourceArchive = a.slice("--source=".length);
    else if (a === "--no-source") includeSource = false;
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

/* ---------------------------------- sign ----------------------------------- */

// web-ext's package.json isn't exported, but it sits next to its resolved entry.
const webextPkg = path.join(path.dirname(createRequire(import.meta.url).resolve("web-ext")), "package.json");
const webextVersion = JSON.parse(readFileSync(webextPkg, "utf8")).version;

console.log(`Signing ${SOURCE_DIR} on the "${channel}" channel…`);
if (uploadSourceCode) console.log(`Attaching source for review: ${uploadSourceCode}`);
let result;
try {
    result = await webExt.cmd.sign({
        apiKey,
        apiSecret,
        channel,
        sourceDir: SOURCE_DIR,
        artifactsDir: ARTIFACTS_DIR,
        uploadSourceCode,
        webextVersion,
    });
} catch (err) {
    console.error(`\nSigning failed: ${err.message}`);
    process.exit(1);
}

const [signed] = result.downloadedFiles ?? [];
if (signed) {
    copyFileSync(signed, SIGNED_COPY);
    console.log(`\nSigned: ${signed}\n     → ${SIGNED_COPY}`);
    if (result.id) console.log(`Add-on id: ${result.id}`);
} else {
    // Listed submissions are reviewed and distributed by Mozilla; nothing to download.
    console.log("\nSubmitted to AMO. It will be distributed once Mozilla's review completes.");
    if (result.id) console.log(`Add-on id: ${result.id}`);
}

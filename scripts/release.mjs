// One command to cut a release: bump the version, build, then ship to the
// Firefox and Chrome stores using the existing sign/publish scripts.
//
//   node scripts/release.mjs [options]
//
//   --bump patch|minor|major   Version bump (default: patch). npm version
//                              commits the bump and tags it (needs a clean tree).
//   --version <x.y.z>          Set an exact version instead of bumping.
//   --no-bump                  Keep the current version (no commit/tag).
//   --firefox unlisted|listed  Firefox channel (default: unlisted). --no-firefox
//                              skips Firefox entirely.
//   --chrome draft|submit      Chrome: upload a draft (default) or also submit
//                              for review. --no-chrome skips Chrome entirely.
//   --push                     On full success, push the commit and tag.
//   --dry-run                  Print the steps without running them.
//
// Credentials come from the environment or .env, same as the underlying scripts.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

/* -------------------------------- arguments -------------------------------- */

let bump = "patch";
let versionArg, noBump = false;
let firefox = "unlisted", doFirefox = true;
let chrome = "draft", doChrome = true;
let push = false, dryRun = false;

const argv = process.argv.slice(2);
const val = (a, i) => a.includes("=") ? a.slice(a.indexOf("=") + 1) : argv[++i.v];
for (const i = { v: 0 }; i.v < argv.length; i.v++) {
    const a = argv[i.v];
    if (a.startsWith("--bump")) bump = val(a, i);
    else if (a.startsWith("--version")) versionArg = val(a, i);
    else if (a === "--no-bump") noBump = true;
    else if (a.startsWith("--firefox")) firefox = val(a, i);
    else if (a === "--no-firefox") doFirefox = false;
    else if (a.startsWith("--chrome")) chrome = val(a, i);
    else if (a === "--no-chrome") doChrome = false;
    else if (a === "--push") push = true;
    else if (a === "--dry-run") dryRun = true;
    else { console.error(`Unknown argument: ${a}`); process.exit(2); }
}
if (doFirefox && firefox !== "unlisted" && firefox !== "listed") {
    console.error(`--firefox must be "unlisted" or "listed", got "${firefox}"`);
    process.exit(2);
}
if (doChrome && chrome !== "draft" && chrome !== "submit") {
    console.error(`--chrome must be "draft" or "submit", got "${chrome}"`);
    process.exit(2);
}
if (!doFirefox && !doChrome) {
    console.error("Nothing to do: both --no-firefox and --no-chrome given.");
    process.exit(2);
}

/* --------------------------------- helpers --------------------------------- */

/** Runs a command, inheriting stdio. Returns true on success. In dry-run, just logs. */
function run(cmd, args) {
    console.log(`$ ${cmd} ${args.join(" ")}`);
    if (dryRun) return true;
    return spawnSync(cmd, args, { stdio: "inherit" }).status === 0;
}

const version = () => JSON.parse(readFileSync("package.json", "utf8")).version;

/* --------------------------------- release --------------------------------- */

// 1. Version bump (npm version also commits + tags; requires a clean tree).
if (!noBump) {
    const spec = versionArg ?? bump;
    if (!run("npm", ["version", spec, "-m", "Release v%s"])) {
        console.error("\nVersion bump failed (is the working tree clean?). Aborting.");
        process.exit(1);
    }
}
console.log(`\n=== Releasing v${version()} ===`);
console.log(`  Firefox: ${doFirefox ? firefox : "skipped"}   Chrome: ${doChrome ? chrome : "skipped"}\n`);

// 2. Build only the targets we're shipping.
const targets = [doFirefox && "firefox", doChrome && "chrome"].filter(Boolean);
if (!run("node", ["build.mjs", `--target=${targets.join(",")}`])) {
    console.error("\nBuild failed. Aborting.");
    process.exit(1);
}

// 3. Ship each store. Run both even if one fails, then summarize.
const results = {};
if (doFirefox) results.Firefox = run("node", ["scripts/sign-firefox.mjs", "--channel", firefox]);
if (doChrome) results.Chrome = run("node", ["scripts/publish-chrome.mjs", ...(chrome === "submit" ? ["--publish"] : [])]);

console.log("\n=== Summary ===");
for (const [store, ok] of Object.entries(results)) console.log(`  ${store}: ${ok ? "ok" : "FAILED"}`);

const allOk = Object.values(results).every(Boolean);
if (!allOk) {
    console.error("\nSome stores failed. The version is already bumped; retry a failed store\n" +
        "with its own script (npm run sign:firefox / publish:chrome), without bumping again.");
    process.exit(1);
}

// 4. Optionally push the release commit and tag.
if (push && !noBump) {
    if (!run("git", ["push", "--follow-tags"])) { console.error("\nPush failed."); process.exit(1); }
} else if (push) {
    console.log("\n--push ignored (nothing was committed because --no-bump).");
}
console.log("\nDone.");

// Uploads the built Chrome extension to the Chrome Web Store, and optionally
// submits it for review, through the Web Store API v2.
//
//   node scripts/publish-chrome.mjs [--publish]
//
// Uploads dist/vibex-chrome.zip (run `npm run build -- --target=chrome` first;
// the `publish:chrome` npm script does this for you). Without --publish it only
// uploads the new version as a draft; with --publish it also submits it for
// review (it goes live once Chrome approves it, with the item's current
// visibility). The manifest version must be higher than the store's current one.
//
// Credentials come from the environment or a .env file in the project root. Set
// up a Google Cloud OAuth client (type "Web application") with the Chrome Web
// Store API enabled, then get a refresh token for the scope
// https://www.googleapis.com/auth/chromewebstore . See README "Publishing for
// Chrome". Required:
//   CHROME_CLIENT_ID / CHROME_CLIENT_SECRET / CHROME_REFRESH_TOKEN
//   CHROME_PUBLISHER_ID   (Dashboard → Publisher → Settings)
//   CHROME_EXTENSION_ID   (the item's id, from its dashboard/store URL)
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const ZIP = "dist/vibex-chrome.zip";
const API = "https://chromewebstore.googleapis.com";

// Load .env from the project root if present; real env vars (e.g. in CI) win.
try { process.loadEnvFile(); } catch { /* no .env: use the environment as-is */ }

const publish = process.argv.slice(2).includes("--publish");
const unknown = process.argv.slice(2).filter(a => a !== "--publish");
if (unknown.length) {
    console.error(`Unknown argument: ${unknown[0]}`);
    process.exit(2);
}

const env = name => process.env[name];
const clientId = env("CHROME_CLIENT_ID");
const clientSecret = env("CHROME_CLIENT_SECRET");
const refreshToken = env("CHROME_REFRESH_TOKEN");
const publisherId = env("CHROME_PUBLISHER_ID");
const extensionId = env("CHROME_EXTENSION_ID");
const missing = Object.entries({
    CHROME_CLIENT_ID: clientId, CHROME_CLIENT_SECRET: clientSecret, CHROME_REFRESH_TOKEN: refreshToken,
    CHROME_PUBLISHER_ID: publisherId, CHROME_EXTENSION_ID: extensionId,
}).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
    console.error(`Missing credentials: ${missing.join(", ")}.\nSet them in the environment or a .env file (see README "Publishing for Chrome").`);
    process.exit(1);
}

if (!existsSync(ZIP)) {
    console.error(`${ZIP} not found. Build it first:\n  npm run build -- --target=chrome`);
    process.exit(1);
}

/** Parses a JSON response, throwing a readable error for a non-2xx status. */
async function json(res, what) {
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) throw new Error(`${what} failed: ${res.status} ${res.statusText}\n${JSON.stringify(data, null, 2)}`);
    return data;
}

const item = `publishers/${publisherId}/items/${extensionId}`;

async function accessToken() {
    const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    });
    const data = await json(res, "Token request");
    return data.access_token;
}

try {
    const token = await accessToken();
    const auth = { Authorization: `Bearer ${token}` };

    console.log(`Uploading ${ZIP}…`);
    const up = await json(await fetch(`${API}/upload/v2/${item}:upload`, {
        method: "POST",
        headers: auth,
        body: await readFile(ZIP),
    }), "Upload");
    console.log(`Upload state: ${up.uploadState ?? "unknown"}`);
    if (up.uploadState === "FAILURE") {
        const details = (up.itemError ?? []).map(e => `  - ${e.error_detail ?? JSON.stringify(e)}`).join("\n");
        throw new Error(`Chrome Web Store rejected the upload:\n${details || JSON.stringify(up, null, 2)}`);
    }
    if (up.uploadState === "IN_PROGRESS") {
        console.log(`Still processing; check status with :fetchStatus or the dashboard.`);
    }

    if (!publish) {
        console.log("\nUploaded as a draft. Review it in the dashboard, or re-run with --publish to submit for review.");
    } else {
        console.log("Submitting for review…");
        const pub = await json(await fetch(`${API}/v2/${item}:publish`, { method: "POST", headers: auth }), "Publish");
        console.log(`Publish status: ${(pub.status ?? []).join(", ") || "submitted"}`);
        console.log("\nSubmitted. It goes live once Chrome's review completes.");
    }
} catch (err) {
    console.error(`\n${err.message}`);
    process.exit(1);
}

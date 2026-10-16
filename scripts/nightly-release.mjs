// Replaces the "nightly" prerelease on Forgejo with the files in dist/.
// Run by .forgejo/workflows/nightly.yml after `npm run build`.
//
// Env: FORGEJO_URL (e.g. https://git.example.com), REPO (owner/name),
//      TOKEN (needs write access to releases), SHA (commit to tag).
import { readFile } from "node:fs/promises";
import path from "node:path";

const TAG = "nightly";
const ASSETS = ["dist/vibex.user.js", "dist/vibex-chrome.zip", "dist/vibex-firefox.zip"];

const { FORGEJO_URL, REPO, TOKEN, SHA } = process.env;
for (const [k, v] of Object.entries({ FORGEJO_URL, REPO, TOKEN, SHA })) {
    if (!v) throw new Error(`Missing ${k}`);
}
const api = `${FORGEJO_URL.replace(/\/$/, "")}/api/v1/repos/${REPO}`;

async function call(method, url, body) {
    const res = await fetch(url, {
        method,
        headers: {
            Authorization: `token ${TOKEN}`,
            Accept: "application/json",
            ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        },
        body: body instanceof FormData ? body : body && JSON.stringify(body),
    });
    if (!res.ok && res.status !== 404) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
    return res.status === 404 ? null : res.status === 204 ? true : res.json();
}

// 1. Remove the previous nightly: the release, then its tag (deleting a
//    release keeps the tag, which would pin the new one to the old commit).
const previous = await call("GET", `${api}/releases/tags/${TAG}`);
if (previous) {
    await call("DELETE", `${api}/releases/${previous.id}`);
    console.log(`Deleted release ${previous.name} (#${previous.id})`);
}
if (await call("DELETE", `${api}/tags/${TAG}`)) console.log(`Deleted tag ${TAG}`);

// 2. Create the new prerelease, tagging this commit.
const date = new Date().toISOString().slice(0, 10);
const release = await call("POST", `${api}/releases`, {
    tag_name: TAG,
    target_commitish: SHA,
    name: `Nightly ${date} (${SHA.slice(0, 7)})`,
    prerelease: true,
    body: [
        `Automatic build of ${SHA}. Replaced by the next nightly.`,
        "",
        "| File | Install |",
        "|---|---|",
        "| `vibex.user.js` | Tampermonkey / Violentmonkey |",
        "| `vibex-chrome.zip` | Unzip, then `chrome://extensions` → Developer mode → Load unpacked |",
        "| `vibex-firefox.zip` | `about:debugging` → Load Temporary Add-on → pick the zip (unsigned, until restart) |",
    ].join("\n"),
});
console.log(`Created ${release.name} (#${release.id})`);

// 3. Attach the builds.
for (const file of ASSETS) {
    const form = new FormData();
    form.append("attachment", new Blob([await readFile(file)]), path.basename(file));
    await call("POST", `${api}/releases/${release.id}/assets?name=${encodeURIComponent(path.basename(file))}`, form);
    console.log(`Uploaded ${path.basename(file)}`);
}

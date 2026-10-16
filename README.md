# VibeX

A client mod for X (Twitter) web, in the spirit of Vencord. It ships as a userscript and as a browser extension for Chrome and Firefox, all built from the same source.

## Build & install

```bash
npm install
npm run build      # all targets, minified (CSS included)
npm run build -- --target=chrome   # or userscript / firefox, comma-separated
npm run watch      # unminified rebuilds while developing
npm run typecheck
```

The build minifies JavaScript with esbuild and every `css` template with [Lightning CSS](https://lightningcss.dev/).

| Target | Output | Install |
|---|---|---|
| Userscript | `dist/vibex.user.js` | Tampermonkey or Violentmonkey. It must run at `document-start` (the header asks for this) so the webpack hook goes in before X's bundles execute. |
| Chrome / Chromium (111+) | `dist/chrome/`, `dist/vibex-chrome.zip` | `chrome://extensions` → Developer mode → **Load unpacked** → `dist/chrome`. The zip is for the Chrome Web Store. |
| Firefox (128+) | `dist/firefox/`, `dist/vibex-firefox.zip` | `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → `dist/firefox/manifest.json` (until restart). Permanent installs need the zip signed through addons.mozilla.org. |

Then open **Settings → VibeX** on x.com (or click the extension's toolbar button). Install one target only: if two load, the second one notices and stays off.

### Nightly builds

`.forgejo/workflows/nightly.yml` builds every target on each push to `main` and on demand. It then replaces the `nightly` prerelease: the old release and its tag are deleted, and a new one is created on the built commit with `vibex.user.js`, `vibex-chrome.zip` and `vibex-firefox.zip` attached (`scripts/nightly-release.mjs`). It uses the automatic token Forgejo gives every run (`secrets.FORGEJO_TOKEN`). If that can't manage releases on your Forgejo instance, add a repository secret `NIGHTLY_TOKEN` with write access to the repository.

### What the extension adds

The page code is the same in every target; the extension builds add what a userscript can't do:

- **Guaranteed early start.** VibeX is a `document_start` content script in the page's own JS world (`"world": "MAIN"`), which the browser runs before any page script. A userscript manager usually manages this too, but not always, and a late start leaves every webpack patch unapplied.
- **Network-level blocking.** Plugins declare `declarativeNetRequest` rulesets (`src/extension/rules/`) that follow their settings: SponsorBegone's tracking block (`telemetry`) and NoGrok's request block (`grok`). The in-page interceptors still answer X's own calls; the rulesets also catch what they can't see (workers, the service worker, pixels). Rules apply only to requests X makes, so grok.com in its own tab is untouched. Enabled rulesets persist, so they apply from X's first request on the next visit.
- **Toolbar button** that opens VibeX's settings.

The page (no extension APIs) talks to the extension through `src/extension/bridge.ts`, an isolated-world content script, which forwards to the background script (`background.ts`; a service worker in Chrome, an event page in Firefox). The About page shows which target is running.

## Layout

```
src/
  index.ts            bootstrap: register plugins → hook webpack → start plugins
  api.ts              window.VibeX
  webpack/
    index.ts          chunk hook, source patcher, module finders
    react/            JSX runtime + hooks forwarding to X's own React
    common.ts         X's router and settings UI components (SettingsScreen, Pivot, BooleanItem, …)
  plugins/
    types.ts          definePlugin + plugin/setting types
    manager.ts        enable/disable, settings, lifecycle
    hooks.ts          React hooks (useSettingsVersion)
    index.ts          list of built-in plugins (add yours here)
    settings/         the VibeX settings section (itself a plugin)
    cleanSidebar.tsx  hide sidebar / More menu items (patches + React settings UI)
    sponsorBegone.ts  remove ads, block telemetry (patch + network interceptor)
    oldTwitterBranding.ts bird logo, classic blue, Tweet/Retweet wording (patches)
    noGrok.ts         remove Grok UI, block Grok edits of your media by default
    experiments.tsx   browse / override feature switches
    noUpsells.ts      hide Premium upsells via switches
    mediaDownloader.ts Share-menu download item
    featureSwitchesAPI.ts core switch hook (required)
    consoleShortcuts.ts webpack helpers in the console
  core/               shared hooks plugins build on (feature switch resolvers, extension bridge)
  extension/          extension-only code: bridge content script, background script, network rulesets
  utils/              style helpers, router, storage, logger, network interceptors
```

## How it hooks X

- **Webpack.** X is a webpack 5 app whose chunks are pushed onto `window.webpackChunk_twitter_responsive_web`. VibeX creates that array first and wraps `push`, so every module factory goes through the patcher before webpack installs it. It also captures webpack's `require` (`VibeX.webpack.wreq`) to search loaded modules.
- **CSP.** x.com's CSP blocks `eval` and `new Function`, and reports violations. Patched modules are compiled through an inline `<script>` that carries the page's own CSP nonce.
- **React.** VibeX doesn't bundle React. `.tsx` files compile against `@vibex/react/jsx-runtime`, a shim that forwards to X's own React 19 runtime, found through webpack. Import hooks from `@vibex/react`, never from `react`: a second React copy would break hooks.
- **Settings pages.** The Settings plugin patches X's settings route table to add `/settings/vibex`, `/about`, `/plugins` and `/plugins/:name` as real routes. X's router renders them in the detail column, and they appear in X's settings search. The pages are built from X's own `SettingsScreen`, `Pivot` and `BooleanItem` components, with plain-markup fallbacks if X renames one.

## Built-in plugins

| Plugin | What it does | How |
|---|---|---|
| Settings | The VibeX settings section | Patches X's settings nav and route table |
| CleanSidebar | Hide any sidebar item, More menu entries, or swap More for a Settings tab | Patches the nav tab array and the More menu item builder |
| SponsorBegone | Removes promoted posts/accounts/trends and other ads, blocks telemetry | Rewrites `includePromotedContent` in GraphQL requests, patches X's timeline entry pipeline to drop anything with `promotedMetadata`, answers X's telemetry endpoints locally |
| OldTwitterBranding | Bird logo and favicon, classic `#1DA1F2` blue, blue Tweet buttons, Tweet / Retweet / Twitter wording | Patches the logo icon, colour palettes, button styles and X's English string catalogs |
| NoGrok | Removes Grok and Grok Imagine (sidebar tab, post buttons, floating button, edit-image and profile "Edit with Imagine" buttons, prompts) blocks Grok edits of your media by default, and hides posts by or @mentioning @grok, and blocks X's background Grok requests | Answers `false` for X's Grok feature switches, hides the floating drawer, defaults the media "Block modifications by Grok" option to on, and filters timeline batches using posts classified from API responses (an all-Grok batch is left as-is so X doesn't keep fetching) |
| Experiments | Browse all of X's feature switches (server default vs. your account) and override them | Overrides through the FeatureSwitchesAPI resolver chain; no descriptions, since X publishes none and community lists only guess from names |
| NoUpsells | Hides Premium / Verified upsells, promo banners, app-load paywalls and "Boost" nudges | Turns off only switches that *display* upsells; paid features (`subscriptions_feature_*`, long video, …) are untouched |
| MediaDownloader | "Download photo / video / GIF" in every post's Share menu, original quality | Adds an item to X's share-menu item table; respects creators who disabled downloads (setting) |
| BetterBlockedWords | Hides or blocks the author of posts containing your X muted words (one action for all) and your own phrases or regexes (an action per phrase); counts posts hidden and users blocked | Filters X's timeline pipeline using posts from API responses and X's own post store (the home timeline restored from X's saved session is rechecked and pruned with X's `REMOVE_TWEETS` action). Reads muted words through X's API client; blocks through X's own Users `block` action, one every 3 s, max 50 per page load, never accounts you follow |
| TwitterFixes | Core: fixes for X's own code. Currently smoother scrolling | Turns on two optimizations X wrote but ships disabled: `timeline_scroll_pointer_events_optimization` (no hover style recalcs while scrolling) and `responsive_web_offscreen_video_scroller_removal_enabled` (off-screen videos stop measuring their position on every scroll). Each can be turned off in its settings |
| FeatureSwitchesAPI | Core: one patch on X's FeatureSwitches class, shared by all switch-overriding plugins | `core/featureSwitches.ts` → `addSwitchResolver()` |
| ConsoleShortcuts | `vx` helpers in DevTools | — |

## Writing a plugin

```ts
import { css } from "../utils/css";
import { definePlugin } from "./types";

export default definePlugin({
    name: "MyPlugin",
    description: "What it does.",
    authors: ["you"],
    settings: {
        loud: { type: "boolean", description: "Be loud", default: false },
    },
    css: css`/* applied while enabled */`,
    start({ settings, logger, addStyle, onStop }) {
        logger.info("started, loud =", settings.loud);
        const id = setInterval(() => {}, 1000);
        onStop(() => clearInterval(id));
    },
    onRouteChange(path) {},
});
```

Then add it to `src/plugins/index.ts`.

- Write stylesheets as `css` tagged templates (`utils/css`), for `css:` and `addStyle()` alike. The build minifies each one with Lightning CSS and drops the tag. Interpolations work, except inside quoted CSS strings: such a template is left unminified.
- `start` and `stop` run live when the user toggles the plugin. Changing a setting restarts the plugin unless that setting has `restartNeeded: true`, which shows a "Reload needed" banner instead.
- `startEarly: true` starts the plugin at document-start instead of DOMContentLoaded, before X's bundles run (no DOM yet). SponsorBegone uses it so X's very first requests are already intercepted.
- `networkRules: { <rulesetId>: settings => boolean }` turns on a ruleset from `src/extension/rules/<id>.json` in extension builds (the userscript ignores it); keep the in-page interceptor too, so the userscript gets the same blocking.
- `addInterceptor()` from `utils/network` hooks every XHR, `fetch` and `sendBeacon` request: rewrite its URL or body, or block it (it then completes locally as an empty 200).
- `addResponseObserver()` from `utils/network` sees every completed XHR/`fetch` response read-only, before X's own handlers; `res.json()` parses lazily, so observers that filter by `res.url` first cost nothing.
- `settingsPanel` adds your own React component to the plugin's settings page, above its settings (BetterBlockedWords shows its counters there).
- Setting types are `boolean`, `string`, `number`, `select` and `custom` (your own React component that receives `{ value, set }`). The settings page is generated from them. A setting can also take `section` (groups it under a heading) and `disabled(settings)` (greys it out, e.g. under a parent toggle).

### Webpack patches

```ts
patches: [{
    find: 'testID:"helpCenterLink"',             // string that identifies the module
    replacement: {
        match: /link:"\/settings\/about"/,          // string or RegExp (use /g for every hit)
        replace: '$&,onClick:$self.handleClick',    // $self = this plugin object
    },
}],
handleClick() { /* ... */ },
```

Patches are applied only when the page loads, so toggling a plugin that has patches shows a "Reload needed" banner. Patched code can still read settings live: CleanSidebar's patches route X's data through `$self` functions that check the current settings, and its React wrapper re-renders on change. Patches that never matched are listed on the About page. Use `[\w$]+` rather than hard-coding minified variable names, because they change on every X deploy.

### Console helpers

Enable **ConsoleShortcuts** to get a `vx` object in DevTools with `vx.findByProps(...)`, `vx.findByCode(...)`, `vx.searchModules("some string")` and `vx.source(id)`.

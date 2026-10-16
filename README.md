# VibeX

A client mod for X (Twitter) web, in the spirit of Vencord. It ships as a single minified userscript.

## Build & install

```bash
npm install
npm run build      # -> dist/vibex.user.js (minified)
npm run watch      # unminified rebuilds while developing
npm run typecheck
```

Install `dist/vibex.user.js` in Tampermonkey or Violentmonkey. It must run at `document-start` (the header already asks for this) so the webpack hook goes in before X's bundles execute. Then open **Settings → VibeX** on x.com.

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
    cleanSidebar.tsx  example: webpack patches + React settings UI
    consoleShortcuts.ts example: start/stop
  utils/              style helpers, router, storage, logger
```

## How it hooks X

- **Webpack.** X is a webpack 5 app whose chunks are pushed onto `window.webpackChunk_twitter_responsive_web`. VibeX creates that array first and wraps `push`, so every module factory goes through the patcher before webpack installs it. It also captures webpack's `require` (`VibeX.webpack.wreq`) to search loaded modules.
- **CSP.** x.com's CSP blocks `eval` and `new Function`, and reports violations. Patched modules are compiled through an inline `<script>` that carries the page's own CSP nonce.
- **React.** VibeX doesn't bundle React. `.tsx` files compile against `@vibex/react/jsx-runtime`, a shim that forwards to X's own React 19 runtime, found through webpack. Import hooks from `@vibex/react`, never from `react`: a second React copy would break hooks.
- **Settings pages.** The Settings plugin patches X's settings route table to add `/settings/vibex`, `/about`, `/plugins` and `/plugins/:name` as real routes. X's router renders them in the detail column, and they appear in X's settings search. The pages are built from X's own `SettingsScreen`, `Pivot` and `BooleanItem` components, with plain-markup fallbacks if X renames one.

## Writing a plugin

```ts
import { definePlugin } from "./types";

export default definePlugin({
    name: "MyPlugin",
    description: "What it does.",
    authors: ["you"],
    settings: {
        loud: { type: "boolean", description: "Be loud", default: false },
    },
    css: `/* applied while enabled */`,
    start({ settings, logger, addStyle, onStop }) {
        logger.info("started, loud =", settings.loud);
        const id = setInterval(() => {}, 1000);
        onStop(() => clearInterval(id));
    },
    onRouteChange(path) {},
});
```

Then add it to `src/plugins/index.ts`.

- `start` and `stop` run live when the user toggles the plugin. Changing a setting restarts the plugin unless that setting has `restartNeeded: true`.
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

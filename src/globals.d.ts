declare const VIBEX_VERSION: string;
declare const VIBEX_BUILD_TIME: string;
/** How this build is installed. */
declare const VIBEX_TARGET: "userscript" | "chrome" | "firefox";

interface Window {
    VibeX: typeof import("./api").VibeX;
    webpackChunk_twitter_responsive_web?: unknown[];
}

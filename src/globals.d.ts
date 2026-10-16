declare const VIBEX_VERSION: string;
declare const VIBEX_BUILD_TIME: string;

interface Window {
    VibeX: typeof import("./api").VibeX;
    webpackChunk_twitter_responsive_web?: unknown[];
}

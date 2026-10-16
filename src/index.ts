import { VibeX } from "./api";
import { builtinPlugins } from "./plugins";
import { registerPlugin, startAll, startEarlyPlugins } from "./plugins/manager";
import { onReady } from "./utils/dom";
import { Logger } from "./utils/logger";
import { initRouter } from "./utils/router";
import { initWebpack } from "./webpack";

const logger = new Logger("Core");

if (window.top !== window) {
    // X embeds same-origin iframes; the mod only belongs in the top frame.
} else if ((window as any).VibeX) {
    logger.warn("VibeX is already loaded, skipping");
} else {
    window.VibeX = VibeX;

    // Order matters: patches are registered by plugins before the webpack hook
    // goes in, and the hook must be installed before X's bundles execute.
    builtinPlugins.forEach(registerPlugin);
    initWebpack();
    initRouter();
    startEarlyPlugins();
    onReady(startAll);

    logger.info(`v${VIBEX_VERSION} loaded`);
}

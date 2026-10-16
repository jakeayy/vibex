import * as webpack from "./webpack";
import { plugins } from "./plugins/manager";
import { definePlugin } from "./plugins/types";
import { navigate } from "./utils/router";

/** Exposed as `window.VibeX`; also the target of `$self` in webpack patches. */
export const VibeX = {
    version: VIBEX_VERSION,
    plugins,
    webpack,
    definePlugin,
    navigate,
};

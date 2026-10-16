import type { PluginDef } from "./types";

import settings from "./settings";
import cleanSidebar from "./cleanSidebar";
import consoleShortcuts from "./consoleShortcuts";

// Add new plugins here.
export const builtinPlugins: PluginDef<any>[] = [
    settings,
    cleanSidebar,
    consoleShortcuts,
];

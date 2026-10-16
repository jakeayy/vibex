import type { PluginDef } from "./types";

import settings from "./settings";
import cleanSidebar from "./cleanSidebar";
import consoleShortcuts from "./consoleShortcuts";
import sponsorBegone from "./sponsorBegone";
import oldTwitterBranding from "./oldTwitterBranding";

// Add new plugins here.
export const builtinPlugins: PluginDef<any>[] = [
    settings,
    cleanSidebar,
    consoleShortcuts,
    sponsorBegone,
    oldTwitterBranding,
];

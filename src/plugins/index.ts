import type { PluginDef } from "./types";

import settings from "./settings";
import featureSwitchesAPI from "./featureSwitchesAPI";
import cleanSidebar from "./cleanSidebar";
import consoleShortcuts from "./consoleShortcuts";
import sponsorBegone from "./sponsorBegone";
import oldTwitterBranding from "./oldTwitterBranding";
import noGrok from "./noGrok";
import experiments from "./experiments";
import noUpsells from "./noUpsells";
import mediaDownloader from "./mediaDownloader";

// Add new plugins here.
export const builtinPlugins: PluginDef<any>[] = [
    settings,
    featureSwitchesAPI,
    cleanSidebar,
    consoleShortcuts,
    sponsorBegone,
    oldTwitterBranding,
    noGrok,
    experiments,
    noUpsells,
    mediaDownloader,
];

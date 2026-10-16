import type { PluginDef } from "./types";

import settings from "./settings";
import featureSwitchesAPI from "./featureSwitchesAPI";
import twitterFixes from "./twitterFixes";
import cleanSidebar from "./cleanSidebar";
import consoleShortcuts from "./consoleShortcuts";
import sponsorBegone from "./sponsorBegone";
import oldTwitterBranding from "./oldTwitterBranding";
import noGrok from "./noGrok";
import experiments from "./experiments";
import noUpsells from "./noUpsells";
import mediaDownloader from "./mediaDownloader";
import betterBlockedWords from "./betterBlockedWords";
import bypassAgeVerification from "./bypassAgeVerification";

// Add new plugins here.
export const builtinPlugins: PluginDef<any>[] = [
    settings,
    featureSwitchesAPI,
    twitterFixes,
    cleanSidebar,
    consoleShortcuts,
    sponsorBegone,
    oldTwitterBranding,
    noGrok,
    experiments,
    noUpsells,
    mediaDownloader,
    betterBlockedWords,
    bypassAgeVerification,
];

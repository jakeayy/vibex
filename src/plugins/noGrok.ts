import { getPluginSetting, isEnabled } from "./manager";
import { definePlugin } from "./types";

const NAME = "NoGrok";
const setting = (key: string) => isEnabled(NAME) && !!getPluginSetting(NAME, key);

/*
 * Most Grok UI in X is gated behind server-sent feature switches
 * (responsive_web_grok_*, *_imagine_*, xchat_ask_grok_enabled, ...), all read
 * through one FeatureSwitches class. Answering `false` for those switches
 * makes X itself skip rendering the Grok buttons, menus, cards and prompts.
 */
const GROK_SWITCH = /grok|imagine/i;
/** Switches that must keep their value. */
const KEEP = new Set([
    // Enables the "Block modifications by Grok" media option this plugin turns on.
    "responsive_web_grok_media_block_edit_enabled",
]);
/** Inverted switches (true = Grok feature off) are left alone. */
const INVERTED = /disable|hide|holdback|block/i;
const TRANSLATION = /translat/i;

export default definePlugin({
    name: NAME,
    description: "Removes Grok and Grok Imagine from X (sidebar, post buttons, floating button, edit-image buttons, prompts) and blocks Grok edits of the media you post by default.",
    authors: ["VibeX"],
    settings: {
        hideGrok: {
            type: "boolean",
            description: "Remove Grok and Grok Imagine everywhere in X",
            default: true,
            restartNeeded: true,
        },
        hideTranslations: {
            type: "boolean",
            description: "Also remove Grok-powered translations (\"Translated by Grok\")",
            default: true,
            restartNeeded: true,
            disabled: s => !s.hideGrok,
        },
        blockEditsByDefault: {
            type: "boolean",
            description: "Turn on \"Block modifications by Grok\" for every image and video you attach",
            default: true,
        },
    },
    patches: [
        {
            // X's FeatureSwitches class: every isTrue/getValue goes through getFeatureSwitch.
            find: "getValueWithoutImpression=(",
            replacement: {
                match: /this\.getFeatureSwitch=\(\{name:([\w$]+),shouldScribeImpression:([\w$]+)=!0\}\)=>([\w$]+)\(\{key:\1,shouldScribeImpression:\2\}\)/,
                replace: "this.getFeatureSwitch=({name:$1,shouldScribeImpression:$2=!0})=>$self.featureSwitch($1,$3({key:$1,shouldScribeImpression:$2}))",
            },
        },
        {
            // Floating Grok drawer (bottom right): not switch-gated. Its container
            // renders the expanded drawer, the collapsed button, or null.
            find: 'id:"GrokDrawer"',
            replacement: {
                match: /\)\?\(0,([\w$]+)\.jsx\)\(([\w$]+),\{\.\.\.([\w$]+)\}\):([\w$]+)===([\w$]+)\.v\.COLLAPSED\?/,
                replace: ")&&!$self.hideDrawer()?(0,$1.jsx)($2,{...$3}):!$self.hideDrawer()&&$4===$5.v.COLLAPSED?",
            },
        },
        {
            // Media editor toggle + attachment badge: a missing value means "blocked".
            find: "grokActions?.blockGrokEdit",
            all: true,
            replacement: [
                { match: /!!([\w$.?[\]]+)\.grokActions\?\.blockGrokEdit/g, replace: "$self.blocked($1.grokActions)" },
                { match: /([\w$.?[\]]+)\.grokActions\?\.blockGrokEdit\?\?!1/g, replace: "$self.blocked($1.grokActions)" },
            ],
        },
        {
            // Post builder: sends grok_actions with the media metadata only when
            // grokActions is set, so default it for media the user didn't touch.
            find: "block_grok_edit:",
            replacement: {
                match: /([\w$]+)=([\w$]+)\?\.mediaMetadata\?\.grokActions,/,
                replace: "$1=$self.grokActions($2?.mediaMetadata?.grokActions),",
            },
        },
    ],

    featureSwitch(name: string, result: { value: unknown } | undefined) {
        if (!result || result.value !== true || !setting("hideGrok")) return result;
        if (!GROK_SWITCH.test(name) || KEEP.has(name) || INVERTED.test(name)) return result;
        if (TRANSLATION.test(name) && !setting("hideTranslations")) return result;
        return { ...result, value: false };
    },

    hideDrawer: () => setting("hideGrok"),

    blocked(grokActions: { blockGrokEdit?: boolean } | undefined): boolean {
        return grokActions?.blockGrokEdit ?? setting("blockEditsByDefault");
    },

    grokActions(grokActions: { blockGrokEdit?: boolean } | undefined) {
        if (grokActions || !setting("blockEditsByDefault")) return grokActions;
        return { blockGrokEdit: true };
    },
});

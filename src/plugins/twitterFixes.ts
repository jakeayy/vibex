import { addSwitchResolver, withValue } from "../core/featureSwitches";
import { getPluginSetting, isEnabled } from "./manager";
import { definePlugin } from "./types";

const NAME = "TwitterFixes";
const setting = (key: string) => isEnabled(NAME) && !!getPluginSetting(NAME, key);

/*
 * Fixes for X's own code.
 *
 * Performance: optimizations X has already written but ships turned off,
 * behind feature switches. Turning the switch on runs X's own code path.
 */
const SWITCHES: Record<string, string> = {
    // Timeline: sets pointer-events:none on the list while scrolling (back
    // 150 ms after), so hover styles aren't recalculated mid-scroll.
    scrollPointerEvents: "timeline_scroll_pointer_events_optimization",
    // Videos: each one listens to scroll and measures its position (a forced
    // layout) on every frame. This drops the listener while the video is off
    // screen and re-adds it through an IntersectionObserver.
    offscreenVideoListeners: "responsive_web_offscreen_video_scroller_removal_enabled",
};

// Registered at load: X reads some of these switches in constructors.
addSwitchResolver((name, result) => {
    for (const [key, sw] of Object.entries(SWITCHES)) {
        if (name === sw && setting(key)) return withValue(result, true);
    }
    return result;
});

/*
 * Profiles: X's own forms keep these fields to one short line, but its API
 * accepts anything, so crafted profiles carry text with hundreds of thousands
 * of line breaks (a location spanning the screen, or a website "URL" that
 * renders millions of pixels tall and freezes the page).
 */
const MAX_PROFILE_TEXT = 120;

/** Collapses every whitespace run (line breaks included) to one space and caps the length. */
function oneLine(text: unknown): unknown {
    if (typeof text !== "string" || !setting("singleLineProfileText")) return text;
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > MAX_PROFILE_TEXT ? `${flat.slice(0, MAX_PROFILE_TEXT - 1)}…` : flat;
}

export default definePlugin({
    name: NAME,
    description: "Fixes for X's own code: smoother scrolling (optimizations X built but ships disabled), and profiles that can't break the page with multi-line text.",
    authors: ["VibeX"],
    required: true,
    settings: {
        scrollPointerEvents: {
            type: "boolean",
            section: "Performance",
            description: "Skip hover effects while the timeline is scrolling",
            default: true,
        },
        offscreenVideoListeners: {
            type: "boolean",
            section: "Performance",
            description: "Stop tracking the position of videos that are off screen",
            default: true,
        },
        singleLineProfileText: {
            type: "boolean",
            section: "Profiles",
            description: "Show profile locations and professional-profile details (address, website, contact) on a single line",
            default: true,
        },
    },
    patches: [
        {
            // Profile header: the location item renders the raw location text.
            find: 'testID:"UserLocation"',
            replacement: {
                match: /(testID:"UserLocation",children:\(0,[\w$]+\.jsx\)\([\w$]+\.[\w$]+,\{children:)([\w$]+)\}/,
                replace: "$1$self.oneLine($2)}",
            },
        },
        {
            // Professional profiles: spotlight modules (location, shop, jobs)
            // render each line element's text: address, website, contact, ...
            find: "bodyLine,children:",
            replacement: {
                match: /(numberOfLines:([\w$]+)\.numberOfLines,onPress:\2\.onPress,size:[\w$]+\?"subtext1":"body",children:)\2\.text\}/,
                replace: "$1$self.oneLine($2.text)}",
            },
        },
    ],

    oneLine,
});

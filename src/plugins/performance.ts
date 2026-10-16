import { addSwitchResolver, withValue } from "../core/featureSwitches";
import { getPluginSetting, isEnabled } from "./manager";
import { definePlugin } from "./types";

const NAME = "Performance";
const setting = (key: string) => isEnabled(NAME) && !!getPluginSetting(NAME, key);

/*
 * Optimizations X has already written but ships turned off, behind feature
 * switches. Turning the switch on runs X's own code path.
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

export default definePlugin({
    name: NAME,
    description: "Makes scrolling smoother by turning on optimizations X has built but ships disabled.",
    authors: ["VibeX"],
    enabledByDefault: true,
    settings: {
        scrollPointerEvents: {
            type: "boolean",
            description: "Skip hover effects while the timeline is scrolling",
            default: true,
        },
        offscreenVideoListeners: {
            type: "boolean",
            description: "Stop tracking the position of videos that are off screen",
            default: true,
        },
    },
});

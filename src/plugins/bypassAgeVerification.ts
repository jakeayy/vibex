import { addSwitchResolver, withValue } from "../core/featureSwitches";
import { isEnabled } from "./manager";
import { definePlugin } from "./types";

const NAME = "BypassAgeVerification";

/*
 * X still sends age-restricted posts in full, media included; it only marks
 * them with mediaVisibilityResults.blurred_image_interstitial.interstitial_action
 * = "AgeVerificationPrompt". Every place that hides such media and opens the
 * age verification prompt also checks this switch. With it off, X treats the
 * post like any other sensitive post: blurred with a "Show" button, or shown
 * directly if "Display media that may contain sensitive content" is on.
 *
 * Nothing is sent to X: no verification status is claimed, the page just
 * renders what it already received.
 */
const AGE_ASSURANCE_SWITCH = "rweb_age_assurance_flow_enabled";

// Registered at load: X reads switches from its first render.
addSwitchResolver((name, result) => {
    if (name !== AGE_ASSURANCE_SWITCH || !isEnabled(NAME) || result?.value !== true) return result;
    return withValue(result, false);
});

export default definePlugin({
    name: NAME,
    description: "Shows age-restricted media like other sensitive media (behind X's usual \"Show\" cover) instead of asking you to verify your age.",
    authors: ["VibeX"],
});

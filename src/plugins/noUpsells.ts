import { addSwitchResolver, withValue } from "../core/featureSwitches";
import { isEnabled } from "./manager";
import { definePlugin } from "./types";

const NAME = "NoUpsells";

/*
 * Upsells are gated by feature switches. Only switches that *show* an upsell,
 * promo or paywall are touched: many subscriptions_* switches are the paid
 * features themselves (long videos, analytics, ...) and must keep working.
 */
const SHOWS_UPSELL = new RegExp([
    "upsell",
    "_promo_variant",
    "paywall_on_app_load",
    "upgrade_premium_plus_banner",
    "premium_hub_upgrade_card",
    "offers_banner",
    "nav_indicator",
    "discount_label",
    "free_upgrade_promo",
    "new_year_offer",
    "churn_prevention",
    "signup_navbar_tab",
    "quick_promote_cta",
    "quick_promote_action_menu",
    "gold_verified_boost",
].join("|"));

/** Switches whose `true` hides the upsell: turned on instead of off. */
const HIDES_UPSELL = /premium_business_offers_navbar_premium_signup_hidden|rweb_premium_business_rebranding_entry_point_removed/;

addSwitchResolver((name, result) => {
    if (!result || !isEnabled(NAME)) return result;
    if (HIDES_UPSELL.test(name)) return result.value === false ? withValue(result, true) : result;
    if (result.value === true && SHOWS_UPSELL.test(name)) return withValue(result, false);
    return result;
});

export default definePlugin({
    name: NAME,
    description: "Hides Premium / Verified upsells, promo banners, paywall prompts and \"Boost this post\" nudges. Your subscription's features keep working.",
    authors: ["VibeX"],
    // No patches of its own: switch overrides are read live, but components
    // already on screen keep what they rendered until a reload.
    settings: {},
});

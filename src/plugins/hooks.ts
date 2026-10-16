import { useSyncExternalStore } from "@vibex/react";
import { getSettingsVersion, onSettingsChange } from "../utils/storage";

/** Re-renders the calling component whenever any VibeX setting is saved. */
export function useSettingsVersion() {
    return useSyncExternalStore(onSettingsChange, getSettingsVersion);
}

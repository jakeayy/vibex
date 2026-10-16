// Shared hook into X's feature switches. X reads every switch through one
// FeatureSwitches class; the required FeatureSwitchesAPI plugin patches it to
// call resolve(), and plugins register resolvers here.
//
// Resolvers run in registration order, each seeing the previous result, and
// must be cheap: X reads switches constantly while rendering.

export interface SwitchResult {
    value: unknown;
    [extra: string]: unknown;
}

/** Return a replacement result, or `result` unchanged. */
export type SwitchResolver = (name: string, result: SwitchResult | undefined) => SwitchResult | undefined;

const resolvers: SwitchResolver[] = [];

export function addSwitchResolver(fn: SwitchResolver) {
    resolvers.push(fn);
    return () => {
        const i = resolvers.indexOf(fn);
        if (i >= 0) resolvers.splice(i, 1);
    };
}

export function resolve(name: string, result: SwitchResult | undefined) {
    for (const fn of resolvers) {
        try {
            result = fn(name, result);
        } catch (e) {
            console.error("[VibeX] feature switch resolver failed", e);
        }
    }
    return result;
}

/** Helper for resolvers: same result with a different value. */
export const withValue = (result: SwitchResult | undefined, value: unknown): SwitchResult => ({ ...result, value });

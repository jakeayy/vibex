import { resolve } from "../core/featureSwitches";
import { definePlugin } from "./types";

export default definePlugin({
    name: "FeatureSwitchesAPI",
    description: "Lets plugins override X's feature switches (used by Experiments, NoGrok and NoUpsells).",
    authors: ["VibeX"],
    required: true,
    patches: [
        {
            // X's FeatureSwitches class: every isTrue/getValue goes through getFeatureSwitch.
            find: "getValueWithoutImpression=(",
            replacement: {
                match: /this\.getFeatureSwitch=\(\{name:([\w$]+),shouldScribeImpression:([\w$]+)=!0\}\)=>([\w$]+)\(\{key:\1,shouldScribeImpression:\2\}\)/,
                replace: "this.getFeatureSwitch=({name:$1,shouldScribeImpression:$2=!0})=>$self.resolve($1,$3({key:$1,shouldScribeImpression:$2}))",
            },
        },
    ],
    resolve,
});

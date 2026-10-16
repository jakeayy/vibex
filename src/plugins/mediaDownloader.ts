import { findModuleByCode } from "../webpack";
import { getPluginSetting, isEnabled } from "./manager";
import { definePlugin } from "./types";

const NAME = "MediaDownloader";
const DOWNLOAD_ICON = "M11.99 16l-5.7-5.7L7.7 8.88l3.29 3.3V2.59h2v9.59";

interface Media {
    type: "photo" | "video" | "animated_gif";
    media_url_https?: string;
    video_info?: { variants?: { content_type: string; url: string; bitrate?: number }[] };
    allow_download_status?: { allow_download?: boolean };
}

interface Tweet {
    id_str: string;
    user?: { screen_name?: string };
    retweeted_status?: Tweet;
    extended_entities?: { media?: Media[] };
}

interface Download {
    url: string;
    filename: string;
}

/** Highest-quality file for each attachment of a post. */
function downloads(tweet: Tweet): Download[] {
    const post = tweet.retweeted_status ?? tweet;
    const media = post.extended_entities?.media ?? [];
    const respect = !!getPluginSetting(NAME, "respectCreators");
    const who = post.user?.screen_name ?? "post";

    return media.flatMap((m, i): Download[] => {
        if (respect && m.allow_download_status?.allow_download === false) return [];
        const name = `${who}-${post.id_str}${media.length > 1 ? `-${i + 1}` : ""}`;
        if (m.type === "photo" && m.media_url_https) {
            // .../media/ID.jpg -> .../media/ID?format=jpg&name=orig (original resolution)
            const match = m.media_url_https.match(/^(.*)\.(\w+)$/);
            if (!match) return [];
            return [{ url: `${match[1]}?format=${match[2]}&name=orig`, filename: `${name}.${match[2]}` }];
        }
        const best = (m.video_info?.variants ?? [])
            .filter(v => v.content_type === "video/mp4")
            .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
        return best ? [{ url: best.url, filename: `${name}.mp4` }] : [];
    });
}

/** Saves a file under a chosen name. X's media hosts allow CORS from x.com. */
async function save({ url, filename }: Download) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const href = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 30_000);
}

function label(tweet: Tweet, count: number) {
    if (count > 1) return `Download ${count} media files`;
    const type = (tweet.retweeted_status ?? tweet).extended_entities?.media?.[0]?.type;
    return type === "photo" ? "Download photo" : type === "animated_gif" ? "Download GIF" : "Download video";
}

let downloadIcon: unknown;

export default definePlugin({
    name: NAME,
    description: "Adds \"Download photo / video\" to the Share menu of posts with media, saving the original quality.",
    authors: ["VibeX"],
    settings: {
        respectCreators: {
            type: "boolean",
            description: "Respect creators who turned off downloads for their media",
            default: true,
        },
    },
    patches: [
        {
            // Share menu builder: a list of action keys (y) looked up in a table
            // of item factories (w). Add our own key and factory.
            find: "responsive_web_media_download_video_share_menu_enabled",
            replacement: {
                match: /(\(function\(([\w$]+),[\w$]+,[\w$]+,[\w$]+\)\{let\{bookmarked:[\w$]+\}=\2\.retweeted_status\?\?\2,[\s\S]*?)([\w$]+)=\[([\w$]+)\.DM,([^\]]*)\],([\w$]+)=\{\[\4\.BOOKMARK\]:/,
                replace: '$1$3=[$4.DM,$5,"vibexDownload"],$6={vibexDownload:()=>$self.menuItems($2),[$4.BOOKMARK]:',
            },
        },
    ],

    menuItems(tweet: Tweet) {
        if (!isEnabled(NAME) || !tweet) return [];
        const files = downloads(tweet);
        if (!files.length) return [];
        downloadIcon ??= findModuleByCode(DOWNLOAD_ICON)?.default;
        return [{
            text: label(tweet, files.length),
            Icon: downloadIcon,
            onClick: async () => {
                for (const file of files) {
                    try { await save(file); } catch (e) { console.error("[VibeX] download failed", e); }
                }
            },
        }];
    },
});

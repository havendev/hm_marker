import type { VideoDetail, SubtitleSegment, ChapterInfo, Message } from "../lib/types";

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

// Inject script into main world to read window.__INITIAL_STATE__
function injectStateReader(): void {
  if (document.getElementById("__am_bili_state")) return;
  const s = document.createElement("script");
  s.id = "__am_bili_state";
  s.textContent = [
    "(function(){",
    "  try{",
    "    var s=window.__INITIAL_STATE__;",
    "    if(!s||!s.videoData){window.dispatchEvent(new CustomEvent('__am_bili_state',{detail:'{}'}));return;}",
    "    var v=s.videoData;",
    "    var slim={",
    "      bvid:v.bvid,aid:v.aid,cid:v.cid,title:v.title,desc:v.desc,",
    "      duration:v.duration,pubdate:v.pubdate,pic:v.pic,",
    "      ownerName:v.owner?v.owner.name:null,",
    "      stat:v.stat?{view:v.stat.view,danmaku:v.stat.danmaku,reply:v.stat.reply,favorite:v.stat.favorite,coin:v.stat.coin,share:v.stat.share,like:v.stat.like}:null,",
    "    };",
    "    var tags=[];",
    "    if(s.tags&&Array.isArray(s.tags)){tags=s.tags.map(function(t){return t.tag_name||t.name||String(t);});}",
    "    window.dispatchEvent(new CustomEvent('__am_bili_state',{detail:JSON.stringify({vd:slim,tags:tags})}));",
    "  }catch(e){window.dispatchEvent(new CustomEvent('__am_bili_state',{detail:'{}'}));}",
    "})();",
  ].join("\n");
  (document.head || document.documentElement).appendChild(s);
}

interface BiliStateData {
  vd: {
    bvid?: string;
    aid?: number;
    cid?: number;
    title?: string;
    desc?: string;
    duration?: number;
    pubdate?: number;
    pic?: string;
    ownerName?: string;
    stat?: Record<string, number>;
  };
  tags: string[];
}

function waitForStateData(timeoutMs = 6000): Promise<BiliStateData | null> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve(null); } }, timeoutMs);
    const h = (e: Event) => {
      if (!done) {
        done = true; clearTimeout(timer);
        window.removeEventListener("__am_bili_state", h);
        try {
          const parsed = JSON.parse((e as CustomEvent).detail as string);
          resolve(parsed.vd ? (parsed as BiliStateData) : null);
        } catch { resolve(null); }
      }
    };
    window.addEventListener("__am_bili_state", h);
  });
}

// Fetch subtitles via Bilibili player API
async function fetchSubtitles(aid: number, cid: number): Promise<{ subtitle?: string; subtitleSegments?: SubtitleSegment[] }> {
  try {
    const resp = await fetch(`https://api.bilibili.com/x/player/v2?aid=${aid}&cid=${cid}`, { credentials: "include" });
    const data = await resp.json();
    const subs = data?.data?.subtitle?.subtitles;
    if (!Array.isArray(subs) || subs.length === 0) return {};

    // Prefer Chinese subtitles, fallback to first
    const zhSub = subs.find((s: Record<string, unknown>) => {
      const lan = String(s.lan || "");
      return lan.includes("zh");
    }) || subs[0];

    let subUrl = String(zhSub.subtitle_url || "");
    if (subUrl.startsWith("//")) subUrl = "https:" + subUrl;
    else if (!subUrl.startsWith("http")) subUrl = "https://" + subUrl;

    const subResp = await fetch(subUrl);
    const subData = await subResp.json();
    const body = subData.body;
    if (!Array.isArray(body)) return {};

    const segments: SubtitleSegment[] = body.map((item: Record<string, unknown>) => ({
      start: Math.round(Number(item.from || 0)),
      end: Math.round(Number(item.to || 0)),
      text: String(item.content || "").trim(),
    })).filter((seg) => seg.text.length > 0);

    return {
      subtitle: segments.map((s) => s.text).join(" "),
      subtitleSegments: segments.length > 0 ? segments : undefined,
    };
  } catch { return {}; }
}

// Parse chapters from description timestamps
function extractChapters(desc: string): ChapterInfo[] | undefined {
  const lines = desc.split("\n");
  const chapters: ChapterInfo[] = [];
  const timeRe = /(\d{1,2}:\d{2}(?::\d{2})?)\s*(.+)/;
  for (const line of lines) {
    const m = line.trim().match(timeRe);
    if (m && m[2] && m[2].trim().length > 0) {
      chapters.push({ time: m[1], title: m[2].trim() });
    }
  }
  return chapters.length > 0 ? chapters : undefined;
}

async function handleExtractDetail(videoId: string): Promise<{ detail: VideoDetail; error?: string }> {
  injectStateReader();
  await sleep(200);
  const stateData = await waitForStateData(6000);
  if (!stateData?.vd) return { detail: { id: videoId, tags: [] }, error: "NO_INITIAL_STATE" };

  const vd = stateData.vd;
  const tags: string[] = stateData.tags || [];
  const stat = vd.stat;

  const detail: VideoDetail = {
    id: videoId,
    desc: String(vd.desc || ""),
    author: vd.ownerName || undefined,
    coverUrl: vd.pic || undefined,
    duration: vd.duration || undefined,
    likeCount: stat?.like,
    commentCount: stat?.reply,
    collectCount: stat?.favorite,
    shareCount: stat?.share,
    publishTime: vd.pubdate ? new Date(vd.pubdate * 1000).toISOString().slice(0, 10) : undefined,
    tags,
  };

  if (detail.desc) {
    const chapters = extractChapters(detail.desc);
    if (chapters) detail.chapters = chapters;
  }

  const aid = Number(vd.aid);
  const cid = Number(vd.cid);
  if (aid && cid) {
    const sub = await fetchSubtitles(aid, cid);
    detail.subtitle = sub.subtitle;
    detail.subtitleSegments = sub.subtitleSegments;
  }

  // Assemble content field
  const parts: string[] = [];
  if (detail.desc) parts.push(detail.desc);
  if (tags.length > 0) parts.push("标签: " + tags.join(" "));
  if (detail.chapters) for (const ch of detail.chapters) parts.push(`${ch.time} ${ch.title}`);
  if (detail.subtitle) parts.push(detail.subtitle);
  detail.content = parts.join("\n\n");

  return { detail };
}

if (window.location.hostname.includes("bilibili.com")) {
  chrome.runtime.onMessage.addListener((msg: Message, _s, sendResponse) => {
    if (msg.type === "EXTRACT_DETAIL") {
      handleExtractDetail((msg.payload as { videoId: string }).videoId).then((r) => sendResponse(r));
      return true;
    }
    return false;
  });
}

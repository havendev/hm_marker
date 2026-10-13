import type { VideoItem, VideoDetail, ChapterInfo, SubtitleSegment, Message, CollectProgress } from "../lib/types";

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
function extractTags(text: string): string[] { const m = text.match(/#[^#\s]+/g); return m ? m.map((t) => t.replace(/^#/, "")) : []; }
function parseCount(text: string): number { text = text.trim(); if (text.includes("万")) return Math.round(parseFloat(text) * 10000); if (text.includes("亿")) return Math.round(parseFloat(text) * 1e8); return parseInt(text.replace(/,/g, ""), 10) || 0; }
function parseDuration(text: string): number | undefined { const p = text.trim().split(":"); if (p.length === 2) return +p[0] * 60 + +p[1]; if (p.length === 3) return +p[0] * 3600 + +p[1] * 60 + +p[2]; return undefined; }
function getByDataE2E(name: string): string | undefined { return document.querySelector(`[data-e2e="${name}"]`)?.textContent?.trim() || undefined; }

// --- Main world hook for subtitle capture ---
function injectMainWorldHook(): void {
  if (document.getElementById("__aimarker_hook")) return;
  const s = document.createElement("script");
  s.id = "__aimarker_hook";
  s.textContent = "(function(){if(window.__amSub)return;window.__amSub=true;var KW=['subtitle','caption','asr','srt','vtt','transcript','lyric'];function isSub(u){u=(u||'').toLowerCase();for(var i=0;i<KW.length;i++){if(u.indexOf(KW[i])>=0)return true;}return false;}function cap(url,text){if(!isSub(url))return;try{var d=JSON.parse(text);window.__amSubData=d;window.dispatchEvent(new CustomEvent('__am_sub',{detail:text.slice(0,100000)}));}catch(e){if(text.length>10){window.__amSubData={__raw:text};window.dispatchEvent(new CustomEvent('__am_sub',{detail:text.slice(0,100000)}));}}}var of=window.fetch;window.fetch=function(){var u=typeof arguments[0]==='string'?arguments[0]:(arguments[0]&&arguments[0].url)||'';var p=of.apply(this,arguments);if(isSub(u)){p.then(function(r){r.clone().text().then(function(t){cap(u,t);}).catch(function(){});}).catch(function(){});}return p;};var oo=XMLHttpRequest.prototype.open,os=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.open=function(m,u){this.__amu=u;return oo.apply(this,arguments);};XMLHttpRequest.prototype.send=function(){var s=this;this.addEventListener('load',function(){if(isSub(s.__amu)){cap(s.__amu,s.responseText||'');}});return os.apply(this,arguments);};})();";
  document.documentElement.appendChild(s);
}

function waitForSubtitleData(timeoutMs = 10000): Promise<string | null> {
  return new Promise((resolve) => {
    const w = window as unknown as { __amSubData?: unknown };
    if (w.__amSubData) { resolve(JSON.stringify(w.__amSubData)); return; }
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; window.removeEventListener("__am_sub", h); resolve(null); } }, timeoutMs);
    const h = (e: Event) => { if (!done) { done = true; clearTimeout(timer); window.removeEventListener("__am_sub", h); resolve((e as CustomEvent).detail as string); } };
    window.addEventListener("__am_sub", h);
  });
}

function parseSubtitleData(raw: string): { subtitle: string; segments?: SubtitleSegment[] } {
  try {
    const data = JSON.parse(raw);
    const segs: SubtitleSegment[] = [];
    let items: Array<Record<string, unknown>> | null = null;
    if (Array.isArray(data)) items = data;
    else if (data.utterances) items = data.utterances;
    else if (data.subtitle_info) items = data.subtitle_info;
    else if (data.data?.subtitle) items = data.data.subtitle;
    else if (data.data?.utterances) items = data.data.utterances;
    else if (data.result?.utterances) items = data.result.utterances;
    if (items) {
      for (const item of items) {
        const start = (item.start ?? item.start_mtime ?? item.begin_time ?? 0) as number;
        const end = (item.end ?? item.end_mtime ?? item.end_time ?? 0) as number;
        const text = (item.text || item.content || "") as string;
        if (text) segs.push({ start: Math.round(start / 1000), end: Math.round(end / 1000), text: text.trim() });
      }
    }
    const subtitle = segs.map((s) => s.text).join(" ");
    if (!subtitle && data.__raw) return { subtitle: String(data.__raw).slice(0, 10000) };
    return { subtitle, segments: segs.length > 0 ? segs : undefined };
  } catch { return { subtitle: raw.slice(0, 10000) }; }
}

async function enableSubtitle(): Promise<void> {
  for (const el of Array.from(document.querySelectorAll("span, div"))) {
    const t = el.textContent?.trim() || "";
    if ((t === "字幕" || t === "不开启") && el.children.length === 0) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width > 0 && r.height > 0) { (el as HTMLElement).click(); return; }
    }
  }
}

// --- Phase 1: favorites list ---
function extractVideoCardFromList(card: Element): Partial<VideoItem> | null {
  const link = card.querySelector("a[href*='/video/']") as HTMLAnchorElement;
  if (!link) return null;
  const idMatch = link.href.match(/\/video\/(\d+)/);
  if (!idMatch) return null;
  const titleEl = card.querySelector("[class*='title'],[class*='desc'],[class*='content']") || link;
  const imgEl = card.querySelector("img") as HTMLImageElement;
  const authorEl = card.querySelector("[class*='author'],[class*='nickname']");
  return { id: idMatch[1], title: titleEl?.textContent?.trim() || "", url: link.href, coverUrl: imgEl?.src || undefined, author: authorEl?.textContent?.trim(), tags: extractTags(titleEl?.textContent?.trim() || "") };
}

async function scrollAndCollect(onProgress: (n: number) => void, maxScrolls = 100): Promise<Partial<VideoItem>[]> {
  const seen = new Map<string, Partial<VideoItem>>();
  let last = 0, stable = 0;
  for (let i = 0; i < maxScrolls; i++) {
    document.querySelectorAll("a[href*='/video/']").forEach((a) => {
      let p = a.parentElement;
      while (p && p !== document.body) {
        if (p.querySelector("img") && (p.textContent || "").trim().length > 5) {
          const item = extractVideoCardFromList(p);
          if (item?.id && !seen.has(item.id)) seen.set(item.id, item);
          break;
        }
        p = p.parentElement;
      }
    });
    onProgress(seen.size);
    if (seen.size === last) { stable++; if (stable >= 3) break; } else stable = 0;
    last = seen.size;
    window.scrollBy(0, window.innerHeight * 0.8);
    await sleep(800 + Math.random() * 400);
  }
  return Array.from(seen.values());
}

async function handleCollectList(): Promise<{ videos: VideoItem[]; error?: string }> {
  if (!window.location.href.includes("showTab=favorite")) return { videos: [], error: "NOT_ON_FAVORITE_PAGE" };
  const cards = await scrollAndCollect((c) => {
    chrome.runtime.sendMessage({ type: "COLLECT_PROGRESS", payload: { current: c, total: 0, status: "阶段1：采集列表... " + c + " 个" } as CollectProgress }).catch(() => {});
  });
  return { videos: cards.map((c) => ({ id: c.id!, title: c.title || "", url: c.url!, coverUrl: c.coverUrl, author: c.author, tags: c.tags || [], source: "douyin", processed: false })) };
}

// --- Phase 2: detail extraction ---
async function waitForDetailLoad(timeoutMs = 20000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (document.querySelector("[data-e2e='detail-video-info']") || document.querySelector("[data-e2e='user-info']")) return true;
    await sleep(500);
  }
  return false;
}

function extractChaptersAndSummary(): { aiSummary?: string; chapters?: ChapterInfo[] } {
  const result: { aiSummary?: string; chapters?: ChapterInfo[] } = {};
  const player = document.querySelector("[data-e2e='player-container']") || document.querySelector(".xgplayer");
  if (!player) return result;

  // AI summary: longest leaf div text, excluding recommended video descriptions
  const allDivs = player.querySelectorAll("div");
  for (const d of allDivs) {
    if (d.children.length === 0) {
      const t = (d.textContent || "").trim();
      if (t.length > 50) {
        let isRecommend = false;
        let cur = d.parentElement;
        while (cur && cur !== player) {
          const cls = (cur.className || "").toString();
          if (cls.includes("desc") || cls.includes("rightCt") || cls.includes("autoplay")) { isRecommend = true; break; }
          cur = cur.parentElement;
        }
        if (!isRecommend) { result.aiSummary = t; break; }
      }
    }
  }

  // Chapters: time code divs (not player UI)
  const timePattern = /^\d{1,2}:\d{2}$/;
  const uiCls = ["time-current", "time-duration", "progress", "xgplayer-progress"];
  const timeEls: HTMLElement[] = [];
  for (const d of allDivs) {
    if (d.children.length === 0) {
      const t = (d.textContent || "").trim();
      if (timePattern.test(t)) {
        const cls = (d.className || "").toString();
        if (!uiCls.some((uc) => cls.includes(uc))) timeEls.push(d as HTMLElement);
      }
    }
  }
  if (timeEls.length === 0) return result;

  const chapters: ChapterInfo[] = [];
  for (const timeEl of timeEls) {
    const time = (timeEl.textContent || "").trim();
    const parent = timeEl.parentElement;
    const sibs = parent ? Array.from(parent.children) : [];
    const idx = sibs.indexOf(timeEl);
    let title = "", content = "";
    for (let j = idx + 1; j < sibs.length; j++) {
      const st = (sibs[j].textContent || "").trim();
      if (st.length > 0 && st.length < 100 && st !== time) { title = st; break; }
    }
    // chapter detail from sibling P elements
    if (idx + 1 < sibs.length) {
      const titleEl = sibs[idx + 1];
      const p = titleEl.querySelector("p");
      if (p) { content = (p.textContent || "").trim(); title = title.replace(content, "").trim() || title; }
    }
    chapters.push({ time, title, content: content && content !== title ? content : undefined });
  }

  // Distribute P element details to chapters
  const detailTexts: string[] = [];
  for (const p of player.querySelectorAll("p")) {
    const t = (p.textContent || "").trim();
    if (t.length > 10 && t.length < 200) detailTexts.push(t);
  }
  if (detailTexts.length > 0 && chapters.length > 0) {
    for (let i = 0; i < chapters.length && i < detailTexts.length; i++) {
      if (!chapters[i].content) chapters[i].content = detailTexts[i];
    }
  }

  result.chapters = chapters;
  return result;
}

async function collectSubtitle(): Promise<{ subtitle?: string; subtitleSegments?: SubtitleSegment[] }> {
  injectMainWorldHook();
  await sleep(300);
  await enableSubtitle();
  await sleep(500);
  await enableSubtitle();
  await sleep(1000);
  const raw = await waitForSubtitleData(8000);
  if (raw) return parseSubtitleData(raw);
  // Fallback: DOM rendered subtitles
  const track = document.querySelector(".xg-text-track");
  if (track?.textContent?.trim()) return { subtitle: track.textContent.trim() };
  return {};
}

async function handleExtractDetail(videoId: string): Promise<{ detail: VideoDetail; error?: string }> {
  const loaded = await waitForDetailLoad();
  if (!loaded) return { detail: { id: videoId, tags: [] }, error: "timeout" };
  await sleep(3000); // extra wait for player render
  const detail: VideoDetail = { id: videoId, tags: [] };
  const desc = getByDataE2E("detail-video-info");
  if (desc) { detail.desc = desc.replace(/^展开$/, "").trim(); detail.tags = extractTags(detail.desc); }
  const ui = getByDataE2E("user-info");
  if (ui) detail.author = ui.split(/粉丝|获赞|关注/)[0]?.trim() || undefined;
  const digg = getByDataE2E("video-player-digg"); if (digg) detail.likeCount = parseCount(digg);
  const cmt = getByDataE2E("feed-comment-icon"); if (cmt) detail.commentCount = parseCount(cmt);
  const col = getByDataE2E("video-player-collect"); if (col) detail.collectCount = parseCount(col);
  const shr = getByDataE2E("video-player-share") || getByDataE2E("video-share-icon-container"); if (shr) detail.shareCount = parseCount(shr);
  const pub = getByDataE2E("detail-video-publish-time"); if (pub) detail.publishTime = pub;
  const vd = getByDataE2E("video-detail");
  if (vd) { const m = vd.match(/(\d{1,2}:\d{2})\s*\/\s*(\d{1,2}:\d{2})/); if (m) detail.duration = parseDuration(m[2]); }
  const vel = document.querySelector("video") as HTMLVideoElement;
  if (vel?.poster) detail.coverUrl = vel.poster;
  const cs = extractChaptersAndSummary();
  detail.aiSummary = cs.aiSummary;
  detail.chapters = cs.chapters;
const sub = await collectSubtitle();
 // 直接使用字幕，不做过滤（抖音 ASR 字幕质量可靠）
 detail.subtitle = sub.subtitle;
 detail.subtitleSegments = sub.subtitleSegments;
  // 组装 content（可读的内容正文）
  const parts: string[] = [];
  if (detail.aiSummary) parts.push(detail.aiSummary);
  if (detail.chapters && detail.chapters.length > 0) {
    for (const ch of detail.chapters) {
      let line = ch.time + " " + ch.title;
      if (ch.content) line += "\n" + ch.content;
      parts.push(line);
    }
  }
  if (detail.subtitle) parts.push(detail.subtitle);
  detail.content = parts.join("\n\n");

  return { detail };
}

// --- Entry ---
if (window.location.hostname === "www.douyin.com") {
  chrome.runtime.onMessage.addListener((msg: Message, _s, sendResponse) => {
    if (msg.type === "START_COLLECT") { handleCollectList().then((r) => sendResponse(r)); return true; }
    if (msg.type === "EXTRACT_DETAIL") { handleExtractDetail((msg.payload as { videoId: string }).videoId).then((r) => sendResponse(r)); return true; }
  });
}

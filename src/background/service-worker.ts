import type { Message, VideoItem, VideoDetail, LLMResult, CollectProgress, SubtitleSegment, ChapterInfo } from "../lib/types";
import { mergeVideos, loadVideos, batchUpdate, getConfig } from "../lib/storage";
import { processAllVideos } from "../lib/llm-client";
import { cleanSubtitle } from "../lib/subtitle";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function sendProgress(type: string, current: number, total: number, status: string) {
  chrome.runtime.sendMessage({ type, payload: { current, total, status } as CollectProgress }).catch(() => {});
}

function sendToTab(tabId: number, message: Message): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}

function waitForTabComplete(tabId: number, timeoutMs = 30000): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) { resolved = true; chrome.tabs.onUpdated.removeListener(listener); resolve(false); }
    }, timeoutMs);
    const listener = (_tabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (_tabId === tabId && info.status === "complete" && !resolved) {
        resolved = true; clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve(true);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function checkDouyinLogin(): Promise<boolean> {
  try {
    const cookie = await chrome.cookies.get({ url: "https://www.douyin.com", name: "sessionid" });
    return !!cookie;
  } catch { return false; }
}

async function checkBilibiliLogin(): Promise<boolean> {
  try {
    const cookie = await chrome.cookies.get({ url: "https://www.bilibili.com", name: "SESSDATA" });
    return !!cookie;
  } catch { return false; }
}

// ─── B站 阶段一：API 收藏列表采集 ────────────────────────────

async function collectBilibiliFavorites(onProgress: (status: string) => void): Promise<VideoItem[]> {
  onProgress("B站：获取用户信息...");
  const navResp = await fetch("https://api.bilibili.com/x/web-interface/nav", { credentials: "include" });
  const navData = await navResp.json();
  if (navData.code !== 0 || !navData.data?.mid) throw new Error("B站未登录，请先登录 bilibili.com");
  const mid = navData.data.mid;

  onProgress("B站：获取收藏夹列表...");
  const folderResp = await fetch(
    `https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${mid}`,
    { credentials: "include" },
  );
  const folderData = await folderResp.json();
  if (folderData.code !== 0) throw new Error("获取收藏夹失败: " + (folderData.message || ""));
  const folders = folderData.data?.list || [];

  const videos: VideoItem[] = [];
  const seen = new Set<string>();
  for (const folder of folders) {
    let page = 1;
    while (true) {
      onProgress(`B站：采集「${folder.title}」第 ${page} 页...`);
      const resp = await fetch(
        `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${folder.id}&pn=${page}&ps=20&platform=web&order=mtime`,
        { credentials: "include" },
      );
      const data = await resp.json();
      if (data.code !== 0 || !data.data?.medias) break;
      for (const m of data.data.medias) {
        if (!m.bvid || seen.has(m.bvid)) continue;
        seen.add(m.bvid);
        videos.push({
          id: m.bvid,
          title: String(m.title || "").replace(/<[^>]+>/g, ""),
          url: `https://www.bilibili.com/video/${m.bvid}`,
          coverUrl: m.cover,
          author: m.upper?.name,
          duration: m.duration,
          publishTime: m.pubdate ? new Date(m.pubdate * 1000).toISOString().slice(0, 10) : undefined,
          tags: [],
          source: "bilibili",
          processed: false,
        });
      }
      if (data.data.medias.length < 20) break;
      page++;
      await sleep(300);
    }
  }
  return videos;
}

// ─── 阶段一：收藏列表采集 ────────────────────────────────────

// ─── B站 阶段二：API 详情+字幕提取（不需要开标签页）────────────

async function enrichBilibiliVideos(videos: VideoItem[]): Promise<VideoItem[]> {
  if (videos.length === 0) return videos;
  sendProgress("DETAIL_PROGRESS", 0, videos.length, `B站：开始提取详情 (共 ${videos.length} 个)...`);

  const enriched: VideoItem[] = [];
  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    sendProgress("DETAIL_PROGRESS", i, videos.length,
      `B站：提取第 ${i + 1}/${videos.length} 个... ${video.title.slice(0, 20)}`);

    try {
      // 1) 视频基本信息
      const viewResp = await fetch(
        `https://api.bilibili.com/x/web-interface/view?bvid=${video.id}`,
        { credentials: "include" },
      );
      const viewData = await viewResp.json();
      const vd = viewData.code === 0 ? viewData.data : null;
      if (!vd) { enriched.push(video); continue; }

      // 2) 标签
      let tags: string[] = [];
      try {
        const tagResp = await fetch(
          `https://api.bilibili.com/x/tag/archive/tags?bvid=${video.id}`,
          { credentials: "include" },
        );
        const tagData = await tagResp.json();
        if (tagData.code === 0 && Array.isArray(tagData.data)) {
          tags = tagData.data.map((t: Record<string, unknown>) => String(t.tag_name || "")).filter(Boolean);
        }
      } catch { /* tags optional */ }

      // 3) 字幕
      let subtitle: string | undefined;
      let subtitleSegments: SubtitleSegment[] | undefined;
      const aid = vd.aid;
      const cid = vd.cid;
      if (aid && cid) {
        try {
          const playerResp = await fetch(
            `https://api.bilibili.com/x/player/v2?aid=${aid}&cid=${cid}`,
            { credentials: "include" },
          );
          const playerData = await playerResp.json();
          const subs = playerData?.data?.subtitle?.subtitles;
          if (Array.isArray(subs) && subs.length > 0) {
            const zhSub = subs.find((s: Record<string, unknown>) =>
              String(s.lan || "").includes("zh")) || subs[0];
            let subUrl = String(zhSub.subtitle_url || "");
            if (subUrl.startsWith("//")) subUrl = "https:" + subUrl;
            const subResp = await fetch(subUrl);
            const subData = await subResp.json();
            if (Array.isArray(subData.body)) {
              subtitleSegments = subData.body.map((item: Record<string, unknown>) => ({
                start: Math.round(Number(item.from || 0)),
                end: Math.round(Number(item.to || 0)),
                text: String(item.content || "").trim(),
              })).filter((seg: SubtitleSegment) => seg.text.length > 0);
             subtitle = subtitleSegments.map((s) => s.text).join(" ");
           }
         }
       } catch { /* subtitle optional */ }
     }

      // 3.5) 字幕质量过滤：剔除纯音乐标记等垃圾内容
      if (subtitle) {
        const cleaned = cleanSubtitle(subtitle, subtitleSegments);
        if (!cleaned) {
          subtitle = undefined;
          subtitleSegments = undefined;
        } else {
          subtitle = cleaned.subtitle;
          subtitleSegments = cleaned.segments;
        }
      }

      // 3.6) 多P视频：用分P列表生成章节
      const pages = vd.pages;
      if (Array.isArray(pages) && pages.length > 1) {
        chapters = pages.map((p: Record<string, unknown>) => ({
          time: "P" + (p.page || "?"),
          title: String(p.part || "").slice(0, 80),
          content: undefined,
        }));
      }

     // 4) 章节解析（从简介时间轴）
      let chapters: ChapterInfo[] | undefined;
      const desc = String(vd.desc || "");
      if (desc) {
        const lines = desc.split("\n");
        const timeRe = /(\d{1,2}:\d{2}(?::\d{2})?)\s*(.+)/;
        const found: ChapterInfo[] = [];
        for (const line of lines) {
          const m = line.trim().match(timeRe);
          if (m && m[2] && m[2].trim().length > 0) found.push({ time: m[1], title: m[2].trim() });
        }
        if (found.length > 0) chapters = found;
      }

      // 5) 组装 content
      const parts: string[] = [];
      if (desc) parts.push(desc);
      if (tags.length > 0) parts.push("标签: " + tags.join(" "));
      if (chapters) for (const ch of chapters) parts.push(`${ch.time} ${ch.title}`);
      if (subtitle) parts.push(subtitle);

      const stat = vd.stat || {};
      enriched.push({
        ...video,
       title: String(vd.title || video.title),
        desc: desc || undefined,
       author: vd.owner?.name || video.author,
        coverUrl: vd.pic || video.coverUrl,
        duration: vd.duration || video.duration,
        likeCount: stat.like,
        commentCount: stat.reply,
        collectCount: stat.favorite,
        shareCount: stat.share,
        publishTime: vd.pubdate ? new Date(vd.pubdate * 1000).toISOString().slice(0, 10) : video.publishTime,
        tags,
        chapters,
        subtitle,
        subtitleSegments,
        content: parts.join("\n\n"),
      });
    } catch {
      enriched.push(video);
    }
    await sleep(300 + Math.random() * 200);
  }

  sendProgress("DETAIL_PROGRESS", videos.length, videos.length, "B站：详情提取完成");
  return enriched;
}

async function collectFavoritesList(): Promise<VideoItem[]> {
  sendProgress("COLLECT_PROGRESS", 0, 0, "阶段1：正在打开收藏夹页面...");
  const tab = await chrome.tabs.create({
    url: "https://www.douyin.com/user/self?showTab=favorite_collection", active: true,
  });
  const loaded = await waitForTabComplete(tab.id!);
  if (!loaded) throw new Error("收藏夹页面加载超时");
  await sleep(3000);
  sendProgress("COLLECT_PROGRESS", 0, 0, "阶段1：正在采集收藏列表...");
  const response = await sendToTab(tab.id!, { type: "START_COLLECT" }) as { videos: VideoItem[]; error?: string } | undefined;
  await chrome.tabs.remove(tab.id!).catch(() => {});
  if (!response?.videos) throw new Error(response?.error || "采集失败");
  return response.videos;
}

// ─── 阶段二：逐个提取视频详情（含字幕）────────────────────────

async function enrichAllVideos(videos: VideoItem[], platform = "douyin"): Promise<VideoItem[]> {
  if (videos.length === 0) return videos;
  sendProgress("DETAIL_PROGRESS", 0, videos.length, `阶段2：开始提取视频内容 (共 ${videos.length} 个)...`);

  const tab = await chrome.tabs.create({ url: videos[0].url, active: true });

  const enrichedVideos: VideoItem[] = [];

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    sendProgress("DETAIL_PROGRESS", i, videos.length,
      `阶段2：提取第 ${i + 1}/${videos.length} 个（含字幕）... ${video.title.slice(0, 20)}`);

    await chrome.tabs.update(tab.id!, { url: video.url });
    const loaded = await waitForTabComplete(tab.id!);
    if (!loaded) { enrichedVideos.push(video); continue; }
    await sleep(2000);

    try {
      const detail = await sendToTab(tab.id!, { type: "EXTRACT_DETAIL", payload: { videoId: video.id } }) as { detail: VideoDetail; error?: string } | undefined;
      if (detail?.detail) {
        const d = detail.detail;
        enrichedVideos.push({
          ...video,
         title: platform === "bilibili" ? video.title : (d.desc || video.title),
          desc: d.desc || video.desc,
         author: d.author || video.author,
          coverUrl: d.coverUrl || video.coverUrl,
          duration: d.duration,
          likeCount: d.likeCount,
          commentCount: d.commentCount,
          collectCount: d.collectCount,
          shareCount: d.shareCount,
          publishTime: d.publishTime,
          tags: d.tags.length > 0 ? d.tags : video.tags,
          aiSummary: d.aiSummary,
          chapters: d.chapters,
          subtitle: d.subtitle,
          content: d.content,
          subtitleSegments: d.subtitleSegments,
        });
      } else {
        enrichedVideos.push(video);
      }
    } catch {
      enrichedVideos.push(video);
    }
    await sleep(1000 + Math.random() * 500);
  }

  await chrome.tabs.remove(tab.id!).catch(() => {});
  sendProgress("DETAIL_PROGRESS", videos.length, videos.length, "阶段2：内容提取完成");
  return enrichedVideos;
}

// ─── 大模型分类 ──────────────────────────────────────────────

async function handleProcessVideos(): Promise<void> {
  const config = await getConfig();
  if (!config.apiKey) {
    chrome.runtime.sendMessage({ type: "PROCESS_ERROR", payload: "未配置 API Key" }).catch(() => {});
    return;
  }
  const videos = await loadVideos();
  const unprocessed = videos.filter((v) => !v.processed);
  if (unprocessed.length === 0) {
    chrome.runtime.sendMessage({ type: "PROCESS_COMPLETE", payload: { processed: 0 } }).catch(() => {});
    return;
  }
  try {
    const results = await processAllVideos(videos, config, (current, total) => {
      sendProgress("PROCESS_PROGRESS", current, total, `AI 分类中... ${current}/${total}`);
    });
    const updates = results.map((r: LLMResult) => ({
      id: r.id, patch: { category: r.category, summary: r.summary, keywords: r.tags, processed: true },
    }));
    await batchUpdate(updates);
    chrome.runtime.sendMessage({ type: "PROCESS_COMPLETE", payload: { processed: results.length } }).catch(() => {});
  } catch (e) {
    chrome.runtime.sendMessage({ type: "PROCESS_ERROR", payload: (e as Error).message }).catch(() => {});
  }
}

// ─── 消息路由 ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  switch (msg.type) {
    case "CHECK_LOGIN":
      (async () => {
        const config = await getConfig();
        const platform = (msg.payload as { platform?: string })?.platform || config.platform || "douyin";
        const loggedIn = platform === "bilibili"
          ? await checkBilibiliLogin()
          : await checkDouyinLogin();
        sendResponse({ loggedIn });
      })();
      return true;
    case "OPEN_DASHBOARD":
      chrome.tabs.create({ url: chrome.runtime.getURL("src/dashboard/index.html") }).then(() => sendResponse({ ok: true }));
      return true;
    case "START_COLLECT":
      (async () => {
        try {
          const config = await getConfig();
          const platform = config.platform || "douyin";
          let videos: VideoItem[];
          if (platform === "bilibili") {
            videos = await collectBilibiliFavorites((status) =>
              sendProgress("COLLECT_PROGRESS", 0, 0, status));
          } else {
            videos = await collectFavoritesList();
          }
          if (config.collectLimit > 0 && videos.length > config.collectLimit) {
            videos = videos.slice(0, config.collectLimit);
          }
          await mergeVideos(videos);
          sendProgress("COLLECT_PROGRESS", videos.length, videos.length, `阶段1完成：发现 ${videos.length} 个视频`);
          const enriched = platform === "bilibili"
            ? await enrichBilibiliVideos(videos)
            : await enrichAllVideos(videos, platform);
          await mergeVideos(enriched);
          sendProgress("COLLECT_COMPLETE", enriched.length, enriched.length, "采集完成");
          sendResponse({ count: enriched.length, videos: enriched });
        } catch (e) {
          sendResponse({ error: (e as Error).message });
        }
      })();
      return true;
    case "PROCESS_VIDEOS":
      handleProcessVideos().then(() => sendResponse({ ok: true }));
      return true;
    case "GET_VIDEOS":
      loadVideos().then((videos) => sendResponse({ videos }));
      return true;
    default:
      return false;
  }
});

chrome.runtime.onInstalled.addListener(() => { console.log("AiMarker installed"); });

import type { Message, VideoItem, VideoDetail, LLMResult, CollectProgress } from "../lib/types";
import { mergeVideos, loadVideos, batchUpdate, getConfig } from "../lib/storage";
import { processAllVideos } from "../lib/llm-client";

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

// ─── 阶段一：收藏列表采集 ────────────────────────────────────

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

async function enrichAllVideos(videos: VideoItem[]): Promise<VideoItem[]> {
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
          title: d.desc || video.title,
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
      checkDouyinLogin().then((loggedIn) => sendResponse({ loggedIn }));
      return true;
    case "OPEN_DASHBOARD":
      chrome.tabs.create({ url: chrome.runtime.getURL("src/dashboard/index.html") }).then(() => sendResponse({ ok: true }));
      return true;
    case "START_COLLECT":
      (async () => {
        try {
          const config = await getConfig();
          let videos = await collectFavoritesList();
          if (config.collectLimit > 0 && videos.length > config.collectLimit) {
            videos = videos.slice(0, config.collectLimit);
          }
          await mergeVideos(videos);
          sendProgress("COLLECT_PROGRESS", videos.length, videos.length, `阶段1完成：发现 ${videos.length} 个视频`);
          const enriched = await enrichAllVideos(videos);
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

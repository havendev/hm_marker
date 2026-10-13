import type { VideoItem, UserConfig } from "./types";

const VIDEOS_KEY = "ai_marker_videos";
const CONFIG_KEY = "ai_marker_config";

const DEFAULT_CONFIG: UserConfig = {
  apiKey: "",
  model: "deepseek-chat",
  platform: "douyin",
  autoCategorize: true, collectLimit: 0,
};

export async function saveVideos(videos: VideoItem[]): Promise<void> {
  await chrome.storage.local.set({ [VIDEOS_KEY]: videos });
}

export async function loadVideos(): Promise<VideoItem[]> {
  const result = await chrome.storage.local.get(VIDEOS_KEY);
  return (result[VIDEOS_KEY] as VideoItem[]) || [];
}

export async function mergeVideos(newVideos: VideoItem[]): Promise<VideoItem[]> {
  const existing = await loadVideos();
  const map = new Map<string, VideoItem>();
  for (const v of existing) map.set(v.id, v);
  for (const nv of newVideos) {
    const old = map.get(nv.id);
    if (old && old.processed) {
      map.set(nv.id, { ...nv, category: old.category, summary: old.summary, keywords: old.keywords, processed: true });
    } else {
      map.set(nv.id, nv);
    }
  }
  const merged = Array.from(map.values());
  await saveVideos(merged);
  return merged;
}

export async function updateVideo(id: string, patch: Partial<VideoItem>): Promise<void> {
  const videos = await loadVideos();
  const idx = videos.findIndex((v) => v.id === id);
  if (idx >= 0) {
    videos[idx] = { ...videos[idx], ...patch };
    await saveVideos(videos);
  }
}

export async function batchUpdate(updates: { id: string; patch: Partial<VideoItem> }[]): Promise<void> {
  const videos = await loadVideos();
  const map = new Map(videos.map((v) => [v.id, v]));
  for (const { id, patch } of updates) {
    const v = map.get(id);
    if (v) map.set(id, { ...v, ...patch });
  }
  await saveVideos(Array.from(map.values()));
}

export async function deleteVideo(id: string): Promise<void> {
  const videos = await loadVideos();
  const filtered = videos.filter((v) => v.id !== id);
  await saveVideos(filtered);
}

export async function clearVideos(): Promise<void> {
  await chrome.storage.local.remove(VIDEOS_KEY);
}

export async function getConfig(): Promise<UserConfig> {
  const result = await chrome.storage.local.get(CONFIG_KEY);
  return { ...DEFAULT_CONFIG, ...(result[CONFIG_KEY] as Partial<UserConfig> || {}) };
}

export async function saveConfig(config: Partial<UserConfig>): Promise<UserConfig> {
  const current = await getConfig();
  const updated = { ...current, ...config };
  await chrome.storage.local.set({ [CONFIG_KEY]: updated });
  return updated;
}

export function onVideosChanged(callback: (videos: VideoItem[]) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[VIDEOS_KEY]) {
      callback(changes[VIDEOS_KEY].newValue as VideoItem[] || []);
    }
  });
}

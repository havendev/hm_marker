// 字幕片段（带时间戳）
export interface SubtitleSegment {
  start: number;
  end: number;
  text: string;
}

// 视频条目
export interface VideoItem {
  id: string;
  title: string;
  url: string;
  coverUrl?: string;
  author?: string;
  duration?: number;
  likeCount?: number;
  commentCount?: number;
  collectCount?: number;
  shareCount?: number;
  publishTime?: string;
  tags: string[];
  source: string;
  aiSummary?: string;
  chapters?: ChapterInfo[];
  subtitle?: string;
  subtitleSegments?: SubtitleSegment[];
  content?: string;
  category?: string;
  summary?: string;
  keywords?: string[];
  processed: boolean;
}

export interface ChapterInfo {
  time: string;
  title: string;
  content?: string;
}

export interface UserConfig {
  apiKey: string;
  model: string;
  platform: string;
  autoCategorize: boolean;
  collectLimit: number;
}

export interface LLMResult {
  id: string;
  category: string;
  summary: string;
  tags: string[];
}

// 视频详情页提取结果
export interface VideoDetail {
  id: string;
  desc?: string;
  author?: string;
  coverUrl?: string;
  duration?: number;
  likeCount?: number;
  commentCount?: number;
  collectCount?: number;
  shareCount?: number;
  publishTime?: string;
  tags: string[];
  aiSummary?: string;
  chapters?: ChapterInfo[];
  subtitle?: string;
  subtitleSegments?: SubtitleSegment[];
  content?: string;
}

export const DEFAULT_CATEGORIES = [
  "美食", "科技", "知识科普", "搞笑", "旅游", "音乐",
  "健身", "影视", "游戏", "生活技巧", "时尚穿搭", "萌宠",
  "时事新闻", "财经", "教育", "其他",
] as const;

export type MessageType =
  | "CHECK_LOGIN"
  | "LOGIN_STATUS"
  | "START_COLLECT"
  | "COLLECT_PROGRESS"
  | "COLLECT_COMPLETE"
  | "COLLECT_ERROR"
  | "EXTRACT_DETAIL"
  | "DETAIL_EXTRACTED"
  | "DETAIL_PROGRESS"
  | "PROCESS_VIDEOS"
  | "PROCESS_PROGRESS"
  | "PROCESS_COMPLETE"
  | "PROCESS_ERROR"
  | "GET_VIDEOS"
  | "OPEN_DASHBOARD";

export interface Message<T = unknown> {
  type: MessageType;
  payload?: T;
}

export interface CollectProgress {
  current: number;
  total: number;
  status: string;
}

import type { VideoItem, LLMResult, UserConfig } from "./types";
import { DEFAULT_CATEGORIES } from "./types";

const API_URL = "https://api.deepseek.com/v1/chat/completions";
const BATCH_SIZE = 10;

function buildPrompt(videos: VideoItem[]): string {
  const categoryList = DEFAULT_CATEGORIES.join("、");
  const videoTexts = videos.map((v, i) => {
    const parts: string[] = [`[${i}] id: ${v.id}`, `标题: ${v.title}`];
    if (v.tags.length > 0) parts.push(`标签: ${v.tags.join(" ")}`);
    if (v.aiSummary) parts.push(`AI摘要: ${v.aiSummary}`);
    if (v.chapters && v.chapters.length > 0) {
      const ch = v.chapters.map((c) => `${c.time} ${c.title}${c.content ? ": " + c.content : ""}`).join("; ");
      parts.push(`章节: ${ch}`);
    }
    // 字幕是理解视频内容的最佳数据源
    if (v.subtitle) {
      // 截取前 800 字，避免 prompt 过长
      parts.push(`字幕: ${v.subtitle.slice(0, 800)}`);
    }
    if (v.author) parts.push(`作者: ${v.author}`);
    return parts.join("\n");
  });
  const ids = videos.map((v) => `"${v.id}"`).join(", ");
  return `你是一个视频内容分类助手。请对以下每个视频进行分类和摘要。

可选分类：${categoryList}
如果以上分类都不合适，可以自定义一个简短分类名。

要求：
1. category: 归入最合适的分类
2. summary: 用一句话概括视频核心内容（不超过30字）
3. tags: 提取2-3个关键词

以下是 ${videos.length} 个视频：

${videoTexts.join("\n\n---\n\n")}

请以 JSON 数组格式输出结果，不要包含其他文字。格式：
[{"id": "视频id", "category": "分类名", "summary": "简要描述", "tags": ["关键词1","关键词2"]}]

id 必须从以下列表中取值: [${ids}]`;
}

function parseResults(response: string, videos: VideoItem[]): LLMResult[] {
  let cleaned = response.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed.map((item, idx) => ({
        id: item.id || videos[idx]?.id || "",
        category: String(item.category || "其他"),
        summary: String(item.summary || ""),
        tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
      }));
    }
  } catch {
    const lines = cleaned.split("\n");
    for (const line of lines) {
      try {
        const obj = JSON.parse(line.trim());
        if (Array.isArray(obj)) return obj;
      } catch { /* skip */ }
    }
  }
  return [];
}

export async function processBatch(videos: VideoItem[], config: UserConfig): Promise<LLMResult[]> {
  if (!config.apiKey) throw new Error("未配置 API Key");
  const prompt = buildPrompt(videos);
  const resp = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model || "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 2000,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`DeepSeek API 错误 (${resp.status}): ${errText.slice(0, 200)}`);
  }
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || "";
  return parseResults(content, videos);
}

export async function processAllVideos(
  videos: VideoItem[],
  config: UserConfig,
  onProgress?: (current: number, total: number) => void,
): Promise<LLMResult[]> {
  const unprocessed = videos.filter((v) => !v.processed);
  if (unprocessed.length === 0) return [];
  const allResults: LLMResult[] = [];
  let done = 0;
  for (let i = 0; i < unprocessed.length; i += BATCH_SIZE) {
    const batch = unprocessed.slice(i, i + BATCH_SIZE);
    const results = await processBatch(batch, config);
    allResults.push(...results);
    done += batch.length;
    onProgress?.(done, unprocessed.length);
  }
  return allResults;
}

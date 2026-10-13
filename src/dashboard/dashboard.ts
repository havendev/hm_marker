import type { VideoItem } from "../lib/types";
import { loadVideos, onVideosChanged, deleteVideo, clearVideos } from "../lib/storage";

let allVideos: VideoItem[] = [];
let activeCategory = "all";
let activeSource = "all";
let searchQuery = "";
let sortBy = "category";
let viewMode = "grid";
let expandedSubtitles = new Set<string>();
let expandedContents = new Set<string>();

const $ = (id: string) => document.getElementById(id)!;
const categoryNav = $("category-nav");
const videoList = $("video-list");
const emptyState = $("empty-state");
const totalBadge = $("total-badge");
const searchInput = $("search") as HTMLInputElement;
const sortSelect = $("sort-select") as HTMLSelectElement;
const viewGridBtn = $("view-grid");
const viewListBtn = $("view-list");

function getCategories(): Map<string, number> {
  const scoped = activeSource !== "all" ? allVideos.filter((v) => v.source === activeSource) : allVideos;
  const map = new Map<string, number>();
  map.set("全部", scoped.length);
  map.set("未分类", scoped.filter((v) => !v.processed).length);
  for (const v of scoped) {
    if (v.category) map.set(v.category, (map.get(v.category) || 0) + 1);
  }
  return map;
}

function renderSidebar() {
  const cats = getCategories();
  totalBadge.textContent = String(allVideos.length);
  const entries = Array.from(cats.entries()).sort((a, b) => b[1] - a[1]);
  categoryNav.innerHTML = entries.map(([name, count]) => {
    const key = name === "全部" ? "all" : name === "未分类" ? "unprocessed" : name;
    const active = key === activeCategory ? "active" : "";
    return `<div class="cat-item ${active}" data-cat="${key}"><span>${name}</span><span class="cat-count">${count}</span></div>`;
  }).join("");
  categoryNav.querySelectorAll(".cat-item").forEach((el) => {
    el.addEventListener("click", () => {
      activeCategory = (el as HTMLElement).dataset.cat || "all";
      renderSidebar();
      renderVideos();
    });
  });
}

// 搜索匹配：标题、摘要、标签、字幕
function getFilteredVideos(): VideoItem[] {
  let filtered = allVideos;
  if (activeSource !== "all") {
    filtered = filtered.filter((v) => v.source === activeSource);
  }
  if (activeCategory === "unprocessed") {
    filtered = filtered.filter((v) => !v.processed);
  } else if (activeCategory !== "all") {
    filtered = filtered.filter((v) => v.category === activeCategory);
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter((v) =>
      v.title.toLowerCase().includes(q) ||
      v.summary?.toLowerCase().includes(q) ||
      v.tags.some((t) => t.toLowerCase().includes(q)) ||
      v.keywords?.some((k) => k.toLowerCase().includes(q)) ||
      v.subtitle?.toLowerCase().includes(q) ||
      v.content?.toLowerCase().includes(q) ||
      v.aiSummary?.toLowerCase().includes(q)
    );
  }
  if (sortBy === "category") {
    filtered.sort((a, b) => (a.category || "zzz").localeCompare(b.category || "zzz"));
  } else if (sortBy === "title") {
    filtered.sort((a, b) => a.title.localeCompare(b.title));
  }
  return filtered;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// 高亮搜索关键词
function highlightText(text: string, query: string): string {
  if (!query) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  return escaped.replace(regex, '<mark>$1</mark>');
}

// 提取字幕中关键词附近的上下文片段
function getSubtitleSnippet(subtitle: string, query: string, len = 120): string {
  if (!query) return subtitle.slice(0, len) + (subtitle.length > len ? "..." : "");
  const idx = subtitle.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return subtitle.slice(0, len) + "...";
  const start = Math.max(0, idx - 40);
  const end = Math.min(subtitle.length, idx + query.length + 80);
  return (start > 0 ? "..." : "") + subtitle.slice(start, end) + (end < subtitle.length ? "..." : "");
}

function renderVideos() {
  const videos = getFilteredVideos();
  if (videos.length === 0) {
    videoList.innerHTML = "";
    emptyState.classList.remove("hidden");
    return;
  }
  emptyState.classList.add("hidden");
  videoList.className = viewMode === "grid" ? "video-grid" : "video-grid list-view";

  videoList.innerHTML = videos.map((v) => {
    const processed = v.processed;
    const catTag = processed
      ? `<span class="card-cat-tag">${escapeHtml(v.category || "其他")}</span>`
      : `<span class="card-cat-tag">待分类</span>`;
    const summary = v.summary
      ? `<p class="card-summary">${highlightText(v.summary, searchQuery)}</p>`
      : v.aiSummary
        ? `<p class="card-summary">${highlightText(v.aiSummary.slice(0, 120), searchQuery)}</p>`
        : "";

    // 内容区域
    let contentBlock = "";
    if (v.content && v.content.length > 0) {
      const expanded = expandedContents.has(v.id);
      const snippet = expanded ? v.content : v.content.slice(0, 200) + (v.content.length > 200 ? "..." : "");
      const contentHtml = expanded ? escapeHtml(v.content) : highlightText(snippet, searchQuery);
      contentBlock = `<div class="card-content-block">
        <span class="content-icon">内容</span>
        <p class="content-text ${expanded ? "expanded" : ""}">${contentHtml}</p>
        ${v.content.length > 200 ? `<button class="content-toggle" data-video-id="${v.id}">${expanded ? "收起" : "展开全部内容"}</button>` : ""}
      </div>`;
    }

    // 字幕区域
    let subtitleBlock = "";
    if (v.subtitle) {
      const expanded = expandedSubtitles.has(v.id);
      const snippet = expanded ? v.subtitle : getSubtitleSnippet(v.subtitle, searchQuery);
      const label = expanded ? "收起字幕" : (v.subtitle.length > 0 ? `展开字幕 (${v.subtitle.length}字)` : "");
      const subContent = expanded ? escapeHtml(v.subtitle) : highlightText(snippet, searchQuery);
      subtitleBlock = `<div class="card-subtitle">
        <span class="subtitle-icon">字幕</span>
        <p class="subtitle-text ${expanded ? "expanded" : ""}">${subContent}</p>
        ${label ? `<button class="subtitle-toggle" data-video-id="${v.id}">${expanded ? "收起" : "展开全部字幕"}</button>` : ""}
      </div>`;
    }

    const tags = (v.keywords || v.tags || []).slice(0, 4)
      .map((t) => `<span class="card-tag">#${escapeHtml(t)}</span>`).join("");
    const cover = v.coverUrl
      ? `<img class="card-cover" src="${v.coverUrl}" loading="lazy" alt="" />`
      : `<div class="card-cover"></div>`;
    const author = v.author ? `<span>${escapeHtml(v.author)}</span>` : "";
    const metaParts = [
      author,
      v.publishTime ? `<span>${escapeHtml(v.publishTime)}</span>` : "",
      v.likeCount ? `<span>赞 ${v.likeCount}</span>` : "",
      v.subtitle ? `<span class="has-subtitle">有字幕</span>` : "",
    ].filter(Boolean).join("");

    const sourceName = v.source === "bilibili" ? "B站" : "抖音";
    const sourceCls = v.source === "bilibili" ? "bilibili" : "douyin";
    const sourceBadge = `<span class="source-badge ${sourceCls}">${sourceName}</span>`;
    const deleteRow = `<div class="card-delete-row"><a class="card-link" href="${v.url}" target="_blank">原视频 →</a><button class="card-delete" data-video-id="${v.id}" title="删除">删除</button></div>`;

    return `<div class="video-card ${processed ? "" : "unprocessed"}">${cover}
      <div class="card-body">${catTag}${sourceBadge}
        <p class="card-title">${highlightText(v.title.slice(0, 100), searchQuery)}</p>
        ${summary}
        ${contentBlock}
        ${subtitleBlock}
        <div class="card-meta">${metaParts}</div>
        <div class="card-tags">${tags}</div>
        ${deleteRow}
      </div>
    </div>`;
  }).join("");

  // 绑定删除单个视频
  videoList.querySelectorAll(".card-delete").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const vid = (btn as HTMLElement).dataset.videoId;
      if (vid) {
        await deleteVideo(vid);
        allVideos = await loadVideos();
        renderSidebar();
        renderVideos();
      }
    });
  });

  // 绑定内容展开/收起按钮
  videoList.querySelectorAll(".content-toggle").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const vid = (btn as HTMLElement).dataset.videoId;
      if (vid) {
        if (expandedContents.has(vid)) expandedContents.delete(vid);
        else expandedContents.add(vid);
        renderVideos();
      }
    });
  });

  // 绑定字幕展开/收起按钮
  videoList.querySelectorAll(".subtitle-toggle").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const vid = (btn as HTMLElement).dataset.videoId;
      if (vid) {
        if (expandedSubtitles.has(vid)) expandedSubtitles.delete(vid);
        else expandedSubtitles.add(vid);
        renderVideos();
      }
    });
  });
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function exportJSON() {
  downloadFile(JSON.stringify(allVideos, null, 2), `aimarker_${new Date().toISOString().slice(0, 10)}.json`, "application/json");
}

function exportCSV() {
  const headers = ["id", "title", "url", "category", "summary", "author", "tags", "subtitle", "source"];
  const rows = allVideos.map((v) =>
    [v.id, v.title, v.url, v.category || "", v.summary || "", v.author || "", (v.keywords || v.tags || []).join("; "), (v.subtitle || "").slice(0, 500), v.source]
      .map((s) => `"${String(s).replace(/"/g, '""')}"`).join(",")
  );
  downloadFile("\ufeff" + headers.join(",") + "\n" + rows.join("\n"), `aimarker_${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8");
}

searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value.trim();
  renderVideos();
});

sortSelect.addEventListener("change", () => { sortBy = sortSelect.value; renderVideos(); });

document.querySelectorAll(".source-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".source-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeSource = (btn as HTMLElement).dataset.source || "all";
    renderSidebar();
    renderVideos();
  });
});

viewGridBtn.addEventListener("click", () => {
  viewMode = "grid"; viewGridBtn.classList.add("active"); viewListBtn.classList.remove("active"); renderVideos();
});
viewListBtn.addEventListener("click", () => {
  viewMode = "list"; viewListBtn.classList.add("active"); viewGridBtn.classList.remove("active"); renderVideos();
});

$("btn-export").addEventListener("click", exportJSON);
$("btn-export-csv").addEventListener("click", exportCSV);
$("btn-refresh").addEventListener("click", async () => {
  allVideos = await loadVideos(); renderSidebar(); renderVideos();
});
$("btn-clear-all").addEventListener("click", async () => {
  if (!confirm("确认清空所有已采集的视频？此操作不可撤销。")) return;
  await clearVideos();
  allVideos = [];
  renderSidebar();
  renderVideos();
});

async function init() {
  allVideos = await loadVideos();
  renderSidebar();
  renderVideos();
  onVideosChanged((videos) => { allVideos = videos; renderSidebar(); renderVideos(); });
}

init();

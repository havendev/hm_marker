import type { Message, CollectProgress } from "../lib/types";
import { loadVideos, getConfig, saveConfig } from "../lib/storage";

const $ = (id: string) => document.getElementById(id)!;
const loginDot = $("login-dot");
const loginText = $("login-text");
const btnCollect = $("btn-collect") as HTMLButtonElement;
const btnProcess = $("btn-process") as HTMLButtonElement;
const btnDashboard = $("btn-dashboard") as HTMLButtonElement;
const progressArea = $("progress");
const progressFill = $("progress-fill");
const progressText = $("progress-text");
const statTotal = $("stat-total");
const statProcessed = $("stat-processed");
const apiKeyInput = $("api-key-input") as HTMLInputElement;
const modelSelect = $("model-select") as HTMLSelectElement;
const btnSaveConfig = $("btn-save-config") as HTMLButtonElement;
const collectLimitInput = $("collect-limit-input") as HTMLInputElement;

let isBusy = false;
let currentPlatform = "douyin";

async function checkLogin(): Promise<{ loggedIn: boolean }> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "CHECK_LOGIN", payload: { platform: currentPlatform } } as Message, (resp) => {
      resolve(resp || { loggedIn: false });
    });
  });
}

async function refreshLoginStatus() {
  const { loggedIn } = await checkLogin();
  loginDot.className = `dot ${loggedIn ? "ok" : "err"}`;
  const name = currentPlatform === "bilibili" ? "B站" : "抖音";
  loginText.textContent = loggedIn ? `${name}已登录` : `${name}未登录，请先登录`;
  btnCollect.textContent = `采集${name}收藏`;
  btnCollect.disabled = !loggedIn || isBusy;
}

async function refreshStats() {
  const videos = await loadVideos();
  statTotal.textContent = String(videos.length);
  statProcessed.textContent = String(videos.filter((v) => v.processed).length);
  btnProcess.disabled = isBusy || videos.filter((v) => !v.processed).length === 0;
}

function showProgress(text: string, ratio?: number) {
  progressArea.classList.remove("hidden");
  progressText.textContent = text;
  if (ratio !== undefined) {
    progressFill.style.width = `${Math.min(100, ratio * 100)}%`;
  }
}

function hideProgress() {
  progressArea.classList.add("hidden");
  progressFill.style.width = "0%";
}

// 监听进度消息（采集 + 详情提取 + AI 分类）
chrome.runtime.onMessage.addListener((msg: Message) => {
  const p = msg.payload as CollectProgress;
  if (msg.type === "COLLECT_PROGRESS") {
    showProgress(p.status, p.total > 0 ? p.current / p.total : undefined);
  } else if (msg.type === "DETAIL_PROGRESS") {
    showProgress(p.status, p.total > 0 ? p.current / p.total : undefined);
  } else if (msg.type === "PROCESS_PROGRESS") {
    showProgress(p.status, p.total > 0 ? p.current / p.total : undefined);
  } else if (msg.type === "COLLECT_COMPLETE" || msg.type === "PROCESS_COMPLETE") {
    setTimeout(() => { hideProgress(); refreshStats(); }, 1500);
  }
});

btnCollect.addEventListener("click", () => {
  if (isBusy) return;
  isBusy = true;
  btnCollect.disabled = true;
  showProgress("正在启动采集...");
  chrome.runtime.sendMessage({ type: "START_COLLECT" } as Message, (resp) => {
    isBusy = false;
    btnCollect.disabled = false;
    refreshLoginStatus();
    if (resp?.error) {
      showProgress(`错误: ${resp.error}`);
      setTimeout(() => hideProgress(), 4000);
    } else if (resp?.count) {
      showProgress(`采集完成！共 ${resp.count} 个视频`);
      refreshStats();
      setTimeout(() => hideProgress(), 3000);
    }
  });
});

btnProcess.addEventListener("click", () => {
  if (isBusy) return;
  isBusy = true;
  btnProcess.disabled = true;
  showProgress("AI 分类启动中...");
  chrome.runtime.sendMessage({ type: "PROCESS_VIDEOS" } as Message, () => {
    isBusy = false;
    btnProcess.disabled = false;
    refreshStats();
  });
});

btnDashboard.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" } as Message);
});

btnSaveConfig.addEventListener("click", async () => {
  await saveConfig({ apiKey: apiKeyInput.value.trim(), model: modelSelect.value, collectLimit: parseInt(collectLimitInput.value, 10) || 0 });
  btnSaveConfig.textContent = "已保存";
  setTimeout(() => (btnSaveConfig.textContent = "保存设置"), 2000);
  refreshStats();
});

async function init() {
  const config = await getConfig();
  apiKeyInput.value = config.apiKey;
  collectLimitInput.value = String(config.collectLimit ?? 0);
  modelSelect.value = config.model;
  currentPlatform = config.platform || "douyin";
  document.querySelectorAll(".platform-tab").forEach((t) => {
    t.classList.toggle("active", (t as HTMLElement).dataset.platform === currentPlatform);
  });
  await refreshLoginStatus();
  await refreshStats();
}

init();

// Platform tab switching
document.querySelectorAll(".platform-tab").forEach((tab) => {
  tab.addEventListener("click", async () => {
    document.querySelectorAll(".platform-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    currentPlatform = (tab as HTMLElement).dataset.platform || "douyin";
    await saveConfig({ platform: currentPlatform });
    await refreshLoginStatus();
  });
});

import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
 name: "AiMarker - 视频收藏智能整理",
 version: "0.1.0",
 description: "自动采集并智能分类你的视频收藏，支持抖音、B站等平台",
 permissions: ["storage", "cookies", "tabs", "activeTab"],
 host_permissions: [
   "https://www.douyin.com/*",
   "https://www.bilibili.com/*",
   "https://api.bilibili.com/*",
   "https://*.hdslb.com/*",
   "https://api.deepseek.com/*",
 ],
  action: {
    default_popup: "src/popup/popup.html",
    default_icon: {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png",
    },
  },
  icons: {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png",
  },
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  content_scripts: [
    {
     matches: ["https://www.douyin.com/*"],
     js: ["src/content/douyin.ts"],
     run_at: "document_idle",
   },
   {
     matches: ["https://www.bilibili.com/*"],
     js: ["src/content/bilibili.ts"],
     run_at: "document_idle",
   },
 ],
 web_accessible_resources: [
   {
     resources: ["src/dashboard/index.html"],
     matches: ["https://www.douyin.com/*", "https://www.bilibili.com/*"],
   },
 ],
});

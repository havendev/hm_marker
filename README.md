# AiMarker - 视频收藏智能整理

一个 Chrome 浏览器扩展，自动采集抖音/B站收藏夹视频，利用大模型进行智能分类和摘要，生成可视化分类列表。

## 功能特性

- **双平台支持**：抖音 + B站收藏夹一键采集
- **深度内容提取**：视频标题、简介、标签、字幕、章节时间轴、统计数据
- **字幕采集**：抖音 ASR 字幕、B站 CC/AI 字幕
- **AI 智能分类**：基于 DeepSeek 大模型自动归类和生成摘要
- **全文搜索**：标题、摘要、标签、字幕、内容正文全字段检索
- **可视化 Dashboard**：分类导航、来源筛选、网格/列表视图
- **数据导出**：统一格式 JSON / CSV，方便入库和二次开发
- **隐私优先**：所有数据存储在本地 chrome.storage，不经过第三方服务器

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9
- Chrome 浏览器

### 安装

```bash
git clone https://github.com/havendev/hm_marker.git
cd hm_marker
npm install
npm run build
```

### 加载插件

1. 打开 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择项目的 `dist/` 目录

### 配置

1. 点击浏览器工具栏中的 AiMarker 图标
2. 在「设置」中填入 DeepSeek API Key（[获取地址](https://platform.deepseek.com/api_keys)）
3. 选择目标平台（抖音 / B站）
4. 确保已在浏览器中登录对应平台

### 使用

1. **采集收藏** — 自动打开收藏夹，滚动采集列表后逐个提取详情和字幕
2. **AI 分类** — DeepSeek 自动对视频归类、生成摘要和关键词
3. **查看整理结果** — 在 Dashboard 中浏览、搜索、筛选、导出

## 大模型选择

推荐使用 **DeepSeek-V3**（`deepseek-chat`）：
- 中文理解能力强
- API 成本极低
- 支持 128K 上下文窗口

在插件设置中也可切换为 **DeepSeek-R1**（`deepseek-reasoner`）以获得更强的推理能力。

## 项目结构

```
src/
├── manifest.ts              # Manifest V3 配置
├── background/
│   └── service-worker.ts    # Service Worker：采集流程控制、API 调用、消息路由
├── content/
│   ├── douyin.ts            # 抖音页面采集（DOM 解析 + 字幕 hook）
│   └── bilibili.ts          # B站页面辅助脚本
├── popup/
│   ├── popup.html           # 弹窗界面
│   ├── popup.ts             # 弹窗逻辑（平台切换、登录检测、采集控制）
│   └── popup.css
├── dashboard/
│   ├── index.html           # Dashboard 页面
│   ├── dashboard.ts         # 分类展示、搜索、筛选、导出
│   └── dashboard.css
└── lib/
    ├── types.ts             # 共享类型定义
    ├── storage.ts           # chrome.storage 封装
    ├── llm-client.ts        # DeepSeek API 客户端
    └── subtitle.ts          # 字幕质量过滤
```

## 采集流程

每个平台采用两阶段采集：

### 抖音
1. **阶段一**：打开收藏夹页面，滚动 DOM 采集视频列表（id、标题、封面、作者）
2. **阶段二**：逐个打开视频详情页，提取 AI 总结、章节、ASR 字幕（通过 fetch/XHR hook 拦截）

### B站（全 API，不开标签页）
1. **阶段一**：调用收藏夹 API 获取视频列表（`fav/folder` + `fav/resource`）
2. **阶段二**：逐个调用视频 API 提取详情（`view` + `tag/archive` + `player/v2` 字幕）

## 导出数据格式

JSON 导出采用统一 Schema，所有字段保证存在：

```json
{
  "exportTime": "2024-01-01T00:00:00.000Z",
  "version": "1.0",
  "total": 42,
  "videos": [
    {
      "id": "BV1xxx",
      "source": "bilibili",
      "url": "https://www.bilibili.com/video/BV1xxx",
      "title": "视频标题",
      "description": "视频简介",
      "author": "UP主",
      "coverUrl": "封面地址",
      "duration": 600,
      "publishTime": "2024-01-01",
      "stats": { "likes": 1200, "comments": 50, "favorites": 300, "shares": 20 },
      "tags": ["标签1", "标签2"],
      "chapters": [
        { "time": "0:00", "title": "第一章", "content": "" }
      ],
      "subtitle": {
        "text": "完整字幕文本...",
        "segments": [
          { "start": 0, "end": 3, "text": "大家好" }
        ]
      },
      "content": "完整可检索内容...",
      "aiSummary": "",
      "category": "科技",
      "summary": "一句话摘要",
      "keywords": ["关键词1", "关键词2"],
      "processed": true
    }
  ]
}
```

## 开发

```bash
# 开发模式（文件监听 + 热重载）
npm run dev

# 构建
npm run build
```

## 技术栈

- Chrome Extension Manifest V3
- TypeScript + Vite + @crxjs/vite-plugin
- DeepSeek API（大模型分类）
- chrome.storage.local（本地存储）

## 隐私说明

- 所有采集的视频数据存储在 `chrome.storage.local`，不上传到任何服务器
- 大模型调用时仅传输视频文本信息（标题、字幕、标签），不包含用户身份信息
- API Key 存储在 `chrome.storage.local`，仅在调用 DeepSeek API 时使用

## 开源协议

[MIT License](./LICENSE)

## 贡献

欢迎提交 Issue 和 Pull Request。请阅读 [贡献指南](./CONTRIBUTING.md)。

# AiMarker - 视频收藏智能整理 Chrome 插件

自动采集抖音收藏夹视频，利用 DeepSeek 大模型智能分类和摘要，生成可视化分类列表。

## 快速开始

### 安装

```bash
npm install
npm run build
```

### 加载插件到 Chrome

1. 打开 chrome://extensions/
2. 开启右上角开发者模式
3. 点击加载已解压的扩展程序
4. 选择项目的 dist/ 目录

### 配置

1. 点击浏览器工具栏中的 AiMarker 图标
2. 在设置中填入 DeepSeek API Key
3. 确保已在浏览器中登录抖音

### 使用

1. 点击采集收藏：插件自动打开抖音收藏夹并滚动采集
2. 点击 AI 分类：DeepSeek 自动对视频进行分类和摘要
3. 点击查看整理结果：在 Dashboard 中浏览分类后的视频列表

## 技术栈

- Chrome Extension Manifest V3
- TypeScript + Vite
- DeepSeek-V3 API

## 大模型选择

DeepSeek-V3（deepseek-chat）为主力模型：中文理解顶级，成本极低。

## 项目结构

src/manifest.ts - 插件清单
src/background/ - Service Worker
src/content/douyin.ts - 抖音页面采集脚本
src/popup/ - 弹窗界面
src/dashboard/ - 可视化管理界面
src/lib/ - 共享库（存储、大模型客户端、类型）

## 数据说明

- 所有数据存储在 chrome.storage.local，不经过第三方服务器
- 大模型调用时仅传视频文本信息，不传用户身份
- 支持导出 JSON / CSV

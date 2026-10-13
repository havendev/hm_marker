# 贡献指南

感谢你有兴趣为 AiMarker 贡献代码！

## 开发环境搭建

```bash
git clone https://github.com/havendev/hm_marker.git
cd hm_marker
npm install
npm run build
```

在 Chrome 中加载 `dist/` 目录后即可开始开发调试。

## 提交规范

提交信息使用以下前缀：

- `feat:` 新功能
- `fix:` Bug 修复
- `docs:` 文档更新
- `refactor:` 代码重构
- `chore:` 构建/依赖等杂项

示例：`feat: add support for YouTube favorites`

## 添加新平台支持

如果要支持新的视频平台，需要：

1. 在 `src/content/` 下创建新的 content script
2. 在 `src/manifest.ts` 中添加 host_permissions 和 content_scripts 匹配
3. 在 `src/background/service-worker.ts` 中实现登录检测和采集逻辑
4. 在 `src/popup/popup.html` 中添加平台切换按钮

## Issue 反馈

提交 Issue 时请说明：

- 操作步骤和预期结果
- 实际结果（截图更好）
- 平台（抖音/B站）和浏览器版本
- 是否开启了字幕

## Pull Request

1. Fork 本仓库
2. 创建分支：`git checkout -b feat/your-feature`
3. 提交改动：`git commit -m "feat: ..."`
4. 推送分支：`git push origin feat/your-feature`
5. 发起 Pull Request

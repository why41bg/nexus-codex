# Guide 页面结构

`guide/index.html` 是部署到 GitHub Pages 的客户端配置指南页面，纯 HTML + 内联 CSS，零外部依赖。

## 布局

- **左侧固定侧边栏**（240px）：分组导航，带 scroll spy 自动高亮
- **右侧内容区**：卡片式布局，包含 Hero 区域和各章节

## 侧边栏导航分组

| 分组 | 锚点 | 对应章节 |
|------|------|----------|
| 概述 | `#prerequisites` | 前置条件 |
| 客户端配置 | `#codex-cli` | Codex CLI 配置 |
| 客户端配置 | `#opencode` | opencode 配置 |
| 其他 | `#verify` | 验证配置 |
| 其他 | `#faq` | 常见问题 |

## 章节结构

每个章节是一个 `<section class="card" id="xxx">`，包含：

- `<h2>` — 章节标题（带 emoji 图标）
- `<h3>` — 子标题
- `<p>` — 说明文字
- `.code-block` — 代码块（深色背景 + 语言标签 + 一键复制按钮）
- `.table-wrap > table` — 配置项说明表格（斑马纹 + hover 效果）
- `.faq-item` — FAQ 问答项

## 代码块

```html
<div class="code-block">
  <div class="lang-tag"><span>TOML</span></div>
  <pre><code>...</code></pre>
</div>
```

- 语言标签在 `.lang-tag > span` 中
- 语法高亮通过 `<span class="kw">`、`<span class="st">`、`<span class="cm">`、`<span class="nu">` 手动标注
- 复制按钮由 JS 自动注入，无需手动添加

## 新增章节步骤

1. 在侧边栏 `<nav class="sidebar-nav">` 对应分组中添加 `<a href="#new-id">新章节标题</a>`
2. 在 `<main class="main">` 中添加 `<section class="card" id="new-id">...</section>`
3. 复制按钮和 scroll spy 自动生效，无需额外配置

## 响应式

- 桌面端（>860px）：侧边栏固定 + 内容区右侧
- 移动端（≤860px）：侧边栏折叠为汉堡菜单 + 遮罩层，内容区全宽
- 打印：隐藏侧边栏和导航，Hero 区域去色
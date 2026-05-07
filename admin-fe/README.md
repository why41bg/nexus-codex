# Nexus Codex Admin 管理面板

基于 React + Tailwind CSS 的 Web 管理面板，用于管理 Nexus Codex 账号池、API Key、模型白名单和查看指标数据。

## 环境要求

- Node.js 18+
- pnpm 8+

## 安装

```bash
pnpm install --frozen-lockfile
```

## 环境变量

复制 `.env.example` 为 `.env`：

```bash
cp .env.example .env
```

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `VITE_API_BASE` | 后端 API 地址。开发时留空（Vite 代理转发），生产环境设为后端完整 URL | 空 |

## 开发

```bash
pnpm dev
```

前端运行在 `http://localhost:5173`，开发模式下 `/api` 请求会自动代理到 `http://localhost:3000`（Python 后端）。

确保后端已启动：

```bash
# 在项目根目录
uv run python run.py
```

## 构建

```bash
pnpm build
```

构建产物输出到 `dist/` 目录。

## 部署

将 `dist/` 部署到任意静态托管服务（Nginx、Vercel、Cloudflare Pages、OSS + CDN 等）。

构建时指定后端地址：

```bash
VITE_API_BASE=https://api.yourdomain.com pnpm build
```

## 技术栈

- [React 19](https://react.dev/) — UI 框架
- [Vite 6](https://vitejs.dev/) — 构建工具
- [Tailwind CSS 3](https://tailwindcss.com/) — 样式
- [Recharts](https://recharts.org/) — 图表
- [TypeScript 5](https://www.typescriptlang.org/) — 类型安全

## 登录

访问面板需要输入管理员用户名和密码（通过后端的 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 环境变量配置，默认 `admin/admin`）。登录后服务端签发 session token，前端通过 Bearer token 鉴权。

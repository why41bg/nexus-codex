# AGENTS.md

## 一、项目结构

本项目 **Nexus Codex** 是一个前后端分离的应用，作为 OpenAI API 兼容的 Codex 账户池网关。

### 后端 (`app/`)

- **语言**: Python 3.10+
- **框架**: FastAPI
- **运行时**: Uvicorn
- **主要依赖**:
  - `fastapi` — Web 框架
  - `uvicorn[standard]` — ASGI 服务器
  - `openai` — OpenAI SDK
  - `pydantic` / `pydantic-settings` — 数据校验与配置
  - `sse-starlette` — Server-Sent Events 支持
  - `httpx` — 异步 HTTP 客户端
  - `PyJWT` — JWT 认证
  - `aiofiles` — 异步文件操作
- **包管理**: uv (pyproject.toml + uv.lock)
- **目录结构**:
  - `app/routes/` — 路由层（chat_completions, responses, admin, models）
  - `app/services/` — 服务层（account_pool, metrics_collector, health_check 等）
  - `app/middleware/` — 中间件（auth, rate_limit, ip_ban）
  - `app/models.py` — 数据模型
  - `app/config.py` — 配置

### 前端 (`admin-fe/`)

- **语言**: TypeScript
- **框架**: React 19
- **构建工具**: Vite
- **UI/样式**: TailwindCSS
- **图表**: Recharts
- **包管理**: pnpm
- **目录结构**:
  - `admin-fe/src/components/` — UI 组件（Dashboard、Account 管理、API Key 管理等）
  - `admin-fe/src/contexts/` — React Context（Auth、Theme、Toast）
  - `admin-fe/src/lib/` — 工具函数与 API 封装

---

## 二、Skills（`.skill/` 目录）

| Skill 名称 | 描述 | 路径 |
|------------|------|------|
| `commit-work` | Create high-quality git commits: review/stage intended changes, split into logical commits, and write clear commit messages (including Conventional Commits). Use when the user asks to commit, craft a commit message, stage changes, or split work into multiple commits. | `.skill/commit-work/SKILL.md` |
| `devdocs-sync` | Sync documentation after code changes. Use docs/index.md to locate affected docs and keep them consistent with the codebase. Activate when the user mentions code changes that need doc updates, or asks to refresh/sync documentation. | `.skill/devdocs-sync/SKILL.md` |

---

## 三、关键文档目录

`docs/index.md` 是本项目的关键文档索引入口，包含了所有重要文档的目录导航。需要了解项目文档时，请优先查阅该文件。

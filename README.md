# Nexus Codex

OpenAI API 兼容的 Codex 账号池网关。将多个 ChatGPT Plus 账号统一调度，对外暴露标准 OpenAI API 接口（含原生 token 级流式输出），支持 Codex CLI、opencode、OpenAI SDK 等客户端直接接入。

基于 **Python + FastAPI + OpenAI 官方 Python SDK** 实现，通过 SDK 原生的 `stream=True` 提供真正的 token 级流式响应。

## 环境要求

- Python 3.10+（推荐 3.12）
- [uv](https://docs.astral.sh/uv/) 包管理器
- 每个要接入池的 ChatGPT Plus 账号需提前完成 Codex CLI 登录

## 安装

```bash
git clone <repo-url> nexus-codex
cd nexus-codex
uv sync
```

## 账号准备

服务启动前，需要先为每个 ChatGPT Plus 账号创建独立的 `CODEX_HOME` 目录并完成登录：

```bash
# 为每个账号创建独立目录
mkdir -p ~/.codex-pool/account-1
mkdir -p ~/.codex-pool/account-2

# 用对应账号分别登录
CODEX_HOME=~/.codex-pool/account-1 codex login --device-auth
CODEX_HOME=~/.codex-pool/account-2 codex login --device-auth
```

登录成功后，将账号信息写入 `data/accounts.json`：

```json
[
  {
    "id": "acc-1",
    "codex_home": "/Users/you/.codex-pool/account-1",
    "enabled": true,
    "healthy": true,
    "remark": "account-a@gmail.com",
    "usage_count": 0,
    "last_used_at": null,
    "max_concurrency": 3
  },
  {
    "id": "acc-2",
    "codex_home": "/Users/you/.codex-pool/account-2",
    "enabled": true,
    "healthy": true,
    "remark": "account-b@gmail.com",
    "usage_count": 0,
    "last_used_at": null
  }
]
```

也可以在服务运行后通过管理面板或 Admin API 动态添加账号。

## 环境变量

复制 `.env.example` 为 `.env` 并按需修改：

```bash
cp .env.example .env
```

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务监听端口 | `3000` |
| `HOST` | 服务监听地址 | `0.0.0.0` |
| `REQUEST_TIMEOUT_MS` | 单次请求超时时间（毫秒） | `300000`（5 分钟） |
| `ACQUIRE_TIMEOUT_MS` | 账号池排队超时时间（毫秒） | `30000`（30 秒） |
| `DEFAULT_MAX_CONCURRENCY` | 单账号默认最大并发数（每账号可独立覆盖） | `1` |
| `ADMIN_USERNAME` | 管理面板登录用户名 | `admin` |
| `ADMIN_PASSWORD` | 管理面板登录密码（生产环境务必修改） | `admin` |
| `ADMIN_SESSION_TTL_MS` | 管理面板 session 过期时间（毫秒） | `86400000`（24 小时） |
| `LOG_LEVEL` | 日志级别（`debug` / `info` / `warn` / `error`） | `info` |
| `LOG_FORMAT` | 日志输出格式（`pretty` / `json`） | `pretty` |
| `RATE_LIMIT_MAX` | 单个 API Key 在时间窗口内的最大请求数 | `60` |
| `RATE_LIMIT_WINDOW_MS` | 速率限制滑动窗口大小（毫秒） | `60000`（1 分钟） |

> API Key 和模型白名单存储在 `data/config.json`，通过管理面板配置。首次启动时访问管理面板进行初始化设置。

## 启动

### 开发模式

带热重载：

```bash
uv run uvicorn app.main:app --reload --port 3000
```

### 生产部署

```bash
uv run python run.py
```

或直接使用 uvicorn：

```bash
uv run uvicorn app.main:app --host 0.0.0.0 --port 3000
```

服务启动后日志会输出账号池初始化、健康检查启动和服务监听地址等信息。

验证服务是否正常：

```bash
curl http://localhost:3000/health
```

## 模型切换

用户通过客户端配置中的 `model` 字段选择要使用的模型。可用模型由管理员在管理面板或通过 Admin API 配置白名单，用户可通过 `GET /v1/models` 查询当前可用的模型列表：

```bash
curl -H "Authorization: Bearer sk-key1" http://localhost:3000/v1/models
```

确认可用模型后，在客户端配置中指定即可。以下是各客户端的配置方式。

## 客户端接入

### Codex CLI

在 `~/.codex/config.toml` 中添加（`model` 改为你想使用的模型）：

```toml
model = "codex-mini"
model_provider = "nexus"

[model_providers.nexus]
base_url = "http://localhost:3000/v1"
wire_api = "responses"
env_key = "NEXUS_API_KEY"
```

```bash
export NEXUS_API_KEY="sk-key1"
codex --provider nexus "你的问题"
```

### opencode

在项目根目录创建 `opencode.json`：

```json
{
  "provider": {
    "nexus": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://localhost:3000/v1",
        "apiKey": "sk-key1"
      },
      "models": {
        "codex-mini": {}
      }
    }
  }
}
```

### OpenAI SDK / curl

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-key1" \
  -H "Content-Type: application/json" \
  -d '{"model":"codex-mini","messages":[{"role":"user","content":"Hello!"}],"stream":true}'
```

指定 `reasoning_effort` 控制模型思考深度（可选值：`minimal`、`low`、`medium`、`high`、`xhigh`）：

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-key1" \
  -H "Content-Type: application/json" \
  -d '{"model":"codex-mini","messages":[{"role":"user","content":"Hello!"}],"reasoning_effort":"high"}'
```

## 管理面板

服务配套一个 Web 管理面板（React + Tailwind CSS），可以在浏览器中直观地管理账号池、API Key 和模型白名单。

前端独立部署，详见 [admin-fe/README.md](./admin-fe/README.md)。

快速开始：

```bash
cd admin-fe
pnpm install --frozen-lockfile
pnpm dev
```

生产构建：

```bash
VITE_API_BASE=https://api.yourdomain.com pnpm build
# 将 dist/ 部署到 Nginx / CDN / Vercel 等
```

# Nexus Codex

OpenAI API 兼容的 Codex 账号池网关。将多个 ChatGPT Plus 账号的 Codex CLI 实例统一调度，对外暴露标准 OpenAI API 接口，支持 Codex CLI、opencode、OpenAI SDK 等客户端直接接入。

## 环境要求

- Node.js 18+
- 每个要接入池的 ChatGPT Plus 账号需提前完成 Codex CLI 登录

## 安装

```bash
git clone <repo-url> nexus-codex
cd nexus-codex
npm install
```

## 账号准备

服务启动前，需要先为每个 ChatGPT Plus 账号创建独立的 `CODEX_HOME` 目录并完成登录：

```bash
# 为每个账号创建独立目录
mkdir -p ~/.codex-pool/account-1
mkdir -p ~/.codex-pool/account-2

# 用对应账号分别登录
CODEX_HOME=~/.codex-pool/account-1 codex login
CODEX_HOME=~/.codex-pool/account-2 codex login
```

登录成功后，将账号信息写入 `data/accounts.json`：

```json
[
  {
    "id": "acc-1",
    "codexHome": "/Users/you/.codex-pool/account-1",
    "enabled": true,
    "healthy": true,
    "remark": "account-a@gmail.com",
    "usageCount": 0,
    "lastUsedAt": null
  },
  {
    "id": "acc-2",
    "codexHome": "/Users/you/.codex-pool/account-2",
    "enabled": true,
    "healthy": true,
    "remark": "account-b@gmail.com",
    "usageCount": 0,
    "lastUsedAt": null
  }
]
```

也可以在服务运行后通过 Admin API 动态添加账号。

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务监听端口 | `3000` |
| `NEXUS_API_KEYS` | 允许访问的 API Key 列表，逗号分隔。不设则跳过鉴权 | 无 |
| `REQUEST_TIMEOUT_MS` | 单次请求超时时间（毫秒） | `300000`（5 分钟） |

## 启动

### 开发模式

带热重载，修改代码自动重启：

```bash
npm run dev
```

### 生产部署

先编译 TypeScript，再用 Node.js 运行编译产物：

```bash
npm run build
npm start
```

带环境变量启动示例：

```bash
PORT=8080 NEXUS_API_KEYS="sk-key1,sk-key2" npm start
```

服务启动后会输出：

```
📦 Account pool initialized with 2 account(s)
🏥 Health check started (interval: 300s, timeout: 30s, threshold: 2)
🚀 Nexus Codex is running on http://localhost:3000
```

验证服务是否正常：

```bash
curl http://localhost:3000/health
```

## 客户端接入

### Codex CLI

在 `~/.codex/config.toml` 中添加：

```toml
model = "codex-plus"
model_provider = "nexus"

[model_providers.nexus]
name = "Nexus Codex"
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
      "name": "Nexus Codex",
      "options": {
        "baseURL": "http://localhost:3000/v1",
        "apiKey": "sk-key1"
      },
      "models": {
        "codex-plus": {
          "name": "Codex Plus Pool"
        }
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
  -d '{"model":"codex-plus","messages":[{"role":"user","content":"Hello!"}]}'
```

## Admin API

服务运行后可通过管理接口动态管理账号，无需重启：

```bash
# 查看所有账号
curl -H "Authorization: Bearer sk-key1" http://localhost:3000/api/admin/accounts

# 添加新账号
curl -X POST -H "Authorization: Bearer sk-key1" -H "Content-Type: application/json" \
  -d '{"codexHome":"/Users/you/.codex-pool/account-3","remark":"account-c@gmail.com"}' \
  http://localhost:3000/api/admin/accounts

# 禁用账号
curl -X PATCH -H "Authorization: Bearer sk-key1" -H "Content-Type: application/json" \
  -d '{"enabled":false}' \
  http://localhost:3000/api/admin/accounts/acc-1
```

## 项目结构

```
nexus-codex/
├── data/
│   └── accounts.json           # 账号配置
├── docs/
│   ├── design.md               # 设计方案
│   └── phase.md                # 实现阶段规划
├── src/
│   ├── index.ts                # 入口：启动服务、挂载路由、优雅关闭
│   ├── types.ts                # 公共类型定义
│   ├── adapters/
│   │   ├── chat-completions.ts # Chat Completions 协议适配
│   │   └── responses.ts        # Responses API 协议适配
│   ├── middleware/
│   │   └── auth.ts             # API Key 鉴权中间件
│   ├── routes/
│   │   ├── chat-completions.ts # POST /v1/chat/completions
│   │   ├── responses.ts        # POST /v1/responses
│   │   ├── models.ts           # GET /v1/models
│   │   └── admin.ts            # 账号管理路由
│   └── services/
│       ├── account-pool.ts     # 账号池与轮询调度
│       ├── account-store.ts    # 账号数据持久化
│       ├── session-store.ts    # 会话状态管理
│       └── health-check.ts     # 定时健康检查
├── package.json
└── tsconfig.json
```

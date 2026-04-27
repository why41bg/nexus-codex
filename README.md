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

也可以在服务运行后通过管理面板或 Admin API 动态添加账号。

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务监听端口 | `3000` |
| `REQUEST_TIMEOUT_MS` | 单次请求超时时间（毫秒） | `300000`（5 分钟） |
| `ACQUIRE_TIMEOUT_MS` | 账号池排队超时时间（毫秒） | `30000`（30 秒） |
| `ADMIN_USERNAME` | 管理面板登录用户名 | `admin` |
| `ADMIN_PASSWORD` | 管理面板登录密码（生产环境务必修改） | `admin` |
| `LOG_LEVEL` | 日志级别（`debug` / `info` / `warn` / `error`） | `info` |
| `RATE_LIMIT_MAX` | 单个 API Key 在时间窗口内的最大请求数 | `60` |
| `RATE_LIMIT_WINDOW_MS` | 速率限制滑动窗口大小（毫秒） | `60000`（1 分钟） |

> API Key 和模型白名单已迁移到 `data/config.json`，通过管理面板配置。首次启动时访问 `http://localhost:3000/admin` 进行初始化设置。

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
PORT=8080 npm start
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
  -d '{"model":"codex-mini","messages":[{"role":"user","content":"Hello!"}]}'
```

指定 `reasoning_effort` 控制模型思考深度（可选值：`minimal`、`low`、`medium`、`high`、`xhigh`）：

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-key1" \
  -H "Content-Type: application/json" \
  -d '{"model":"codex-mini","messages":[{"role":"user","content":"Hello!"}],"reasoning_effort":"high"}'
```

## 管理面板

服务内置了一个 Web 管理面板（React + Tailwind CSS），可以在浏览器中直观地管理账号池。服务启动后访问：

```
http://localhost:3000/admin
```

访问面板需要输入管理员用户名和密码登录（通过 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 环境变量配置，默认 `admin/admin`）。登录后服务端签发 session token，前端通过 Bearer token 鉴权。

面板提供以下功能：

- **全局概览**：账号总数、在线可用、当前忙碌、不健康、已禁用、总请求数一目了然，30 秒自动刷新
- **账号管理**：查看每个账号的状态、使用次数、最后使用时间，支持按状态筛选；添加、启用/禁用、删除账号，操作即时生效无需重启
- **模型白名单**：查看和管理允许客户端使用的模型列表，动态添加或移除模型
- **API Key 管理**：创建、编辑、删除 API Key，支持为每个 Key 配置独立的模型权限和过期时间

## Admin API

除了管理面板，也可以通过 API 接口管理。Admin API 使用 Basic Auth（管理员用户名密码）或 Bearer token（登录后获取的 session token）鉴权。

```bash
# 登录获取 session token
curl -X POST -u admin:admin http://localhost:3000/api/admin/login
# 返回 {"token": "<session_token>"}

# 后续请求使用 session token
TOKEN="<session_token>"

# 查看账号池概览
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/admin/dashboard

# 查看所有账号
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/admin/accounts

# 添加新账号
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"codexHome":"/Users/you/.codex-pool/account-3","remark":"account-c@gmail.com"}' \
  http://localhost:3000/api/admin/accounts

# 禁用账号
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"enabled":false}' \
  http://localhost:3000/api/admin/accounts/acc-1

# 删除账号
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/admin/accounts/acc-1

# 查看模型白名单
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/admin/models

# 添加模型到白名单
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"model":"codex-plus"}' \
  http://localhost:3000/api/admin/models

# 从白名单移除模型
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/admin/models/codex-plus

# 查看 API Key 列表
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/admin/keys

# 创建 API Key
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"my-key"}' \
  http://localhost:3000/api/admin/keys

# 登出
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/admin/logout
```

## 项目结构

```
nexus-codex/
├── data/
│   ├── accounts.json           # 账号数据
│   └── config.json             # API Key、模型白名单等配置
├── docs/
│   ├── design.md               # 设计方案
│   └── admin-panel.md          # 管理面板方案
├── admin-fe/                    # 管理面板前端（React + Vite + Tailwind）
│   └── src/
│       ├── components/          # UI 组件
│       ├── contexts/            # React Context（Auth、Toast）
│       └── lib/                 # 工具函数（api、clipboard、styles、time）
├── public/
│   └── admin/                   # 管理面板构建产物
├── src/
│   ├── index.ts                # 入口：启动服务、挂载路由、优雅关闭
│   ├── types.ts                # 公共类型定义
│   ├── adapters/
│   │   ├── chat-completions.ts # Chat Completions 协议适配
│   │   └── responses.ts        # Responses API 协议适配
│   ├── middleware/
│   │   ├── auth.ts             # API Key 鉴权 + Admin 认证中间件
│   │   └── rate-limit.ts       # 基于 API Key 的滑动窗口速率限制
│   ├── routes/
│   │   ├── chat-completions.ts # POST /v1/chat/completions
│   │   ├── responses.ts        # POST /v1/responses
│   │   ├── models.ts           # GET /v1/models
│   │   └── admin.ts            # 管理路由（账号、模型、API Key、登录登出）
│   ├── services/
│   │   ├── account-pool.ts     # 账号池与轮询调度
│   │   ├── account-store.ts    # 账号数据持久化
│   │   ├── config-store.ts     # 配置持久化（API Key、模型白名单）
│   │   ├── session-manager.ts  # 管理面板 session 管理（24h TTL）
│   │   ├── session-store.ts    # Codex 会话状态管理
│   │   └── health-check.ts     # 定时健康检查
│   └── utils/
│       ├── logger.ts           # 结构化 JSON 日志（支持日志级别控制）
│       └── request-lifecycle.ts # 请求生命周期共享函数
├── package.json
└── tsconfig.json
```

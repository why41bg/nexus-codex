# Nexus Codex 管理面板方案

## 技术选型

### 核心原则：零构建、零 npm 依赖、一个 HTML 文件

管理面板的用户量极小（个人或团队内部使用），功能也不复杂，没有必要引入前端框架和构建工具链。所有前端依赖通过 CDN `<script>` 标签引入，不污染项目的 `package.json`。

### Tailwind CSS（CDN）— 样式

通过 CDN 引入 Tailwind CSS Play CDN，无需安装、无需构建，直接在 HTML 的 `class` 属性中编写样式。Tailwind 的 utility class 体系非常适合快速构建现代化的 dashboard 界面——卡片、圆角、阴影、渐变、响应式布局都能用几个 class 搞定。

```html
<script src="https://cdn.tailwindcss.com"></script>
```

### Alpine.js（CDN）— 交互

Alpine.js 是一个 15KB 的轻量响应式框架，语法类似 Vue（`x-data`、`x-for`、`x-if`、`@click`），直接写在 HTML 属性里。相比原生 JS 手动操作 DOM，代码量减少 60% 以上，可读性也好得多。同样通过 CDN 引入，零构建。

```html
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js"></script>
```

### 后端：Hono serveStatic

Hono 内置 `serveStatic` 中间件，可以直接托管 `public/` 目录下的静态文件。管理面板挂载在 `/admin` 路径下，访问 `http://localhost:3000/admin` 即可打开。

---

## 后端 API 变更

### 新增端点

#### `DELETE /api/admin/accounts/:id` — 删除账号

从 `data/accounts.json` 中移除账号，同时从运行时池中移除对应条目。如果该账号当前正在处理请求（busy 状态），返回 409 Conflict 拒绝删除。

请求示例：

```bash
curl -X DELETE -H "Authorization: Bearer sk-key1" \
  http://localhost:3000/api/admin/accounts/acc-1
```

成功响应（200）：

```json
{ "deleted": true, "id": "acc-1" }
```

拒绝响应（409）：

```json
{
  "error": {
    "message": "Account 'acc-1' is currently busy. Please try again later.",
    "type": "invalid_request_error",
    "code": "conflict"
  }
}
```

#### `GET /api/admin/dashboard` — 仪表盘聚合数据

一次性返回账号池的全局概览信息，供前端首页卡片区使用。

响应示例：

```json
{
  "total": 5,
  "enabled": 4,
  "healthy": 3,
  "busy": 1,
  "available": 2,
  "disabled": 1,
  "unhealthy": 1,
  "totalUsage": 142,
  "activeSessions": 1
}
```

字段说明：

- `total`：账号总数
- `enabled`：已启用的账号数
- `healthy`：健康的账号数（enabled 且 healthy）
- `busy`：当前忙碌的账号数
- `available`：此刻可接请求的账号数（enabled 且 healthy 且非 busy）
- `disabled`：已禁用的账号数
- `unhealthy`：不健康的账号数
- `totalUsage`：所有账号 usageCount 之和
- `activeSessions`：当前内存中的活跃会话数

### 现有端点无变更

`GET /api/admin/accounts`、`POST /api/admin/accounts`、`PATCH /api/admin/accounts/:id` 保持不变。

---

## 前端页面设计

整个管理面板是一个单页面（`public/admin.html`），分为三个区域。

### 1. 鉴权层

页面加载时检查 `localStorage` 中是否存有 API Key。如果没有，显示一个全屏登录卡片（居中布局、半透明背景），用户输入 Key 后先调用 `GET /api/admin/dashboard` 验证有效性，通过后才进入主界面。Key 存入 `localStorage`，后续所有 fetch 请求自动携带 `Authorization: Bearer <key>` 头。返回 401 时清除存储并重新要求输入。

如果服务端未配置 `NEXUS_API_KEYS` 环境变量（开发模式，鉴权中间件跳过），则直接进入主界面，无需输入 Key。

### 2. 顶部：全局概览卡片区

一排统计卡片，一目了然地展示账号池整体状况。数据来自 `GET /api/admin/dashboard`。

```
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│  账号总数  │ │ 在线可用  │ │ 当前忙碌  │ │  不健康   │ │  已禁用   │ │ 总请求数  │
│    5     │ │    2     │ │    1     │ │    1     │ │    1     │ │   142    │
│  (蓝色)   │ │  (绿色)   │ │  (黄色)   │ │  (红色)   │ │  (灰色)   │ │  (紫色)   │
└──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘
```

每个卡片包含：图标/emoji、数字（大号加粗）、标签文字。用不同颜色区分语义。

### 3. 中部：账号列表表格

表格展示所有账号的详细信息，每行一个账号。

| 列 | 内容 | 说明 |
|---|---|---|
| 状态 | 彩色圆点 | 🟢 空闲 / 🟡 忙碌 / 🔴 不健康 / ⚫ 已禁用 |
| ID | `acc-1` | 账号唯一标识 |
| 备注 | `xxx@gmail.com` | remark 字段 |
| CODEX_HOME | `/Users/...` | 路径，过长时截断，hover 显示全文（`title` 属性） |
| 使用次数 | `42` | usageCount |
| 最后使用 | `5 分钟前` | lastUsedAt 转为相对时间 |
| 操作 | 按钮组 | 启用/禁用切换、删除 |

表格上方有一行筛选标签：全部 / 在线 / 忙碌 / 不健康 / 已禁用，点击切换过滤条件。右侧放一个手动刷新按钮。

### 4. 底部：添加账号表单

内嵌在页面底部的简洁表单，两个输入框一行排列：

- **CODEX_HOME 路径**（必填）
- **备注**（选填，通常填邮箱）
- **添加** 按钮

提交后调用 `POST /api/admin/accounts`，成功后自动刷新列表和概览数据。

### 5. 数据刷新策略

不做自动轮询。数据刷新发生在以下时机：

- 页面首次加载
- 执行任何操作（添加/删除/启用/禁用）后自动刷新
- 用户点击手动刷新按钮

### 6. 交互细节

**删除确认**：点击删除按钮后弹出确认对话框（Alpine.js 控制的模态框，不是浏览器原生 `confirm`），显示"确定要删除账号 acc-1 (xxx@gmail.com) 吗？此操作不可撤销。"确认后调用 DELETE 端点。

**操作反馈**：所有 API 调用的成功/失败结果通过页面顶部的 toast 通知展示，成功为绿色、失败为红色，3 秒后自动消失。

**加载状态**：数据加载时表格区域显示 loading 骨架屏或 spinner，避免空白闪烁。

---

## 文件结构变更

```
nexus-codex/
├── public/                        # 新增目录
│   └── admin.html                 # 管理面板（唯一的前端文件）
├── src/
│   ├── index.ts                   # 修改：增加 serveStatic 中间件 + /admin 路由
│   └── routes/
│       └── admin.ts               # 修改：增加 DELETE 和 dashboard 端点
└── ...
```

改动范围：后端改 2 个文件，前端新增 1 个文件。

---

## 页面访问方式

服务启动后，浏览器访问：

```
http://localhost:3000/admin
```


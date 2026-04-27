# Nexus Codex 管理面板方案

## 技术选型

### 前端：React + Vite + Tailwind CSS

管理面板采用独立的前端工程（`admin-fe/`），使用 React 18 + TypeScript 构建，Vite 作为开发服务器和打包工具，Tailwind CSS 处理样式。构建产物输出到 `public/admin/`，由后端 Hono 的 `serveStatic` 中间件托管。

选择 React 而非最初方案中的 Alpine.js + 单 HTML 文件，是因为随着功能增长（API Key 管理、模型权限配置等），组件化和类型安全的价值越来越大。Vite 提供了极快的开发体验（HMR），Tailwind 的 utility class 体系适合快速构建 dashboard 界面。

### 后端：Hono serveStatic

Hono 内置 `serveStatic` 中间件，托管 `public/` 目录下的静态文件。管理面板挂载在 `/admin` 路径下，访问 `http://localhost:3000/admin` 即可打开。

---

## 鉴权机制

管理面板使用独立的管理员认证体系，与 API Key 鉴权分离：

管理员通过用户名和密码登录（通过 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 环境变量配置，默认 `admin/admin`）。登录时前端发送 Basic Auth 请求到 `POST /api/admin/login`，后端校验通过后签发 session token（24 小时 TTL），前端将 token 存入 `sessionStorage`，后续所有请求通过 `Authorization: Bearer <token>` 头鉴权。

登出时调用 `POST /api/admin/logout` 销毁服务端 session，前端清除本地存储并跳转到登录页。返回 401 时自动登出。

---

## 后端 API

### 认证端点

`POST /api/admin/login`：登录，Basic Auth 校验通过后返回 session token。

`POST /api/admin/logout`：登出，销毁服务端 session。

### Dashboard 端点

`GET /api/admin/dashboard`：一次性返回账号池的全局概览信息，供前端首页卡片区使用。

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

字段说明：`total` 账号总数、`enabled` 已启用、`healthy` 健康、`busy` 忙碌、`available` 可接请求、`disabled` 已禁用、`unhealthy` 不健康、`totalUsage` 总使用次数、`activeSessions` 活跃会话数。

### 账号管理端点

```
GET    /api/admin/accounts        → 查看所有账号及运行时状态
POST   /api/admin/accounts        → 添加账号 { "codexHome": "...", "remark": "..." }
PATCH  /api/admin/accounts/:id    → 启用/禁用账号 { "enabled": true/false }
DELETE /api/admin/accounts/:id    → 删除账号（busy 状态返回 409）
```

### 模型管理端点

```
GET    /api/admin/models          → 查看当前模型白名单
POST   /api/admin/models          → 添加模型，已存在返回 409
DELETE /api/admin/models/:model   → 移除模型，不存在返回 404
```

### API Key 管理端点

```
GET    /api/admin/keys            → 查看 API Key 列表（脱敏显示）
POST   /api/admin/keys            → 创建 API Key
PATCH  /api/admin/keys/:keyPrefix → 更新 API Key 配置（名称、模型权限、过期时间等）
DELETE /api/admin/keys/:keyPrefix → 删除 API Key
```

---

## 前端页面设计

管理面板是一个单页应用（SPA），使用 URL hash 持久化当前 Tab 状态（支持浏览器前进/后退），包含侧边栏导航和四个主要 Tab。

### 1. 登录页

全屏居中的登录卡片，包含用户名和密码输入框。使用原生 `<form onSubmit>` 支持 Enter 键提交和密码管理器识别。登录成功后跳转到 Dashboard。

### 2. Dashboard Tab

顶部一排统计卡片，展示账号池整体状况（账号总数、在线可用、当前忙碌、不健康、已禁用、总请求数），不同颜色区分语义。下方展示账号列表表格。

### 3. 账号管理 Tab

表格展示所有账号的详细信息，每行一个账号，包含状态圆点、ID、备注、CODEX_HOME 路径、使用次数、最后使用时间、操作按钮。表格上方有状态筛选标签（全部/在线/忙碌/不健康/已禁用）。底部内嵌添加账号表单。

### 4. 模型白名单 Tab

展示当前模型白名单列表，支持添加和删除模型。

### 5. API Key 管理 Tab

展示 API Key 列表（脱敏显示），支持创建、编辑（名称、模型权限、过期时间）和删除。编辑通过模态框进行。

---

## 数据刷新策略

面板采用 30 秒自动轮询刷新数据，同时在执行任何操作（添加/删除/启用/禁用等）后立即刷新。用户也可以手动触发刷新。

---

## 交互细节

**删除确认**：点击删除按钮后弹出自定义确认模态框（非浏览器原生 `confirm`），支持 Escape 键关闭和焦点管理，包含 `role="dialog"` 和 `aria-modal="true"` 等无障碍属性。

**操作反馈**：所有 API 调用的成功/失败结果通过页面顶部的 Toast 通知展示，成功为绿色、失败为红色，3 秒后自动消失。Toast 定时器在组件卸载时正确清理。

**加载状态**：数据加载时显示 Spinner，避免空白闪烁。

**键盘可访问性**：表单支持 Enter 键提交，模态框支持 Escape 键关闭。

---

## 文件结构

```
nexus-codex/
├── admin-fe/                        # 管理面板前端工程
│   ├── src/
│   │   ├── App.tsx                  # 根组件
│   │   ├── main.tsx                 # 入口
│   │   ├── types.ts                 # 前端类型定义
│   │   ├── components/
│   │   │   ├── LoginPage.tsx        # 登录页
│   │   │   ├── DashboardPage.tsx    # 主面板（Tab 路由 + 自动轮询）
│   │   │   ├── DashboardTab.tsx     # 概览 Tab
│   │   │   ├── AccountsTab.tsx      # 账号管理 Tab
│   │   │   ├── AccountTable.tsx     # 账号表格
│   │   │   ├── AddAccountForm.tsx   # 添加账号表单
│   │   │   ├── ApiKeysTab.tsx       # API Key 管理 Tab
│   │   │   ├── ApiKeyManager.tsx    # API Key 列表与操作
│   │   │   ├── EditKeyModal.tsx     # API Key 编辑模态框
│   │   │   ├── ModelManager.tsx     # 模型白名单管理
│   │   │   ├── ConfirmModal.tsx     # 通用确认模态框
│   │   │   ├── Sidebar.tsx          # 侧边栏导航
│   │   │   ├── StatsCards.tsx       # 统计卡片
│   │   │   ├── Spinner.tsx          # 加载指示器
│   │   │   └── icons.tsx            # 图标组件
│   │   ├── contexts/
│   │   │   ├── AuthContext.tsx       # 认证状态管理
│   │   │   └── ToastContext.tsx      # Toast 通知管理
│   │   └── lib/
│   │       ├── api.ts               # API 请求封装
│   │       ├── clipboard.ts         # 剪贴板工具
│   │       ├── styles.ts            # 公共样式常量
│   │       └── time.ts              # 时间格式化工具
│   ├── tailwind.config.js
│   ├── vite.config.ts
│   └── package.json
├── public/
│   └── admin/                       # 构建产物（vite build 输出）
│       ├── index.html
│       └── assets/
└── src/
    ├── routes/admin.ts              # Admin API 路由
    ├── middleware/auth.ts            # Admin 认证中间件
    └── services/session-manager.ts  # Session 管理（24h TTL）
```

---

## 页面访问方式

服务启动后，浏览器访问：

```
http://localhost:3000/admin
```

# Nexus Codex

OpenAI API 兼容的 Codex 账号池网关。将多个 ChatGPT Plus 账号统一调度，对外暴露标准 API 接口（含原生 token 级流式输出），支持 Codex CLI、opencode、OpenAI SDK、Anthropic SDK 等客户端直接接入。

## 核心能力

- **多账号统一调度** — 最少负载优先 + 轮询调度，支持并发控制、异步排队与超时、可配置 `codex login --device-auth` 一键录入新账号
- **三协议兼容** — 同时支持 OpenAI Chat Completions (`/v1/chat/completions`)、OpenAI Responses (`/v1/responses`)、Anthropic Messages (`/v1/messages`)，统一通过 ChatGPT Plus 后端提供
- **自动故障转移** — 请求级账号故障转移，遇到 Cloudflare 验证、Token 过期、网络错误时自动切换到下一个账号重试（最多 3 次）
- **原生 token 级流式输出** — 基于 SSE 的实时流式响应，兼容 OpenAI 和 Anthropic 流式协议
- **Web 管理面板** — 可视化管理界面，支持账号管理、API Key 管理、模型白名单、实时指标监控、结构化日志查询
- **API Key 自助申领** — 面向团队的自助 Key 申领门户，支持申领码验证、模板化管理、按 Key 独立限速
- **多层安全防护** — API Key 认证、滑动窗口速率限制（全局 + 按 Key 独立配置）、自动/手动 IP 封禁（可疑 404 触发自动封禁）、配额探测
- **健康监控** — 定时本地 Token 有效性检查（含自动刷新）+ 远程连通性探测，失败次数达到阈值后自动标记不健康并触发故障转移
- **可观测性** — 持久化指标存储（SQLite），支持时间序列、分类统计、延迟分位数（P50/P95/P99）、KPI 环比；结构化日志支持多维度查询、错误汇总和 Trace 追踪

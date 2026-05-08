# CI/CD 部署流程

## 概述

Nexus Codex 使用 GitHub Actions 实现自动部署。当 `app/` 目录下的代码推送到 `main` 分支时，自动触发部署到 AWS EC2。

## 触发规则

**触发条件:** push 到 `main` 分支，且变更文件包含 `app/**` 路径。

**不触发的情况:**
- `admin-fe/`、`docs/`、`.skill/`、`.github/` 等非 `app/` 目录的变更
- 仅 `.md` 文件的变更
- 其他分支的 push

## 部署步骤

1. 通过 SSH 连接到 EC2 实例
2. 在部署目录执行 `git pull origin main`
3. 运行 `uv sync` 同步 Python 依赖
4. 重启 `nexus-codex` systemd 服务

## 所需 Secrets

| Secret | 说明 |
|--------|------|
| `EC2_HOST` | EC2 实例地址 |
| `EC2_USER` | SSH 登录用户名 |
| `EC2_SSH_KEY` | SSH 私钥 |
| `DEPLOY_PATH` | 服务器上的项目部署路径 |

## 工作流文件

`.github/workflows/deploy.yml`

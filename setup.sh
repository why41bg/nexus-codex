#!/usr/bin/env bash
#
# Nexus Codex — 一键初始化 & 启动脚本
# 适用于刚 clone 仓库后的首次部署
#
set -euo pipefail

# ─── 颜色 ───────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*"; }

# ─── 切到脚本所在目录（即项目根目录）─────────────────────────
cd "$(dirname "$0")"
PROJECT_ROOT="$(pwd)"
info "项目根目录: ${PROJECT_ROOT}"

# ─── 1. 检查 Node.js 版本 ────────────────────────────────────
info "检查 Node.js 环境..."
if ! command -v node &>/dev/null; then
    err "未找到 Node.js，请先安装 Node.js 18+（https://nodejs.org）"
    exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
    err "Node.js 版本过低（当前 $(node -v)），需要 18+"
    exit 1
fi
ok "Node.js $(node -v)"

# ─── 2. 检查 pnpm ────────────────────────────────────────────
info "检查 pnpm..."
if ! command -v pnpm &>/dev/null; then
    warn "未找到 pnpm，正在通过 corepack 启用..."
    corepack enable
    corepack prepare pnpm@latest --activate
fi
ok "pnpm $(pnpm -v)"

# ─── 3. 安装依赖（根目录）─────────────────────────────────────
info "安装根目录依赖..."
pnpm install --frozen-lockfile
ok "根目录依赖安装完成"

# ─── 4. 安装依赖（admin-fe）──────────────────────────────────
info "安装 admin-fe 依赖..."
cd admin-fe
pnpm install --frozen-lockfile
cd "$PROJECT_ROOT"
ok "admin-fe 依赖安装完成"

# ─── 5. 编译项目 ─────────────────────────────────────────────
info "编译项目（API + Admin 前端）..."
pnpm build
ok "编译完成"

# ─── 6. 初始化 data 目录 ─────────────────────────────────────
if [ ! -d "data" ]; then
    info "创建 data 目录..."
    mkdir -p data
fi

if [ ! -f "data/accounts.json" ]; then
    info "初始化空账号列表 data/accounts.json（稍后可通过管理面板添加）"
    echo '[]' > data/accounts.json
fi
ok "data 目录就绪"

# ─── 7. 初始化 .env ──────────────────────────────────────────
if [ ! -f ".env" ]; then
    info "从 .env.example 创建 .env，请按需修改配置"
    cp .env.example .env
    ok ".env 已创建"
else
    ok ".env 已存在，跳过"
fi

# ─── 8. 启动服务 ─────────────────────────────────────────────
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Nexus Codex 初始化完成，正在启动...${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

exec node dist/index.js

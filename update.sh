#!/usr/bin/env bash
# Cith 一键更新：从远端仓库拉取代码，按需安装依赖并重新编译
#
# 用法:
#   ./update.sh                 拉取当前分支的最新代码并编译（后端；前端已装过则一并编译）
#   ./update.sh --web           强制连前端面板一起编译
#   ./update.sh --no-web        跳过前端面板
#   ./update.sh --branch dev    更新指定分支
#   ./update.sh --stash         自动暂存本地未提交改动，结束后恢复
#   ./update.sh --no-install    跳过依赖安装（只拉代码 + 编译）
#   ./update.sh --force         即使远端没有新提交也重新编译
#
# 说明:
#   - 只处理已跟踪文件；config.json、mcp/、data/ 等被忽略的本地文件不会被触碰
#   - 拉取使用 --ff-only，本地分叉时会直接报错而不是生成 merge commit
#   - 脚本不负责重启服务，完成后会打印对应的重启命令
set -euo pipefail

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$DIR"

BRANCH=""
WITH_WEB="auto"      # auto | always | never
ALLOW_STASH=0
SKIP_INSTALL=0
FORCE=0

usage() {
    sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
    case "$1" in
        --branch)     BRANCH="${2:-}"; [ -n "$BRANCH" ] || { echo "error: --branch 需要分支名" >&2; exit 1; }; shift 2 ;;
        --web)        WITH_WEB="always"; shift ;;
        --no-web)     WITH_WEB="never"; shift ;;
        --stash)      ALLOW_STASH=1; shift ;;
        --no-install) SKIP_INSTALL=1; shift ;;
        --force)      FORCE=1; shift ;;
        -h|--help)    usage; exit 0 ;;
        *)            echo "error: 未知参数 $1（-h 查看用法）" >&2; exit 1 ;;
    esac
done

info() { printf '\033[36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[33m[warn]\033[0m %s\n' "$1" >&2; }
die()  { printf '\033[31m[error]\033[0m %s\n' "$1" >&2; exit 1; }

# ---------- 环境检查 ----------
command -v git >/dev/null 2>&1 || die "未找到 git"
command -v node >/dev/null 2>&1 || die "未找到 node（需要 Node.js 22+）"
command -v npm >/dev/null 2>&1 || die "未找到 npm"

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 22 ] || warn "当前 Node.js 版本为 $(node -v)，项目要求 22+，编译可能失败"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "$DIR 不是 git 仓库"

if [ -z "$BRANCH" ]; then
    BRANCH=$(git rev-parse --abbrev-ref HEAD)
    [ "$BRANCH" != "HEAD" ] || die "当前处于 detached HEAD，请用 --branch 指定分支"
fi

# ---------- 本地改动保护 ----------
STASHED=0
restore_stash() {
    if [ "$STASHED" = "1" ]; then
        if git stash pop --quiet; then
            info "已恢复本地改动"
        else
            warn "本地改动恢复失败，请手动处理: git stash list && git stash pop"
        fi
    fi
}
trap restore_stash EXIT

DIRTY=$(git status --porcelain --untracked-files=no)
if [ -n "$DIRTY" ]; then
    if [ "$ALLOW_STASH" = "1" ]; then
        git stash push --quiet -m "update.sh auto-stash $(date '+%Y-%m-%d %H:%M:%S')"
        STASHED=1
        info "已暂存本地改动（结束时自动恢复）"
    else
        echo "$DIRTY" >&2
        die "工作区有未提交的改动；先提交，或加 --stash 自动暂存"
    fi
fi

# ---------- 拉取 ----------
fingerprint() {
    # 依赖文件的内容指纹；文件不存在时输出空
    [ -f "$1" ] && git hash-object "$1" || true
}
PKG_BEFORE=$(fingerprint package.json; fingerprint package-lock.json)
WEBPKG_BEFORE=$(fingerprint web/package.json; fingerprint web/package-lock.json)

info "拉取 origin 最新提交..."
git fetch --prune --quiet origin

RANGE=""
if git rev-parse --verify --quiet "origin/$BRANCH" >/dev/null; then
    RANGE="HEAD..origin/$BRANCH"
    AHEAD=$(git rev-list --count "origin/$BRANCH..HEAD")
    if [ "$AHEAD" -gt 0 ]; then
        warn "本地有 $AHEAD 个提交尚未推送到 origin/$BRANCH"
    fi
fi

if [ -n "$RANGE" ]; then
    COUNT=$(git rev-list --count "$RANGE")
    if [ "$COUNT" -gt 0 ]; then
        info "发现 $COUNT 个新提交："
        git log --oneline --no-decorate "$RANGE" | head -20
    elif [ "$FORCE" = "0" ]; then
        info "已是最新（$(git rev-parse --short HEAD)），跳过拉取；需要强制重编请加 --force"
    fi
    if [ "$COUNT" -eq 0 ] && [ "$FORCE" = "0" ]; then
        exit 0
    fi
fi

if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    git pull --ff-only
else
    info "本地分支未跟踪远端，直接拉取 origin/$BRANCH"
    git pull --ff-only origin "$BRANCH"
fi

# ---------- 依赖 ----------
PKG_AFTER=$(fingerprint package.json; fingerprint package-lock.json)
if [ "$SKIP_INSTALL" = "0" ]; then
    if [ "$PKG_BEFORE" != "$PKG_AFTER" ] || [ ! -d node_modules ]; then
        info "依赖有变化（或未安装），执行 npm install..."
        npm install --no-audit --no-fund
    else
        info "依赖未变化，跳过安装"
    fi
fi

# ---------- 编译 ----------
info "编译后端（dist/）..."
npm run build

WEBPKG_AFTER=$(fingerprint web/package.json; fingerprint web/package-lock.json)
BUILD_WEB=0
if [ "$WITH_WEB" = "always" ]; then
    BUILD_WEB=1
elif [ "$WITH_WEB" = "auto" ] && { [ -d web/node_modules ] || [ -d web/dist ]; }; then
    BUILD_WEB=1
fi

if [ "$BUILD_WEB" = "1" ]; then
    if [ "$SKIP_INSTALL" = "0" ] && { [ ! -d web/node_modules ] || [ "$WEBPKG_BEFORE" != "$WEBPKG_AFTER" ]; }; then
        info "安装前端依赖..."
        (cd web && npm install --no-audit --no-fund)
    fi
    info "编译前端面板（web/dist/）..."
    npm run build:web
else
    info "跳过前端编译（未安装 web/node_modules；需要时加 --web）"
fi

# ---------- 完成 ----------
info "更新完成：$(git rev-parse --short HEAD) $(git log -1 --pretty=%s)"
[ -f core/config.json ] || warn "未找到 core/config.json，首次部署请先运行 npm run setup"

echo
echo "重启服务后生效："
echo "  源码运行 : npm start"
echo "  dist 运行: npm run start:dist"
echo "  PM2      : pm2 restart <应用名>"

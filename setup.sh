#!/usr/bin/env bash
# Cith 一键初始化（Linux / macOS 包装脚本）
# 真正的逻辑在 scripts/setup.ts，本文件只负责找到 node 并转交参数
set -euo pipefail

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if ! command -v node >/dev/null 2>&1; then
    echo "Node.js not found. Install Node.js 24 or newer: https://nodejs.org" >&2
    exit 1
fi

exec node "$DIR/scripts/setup.ts" "$@"
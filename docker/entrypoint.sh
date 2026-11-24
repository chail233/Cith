#!/bin/sh
set -eu

case "${1:-start}" in
    start)
        node /app/docker/setup.ts prepare
        exec node /app/dist/index.js
        ;;
    setup)
        exec node /app/docker/setup.ts setup
        ;;
    *)
        exec "$@"
        ;;
esac

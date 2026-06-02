#!/bin/sh
# Docker entrypoint script for Chat2API

set -e

echo "========================================"
echo "  Chat2API Docker Container v1.3.0"
echo "========================================"
echo ""
echo "Environment:"
echo "  WEB_PORT:    ${WEB_PORT:-8080}"
echo "  PROXY_PORT:  ${PROXY_PORT:-8080}"
echo "  WEB_HOST:    ${WEB_HOST:-0.0.0.0}"
echo ""

# Ensure data directory exists
mkdir -p /root/.chat2api

# Start the server
exec node --loader ts-node/esm src/server/index.ts

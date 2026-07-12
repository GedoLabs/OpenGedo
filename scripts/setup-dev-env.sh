#!/usr/bin/env bash
# Bootstrap local .env files from tracked examples — NEVER overwrites existing files.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

copy_if_missing() {
  local example="$1"
  local target="$2"
  if [[ -f "$target" ]]; then
    echo -e "${GREEN}✓${NC} 已存在，跳过: $target"
  elif [[ -f "$example" ]]; then
    cp "$example" "$target"
    echo -e "${YELLOW}→${NC} 已从模板创建: $target"
    echo "  请编辑该文件，填入真实密钥（尤其是 ANTHROPIC_API_KEY）"
  else
    echo "⚠ 模板不存在: $example"
  fi
}

echo "GEDO.AI 开发环境配置（不会覆盖已有 .env）"
echo ""

copy_if_missing "$ROOT/services/backend-api/env.example" "$ROOT/services/backend-api/.env"
copy_if_missing "$ROOT/web/.env.example" "$ROOT/web/.env.local"

echo ""
echo "下一步："
echo "  1. 编辑 services/backend-api/.env  → 填入 ANTHROPIC_API_KEY"
echo "  2. 编辑 web/.env.local（可选）    → Stripe / 社交登录 / SIM 等"
echo "  3. 若 .env 是旧版、缺新变量：bash scripts/sync-env-from-example.sh"
echo "  4. 分层说明见 scripts/env-config-guide.md"
echo "  5. 启动："
echo "       cd services/backend-api && npm run dev"
echo "       cd web && npm run dev"
echo ""
echo "验证 LLM：curl http://localhost:8787/v1/llm/status"
echo ""
echo "说明：.env 在 .gitignore 中，切换分支不会删除你本机的文件；"
echo "      Cloud Agent 环境是临时的，密钥请放在本机或 Cursor Secrets。"

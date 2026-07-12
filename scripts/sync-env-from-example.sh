#!/usr/bin/env bash
# Merge NEW keys from tracked env.example into local .env — NEVER overwrites existing values.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

sync_pair() {
  local example="$1"
  local target="$2"
  local label="$3"

  if [[ ! -f "$example" ]]; then
    echo -e "${YELLOW}⚠${NC} 模板不存在，跳过: $example"
    return
  fi

  if [[ ! -f "$target" ]]; then
    cp "$example" "$target"
    echo -e "${YELLOW}→${NC} 已创建 $label: $target"
  fi

  local added=0
  local tmp
  tmp="$(mktemp)"

  while IFS= read -r line || [[ -n "$line" ]]; do
    local trimmed="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$trimmed" || "$trimmed" == \#* ]] && continue
    [[ "$trimmed" != *=* ]] && continue

    local key="${trimmed%%=*}"
    key="${key%"${key##*[![:space:]]}"}"

    if grep -qE "^[[:space:]]*${key}=" "$target" 2>/dev/null; then
      continue
    fi

    echo "$line" >> "$tmp"
    added=$((added + 1))
    echo -e "  ${CYAN}+${NC} $key"
  done < "$example"

  if [[ $added -eq 0 ]]; then
    echo -e "${GREEN}✓${NC} $label 已是最新（无缺失变量）: $target"
    rm -f "$tmp"
    return
  fi

  {
    echo ""
    echo "# ── 以下由 scripts/sync-env-from-example.sh 于 $(date +%Y-%m-%d) 补全（请按需填写）──"
    cat "$tmp"
  } >> "$target"

  rm -f "$tmp"
  echo -e "${YELLOW}→${NC} $label 已补全 ${added} 个变量 → $target"
}

echo "GEDO.AI 环境变量同步（不覆盖已有值）"
echo ""

sync_pair "$ROOT/services/backend-api/env.example" "$ROOT/services/backend-api/.env" "后端 backend-api"
sync_pair "$ROOT/web/.env.example" "$ROOT/web/.env.local" "前端 web"

echo ""
echo "下一步："
echo "  1. 查看 scripts/env-config-guide.md 了解「必配 / 可选 / 按需」分层"
echo "  2. 编辑补全的变量（Stripe、Google/Apple、Resend 等）"
echo "  3. 重启 backend-api 与 web dev server 使配置生效"

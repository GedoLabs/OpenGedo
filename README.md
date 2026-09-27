# GEDO — Open-Source Personal Growth OS

[English] | 中文见下方

**GEDO** is a self-hostable personal growth system: an AI companion with a real,
layered memory (智忆), goal planning & execution (OKR / todo breakdown), a life-dimension
map (Life Flower), daily reflection, and a publishable **digital persona** that can chat
with visitors on your behalf — all running on **your** server, with **your** LLM key.

This repository is the open-source core of [gedo.ai](https://gedo.ai)
(open-core model — the hosted cloud edition layers billing, mobile apps and
managed operations on top of this exact codebase).

## Highlights

- **Memory OS** — episode capture, consolidation, entity codex, hybrid retrieval
  (BM25 + local embeddings + rerank), eight-dimension life assessment.
- **Companion chat** — GenUI cards, daily brief, daily question, reviews & reflections.
- **Goals & execution** — goal clarify → plan → decompose → daily plan → check-ins.
- **Digital persona** — publish a public page (`/p/<slug>`), embeddable widget, and an
  MCP endpoint so other AI tools can talk to your persona.
- **Capability exchange** — personal memory MCP server (PAT-scoped), connector
  directory, confirm-before-write capture queue.
- **Source import** — NotebookLM-style import center (files / chat exports) with a
  review queue.
- **Privacy-first defaults** — local Ollama embeddings, zero telemetry in OSS builds,
  full data export (`.gmp` open format).

## Quickstart (Docker)

Requirements: Docker + Docker Compose, and **one** LLM credential — an Anthropic API
key (recommended), or a local [Ollama](https://ollama.com) for a fully offline setup.

```bash
git clone https://github.com/GedoLabs/OpenGedo.git && cd OpenGedo
cp services/backend-api/env.example services/backend-api/.env
# edit services/backend-api/.env — minimal config:
#   GEDO_EDITION=oss
#   JWT_SECRET=<long random string>
#   ANTHROPIC_API_KEY=<your key>        # or LLM_PROVIDER=ollama
docker compose up -d
```

Open http://localhost:3000 — registration is open (no invite code in OSS builds).

Optional:

- **Local embeddings** (semantic memory recall): run Ollama on the host with
  `ollama pull bge-m3`, then set `OLLAMA_BASE_URL=http://host.docker.internal:11434`.
  Without it, recall gracefully falls back to keyword (BM25) search.
- **Social login**: set `GOOGLE_CLIENT_IDS` / `APPLE_CLIENT_IDS` (backend) and the
  matching `NEXT_PUBLIC_*` values (web). Unset = buttons hidden.
- **Email** (password reset etc.): set `RESEND_API_KEY`. Unset = emails silently skip.
- **Restricted regions**: Node's fetch ignores `HTTPS_PROXY`; set `ANTHROPIC_PROXY`
  or `HTTPS_PROXY` in the backend env (see env.example) to route LLM calls through
  your proxy.

## Development (no Docker)

```bash
# scheduler deps (backend imports services/agent for cron/daily-plan)
cd services/agent && npm ci
# backend (Node 20+)
cd ../backend-api && npm ci && cp env.example .env && npm run dev         # :8787
# web
cd ../../web && npm ci && npm run dev                                     # :3000
```

## Upgrades & your data

- All state lives under the backend data dir (`GEDO_DATA_DIR`, the `gedo_data`
  volume in Docker). Upgrading = pull new code, rebuild, restart; the store
  migrates missing collections automatically at boot.
- Your memories are portable: `GET /v1/memory/export.gmp` exports everything in
  the open **GMP** format (spec in [`specs/gmp/`](specs/gmp/), Apache-2.0).
- PostgreSQL + pgvector support is landing upstream (schema and migration tools
  already ship in `services/backend-api/db/`); the file store is fine for
  personal / small-team scale.

## Edition switch

This codebase builds two editions from the same source:

| | OSS (this repo, self-hosted) | Cloud (gedo.ai) |
|---|---|---|
| `GEDO_EDITION` / `NEXT_PUBLIC_GEDO_EDITION` | `oss` | `cloud` |
| Registration | open | invite/capacity managed |
| Billing / quotas | none (unlimited) | subscription tiers |
| Telemetry | none | first-party page beacon |
| Marketing pages / paywall | absent | present |

Cloud-only route handlers stay behind `isCloud()` guards and return 404 in OSS builds.

## License

- Code: **AGPL-3.0-only** (see [LICENSE](LICENSE)). © 2026 GEDO PTE. LTD.
- The GMP memory-pack specification under [`specs/gmp/`](specs/gmp/) is licensed
  **Apache-2.0** (see its own LICENSE) so anyone can implement it freely.
- Contributions require a CLA (see [CONTRIBUTING.md](CONTRIBUTING.md)) because the
  same code also ships in the commercial cloud edition.

---

# GEDO — 开源个人成长系统

GEDO 是一套可自主部署的成长系统：带分层长期记忆的 AI 智伴（智忆）、目标规划与执行
（OKR/待办拆解）、生命之花八维图谱、每日一问与复盘，以及可对外发布的**数字分身**
（公开页 + 嵌入挂件 + MCP 端点）。全部跑在**你自己的服务器**上，用**你自己的 LLM key**。

本仓库是 [gedo.ai](https://gedo.ai) 的开源核心（open-core 模式：官方云版在同一套
代码上叠加计费、移动端与托管运维）。

## 快速开始

需要 Docker 和一个 LLM 凭据（推荐 Anthropic key；或本地 Ollama 全离线）。

```bash
git clone https://github.com/GedoLabs/OpenGedo.git && cd OpenGedo
cp services/backend-api/env.example services/backend-api/.env
# 编辑 .env：GEDO_EDITION=oss、JWT_SECRET、ANTHROPIC_API_KEY 三项即可
docker compose up -d
```

打开 http://localhost:3000，开放注册（开源版无邀请码）。

受限地区自托管：Node 原生 fetch 不读 `HTTPS_PROXY`，请在 backend env 里配置
`ANTHROPIC_PROXY`（详见 env.example 注释）。

## 升级与数据

- 数据都在 `gedo_data` 卷（`GEDO_DATA_DIR`）；升级 = 拉代码重建容器，存储结构启动时自动迁移。
- 记忆可随身带走：`GET /v1/memory/export.gmp` 按开放的 GMP 格式（Apache-2.0，
  见 `specs/gmp/`）导出全部数据。

## 许可

代码为 **AGPL-3.0-only**（© 2026 GEDO PTE. LTD.）；`specs/gmp/` 规范为 Apache-2.0。
贡献需签署 CLA（原因见 CONTRIBUTING.md：同一代码亦用于商业云版的双许可）。

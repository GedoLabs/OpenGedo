# Contributing to GEDO

Thanks for your interest! GEDO's open-source core lives here and is developed in
an **open-core** model: the same code also powers the commercial cloud edition at
gedo.ai. That shapes two ground rules below (CLA and edition guards) — everything
else is a normal GitHub flow.

## Ground rules

1. **CLA required.** Because this code is dual-licensed (AGPL-3.0 here, a
   commercial license in the cloud edition), we can only merge contributions
   whose authors have signed our Contributor License Agreement granting
   GEDO PTE. LTD. the right to relicense the contribution. The CLA bot will
   prompt you on your first pull request.
2. **Respect the edition seam.** Cloud-only behavior (billing, invites,
   telemetry) stays behind `isCloud()` guards (`services/backend-api/src/lib/edition.mjs`,
   `web/lib/edition.ts`). OSS builds must keep working with zero external paid
   services except one LLM key. If your change needs a cloud capability from
   shared code, consume it via `src/lib/cloud-hooks.mjs` (`getCloudHook`) so OSS
   builds degrade gracefully.
3. **Privacy defaults.** No new telemetry, no data leaving the user's server by
   default. Anything that calls out must be opt-in and env-gated.

## Development setup

```bash
# backend (Node 20+)
cd services/backend-api && npm ci && cp env.example .env && npm run dev  # :8787
# web
cd web && npm ci && npm run dev                                          # :3000
```

Run tests before opening a PR:

```bash
cd services/backend-api && npx vitest run      # backend (no LLM key needed)
cd web && npx tsc --noEmit && npm test         # web types + tests
NEXT_PUBLIC_GEDO_EDITION=oss npm run build     # OSS build must stay green
```

## Pull requests

- Keep PRs focused; describe the user-visible behavior change.
- Match surrounding code style (this repo favors small modules, dependency
  injection over globals in new code, and Chinese/English comments that explain
  constraints, not restatements).
- New routes: add the handler in `services/backend-api/src/server.mjs` following
  the existing `if (method && pathname)` pattern, with `requireUser` for
  authenticated endpoints.

## Reporting issues

- Bugs: steps to reproduce + edition (`oss`/`cloud`) + deployment mode (Docker / dev).
- Security issues: see [SECURITY.md](SECURITY.md) — please do not open public issues.

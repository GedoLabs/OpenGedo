# Security Policy

## Reporting a vulnerability

Please email **security@gedo.ai** with details (affected endpoint/component,
reproduction steps, impact). Do **not** open a public GitHub issue for
security-sensitive reports.

We aim to acknowledge within 72 hours and to ship a fix or mitigation for
confirmed issues as fast as severity warrants.

## Scope notes for self-hosters

- The OSS edition is designed to run with zero external services except your
  LLM provider; your data stays in your `GEDO_DATA_DIR` volume.
- `JWT_SECRET` protects all sessions — generate a long random value and never
  reuse it across deployments.
- The digital-persona public endpoints (`/public/v1/persona/*`, `/public/mcp`)
  are rate-limited per IP+slug, but if you expose your instance to the internet
  you should still front it with TLS and a reverse proxy.

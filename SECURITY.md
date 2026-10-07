# Security

## Reporting a vulnerability

Please use GitHub private vulnerability reporting if it is enabled for this repository. Do not include credentials or live tokens in public issues.

## Deployment secrets

Keep credentials in Cloudflare Worker secrets.

- `GITHUB_TOKEN` is optional and must be stored with `wrangler secret put`.
- Do not commit `.dev.vars`, `.env` files, OAuth tokens, Cloudflare API tokens, or production namespace IDs.
- Review staged changes before each release.

## Network safety

The page-fetch tool rejects common private, local, link-local, and cloud metadata destinations. Keep Cloudflare's `global_fetch_strictly_public` compatibility flag enabled.

# Gaps and deviations

What the spec (CLAUDE.md) asks for that is not fully done, plus deliberate
deviations and things to verify. Close an item, delete its line.

## Needs a human (cannot be done from this repo)

- **First commit.** The repo exists (`main`) but has no commits yet. Everything landed at once, so one initial commit is fine; the spec's one-commit-per-milestone rule applies from here on.
- **GitHub:** private repo (owner only; clients never get access), branch protection on `main` (CI required, 1 review, Code Owners), repo variable `SITE_URL`, secrets `LITESTREAM_*` for the monthly restore job. Replace `@OWNER` in `.github/CODEOWNERS`.
- **Railway:** project + service from this repo, volume at `/data`, all env vars from CLAUDE.md, PR environments on, healthcheck `/api/v1/health` (also in `railway.json`), "wait for CI checks" on. **Verify** that Railway passes `SITE_URL` as a Docker build arg; if not, the server rebuilds the pages at boot anyway (see "Runtime rebuild" below), so the site still comes up with the right URLs.
- **Non-root container on a Railway volume:** the image runs as `node` (uid 1000). Railway volumes are mounted root-owned; if the service can't write `/data`, set Railway's `RAILWAY_RUN_UID=0` variable or chown the mount. Verify on first deploy.
- **S3-compatible bucket** and credentials for Litestream. Litestream is pinned to `0.3.13` in the Dockerfile; confirm it's still the current stable release before launch.
- **n8n:** Webhook node with Header Auth, dedupe on `event_id`, API keys from `scripts/key.js` (`content:write` for the automation; `content:publish` and `admin` with a person). `docs/N8N.md` has the steps.
- **Real assets:** `public/hero.mp4` (≤ 4 MB; encoding spec in `README.md`), a real `public/hero-poster.jpg`, `public/og-default.png`, a favicon, and all the copy in `site.config.js`. Everything currently there is a generated placeholder. Case studies, testimonials and results are placeholders and must not ship.
- **DNS and Search Console** at launch (M9).

## Not verified on the build machine

- `make smoke` and `make dev` need to bind a port, which the build machine's sandbox blocks. `make smoke` was run once outside the sandbox (plain `node`, not Docker) and passed all 34 checks; it has not been run against the Docker image.
- Docker is not installed here, so the Dockerfile has not been built. `make smoke` falls back to plain `node` when docker is missing.
- Lighthouse (`lhci autorun`) runs only in CI; the budgets in `lighthouserc.json` have not been measured yet. Expect image/document sizes to be the first thing to tune once real assets exist.
- `gitleaks` runs only in CI.

## Deliberate deviations from the spec

- **Extra dev dependencies:** `@eslint/js` and `globals` (ESLint 10's flat config needs them for the recommended rule set and Node globals), `@types/node`, `@types/better-sqlite3` (needed for `tsc --checkJs` to type third-party APIs; markdown-it and Fastify ship their own types). None ship at runtime.
- **`make` is installed in the Docker build stage** (`node:24-slim` doesn't have it) so the build stage can run `make build` as the spec says.
- **Unknown form fields are stripped, not rejected.** Fastify's default Ajv config has `removeAdditional: true`. Plain browser posts include things like submit-button names, so this is friendlier and no less safe: only schema-listed fields reach the handlers.
- **No-JS form feedback uses `:target`.** The redirect is `/contact?sent=1#sent` (or `?error=<code>#error`) and CSS `:target` reveals the message, so users without JavaScript see confirmation without a script.
- **Stale idempotency records are taken over.** A record left `in_progress` for over 60 s (the process died mid-request) is reclaimed by the next identical request instead of returning 409 forever. The spec doesn't say; this seemed the safer behaviour.
- **Manual outbox retry resets the 48 h window** (`dead_after` column), otherwise a retried event older than 48 h would die again on its first failure.
- **`GET /api/v1/status` reports whether backups are _configured_, not running.** Litestream is the parent process; the app can't observe it. Monitoring the replica's freshness in the bucket is the reliable signal.
- **Runtime render.** The server renders `dist/` from the database at every boot and after every content change, so the `SITE_URL` baked into the image's file-based build never matters at run time. CSS is URL-independent and reused. Renders go into `dist.next/` and are swapped in by rename; the window where neither directory exists is two `rename()` calls wide (microseconds), during which a request would get the 404 page rather than a half-written one.
- **Tests fake n8n with an injected `fetch`, not a socket server.** Same three failure modes (500, hang past the timeout, 200-then-crash before recording); no port needed.
- **`lead.updated` has no emitter yet.** The spec reserves it for human edits; there is no admin UI, so nothing calls `updateLead(..., { emitEvent: true })`. The service supports it when a UI exists.
- **RSS `<description>` is the post's meta description**, not the body.

## Known limitations to fix later

- Rate limiting is in-memory (single instance, fine on Railway; resets on restart).
- `trustProxy: true` is set because Railway terminates TLS and forwards `X-Forwarded-For`. If the service is ever exposed without a proxy in front, clients could spoof that header and dodge the per-IP rate limit; switch it off or restrict it to the proxy's address.
- **Assets are reachable before approval.** An image is served at `/images/<uuid>.<ext>` from the moment it is imported, even if only a draft uses it. The URL is unguessable (uuid) and never linked from a public page until publish, but it is the one exception to "nothing is public until published". Gating it on "used by a live version" would break images embedded in draft bodies during preview; revisit in M12 (serve draft-only assets through the preview route) if a client needs the stricter rule.
- **Preview links are bearer tokens.** Whoever has `/preview/<token>` can read that draft. Pages are `noindex`, `no-store` and `Referrer-Policy: no-referrer`, so the token doesn't leak via search engines, caches or links inside the draft; it still travels wherever the link is pasted. A new token per post on publish is a possible tightening.
- **Metadata stripping is header-level.** EXIF/XMP/text chunks are dropped from JPEG, PNG and WebP at import (`src/lib/image-strip.js`); ICC profiles and JFIF are kept. Steganographic or in-pixel data is out of scope, and a hand-crafted file with metadata inside the compressed image stream would pass.
- The privacy page is a generic draft; have it reviewed for the owner's jurisdiction.
- No `favicon.ico`; only an SVG favicon. Add a PNG/ICO if older clients matter.
- `check-links --external` skips URLs containing `[…]` placeholders from `site.config.js`; once real links exist it checks them all.

## v2: content platform (M10 done; M11–M14 open)

CLAUDE.md describes the "your AI can't break this" content API (milestones M10–M14). Status:

- **M10 done.** Posts, site copy and assets live in SQLite (`002_content.sql`); `content/` and `site.config.js` are seed data imported on first boot (`src/content/seed.js`); the server renders `dist/` from the DB at boot and on `renderer.schedule()` (1 s debounce); `/images/` is served from `$DATA_DIR/assets`; `redirects` rows become 301s. The bot-path guard is gone. Decision taken: re-render at boot rather than persisting `dist/` on the volume (tens of milliseconds at this page count).
- **M11 done.** `/api/v1/posts` (`src/routes/content.js`): drafts, PATCH with `If-Match`, publish/unpublish/delete, versions and revert, `/preview/<token>` (`src/routes/preview.js`, `src/build/preview.js`), `content:*` scopes, `post.published`/`post.unpublished` events, audit rows per write. Review gating is hard-coded on: only `content:publish` can publish until M13's `review_required` setting exists.
- **M12:** site copy and assets endpoints. `SITE_COPY_SCHEMA` (`src/content/site-schema.js`) and `importAssetBuffer()` exist; assets take raw image bytes as the body, not multipart (decided; spec updated).
- **M13:** review gating is effectively hard-coded on (only `content:publish` can publish); settings, quotas, circuit breaker, freeze and export are not built.
- **M14:** `docs/N8N.md` still describes the retired PR-based publishing flow; rewrite alongside the new `docs/CLIENT.md`. The `Human-only steps` "per client" bullet cannot be completed before M14.
- The seeded placeholder post (`content/posts/why-own-your-automation-stack.md`) is imported on a client's first boot; delete it from `content/` before deploying a client, or unpublish it through the API afterwards.

# Brand site + n8n backend

A marketing site with a blog, and the small backend that connects it to a
client's automation: contact and newsletter forms land in SQLite and are
delivered to n8n through a transactional outbox; leads and content are read and
written over a keyed API built so an AI tool can't break the site (validated,
versioned, reversible, rate-limited, human publish step by default). One Node
process, one container, one Railway service per client. Clients never touch
git.

**Status:** the site, leads API and outbox (M0–M8) are built. Of the content
platform (M10–M14, the "your AI can't break this" contract in `CLAUDE.md`),
M10 is done: content lives in SQLite, `content/` and `site.config.js` are seed
data for the first boot, and the server renders the pages from the database.
The posts API (M11) is next; until then content changes go through the seed
files.

The full contract (endpoints, status codes, events, budgets, milestones) is in
[`CLAUDE.md`](CLAUDE.md). What is not finished or deviates from it is in
[`docs/GAPS.md`](docs/GAPS.md). The owner's n8n setup guide is
[`docs/N8N.md`](docs/N8N.md).

## Quick start

```sh
npm install
cp .env.example .env            # then fill it in; see below
node scripts/key.js dev leads:read,leads:write,admin   # paste the API_KEYS line into .env
npm run dev                     # build, watch CSS, serve http://localhost:3000
```

`.env` needs every variable listed in `.env.example` except the `LITESTREAM_*`
ones (production only). The process refuses to start and names anything
missing.

## Commands

| Command                        | What it does                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `make dev` / `npm run dev`     | dev build, CSS watcher, server with `--watch`                                  |
| `make build` / `npm run build` | Tailwind + render every page into `dist/`                                      |
| `make test` / `npm test`       | `node --test`                                                                  |
| `make ci` / `npm run ci`       | lint, typecheck, check-content, test, build, html-validate, check-links, smoke |
| `make smoke`                   | run the real server (Docker image if docker exists) and curl everything        |

`make ci` is exactly what CI runs.

## Layout

```
site.config.js       every piece of brand copy (placeholders until replaced)
content/posts/       blog posts, Markdown + frontmatter
content/images/      post images (≤ 300 KB)
public/              favicon, og-default.png, hero-poster.jpg, hero.mp4
src/server.js        Fastify app factory + entrypoint
src/routes/          /api/contact, /api/subscribe, /api/v1/*
src/services/        leads, subscribers, outbox, idempotency, dedupe
src/worker/          outbox delivery to n8n
src/templates/       html`` templates for every page
src/build/           static site build (also runs at boot if SITE_URL changed)
src/db/migrations/   numbered, forward-only SQL
scripts/             build, checks, smoke, key generation, restore
test/                node:test suites and fixtures
docs/                N8N.md (integration guide), GAPS.md (what's left)
```

## Hero video

`public/hero.mp4` is optional; the home page shows `hero-poster.jpg` alone
until it exists. Spec: MP4/H.264, `yuv420p`, no audio, 1920×1080 or 1600×900,
8–15 s seamless loop, 24–30 fps, `+faststart`, **under 4 MB** (the build fails
above that). One frame of it, as a ~100–150 KB JPEG, is the poster.

```sh
ffmpeg -i input.mov -an -vf "scale=1920:-2,fps=30" -c:v libx264 -profile:v high \
  -pix_fmt yuv420p -crf 28 -preset slow -movflags +faststart public/hero.mp4
```

## Deploying

Railway builds the `Dockerfile` and runs `docker/entrypoint.sh`, which starts
the server under Litestream when `LITESTREAM_BUCKET` is set. Set the
environment variables from `CLAUDE.md` → Environment, mount a volume at
`/data`, and point the healthcheck at `/api/v1/health`. The human-only setup
steps are listed in `docs/GAPS.md`.

# n8n integration guide

This is the owner's guide to wiring n8n to the site. The site pushes events
to n8n (leads and subscribers), n8n reads and updates leads through the API,
and n8n writes blog drafts through the same API. Nothing here needs to
be redone on a redeploy; it all lives in n8n and in Railway variables.

## 1. Events from the site → n8n

**Set up in n8n:** a **Webhook** node.

| Setting        | Value                                                                            |
| -------------- | -------------------------------------------------------------------------------- |
| HTTP Method    | POST                                                                             |
| Path           | anything, e.g. `site-events`. The full URL goes in Railway as `N8N_WEBHOOK_URL`. |
| Authentication | **Header Auth**                                                                  |
| Header name    | `X-Webhook-Token`                                                                |
| Header value   | the same string you put in Railway as `N8N_WEBHOOK_TOKEN`                        |
| Respond        | Immediately, 200                                                                 |

**What arrives.** One JSON body per event:

```json
{
  "event_id": "b3d5…-uuid",
  "event_type": "lead.created",
  "occurred_at": "2026-03-01T14:22:08.123Z",
  "data": {
    "id": 42,
    "name": "…",
    "email": "…",
    "company": null,
    "message": "…",
    "source": "/contact",
    "status": "new",
    "tags": [],
    "notes": "",
    "version": 1,
    "created_at": "…",
    "updated_at": "…"
  }
}
```

Event types: `lead.created` (contact form), `subscriber.created` (newsletter
or lead magnet; `data` has `email`, `list`, `source`), `lead.updated`
(only when a human edits a lead; your own PATCHes never echo back),
`post.published` and `post.unpublished` (`data` has `id`, `slug`, `version`,
`url`, and `deleted: true` when the post was deleted; never the body).

Headers on every delivery:

| Header            | Meaning                                                                                |
| ----------------- | -------------------------------------------------------------------------------------- |
| `X-Webhook-Token` | shared secret, checked by Header Auth                                                  |
| `X-Event-Id`      | same as `event_id` in the body                                                         |
| `X-Event-Type`    | same as `event_type`                                                                   |
| `X-Timestamp`     | epoch milliseconds when this delivery attempt was sent                                 |
| `X-Signature`     | `sha256=<hex>` — HMAC-SHA256 of `"<X-Timestamp>.<raw body>"` with `N8N_SIGNING_SECRET` |

### ⚠️ Deliveries are at-least-once: dedupe on `event_id`

If the site crashes after n8n answered 200 but before it recorded the
delivery, **the same event is sent again with the same `event_id`.** Your
workflow must treat a repeated `event_id` as already handled. The simplest
way: first node after the webhook writes `event_id` to a sheet/table/Data
Store with a unique key, and stops if it was already there.

Retry schedule when n8n is down or errors (5xx, 429, 408, timeout, network):
30s, 2m, 10m, 30m, 2h, then every 6h, giving up after 48 hours. A 4xx other
than 408/429 means the webhook is misconfigured: the event is parked as
**dead** immediately. Dead events are listed at `GET /api/v1/outbox?status=dead`
and re-queued with `POST /api/v1/outbox/<id>/retry` (admin scope).

### Verifying the signature (optional but recommended)

In a **Code** node right after the webhook:

```js
const crypto = require('crypto');
const secret = $env.N8N_SIGNING_SECRET; // set in n8n's environment
const ts = $input.first().headers['x-timestamp'];
const raw = $input.first().binary?.data
  ? Buffer.from($input.first().binary.data.data, 'base64').toString()
  : JSON.stringify($input.first().json.body);
const expected =
  'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
if (expected !== $input.first().headers['x-signature']) throw new Error('bad signature');
return $input.all();
```

Turn on "Raw Body" in the Webhook node so `raw` is byte-exact.

## 2. n8n → the site (reading and updating leads)

**Create a key** on your machine (never on the server):

```
node scripts/key.js n8n leads:read,leads:write
```

It prints the key once and an `API_KEYS` line. Put the key in an n8n
**Header Auth** credential (`Authorization: Bearer <key>`); append the line to
the `API_KEYS` variable in Railway (entries separated by `;`). Scopes:
`leads:read`, `leads:write`, `content:read`, `content:write`,
`content:publish`, `admin`. A key lists exactly what it may do; `admin` does
not imply the others. Give automation `content:write` and keep
`content:publish` (and `admin`) with a person. A key with the wrong scope gets
403; an unknown key gets 401.

| Call                                 | Scope       | Notes                                                                                                                                                                                                       |
| ------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/health`                 | none        | `{ ok: true }`                                                                                                                                                                                              |
| `GET /api/v1/leads?limit=50&cursor=` | leads:read  | oldest first; follow `next_cursor` until it's `null`. Use this to catch up when the webhook was down.                                                                                                       |
| `GET /api/v1/leads/:id`              | leads:read  | `ETag: "<version>"`                                                                                                                                                                                         |
| `PATCH /api/v1/leads/:id`            | leads:write | body: any of `status` (`new`, `contacted`, `qualified`, `won`, `lost`), `tags` (array of strings), `notes` (string). Send `If-Match: <version>` to avoid overwriting someone else's edit (412 on mismatch). |
| `GET /api/v1/status`                 | admin       | outbox counts, last delivery time                                                                                                                                                                           |
| `GET /api/v1/outbox?status=dead`     | admin       | dead letters                                                                                                                                                                                                |
| `POST /api/v1/outbox/:id/retry`      | admin       | re-queue                                                                                                                                                                                                    |

### Idempotency-Key on every POST and PATCH

Set an `Idempotency-Key` header (any unique string per logical operation, e.g.
the n8n execution id plus the lead id). Retrying with the same key and the
same body returns the original response (header `Idempotent-Replayed: true`);
the same key with a different body gets 422; two overlapping requests get 409
with `Retry-After: 2`. Keys are remembered for 24 hours.

### Status codes you will see

202 accepted · 200 ok · 400 malformed · 401 unknown key · 403 wrong scope ·
404 no such lead · 409 in progress · 412 version mismatch · 413 body too big ·
422 validation failed / key reused · 429 slow down (`Retry-After`) ·
503 database busy, retry.

## 3. Blog posts: drafts through the API, a person publishes

No git, no pull requests. Your automation writes drafts; someone with the
`content:publish` key makes them live. Every call needs `Authorization:
Bearer <key>` and (for POST/PATCH/DELETE) an `Idempotency-Key` header.

1. `POST /api/v1/posts` (`content:write`) with JSON:
   `{ "slug": "kebab-case", "title": "10–70 chars", "description": "50–160 chars",
"body": "Markdown, ≤ 64 KB", "tags": ["1–5 tags"], "date": "YYYY-MM-DD" (optional) }`.
   Reply is 201 with the post, its `id`, and a `preview_url`: an unlisted,
   noindex page showing exactly how the post will look. Raw HTML in the body
   is shown as text, never rendered.
2. Edit with `PATCH /api/v1/posts/:id` (any of the fields above). Send
   `If-Match: "<head_version>"` to avoid clobbering a concurrent edit (412 on
   mismatch). Editing a published post creates a new draft version; the live
   page doesn't change until the next publish.
3. Publish with `POST /api/v1/posts/:id/publish` (`content:publish`). The page
   is live within about a second and a `post.published` event is sent.
   `POST …/unpublish` takes it down (post kept); `DELETE …` soft-deletes and
   301-redirects the old URL to `/blog`.
4. Every version is kept: `GET …/versions` lists them, `POST …/revert/:version`
   restores one (and publishes it if the post is live).

Rules the API enforces so nothing can break the site: the slug can't change
once published (422 `slug_immutable`); a slug can't be reused (409
`slug_conflict`); bad or oversized fields get 422 with the field named;
`content:write` can't publish (403).

Seed post format (only for files shipped in the repo's `content/posts/`; they
are imported on the very first boot and then owned by the database):

```markdown
---
title: Ten to seventy characters
description: Fifty to one hundred sixty characters, used as the meta description and in the feed.
date: 2026-03-01
slug: must-match-the-file-name
tags: [automation, n8n]
brief_id: brief-123
cover: images/some-file.jpg
draft: false
---

Markdown body. Raw HTML is escaped, not rendered.
```

## 4. Railway variables (set once)

`PORT` (Railway sets it), `DATA_DIR=/data`, `SITE_URL`, `N8N_WEBHOOK_URL`,
`N8N_WEBHOOK_TOKEN`, `N8N_SIGNING_SECRET`, `API_KEYS`, and the four
`LITESTREAM_*` values for backups. A missing one stops the service from
starting and names itself in the logs. Before the backup bucket exists you
may set `BACKUPS=off` to boot without replication; it is logged at every
start, and it is not a way to run a client's site for real.

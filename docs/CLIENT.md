# Your site's API: the one-page guide

Everything your site holds (posts, leads, subscribers) is yours, in a
database you can export, reachable through a small HTTP API. Your automation
(n8n, an AI agent, a script) writes drafts; a person publishes. Nothing your
tools do can break the public site.

## What you were given

- **The docs URL:** `https://<your-site>/docs`. Every endpoint, every field,
  every status code, generated from the running server so it is never out
  of date. Machine-readable version for AI tools: `https://<your-site>/api/v1/openapi.json`.
- **API keys.** Each key has fixed scopes. Typically:
  - one `content:write` key for your automation (it can create and edit drafts, never publish),
  - one `content:publish` key kept by a person (or given to the automation later, on purpose),
  - a `leads:read` / `leads:write` key for your CRM automation.
    Keys are shown once when generated and stored only as hashes. Lost a key? A new one is issued and the old line removed; nothing else changes.
- **A webhook.** When a lead arrives or a post is published, your webhook URL
  receives a signed event. Duplicates are possible by design: **deduplicate on
  `event_id`.**

## How to publish something

1. `POST /api/v1/posts` with the post as JSON (Markdown body). You get back an
   `id` and a `preview_url`.
2. Open the preview. It is unlisted and looks exactly like the live page.
3. `POST /api/v1/posts/<id>/publish` with the `content:publish` key. Live in
   about a second.

Edits (`PATCH`) create new versions and never touch the live page until you
publish again. Made a mistake? `POST /api/v1/posts/<id>/revert/<version>`.
Want it gone? `unpublish` (kept, hidden) or `DELETE` (old link redirects to the
blog).

Every write needs two headers: `Authorization: Bearer <key>` and
`Idempotency-Key: <any unique string>`. The second one means a retried
request can never create two posts.

## What the API refuses, and why

| You send                                             | You get                                              |
| ---------------------------------------------------- | ---------------------------------------------------- |
| A title under 10 characters                          | `422` naming the field. Fix and resend.              |
| HTML in a post body                                  | Accepted, shown as text. Only Markdown renders.      |
| A slug that already exists                           | `409` with the other post's id.                      |
| A new slug for a published post                      | `422 slug_immutable`. Links to it must keep working. |
| A publish with a write-only key                      | `403`. Publishing is the human step.                 |
| Too many requests                                    | `429` with `Retry-After`.                            |
| An image that is not PNG/JPEG/WebP or is over 300 KB | `422` (from the assets endpoint, when enabled).      |

## Getting your data out

`GET /api/v1/export` (admin key) returns everything: the database and the
images. Own everything means you can leave in an afternoon.

## Questions

Read `/docs` first; it is the contract. If something there does not match
what happens, that is a bug and it gets fixed.

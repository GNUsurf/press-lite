/**
 * /docs: the API reference, rendered from the OpenAPI document so it can't
 * drift from the routes. Same layout and CSS as the site; no script.
 */
import { html } from '../../lib/html.js';
import { layout } from '../layout.js';

export const path = '/docs';

/**
 * @param {import('../../build/context.js').BuildContext} ctx
 * @param {ReturnType<typeof import('../../lib/openapi.js').buildOpenApi>} api
 */
export function renderDocs(ctx, api) {
  const tags = api.tags.map((t) => t.name);
  const ops = Object.entries(api.paths).flatMap(([p, methods]) =>
    Object.entries(methods).map(([method, op]) => ({
      path: p,
      method: method.toUpperCase(),
      op: /** @type {any} */ (op),
    })),
  );
  const body = html`
    <article class="container-narrow max-w-4xl py-20">
      <h1 class="text-4xl font-bold tracking-tight">${api.info.title}</h1>
      <p class="mt-4 text-lg text-ink-muted">${api.info.description}</p>
      <p class="mt-2 text-sm text-ink-muted">Base URL <code class="rounded bg-slate-100 px-1">${api.servers[0].url}</code> · machine-readable: <a href="/api/v1/openapi.json" class="text-accent underline">openapi.json</a></p>

      <nav aria-label="Sections" class="mt-8 flex flex-wrap gap-4 text-sm">
        <a href="#getting-started" class="underline">Getting started</a>
        ${tags.map((t) => html`<a href="#${slug(t)}" class="underline">${t}</a>`)}
        <a href="#events" class="underline">Events</a>
        <a href="#errors" class="underline">Errors</a>
      </nav>

      <section id="getting-started" class="prose-post mt-12">
        <h2>Getting started</h2>
        <p>Every request to <code>/api/v1/</code> carries your key: <code>Authorization: Bearer &lt;key&gt;</code>. A key has fixed scopes; each operation below names the one it needs. A missing or unknown key gets <code>401</code>, a key without the scope gets <code>403</code>.</p>
        <p>Every <code>POST</code>, <code>PATCH</code> and <code>DELETE</code> also needs an <code>Idempotency-Key</code> header: any unique string per operation (a UUID is fine). Retrying with the same key and body returns the original response; you can never create something twice by accident.</p>
        <p>The usual flow for content: <strong>create a draft</strong> → open its <code>preview_url</code> → <strong>publish</strong> (a separate call, with the <code>content:publish</code> scope that a person keeps). Every edit is a new version; <strong>revert</strong> brings any earlier one back in one call.</p>
        <pre><code>curl -X POST ${api.servers[0].url}/api/v1/posts \\
  -H "Authorization: Bearer $KEY" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{"slug":"first-post","title":"A first post, ten characters or more",
       "description":"A description of at least fifty characters, used for the meta tag and feed.",
       "body":"Markdown **only**. HTML is shown as text.","tags":["news"]}'</code></pre>
      </section>

      ${tags.map(
        (tag) => html`
      <section id="${slug(tag)}" class="mt-16">
        <h2 class="text-2xl font-bold tracking-tight">${tag}</h2>
        <p class="mt-1 text-ink-muted">${api.tags.find((t) => t.name === tag)?.description}</p>
        ${ops.filter((o) => o.op.tags?.[0] === tag).map(operation)}
      </section>`,
      )}

      <section id="events" class="mt-16">
        <h2 class="text-2xl font-bold tracking-tight">Events (webhooks)</h2>
        <p class="mt-1 text-ink-muted">Sent to your webhook URL as <code>POST</code> with a JSON body <code>{ event_id, event_type, occurred_at, data }</code>, at least once. <strong>Deduplicate on <code>event_id</code>.</strong> Headers: <code>X-Webhook-Token</code>, <code>X-Event-Id</code>, <code>X-Event-Type</code>, <code>X-Timestamp</code>, and <code>X-Signature</code> (<code>sha256=</code> HMAC of <code>"&lt;timestamp&gt;.&lt;raw body&gt;"</code>).</p>
        <dl class="mt-6 grid gap-3">
          ${Object.entries(api.webhooks).map(
            ([name, hook]) => html`
          <div class="rounded-md border border-slate-200 p-4">
            <dt class="font-mono font-semibold">${name}</dt>
            <dd class="mt-1 text-ink-muted">${/** @type {any} */ (hook).post.description}</dd>
          </div>`,
          )}
        </dl>
      </section>

      <section id="errors" class="prose-post mt-16">
        <h2>Errors</h2>
        <p>Errors are JSON: <code>{ "error": "&lt;code&gt;", "message": "…" }</code>. Validation failures (<code>422</code>) name the field in <code>message</code>. Conflicts (<code>409</code>) include the conflicting <code>id</code>. Rate limits (<code>429</code>) and in-progress duplicates (<code>409</code>) send <code>Retry-After</code>.</p>
      </section>
    </article>
  `;

  return layout(
    ctx,
    {
      title: 'API',
      description: `${ctx.site.name}: API reference for leads, content and events.`,
      path,
      noindex: true,
    },
    body,
  );
}

/** @param {{ path: string, method: string, op: any }} o */
function operation({ path: p, method, op }) {
  const body = op.requestBody?.content?.['application/json']?.schema;
  const params = /** @type {any[]} */ (op.parameters ?? []).filter((x) => !x.$ref);
  const headers = /** @type {any[]} */ (op.parameters ?? [])
    .filter((x) => x.$ref)
    .map((x) => String(x.$ref).split('/').pop());
  return html`
        <div class="mt-8 rounded-lg border border-slate-200 p-5" id="${slug(`${method} ${p}`)}">
          <h3 class="flex flex-wrap items-baseline gap-3 text-lg font-semibold">
            <span class="rounded bg-ink px-2 py-0.5 font-mono text-xs text-white">${method}</span>
            <code>${p}</code>
            ${op['x-scope'] ? html`<span class="rounded-full bg-paper-alt px-2 py-0.5 text-xs text-ink-muted">scope: ${op['x-scope']}</span>` : html`<span class="rounded-full bg-paper-alt px-2 py-0.5 text-xs text-ink-muted">public</span>`}
          </h3>
          <p class="mt-1 font-medium">${op.summary}</p>
          <p class="mt-2 text-ink-muted">${op.description}</p>
          ${headers.length ? html`<p class="mt-2 text-sm text-ink-muted">Headers: ${headers.map((h) => html`<code class="mr-2">${h === 'IdempotencyKey' ? 'Idempotency-Key (required)' : 'If-Match (optional)'}</code>`)}</p>` : null}
          ${
            params.length
              ? html`<table class="mt-4 w-full text-sm"><thead><tr class="text-left text-ink-muted"><th class="pr-4 font-medium">Parameter</th><th class="pr-4 font-medium">In</th><th class="font-medium">Type</th></tr></thead><tbody>
            ${params.map((x) => html`<tr><td class="pr-4 font-mono">${x.name}${x.required ? '' : '?'}</td><td class="pr-4">${x.in}</td><td>${describe(x.schema)}</td></tr>`)}
          </tbody></table>`
              : null
          }
          ${body ? html`<p class="mt-4 text-sm font-medium">Body (JSON${op.requestBody.content['application/x-www-form-urlencoded'] ? ' or form-encoded' : ''})</p>${fields(body)}` : null}
          <p class="mt-4 text-sm font-medium">Responses</p>
          <ul class="mt-1 grid gap-1 text-sm">
            ${Object.entries(op.responses).map(([code, r]) => html`<li><code class="mr-2">${code}</code>${/** @type {any} */ (r).description}</li>`)}
          </ul>
        </div>`;
}

/** Render an object schema's properties as a table. @param {any} schema */
function fields(schema) {
  const required = new Set(schema.required ?? []);
  return html`<table class="mt-1 w-full text-sm"><thead><tr class="text-left text-ink-muted"><th class="pr-4 font-medium">Field</th><th class="font-medium">Type and limits</th></tr></thead><tbody>
    ${Object.entries(schema.properties ?? {}).map(([name, def]) => html`<tr><td class="pr-4 align-top font-mono">${name}${required.has(name) ? '' : '?'}</td><td>${describe(def)}</td></tr>`)}
  </tbody></table>`;
}

/** One line for a JSON Schema fragment. @param {any} s */
function describe(s) {
  if (!s) return '';
  if (s.anyOf) return s.anyOf.map(describe).join(' or ');
  const type = Array.isArray(s.type) ? s.type.join(' | ') : s.type;
  const bits = [type];
  if (s.enum) bits.push(`one of ${s.enum.join(', ')}`);
  if (s.format) bits.push(s.format);
  if (s.pattern) bits.push(`matches ${s.pattern}`);
  if (s.minLength !== undefined || s.maxLength !== undefined)
    bits.push(`${s.minLength ?? 0}–${s.maxLength ?? '∞'} chars`);
  if (s.minimum !== undefined || s.maximum !== undefined)
    bits.push(`${s.minimum ?? ''}–${s.maximum ?? ''}`);
  if (s.minItems !== undefined || s.maxItems !== undefined)
    bits.push(`${s.minItems ?? 0}–${s.maxItems ?? '∞'} items`);
  if (s.items) bits.push(`of ${describe(s.items)}`);
  if (s.default !== undefined) bits.push(`default ${s.default}`);
  return bits.filter(Boolean).join(', ');
}

/** @param {string} text */
function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, raw, escapeHtml, safeUrl } from '../src/lib/html.js';

test('escapes <script> in interpolation', () => {
  const out = html`<p>${'<script>alert(1)</script>'}</p>`.toString();
  assert.equal(out, '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
});

test('escapes quotes inside attributes', () => {
  const out = html`<a title="${'" onmouseover="alert(1)'}">x</a>`.toString();
  assert.equal(out, '<a title="&quot; onmouseover=&quot;alert(1)">x</a>');
  assert.ok(!out.includes('onmouseover="alert'));
});

test('interpolated <img onerror> renders as text', () => {
  const out = html`<div>${'<img src=x onerror=alert(1)>'}</div>`.toString();
  assert.equal(out, '<div>&lt;img src=x onerror=alert(1)&gt;</div>');
});

test('nested html`` is not double-escaped; raw() passes through', () => {
  const inner = html`<b>${'a & b'}</b>`;
  assert.equal(html`<p>${inner}</p>`.toString(), '<p><b>a &amp; b</b></p>');
  assert.equal(html`<p>${raw('<i>ok</i>')}</p>`.toString(), '<p><i>ok</i></p>');
});

test('arrays join, null/undefined/false render as nothing', () => {
  const items = ['<', '&'].map((s) => html`<li>${s}</li>`);
  assert.equal(html`<ul>${items}</ul>`.toString(), '<ul><li>&lt;</li><li>&amp;</li></ul>');
  assert.equal(html`${null}${undefined}${false}${0}`.toString(), '0');
});

test('escapeHtml covers the five significant characters', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

test('safeUrl blocks javascript: and data: URLs', () => {
  assert.equal(safeUrl('javascript:alert(1)'), '#');
  assert.equal(safeUrl('JavaScript:alert(1)'), '#');
  assert.equal(safeUrl(' javascript:alert(1)'), '#');
  assert.equal(safeUrl('data:text/html,<script>'), '#');
  assert.equal(safeUrl('//evil.example'), '#');
  assert.equal(safeUrl('https://ok.example/x'), 'https://ok.example/x');
  assert.equal(safeUrl('/blog/post'), '/blog/post');
  assert.equal(safeUrl('#top'), '#top');
  assert.equal(safeUrl('mailto:a@b.co'), 'mailto:a@b.co');
});

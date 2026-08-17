'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPage } = require('../helpers/page');

let pageP;
const getWindow = () => (pageP ??= loadPage()).then(p => p.window);

test('fmt formats numbers with thousands separators', async () => {
  const w = await getWindow();
  assert.equal(w.fmt(1234567), '1,234,567');
  assert.equal(w.fmt(0), '0');
  assert.equal(w.fmt(5), '5');
});

test('fmt renders null/undefined as "?"', async () => {
  const w = await getWindow();
  assert.equal(w.fmt(null), '?');
  assert.equal(w.fmt(undefined), '?');
});

test('escapeHtml escapes all special characters', async () => {
  const w = await getWindow();
  assert.equal(w.escapeHtml(`<a href="x" title='y'>&`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;');
  assert.equal(w.escapeHtml('plain text'), 'plain text');
});

test('ident leaves simple identifiers unquoted', async () => {
  const w = await getWindow();
  assert.equal(w.ident('Person'), 'Person');
  assert.equal(w.ident('_private2'), '_private2');
});

test('ident backtick-quotes identifiers with special characters', async () => {
  const w = await getWindow();
  assert.equal(w.ident('My Label'), '`My Label`');
  assert.equal(w.ident('has-dash'), '`has-dash`');
  assert.equal(w.ident('1starts_with_digit'), '`1starts_with_digit`');
});

test('ident escapes embedded backticks by doubling them', async () => {
  const w = await getWindow();
  assert.equal(w.ident('weird`name'), '`weird``name`');
});

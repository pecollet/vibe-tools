'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  loadPage,
  dropFiles,
  flush,
  laneLabels,
} = require('./helpers/page');

const FIXTURE = path.join(__dirname, 'fixtures', 'queries.parquet');
const WIDE = path.join(__dirname, 'fixtures', 'queries-wide.parquet');

function bytesOf(filePath) {
  return fs.readFileSync(filePath);
}

function parquetFile(bytes, name) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return {
    name,
    size: data.byteLength,
    text: async () => { throw new Error('parquet was read as text'); },
    arrayBuffer: async () => { throw new Error('whole parquet was read into memory'); },
    slice(start, end) {
      const s = start || 0;
      const e = end == null ? data.byteLength : end;
      const part = data.subarray(s, e);
      const copy = part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength);
      return { arrayBuffer: async () => copy, size: copy.byteLength };
    },
  };
}

let libsPromise;
function parquetLibs() {
  if (!libsPromise) {
    libsPromise = Promise.all([
      import('hyparquet'),
      import('hyparquet/src/column.js'),
      import('hyparquet/src/schema.js'),
      import('hyparquet/src/convert.js'),
      import('hyparquet-compressors'),
    ]).then(([hy, column, schema, convert, comp]) => ({
      parquetMetadataAsync: hy.parquetMetadataAsync,
      parquetSchema: hy.parquetSchema,
      parquetHeader: column.parquetHeader,
      readPage: column.readPage,
      getTreePath: schema.getTreePath,
      convert: convert.convert,
      DEFAULT_PARSERS: convert.DEFAULT_PARSERS,
      compressors: comp.compressors,
    }));
  }
  return libsPromise;
}

async function openWithParquet(options = {}) {
  const libs = await parquetLibs();
  return loadPage({
    beforeParse(window) {
      window.__parquetLibs = libs;
      if (options.maxBars) window.__parquetMaxBars = options.maxBars;
      if (options.beforeParse) options.beforeParse(window);
    },
  });
}

async function dropAndSettle(window, files) {
  await dropFiles(window, files);
  const count = window.document.getElementById('intervalCount');
  const chart = window.document.getElementById('chart');
  for (let i = 0; i < 40; i++) {
    if (count.textContent !== '0') return;
    if (/no query column|no time column|Could not/i.test(chart.textContent)) return;
    await flush();
  }
}

test('a gzip-compressed parquet file plots one lane per query', async () => {
  const { window: w, document: doc, plots } = await openWithParquet();
  await dropAndSettle(w, [parquetFile(bytesOf(FIXTURE), 'queries_dataframe.parquet.gzip')]);

  assert.equal(doc.getElementById('fileCount').textContent, '1');
  assert.equal(doc.getElementById('intervalCount').textContent, '3');
  assert.equal(doc.getElementById('loadStatus').textContent, '');
  const labels = laneLabels(plots);
  assert.equal(labels.length, 3);
  assert.ok(labels.some(label => label.includes('MATCH (n)')), labels.join('\n'));

  const plot = plots.at(-1);
  const durations = Array.from(plot.data[0].customdata, row => row.durationMs);
  assert.deepEqual(durations, [31, 4, 0]);
  assert.ok(Array.from(plot.data[0].x).every(ms => ms > 0), 'every bar should have a visible width');
  assert.equal(plot.data[0].customdata[0].query, 'MATCH (n) RETURN n');
  assert.equal(plot.data[0].marker.color[1], '#ff5a6a');
  assert.equal(plot.data[0].marker.color[0], '#67a3ff');
  assert.match(plot.data[0].customdata[1].endLine, /runtime: slotted/);
  assert.match(plot.data[0].customdata[1].endLine, /boom/);
});

test('a runtime capture group colors parquet bars', async () => {
  const { window: w, document: doc, plots } = await openWithParquet();
  await dropAndSettle(w, [parquetFile(bytesOf(FIXTURE), 'queries.parquet')]);
  const filter = doc.getElementById('cypherFilter');
  filter.value = 'runtime:\\s*(?<color>\\w+)';
  filter.dispatchEvent(new w.Event('change', { bubbles: true }));
  await flush();

  const colors = plots.at(-1).data[0].marker.color;
  assert.equal(colors.length, 3);
  assert.notEqual(colors[0], colors[1]);
  assert.equal(colors[0], colors[2]);
});

test('a large parquet is sampled instead of plotting every row', async () => {
  const { window: w, document: doc, plots } = await openWithParquet({ maxBars: 20 });
  await dropAndSettle(w, [parquetFile(bytesOf(WIDE), 'queries_dataframe.parquet.gzip')]);

  assert.equal(doc.getElementById('intervalCount').textContent, '20');
  assert.match(doc.getElementById('loadStatus').textContent, /20 of 4,000 sampled/);
  const queries = plots.at(-1).data[0].customdata.map(row => row.query);
  assert.equal(queries.length, 20);
  assert.ok(queries.some(query => /MATCH \(n:3\d{3}\)/.test(query)), queries[queries.length - 1]);
});

async function settleWindow(window, plots, before) {
  for (let i = 0; i < 60; i++) {
    await new Promise(resolve => setTimeout(resolve, 20));
    if (plots.length > before && /in this window/.test(window.document.getElementById('loadStatus').textContent)) return;
  }
}

test('zooming into a parquet sample re-reads every query in that window', async () => {
  const { window: w, document: doc, plots } = await openWithParquet({ maxBars: 20 });
  await dropAndSettle(w, [parquetFile(bytesOf(WIDE), 'queries.parquet')]);
  // One query per second from 2026-11-20 00:00:00, so this window holds rows 1000..1049.
  const before = plots.length;
  doc.getElementById('chart').emit('plotly_relayout', {
    'xaxis.range[0]': '2026-11-20 00:16:40',
    'xaxis.range[1]': '2026-11-20 00:17:29.5',
  });
  await settleWindow(w, plots, before);

  const queries = Array.from(plots.at(-1).data[0].customdata, row => row.query);
  assert.equal(queries.length, 20, 'the window is still capped at the sample size');
  assert.ok(queries.every(query => /MATCH \(n:10[0-4]\d\)/.test(query)), queries.join('\n'));
  assert.match(doc.getElementById('loadStatus').textContent, /20 of ~50 in this window sampled/);

  const narrow = plots.length;
  doc.getElementById('chart').emit('plotly_relayout', {
    'xaxis.range[0]': '2026-11-20 00:16:40',
    'xaxis.range[1]': '2026-11-20 00:16:49.5',
  });
  await settleWindow(w, plots, narrow);
  const exact = Array.from(plots.at(-1).data[0].customdata, row => row.query.split(' ').slice(0, 2).join(' '));
  assert.deepEqual(exact, Array.from({ length: 10 }, (_, i) => `MATCH (n:${1000 + i})`));
  assert.match(doc.getElementById('loadStatus').textContent, /all 10 queries in this window/);

  doc.getElementById('chart').emit('plotly_relayout', { 'xaxis.autorange': true });
  await flush();
  assert.equal(laneLabels(plots).length, 20);
  assert.match(doc.getElementById('loadStatus').textContent, /20 of 4,000 sampled/);
});

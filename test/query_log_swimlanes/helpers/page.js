'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML_PATH = path.resolve(__dirname, '..', '..', '..', 'query_log_swimlanes.html');
const SNIPPET_PATH = path.resolve(__dirname, '..', 'fixtures', 'query.log.snippet');

function snippet() {
  return fs.readFileSync(SNIPPET_PATH, 'utf8');
}

/**
 * Load query_log_swimlanes.html offline. Plotly and flatpickr are stubbed so the
 * page script can run without the CDN. Each Plotly.newPlot call is recorded.
 */
function loadPage(options = {}) {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on('jsdomError', (err) => errors.push(err));
  const plots = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      if (options.beforeParse) options.beforeParse(window);
      window.Plotly = {
        purge(gd) { gd.innerHTML = ''; },
        newPlot(gd, data, layout) {
          const record = { data, layout, handlers: {} };
          plots.push(record);
          gd.classList.add('js-plotly-plot');
          gd.innerHTML = '';
          const doc = gd.ownerDocument;
          const y = (data[0] && data[0].y) || [];
          for (const label of y) {
            const tick = doc.createElement('text');
            tick.setAttribute('class', 'ytick');
            tick.textContent = label;
            gd.appendChild(tick);
          }
          for (const note of (layout && layout.annotations) || []) {
            const el = doc.createElement('div');
            el.className = 'annotation';
            el.textContent = note.text || '';
            gd.appendChild(el);
          }
          gd.on = (name, fn) => {
            (record.handlers[name] || (record.handlers[name] = [])).push(fn);
          };
          gd.emit = (name, payload) => {
            (record.handlers[name] || []).forEach(fn => fn(payload));
          };
          return Promise.resolve(gd);
        },
      };
      window.flatpickr = (el, opts) => {
        const api = {
          selectedDates: [],
          config: opts || {},
          set() {},
          jumpToDate() {},
          clear() { api.selectedDates = []; },
          setDate(d) { api.selectedDates = d ? [d] : []; },
        };
        el._flatpickr = api;
        return api;
      };
      window.confirmDatePlugin = () => ({});
    },
  });
  if (errors.length) {
    throw new Error('page script failed: ' + errors.map(e => e.message || e).join('\n'));
  }
  return { window: dom.window, document: dom.window.document, plots, errors };
}

function timestampCount(text) {
  return text.split(/\r?\n/).filter(line => /^\d{4}-\d{2}-\d{2}/.test(line)).length;
}

function logFile(text, name = 'query.log.004') {
  // jsdom's File has no Blob.text(). The page only needs name + text().
  return { name, text: async () => text };
}

async function dropText(window, text, name = 'query.log.004') {
  await dropFiles(window, [logFile(text, name)]);
}

async function dropFiles(window, files) {
  const drop = window.document.getElementById('drop');
  const event = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files } });
  drop.dispatchEvent(event);
  await flush();
}

async function flush() {
  await new Promise(resolve => setTimeout(resolve, 0));
}

function lastPlot(plots) {
  return plots[plots.length - 1];
}

function laneLabels(plots) {
  const plot = lastPlot(plots);
  const y = plot && plot.data && plot.data[0] && plot.data[0].y;
  return y ? Array.from(y) : [];
}

module.exports = {
  loadPage,
  snippet,
  timestampCount,
  dropText,
  dropFiles,
  logFile,
  flush,
  lastPlot,
  laneLabels,
};

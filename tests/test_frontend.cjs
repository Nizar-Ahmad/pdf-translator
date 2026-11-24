const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/app.js', 'utf8');
function extract(start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }
const context = vm.createContext({ TextDecoder, Set, Map, Error, AbortController, DOMException });
vm.runInContext(extract('async function callTranslate(', '/* ===================================================================='), context);
(async () => {
  const wire = Buffer.from('{"index":1,"translation":"مرحبا"}\n{"index":0,"translation":"hello"}\n{"done":true}\n');
  const chunks = [wire.subarray(0, 34), wire.subarray(34, 37), wire.subarray(37)];
  context.fetch = async () => ({ ok: true, body: { getReader: () => ({
    read: async () => chunks.length ? { value: chunks.shift(), done: false } : { done: true },
    releaseLock() {},
  }) } });
  const events = [];
  const data = await context.callTranslate(['a', 'b'], 'en', 'ar', (i, text) => events.push([i, text]));
  assert.deepEqual(events, [[1, 'مرحبا'], [0, 'hello']]);
  assert.equal(data.translations[0], 'hello');

  let calls = 0, finish;
  context.translationCache = new Map();
  context.getBlocks = async () => [{ text: 'hello' }, { text: '123' }];
  context.hasLetters = (s) => /[a-z]/i.test(s);
  context.callTranslate = async (texts, src, tgt, notify) => {
    calls++;
    await new Promise(resolve => { finish = resolve; });
    notify(0, 'translated');
  };
  vm.runInContext(extract('function splitTranslationText(', 'async function renderTranslation('), context);
  const first = context.pageTranslation({ pageNumber: 1 }, 'en', 'ar');
  const second = context.pageTranslation({ pageNumber: 1 }, 'en', 'ar');
  assert.equal(first, second);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(first.pending.size, 1);
  finish(); await first.promise;
  assert.equal(first.translations[0], 'translated');
  assert.equal(first.translations[1], '123');
  assert.equal(first.pending.size, 0);
  const long = 'x'.repeat(41000) + '😀';
  const parts = context.splitTranslationText(long);
  assert.equal(parts.join(''), long);
  assert.ok(parts.every(part => part.length <= 16000));
  context.translationCache.clear();
  context.getBlocks = async () => [{ text: long }];
  context.callTranslate = async (texts, src, tgt, notify) => {
    assert.ok(texts.every(text => text.length <= 20000));
    texts.forEach((text, i) => notify(i, text));
  };
  const oversized = context.pageTranslation({ pageNumber: 2 }, 'en', 'ar');
  await oversized.promise;
  assert.equal(oversized.pending.size, 0);

  vm.runInContext(extract('function updateParagraph(', '/* ===================================================================='), context);
  let writes = 0;
  const node = { value: 'unchanged', get textContent() { return this.value; },
    set textContent(v) { writes++; this.value = v; }, setAttribute() {} };
  context.updateParagraph(node, { pending: new Set(), translations: ['unchanged'] }, 0);
  assert.equal(writes, 0);
  context.updateParagraph(node, { pending: new Set(), translations: ['updated'] }, 0);
  assert.equal(writes, 1);
  let resolveA;
  const destroyed = [];
  const el = new Proxy({}, { get: (obj, key) => obj[key] ||= {} });
  const state = { pdf: null };
  const pdf = name => ({ name, numPages: 1, destroy() { destroyed.push(name); } });
  const loading = vm.createContext({ Uint8Array, console, window: {}, document: {}, el, state,
    blocksCache: new Map(), translationCache: new Map(), docOpts: {}, toast() {},
    selToken: 0, lastSelKey: '', current: null, history: [], renderPanel() {}, loadBookDictionary() {}, registerBook() {}, stopPractice() {}, library: { remember() {} }, preferences: { stop() {}, get: () => true },
    store: { get: () => 1 }, clamp: x => x, goTo: async () => {},
    pdfjsLib: { getDocument: ({ data }) => ({ promise: data[0] === 1
      ? new Promise(resolve => { resolveA = resolve; }) : Promise.resolve(pdf('B')) }) },
  });
  vm.runInContext(extract('let fileLoadToken =', '/* ===================================================================='), loading);
  const fileA = loading.openFile({ name: 'A.pdf', size: 1, arrayBuffer: async () => [1] });
  await new Promise(resolve => setImmediate(resolve));
  await loading.openFile({ name: 'B.pdf', size: 1, arrayBuffer: async () => [2] });
  resolveA(pdf('A')); await fileA;
  assert.equal(state.pdf.name, 'B');
  assert.deepEqual(destroyed, ['A']);

  const languages = vm.createContext({ state: { src: 'en', tgt: 'ar' }, JSON });
  vm.runInContext(source.slice(source.indexOf('const selectionKey ='), source.indexOf('\n', source.indexOf('const selectionKey ='))), languages);
  const arabicKey = vm.runInContext("selectionKey('hello')", languages);
  languages.state.tgt = 'fr';
  assert.notEqual(vm.runInContext("selectionKey('hello')", languages), arabicKey);
  console.log('Frontend streaming, batching, DOM updates, file race, and language-key checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });

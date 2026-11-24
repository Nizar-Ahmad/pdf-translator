const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('static/app.js', 'utf8');
let scrollTop = 0;
class Node {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.dataset = {}; this.style = { setProperty() {} };
    this.classList = { add() {}, remove() {} };
    this.hidden = false; this.width = 0; this.height = 0;
  }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  replaceWith(other) { const i = this.parentNode.children.indexOf(this); this.parentNode.children[i] = other; other.parentNode = this.parentNode; }
  setAttribute() {} addEventListener() {}
  get offsetHeight() {
    if (this.hidden) return 0;
    if (this.className === 'pageRow') return Math.max(...this.children.map(child => child.offsetHeight));
    if (this.className === 'col') return 24 + Math.max(...this.children.map(child => child.offsetHeight));
    return parseFloat(this.style.height || this.style.minHeight) || 0;
  }
  getBoundingClientRect() {
    const siblings = this.parentNode.children, i = siblings.indexOf(this);
    const top = 22 + siblings.slice(0, i).reduce((sum, node) => sum + node.offsetHeight + 28, 0) - scrollTop;
    return { top, bottom: top + this.offsetHeight };
  }
  getContext() { return {}; }
}
const stage = new Node();
const scroller = { clientWidth: 1000, clientHeight: 500, addEventListener() {},
  getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
  get scrollTop() { return scrollTop; }, set scrollTop(value) { scrollTop = Math.max(0, value); } };
const messages = [], rendered = [], cancelled = [], stored = new Map(), frames = [];
const state = { pageNum: 1, numPages: 50, scale: 1, zoom: 1, view: 'original', src: 'en', tgt: 'ar', fileKey: 'book' };
const el = { stage, stageWrap: scroller, pageInput: {}, prevBtn: {}, nextBtn: {} };
const pdf = { numPages: 50, getPage: async number => ({
  pageNumber: number,
  getViewport: ({ scale }) => ({ width: 600 * scale, height: (number === 4 ? 1000 : 800) * scale }),
  render: ({ canvas }) => { rendered.push(number); return { promise: Promise.resolve(), cancel() { cancelled.push(number); } }; },
  streamTextContent() {},
}) };
state.pdf = pdf;
const context = vm.createContext({ state, el, store: { set: (key, value) => stored.set(key, value) },
  preferences: { get: () => true }, translationCache: new Map(), clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
  langName: code => code, applyChrome() {}, toast: message => messages.push(message),
  document: { createElement: tag => new Node(tag), addEventListener() {} },
  requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
  window: { devicePixelRatio: 2 }, pdfjsLib: { TextLayer: class { async render() {} cancel() {} } },
  showSheetError() {},
});
const start = source.indexOf('let renderToken =');
vm.runInContext(source.slice(start, source.indexOf('/* ====================================================================\n   Extract paragraphs', start)), context);
const run = text => vm.runInContext(text, context);
const settle = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  await context.renderPage(); await settle();
  assert.equal(stage.children.length, 50);
  assert.deepEqual([...new Set(rendered)], [1, 2]);
  assert.ok(run('pageRows.filter(row => row.loaded).length') <= 3);
  await context.goTo(20); await settle();
  assert.equal(state.pageNum, 20);
  assert.equal(stored.get('page:book'), 20);
  assert.ok(cancelled.includes(1));
  assert.equal(run('pageRows[0].canvas.width'), 0);
  assert.ok(run('pageRows[19].canvas.width') > 0);
  assert.ok(run('pageRows.filter(row => row.loaded).length') <= 3);
  // Wheel/trackpad scrolling changes the current page without rebuilding the document.
  const oldRow = stage.children[19];
  scroller.scrollTop += oldRow.offsetHeight + 28;
  context.updateVisiblePages(); await settle();
  assert.equal(state.pageNum, 21);
  assert.equal(stage.children[19], oldRow);
  // Zoom keeps the same page and supports mixed page sizes.
  state.zoom = 1.5;
  await context.renderPage(); await settle();
  assert.equal(state.pageNum, 21);
  assert.equal(run('pageRows[20].pageBox.style.width'), '900px');
  await context.goTo(4); await settle();
  assert.equal(run('pageRows[3].pageBox.style.height'), '1500px');
  // Side-by-side creates paired pages; only nearby translations start.
  const translated = [];
  context.renderTranslation = async (page, viewport, row, valid) => { if (valid()) translated.push(page.pageNumber); };
  state.view = 'split';
  await context.renderPage(); await settle();
  assert.equal(run('pageRows[3].root.children[0].hidden'), false);
  assert.equal(run('pageRows[3].root.children[1].hidden'), false);
  assert.ok(translated.length <= 3);
  state.view = 'translated';
  await context.renderPage(); await settle();
  assert.equal(run('pageRows[3].root.children[0].hidden'), true);
  assert.equal(run('pageRows[3].root.children[1].hidden'), false);
  assert.deepEqual(messages, []);
  console.log('Continuous reader checks passed: lazy rendering, scrolling, jumps, canvas cleanup, zoom, mixed sizes, all views');
})().catch(error => { console.error(error); process.exitCode = 1; });

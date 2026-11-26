const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('static/app.js', 'utf8');
let scrollTop = 0, enhancePdfText = false;
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
const bitmaps = [];
const messages = [], rendered = [], cancelled = [], stored = new Map(), frames = [];
const state = { pageNum: 1, numPages: 50, scale: 1, zoom: 1, view: 'original', src: 'en', tgt: 'ar', fileKey: 'book' };
const el = { stage, stageWrap: scroller, pageInput: {}, prevBtn: {}, nextBtn: {} };
const pdf = { numPages: 50, getPage: async number => ({
  pageNumber: number,
  getViewport: ({ scale }) => ({ width: 600 * scale, height: (number === 4 ? 1000 : 800) * scale }),
  render: ({ canvas, viewport, transform }) => { bitmaps.push({ width: canvas.width, height: canvas.height, viewport, transform }); rendered.push(number); return { promise: Promise.resolve(), cancel() { cancelled.push(number); } }; },
  streamTextContent() {},
}) };
state.pdf = pdf;
const context = vm.createContext({ state, el, library: { checkpointReadingSession() {} }, store: { set: (key, value) => stored.set(key, value) },
  preferences: { get: key => key === 'rememberPosition' || key === 'enhancePdfText' && enhancePdfText }, translationCache: new Map(), clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
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
  // Fractional fit/zoom sizes stay aligned with the selectable text layer.
  state.scale = 0.673;
  const fractional = context.makePageRow(1, { width: 595.28, height: 841.89 });
  assert.equal(parseFloat(fractional.pageBox.style.width), 595.28 * 0.673);
  // Preserve native density rather than thinning text with forced supersampling.
  const testPage = await pdf.getPage(1);
  for (const density of [0.8, 1, 1.25, 2, 3]) {
    context.window.devicePixelRatio = density;
    await context.renderOriginal(testPage, { width: 317.37, height: 448.71 }, fractional, () => true);
    const bitmap = bitmaps.at(-1), expected = density;
    assert.equal(bitmap.width, Math.floor(317.37 * expected));
    assert.equal(bitmap.height, Math.floor(448.71 * expected));
    assert.ok(Math.abs(bitmap.transform[0] * 317.37 - bitmap.width) < 1e-8);
    assert.ok(Math.abs(bitmap.transform[3] * 448.71 - bitmap.height) < 1e-8);
  }
  // Enhanced rendering remains available but is explicitly opt-in.
  enhancePdfText = true;
  for (const density of [1, 1.25, 2, 3]) {
    context.window.devicePixelRatio = density;
    await context.renderOriginal(testPage, { width: 317.37, height: 448.71 }, fractional, () => true);
    assert.equal(bitmaps.at(-1).width, Math.floor(317.37 * Math.max(2, density)));
  }
  enhancePdfText = false;
  // High zoom and unusual page shapes must respect memory and dimension limits.
  for (const viewport of [{ width: 15000, height: 20000 }, { width: 100000, height: 20 }]) {
    await context.renderOriginal(testPage, viewport, fractional, () => true);
    const bitmap = bitmaps.at(-1);
    assert.ok(bitmap.width * bitmap.height <= 16000000);
    assert.ok(bitmap.width <= 16384 && bitmap.height <= 16384);
  }
  // Density-only changes also rerender at the new monitor resolution.
  const queries = [];
  let densityChanged, densityRenders = 0;
  context.window.matchMedia = query => ({ addEventListener: (event, callback, options) => {
    queries.push(query); densityChanged = callback;
    assert.equal(event, 'change'); assert.equal(options.once, true);
  } });
  context.renderPage = () => { densityRenders++; };
  vm.runInContext(source.slice(source.indexOf('function watchDisplayDensity()'), source.indexOf('// drag & drop')), context);
  context.window.devicePixelRatio = 1.25;
  densityChanged();
  assert.equal(densityRenders, 1);
  assert.equal(queries.at(-1), '(resolution: 1.25dppx)');
  state.pdf = null; densityChanged(); assert.equal(densityRenders, 1);
  // Layout transitions must settle before a fitted PDF is rasterized again.
  let layoutRenders = 0, layoutUpdates = 0;
  const layout = vm.createContext({ state: { pdf: {}, zoom: 'fit' }, window: { ResizeObserver: function() {} },
    renderPage: () => layoutRenders++, scheduleVisiblePages: () => layoutUpdates++ });
  vm.runInContext(source.slice(source.indexOf('function refitReaderAfterLayout()'), source.indexOf('function setPanelSize(')), layout);
  layout.refitReaderAfterLayout(); assert.equal(layoutRenders, 0); assert.equal(layoutUpdates, 1);
  layout.window.ResizeObserver = undefined; layout.refitReaderAfterLayout(); assert.equal(layoutRenders, 1);
  layout.state.zoom = 1; layout.refitReaderAfterLayout(); assert.equal(layoutUpdates, 2);
  // Cursor anchors use the hovered column and restore both scroll axes.
  const anchorPdf = {}, anchorRoot = { dataset: { page: '1' } };
  const anchorBox = { getBoundingClientRect: () => ({ left: 50, top: 100, width: 400, height: 600 }) };
  const anchorSheet = { getBoundingClientRect: () => ({ left: 500, top: 100, width: 400, height: 600 }) };
  const anchorScroll = { scrollLeft: 100, scrollTop: 200 };
  const anchors = vm.createContext({ state: { pdf: anchorPdf }, pageRows: [{ root: anchorRoot, number: 1, pageBox: anchorBox, sheet: anchorSheet }],
    el: { stageWrap: anchorScroll }, clamp: (n, min, max) => Math.min(max, Math.max(min, n)) });
  vm.runInContext(source.slice(source.indexOf('function captureZoomAnchor('), source.indexOf('function setCurrentPage(')), anchors);
  const capturedAnchor = anchors.captureZoomAnchor({ clientX: 150, clientY: 400, target: { closest: selector => selector === '.pageRow' ? anchorRoot : anchorBox } });
  assert.equal(capturedAnchor.x, .25); assert.equal(capturedAnchor.y, .5); assert.equal(capturedAnchor.translated, false);
  anchorBox.getBoundingClientRect = () => ({ left: -100, top: -200, width: 800, height: 1200 });
  anchors.restoreZoomAnchor(capturedAnchor); assert.equal(anchorScroll.scrollLeft, 50); assert.equal(anchorScroll.scrollTop, 200);
  const translatedAnchor = anchors.captureZoomAnchor({ clientX: 700, clientY: 250, target: { closest: selector => selector === '.pageRow' ? anchorRoot : anchorSheet } });
  assert.equal(translatedAnchor.translated, true); assert.equal(translatedAnchor.x, .5); assert.equal(translatedAnchor.y, .25);
  anchors.state.pdf = {}; anchors.restoreZoomAnchor(capturedAnchor); assert.equal(anchorScroll.scrollLeft, 50);

  // Alt + wheel changes PDF zoom, batches rapid input and leaves ordinary scrolling alone.
  const wheelTimers = new Map(), wheelRenders = [], wheelBindings = new Map(); let wheelTimerId = 0, blockedByDialog = false;
  const wheelState = { pdf, zoom: 'fit', scale: 1 };
  const wheelEl = { stageWrap: { clientHeight: 500, addEventListener: (event, fn, options) => wheelBindings.set(event, { fn, options }) },
    zoomIn: {}, zoomOut: {}, zoomFit: {} };
  const wheel = vm.createContext({ state: wheelState, el: wheelEl, readerPdf: pdf, pageRows: [{}],
    store: { set() {} }, document: { querySelector: () => blockedByDialog },
    clamp: (n, min, max) => Math.min(max, Math.max(min, n)),
    captureZoomAnchor: () => ({ pdf: wheelState.pdf, page: 1, x: .4, y: .5, clientX: 300, clientY: 250 }),
    renderPage: anchor => { wheelState.scale = typeof wheelState.zoom === 'number' ? wheelState.zoom : 1; wheelRenders.push({ zoom: wheelState.zoom, anchor }); },
    setTimeout: (fn, delay) => { wheelTimers.set(++wheelTimerId, { fn, delay }); return wheelTimerId; }, clearTimeout: id => wheelTimers.delete(id),
  });
  vm.runInContext(source.slice(source.indexOf('let wheelZoomTimer ='), source.indexOf('el.viewSeg.onclick')), wheel);
  let prevented = 0;
  const wheelEvent = extra => ({ altKey: true, deltaY: -120, deltaMode: 0, preventDefault: () => prevented++, ...extra });
  wheel.zoomWithWheel(wheelEvent({ altKey: false })); wheel.zoomWithWheel(wheelEvent({ ctrlKey: true }));
  wheel.zoomWithWheel(wheelEvent({ metaKey: true })); wheel.zoomWithWheel(wheelEvent({ shiftKey: true }));
  assert.equal(wheelRenders.length, 0); assert.equal(prevented, 0);
  blockedByDialog = true; wheel.zoomWithWheel(wheelEvent()); assert.equal(prevented, 0); blockedByDialog = false;
  wheel.zoomWithWheel(wheelEvent()); assert.ok(wheelState.scale > 1); assert.equal(wheelRenders[0].anchor.x, .4);
  wheel.zoomWithWheel(wheelEvent()); wheel.zoomWithWheel(wheelEvent()); assert.equal(wheelRenders.length, 1);
  const [timerId, timer] = [...wheelTimers][0]; wheelTimers.delete(timerId); timer.fn();
  assert.equal(wheelRenders.length, 2); assert.ok(wheelState.scale > 1.4);
  wheelEl.zoomFit.onclick(); assert.equal(wheelState.zoom, 'fit'); assert.equal(wheelTimers.size, 0, 'Fit cancels queued wheel zoom');
  wheel.zoomWithWheel(wheelEvent({ deltaMode: 1, deltaY: -3 })); assert.ok(wheelState.scale > 1);
  wheel.cancelWheelZoom(); wheel.setZoom(6); wheel.zoomWithWheel(wheelEvent()); assert.equal(wheelState.zoom, 6);
  wheel.cancelWheelZoom(); wheel.setZoom(.2); wheel.zoomWithWheel(wheelEvent({ deltaY: 120 })); assert.equal(wheelState.zoom, .2);
  wheel.cancelWheelZoom(); wheel.setZoom(1); wheel.zoomWithWheel(wheelEvent()); wheel.zoomWithWheel(wheelEvent());
  const oldCount = wheelRenders.length; wheelState.pdf = {};
  const [staleId, staleTimer] = [...wheelTimers][0]; wheelTimers.delete(staleId); staleTimer.fn();
  assert.equal(wheelRenders.length, oldCount, 'Queued zoom cannot affect a newly opened PDF');
  assert.equal(wheelBindings.get('wheel').options.passive, false);
  assert.deepEqual(messages, []);
  console.log('Continuous reader checks passed: lazy rendering, scrolling, jumps, canvas cleanup, zoom, mixed sizes, all views, fractional alignment, display density, and bitmap limits');
})().catch(error => { console.error(error); process.exitCode = 1; });

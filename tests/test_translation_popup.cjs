const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
let now = 0, timerId = 0, duration = 5, modalOpen = false;
const timers = new Map(), nodes = new Map(), events = new Map(), copied = [], retries = [];
let opens = 0;
class Node {
  constructor(id) { this.id = id; this.hidden = true; this.textContent = ''; this.listeners = new Map(); this.attributes = {}; this.classes = new Set(); this.classList = { toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) }; }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  fire(name, event = {}) { this.listeners.get(name)?.(event); }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  contains(other) { return !!other && (other === this || other.id.startsWith('popup')); }
  focus() { document.activeElement = this; this.focused = true; }
}
const node = id => { if (!nodes.has(id)) nodes.set(id, new Node(id)); return nodes.get(id); };
const document = { getElementById: node, activeElement: null,
  querySelector: () => modalOpen, addEventListener: (name, fn) => events.set(name, fn) };
const platform = { setTimeout: (fn, delay) => { timers.set(++timerId, { fn, at: now + delay }); return timerId; }, clearTimeout: id => timers.delete(id) };
function tick(ms) {
  now += ms;
  for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
}
const context = vm.createContext({ document, window: platform, Date: { now: () => now } });
vm.runInContext(fs.readFileSync('static/translation-popup.js', 'utf8').replace(/^export /gm, ''), context);
const popup = context.createTranslationPopup({ getDuration: () => duration, languageName: code => code,
  onCopy: item => copied.push(item), onOpen: () => opens++, onRetry: item => retries.push(item) });
const root = node('translationPopup');
const selection = text => ({ text, source: 'en', target: 'ar', status: 'loading' });
const finish = item => { Object.assign(item, { status: 'ok', translation: 'مرحبا' }); popup.update(item, true); };
const first = selection('hello');
popup.update(first, false); assert.equal(root.hidden, true);
const next = selection('hello again'); popup.update(next, true);
assert.equal(root.hidden, false); assert.equal(root.attributes['aria-busy'], 'true');
tick(10000); assert.equal(root.hidden, false, 'Pending translations must not time out');
finish(next); assert.equal(node('popupTranslation').lang, 'ar'); assert.equal(node('popupTranslation').dir, 'auto');
tick(2000); root.fire('pointerenter', { pointerType: 'mouse' }); tick(10000);
assert.equal(root.hidden, false, 'Hover pauses the timer');
root.fire('pointerleave'); tick(2999); assert.equal(root.hidden, false); tick(1); assert.equal(root.hidden, true);
popup.update(next, true); assert.equal(root.hidden, true, 'A render must not revive a dismissed result');
const pending = selection('close before arrival'); popup.update(pending, true); node('popupClose').onclick(); finish(pending);
assert.equal(root.hidden, true, 'Late responses must not reopen a manually dismissed popup');
const focused = selection('keyboard'); popup.update(focused, true); finish(focused);
root.fire('focusin'); tick(6000); assert.equal(root.hidden, false);
root.fire('focusout', { relatedTarget: node('popupCopy') }); tick(6000); assert.equal(root.hidden, false);
root.fire('focusout', { relatedTarget: null }); tick(5000); assert.equal(root.hidden, true);
const touch = selection('touch'); popup.update(touch, true); finish(touch);
root.fire('pointerdown'); tick(6000); assert.equal(root.hidden, false);
events.get('pointerup')(); tick(5000); assert.equal(root.hidden, true);
duration = 0;
const persistent = selection('keep'); popup.update(persistent, true); finish(persistent);
tick(100000); assert.equal(root.hidden, false);
node('popupCopy').onclick(); assert.equal(copied.at(-1), persistent);
node('popupOpenPanel').onclick(); assert.equal(opens, 1); assert.equal(root.hidden, true);
duration = 15;
const custom = selection('custom duration'); popup.update(custom, true); finish(custom);
tick(14999); assert.equal(root.hidden, false); tick(1); assert.equal(root.hidden, true);
const error = { ...selection('retry'), status: 'error', error: 'Provider unavailable' };
popup.update(error, true); assert.equal(node('popupRetry').hidden, false); assert.equal(node('popupCopy').hidden, true);
node('popupRetry').onclick(); assert.equal(retries.at(-1), error);
modalOpen = true; events.get('keydown')({ key: 'Escape' }); assert.equal(root.hidden, false);
modalOpen = false; document.activeElement = node('popupCopy');
events.get('keydown')({ key: 'Escape', preventDefault() {} }); assert.equal(root.hidden, true); assert.equal(node('stageWrap').focused, true);
const disabled = selection('disable while waiting'); popup.update(disabled, true); popup.dismiss(); finish(disabled);
assert.equal(root.hidden, true);
const switched = selection('new book'); popup.update(switched, true); popup.update(null, false); finish(switched);
// The app suppresses obsolete request results before reaching this controller.
popup.update(switched, false); assert.equal(root.hidden, true);

// User-sized popups stay available until restored; fresh selections start normally.
duration = 5;
const sized = selection('window controls'); popup.update(sized, true); finish(sized);
node('popupMinimize').onclick();
assert.equal(root.classes.has('isMinimized'), true);
assert.equal(node('popupMinimize').attributes['aria-expanded'], 'false');
tick(6000); assert.equal(root.hidden, false);
node('popupMaximize').onclick();
assert.equal(root.classes.has('isMaximized'), true); assert.equal(root.classes.has('isMinimized'), false);
assert.equal(node('popupTiming').textContent, 'Auto-close paused while expanded');
tick(6000); assert.equal(root.hidden, false);
node('popupMaximize').onclick(); assert.equal(root.classes.has('isMaximized'), false);
tick(5000); assert.equal(root.hidden, true);
const fresh = selection('fresh selection'); popup.update(fresh, true); finish(fresh);
node('popupMinimize').onclick(); popup.update(selection('another selection'), true);
assert.equal(root.classes.has('isMinimized'), false);
popup.dismiss();

// Exercise the app's routing and request-token guard with controllable responses.
const appSource = fs.readFileSync('static/app.js', 'utf8');
let panel = false, enabled = true, auto = true, topBar = true, showIcon = true, selected = 'selection';
const requests = [], updates = [];
const app = vm.createContext({ state: { panel, src: 'en', tgt: 'ar', pageNum: 1, bookKey: 'book' },
  document: { querySelector: () => modalOpen }, preferences: {
    get: key => ({ translationPopup: enabled, autoTranslateSelection: auto, showTopBar: topBar, showTranslateIcon: showIcon, autoSpeech: 'off', historyLimit: 30, saveContext: false })[key],
    stop() {}, autoSpeak() {},
  }, readSelection: () => selected, lastSelKey: '', selectedPage: 1,
  selectionKey: (text, page) => JSON.stringify([text, page]), toast() {},
  translateSelection: text => requests.push(text), updateSelectionControls() {},
});
vm.runInContext(appSource.slice(appSource.indexOf('function maybeTranslateSelection('), appSource.indexOf('const onSelectionEvent')), app);
app.maybeTranslateSelection(); assert.equal(requests.length, 1, 'Enabled popup translates with panel closed');
enabled = false; app.maybeTranslateSelection(); assert.equal(requests.length, 1);
app.state.panel = true; auto = false; app.maybeTranslateSelection(); assert.equal(requests.length, 1);
app.maybeTranslateSelection(true); assert.equal(requests.length, 2);
modalOpen = true; app.maybeTranslateSelection(true); assert.equal(requests.length, 2); modalOpen = false;
// Manual requests work through the closed-panel popup route as well.
app.state.panel = false; enabled = true;
app.maybeTranslateSelection(); assert.equal(requests.length, 2);
app.maybeTranslateSelection(true); assert.equal(requests.length, 3);
enabled = false; app.maybeTranslateSelection(true); assert.equal(requests.length, 3);
enabled = true;
// The floating control replaces the toolbar action and follows the PDF selection.
app.el = { translatePopupSelected: {}, floatingTranslate: {}, translateSelected: {}, selectionHintText: {} };
app.positionFloatingTranslate = () => {};
vm.runInContext(appSource.slice(appSource.indexOf('function updateSelectionControls()'), appSource.indexOf('function applyChrome()')), app);
app.state.pdf = null; app.updateSelectionControls(); assert.equal(app.el.floatingTranslate.hidden, true);
app.state.pdf = {}; app.updateSelectionControls();
assert.equal(app.el.translatePopupSelected.hidden, true); assert.equal(app.el.floatingTranslate.hidden, false);
assert.match(app.el.selectionHintText.textContent, /click Translate selection/);
app.state.panel = true; app.updateSelectionControls(); assert.equal(app.el.floatingTranslate.hidden, false);
selected = ''; app.updateSelectionControls(); assert.equal(app.el.floatingTranslate.hidden, true);
selected = 'selection'; auto = true; topBar = true; app.updateSelectionControls(); assert.equal(app.el.floatingTranslate.hidden, false);
auto = false; app.state.panel = false; showIcon = false; enabled = true;
app.updateSelectionControls(); assert.equal(app.el.floatingTranslate.hidden, true); assert.equal(app.el.translatePopupSelected.hidden, false);
enabled = false; app.updateSelectionControls(); assert.equal(app.el.translatePopupSelected.hidden, true);
showIcon = true; enabled = true; app.state.panel = true; app.state.panelSize = 'minimized';
app.updateSelectionControls(); assert.equal(app.el.floatingTranslate.hidden, false);
app.state.panelSize = 'normal'; app.state.panel = false;
app.state.pdf = null; app.current = { text: 'current', page: 1 }; app.selToken = 0;
app.store = { set() {} }; app.translationPopup = { dismiss() {} };
vm.runInContext(appSource.slice(appSource.indexOf('function languagesChanged()'), appSource.indexOf('el.srcLang.onchange')), app);
app.languagesChanged(); assert.equal(requests.length, 3, 'Changing languages must respect manual mode');
auto = true; app.languagesChanged(); assert.equal(requests.length, 4);
auto = false;

// Floating translation: a drag moves the control, a click translates, arrows move it.
const dragEvents = new Map(), resizeEvents = new Map(), dragSaved = new Map();
let translatedByButton = 0, captured = false, controlTimerId = 0;
const controlTimers = new Map();
const floating = { style: {}, classList: { add() {}, remove() {} },
  addEventListener: (event, fn) => dragEvents.set(event, fn),
  getBoundingClientRect: () => ({ left: parseFloat(floating.style.left) || 736, top: parseFloat(floating.style.top) || 536 }),
  setPointerCapture() { captured = true; }, hasPointerCapture: () => captured,
  releasePointerCapture() { captured = false; },
};
const drag = vm.createContext({ el: { floatingTranslate: floating }, state: { panel: false },
  window: { innerWidth: 800, innerHeight: 600, addEventListener: (event, fn) => resizeEvents.set(event, fn) },
  store: { get: () => null, set: (key, value) => dragSaved.set(key, value) },
  clamp: (n, min, max) => Math.min(max, Math.max(min, n)), maybeTranslateSelection: () => translatedByButton++, translateWithShortcut: () => translatedByButton++,
  clearTimeout: id => controlTimers.delete(id), setTimeout: (fn, delay) => { controlTimers.set(++controlTimerId, { fn, delay }); return controlTimerId; },
});
vm.runInContext(appSource.slice(appSource.indexOf('const savedFloatingPosition ='), appSource.indexOf('for (const button of [el.translateSelected')), drag);
drag.positionFloatingTranslate(); assert.equal(floating.style.left, '736px'); assert.equal(floating.style.top, '536px');
const pointer = (x, y, type = 'pointerup') => ({ button: 0, pointerId: 1, clientX: x, clientY: y, type, preventDefault() {} });
dragEvents.get('pointerdown')(pointer(760, 560)); dragEvents.get('pointerup')(pointer(760, 560));
floating.onclick({ detail: 1 }); assert.equal(translatedByButton, 1);
dragEvents.get('pointerdown')(pointer(760, 560)); dragEvents.get('pointermove')(pointer(560, 460)); dragEvents.get('pointerup')(pointer(560, 460));
assert.equal(floating.style.left, '536px'); assert.equal(floating.style.top, '436px');
floating.onclick({ detail: 1, preventDefault() {} }); assert.equal(translatedByButton, 1, 'Dragging must not translate');
dragEvents.get('pointerdown')(pointer(560, 460)); dragEvents.get('pointermove')(pointer(-1000, -1000)); dragEvents.get('pointercancel')(pointer(-1000, -1000, 'pointercancel'));
assert.equal(floating.style.left, '16px'); assert.equal(floating.style.top, '16px');
floating.onclick({ detail: 0 }); assert.equal(translatedByButton, 2, 'Keyboard clicks still work after a cancelled drag');
dragEvents.get('keydown')({ key: 'ArrowRight', preventDefault() {}, stopPropagation() {} }); assert.equal(floating.style.left, '28px');
assert.ok(dragSaved.get('floatingTranslatePosition').x >= 0 && dragSaved.get('floatingTranslatePosition').x <= 1);
drag.window.innerWidth = 390; drag.window.innerHeight = 844; drag.state.panel = true; drag.state.panelSize = 'minimized'; resizeEvents.get('resize')();
assert.ok(parseFloat(floating.style.left) <= 326 && parseFloat(floating.style.top) <= 734);
// A saved position must not obscure the result when the popup opens.
drag.moveFloatingTranslate(210, 580);
drag.el.translationPopupRoot = { hidden: false, getBoundingClientRect: () => ({ left: 12, right: 378, top: 454, bottom: 716 }) };
drag.positionFloatingTranslate();
const avoidY = parseFloat(floating.style.top);
assert.ok(avoidY + 48 <= 446 || avoidY >= 724);


// The same movable controller supports a long-press label without activating it.
const menuEvents = new Map(), menuClasses = new Set(); let menuClicks = 0;
const menu = { ...floating, classList: { add: value => menuClasses.add(value), remove: value => menuClasses.delete(value) },
  addEventListener: (event, fn) => menuEvents.set(event, fn) };
drag.bindMovableControl(menu, { move() {}, save() {}, position() {}, click: () => menuClicks++, longPress: true });
menuEvents.get('pointerdown')(pointer(30, 30));
for (const timer of [...controlTimers.values()]) if (timer.delay === 550) timer.fn();
assert.equal(menuClasses.has('showHint'), true);
menuEvents.get('pointerup')(pointer(30, 30)); menu.onclick({ detail: 1, preventDefault() {} });
assert.equal(menuClicks, 0, 'Long press reveals the label without opening the toolbar');
menuEvents.get('pointerdown')(pointer(30, 30)); menuEvents.get('pointerup')(pointer(30, 30));
menu.onclick({ detail: 1 }); assert.equal(menuClicks, 1);

Object.assign(app, { current: null, history: [], selToken: 0, selectionResults: new Map(), el: { selPanel: { querySelector: () => ({ scrollTop: 0 }) } },
  renderPanel: () => updates.push(app.current?.translation || app.current?.status),
  callTranslate: () => new Promise(resolve => requests.push(resolve)),
});
vm.runInContext(appSource.slice(appSource.indexOf('async function translateSelection('), appSource.indexOf('el.dictionarySearch.oninput')), app);
(async () => {
  requests.length = 0;
  const older = app.translateSelection('older', true), newer = app.translateSelection('newer', true);
  requests[1]({ translations: ['latest'] }); await newer;
  requests[0]({ translations: ['obsolete'] }); await older;
  assert.equal(app.current.translation, 'latest'); assert.equal(updates.includes('obsolete'), false);
  const completedCount = requests.length;
  app.lastSelKey = ''; // A panel click may clear the current DOM selection.
  await app.translateSelection('newer', true);
  assert.equal(requests.length, completedCount, 'Completed text must not be requested again');
  assert.equal(app.current.translation, 'latest');
  const pendingSame = app.translateSelection('pending duplicate', true);
  const pendingCount = requests.length;
  await app.translateSelection('pending duplicate', true);
  assert.equal(requests.length, pendingCount, 'Pending selections must not be requested twice');
  requests.at(-1)({ translations: ['finished'] }); await pendingSame;
  app.state.tgt = 'fr';
  const changedLanguage = app.translateSelection('newer', true);
  assert.equal(requests.length, pendingCount + 1); requests.at(-1)({ translations: ['nouveau'] }); await changedLanguage;
  app.state.tgt = 'ar'; await app.translateSelection('newer', true);
  assert.equal(requests.length, pendingCount + 1, 'Returning to a translated language must use its cache');
  assert.equal(app.current.translation, 'latest');
  app.state.bookKey = 'different-book';
  const changedBook = app.translateSelection('newer', true);
  assert.equal(requests.length, pendingCount + 2); requests.at(-1)({ translations: ['other book'] }); await changedBook;
  console.log('Translation popup checks passed: routing, pending work, dismissal, timer, hover, focus, touch, manual mode, duration, copy, panel, retry, Escape, and stale responses');
})().catch(error => { console.error(error); process.exitCode = 1; });

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

// Exercise the app's routing and request-token guard with controllable responses.
const appSource = fs.readFileSync('static/app.js', 'utf8');
let panel = false, enabled = true, auto = true, selected = 'selection';
const requests = [], updates = [];
const app = vm.createContext({ state: { panel, src: 'en', tgt: 'ar', pageNum: 1, bookKey: 'book' },
  document: { querySelector: () => modalOpen }, preferences: {
    get: key => ({ translationPopup: enabled, autoTranslateSelection: auto, autoSpeech: 'off', historyLimit: 30, saveContext: false })[key],
    stop() {}, autoSpeak() {},
  }, readSelection: () => selected, lastSelKey: '', selectedPage: 1,
  selectionKey: (text, page) => JSON.stringify([text, page]), toast() {},
  translateSelection: text => requests.push(text),
});
vm.runInContext(appSource.slice(appSource.indexOf('function maybeTranslateSelection('), appSource.indexOf('const onSelectionEvent')), app);
app.maybeTranslateSelection(); assert.equal(requests.length, 1, 'Enabled popup translates with panel closed');
enabled = false; app.maybeTranslateSelection(); assert.equal(requests.length, 1);
app.state.panel = true; auto = false; app.maybeTranslateSelection(); assert.equal(requests.length, 1);
app.maybeTranslateSelection(true); assert.equal(requests.length, 2);
modalOpen = true; app.maybeTranslateSelection(true); assert.equal(requests.length, 2); modalOpen = false;
Object.assign(app, { current: null, history: [], selToken: 0, el: { selPanel: { querySelector: () => ({ scrollTop: 0 }) } },
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
  console.log('Translation popup checks passed: routing, pending work, dismissal, timer, hover, focus, touch, manual mode, duration, copy, panel, retry, Escape, and stale responses');
})().catch(error => { console.error(error); process.exitCode = 1; });

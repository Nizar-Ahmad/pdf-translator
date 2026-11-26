const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs');
const source = fs.readFileSync('static/preferences.js', 'utf8').replace(/^export /gm, '');
class Node {
  constructor() { this.children = []; this.style = {}; this.value = ''; this.listeners = new Map(); }
  addEventListener(event, fn) { this.listeners.set(event, fn); }
  fire(event, data) { this.listeners.get(event)?.(data); }
  getBoundingClientRect() { return { left: 100, right: 500, top: 100, bottom: 600 }; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  showModal() { this.open = true; } close() { this.open = false; }
  setAttribute(key, value) { (this.attributes ||= {})[key] = value; }
  select() {} remove() {} focus() {}
}
function boot(storage = new Map()) {
  const nodes = new Map(), messages = [], spoken = [], copied = [], listeners = new Set(), timers = new Map();
  let installedVoices = [], timerId = 0, rejectWrites = false;
  const node = id => { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); };
  const platform = { navigator: { clipboard: { writeText: async text => copied.push(text) } },
    SpeechSynthesisUtterance: function(text) { this.text = text; },
    speechSynthesis: { getVoices: () => installedVoices, cancel() {}, resume() {},
      speak(speech) { spoken.push(speech); speech.onstart(); },
      addEventListener: (event, fn) => listeners.add(fn), removeEventListener: (event, fn) => listeners.delete(fn),
    } };
  const document = { documentElement: new Node(), getElementById: node, createElement: () => new Node(), body: new Node(),
    execCommand: () => true, activeElement: new Node() };
  const context = vm.createContext({ document, Option: function(text, value) { this.text = text; this.value = value; },
    window: platform, setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; }, clearTimeout: id => timers.delete(id) });
  vm.runInContext(source, context);
  const prefs = context.createPreferences({ store: { get: key => storage.get(key), set: (key, value) => { if (rejectWrites) return false; storage.set(key, value); return true; } },
    toast: message => messages.push(message), languages: [['en', 'English'], ['ar', 'Arabic']], languageName: code => ({ en: 'English', ar: 'Arabic' })[code] || code,
  });
  return { context, prefs, platform, node, spoken, copied, messages, storage,
    voices: list => { installedVoices = list; for (const fn of [...listeners]) fn(); },
    tick: delay => { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.fn(); } },
    rejectWrites: () => { rejectWrites = true; } };
}
(async () => {
  const app = boot(), en = { voiceURI: 'en-1', name: 'English voice', lang: 'en-US', default: true },
    ar = { voiceURI: 'ar-1', name: 'Arabic voice', lang: 'ar-SA' }, ar2 = { voiceURI: 'ar-2', name: 'Other Arabic voice', lang: 'ar-EG' };
  app.voices([en, ar, ar2]);
  app.node('settingsBtn').onclick(); assert.equal(app.node('settingsDialog').open, true);
  const dialog = app.node('settingsDialog');
  const outside = { target: dialog, button: 0, detail: 1, clientX: 30, clientY: 30 };
  dialog.fire('pointerdown', outside); dialog.fire('click', outside); assert.equal(dialog.open, false);
  dialog.showModal();
  const padding = { ...outside, clientX: 120, clientY: 120 };
  dialog.fire('pointerdown', padding); dialog.fire('click', padding); assert.equal(dialog.open, true, 'Dialog padding is inside');
  dialog.fire('pointerdown', padding); dialog.fire('click', outside); assert.equal(dialog.open, true, 'Dragging out must not close');
  dialog.fire('pointerdown', outside); dialog.fire('click', { ...outside, clientX: 80 }); assert.equal(dialog.open, true);
  dialog.fire('pointerdown', outside); dialog.fire('pointercancel', outside); dialog.fire('click', outside); assert.equal(dialog.open, true);
  app.node('settingVoiceLanguage').value = 'ar'; app.node('settingVoiceLanguage').onchange();
  assert.equal(app.node('settingVoice').children.length, 3);
  app.node('settingVoice').value = 'ar-2'; app.node('settingVoice').onchange();
  app.prefs.set('rate', 1.3); app.prefs.set('volume', 0.7);
  await app.prefs.speak('مرحبا', 'ar'); app.tick(50);
  assert.equal(app.spoken[0].voice.voiceURI, 'ar-2');
  assert.equal(app.spoken[0].rate, 1.3); assert.equal(app.spoken[0].volume, 0.7);
  // A preferred Arabic voice must never override the language of original English text.
  await app.prefs.speak('hello', 'en'); app.tick(50);
  assert.equal(app.spoken.at(-1).voice, en);
  const stale = app.spoken.at(-1); app.prefs.stop(); stale.onend();
  assert.equal(app.spoken.length, 2);
  // Voices may arrive asynchronously after the Hear button is clicked.
  const delayed = boot(); const pending = delayed.prefs.speak('hello', 'en');
  delayed.voices([en]); await pending; delayed.tick(50);
  assert.equal(delayed.spoken.length, 1);
  // Missing voices, language mismatch, blocked playback, muted output are actionable.
  const empty = boot(); const waiting = empty.prefs.speak('hello', 'en'); empty.tick(1800); await waiting;
  assert.match(empty.messages.at(-1), /No speech voices/);
  await app.prefs.speak('bonjour', 'fr'); assert.match(app.messages.at(-1), /No voice/);
  app.prefs.set('volume', 0); await app.prefs.speak('hello', 'en'); assert.match(app.messages.at(-1), /volume is zero/);
  app.prefs.set('volume', 1); await app.prefs.speak('hello', 'en'); app.tick(50);
  app.spoken.at(-1).onerror({ error: 'not-allowed' }); assert.match(app.messages.at(-1), /browser blocked/);
  app.prefs.set('speechEnabled', false); await app.prefs.speak('hello', 'en'); assert.match(app.messages.at(-1), /turned off/);
  app.prefs.set('speechEnabled', true);
  // Automatic reading can speak the original and then translation with matching voices.
  const entry = { text: 'hello', translation: 'مرحبا', source: 'auto', detected: 'en', target: 'ar' };
  app.prefs.set('autoSpeech', 'both'); const count = app.spoken.length;
  await app.prefs.autoSpeak(entry); app.tick(50); assert.equal(app.spoken.at(-1).voice, en);
  app.spoken.at(-1).onend(); assert.equal(app.spoken.at(-1).voice, ar2);
  assert.equal(app.spoken.length, count + 2);
  for (const [mode, expected] of [['translation', 'مرحبا'], ['original', 'hello'], ['both', 'hello\nمرحبا']]) {
    app.prefs.set('copyMode', mode); await app.prefs.copy(entry); assert.equal(app.copied.at(-1), expected);
  }
  app.prefs.set('copyLabels', true); await app.prefs.copy(entry);
  assert.equal(app.copied.at(-1), 'English: hello\nArabic: مرحبا');
  app.platform.navigator.clipboard.writeText = async () => { throw new Error('denied'); };
  await app.prefs.copy(entry);
  assert.equal(app.context.document.body.children.at(-1).value, 'English: hello\nArabic: مرحبا');
  const stalled = boot(); stalled.voices([en]);
  stalled.platform.speechSynthesis.speak = speech => stalled.spoken.push(speech);
  await stalled.prefs.speak('hello', 'en'); stalled.tick(50); stalled.tick(5000);
  assert.match(stalled.messages.at(-1), /did not start/);
  const reset = boot(new Map([['dictionary:book', [{ text: 'keep me' }]]]));
  reset.prefs.set('copyMode', 'both'); reset.prefs.set('enhancePdfText', true); reset.node('resetPreferences').onclick();
  assert.equal(reset.prefs.get('copyMode'), 'translation');
  assert.equal(reset.prefs.get('enhancePdfText'), false);
  assert.equal(reset.prefs.get('showTopBar'), true);
  assert.equal(reset.prefs.get('restoreOnReload'), true);
  assert.equal(reset.prefs.get('themeMode'), 'system'); assert.equal(reset.prefs.get('themeColor'), 'teal');
  assert.equal(reset.prefs.get('translationShortcut').code, 'KeyT');
  assert.equal(reset.storage.get('dictionary:book')[0].text, 'keep me');
  const html = fs.readFileSync('static/index.html', 'utf8');
  for (const match of source.matchAll(/node\('([^']+)'\)/g)) assert.ok(html.includes('id="' + match[1] + '"'), 'Missing settings control ' + match[1]);
  assert.equal(app.prefs.get('themeMode'), 'system'); assert.equal(app.prefs.get('themeColor'), 'teal');
  app.node('settingThemeMode').value = 'dark'; app.node('settingThemeMode').onchange();
  app.node('themeColorviolet').onclick();
  assert.equal(app.context.document.documentElement.attributes['data-theme'], 'dark');
  assert.equal(app.context.document.documentElement.attributes['data-accent'], 'violet');
  assert.equal(app.node('themeColorviolet').attributes['aria-pressed'], 'true');
  assert.equal(app.node('themeColorteal').attributes['aria-pressed'], 'false');
  const invalidTheme = app.context.cleanPreferences({ themeMode: 'invalid', themeColor: 'invalid' });
  assert.equal(invalidTheme.themeMode, 'system'); assert.equal(invalidTheme.themeColor, 'teal');
  assert.equal(app.prefs.get('showTranslateIcon'), true);
  app.node('settingShowTranslateIcon').checked = false; app.node('settingShowTranslateIcon').onchange();
  assert.equal(app.prefs.get('restoreOnReload'), true);
  app.node('settingRestoreOnReload').checked = false; app.node('settingRestoreOnReload').onchange();
  assert.equal(app.prefs.get('restoreOnReload'), false);
  assert.equal(app.context.formatTranslationShortcut(app.prefs.get('translationShortcut')), 'Alt + T');
  const key = { key: 'Y', code: 'KeyY', ctrlKey: true, shiftKey: true, preventDefault() {}, stopPropagation() {} };
  app.node('settingTranslationShortcut').onkeydown(key);
  assert.equal(app.context.formatTranslationShortcut(app.prefs.get('translationShortcut')), 'Ctrl + Shift + Y');
  assert.equal(app.context.matchesTranslationShortcut(key, app.prefs.get('translationShortcut')), true);
  assert.equal(app.context.matchesTranslationShortcut({ ...key, repeat: true }, app.prefs.get('translationShortcut')), false);
  assert.equal(app.context.translationShortcutFromEvent({ code: 'KeyO', ctrlKey: true }), null);
  assert.equal(app.context.translationShortcutFromEvent({ code: 'KeyT' }), null);
  assert.equal(app.context.cleanPreferences({ translationShortcut: { code: {} } }).translationShortcut.code, 'KeyT');
  app.node('disableTranslationShortcut').onclick(); assert.equal(app.prefs.get('translationShortcut'), null);
  app.node('resetTranslationShortcut').onclick(); assert.equal(app.prefs.get('translationShortcut').code, 'KeyT');
  app.node('settingTranslationShortcut').onkeydown(key);
  assert.equal(app.prefs.get('showTopBar'), true);
  app.node('settingShowTopBar').checked = false; app.node('settingShowTopBar').onchange();
  assert.equal(app.prefs.get('showTopBar'), false);
  assert.equal(app.context.cleanPreferences({ showTopBar: 'false' }).showTopBar, true);
  assert.equal(app.prefs.get('enhancePdfText'), false);
  app.node('settingEnhancePdfText').checked = true; app.node('settingEnhancePdfText').onchange();
  assert.equal(app.prefs.get('enhancePdfText'), true);
  assert.equal(app.context.cleanPreferences({ enhancePdfText: 'true' }).enhancePdfText, false);
  assert.equal(app.prefs.get('autoTranslateSelection'), true);
  app.node('settingAutoTranslate').checked = false; app.node('settingAutoTranslate').onchange();
  assert.equal(app.prefs.get('autoTranslateSelection'), false);
  assert.equal(app.prefs.get('translationPopup'), false);
  assert.equal(app.prefs.get('popupDuration'), 5);
  app.node('settingTranslationPopup').checked = true; app.node('settingTranslationPopup').onchange();
  assert.equal(app.node('settingPopupDuration').disabled, false);
  app.node('settingPopupDuration').value = '7'; app.node('settingPopupDuration').onchange();
  assert.equal(app.prefs.get('popupDuration'), 7);
  for (const value of ['', '-1', '1.5', '3601', 'invalid']) {
    app.node('settingPopupDuration').value = value; app.node('settingPopupDuration').onchange();
    assert.equal(app.prefs.get('popupDuration'), 7);
  }
  const invalidPopup = app.context.cleanPreferences({ translationPopup: 'true', popupDuration: -1 });
  assert.equal(invalidPopup.translationPopup, false); assert.equal(invalidPopup.popupDuration, 5);
  assert.equal(app.context.cleanPreferences({ popupDuration: 0 }).popupDuration, 0);
  assert.equal(app.context.cleanPreferences({ popupDuration: 3600 }).popupDuration, 3600);
  for (const value of [Infinity, NaN, 3601, 1.5, '7']) assert.equal(app.context.cleanPreferences({ popupDuration: value }).popupDuration, 5);
  const reload = boot(app.storage);
  assert.equal(reload.prefs.get('themeMode'), 'dark'); assert.equal(reload.prefs.get('themeColor'), 'violet');
  assert.equal(reload.prefs.get('showTranslateIcon'), false);
  assert.equal(reload.prefs.get('restoreOnReload'), false);
  assert.equal(reload.prefs.get('translationShortcut').code, 'KeyY');
  assert.equal(reload.prefs.get('showTopBar'), false);
  assert.equal(reload.prefs.get('enhancePdfText'), true);
  assert.equal(reload.prefs.get('autoTranslateSelection'), false);
  assert.equal(reload.prefs.get('translationPopup'), true);
  assert.equal(reload.prefs.get('popupDuration'), 7); assert.equal(reload.prefs.get('copyMode'), 'both');
  assert.equal(reload.prefs.get('voices').ar, 'ar-2');
  app.rejectWrites(); assert.equal(app.prefs.set('copyMode', 'original'), false); assert.equal(app.prefs.get('copyMode'), 'both');
  const chunks = app.context.speechChunks('word '.repeat(200)); assert.ok(chunks.length > 1); assert.ok(chunks.every(text => text.length <= 220));
  // Online voices cover missing languages, cache audio, and stop safely.
  const online = boot(), clips = [], requests = [], urls = [], revoked = [];
  online.voices([en]);
  online.platform.AbortController = AbortController;
  online.platform.URL = { createObjectURL: blob => { urls.push(blob); return 'blob:' + urls.length; }, revokeObjectURL: url => revoked.push(url) };
  online.platform.Audio = class {
    constructor(src) { this.src = src; clips.push(this); }
    async play() { this.played = true; }
    pause() { this.paused = true; }
    removeAttribute() {}
  };
  online.platform.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, blob: async () => ({ size: 100, type: 'audio/mpeg' }) };
  };
  const settleAudio = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
  assert.equal(online.prefs.get('onlineSpeech'), true);
  online.prefs.set('rate', 1.3); online.prefs.set('volume', 0.6);
  await online.prefs.speak('مرحبا', 'ar'); online.tick(50); await settleAudio();
  assert.equal(clips.length, 1); assert.equal(clips[0].played, true);
  assert.equal(clips[0].playbackRate, 1.3); assert.equal(clips[0].volume, 0.6);
  assert.equal(requests[0].url, '/api/translate');
  assert.equal(JSON.parse(requests[0].options.body).operation, 'speech');
  assert.equal(JSON.parse(requests[0].options.body).language, 'ar');
  clips[0].onended(); assert.equal(revoked.length, 1);
  await online.prefs.speak('مرحبا', 'ar'); online.tick(50); await settleAudio();
  assert.equal(requests.length, 1, 'Replaying speech uses the audio cache');
  const replay = clips.at(-1); online.prefs.stop(); assert.equal(replay.paused, true);
  // A failed installed voice falls back online for the original language.
  await online.prefs.speak('original', 'en'); online.tick(50);
  online.spoken.at(-1).onerror({ error: 'synthesis-failed' }); await settleAudio();
  assert.equal(JSON.parse(requests.at(-1).options.body).language, 'en');
  online.prefs.stop();
  // Mixed original and translated speech keeps each language and voice.
  online.prefs.set('autoSpeech', 'both'); await online.prefs.autoSpeak(entry); online.tick(50);
  assert.equal(online.spoken.at(-1).voice, en); online.spoken.at(-1).onend(); await settleAudio();
  assert.ok(clips.at(-1).played); clips.at(-1).onended();
  // Cancellation while downloading must not start obsolete audio.
  let resolveDownload;
  online.platform.fetch = (url, options) => { requests.push({ url, options }); return new Promise(resolve => { resolveDownload = resolve; }); };
  await online.prefs.speak('جديد', 'ar'); online.tick(50);
  const beforeStop = clips.length; online.prefs.stop();
  assert.equal(requests.at(-1).options.signal.aborted, true);
  resolveDownload({ ok: true, blob: async () => ({ size: 100, type: 'audio/mpeg' }) }); await settleAudio();
  assert.equal(clips.length, beforeStop);
  online.prefs.set('onlineSpeech', false); await online.prefs.speak('غير متاح', 'ar');
  assert.match(online.messages.at(-1), /No voice/);
  online.prefs.set('onlineSpeech', true);
  online.platform.fetch = async () => ({ ok: false, json: async () => ({ error: 'Provider unavailable' }) });
  await online.prefs.speak('خطأ', 'ar'); online.tick(50); await settleAudio();
  assert.equal(online.messages.at(-1), 'Provider unavailable');
  assert.ok(online.context.speechChunks('😀'.repeat(250)).every(text => text.length <= 200 && !/[\uD800-\uDBFF]$/.test(text)));
  const clean = app.context.cleanPreferences({ rate: 99, volume: -2, historyLimit: 999, speechEnabled: 'false', copyMode: 'invalid' });
  assert.equal(clean.rate, 2); assert.equal(clean.volume, 0); assert.equal(clean.historyLimit, 30); assert.equal(clean.speechEnabled, true);
  console.log('Preferences checks passed: voice matching/loading, speech settings/errors, stop, auto reading, all copy modes, labels, persistence, validation');
})().catch(error => { console.error(error); process.exitCode = 1; });

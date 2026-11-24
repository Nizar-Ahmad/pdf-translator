const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs');
const source = fs.readFileSync('static/preferences.js', 'utf8').replace(/^export /gm, '');
class Node {
  constructor() { this.children = []; this.style = {}; this.value = ''; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  showModal() { this.open = true; } close() { this.open = false; }
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
  const document = { getElementById: node, createElement: () => new Node(), body: new Node(),
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
  reset.prefs.set('copyMode', 'both'); reset.node('resetPreferences').onclick();
  assert.equal(reset.prefs.get('copyMode'), 'translation');
  assert.equal(reset.storage.get('dictionary:book')[0].text, 'keep me');
  const html = fs.readFileSync('static/index.html', 'utf8');
  for (const match of source.matchAll(/node\('([^']+)'\)/g)) assert.ok(html.includes('id="' + match[1] + '"'), 'Missing settings control ' + match[1]);
  const reload = boot(app.storage); assert.equal(reload.prefs.get('copyMode'), 'both');
  assert.equal(reload.prefs.get('voices').ar, 'ar-2');
  app.rejectWrites(); assert.equal(app.prefs.set('copyMode', 'original'), false); assert.equal(app.prefs.get('copyMode'), 'both');
  const chunks = app.context.speechChunks('word '.repeat(200)); assert.ok(chunks.length > 1); assert.ok(chunks.every(text => text.length <= 220));
  const clean = app.context.cleanPreferences({ rate: 99, volume: -2, historyLimit: 999, speechEnabled: 'false', copyMode: 'invalid' });
  assert.equal(clean.rate, 2); assert.equal(clean.volume, 0); assert.equal(clean.historyLimit, 30); assert.equal(clean.speechEnabled, true);
  console.log('Preferences checks passed: voice matching/loading, speech settings/errors, stop, auto reading, all copy modes, labels, persistence, validation');
})().catch(error => { console.error(error); process.exitCode = 1; });

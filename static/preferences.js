export const DEFAULT_PREFERENCES = Object.freeze({
  speechEnabled: true, autoSpeech: 'off', rate: 1, volume: 1, voices: {},
  copyMode: 'translation', copyLabels: false, saveContext: true,
  autoTranslateSelection: true, rememberPosition: true, rememberRecentFiles: true,
  historyLimit: 30, readingSize: 100, translationPopup: false, popupDuration: 5,
});
export function cleanPreferences(raw = {}) {
  const result = { ...DEFAULT_PREFERENCES, voices: {} };
  if (!raw || typeof raw !== 'object') return result;
  for (const key of ['speechEnabled', 'copyLabels', 'saveContext', 'autoTranslateSelection', 'rememberPosition', 'rememberRecentFiles', 'translationPopup']) {
    if (typeof raw[key] === 'boolean') result[key] = raw[key];
  }
  for (const [key, values] of Object.entries({ autoSpeech: ['off', 'translation', 'original', 'both'], copyMode: ['translation', 'original', 'both'], historyLimit: [0, 10, 30, 100], readingSize: [100, 110, 125, 150] })) {
    if (values.includes(raw[key])) result[key] = raw[key];
  }
  if (Number.isInteger(raw.popupDuration) && raw.popupDuration >= 0 && raw.popupDuration <= 3600) result.popupDuration = raw.popupDuration;
  if (typeof raw.rate === 'number' && Number.isFinite(raw.rate)) result.rate = Math.min(2, Math.max(0.5, raw.rate));
  if (typeof raw.volume === 'number' && Number.isFinite(raw.volume)) result.volume = Math.min(1, Math.max(0, raw.volume));
  if (raw.voices && typeof raw.voices === 'object') {
    for (const [language, uri] of Object.entries(raw.voices).slice(0, 100)) {
      if (/^[a-z]{2,3}$/i.test(language) && typeof uri === 'string' && uri.length < 1000) result.voices[language] = uri;
    }
  }
  return result;
}
const languageTag = language => (language || '').replaceAll('_', '-').toLowerCase();
const baseLanguage = language => languageTag(language).split('-')[0];
export function chooseVoice(voices, language, preferences) {
  const tag = languageTag(language), base = baseLanguage(language);
  const matching = voices.filter(voice => baseLanguage(voice.lang) === base);
  return matching.find(voice => (voice.voiceURI || voice.name) === preferences.voices[base]) ||
    matching.find(voice => languageTag(voice.lang) === tag && voice.default) ||
    matching.find(voice => languageTag(voice.lang) === tag) || matching.find(voice => voice.default) || matching[0] ||
    (base === 'auto' || !base ? voices.find(voice => voice.default) || voices[0] : null);
}
export function copyContents(entry, preferences, languageName = code => code) {
  const source = entry.detected && entry.detected !== 'auto' ? entry.detected : entry.source;
  const original = preferences.copyLabels ? `${languageName(source)}: ${entry.text}` : entry.text;
  const translated = preferences.copyLabels ? `${languageName(entry.target)}: ${entry.translation}` : entry.translation;
  return preferences.copyMode === 'original' ? original : preferences.copyMode === 'both' ? original + '\n' + translated : translated;
}
export function speechChunks(text) {
  const parts = []; let remaining = text.trim();
  while (remaining.length > 220) {
    let end = remaining.lastIndexOf(' ', 220);
    if (end < 80) end = 220;
    if (/[\uD800-\uDBFF]/.test(remaining[end - 1])) --end;
    parts.push(remaining.slice(0, end)); remaining = remaining.slice(end).trimStart();
  }
  if (remaining) parts.push(remaining);
  return parts;
}
export function createPreferences({ store, toast, languages, languageName, onChange = () => {} }, platform = window) {
  let values = cleanPreferences(store.get('preferences', {})), generation = 0, utterance = null, watchdog = null;
  const node = id => document.getElementById(id);
  const synth = () => platform.speechSynthesis;
  const supported = () => !!synth() && typeof platform.SpeechSynthesisUtterance === 'function';
  const voices = () => { try { return synth()?.getVoices() || []; } catch { return []; } };
  function stop() {
    ++generation; clearTimeout(watchdog); utterance = null;
    try { synth()?.cancel(); } catch { /* Unsupported speech backend. */ }
  }
  function report(message) { node('speechStatus').textContent = message; toast(message, 5000); }
  function refreshVoices() {
    const all = voices(), language = node('settingVoiceLanguage').value || 'en';
    const matching = all.filter(voice => baseLanguage(voice.lang) === baseLanguage(language));
    const select = node('settingVoice'); select.replaceChildren(new Option('Automatic voice for this language', ''));
    for (const voice of matching) select.append(new Option(`${voice.name} · ${voice.lang}${voice.localService ? ' · device' : ''}`, voice.voiceURI || voice.name));
    const saved = values.voices[baseLanguage(language)] || '';
    if (saved && !matching.some(voice => (voice.voiceURI || voice.name) === saved)) select.append(new Option('Previously selected voice (unavailable)', saved));
    select.value = saved;
    node('speechStatus').textContent = !supported() ? 'Speech is not supported in this browser.' : !all.length
      ? 'No voices are available yet. Refresh voices; if none appear, install or enable a system speech voice and restart the browser.'
      : matching.length ? `${all.length} voices available; ${matching.length} for ${languageName(language)}.`
      : `No ${languageName(language)} voice is available. Choose another language to test, or install a voice for this language.`;
  }
  async function waitForVoices() {
    if (voices().length) return voices();
    return new Promise(resolve => {
      const engine = synth(); let timer;
      const finish = () => { clearTimeout(timer); engine?.removeEventListener?.('voiceschanged', changed); resolve(voices()); };
      const changed = () => { if (voices().length) finish(); };
      engine?.addEventListener?.('voiceschanged', changed);
      timer = setTimeout(finish, 1800); changed();
    });
  }
  async function speakSequence(entries) {
    stop(); const token = generation;
    if (!values.speechEnabled) { report('Speech is turned off. Enable it in Settings.'); return; }
    if (!supported()) { report('Speech is unavailable in this browser.'); return; }
    if (!values.volume) { report('Speech volume is zero. Increase it in Settings.'); return; }
    let available = voices();
    if (!available.length) available = await waitForVoices();
    if (token !== generation) return;
    if (!available.length) { refreshVoices(); report('No speech voices were found. Open Settings to check available voices.'); return; }
    const queue = [];
    for (const entry of entries) {
      const voice = chooseVoice(available, entry.language, values);
      if (!voice) { report(`No voice is available for ${languageName(entry.language)}. Select or install one in Settings.`); return; }
      for (const text of speechChunks(entry.text || '')) queue.push({ text, voice });
    }
    function next() {
      if (token !== generation) return;
      const item = queue.shift();
      if (!item) { utterance = null; node('speechStatus').textContent = 'Finished speaking.'; return; }
      // Keep a reference until playback finishes; speak short chunks to avoid engine stalls.
      utterance = new platform.SpeechSynthesisUtterance(item.text);
      utterance.voice = item.voice; utterance.lang = item.voice.lang;
      utterance.rate = values.rate; utterance.volume = values.volume;
      utterance.onstart = () => { if (token === generation) { clearTimeout(watchdog); node('speechStatus').textContent = `Speaking with ${item.voice.name}…`; } };
      utterance.onend = () => { if (token === generation) { clearTimeout(watchdog); next(); } };
      utterance.onerror = event => {
        if (token !== generation || ['canceled', 'interrupted'].includes(event.error)) return;
        stop(); report(event.error === 'not-allowed' ? 'The browser blocked automatic speech. Click Hear translation or Test voice to allow playback.'
          : `Speech failed (${event.error || 'voice unavailable'}). Try another voice in Settings.`);
      };
      watchdog = setTimeout(() => { if (token === generation) { stop(); report('The speech engine did not start. Try another voice and check system sound settings.'); } }, 5000);
      try { synth().resume(); synth().speak(utterance); }
      catch { stop(); report('The speech engine could not play this voice. Try another voice in Settings.'); }
    }
    // Some engines discard a speak immediately following cancel; allow cancel to settle.
    setTimeout(next, 50);
  }
  async function copy(entry) {
    const text = copyContents(entry, values, languageName);
    try {
      if (!platform.navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await platform.navigator.clipboard.writeText(text);
    } catch {
      const previous = document.activeElement, area = document.createElement('textarea');
      area.value = text; area.style.position = 'fixed'; area.style.opacity = '0'; document.body.append(area); area.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* Display failure below. */ }
      finally { area.remove(); previous?.focus?.(); }
      if (!ok) { toast('Copy failed. Select the text and copy it manually.'); return; }
    }
    toast(values.copyMode === 'both' ? 'Original and translation copied' : values.copyMode === 'original' ? 'Original text copied' : 'Translation copied');
  }
  function set(key, value) {
    const next = cleanPreferences({ ...values, [key]: value });
    if (!store.set('preferences', next)) { toast('Could not save settings. Browser storage may be full or unavailable.'); sync(); return false; }
    values = next;
    if (['speechEnabled', 'voices', 'rate', 'volume', 'autoSpeech'].includes(key)) stop();
    onChange(key, values[key]); return true;
  }
  const fields = {
    speechEnabled: 'settingSpeechEnabled', autoSpeech: 'settingAutoSpeech', rate: 'settingRate', volume: 'settingVolume',
    copyMode: 'settingCopyMode', copyLabels: 'settingCopyLabels', saveContext: 'settingSaveContext',
    autoTranslateSelection: 'settingAutoTranslate', rememberPosition: 'settingRememberPosition',
    translationPopup: 'settingTranslationPopup', popupDuration: 'settingPopupDuration',
    rememberRecentFiles: 'settingRememberRecent', historyLimit: 'settingHistoryLimit', readingSize: 'settingReadingSize',
  };
  function sync() {
    for (const [key, id] of Object.entries(fields)) {
      if (typeof DEFAULT_PREFERENCES[key] === 'boolean') node(id).checked = values[key];
      else node(id).value = values[key];
    }
    node('settingRateValue').textContent = values.rate + '×';
    node('settingVolumeValue').textContent = Math.round(values.volume * 100) + '%';
    node('settingPopupDuration').disabled = !values.translationPopup;
    refreshVoices();
  }
  for (const [key, id] of Object.entries(fields)) node(id).onchange = () => {
    const value = typeof DEFAULT_PREFERENCES[key] === 'boolean' ? node(id).checked
      : typeof DEFAULT_PREFERENCES[key] === 'number' ? Number(node(id).value) : node(id).value;
    if (key === 'popupDuration' && (String(node(id).value).trim() === '' || !Number.isInteger(value) || value < 0 || value > 3600)) {
      toast('Enter a whole number from 0 to 3600 seconds. Use 0 to keep the popup open.');
      sync(); return;
    }
    set(key, value); sync();
  };
  for (const [code, label] of languages) node('settingVoiceLanguage').append(new Option(label, code));
  node('settingVoiceLanguage').value = 'en';
  node('settingVoiceLanguage').onchange = refreshVoices;
  node('settingVoice').onchange = () => set('voices', { ...values.voices, [baseLanguage(node('settingVoiceLanguage').value)]: node('settingVoice').value });
  node('settingsBtn').onclick = () => { node('settingsDialog').showModal(); sync(); };
  node('settingsClose').onclick = () => node('settingsDialog').close();
  node('refreshVoices').onclick = refreshVoices;
  node('stopSpeech').onclick = () => { stop(); node('speechStatus').textContent = 'Speech stopped.'; };
  node('testVoice').onclick = () => {
    const language = node('settingVoiceLanguage').value;
    const samples = { en: 'Hello. This is a voice test.', ar: 'مرحباً. هذا اختبار للصوت.', fr: 'Bonjour.', de: 'Guten Tag.', es: 'Hola.', tr: 'Merhaba.', ru: 'Привет.', 'zh-CN': '你好。', 'zh-TW': '你好。', ja: 'こんにちは。' };
    const text = node('voiceTestText').value || samples[language];
    if (!text) { toast('Enter a word or sentence in the selected language to test its voice.'); return; }
    return speakSequence([{ text, language }]);
  };
  node('resetPreferences').onclick = () => {
    if (!store.set('preferences', { ...DEFAULT_PREFERENCES, voices: {} })) { toast('Could not reset settings.'); return; }
    stop(); values = cleanPreferences(); onChange('reset', values); sync(); toast('Preferences reset. Saved books and dictionaries were kept.');
  };
  if (supported()) { synth().getVoices(); synth().addEventListener?.('voiceschanged', refreshVoices); }
  return { get: key => values[key], set, stop, copy, supported,
    speak: (text, language) => speakSequence([{ text, language }]),
    autoSpeak: entry => {
      if (values.autoSpeech === 'off' || !values.speechEnabled) return;
      const items = [], original = { text: entry.text, language: entry.detected && entry.detected !== 'auto' ? entry.detected : entry.source };
      if (['original', 'both'].includes(values.autoSpeech)) items.push(original);
      if (['translation', 'both'].includes(values.autoSpeech)) items.push({ text: entry.translation, language: entry.target });
      return speakSequence(items);
    },
  };
}

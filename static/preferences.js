const DEFAULT_TRANSLATION_SHORTCUT = Object.freeze({ code: 'KeyT', ctrl: false, alt: true, shift: false, meta: false });
function validTranslationShortcut(value) {
  return !!value && typeof value.code === 'string' && /^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2]))$/.test(value.code)
    && ['ctrl', 'alt', 'shift', 'meta'].every(key => typeof value[key] === 'boolean')
    && (value.ctrl || value.alt || value.meta)
    && !((value.ctrl || value.meta) && !value.alt && ['KeyA', 'KeyC', 'KeyV', 'KeyX', 'KeyO', 'KeyR', 'KeyW', 'KeyT', 'KeyN', 'KeyL', 'KeyP', 'KeyS', 'KeyF', 'KeyQ'].includes(value.code));
}
export function translationShortcutFromEvent(event) {
  if (event.isComposing || event.repeat) return null;
  const shortcut = { code: event.code, ctrl: !!event.ctrlKey, alt: !!event.altKey, shift: !!event.shiftKey, meta: !!event.metaKey };
  return validTranslationShortcut(shortcut) ? shortcut : null;
}
export function matchesTranslationShortcut(event, shortcut) {
  return !!shortcut && !event.repeat && !event.isComposing && event.code === shortcut.code
    && !!event.ctrlKey === shortcut.ctrl && !!event.altKey === shortcut.alt
    && !!event.shiftKey === shortcut.shift && !!event.metaKey === shortcut.meta;
}
export function formatTranslationShortcut(shortcut) {
  return shortcut ? [shortcut.ctrl && 'Ctrl', shortcut.alt && 'Alt', shortcut.shift && 'Shift', shortcut.meta && '⌘',
    shortcut.code.replace(/^Key|^Digit/, '')].filter(Boolean).join(' + ') : 'Disabled';
}

export const DEFAULT_PREFERENCES = Object.freeze({
  translationShortcut: DEFAULT_TRANSLATION_SHORTCUT, speechEnabled: true, onlineSpeech: true, showTranslateIcon: true, autoSpeech: 'off', rate: 1, volume: 1, voices: {},
  copyMode: 'translation', copyLabels: false, saveContext: true,
  autoTranslateSelection: true, rememberPosition: true, rememberRecentFiles: true,
  historyLimit: 30, readingSize: 100, translationPopup: false, popupDuration: 5, enhancePdfText: false, showTopBar: true, restoreOnReload: true, themeMode: 'system', themeColor: 'teal',
});
export function cleanPreferences(raw = {}) {
  const result = { ...DEFAULT_PREFERENCES, voices: {} };
  if (!raw || typeof raw !== 'object') return result;
  for (const key of ['speechEnabled', 'copyLabels', 'saveContext', 'autoTranslateSelection', 'rememberPosition', 'rememberRecentFiles', 'translationPopup', 'enhancePdfText', 'showTopBar', 'restoreOnReload', 'onlineSpeech', 'showTranslateIcon']) {
    if (typeof raw[key] === 'boolean') result[key] = raw[key];
  }
  for (const [key, values] of Object.entries({ themeMode: ['system', 'light', 'dark'], themeColor: ['teal', 'blue', 'violet', 'rose', 'amber'], autoSpeech: ['off', 'translation', 'original', 'both'], copyMode: ['translation', 'original', 'both'], historyLimit: [0, 10, 30, 100], readingSize: [100, 110, 125, 150] })) {
    if (values.includes(raw[key])) result[key] = raw[key];
  }
  if (raw.translationShortcut === null) result.translationShortcut = null;
  else if (validTranslationShortcut(raw.translationShortcut)) result.translationShortcut = { ...raw.translationShortcut };
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
  while (remaining.length > 200) {
    let end = remaining.lastIndexOf(' ', 200);
    if (end < 80) end = 200;
    if (/[\uD800-\uDBFF]/.test(remaining[end - 1])) --end;
    parts.push(remaining.slice(0, end)); remaining = remaining.slice(end).trimStart();
  }
  if (remaining) parts.push(remaining);
  return parts;
}
export function enableOutsideDismiss(dialog) {
  let startedOutside = null;
  const isOutside = event => {
    if (event.target !== dialog) return false;
    const rect = dialog.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  };
  dialog.addEventListener('pointerdown', event => {
    startedOutside = dialog.open && event.button === 0 && isOutside(event)
      ? { x: event.clientX, y: event.clientY } : null;
  });
  dialog.addEventListener('pointercancel', () => { startedOutside = null; });
  dialog.addEventListener('click', event => {
    const start = startedOutside; startedOutside = null;
    if (dialog.open && start && event.detail !== 0 && isOutside(event)
      && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 8) dialog.close();
  });
}

export function createPreferences({ store, toast, languages, languageName, onChange = () => {} }, platform = window) {
  let values = cleanPreferences(store.get('preferences', {})), generation = 0, utterance = null, watchdog = null;
  let audio = null, audioURL = null, speechAbort = null;
  const audioCache = new Map();
  const node = id => document.getElementById(id);
  const synth = () => platform.speechSynthesis;
  const deviceSupported = () => !!synth() && typeof platform.SpeechSynthesisUtterance === 'function';
  const onlineSupported = () => values.onlineSpeech && typeof platform.Audio === 'function' && typeof platform.fetch === 'function'
    && typeof platform.AbortController === 'function' && !!platform.URL?.createObjectURL;
  const supported = () => deviceSupported() || onlineSupported();
  const voices = () => { try { return synth()?.getVoices() || []; } catch { return []; } };
  function releaseAudio() {
    if (audio) { audio.onended = null; audio.onerror = null; audio.pause(); audio.removeAttribute?.('src'); audio = null; }
    if (audioURL) { platform.URL.revokeObjectURL(audioURL); audioURL = null; }
  }
  function stop() {
    ++generation; clearTimeout(watchdog); utterance = null;
    speechAbort?.abort(); speechAbort = null; releaseAudio();
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
    node('speechStatus').textContent = onlineSupported() && !matching.length ? `No device voice for ${languageName(language)}. Free online speech will be used.` : !supported() ? 'Speech is not supported in this browser.' : !all.length
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
  async function playOnline(item, token, next) {
    try {
      if (!item.language || item.language === 'auto') throw new Error('Choose the original text language before using online speech.');
      const key = JSON.stringify([item.language, item.text]);
      let blob = audioCache.get(key);
      if (!blob) {
        node('speechStatus').textContent = 'Loading free online speech…';
        const controller = new platform.AbortController(); speechAbort = controller;
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
          const response = await platform.fetch('/api/translate', { method: 'POST', signal: controller.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operation: 'speech', text: item.text, language: item.language }) });
          if (!response.ok) {
            let detail = {}; try { detail = await response.json(); } catch { /* Use the fallback message. */ }
            throw new Error(detail.error || 'The free online speech service is unavailable. Try again later.');
          }
          blob = await response.blob();
          if (!blob.size || !blob.type.startsWith('audio/')) throw new Error('Online speech returned an invalid audio clip.');
        } finally {
          clearTimeout(timeout); if (speechAbort === controller) speechAbort = null;
        }
        if (token !== generation) return;
        audioCache.set(key, blob);
        while (audioCache.size > 32 || [...audioCache.values()].reduce((sum, clip) => sum + clip.size, 0) > 4 * 1024 * 1024) audioCache.delete(audioCache.keys().next().value);
      }
      if (token !== generation) return;
      releaseAudio(); audioURL = platform.URL.createObjectURL(blob); audio = new platform.Audio(audioURL);
      audio.volume = values.volume; audio.playbackRate = values.rate;
      audio.onended = () => { if (token === generation) { releaseAudio(); next(); } };
      audio.onerror = () => { if (token === generation) { stop(); report('Online speech could not be played. Try again or select a device voice.'); } };
      await audio.play();
      if (token === generation) node('speechStatus').textContent = `Speaking with free online ${languageName(item.language)} speech…`;
    } catch (error) {
      if (token !== generation) return;
      stop();
      report(error.name === 'NotAllowedError' ? 'The browser blocked speech playback. Click Hear original, Hear translation, or Test voice to allow it.'
        : error.name === 'AbortError' ? 'Online speech timed out. Please try again.' : error.message || 'Free online speech is unavailable.');
    }
  }
  async function speakSequence(entries) {
    stop(); const token = generation;
    if (!values.speechEnabled) { report('Speech is turned off. Enable it in Settings.'); return; }
    if (!supported()) { report('Speech is unavailable in this browser. Enable free online speech in Settings.'); return; }
    if (!values.volume) { report('Speech volume is zero. Increase it in Settings.'); return; }
    let available = voices();
    if (!available.length && deviceSupported()) available = await waitForVoices();
    if (token !== generation) return;
    if (!available.length && !onlineSupported()) { refreshVoices(); report('No speech voices were found. Enable free online speech or install a device voice.'); return; }
    const queue = [];
    for (const entry of entries) {
      const voice = chooseVoice(available, entry.language, values);
      if (!voice && !onlineSupported()) { report(`No voice is available for ${languageName(entry.language)}. Enable free online speech or install a device voice.`); return; }
      for (const text of speechChunks(entry.text || '')) queue.push({ text, voice, language: entry.language, online: !voice });
    }
    function next() {
      if (token !== generation) return;
      const item = queue.shift();
      if (!item) { utterance = null; node('speechStatus').textContent = 'Finished speaking.'; return; }
      if (item.online) { playOnline(item, token, next); return; }
      function deviceFailed(message) {
        clearTimeout(watchdog);
        if (utterance) { utterance.onstart = null; utterance.onend = null; utterance.onerror = null; }
        try { synth()?.cancel(); } catch { /* Continue with online speech if available. */ }
        if (onlineSupported()) { item.online = true; queue.unshift(item); next(); }
        else { stop(); report(message); }
      }
      utterance = new platform.SpeechSynthesisUtterance(item.text);
      utterance.voice = item.voice; utterance.lang = item.voice.lang;
      utterance.rate = values.rate; utterance.volume = values.volume;
      utterance.onstart = () => { if (token === generation) { clearTimeout(watchdog); node('speechStatus').textContent = `Speaking with ${item.voice.name}…`; } };
      utterance.onend = () => { if (token === generation) { clearTimeout(watchdog); next(); } };
      utterance.onerror = event => {
        if (token !== generation || ['canceled', 'interrupted'].includes(event.error)) return;
        if (event.error === 'not-allowed') { stop(); report('The browser blocked automatic speech. Click Hear translation or Test voice to allow playback.'); }
        else deviceFailed(`Speech failed (${event.error || 'voice unavailable'}). Try another voice in Settings.`);
      };
      watchdog = setTimeout(() => { if (token === generation) deviceFailed('The speech engine did not start. Try another voice or enable free online speech in Settings.'); }, 5000);
      try { synth().resume(); synth().speak(utterance); }
      catch { deviceFailed('The speech engine could not play this voice. Try another voice or enable free online speech in Settings.'); }
    }
    // Some device engines discard speech immediately following cancel.
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
    if (key === 'themeMode' || key === 'themeColor') applyAppearance();
    if (['speechEnabled', 'onlineSpeech', 'voices', 'rate', 'volume', 'autoSpeech'].includes(key)) stop();
    onChange(key, values[key]); return true;
  }
  const fields = {
    themeMode: 'settingThemeMode', speechEnabled: 'settingSpeechEnabled', onlineSpeech: 'settingOnlineSpeech', showTranslateIcon: 'settingShowTranslateIcon', autoSpeech: 'settingAutoSpeech', rate: 'settingRate', volume: 'settingVolume',
    copyMode: 'settingCopyMode', copyLabels: 'settingCopyLabels', saveContext: 'settingSaveContext',
    autoTranslateSelection: 'settingAutoTranslate', rememberPosition: 'settingRememberPosition',
    translationPopup: 'settingTranslationPopup', popupDuration: 'settingPopupDuration', enhancePdfText: 'settingEnhancePdfText', showTopBar: 'settingShowTopBar', restoreOnReload: 'settingRestoreOnReload',
    rememberRecentFiles: 'settingRememberRecent', historyLimit: 'settingHistoryLimit', readingSize: 'settingReadingSize',
  };
  function applyAppearance() {
    document.documentElement?.setAttribute('data-theme', values.themeMode);
    document.documentElement?.setAttribute('data-accent', values.themeColor);
    for (const color of ['teal', 'blue', 'violet', 'rose', 'amber']) {
      node('themeColor' + color).setAttribute('aria-pressed', String(values.themeColor === color));
    }
  }
  for (const color of ['teal', 'blue', 'violet', 'rose', 'amber']) {
    node('themeColor' + color).onclick = () => { set('themeColor', color); sync(); };
  }
  function sync() {
    applyAppearance();
    for (const [key, id] of Object.entries(fields)) {
      if (typeof DEFAULT_PREFERENCES[key] === 'boolean') node(id).checked = values[key];
      else node(id).value = values[key];
    }
    node('settingRateValue').textContent = values.rate + '×';
    node('settingVolumeValue').textContent = Math.round(values.volume * 100) + '%';
    node('settingTranslationShortcut').value = formatTranslationShortcut(values.translationShortcut);
    node('disableTranslationShortcut').disabled = !values.translationShortcut;
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
  node('settingTranslationShortcut').onkeydown = event => {
    if (event.key === 'Tab' || event.key === 'Escape') return;
    event.preventDefault(); event.stopPropagation();
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
    const shortcut = translationShortcutFromEvent(event);
    if (!shortcut) {
      node('translationShortcutHelp').textContent = 'Use Ctrl, Alt, or ⌘ with a letter, number, or F-key. Choose a combination other than common browser shortcuts.';
      return;
    }
    if (set('translationShortcut', shortcut)) {
      sync(); node('translationShortcutHelp').textContent = 'Shortcut saved. Highlight PDF text, then press ' + formatTranslationShortcut(shortcut) + '.';
    }
  };
  node('disableTranslationShortcut').onclick = () => { set('translationShortcut', null); sync(); };
  node('resetTranslationShortcut').onclick = () => { set('translationShortcut', DEFAULT_TRANSLATION_SHORTCUT); sync(); };
  for (const [code, label] of languages) node('settingVoiceLanguage').append(new Option(label, code));
  node('settingVoiceLanguage').value = 'en';
  node('settingVoiceLanguage').onchange = refreshVoices;
  node('settingVoice').onchange = () => set('voices', { ...values.voices, [baseLanguage(node('settingVoiceLanguage').value)]: node('settingVoice').value });
  node('settingsBtn').onclick = () => { node('settingsDialog').showModal(); sync(); };
  node('settingsClose').onclick = () => node('settingsDialog').close();
  enableOutsideDismiss(node('settingsDialog'));
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
  applyAppearance();
  if (deviceSupported()) { synth().getVoices(); synth().addEventListener?.('voiceschanged', refreshVoices); }
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

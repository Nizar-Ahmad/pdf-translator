import { createTranslationPopup } from './translation-popup.js';
import { createPreferences, matchesTranslationShortcut, enableOutsideDismiss } from './preferences.js';
import { createLibrary } from './library.js';
import * as pdfjsLib from './vendor/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';

/* ====================================================================
   Config
   ==================================================================== */
const LANGS = [
  ['ar', 'Arabic — العربية'], ['en', 'English'], ['fr', 'French — Français'], ['de', 'German — Deutsch'],
  ['es', 'Spanish — Español'], ['tr', 'Turkish — Türkçe'], ['ru', 'Russian — Русский'],
  ['zh-CN', 'Chinese (Simplified)'], ['zh-TW', 'Chinese (Traditional)'], ['ja', 'Japanese — 日本語'],
  ['ko', 'Korean — 한국어'], ['it', 'Italian — Italiano'], ['pt', 'Portuguese — Português'],
  ['fa', 'Persian — فارسی'], ['he', 'Hebrew — עברית'], ['hi', 'Hindi — हिन्दी'], ['ur', 'Urdu — اردو'],
  ['nl', 'Dutch — Nederlands'], ['pl', 'Polish — Polski'], ['uk', 'Ukrainian — Українська'],
  ['sv', 'Swedish — Svenska'], ['el', 'Greek — Ελληνικά'], ['id', 'Indonesian'], ['ku', 'Kurdish (Kurmanji)'],
];
const RTL = new Set(['ar', 'he', 'fa', 'ur', 'ku', 'ckb', 'iw', 'yi']);
const langName = (code) => (LANGS.find(([c]) => c === code)?.[1] || code).split(' — ')[0];
const isRTL = (code) => RTL.has((code || '').split('-')[0]);

const $ = (id) => document.getElementById(id);
const el = {
  translationPopupRoot: $('translationPopup'), toolbar: $('toolbar'), hideToolbar: $('hideToolbar'), showToolbar: $('showToolbar'),
  libraryBtn: $('libraryBtn'), libraryDialog: $('libraryDialog'), libraryClose: $('libraryClose'), librarySearch: $('librarySearch'), libraryStorage: $('libraryStorage'), recentList: $('recentList'), recentEmpty: $('recentEmpty'), folderChoose: $('folderChoose'), folderFallback: $('folderFallback'), folderReconnect: $('folderReconnect'), folderRefresh: $('folderRefresh'), folderInput: $('folderInput'), folderStatus: $('folderStatus'), folderEmpty: $('folderEmpty'), folderList: $('folderList'),
  openBtn: $('openBtn'), fileInput: $('fileInput'), emptyOpen: $('emptyOpen'),
  pageNav: $('pageNav'), prevBtn: $('prevBtn'), nextBtn: $('nextBtn'), pageInput: $('pageInput'), pageTotal: $('pageTotal'),
  zoomGroup: $('zoomGroup'), zoomIn: $('zoomIn'), zoomOut: $('zoomOut'), zoomFit: $('zoomFit'), zoomLabel: $('zoomLabel'),
  srcLang: $('srcLang'), tgtLang: $('tgtLang'), swapLang: $('swapLang'),
  viewSeg: $('viewSeg'), panelToggle: $('panelToggle'), panelMinimize: $('panelMinimize'), panelMaximize: $('panelMaximize'),
  stageWrap: $('stageWrap'), stage: $('stage'), empty: $('empty'),
  translateSelected: $('translateSelected'), translatePopupSelected: $('translatePopupSelected'), floatingTranslate: $('floatingTranslate'), selectionHintText: $('selectionHintText'),
  selPanel: $('selPanel'), selHint: $('selHint'), selCurrent: $('selCurrent'), selHistory: $('selHistory'), clearHistory: $('clearHistory'),
  dictionarySearch: $('dictionarySearch'), dictionaryScope: $('dictionaryScope'), dictionaryLanguageFilter: $('dictionaryLanguageFilter'), practiceBtn: $('practiceBtn'), exportJson: $('exportJson'), exportCsv: $('exportCsv'), importBtn: $('importBtn'), importFile: $('importFile'), practiceSection: $('practiceSection'), practiceProgress: $('practiceProgress'), practiceWord: $('practiceWord'), practiceAnswer: $('practiceAnswer'), practiceReveal: $('practiceReveal'), practiceGrade: $('practiceGrade'), practiceAgain: $('practiceAgain'), practiceRemembered: $('practiceRemembered'), practiceClose: $('practiceClose'), bookmarkBtn: $('bookmarkBtn'), bookmarkNote: $('bookmarkNote'), bookmarkList: $('bookmarkList'),
  dictionaryBtn: $('dictionaryBtn'), dictionaryCount: $('dictionaryCount'),
  selectionTab: $('selectionTab'), dictionaryTab: $('dictionaryTab'), panelTitle: $('panelTitle'),
  selectionSection: $('selectionSection'), dictionarySection: $('dictionarySection'),
  dictionaryBook: $('dictionaryBook'), dictionaryHint: $('dictionaryHint'), dictionaryList: $('dictionaryList'),
  toast: $('toast'), dropOverlay: $('dropOverlay'),
};

/* ====================================================================
   State + persistence
   ==================================================================== */
const store = {
  get(k, d) { try { const v = localStorage.getItem('pdft.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pdft.' + k, JSON.stringify(v)); return true; } catch { return false; } },
};
const state = {
  pdf: null, activeFile: null, bookKey: '', bookName: '', fileKey: '', pageNum: 1, numPages: 0,
  zoom: store.get('zoom', 'fit'),           // 'fit' or a number (scale)
  view: store.get('view', 'original'),      // original | split | translated
  panel: store.get('panel', true), panelSize: 'normal',
  src: store.get('src', 'auto'),
  tgt: store.get('tgt', 'ar'),
  scale: 1,
};

const translationPopup = createTranslationPopup({
  getDuration: () => preferences.get('popupDuration'), languageName: langName,
  onLayout: () => positionFloatingTranslate(),
  onCopy: item => preferences.copy(item),
  onRetry: item => translateSelection(item.text, true, item.page),
  onOpen: () => {
    state.panel = true; if (state.panelSize === 'minimized') state.panelSize = 'normal'; store.set('panel', true); applyChrome(); showPanelSection('selection');
    el.translateSelected.focus({ preventScroll: true });
    refitReaderAfterLayout();
  },
});
const library = createLibrary({ el, openFile, toast });
const preferences = createPreferences({ store, toast, languages: LANGS, languageName: langName,
  onChange(key) {
    if (key === 'translationPopup' || key === 'reset') translationPopup.dismiss();
    if (['restoreOnReload', 'reset'].includes(key)) {
      if (preferences.get('restoreOnReload') && state.activeFile) library.rememberReadingSession(state.activeFile, state.bookKey, readingPosition());
      else library.clearReadingSession?.();
    }
    if (key === 'popupDuration') translationPopup.configure();
    if (['showTopBar', 'reset'].includes(key)) {
      applyToolbarVisibility();
      if (state.pdf) scheduleVisiblePages();
    }
    if (['autoTranslateSelection', 'translationPopup', 'showTopBar', 'showTranslateIcon', 'reset'].includes(key)) updateSelectionControls();
    if (key === 'onlineSpeech') { renderPanel(); renderDictionary(); }
    if (key === 'historyLimit' || key === 'reset') {
      history.splice(preferences.get('historyLimit')); renderPanel();
    }
    if (['readingSize', 'enhancePdfText', 'reset'].includes(key) && state.pdf) renderPage();
  },
});

/* ====================================================================
   Small helpers
   ==================================================================== */
let toastTimer;
function toast(msg, ms = 2600) {
  el.toast.textContent = msg; el.toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯]/;
const hasLetters = (s) => /\p{L}/u.test(s);

async function callTranslate(texts, source, target, onResult, signal) {
  const res = await fetch('/api/translate', {
    signal, method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts, source, target, stream: !!onResult }),
  });
  if (res.ok && onResult) {
    const reader = res.body.getReader(), decoder = new TextDecoder();
    let buffer = '', done = false, error = null;
    const translations = [], detected = [];
    const consume = (line) => {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      if (event.done) { done = true; return; }
      if (event.error) { error = new Error(event.error); return; }
      translations[event.index] = event.translation;
      detected[event.index] = event.detected;
      onResult(event.index, event.translation);
    };
    try {
      while (true) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        const lines = buffer.split('\n'); buffer = lines.pop();
        lines.forEach(consume);
        if (chunk.done) break;
      }
      consume(buffer);
    } finally { reader.releaseLock(); }
    if (error) throw error;
    if (!done) throw new Error('Translation connection interrupted. Please retry.');
    return { translations, detected };
  }
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data;
}

/* ====================================================================
   Toolbar setup
   ==================================================================== */
function fillLangSelect(sel, withAuto, value) {
  sel.replaceChildren();
  if (withAuto) sel.append(new Option('Auto-detect', 'auto'));
  for (const [code, name] of LANGS) sel.append(new Option(name, code));
  sel.value = value;
}
fillLangSelect(el.srcLang, true, state.src);
fillLangSelect(el.tgtLang, false, state.tgt);

function updateSelectionControls() {
  const panelVisible = state.panel && state.panelSize !== 'minimized';
  const floatingEnabled = preferences.get('showTranslateIcon');
  el.translatePopupSelected.hidden = floatingEnabled || !state.pdf || panelVisible || !preferences.get('translationPopup');
  el.floatingTranslate.hidden = !floatingEnabled || !state.pdf || !readSelection();
  positionFloatingTranslate();
  el.translateSelected.disabled = !state.pdf;
  el.selectionHintText.textContent = preferences.get('autoTranslateSelection')
    ? 'Highlight any text in your PDF. Your translation will appear right here.'
    : 'Highlight text in your PDF, then click Translate selection above.';
}

function applyToolbarVisibility() {
  const visible = preferences.get('showTopBar');
  el.toolbar.hidden = !visible;
  el.showToolbar.hidden = visible;
  positionMenuControl();
}
function setToolbarVisible(visible) {
  if (preferences.set('showTopBar', visible)) {
    (visible ? el.hideToolbar : el.showToolbar).focus({ preventScroll: true });
  }
}

function refitReaderAfterLayout() {
  if (!state.pdf) return;
  if (state.zoom === 'fit' && typeof window.ResizeObserver !== 'function') renderPage();
  else scheduleVisiblePages();
}

function setPanelSize(size) {
  state.panelSize = size;
  applyChrome();
  refitReaderAfterLayout();
}

function applyChrome() {
  applyToolbarVisibility();
  el.panelToggle.setAttribute('aria-pressed', String(state.panel));
  el.selPanel.hidden = !state.panel;
  const minimized = state.panelSize === 'minimized', maximized = state.panelSize === 'maximized';
  el.selPanel.classList.toggle('isMinimized', minimized);
  el.selPanel.classList.toggle('isMaximized', maximized);
  el.panelMinimize.setAttribute('aria-expanded', String(!minimized));
  el.panelMaximize.setAttribute('aria-pressed', String(maximized));
  for (const [button, restore, action] of [[el.panelMinimize, minimized, 'Minimize'], [el.panelMaximize, maximized, 'Maximize']]) {
    button.title = restore ? 'Restore panel' : `${action} panel`;
    button.setAttribute('aria-label', button.title);
    button.innerHTML = `<svg class="uiIcon" aria-hidden="true"><use href="#i-${restore ? 'restore' : action.toLowerCase()}"/></svg>`;
  }
  if (state.panel && state.panelSize !== 'minimized') translationPopup.dismiss();
  for (const b of el.viewSeg.querySelectorAll('button')) {
    const active = b.dataset.view === state.view;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  }
  el.zoomLabel.textContent = Math.round(state.scale * 100) + '%';
  updateSelectionControls();
}

/* ====================================================================
   Loading a PDF
   ==================================================================== */
const docOpts = {
  cMapUrl: './vendor/cmaps/', cMapPacked: true,
  standardFontDataUrl: './vendor/standard_fonts/',
  wasmUrl: './vendor/wasm/', iccUrl: './vendor/iccs/',
};
const blocksCache = new Map();     // `${page}` -> blocks[]
const translationCache = new Map(); // `${src}|${tgt}|${page}` -> {blocks, translations}

let fileLoadToken = 0;
async function openFile(file, resume = null) {
  if (!file) return;
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) { toast('That does not look like a PDF file.'); return; }
  const loadToken = ++fileLoadToken;
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    if (loadToken !== fileLoadToken) return;
    const task = pdfjsLib.getDocument({ data, ...docOpts });
    task.onPassword = (update, reason) => {
      if (loadToken !== fileLoadToken) { task.destroy(); return; }
      const pw = window.prompt(reason === 2 ? 'Wrong password. Try again:' : 'This PDF is password protected. Password:');
      if (pw === null) task.destroy(); else update(pw);
    };
    const pdf = await task.promise;
    if (loadToken !== fileLoadToken) { await pdf.destroy(); return; }
    if (state.pdf) { try { state.pdf.destroy(); } catch { /* ignore */ } }
    state.pdf = pdf; state.activeFile = file; state.numPages = pdf.numPages;
    state.fileKey = `${file.name}:${file.size}`;
    state.bookKey = pdf.fingerprints?.[0] || state.fileKey;
    state.bookName = file.name;
    preferences.stop();
    if (preferences.get('rememberRecentFiles')) library.remember(file, state.bookKey);
    if (preferences.get('restoreOnReload')) library.rememberReadingSession(file, state.bookKey, resume || {});
    else library.clearReadingSession?.();
    registerBook();
    stopPractice();
    el.bookmarkNote.value = '';
    loadBookDictionary();
    for (const entry of translationCache.values()) entry.controller.abort();
    blocksCache.clear(); translationCache.clear();
    ++selToken; lastSelKey = ''; current = null; history.length = 0; renderPanel();
    document.title = `${file.name} — PDF Translator`;
    el.empty.hidden = true; el.stage.hidden = false;
    el.pageNav.hidden = false; el.zoomGroup.hidden = false; el.viewSeg.hidden = false;
    el.pageTotal.textContent = pdf.numPages; el.pageInput.max = pdf.numPages;
    const saved = resume?.page ?? (preferences.get('rememberPosition') ? store.get('page:' + state.fileKey, 1) : 1);
    await goTo(clamp(saved, 1, pdf.numPages));
    if (resume?.offset) {
      const row = pageRows[state.pageNum - 1];
      if (row) {
        el.stageWrap.scrollTop += row.root.getBoundingClientRect().top - el.stageWrap.getBoundingClientRect().top
          + clamp(resume.offset, 0, 1) * row.root.offsetHeight;
        updateVisiblePages();
      }
    }
  } catch (e) {
    if (loadToken !== fileLoadToken) return;
    console.error(e);
    if (resume) library.clearReadingSession?.();
    toast('Could not open this PDF: ' + (e?.message || e), 5000);
  }
}

/* ====================================================================
   Page rendering
   ==================================================================== */
let renderToken = 0, readerPdf = null, pageRows = [], scrollFrame = 0;
const pageSizes = new Map();
function visibleColumns() { return state.view === 'split' ? 2 : 1; }
function computeScale(vw) {
  if (state.zoom !== 'fit') return clamp(state.zoom, 0.2, 6);
  const cols = visibleColumns(), gap = 28 * (cols - 1), pad = 60;
  return clamp((el.stageWrap.clientWidth - pad - gap) / cols / vw, 0.25, 1.5);
}
function captureZoomAnchor(event) {
  const root = event.target?.closest?.('.pageRow');
  const row = root && pageRows[Number(root.dataset.page) - 1];
  const box = event.target?.closest?.('.pageBox, .sheet');
  if (!row || row.root !== root || (box !== row.pageBox && box !== row.sheet)) return null;
  const rect = box.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return { pdf: state.pdf, page: row.number, translated: box === row.sheet,
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    clientX: event.clientX, clientY: event.clientY };
}
function restoreZoomAnchor(anchor) {
  const row = pageRows[anchor.page - 1];
  if (!row || anchor.pdf !== state.pdf) return;
  const box = anchor.translated ? row.sheet : row.pageBox, rect = box.getBoundingClientRect();
  el.stageWrap.scrollLeft += rect.left + anchor.x * rect.width - anchor.clientX;
  el.stageWrap.scrollTop += rect.top + anchor.y * rect.height - anchor.clientY;
}
function setCurrentPage(number) {
  state.pageNum = number;
  el.pageInput.value = number;
  el.prevBtn.disabled = number <= 1; el.nextBtn.disabled = number >= state.numPages;
  if (preferences.get('rememberPosition')) store.set('page:' + state.fileKey, number);
}
function makePageRow(number, size) {
  const row = { number, version: 0, loaded: false };
  row.root = document.createElement('section'); row.root.className = 'pageRow';
  row.root.dataset.page = number; row.root.setAttribute('aria-label', `Page ${number}`);
  for (const type of ['original', 'translation']) {
    const col = document.createElement('div'); col.className = 'col';
    col.hidden = type === 'original' ? state.view === 'translated' : state.view === 'original';
    const label = document.createElement('div'); label.className = 'colLabel';
    label.textContent = `${type === 'original' ? 'Original' : langName(state.tgt)} · page ${number}`;
    col.append(label);
    if (type === 'original') {
      row.pageBox = document.createElement('div'); row.pageBox.className = 'pageBox';
      row.canvas = document.createElement('canvas'); row.textLayer = document.createElement('div');
      row.textLayer.className = 'textLayer'; row.textLayer.dataset.page = number;
      row.textLayer.addEventListener('pointerdown', () => row.textLayer.classList.add('selecting'));
      row.pageBox.append(row.canvas, row.textLayer); col.append(row.pageBox);
    } else {
      row.sheet = document.createElement('article'); row.sheet.className = 'sheet'; col.append(row.sheet);
    }
    row.root.append(col);
  }
  sizePageRow(row, size);
  return row;
}
function sizePageRow(row, size) {
  const width = size.width * state.scale, height = size.height * state.scale;
  row.pageBox.style.width = width + 'px'; row.pageBox.style.height = height + 'px';
  row.sheet.style.width = width + 'px'; row.sheet.style.minHeight = height + 'px';
  row.pageBox.style.setProperty('--total-scale-factor', String(state.scale));
}
function disposePageRow(row) {
  row.version++; row.loaded = false;
  row.renderTask?.cancel(); row.textTask?.cancel(); row.detach?.(); row.detach = null;
  row.renderTask = null; row.textTask = null;
  row.canvas.width = 0; row.canvas.height = 0;
  const replacement = document.createElement('canvas');
  row.canvas.replaceWith(replacement); row.canvas = replacement;
  row.textLayer.replaceChildren();
  // Preserve the translated height so unloading does not move later pages.
  row.sheet.style.minHeight = Math.max(row.sheet.offsetHeight, parseFloat(row.sheet.style.minHeight) || 0) + 'px';
  row.sheet.replaceChildren();
}
function readingPosition() {
  const row = pageRows[state.pageNum - 1];
  if (!row || !row.root.offsetHeight) return { page: state.pageNum, offset: 0 };
  return { page: state.pageNum, offset: clamp((el.stageWrap.getBoundingClientRect().top - row.root.getBoundingClientRect().top) / row.root.offsetHeight, 0, 1) };
}
function checkpointReadingPosition() {
  if (!state.pdf) return;
  const position = readingPosition(); library.checkpointReadingSession?.(position.page, position.offset);
}
function scheduleVisiblePages() {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; updateVisiblePages(); });
}
function updateVisiblePages() {
  if (readerPdf !== state.pdf || !pageRows.length) return;
  const viewport = el.stageWrap.getBoundingClientRect(), margin = el.stageWrap.clientHeight * 0.75;
  const anchor = viewport.top + Math.min(150, el.stageWrap.clientHeight / 3);
  let current = pageRows[0], distance = Infinity;
  const wanted = new Set();
  for (const row of pageRows) {
    const rect = row.root.getBoundingClientRect();
    const d = rect.top <= anchor && rect.bottom > anchor ? 0 : Math.abs(rect.top - anchor);
    if (d < distance) { current = row; distance = d; }
    const nearby = rect.bottom > viewport.top - margin && rect.top < viewport.bottom + margin;
    if (nearby) {
      wanted.add(`${state.src}|${state.tgt}|${row.number}`);
      if (!row.loaded) mountPageRow(row);
    } else if (row.loaded) disposePageRow(row);
  }
  if (state.pageNum !== current.number) setCurrentPage(current.number);
  checkpointReadingPosition();
  for (const [key, entry] of translationCache) {
    if (!wanted.has(key) && !entry.complete) { entry.controller.abort(); translationCache.delete(key); }
  }
}
async function goTo(number) {
  if (!state.pdf) return;
  number = clamp(Math.trunc(number) || 1, 1, state.numPages);
  if (readerPdf !== state.pdf || !pageRows.length) {
    setCurrentPage(number); await renderPage();
  }
  const row = pageRows[number - 1];
  if (!row) return;
  setCurrentPage(number);
  const viewport = el.stageWrap.getBoundingClientRect(), rect = row.root.getBoundingClientRect();
  el.stageWrap.scrollTop += rect.top - viewport.top - 20;
  updateVisiblePages();
}
async function renderPage(anchor = null) {
  if (!state.pdf) return;
  if (anchor?.pdf !== state.pdf) anchor = null;
  const token = ++renderToken, pdf = state.pdf, number = anchor?.page || state.pageNum;
  const old = pageRows[number - 1];
  const relative = readerPdf === pdf && old
    ? (el.stageWrap.getBoundingClientRect().top - old.root.getBoundingClientRect().top) / Math.max(old.root.offsetHeight, 1) : 0;
  try {
    const page = await pdf.getPage(number);
    if (token !== renderToken || pdf !== state.pdf) return;
    if (readerPdf !== pdf) pageSizes.clear();
    const base = page.getViewport({ scale: 1 });
    pageSizes.set(number, { width: base.width, height: base.height });
    state.scale = computeScale(base.width); applyChrome();
    for (const row of pageRows) disposePageRow(row);
    readerPdf = pdf;
    pageRows = Array.from({ length: pdf.numPages }, (_, i) => makePageRow(i + 1, pageSizes.get(i + 1) || base));
    el.stage.replaceChildren(...pageRows.map(row => row.root));
    const row = pageRows[number - 1];
    if (anchor) restoreZoomAnchor(anchor);
    else el.stageWrap.scrollTop += row.root.getBoundingClientRect().top - el.stageWrap.getBoundingClientRect().top + relative * row.root.offsetHeight;
    updateVisiblePages();
  } catch (error) {
    if (token === renderToken) toast('Could not render PDF: ' + error.message, 5000);
  }
}
async function mountPageRow(row) {
  row.loaded = true;
  const version = ++row.version, pdf = state.pdf, token = renderToken;
  const valid = () => row.loaded && row.version === version && token === renderToken && pdf === state.pdf;
  try {
    const page = await pdf.getPage(row.number);
    if (!valid()) return;
    const base = page.getViewport({ scale: 1 }); pageSizes.set(row.number, base); sizePageRow(row, base);
    scheduleVisiblePages();
    const viewport = page.getViewport({ scale: state.scale });
    if (state.view !== 'translated') renderOriginal(page, viewport, row, valid).catch(error => {
      if (valid()) toast(`Page ${row.number}: ${error.message}`);
    });
    if (state.view !== 'original') renderTranslation(page, viewport, row, valid);
  } catch (error) { if (valid()) showSheetError('Could not load page: ' + error.message, null, row.sheet); }
}
async function renderOriginal(page, viewport, row, valid) {
  const canvas = row.canvas;
  // Native rendering is the default; enhanced rendering is an optional preference.
  // Keep the existing 16 MP budget and avoid oversized canvas dimensions.
  const nativeDensity = window.devicePixelRatio || 1;
  const density = preferences.get('enhancePdfText') ? Math.max(2, nativeDensity) : nativeDensity;
  const ratio = Math.min(density, Math.sqrt(16000000 / (viewport.width * viewport.height)),
    16384 / viewport.width, 16384 / viewport.height);
  canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
  canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
  // Match the complete viewport to the actual integer bitmap dimensions;
  // otherwise fractional zoom sizes can crop or rescale the last pixels.
  const scaleX = canvas.width / viewport.width, scaleY = canvas.height / viewport.height;
  row.renderTask = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport,
    transform: [scaleX, 0, 0, scaleY, 0, 0] });
  try { await row.renderTask.promise; }
  catch (error) { if (error.name === 'RenderingCancelledException') return; throw error; }
  if (!valid()) return;
  row.textTask = new pdfjsLib.TextLayer({
    textContentSource: page.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
    container: row.textLayer, viewport,
  });
  try { await row.textTask.render(); }
  catch (error) { if (error.name === 'AbortException') return; throw error; }
  if (!valid()) return;
  const end = document.createElement('div'); end.className = 'endOfContent'; row.textLayer.append(end);
}
el.stageWrap.addEventListener('scroll', scheduleVisiblePages, { passive: true });
document.addEventListener('pointerup', () => {
  for (const row of pageRows) row.textLayer.classList.remove('selecting');
});

/* ====================================================================
   Extract paragraphs from a page (for the "translated page")
   ==================================================================== */
async function getBlocks(page) {
  const key = String(page.pageNumber);
  if (blocksCache.has(key)) return blocksCache.get(key);
  const pending = page.getTextContent().then((tc) => buildBlocks(tc.items));
  blocksCache.set(key, pending);
  try { return await pending; }
  catch (e) {
    if (blocksCache.get(key) === pending) blocksCache.delete(key);
    throw e;
  }
}

function buildBlocks(items) {
  // 1) group text runs into lines (keeping the content-stream reading order)
  const lines = [];
  let cur = null;
  for (const it of items) {
    if (!('str' in it)) continue;
    const [a, b, , , x, y] = it.transform;
    const size = Math.hypot(a, b) || it.height || 10;
    if (it.str === '') { if (it.hasEOL) cur = null; continue; }
    if (cur && Math.abs(y - cur.y) < Math.max(cur.size, size) * 0.5 && x >= cur.endX - size * 0.6) {
      const gap = x - cur.endX;
      if (gap > size * 0.18 && !/\s$/.test(cur.text) && !/^\s/.test(it.str)) cur.text += ' ';
      cur.text += it.str; cur.endX = x + it.width; cur.size = Math.max(cur.size, size);
      cur.chars += it.str.length;
    } else {
      cur = { text: it.str, x, y, endX: x + it.width, size, chars: it.str.length };
      lines.push(cur);
    }
    if (it.hasEOL) cur = null;
  }
  const L = lines.map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() })).filter((l) => l.text);
  if (!L.length) return [];

  // 2) body font size = most common size (weighted by characters)
  const hist = new Map();
  for (const l of L) { const k = Math.round(l.size * 2) / 2; hist.set(k, (hist.get(k) || 0) + l.chars); }
  const body = [...hist.entries()].sort((p, q) => q[1] - p[1])[0][0];
  const widths = L.map((l) => l.endX - l.x).sort((p, q) => p - q);
  const ref = widths[Math.floor(widths.length * 0.85)] || widths[widths.length - 1];

  // 3) lines -> paragraphs
  const bullet = /^([•▪●◦‣∙·*]|[-–—]\s|\(?\d{1,3}[.)]\s|\(?[a-zA-Z][.)]\s)/;
  const endsSentence = (s) => /[.!?:;。！？؟)"”»]$/.test(s);
  const paras = [];
  let p = null, prev = null;
  for (const l of L) {
    let split = !p;
    if (p && prev) {
      const gap = prev.y - l.y;
      const lh = Math.max(prev.size, l.size);
      const sizeChange = Math.abs(prev.size - l.size) > lh * 0.12;
      const indent = l.x - prev.x > lh * 0.9 && endsSentence(prev.text);
      const shortPrev = (prev.endX - prev.x) < ref * 0.7 && endsSentence(prev.text);
      split = gap < -lh * 0.3 || gap > lh * 1.75 || sizeChange || indent || shortPrev || bullet.test(l.text);
    }
    if (split) { p = { lines: [l.text], size: l.size, x: l.x }; paras.push(p); }
    else p.lines.push(l.text);
    prev = l;
  }

  // 4) join lines inside each paragraph (de-hyphenate, no spaces for CJK)
  return paras.map((q) => {
    let t = q.lines[0];
    for (let i = 1; i < q.lines.length; i++) {
      const nx = q.lines[i];
      if (/\p{L}-$/u.test(t) && /^\p{Ll}/u.test(nx)) t = t.slice(0, -1) + nx;
      else if (CJK.test(t.slice(-1)) || CJK.test(nx[0])) t += nx;
      else t += ' ' + nx;
    }
    const ratio = q.size / body;
    return { text: t, kind: ratio > 1.45 ? 'h2' : ratio > 1.15 ? 'h3' : 'p', ratio, body };
  });
}

/* ====================================================================
   Translated page pane
   ==================================================================== */
function showSheetLoading(msg, sheet) {
  sheet.dir = 'ltr'; sheet.style.padding = '';
  sheet.innerHTML = `<div class="status"><div class="loading"><span class="spin"></span>${msg}</div><div style="margin-top:22px">${'<div class="skel"></div>'.repeat(9)}</div></div>`;
}
function showSheetError(msg, retry, sheet) {
  sheet.dir = 'ltr';
  sheet.innerHTML = '';
  const d = document.createElement('div'); d.className = 'status';
  d.textContent = msg;
  if (retry) {
    d.append(document.createElement('br'));
    const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Try again'; b.onclick = retry;
    d.append(b);
  }
  sheet.append(d);
}

function splitTranslationText(text) {
  const parts = [];
  while (text.length > 3000) {
    let end = text.lastIndexOf(' ', 3000);
    if (end < 1500) end = 3000;
    if (/[\uD800-\uDBFF]/.test(text[end - 1])) --end;
    parts.push(text.slice(0, end)); text = text.slice(end);
  }
  if (text) parts.push(text);
  return parts;
}

function pageTranslation(page, source, target) {
  const key = `${source}|${target}|${page.pageNumber}`;
  if (translationCache.has(key)) return translationCache.get(key);
  const entry = { blocks: null, translations: [], pending: new Set(), listeners: new Set(), controller: new AbortController() };
  translationCache.set(key, entry);
  const notify = (index) => entry.listeners.forEach((listener) => listener(index));
  entry.promise = (async () => {
    entry.blocks = await getBlocks(page);
    const tasks = [], pieces = new Map();
    entry.blocks.forEach((block, i) => {
      entry.translations[i] = block.text;
      if (hasLetters(block.text)) {
        const parts = splitTranslationText(block.text);
        pieces.set(i, new Array(parts.length)); entry.pending.add(i);
        parts.forEach((text, part) => tasks.push({ text, block: i, part }));
      }
    });
    notify();
    while (tasks.length) {
      if (entry.controller.signal.aborted) throw new DOMException('Translation cancelled', 'AbortError');
      const batch = []; let chars = 0;
      while (tasks.length && batch.length < 8 && chars + tasks[0].text.length <= 16000) {
        const task = tasks.shift(); batch.push(task); chars += task.text.length;
      }
      await callTranslate(batch.map((task) => task.text), source, target, (index, text) => {
        const task = batch[index], parts = pieces.get(task.block);
        parts[task.part] = text;
        if (parts.filter((part) => part !== undefined).length === parts.length) {
          entry.translations[task.block] = parts.join(' ');
          entry.pending.delete(task.block);
          notify(task.block);
        }
      }, entry.controller.signal);
    }
    entry.complete = true;
    return entry;
  })().catch((error) => {
    entry.failed = true;
    if (translationCache.get(key) === entry) translationCache.delete(key);
    throw error;
  });
  return entry;
}

async function renderTranslation(page, viewport, row, valid) {
  const sheet = row.sheet;
  const source = state.src, target = state.tgt;
  showSheetLoading(`Translating page ${page.pageNumber} into ${langName(target)}…`, sheet);
  const entry = pageTranslation(page, source, target);
  let nodes = null;
  const paint = (index) => {
    if (!valid() || !entry.blocks) return;
    if (!entry.blocks.length) {
      showSheetError('No selectable text found on this page. It may be a scanned image — text recognition (OCR) is not included in this app.', null, sheet);
    } else if (!nodes) nodes = paintSheet(entry, viewport.width, sheet);
    else if (index !== undefined) updateParagraph(nodes[index], entry, index);
    else nodes.forEach((node, i) => updateParagraph(node, entry, i));
    scheduleVisiblePages();
  };
  entry.listeners.add(paint);
  row.detach = () => entry.listeners.delete(paint);
  paint();
  try {
    await entry.promise;
    paint();
  } catch (e) {
    if (!valid() || e?.name === 'AbortError') return;
    if (entry.blocks?.length) {
      paint();
      const status = document.createElement('div'); status.className = 'status';
      status.textContent = 'Some paragraphs could not be translated: ' + (e?.message || e);
      const retry = document.createElement('button'); retry.className = 'btn';
      retry.textContent = 'Try again'; retry.onclick = () => renderPage();
      status.append(retry); sheet.append(status);
    } else showSheetError('Translation failed: ' + (e?.message || e), () => renderPage(), sheet);
  } finally { entry.listeners.delete(paint); }
}

function updateParagraph(node, entry, i) {
  const text = entry.pending.has(i)
    ? (entry.failed ? 'Translation unavailable — please retry.' : 'Translating…')
    : entry.translations[i];
  if (node.textContent !== text) node.textContent = text;
  node.setAttribute('aria-busy', String(!entry.failed && entry.pending.has(i)));
}

function paintSheet(entry, pageWidth, sheet) {
  sheet.replaceChildren();
  sheet.dir = isRTL(state.tgt) ? 'rtl' : 'ltr';
  sheet.lang = state.tgt;
  const pad = Math.round(pageWidth * 0.075);
  sheet.style.padding = `${Math.round(pad * 0.9)}px ${pad}px`;
  const body = entry.blocks[0]?.body || 10;
  const basePx = clamp(body * state.scale * 0.95, 12, 26);
  sheet.style.fontSize = basePx * preferences.get('readingSize') / 100 + 'px';
  sheet.style.lineHeight = '1.6';
  return entry.blocks.map((b, i) => {
    const node = document.createElement(b.kind === 'p' ? 'p' : b.kind);
    node.className = 'blk';
    updateParagraph(node, entry, i);
    node.title = b.text.length > 300 ? b.text.slice(0, 300) + '…' : b.text; // hover shows the original
    if (b.kind !== 'p') node.style.fontSize = (b.kind === 'h2' ? 1.5 : 1.2) * (b.ratio > 2 ? 1.15 : 1) + 'em';
    sheet.append(node);
    return node;
  });
}

/* Lightweight reading tools: all data stays in browser storage. */
function libraryBooks() {
  const raw = store.get('books', {});
  const books = Object.assign(Object.create(null), raw && typeof raw === 'object' && !Array.isArray(raw)
    ? Object.fromEntries(Object.entries(raw).filter(([key, name]) => key && typeof name === 'string')) : {});
  // Discover dictionaries saved before the book index existed.
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('pdft.dictionary:')) {
        const id = key.slice('pdft.dictionary:'.length);
        if (!books[id]) books[id] = 'Saved book ' + id.slice(0, 12);
      }
    }
  } catch { /* Current book remains usable if storage is unavailable. */ }
  if (state.bookKey) books[state.bookKey] = state.bookName;
  return books;
}
function registerBook() { store.set('books', libraryBooks()); }
function bookEntries(key) {
  const entries = store.get('dictionary:' + key, []);
  return Array.isArray(entries) ? entries.filter(entry => entry &&
    ['text', 'translation', 'source', 'target'].every(field => typeof entry[field] === 'string')) : [];
}
function filteredDictionary() {
  const books = libraryBooks(), rows = [];
  const all = el.dictionaryScope.value === 'all';
  for (const [bookKey, bookName] of Object.entries(books)) {
    if (!all && bookKey !== state.bookKey) continue;
    for (const entry of bookEntries(bookKey)) rows.push({ entry, bookKey, bookName });
  }
  const language = el.dictionaryLanguageFilter.value || '';
  const languages = [...new Set(rows.flatMap(row => [row.entry.source, row.entry.target]))].sort();
  el.dictionaryLanguageFilter.replaceChildren(new Option('All languages', ''),
    ...languages.map(code => new Option(dictionaryLanguage(code), code)));
  el.dictionaryLanguageFilter.value = languages.includes(language) ? language : '';
  const query = (el.dictionarySearch.value || '').trim().toLocaleLowerCase();
  return rows.filter(({ entry, bookName }) =>
    (!el.dictionaryLanguageFilter.value || [entry.source, entry.target].includes(el.dictionaryLanguageFilter.value)) &&
    [entry.text, entry.translation, entry.context || '', bookName].join(' ').toLocaleLowerCase().includes(query));
}
function persistEntries(key, entries) {
  if (!store.set('dictionary:' + key, entries)) { toast('Could not save changes. Browser storage may be full.', 5000); return false; }
  if (key === state.bookKey) savedEntries = entries;
  return true;
}
function removeLibraryEntry(bookKey, entry) {
  if (persistEntries(bookKey, bookEntries(bookKey).filter(value => dictionaryEntryKey(value) !== dictionaryEntryKey(entry)))) {
    stopPractice(); renderDictionary(); renderPanel();
  }
}
function speakButton(text, language, label) {
  const button = document.createElement('button'); button.className = 'iconBtn';
  button.textContent = '▶ ' + label; button.setAttribute('aria-label', label);
  button.disabled = !preferences.supported();
  button.title = button.disabled ? 'Speech is unavailable in this browser' : label + ' · Voice options in Settings';
  button.onclick = () => preferences.speak(text, language);
  return button;
}
async function selectionContext(text, pdf, pageNumber) {
  try {
    const page = await pdf.getPage(pageNumber);
    if (pdf !== state.pdf) return text;
    const blocks = await getBlocks(page);
    const block = blocks.find(block => block.text.includes(text));
    if (!block) return text;
    const at = block.text.indexOf(text);
    const start = Math.max(0, at - 200), end = Math.min(block.text.length, at + text.length + 200, start + 1200);
    return (start ? '…' : '') + block.text.slice(start, end) + (end < block.text.length ? '…' : '');
  } catch { return text; }
}
function exportLibrary() {
  return { version: 1, books: Object.entries(libraryBooks()).map(([key, name]) => ({
    key, name, entries: bookEntries(key), bookmarks: readBookmarks(key),
  })) };
}
function cleanImportedEntry(entry) {
  if (!entry || !['text', 'translation', 'source', 'target'].every(field => typeof entry[field] === 'string') ||
      !entry.text.trim() || entry.text.length > 20000 || entry.translation.length > 100000 ||
      entry.source.length > 30 || entry.target.length > 30) throw new Error('Invalid dictionary entry.');
  return { text: entry.text, translation: entry.translation, source: entry.source, target: entry.target,
    context: typeof entry.context === 'string' ? entry.context.slice(0, 1200) : '',
    page: Number.isInteger(entry.page) && entry.page > 0 ? entry.page : null,
    savedAt: Number.isFinite(entry.savedAt) ? entry.savedAt : Date.now(),
    remembered: Number.isSafeInteger(entry.remembered) && entry.remembered >= 0 ? entry.remembered : 0,
    forgotten: Number.isSafeInteger(entry.forgotten) && entry.forgotten >= 0 ? entry.forgotten : 0 };
}
function importLibrary(data) {
  if (data?.version !== 1 || !Array.isArray(data.books) || data.books.length > 1000) throw new Error('Unsupported backup format.');
  const books = libraryBooks(), writes = new Map(); let total = 0;
  for (const book of data.books) {
    if (!book || typeof book.key !== 'string' || !book.key || book.key.length > 500 ||
        typeof book.name !== 'string' || book.name.length > 1000 || !Array.isArray(book.entries) ||
        !Array.isArray(book.bookmarks || [])) throw new Error('Invalid book in backup.');
    total += book.entries.length + (book.bookmarks || []).length;
    if (total > 20000) throw new Error('Backup contains too many entries.');
    books[book.key] = book.name;
    const storageKey = 'dictionary:' + book.key;
    const merged = new Map((writes.get(storageKey) || bookEntries(book.key)).map(entry => [dictionaryEntryKey(entry), entry]));
    for (const raw of book.entries) { const entry = cleanImportedEntry(raw); if (!merged.has(dictionaryEntryKey(entry))) merged.set(dictionaryEntryKey(entry), entry); }
    writes.set(storageKey, [...merged.values()]);
    const notesKey = 'bookmarks:' + book.key;
    const notes = new Map((writes.get(notesKey) || readBookmarks(book.key)).map(note => [note.page, note]));
    for (const note of book.bookmarks || []) {
      if (!note || !Number.isInteger(note.page) || note.page < 1 || typeof note.note !== 'string' || note.note.length > 4000) throw new Error('Invalid bookmark.');
      if (!notes.has(note.page)) notes.set(note.page, { page: note.page, note: note.note });
    }
    writes.set(notesKey, [...notes.values()]);
  }
  writes.set('books', books);
  const previous = new Map([...writes.keys()].map(key => [key, store.get(key, null)]));
  for (const [key, value] of writes) {
    if (!store.set(key, value)) {
      for (const [oldKey, oldValue] of previous) store.set(oldKey, oldValue);
      throw new Error('Browser storage is full or unavailable.');
    }
  }
}
function dictionaryCsv(rows) {
  const cell = value => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@\-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return '\uFEFF' + [['Book', 'Source language', 'Original', 'Target language', 'Translation', 'Context', 'Page'],
    ...rows.map(({ entry: e, bookName }) => [bookName, e.source, e.text, e.target, e.translation, e.context, e.page])]
    .map(row => row.map(cell).join(',')).join('\r\n');
}
function downloadFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
let practiceDeck = [], practiceIndex = 0;
function stopPractice() { practiceDeck = []; el.practiceSection.hidden = true; }
function startPractice() {
  practiceDeck = filteredDictionary(); practiceIndex = 0;
  if (!practiceDeck.length) { toast('Save some words or change the filters to start practicing.'); return; }
  // Shuffle a copy; the saved dictionary keeps its order.
  for (let i = practiceDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1)); [practiceDeck[i], practiceDeck[j]] = [practiceDeck[j], practiceDeck[i]];
  }
  el.practiceSection.hidden = false; showPractice();
}
function showPractice() {
  const entry = practiceDeck[practiceIndex].entry;
  el.practiceProgress.textContent = `${practiceIndex + 1} / ${practiceDeck.length} · ${dictionaryLanguage(entry.source)} → ${dictionaryLanguage(entry.target)}`;
  el.practiceWord.textContent = entry.text; el.practiceAnswer.textContent = entry.translation;
  el.practiceWord.lang = entry.source === 'auto' ? '' : entry.source; el.practiceAnswer.lang = entry.target;
  el.practiceAnswer.hidden = true; el.practiceGrade.hidden = true; el.practiceReveal.hidden = false;
}
function gradePractice(remembered) {
  if (!practiceDeck.length || el.practiceAnswer.hidden) return;
  const row = practiceDeck[practiceIndex], field = remembered ? 'remembered' : 'forgotten';
  const entries = bookEntries(row.bookKey).map(entry => dictionaryEntryKey(entry) === dictionaryEntryKey(row.entry)
    ? { ...entry, [field]: (entry[field] || 0) + 1 } : entry);
  if (!persistEntries(row.bookKey, entries)) return;
  if (++practiceIndex === practiceDeck.length) { stopPractice(); renderDictionary(); toast('Practice complete!'); }
  else showPractice();
}
function readBookmarks(key) {
  const notes = store.get('bookmarks:' + key, []);
  return Array.isArray(notes) ? notes.filter(note => note && Number.isInteger(note.page) && note.page > 0 && typeof note.note === 'string') : [];
}
function saveBookmark() {
  if (!state.bookKey) { toast('Open a PDF first.'); return; }
  const notes = readBookmarks(state.bookKey).filter(note => note.page !== state.pageNum);
  notes.push({ page: state.pageNum, note: el.bookmarkNote.value.trim().slice(0, 4000) });
  if (!store.set('bookmarks:' + state.bookKey, notes)) { toast('Could not save bookmark.'); return; }
  registerBook(); el.bookmarkNote.value = ''; renderBookmarks(); toast('Page bookmarked.');
}
function renderBookmarks() {
  el.bookmarkList.replaceChildren(); el.bookmarkBtn.disabled = !state.bookKey;
  for (const note of readBookmarks(state.bookKey).sort((a, b) => a.page - b.page)) {
    const row = document.createElement('div'); row.className = 'bookmarkRow';
    const page = document.createElement('button'); page.className = 'iconBtn'; page.textContent = `Page ${note.page}`;
    page.disabled = note.page > state.numPages;
    page.onclick = () => { goTo(note.page); el.bookmarkNote.value = note.note; };
    const text = document.createElement('p'); text.textContent = note.note; text.dir = 'auto';
    const remove = document.createElement('button'); remove.className = 'iconBtn'; remove.textContent = 'Remove';
    remove.onclick = () => {
      if (store.set('bookmarks:' + state.bookKey, readBookmarks(state.bookKey).filter(value => value.page !== note.page))) renderBookmarks();
      else toast('Could not remove bookmark.');
    };
    row.append(page, text, remove); el.bookmarkList.append(row);
  }
}

/* Saved dictionaries stay on this browser, separately for each PDF fingerprint. */
let savedEntries = [], panelSection = 'selection';
const dictionaryLanguage = (code) => code === 'auto' ? 'Detected language' : langName(code);
const dictionaryEntryKey = (item) => JSON.stringify([item.text.trim(),
  item.detected && item.detected !== 'auto' ? item.detected : item.source, item.target]);

function loadBookDictionary() {
  const entries = store.get('dictionary:' + state.bookKey, []);
  savedEntries = Array.isArray(entries) ? entries.filter((entry) => entry &&
    ['text', 'translation', 'source', 'target'].every((key) => typeof entry[key] === 'string')) : [];
  renderDictionary();
  renderBookmarks();
}

function toggleDictionaryEntry(item) {
  if (!state.bookKey || item.status !== 'ok' || item.bookKey !== state.bookKey) return;
  const key = dictionaryEntryKey(item);
  const existing = savedEntries.some((entry) => dictionaryEntryKey(entry) === key);
  const next = savedEntries.filter((entry) => dictionaryEntryKey(entry) !== key);
  if (!existing) next.unshift({ text: item.text, translation: item.translation,
    source: item.detected && item.detected !== 'auto' ? item.detected : item.source,
    target: item.target, page: item.page, context: preferences.get('saveContext') ? item.context || '' : '', savedAt: Date.now() });
  if (!store.set('dictionary:' + state.bookKey, next)) {
    toast('Could not save the dictionary. Browser storage may be full or unavailable.', 5000);
    return;
  }
  savedEntries = next;
  renderDictionary(); renderPanel();
  toast(existing ? 'Removed from this book’s dictionary' : 'Saved to this book’s dictionary');
}

function renderDictionary() {
  el.dictionaryCount.textContent = savedEntries.length;
  el.dictionaryTab.textContent = `Saved words (${savedEntries.length})`;
  el.dictionaryBook.textContent = state.bookName || '';
  el.dictionaryHint.hidden = savedEntries.length > 0;
  el.dictionaryHint.textContent = state.bookKey
    ? 'Star a translated selection to save it here. Saved words and phrases stay with this book.'
    : 'Open a PDF to see its saved dictionary.';
  el.dictionaryList.replaceChildren();
  const visible = filteredDictionary();
  el.dictionaryHint.hidden = visible.length > 0;
  if (!visible.length && (savedEntries.length || el.dictionaryScope.value === 'all')) el.dictionaryHint.textContent = 'No entries match this view.';
  for (const { entry, bookKey, bookName } of visible) {
    const card = document.createElement('article'); card.className = 'dictionaryCard';
    for (const [language, text] of [[entry.source, entry.text], [entry.target, entry.translation]]) {
      const label = document.createElement('div'); label.className = 'dictionaryLanguage';
      label.textContent = dictionaryLanguage(language);
      const value = document.createElement('p'); value.textContent = text;
      value.dir = language === 'auto' ? 'auto' : isRTL(language) ? 'rtl' : 'ltr';
      if (language !== 'auto') value.lang = language;
      card.append(label, value);
    }
    if (entry.remembered || entry.forgotten) {
      const progress = document.createElement('div'); progress.className = 'dictionaryLanguage';
      progress.textContent = `Practice: ${entry.remembered || 0} remembered · ${entry.forgotten || 0} forgotten`; card.append(progress);
    }
    if (entry.context) {
      const context = document.createElement('p'); context.className = 'dictionaryContext';
      context.textContent = entry.context; context.dir = 'auto'; card.append(context);
    }
    if (el.dictionaryScope.value === 'all') {
      const name = document.createElement('div'); name.className = 'dictionaryLanguage';
      name.textContent = bookName + (bookKey === state.bookKey ? '' : ' · Open this PDF to visit its pages'); card.append(name);
    }
    const footer = document.createElement('div'); footer.className = 'dictionaryFooter';
    if (bookKey === state.bookKey && Number.isInteger(entry.page) && entry.page > 0 && entry.page <= state.numPages) {
      const page = document.createElement('button'); page.className = 'iconBtn';
      page.textContent = `Page ${entry.page}`; page.title = 'Go to the original page';
      page.onclick = () => goTo(entry.page); footer.append(page);
    }
    const remove = document.createElement('button'); remove.className = 'iconBtn';
    remove.textContent = '★ Remove'; remove.setAttribute('aria-label', `Remove ${entry.text} from dictionary`);
    remove.onclick = () => removeLibraryEntry(bookKey, entry);
    const copy = document.createElement('button'); copy.className = 'iconBtn'; copy.textContent = 'Copy';
    copy.onclick = () => preferences.copy(entry);
    footer.append(remove, copy); card.append(footer);
    const voices = document.createElement('div'); voices.className = 'dictionaryFooter';
    voices.append(speakButton(entry.text, entry.source, 'Hear original'), speakButton(entry.translation, entry.target, 'Hear translation'));
    card.append(voices); el.dictionaryList.append(card);
  }
}

function showPanelSection(section) {
  panelSection = section;
  el.selectionSection.hidden = section !== 'selection';
  el.dictionarySection.hidden = section !== 'dictionary';
  el.selectionTab.setAttribute('aria-pressed', String(section === 'selection'));
  el.dictionaryTab.setAttribute('aria-pressed', String(section === 'dictionary'));
  el.panelTitle.textContent = section === 'selection' ? 'Selection translator' : 'Book dictionary';
  el.clearHistory.hidden = section !== 'selection' || !history.length;
}

/* ====================================================================
   Selection translator (side panel)
   ==================================================================== */
const history = [];
let selToken = 0, lastSelKey = '', selectedPage = 1;
const selectionResults = new Map();
const selectionKey = (text, pageNumber = state.pageNum) => JSON.stringify([text, state.src, state.tgt, pageNumber]);

function readSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return '';
  const node = sel.anchorNode;
  const layer = (node?.nodeType === 3 ? node.parentNode : node)?.closest?.('.textLayer');
  if (!layer || !el.stage.contains(layer)) return '';
  selectedPage = Number(layer.dataset.page);
  return normalizeSelection(sel.toString());
}
function normalizeSelection(s) {
  return s.replace(/­/g, '')
    .replace(/(\p{L})-\s*\n\s*(\p{Ll})/gu, '$1$2')       // de-hyphenate across lines
    .replace(/\s*\n\s*/g, ' ').replace(/[ \t ]+/g, ' ').trim();
}

function maybeTranslateSelection(force = false) {
  updateSelectionControls();
  if (document.querySelector('dialog[open]')) return;
  if (((!state.panel || state.panelSize === 'minimized') && !preferences.get('translationPopup')) || (!preferences.get('autoTranslateSelection') && !force)) return;
  const text = readSelection();
  if (!text) { lastSelKey = ''; if (force) toast('Highlight text in the PDF first.'); return; }
  if (!force && selectionKey(text.slice(0, 5000), selectedPage) === lastSelKey) return;
  if (text.length > 5000) { toast('Selection is long — only the first 5000 characters are translated.'); }
  translateSelection(text.slice(0, 5000), force, selectedPage);
}
const onSelectionEvent = event => {
  if (event?.target?.closest?.('.floatingTranslate, .showToolbar')) { updateSelectionControls(); return; }
  setTimeout(maybeTranslateSelection, 30);
};
document.addEventListener('mouseup', onSelectionEvent);
document.addEventListener('touchend', onSelectionEvent);
document.addEventListener('keyup', (e) => { if (e.shiftKey || e.key === 'Shift') onSelectionEvent(); });
// also catches selection made via long-press / handles on touch screens
document.addEventListener('selectionchange', updateSelectionControls);
document.addEventListener('selectionchange', debounce(() => { if (!mouseDown) maybeTranslateSelection(); }, 450));
let mouseDown = false;
document.addEventListener('mousedown', () => { mouseDown = true; });
document.addEventListener('mouseup', () => { mouseDown = false; });

function cardMarkup(item, current) {
  const card = document.createElement('div');
  card.className = 'card' + (current ? ' current' : '');
  const meta = document.createElement('div'); meta.className = 'cardMeta';
  const chip = document.createElement('span'); chip.className = 'chip';
  chip.textContent = item.status === 'ok' ? `${langName(item.detected || item.source)} → ${langName(item.target)}` : langName(item.target);
  const grow = document.createElement('span'); grow.className = 'grow';
  meta.append(chip, grow);
  if (item.status === 'ok') {
    const copy = document.createElement('button'); copy.className = 'iconBtn'; copy.textContent = 'Copy';
    copy.onclick = () => preferences.copy(item);
    const star = document.createElement('button'); star.className = 'iconBtn starBtn';
    const saved = savedEntries.some((entry) => dictionaryEntryKey(entry) === dictionaryEntryKey(item));
    star.textContent = saved ? '★' : '☆';
    star.setAttribute('aria-pressed', String(saved));
    star.title = saved ? 'Remove from this book’s dictionary' : 'Save to this book’s dictionary';
    star.setAttribute('aria-label', star.title);
    star.onclick = () => toggleDictionaryEntry(item);
    meta.append(star, copy, speakButton(item.text, item.detected && item.detected !== 'auto' ? item.detected : item.source, 'Hear original'),
      speakButton(item.translation, item.target, 'Hear translation'));
  }
  const orig = document.createElement('div'); orig.className = 'orig'; orig.textContent = item.text; orig.title = 'Click to expand';
  orig.onclick = () => orig.classList.toggle('open');
  const trans = document.createElement('div'); trans.className = 'trans';
  if (item.status === 'loading') {
    trans.className = 'loading'; trans.innerHTML = '<span class="spin"></span> Translating…';
  } else if (item.status === 'error') {
    card.classList.add('err'); trans.textContent = item.error;
    const retry = document.createElement('button'); retry.className = 'iconBtn'; retry.textContent = 'Retry';
    retry.onclick = () => translateSelection(item.text, true, item.page);
    meta.append(retry);
  } else {
    trans.textContent = item.translation;
    trans.dir = isRTL(item.target) ? 'rtl' : 'ltr';
    trans.lang = item.target;
  }
  card.append(meta, orig, trans);
  return card;
}

let current = null, renderedSelection = null, renderedSelectionStatus = '';
function renderPanel() {
  translationPopup.update(current, (!state.panel || state.panelSize === 'minimized') && preferences.get('translationPopup'));
  el.selHint.hidden = !!current || history.length > 0;
  el.selCurrent.replaceChildren();
  if (current) {
    const card = cardMarkup(current, true);
    if (current.status === 'ok' && (current !== renderedSelection || renderedSelectionStatus !== 'ok')) card.classList.add('translationArrives');
    el.selCurrent.append(card);
  }
  renderedSelection = current; renderedSelectionStatus = current?.status || '';
  el.selHistory.replaceChildren();
  if (history.length) {
    const t = document.createElement('div'); t.className = 'histTitle'; t.textContent = 'Earlier';
    el.selHistory.append(t);
    for (const h of history) el.selHistory.append(cardMarkup(h, false));
  }
  el.clearHistory.hidden = panelSection !== 'selection' || !history.length;
}

async function translateSelection(text, force = false, pageNumber = state.pageNum) {
  if (!force && selectionKey(text.slice(0, 5000), pageNumber) === lastSelKey) return;
  if (current?.status === 'loading' && current.requestToken === selToken && current.text === text
    && current.page === pageNumber && current.bookKey === state.bookKey && current.source === state.src && current.target === state.tgt) return;
  lastSelKey = selectionKey(text, pageNumber);
  const token = ++selToken;
  const cacheKey = JSON.stringify([state.bookKey, text, state.src, state.tgt, pageNumber]);
  const cached = selectionResults.get(cacheKey);
  if (preferences.get('autoSpeech') !== 'off') preferences.stop();
  if (current && current.status === 'ok' && current.text !== text) {
    history.unshift(current); history.splice(preferences.get('historyLimit'));
  }
  const item = { text, source: state.src, target: state.tgt, bookKey: state.bookKey, page: pageNumber, requestToken: token,
    ...(cached || { status: 'loading' }) };
  current = item; renderPanel();
  el.selPanel.querySelector('.panelBody').scrollTop = 0;
  if (cached) { preferences.autoSpeak(item); return; }
  try {
    const [data, context] = await Promise.all([
      callTranslate([text], state.src, state.tgt), preferences.get('saveContext') ? selectionContext(text, state.pdf, pageNumber) : Promise.resolve(''),
    ]);
    const result = { context, status: 'ok', translation: data.translations[0] || '', detected: data.detected?.[0] };
    selectionResults.set(cacheKey, result);
    if (selectionResults.size > 200) selectionResults.delete(selectionResults.keys().next().value);
    if (token !== selToken) return;
    Object.assign(item, result);
    preferences.autoSpeak(item);
  } catch (e) {
    if (token !== selToken) return;
    Object.assign(item, { status: 'error', error: e?.message || String(e) });
  }
  renderPanel();
}

el.dictionarySearch.oninput = () => { stopPractice(); renderDictionary(); };
el.dictionaryScope.onchange = () => { stopPractice(); renderDictionary(); };
el.dictionaryLanguageFilter.onchange = () => { stopPractice(); renderDictionary(); };
el.exportJson.onclick = () => downloadFile('pdf-dictionaries.json', JSON.stringify(exportLibrary(), null, 2), 'application/json');
el.exportCsv.onclick = () => downloadFile('dictionary.csv', dictionaryCsv(filteredDictionary()), 'text/csv;charset=utf-8');
el.importBtn.onclick = () => el.importFile.click();
el.importFile.onchange = async () => {
  const file = el.importFile.files[0]; el.importFile.value = '';
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('Backup must be smaller than 5 MB.');
    importLibrary(JSON.parse(await file.text()));
    stopPractice(); loadBookDictionary(); toast('Backup imported. Existing entries were kept.');
  } catch (error) { toast('Import failed: ' + error.message, 5000); }
};
el.practiceBtn.onclick = startPractice;
el.practiceReveal.onclick = () => { el.practiceAnswer.hidden = false; el.practiceGrade.hidden = false; el.practiceReveal.hidden = true; };
el.practiceAgain.onclick = () => gradePractice(false);
el.practiceRemembered.onclick = () => gradePractice(true);
el.practiceClose.onclick = stopPractice;
el.bookmarkBtn.onclick = saveBookmark;

const savedFloatingPosition = store.get('floatingTranslatePosition', null);
let floatingPosition = savedFloatingPosition && Number.isFinite(savedFloatingPosition.x) && Number.isFinite(savedFloatingPosition.y)
  ? { x: clamp(savedFloatingPosition.x, 0, 1), y: clamp(savedFloatingPosition.y, 0, 1) } : { x: 1, y: 1 };
let floatingGesture = null;
function floatingBounds() {
  const minimized = state.panel && state.panelSize === 'minimized';
  const mobile = window.innerWidth <= 760;
  const rightDock = minimized && !mobile ? 58 : 0, bottomDock = minimized && mobile ? 46 : 0;
  return { x: Math.max(16, window.innerWidth - 64 - rightDock), y: Math.max(16, window.innerHeight - 64 - bottomDock) };
}
function positionFloatingTranslate() {
  const bounds = floatingBounds();
  let left = 16 + floatingPosition.x * (bounds.x - 16), top = 16 + floatingPosition.y * (bounds.y - 16);
  const popup = el.translationPopupRoot?.hidden === false ? el.translationPopupRoot.getBoundingClientRect?.() : null;
  if (popup && !floatingGesture?.moved) {
    const overlaps = (x, y) => x < popup.right + 8 && x + 48 > popup.left - 8 && y < popup.bottom + 8 && y + 48 > popup.top - 8;
    if (overlaps(left, top)) {
      const candidates = [{ x: left, y: popup.top - 60 }, { x: left, y: popup.bottom + 12 },
        { x: popup.left - 60, y: top }, { x: popup.right + 12, y: top }]
        .filter(point => point.x >= 16 && point.x <= bounds.x && point.y >= 16 && point.y <= bounds.y && !overlaps(point.x, point.y))
        .sort((a, b) => Math.hypot(a.x - left, a.y - top) - Math.hypot(b.x - left, b.y - top));
      if (candidates.length) { left = candidates[0].x; top = candidates[0].y; }
    }
  }
  el.floatingTranslate.style.left = left + 'px';
  el.floatingTranslate.style.top = top + 'px';
  el.floatingTranslate.style.right = 'auto'; el.floatingTranslate.style.bottom = 'auto';
}
function moveFloatingTranslate(x, y) {
  const bounds = floatingBounds(), left = clamp(x, 16, bounds.x), top = clamp(y, 16, bounds.y);
  floatingPosition = { x: bounds.x > 16 ? (left - 16) / (bounds.x - 16) : 1,
    y: bounds.y > 16 ? (top - 16) / (bounds.y - 16) : 1 };
  positionFloatingTranslate();
}
function bindMovableControl(button, { move, save, click, position, onDragging = () => {}, longPress = false }) {
  let gesture = null, suppressClick = false, hintTimer = null, hideHintTimer = null;
  const clearHintTimer = () => { clearTimeout(hintTimer); hintTimer = null; };
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault(); suppressClick = false;
    clearHintTimer(); clearTimeout(hideHintTimer); button.classList.remove('showHint');
    if (event.pointerType === 'touch') button.classList.remove('hoverHint');
    const rect = button.getBoundingClientRect();
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false, held: false };
    button.setPointerCapture(event.pointerId);
    if (longPress) hintTimer = setTimeout(() => {
      if (gesture && !gesture.moved) { gesture.held = true; button.classList.add('showHint'); }
    }, 550);
  });
  button.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (!gesture.moved && Math.hypot(dx, dy) < 6) return;
    gesture.moved = true; clearHintTimer(); button.classList.remove('showHint'); button.classList.remove('hoverHint');
    onDragging(true); button.classList.add('isDragging');
    move(gesture.left + dx, gesture.top + dy);
  });
  function finish(event) {
    if (!gesture || event.pointerId !== gesture.id) return;
    clearHintTimer(); suppressClick = gesture.moved || gesture.held || event.type !== 'pointerup';
    if (gesture.moved) save();
    if (gesture.held) hideHintTimer = setTimeout(() => button.classList.remove('showHint'), 1800);
    gesture = null; onDragging(false); button.classList.remove('isDragging');
    if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
    position();
  }
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, finish);
  button.addEventListener('contextmenu', event => event.preventDefault());
  if (longPress) {
    button.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') button.classList.add('hoverHint'); });
    button.addEventListener('pointerleave', () => button.classList.remove('hoverHint'));
  }
  button.onclick = event => {
    if (suppressClick && event.detail !== 0) { suppressClick = false; event.preventDefault(); return; }
    suppressClick = false; click();
  };
  button.addEventListener('keydown', event => {
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = directions[event.key]; if (!direction) return;
    event.preventDefault(); event.stopPropagation();
    const rect = button.getBoundingClientRect(), step = event.shiftKey ? 40 : 12;
    move(rect.left + direction[0] * step, rect.top + direction[1] * step); save();
  });
}
bindMovableControl(el.floatingTranslate, {
  move: moveFloatingTranslate, position: positionFloatingTranslate,
  save: () => store.set('floatingTranslatePosition', floatingPosition),
  click: () => translateWithShortcut(), onDragging: moved => { floatingGesture = moved ? { moved: true } : null; },
});
window.addEventListener('resize', positionFloatingTranslate);

for (const button of [el.translateSelected, el.translatePopupSelected]) {
  // Preserve the PDF highlight when a pointer clicks a translation control.
  // Keyboard activation keeps its normal focus behavior.
  button.addEventListener('pointerdown', event => {
    if (event.button === 0) event.preventDefault();
  });
  button.onclick = () => maybeTranslateSelection(true);
}
const savedMenuPosition = store.get('showToolbarPosition', null);
let menuPosition = savedMenuPosition && Number.isFinite(savedMenuPosition.x) && Number.isFinite(savedMenuPosition.y)
  ? { x: clamp(savedMenuPosition.x, 0, 1), y: clamp(savedMenuPosition.y, 0, 1) } : { x: 0, y: 0 };
function positionMenuControl() {
  const maxX = Math.max(16, window.innerWidth - 64), maxY = Math.max(16, window.innerHeight - 64);
  const left = 16 + menuPosition.x * (maxX - 16), top = 16 + menuPosition.y * (maxY - 16);
  el.showToolbar.style.left = left + 'px'; el.showToolbar.style.top = top + 'px';
  el.showToolbar.classList.toggle('tooltipLeft', left + 190 > window.innerWidth);
}
function moveMenuControl(x, y) {
  const maxX = Math.max(16, window.innerWidth - 64), maxY = Math.max(16, window.innerHeight - 64);
  menuPosition = { x: maxX > 16 ? (clamp(x, 16, maxX) - 16) / (maxX - 16) : 0,
    y: maxY > 16 ? (clamp(y, 16, maxY) - 16) / (maxY - 16) : 0 };
  positionMenuControl();
}
bindMovableControl(el.showToolbar, {
  move: moveMenuControl, position: positionMenuControl,
  save: () => store.set('showToolbarPosition', menuPosition), click: () => setToolbarVisible(true), longPress: true,
});
window.addEventListener('resize', positionMenuControl);

el.selectionTab.onclick = () => showPanelSection('selection');
el.dictionaryTab.onclick = () => showPanelSection('dictionary');
el.dictionaryBtn.onclick = () => {
  state.panel = true; if (state.panelSize === 'minimized') state.panelSize = 'normal'; store.set('panel', true); applyChrome();
  showPanelSection('dictionary');
  refitReaderAfterLayout();
};

el.clearHistory.onclick = () => { history.length = 0; renderPanel(); };

/* ====================================================================
   Wiring
   ==================================================================== */
enableOutsideDismiss(el.libraryDialog);
el.hideToolbar.onclick = () => setToolbarVisible(false);
el.openBtn.onclick = el.emptyOpen.onclick = () => el.fileInput.click();
el.fileInput.onchange = () => { openFile(el.fileInput.files[0]); el.fileInput.value = ''; };

el.prevBtn.onclick = () => goTo(state.pageNum - 1);
el.nextBtn.onclick = () => goTo(state.pageNum + 1);
el.pageInput.onchange = () => goTo(parseInt(el.pageInput.value, 10) || 1);

let wheelZoomTimer = null, wheelZoomTarget = null, wheelZoomAnchor = null, wheelZoomPdf = null;
function cancelWheelZoom() {
  clearTimeout(wheelZoomTimer); wheelZoomTimer = null; wheelZoomTarget = null; wheelZoomAnchor = null; wheelZoomPdf = null;
}
function setZoom(z, anchor = null) {
  cancelWheelZoom();
  state.zoom = typeof z === 'number' ? clamp(z, 0.2, 6) : z;
  store.set('zoom', state.zoom); return renderPage(anchor);
}
function flushWheelZoom() {
  wheelZoomTimer = null;
  if (wheelZoomTarget === null) return;
  const zoom = wheelZoomTarget, anchor = wheelZoomAnchor, pdf = wheelZoomPdf;
  wheelZoomTarget = null; wheelZoomAnchor = null; wheelZoomPdf = null;
  if (!state.pdf || pdf !== state.pdf) return;
  if (zoom !== state.scale) setZoom(zoom, anchor);
  // Bound expensive PDF renders during high-frequency mouse/trackpad input.
  wheelZoomTimer = setTimeout(flushWheelZoom, 80);
}
function zoomWithWheel(event) {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !state.pdf
    || readerPdf !== state.pdf || !pageRows.length || !event.deltaY || document.querySelector('dialog[open]')) return;
  event.preventDefault();
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.stageWrap.clientHeight : 1;
  const delta = clamp(event.deltaY * unit, -240, 240);
  const scale = wheelZoomTarget ?? (typeof state.zoom === 'number' ? state.zoom : state.scale);
  wheelZoomTarget = clamp(Math.round(scale * Math.exp(-delta * 0.0012) * 1000) / 1000, 0.2, 6);
  wheelZoomAnchor = captureZoomAnchor(event); wheelZoomPdf = state.pdf;
  if (wheelZoomTimer === null) flushWheelZoom();
}
el.stageWrap.addEventListener('wheel', zoomWithWheel, { passive: false });
el.zoomIn.onclick = () => setZoom(Math.round((state.scale + 0.15) * 100) / 100);
el.zoomOut.onclick = () => setZoom(Math.max(0.2, Math.round((state.scale - 0.15) * 100) / 100));
el.zoomFit.onclick = () => setZoom('fit');

el.viewSeg.onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  state.view = b.dataset.view; store.set('view', state.view);
  applyChrome(); renderPage();
};
el.panelMinimize.onclick = () => setPanelSize(state.panelSize === 'minimized' ? 'normal' : 'minimized');
el.panelMaximize.onclick = () => setPanelSize(state.panelSize === 'maximized' ? 'normal' : 'maximized');
el.panelToggle.onclick = () => {
  state.panel = !state.panel;
  if (state.panel && state.panelSize === 'minimized') state.panelSize = 'normal';
  store.set('panel', state.panel); applyChrome();
  refitReaderAfterLayout();
};

function languagesChanged() {
  store.set('src', state.src); store.set('tgt', state.tgt);
  if (state.pdf) renderPage();
  translationPopup.dismiss();
  if (preferences.get('autoTranslateSelection') && current && (state.panel || preferences.get('translationPopup'))) translateSelection(current.text, true, current.page);
  else { ++selToken; lastSelKey = ''; }
}
el.srcLang.onchange = () => { state.src = el.srcLang.value; languagesChanged(); };
el.tgtLang.onchange = () => { state.tgt = el.tgtLang.value; languagesChanged(); };
el.swapLang.onclick = () => {
  if (state.src === 'auto') { toast('Pick a specific source language first to swap.'); return; }
  [state.src, state.tgt] = [state.tgt, state.src];
  el.srcLang.value = state.src; el.tgtLang.value = state.tgt; languagesChanged();
};

function translateWithShortcut() {
  if (!readSelection()) { toast('Highlight text in the PDF first.'); return; }
  const openPanel = (!state.panel || state.panelSize === 'minimized') && !preferences.get('translationPopup');
  if (openPanel) {
    state.panel = true; state.panelSize = 'normal'; store.set('panel', true); applyChrome();
  }
  if (state.panel && state.panelSize !== 'minimized') showPanelSection('selection');
  maybeTranslateSelection(true);
  if (openPanel) refitReaderAfterLayout();
}

// keyboard
document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); el.fileInput.click(); return; }
  if (!state.pdf) return;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
  if (matchesTranslationShortcut(e, preferences.get('translationShortcut'))) { e.preventDefault(); translateWithShortcut(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.activeElement?.closest?.('#translationPopup')) return;
  if (e.key === 'PageDown' || e.key === 'PageUp') {
    e.preventDefault(); el.stageWrap.scrollBy({ top: el.stageWrap.clientHeight * 0.9 * (e.key === 'PageDown' ? 1 : -1) });
  }
  else if (e.key === 'ArrowRight') { e.preventDefault(); goTo(state.pageNum + 1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(state.pageNum - 1); }
  else if (e.key === 'Home') { goTo(1); }
  else if (e.key === 'End') { goTo(state.numPages); }
  else if (e.key === '+' || e.key === '=') el.zoomIn.click();
  else if (e.key === '-') el.zoomOut.click();
});

window.addEventListener('pagehide', checkpointReadingPosition);

// refit on resize
window.addEventListener('resize', debounce(() => { refitReaderAfterLayout(); }, 200));

if (typeof window.ResizeObserver === 'function') {
  let readerWidth = el.stageWrap.clientWidth;
  new window.ResizeObserver(debounce(() => {
    const width = el.stageWrap.clientWidth, widthChanged = Math.abs(width - readerWidth) > 0.5;
    readerWidth = width;
    if (!state.pdf) return;
    if (widthChanged && state.zoom === 'fit') renderPage(); else scheduleVisiblePages();
  }, 200)).observe(el.stageWrap);
}

// Moving between monitors can change pixel density without resizing the window.
function watchDisplayDensity() {
  if (!window.matchMedia) return;
  const query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  query.addEventListener('change', () => {
    watchDisplayDensity();
    if (state.pdf) renderPage();
  }, { once: true });
}
watchDisplayDensity();

// drag & drop
let dragDepth = 0;
const isFileDrag = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => { if (!isFileDrag(e)) return; e.preventDefault(); dragDepth++; el.dropOverlay.hidden = false; document.body.classList.add('dragging'); });
window.addEventListener('dragover', (e) => { if (isFileDrag(e)) e.preventDefault(); });
window.addEventListener('dragleave', (e) => { if (!isFileDrag(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) { el.dropOverlay.hidden = true; document.body.classList.remove('dragging'); } });
window.addEventListener('drop', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault(); dragDepth = 0; el.dropOverlay.hidden = true; document.body.classList.remove('dragging');
  openFile(e.dataTransfer.files[0]);
});

applyChrome();
renderPanel();
renderDictionary();
renderBookmarks();

// Restore only an explicit reload, so fresh tabs (including duplicated tabs) start clean.
async function restoreReaderOnReload() {
  const navigation = window.performance?.getEntriesByType?.('navigation')?.[0];
  if (!preferences.get('restoreOnReload') || navigation?.type !== 'reload') { library.clearReadingSession?.(); return; }
  const token = fileLoadToken;
  const saved = await library.restoreReadingSession();
  if (!saved || fileLoadToken !== token || state.pdf) return;
  await openFile(saved.file, saved);
}
restoreReaderOnReload().catch(() => toast('Could not restore the last PDF. Choose a file to continue.'));

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/app.js', 'utf8').replace(/^import .*;\n/gm, '');
class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.attributes = {}; this.style = {};
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.textContent = ''; this.hidden = false;
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener() {}
  querySelectorAll() { return []; }
  querySelector() { return this; }
}
const saved = new Map();
let denyWrites = false;
function boot() {
  const elements = new Map(), messages = [];
  const context = vm.createContext({
    console, TextDecoder, AbortController, DOMException, Uint8Array,
    setTimeout: () => 1, clearTimeout() {}, Option: Element,
    localStorage: {
      getItem: key => saved.get(key) ?? null,
      get length() { return saved.size; }, key: index => [...saved.keys()][index],
      setItem: (key, value) => { if (denyWrites) throw Error('storage full'); saved.set(key, value); },
    },
    document: {
      getElementById: id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
      createElement: tag => new Element(tag), addEventListener() {},
    },
    window: { addEventListener() {} },
    pdfjsLib: { GlobalWorkerOptions: {} },
    createTranslationPopup: () => ({ update() {}, dismiss() {}, configure() {} }),
    createLibrary: () => ({ remember() {} }),
    createPreferences: () => ({
      get: key => ({ saveContext: true, rememberRecentFiles: true, rememberPosition: true, readingSize: 100,
        historyLimit: 30, autoSpeech: 'off', autoTranslateSelection: true })[key],
      stop() {}, autoSpeak() {}, copy() {},
      supported: () => 'speechSynthesis' in context.window,
      speak: (text, lang) => { const speech = new context.SpeechSynthesisUtterance(text); speech.lang = lang; context.window.speechSynthesis.speak(speech); },
    }),
  });
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  run('toast = (message) => testMessages.push(message)');
  context.testMessages = messages;
  return { context, run, elements, messages };
}
const app = boot();
app.run("state.bookKey = 'book-a'; state.bookName = 'Book A.pdf'; state.numPages = 20; loadBookDictionary()");
app.context.item = { text: 'hello', translation: 'مرحبا', source: 'auto', detected: 'en', target: 'ar',
  bookKey: 'book-a', page: 3, status: 'ok' };
let card = app.context.cardMarkup(app.context.item, true);
let star = card.children[0].children.find(node => node.className === 'iconBtn starBtn');
assert.equal(star.textContent, '☆');
star.onclick();
assert.equal(app.run('savedEntries.length'), 1);
assert.equal(app.run('savedEntries[0].source'), 'en');
assert.equal(app.elements.get('dictionaryCount').textContent, 1);
const row = app.elements.get('dictionaryList').children[0];
assert.equal(row.children[0].textContent, 'English');
assert.equal(row.children[1].textContent, 'hello');
assert.equal(row.children[2].textContent, 'Arabic');
assert.equal(row.children[3].textContent, 'مرحبا');
assert.equal(row.children[3].dir, 'rtl');
assert.equal(row.children[3].lang, 'ar');
card = app.context.cardMarkup(app.context.item, true);
star = card.children[0].children.find(node => node.className === 'iconBtn starBtn');
assert.equal(star.attributes['aria-pressed'], 'true');
app.context.goTo = page => { app.context.visited = page; };
row.children[4].children[0].onclick();
assert.equal(app.context.visited, 3);
app.elements.get('dictionaryBtn').onclick();
assert.equal(app.elements.get('dictionarySection').hidden, false);
assert.equal(app.elements.get('selectionSection').hidden, true);
app.elements.get('selectionTab').onclick();
assert.equal(app.elements.get('selectionSection').hidden, false);

// Separate book, same words: no leakage, including stale selection callbacks.
app.run("state.bookKey = 'book-b'; loadBookDictionary()");
assert.equal(app.run('savedEntries.length'), 0);
app.context.toggleDictionaryEntry(app.context.item);
assert.equal(app.run('savedEntries.length'), 0);
app.context.toggleDictionaryEntry({ ...app.context.item, bookKey: 'book-b' });
assert.equal(app.run('savedEntries.length'), 1);

// Reload restores Book A independently of Book B and current toolbar languages.
const reopened = boot();
reopened.run("state.bookKey = 'book-a'; state.bookName = 'Renamed.pdf'; state.numPages = 20; state.tgt = 'fr'; loadBookDictionary()");
assert.equal(reopened.run('savedEntries.length'), 1);
assert.equal(reopened.run('savedEntries[0].target'), 'ar');
assert.equal(reopened.elements.get('dictionaryBook').textContent, 'Renamed.pdf');
// Different translations of a word can be saved for different target languages.
reopened.context.toggleDictionaryEntry({ ...app.context.item, target: 'fr', translation: 'bonjour' });
assert.equal(reopened.run('savedEntries.length'), 2);
// Storage failure leaves the saved list intact and reports failure.
denyWrites = true;
reopened.context.toggleDictionaryEntry(app.context.item);
assert.equal(reopened.run('savedEntries.length'), 2);
assert.match(reopened.messages.at(-1), /Could not save/);
denyWrites = false;
// Remove from the dictionary and verify persistence in a fresh session.
reopened.elements.get('dictionaryList').children[1].children[4].children[1].onclick();
assert.equal(reopened.run('savedEntries.length'), 1);
const afterRemoval = boot();
afterRemoval.run("state.bookKey = 'book-a'; loadBookDictionary()");
assert.equal(afterRemoval.run('savedEntries.length'), 1);
assert.equal(afterRemoval.run('savedEntries[0].target'), 'fr');
// Search works across original, translated text, context, language, and books.
const tools = boot();
tools.run("state.bookKey = 'tools-a'; state.bookName = 'Learning.pdf'; state.numPages = 10; state.pageNum = 2; registerBook(); loadBookDictionary()");
tools.context.toggleDictionaryEntry({ ...app.context.item, bookKey: 'tools-a', context: 'A friendly greeting.', page: 2 });
tools.elements.get('dictionarySearch').value = 'friendly';
assert.equal(tools.context.filteredDictionary().length, 1);
tools.elements.get('dictionarySearch').value = 'absent';
assert.equal(tools.context.filteredDictionary().length, 0);
tools.elements.get('dictionarySearch').value = '';
tools.elements.get('dictionaryLanguageFilter').value = 'ar';
assert.equal(tools.context.filteredDictionary().length, 1);
tools.elements.get('dictionaryScope').value = 'all';
assert.ok(tools.context.filteredDictionary().length >= 2);
tools.elements.get('dictionaryScope').value = 'book';
// Practice requires revealing, keeps progress, and does not alter the dictionary text.
tools.context.startPractice();
assert.equal(tools.elements.get('practiceAnswer').hidden, true);
tools.context.gradePractice(true);
assert.equal(tools.run('savedEntries[0].remembered'), undefined);
tools.elements.get('practiceReveal').onclick();
assert.equal(tools.elements.get('practiceAnswer').textContent, 'مرحبا');
tools.elements.get('practiceRemembered').onclick();
assert.equal(tools.run('savedEntries[0].remembered'), 1);
assert.equal(tools.elements.get('practiceSection').hidden, true);
// Notes upsert by page and survive dictionary exports.
tools.elements.get('bookmarkNote').value = 'Read this again.';
tools.context.saveBookmark();
assert.equal(tools.context.readBookmarks('tools-a')[0].note, 'Read this again.');
tools.elements.get('bookmarkNote').value = 'Updated note';
tools.context.saveBookmark();
assert.equal(tools.context.readBookmarks('tools-a').length, 1);
const backup = JSON.parse(JSON.stringify(tools.context.exportLibrary()));
const before = saved.size;
tools.context.importLibrary(backup);
const afterFirstImport = saved.size;
tools.context.importLibrary(backup);
assert.equal(saved.size, afterFirstImport);
assert.equal(tools.context.bookEntries('tools-a').length, 1);
assert.equal(tools.context.readBookmarks('tools-a')[0].note, 'Updated note');
// Reject malformed backup before making any changes.
const snapshot = JSON.stringify([...saved]);
assert.throws(() => tools.context.importLibrary({ version: 1, books: [
  { key: 'new', name: 'New', entries: [], bookmarks: [] },
  { key: 'bad', name: 'Bad', entries: [{ text: 42 }], bookmarks: [] },
] }), /Invalid dictionary entry/);
assert.equal(JSON.stringify([...saved]), snapshot);
// A backup can populate another book without a PDF being open.
tools.context.importLibrary({ version: 1, books: [{ key: 'imported', name: 'Imported book',
  entries: [{ text: 'bonjour', translation: 'hello', source: 'fr', target: 'en' }], bookmarks: [] }] });
tools.elements.get('dictionaryScope').value = 'all';
tools.elements.get('dictionaryLanguageFilter').value = '';
tools.elements.get('dictionarySearch').value = 'Imported book';
assert.equal(tools.context.filteredDictionary()[0].entry.text, 'bonjour');
const csv = tools.context.dictionaryCsv([{ bookName: 'Book,"Name"', entry: {
  text: '=1+1', translation: 'مرحبا', source: 'en', target: 'ar', context: 'line\nnext', page: 1,
} }]);
assert.ok(csv.includes('"Book,""Name"""'));
assert.ok(csv.includes("'" + '=1+1'));
assert.ok(csv.includes('مرحبا'));
assert.equal(tools.context.speakButton('hello', 'en', 'Hear').disabled, true);
const spoken = [];
tools.context.window.speechSynthesis = { cancel() {}, speak: value => spoken.push(value) };
tools.context.SpeechSynthesisUtterance = function(text) { this.text = text; };
tools.context.speakButton('hello', 'en', 'Hear').onclick();
assert.equal(spoken[0].lang, 'en');
assert.equal(spoken[0].text, 'hello');
console.log('Reading tools checks passed: search, language filters, all books, practice, notes, backup merge, validation, CSV, pronunciation');
console.log('Dictionary checks passed: stars, both languages, page links, sections, book isolation, persistence, removal, storage failure');
// Restore a full backup into empty storage, including notes and practice counts.
const completeBackup = JSON.parse(JSON.stringify(tools.context.exportLibrary()));
saved.clear();
const restored = boot();
restored.context.importLibrary(completeBackup);
restored.run("state.bookKey = 'tools-a'; state.bookName = 'Learning.pdf'; loadBookDictionary()");
assert.equal(restored.run('savedEntries[0].remembered'), 1);
assert.equal(restored.context.readBookmarks('tools-a')[0].note, 'Updated note');
assert.equal(restored.context.bookEntries('imported')[0].text, 'bonjour');

(async () => {
  const session = boot();
  session.context.pdfjsLib.getDocument = ({ data }) => ({ promise: Promise.resolve({
    fingerprints: [data[0] === 1 ? 'fingerprint-a' : 'fingerprint-b'], numPages: 1, destroy() {},
  }) });
  session.context.goTo = async () => {};
  await session.context.openFile({ name: 'same.pdf', size: 10, arrayBuffer: async () => [1] });
  assert.equal(session.run('state.bookKey'), 'fingerprint-a');
  session.context.toggleDictionaryEntry({ ...app.context.item, bookKey: 'fingerprint-a', page: 1 });
  await session.context.openFile({ name: 'same.pdf', size: 10, arrayBuffer: async () => [2] });
  assert.equal(session.run('savedEntries.length'), 0);
  await session.context.openFile({ name: 'renamed.pdf', size: 10, arrayBuffer: async () => [1] });
  assert.equal(session.run('savedEntries.length'), 1);
  assert.equal(session.run('state.bookName'), 'renamed.pdf');
  const activePdf = session.run('state.pdf');
  activePdf.getPage = async () => ({ pageNumber: 1 });
  session.context.getBlocks = async () => [{ text: 'Before hello after.' }];
  assert.equal(await session.context.selectionContext('hello', activePdf, 1), 'Before hello after.');
  assert.equal(await session.context.selectionContext('missing', activePdf, 1), 'missing');
  console.log('Book and context checks passed: book identity, rename, saved paragraph context, fallback');
})().catch(error => { console.error(error); process.exitCode = 1; });

const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { File } = require('node:buffer');
const source = fs.readFileSync('static/library.js', 'utf8').replace(/^export /gm, '');
class Element {
  constructor() { this.children = []; this.value = ''; this.hidden = false; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute() {} showModal() { this.open = true; } close() { this.open = false; } click() { this.clicked = true; }
}
function fakeStorage() {
  const stores = new Map();
  let denyWrites = false;
  const db = {
    close() {}, createObjectStore(name) { stores.set(name, new Map()); },
    transaction(name, mode) {
      if (denyWrites && mode === 'readwrite') throw Error('quota');
      const data = stores.get(name), tx = { pending: 0, failed: false, abort() { this.failed = true; this.onabort?.(); } };
      const operation = fn => {
        tx.pending++;
        const request = {};
        setImmediate(() => {
          if (tx.failed) return;
          request.result = fn(); request.onsuccess?.();
          if (--tx.pending === 0) setImmediate(() => { if (!tx.pending && !tx.failed) tx.oncomplete?.(); });
        });
        return request;
      };
      tx.objectStore = () => ({
        getAll: () => operation(() => [...data.values()]),
        get: key => operation(() => data.get(key)),
        put: (value, key) => operation(() => { data.set(key ?? value.id, value); }),
        delete: key => operation(() => data.delete(key)),
      });
      return tx;
    },
  };
  return {
    stores, denyWrites: value => { denyWrites = value; },
    open() {
      const request = {};
      setImmediate(() => {
        request.result = db;
        if (!stores.size) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
}
const storage = fakeStorage();
const context = vm.createContext({ File, console, document: { createElement: () => new Element() } });
vm.runInContext(source, context);
function boot(platform = { indexedDB: storage }) {
  const nodes = new Map(), opened = [], messages = [];
  const el = new Proxy({}, { get: (_, key) => { if (!nodes.has(key)) nodes.set(key, new Element()); return nodes.get(key); } });
  const api = context.createLibrary({ el, openFile: file => opened.push(file), toast: message => messages.push(message) }, platform);
  return { el, api, opened, messages };
}
const flush = async () => { for (let i = 0; i < 25; i++) await new Promise(resolve => setImmediate(resolve)); };
(async () => {
  const app = boot();
  await app.api.remember(new File(['one'], 'First.pdf', { type: 'application/pdf' }), 'first');
  assert.equal(app.el.recentList.children.length, 1);
  app.el.recentList.children[0].children[0].children[0].onclick();
  assert.equal(app.opened[0].name, 'First.pdf');
  assert.equal(await app.opened[0].text(), 'one');
  // A fresh Library instance reads previously stored files for direct reopening.
  const reload = boot(); reload.el.libraryBtn.onclick(); await flush();
  assert.equal(reload.el.recentList.children.length, 1);
  reload.el.librarySearch.value = 'absent'; reload.el.librarySearch.oninput();
  assert.equal(reload.el.recentList.children.length, 0);
  reload.el.librarySearch.value = ''; reload.el.librarySearch.oninput();
  await reload.el.recentList.children[0].children[1].onclick();
  assert.equal(storage.stores.get('recent').size, 0);
  for (let i = 0; i < 12; i++) await app.api.remember(new File([String(i)], `Book ${i}.pdf`), `book-${i}`);
  assert.equal(storage.stores.get('recent').size, 10);
  await app.api.remember(new File(['updated'], 'Renamed.pdf'), 'book-11');
  assert.equal(storage.stores.get('recent').size, 10);
  assert.equal(storage.stores.get('recent').get('book-11').name, 'Renamed.pdf');
  const big = context.trimRecents([
    { id: 'a', name: 'a.pdf', file: {}, size: 100 * 1024 * 1024, openedAt: 2 },
    { id: 'b', name: 'b.pdf', file: {}, size: 100 * 1024 * 1024, openedAt: 1 },
  ]);
  assert.equal(big.length, 1); assert.equal(big[0].id, 'a');
  // Folder fallback lists PDFs only, including paths; it does not store whole folders.
  const pdf = new File(['nested'], 'Nested.PDF');
  Object.defineProperty(pdf, 'webkitRelativePath', { value: 'Books/Chapter/Nested.PDF' });
  app.el.folderInput.files = [pdf, new File(['no'], 'notes.txt')];
  await app.el.folderInput.onchange();
  assert.equal(app.el.folderList.children.length, 1);
  assert.equal(app.el.folderList.children[0].textContent, 'Books/Chapter/Nested.PDF');
  await app.el.folderList.children[0].onclick();
  assert.equal(app.opened.at(-1).name, 'Nested.PDF');
  app.el.folderInput.files = []; await app.el.folderInput.onchange();
  assert.equal(app.el.folderList.children.length, 1); // Cancelling preserves the existing folder.
  // Persistent native handles can restore access and rescan changed folder contents.
  let permission = 'granted', nested = true;
  const handle = { name: 'NativeBooks', kind: 'directory',
    queryPermission: async () => permission,
    requestPermission: async () => { permission = 'granted'; return permission; },
    async *values() {
      yield { kind: 'file', name: 'Main.pdf', getFile: async () => new File(['main'], 'Main.pdf') };
      if (nested) yield { kind: 'directory', name: 'Subfolder', async *values() {
        yield { kind: 'file', name: 'Other.pdf', getFile: async () => new File(['other'], 'Other.pdf') };
      } };
    },
  };
  const native = boot({ indexedDB: storage, showDirectoryPicker: async () => handle });
  await native.el.folderChoose.onclick();
  assert.equal(native.el.folderList.children.length, 2);
  const restored = boot(); restored.el.libraryBtn.onclick(); await flush();
  assert.equal(restored.el.folderList.children.length, 2);
  nested = false; await restored.el.folderRefresh.onclick();
  assert.equal(restored.el.folderList.children.length, 1);
  permission = 'prompt';
  const reconnect = boot(); reconnect.el.libraryBtn.onclick(); await flush();
  assert.match(reconnect.el.folderStatus.textContent, /Reconnect/);
  await reconnect.el.folderReconnect.onclick();
  assert.equal(reconnect.el.folderList.children.length, 1);
  storage.denyWrites(true);
  await native.api.remember(new File(['session'], 'Session.pdf'), 'session');
  assert.match(native.messages.at(-1), /could not be kept/);
  assert.ok(native.el.recentList.children.some(row => row.children[0].children[0].textContent === 'Session.pdf'));
  const noStorage = boot({});
  await noStorage.api.remember(new File(['session'], 'Offline.pdf'), 'offline');
  assert.equal(noStorage.el.recentList.children.length, 1);
  await noStorage.el.recentList.children[0].children[1].onclick();
  assert.equal(noStorage.el.recentList.children.length, 0);
  await noStorage.el.folderChoose.onclick();
  assert.equal(noStorage.el.folderInput.clicked, true);
  console.log('Library checks passed: direct reopening, reload, search, removal, limits, folder fallback, nested folders, permission reconnect, storage failure');
})().catch(error => { console.error(error); process.exitCode = 1; });

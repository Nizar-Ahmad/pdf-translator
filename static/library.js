const RECENT_LIMIT = 10;
const RECENT_BYTES = 150 * 1024 * 1024;

export function trimRecents(records) {
  const unique = new Map();
  for (const record of records) {
    if (!record || typeof record.id !== 'string' || typeof record.name !== 'string' || !record.file || !Number.isFinite(record.size) || record.size < 0 || !Number.isFinite(record.openedAt)) continue;
    if (!unique.has(record.id) || unique.get(record.id).openedAt < record.openedAt) unique.set(record.id, record);
  }
  let bytes = 0;
  return [...unique.values()].sort((a, b) => b.openedAt - a.openedAt).filter(record => {
    if (record.size > RECENT_BYTES || bytes + record.size > RECENT_BYTES) return false;
    bytes += record.size; return true;
  }).slice(0, RECENT_LIMIT);
}

export function createLibrary({ el, openFile, toast }, platform = window) {
  let databasePromise, sessionRecents = [], recentRecords = [], folderFiles = [], folderHandle = null;
  const hiddenRecents = new Set();
  let folderName = '', folderVersion = 0, recentVersion = 0, folderRestored = false;
  const isPdf = name => /\.pdf$/i.test(name);
  function database() {
    if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
      if (!platform.indexedDB) { reject(new Error('Browser storage is unavailable.')); return; }
      const request = platform.indexedDB.open('pdf-translator-library', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('recent', { keyPath: 'id' });
        request.result.createObjectStore('settings');
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); databasePromise = null; };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close other app windows to update the library.'));
    }).catch(error => { databasePromise = null; throw error; });
    return databasePromise;
  }
  async function transaction(storeName, mode, work) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      let result;
      tx.oncomplete = () => resolve(typeof result === 'function' ? result() : result);
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('Browser storage failed.'));
      try { result = work(tx.objectStore(storeName)); }
      catch (error) { tx.abort(); reject(error); }
    });
  }
  const read = (storeName, key) => transaction(storeName, 'readonly', store => {
    const request = key === undefined ? store.getAll() : store.get(key);
    return () => request.result;
  });
  function button(label, action, className = 'btn small') {
    const node = document.createElement('button'); node.className = className;
    node.textContent = label; node.onclick = action; return node;
  }
  function renderLists() {
    const query = (el.librarySearch.value || '').trim().toLocaleLowerCase();
    el.recentList.replaceChildren();
    for (const record of recentRecords.filter(record => record.name.toLocaleLowerCase().includes(query))) {
      const row = document.createElement('div'); row.className = 'libraryFile';
      const open = button(record.name, () => {
        el.libraryDialog.close();
        openFile(new File([record.file], record.name, { type: 'application/pdf', lastModified: record.lastModified }));
      }, 'libraryOpen');
      const detail = document.createElement('small');
      detail.textContent = `${(record.size / 1024 / 1024).toFixed(1)} MB · ${new Date(record.openedAt).toLocaleDateString()}`;
      const info = document.createElement('div'); info.append(open, detail);
      const remove = button('Remove', async () => {
        hiddenRecents.add(record.id);
        sessionRecents = sessionRecents.filter(value => value.id !== record.id);
        try { await transaction('recent', 'readwrite', store => store.delete(record.id)); }
        catch { toast('Removed for this session. Browser storage is unavailable, so it may reappear after reloading.'); }
        await refreshRecents();
      });
      remove.setAttribute('aria-label', `Remove ${record.name} from recent PDFs`);
      row.append(info, remove); el.recentList.append(row);
    }
    el.recentEmpty.hidden = el.recentList.children.length > 0;
    el.recentEmpty.textContent = recentRecords.length ? 'No recent PDFs match your search.' : 'PDFs you open will appear here for direct reopening.';
    el.folderList.replaceChildren();
    for (const entry of folderFiles.filter(entry => entry.path.toLocaleLowerCase().includes(query))) {
      el.folderList.append(button(entry.path, async () => {
        try {
          const file = entry.handle ? await entry.handle.getFile() : entry.file;
          el.libraryDialog.close(); openFile(file);
        } catch { toast('Could not read this PDF. Reconnect or choose the source folder again.'); }
      }, 'libraryOpen folderFile'));
    }
    el.folderEmpty.hidden = el.folderList.children.length > 0;
    el.folderEmpty.textContent = folderFiles.length ? 'No PDFs match your search.' : 'Choose a source folder to browse its PDFs, including subfolders.';
    el.folderReconnect.hidden = !folderHandle;
    el.folderRefresh.disabled = !folderHandle && !folderFiles.length;
  }
  async function refreshRecents() {
    const version = ++recentVersion;
    let persisted = [];
    try { persisted = await read('recent'); }
    catch { el.libraryStorage.textContent = 'Persistent storage is unavailable. Newly opened PDFs remain available in this session.'; }
    if (version !== recentVersion) return;
    recentRecords = trimRecents([...persisted, ...sessionRecents].filter(record => !hiddenRecents.has(record.id))); renderLists();
  }
  async function remember(file, id) {
    const record = { id, name: file.name, size: file.size, lastModified: file.lastModified,
      openedAt: Date.now(), file };
    hiddenRecents.delete(id);
    sessionRecents = trimRecents([record, ...sessionRecents.filter(value => value.id !== id)]);
    if (file.size > RECENT_BYTES) { toast('PDF opened, but it exceeds the 150 MB recent-files limit.'); return; }
    try {
      await transaction('recent', 'readwrite', store => {
        const request = store.getAll();
        request.onsuccess = () => {
          const kept = trimRecents([record, ...request.result.filter(value => value.id !== id)]);
          const ids = new Set(kept.map(value => value.id));
          for (const old of request.result) if (!ids.has(old.id)) store.delete(old.id);
          if (ids.has(id)) store.put(record);
        };
      });
    } catch { toast('PDF opened. It could not be kept after closing the browser; storage may be full or unavailable.', 5000); }
    await refreshRecents();
  }
  async function scanFolder(handle) {
    const version = ++folderVersion, found = []; let visited = 0, limited = false;
    folderFiles = []; el.folderStatus.textContent = `Reading ${handle.name}…`; renderLists();
    async function walk(directory, prefix = '', depth = 0) {
      for await (const entry of directory.values()) {
        if (version !== folderVersion) return;
        if (++visited > 20000 || found.length >= 2000) { limited = true; return; }
        const path = prefix + entry.name;
        if (entry.kind === 'file' && isPdf(entry.name)) found.push({ path, handle: entry });
        else if (entry.kind === 'directory' && depth < 20) await walk(entry, path + '/', depth + 1);
        if (limited) return;
      }
    }
    try {
      await walk(handle);
      if (version !== folderVersion) return;
      folderFiles = found.sort((a, b) => a.path.localeCompare(b.path));
      el.folderStatus.textContent = `${handle.name} · ${found.length} PDFs${limited ? ' · Listing limit reached; choose a smaller folder to see more.' : ''}`;
    } catch {
      if (version !== folderVersion) return;
      el.folderStatus.textContent = 'Folder access was lost. Reconnect or choose the folder again.';
    }
    if (version === folderVersion) renderLists();
  }
  async function restoreFolder() {
    if (folderRestored) return; folderRestored = true;
    try {
      const saved = await read('settings', 'folder');
      if (folderHandle || folderVersion || !saved) return;
      if (saved.handle) {
        folderHandle = saved.handle; folderName = saved.name;
        const handle = folderHandle;
        const permission = await handle.queryPermission({ mode: 'read' });
        if (folderHandle !== handle) return;
        if (permission === 'granted') await scanFolder(handle);
        else el.folderStatus.textContent = `${folderName} · Click Reconnect folder to restore access.`;
      } else el.folderStatus.textContent = `${saved.name} · Choose this folder again to restore access in this browser.`;
      renderLists();
    } catch { /* Folder browsing still works without persistent storage. */ }
  }
  async function chooseFolder() {
    if (!platform.showDirectoryPicker) { el.folderInput.click(); return; }
    try {
      const handle = await platform.showDirectoryPicker({ mode: 'read' });
      folderHandle = handle; folderName = handle.name;
      try { await transaction('settings', 'readwrite', store => store.put({ name: handle.name, handle }, 'folder')); }
      catch { toast('Folder opened. Choose it again next time if the browser cannot remember access.'); }
      if (folderHandle === handle) await scanFolder(handle);
    } catch (error) {
      if (error.name !== 'AbortError') toast('Could not open folder picker. Use Choose files from folder instead.');
    }
  }
  el.libraryBtn.onclick = () => {
    el.libraryDialog.showModal(); renderLists(); refreshRecents(); restoreFolder();
  };
  el.libraryClose.onclick = () => el.libraryDialog.close();
  el.librarySearch.oninput = renderLists;
  el.folderChoose.onclick = chooseFolder;
  el.folderFallback.onclick = () => el.folderInput.click();
  el.folderInput.onchange = async () => {
    const first = el.folderInput.files?.[0];
    if (!first) return;
    ++folderVersion; folderHandle = null;
    const selectedPdfs = Array.from(el.folderInput.files || []).filter(file => isPdf(file.name));
    folderFiles = selectedPdfs.slice(0, 2000).map(file => ({ path: file.webkitRelativePath || file.name, file })).sort((a, b) => a.path.localeCompare(b.path));
    el.folderInput.value = '';
    folderName = first.webkitRelativePath?.split('/')[0] || 'Selected folder';
    el.folderStatus.textContent = `${folderName} · ${folderFiles.length} PDFs${selectedPdfs.length > 2000 ? ' (first 2,000 shown)' : ''} · Choose the folder again after reloading to restore access.`;
    renderLists();
    try { await transaction('settings', 'readwrite', store => store.put({ name: folderName }, 'folder')); } catch { /* Session-only access. */ }
  };
  el.folderReconnect.onclick = async () => {
    try {
      if (await folderHandle.requestPermission({ mode: 'read' }) === 'granted') await scanFolder(folderHandle);
      else toast('Folder access was not granted. You can choose a different folder.');
    } catch { toast('Choose the source folder again to restore access.'); }
  };
  el.folderRefresh.onclick = () => folderHandle ? scanFolder(folderHandle) : chooseFolder();
  return { remember };
}

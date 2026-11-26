// A quiet reading companion: never takes focus and never dismisses pending work.
export function createTranslationPopup({ getDuration, languageName, onCopy, onOpen, onRetry }, platform = window) {
  const node = id => document.getElementById(id);
  const root = node('translationPopup');
  let item = null, dismissed = null, renderedStatus = '', timer = null, remaining = 0, startedAt = 0;
  let hovering = false, focused = false, pointerHeld = false;
  const clearTimer = () => { platform.clearTimeout(timer); timer = null; };
  function hide() {
    clearTimer(); root.hidden = true; root.removeAttribute('aria-busy');
    hovering = false; focused = false; pointerHeld = false;
  }
  function dismiss() { dismissed = item; hide(); }
  function schedule() {
    clearTimer();
    if (root.hidden || item?.status === 'loading' || !getDuration() || hovering || focused || pointerHeld) return;
    startedAt = Date.now(); timer = platform.setTimeout(dismiss, Math.max(0, remaining));
  }
  function configure() {
    remaining = getDuration() * 1000;
    node('popupTiming').textContent = getDuration() ? `Closes after ${getDuration()}s · pauses while in use` : 'Stays open until you close it';
    schedule();
  }
  function pause() {
    if (timer !== null) remaining = Math.max(0, remaining - (Date.now() - startedAt));
    clearTimer();
  }
  function update(next, enabled) {
    if (!enabled || !next) { dismissed = next; item = next; hide(); return; }
    if (next === dismissed) return;
    const changed = next !== item || next.status !== renderedStatus;
    if (!changed) return;
    item = next; renderedStatus = next.status;
    root.hidden = false;
    root.setAttribute('aria-busy', String(item.status === 'loading'));
    node('popupLanguages').textContent = `${languageName(item.detected || item.source)} → ${languageName(item.target)}`;
    node('popupOriginal').textContent = item.text;
    node('popupOriginal').dir = 'auto';
    const text = node('popupTranslation');
    text.textContent = item.status === 'loading' ? 'Translating…' : item.status === 'error' ? item.error : item.translation;
    text.dir = item.status === 'ok' ? 'auto' : 'ltr';
    text.lang = item.status === 'ok' ? item.target : 'en';
    root.classList.toggle('isLoading', item.status === 'loading');
    root.classList.toggle('isError', item.status === 'error');
    node('popupCopy').hidden = item.status !== 'ok';
    node('popupRetry').hidden = item.status !== 'error';
    node('popupTiming').hidden = item.status === 'loading';
    configure();
  }
  node('popupClose').onclick = () => {
    const restoreFocus = root.contains(document.activeElement);
    dismiss();
    if (restoreFocus) node('stageWrap').focus({ preventScroll: true });
  };
  node('popupCopy').onclick = () => { if (item?.status === 'ok') onCopy(item); };
  node('popupOpenPanel').onclick = () => { dismiss(); onOpen(); };
  node('popupRetry').onclick = () => { if (item) onRetry(item); };
  root.addEventListener('pointerdown', () => { pointerHeld = true; pause(); });
  for (const event of ['pointerup', 'pointercancel']) document.addEventListener(event, () => {
    if (pointerHeld) { pointerHeld = false; schedule(); }
  });
  root.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') { hovering = true; pause(); } });
  root.addEventListener('pointerleave', () => { hovering = false; schedule(); });
  root.addEventListener('focusin', () => { focused = true; pause(); });
  root.addEventListener('focusout', event => { focused = root.contains(event.relatedTarget); if (!focused) schedule(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !root.hidden && !document.querySelector('dialog[open]')) {
      const restoreFocus = root.contains(document.activeElement);
      dismiss();
      if (restoreFocus) node('stageWrap').focus({ preventScroll: true });
      event.preventDefault();
    }
  });
  return { update, dismiss, configure };
}

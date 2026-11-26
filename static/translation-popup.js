// A quiet reading companion: never takes focus and never dismisses pending work.
export function createTranslationPopup({ getDuration, languageName, onCopy, onOpen, onRetry, onLayout = () => {} }, platform = window) {
  const node = id => document.getElementById(id);
  const root = node('translationPopup');
  let item = null, dismissed = null, renderedStatus = '', timer = null, remaining = 0, startedAt = 0;
  let hovering = false, focused = false, pointerHeld = false, size = 'normal';
  const clearTimer = () => { platform.clearTimeout(timer); timer = null; };
  function hide() {
    clearTimer(); root.hidden = true; root.removeAttribute('aria-busy');
    hovering = false; focused = false; pointerHeld = false;
    onLayout();
  }
  function dismiss() { dismissed = item; hide(); }
  function schedule() {
    clearTimer();
    if (root.hidden || item?.status === 'loading' || !getDuration() || hovering || focused || pointerHeld || size !== 'normal') return;
    startedAt = Date.now(); timer = platform.setTimeout(dismiss, Math.max(0, remaining));
  }
  function updateTimingLabel() {
    node('popupTiming').textContent = !getDuration() ? 'Stays open until you close it'
      : size !== 'normal' ? `Auto-close paused while ${size === 'maximized' ? 'expanded' : 'minimized'}`
      : `Closes after ${getDuration()}s · pauses while in use`;
  }
  function configure() {
    remaining = getDuration() * 1000;
    updateTimingLabel();
    schedule();
  }
  function pause() {
    if (timer !== null) remaining = Math.max(0, remaining - (Date.now() - startedAt));
    clearTimer();
  }
  function setSize(nextSize) {
    pause(); size = nextSize;
    updateTimingLabel();
    root.classList.toggle('isMinimized', size === 'minimized');
    root.classList.toggle('isMaximized', size === 'maximized');
    node('popupMinimize').setAttribute('aria-expanded', String(size !== 'minimized'));
    node('popupMaximize').setAttribute('aria-pressed', String(size === 'maximized'));
    for (const [id, restore, action] of [['popupMinimize', size === 'minimized', 'Minimize'], ['popupMaximize', size === 'maximized', 'Maximize']]) {
      const button = node(id);
      button.title = restore ? 'Restore translation popup' : `${action} translation popup`;
      button.setAttribute('aria-label', button.title);
      button.innerHTML = `<svg class="uiIcon" aria-hidden="true"><use href="#i-${restore ? 'restore' : action.toLowerCase()}"/></svg>`;
    }
    schedule();
    onLayout();
  }
  node('popupMinimize').onclick = () => setSize(size === 'minimized' ? 'normal' : 'minimized');
  node('popupMaximize').onclick = () => setSize(size === 'maximized' ? 'normal' : 'maximized');
  function update(next, enabled) {
    if (!enabled || !next) { dismissed = next; item = next; hide(); return; }
    if (next === dismissed) return;
    const changed = next !== item || next.status !== renderedStatus;
    if (!changed) return;
    if (next !== item) setSize('normal');
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
    onLayout();
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

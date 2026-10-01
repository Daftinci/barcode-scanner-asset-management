// Captures input from a physical USB/Bluetooth barcode scanner.
// These devices are HID "keyboard wedge" scanners: they type the decoded text into
// whatever has focus, then send Enter. We keep a dedicated input focused at all times.
//
// No time-based debounce here: each Enter-terminated scan is already a single discrete
// trigger pull (the input is cleared immediately, so a repeated/held Enter just re-flushes
// an empty buffer harmlessly). Repeated scans of the same code are a business-logic concern
// (see match-index.js's "duplicate" outcome), not an input-layer one — unlike the camera
// path, which decodes the same barcode many times per second while it sits in frame.

const GLOBAL_KEY_GAP_MS = 30; // max gap between keystrokes to be considered "scanner speed"

export class HidScanner {
  constructor({ inputEl, onDecode }) {
    this.inputEl = inputEl;
    this.onDecode = onDecode;

    this._globalBuffer = '';
    this._globalLastKeyTime = 0;

    this._onInputKeydown = this._onInputKeydown.bind(this);
    this._onGlobalKeydown = this._onGlobalKeydown.bind(this);
    this._refocus = this._refocus.bind(this);

    this.inputEl.addEventListener('keydown', this._onInputKeydown);
    this.inputEl.addEventListener('blur', this._refocus);
    document.addEventListener('keydown', this._onGlobalKeydown, true);

    this._refocus();
  }

  _refocus() {
    // Deferred: during the blur event itself, document.activeElement may still report
    // document.body (the new element hasn't finished taking focus yet), which would make
    // this steal focus back before it ever lands anywhere else. Checking on the next tick
    // lets the real focus transition settle first, so clicking the search box, a table
    // button, or any other field actually keeps focus there.
    setTimeout(() => {
      const active = document.activeElement;
      if (active && active !== this.inputEl && active !== document.body) return;
      this.inputEl.focus();
    }, 0);
  }

  _emit(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.onDecode({ text: trimmed, format: null, source: 'hid' });
  }

  _onInputKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = this.inputEl.value;
      this.inputEl.value = '';
      this._emit(value);
    }
  }

  // Safety net: if focus lands elsewhere (e.g. user clicked a table row) and a scanner
  // fires anyway, catch fast keystroke bursts at the document level.
  _onGlobalKeydown(e) {
    if (document.activeElement === this.inputEl) return; // primary path already handles it
    const active = document.activeElement;
    const tag = active && active.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return; // user is typing somewhere else on purpose

    const now = Date.now();
    if (now - this._globalLastKeyTime > GLOBAL_KEY_GAP_MS + 200) {
      this._globalBuffer = '';
    }
    this._globalLastKeyTime = now;

    if (e.key === 'Enter') {
      const value = this._globalBuffer;
      this._globalBuffer = '';
      if (value.length >= 3) this._emit(value);
      return;
    }
    if (e.key.length === 1) {
      this._globalBuffer += e.key;
    }
  }

  destroy() {
    this.inputEl.removeEventListener('keydown', this._onInputKeydown);
    this.inputEl.removeEventListener('blur', this._refocus);
    document.removeEventListener('keydown', this._onGlobalKeydown, true);
  }
}

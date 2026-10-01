// Camera-based barcode scanning via the globally-loaded ZXing (vendor/zxing/zxing.min.js).

const DEBOUNCE_MS = 1500;

export class CameraScanner {
  constructor({ videoEl, onDecode, onError, onTick }) {
    this.videoEl = videoEl;
    this.onDecode = onDecode;
    this.onError = onError;
    this.onTick = onTick;
    this.reader = null;
    this.lastCode = null;
    this.lastCodeTime = 0;
    this.lastTickAt = 0;
    this.running = false;
  }

  _buildReader() {
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      ZXing.BarcodeFormat.CODE_128,
      ZXing.BarcodeFormat.CODE_39,
      ZXing.BarcodeFormat.EAN_13,
      ZXing.BarcodeFormat.UPC_A,
      ZXing.BarcodeFormat.UPC_E,
      ZXing.BarcodeFormat.QR_CODE,
      ZXing.BarcodeFormat.PDF_417,
    ]);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    return new ZXing.BrowserMultiFormatReader(hints);
  }

  _ensureReader() {
    if (!this.reader) this.reader = this._buildReader();
    return this.reader;
  }

  async listVideoInputDevices() {
    return this._ensureReader().listVideoInputDevices();
  }

  async start(deviceId) {
    if (this.running) await this.stop();
    const reader = this._ensureReader();
    this.running = true;
    // DroidCam (and many webcams) default to a low resolution with no continuous autofocus,
    // which starves the decoder of a sharp enough frame — request better ones explicitly.
    // These are all "ideal"/"advanced" (best-effort) constraints, so unsupported ones are
    // silently ignored by the browser rather than failing getUserMedia.
    const videoConstraints = deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode: 'environment' };
    videoConstraints.width = { ideal: 1920 };
    videoConstraints.height = { ideal: 1080 };
    videoConstraints.advanced = [{ focusMode: 'continuous' }];
    try {
      await reader.decodeFromConstraints({ video: videoConstraints }, this.videoEl, (result, err) => {
        const now = Date.now();
        if (this.onTick && now - this.lastTickAt > 400) {
          this.lastTickAt = now;
          this.onTick();
        }
        if (result) {
          this._handleResult(result);
          return;
        }
        // NotFoundException fires continuously while no barcode is in frame; ignore it.
        if (err && !(ZXing.NotFoundException && err instanceof ZXing.NotFoundException)) {
          console.debug(`[scanner] decode error: ${err.name || err}`, err);
        }
      });
    } catch (err) {
      this.running = false;
      if (this.onError) this.onError(err);
      throw err;
    }
  }

  _handleResult(result) {
    const text = result.getText();
    const formatCode = result.getBarcodeFormat ? result.getBarcodeFormat() : null;
    const format = formatCode != null ? ZXing.BarcodeFormat[formatCode] || String(formatCode) : null;
    const now = Date.now();
    const norm = text.trim().toUpperCase();
    if (norm === this.lastCode && now - this.lastCodeTime < DEBOUNCE_MS) return;
    this.lastCode = norm;
    this.lastCodeTime = now;
    console.log(`[scanner] camera decoded "${text}" as ${format}`);
    this.onDecode({ text, format, source: 'camera' });
  }

  async stop() {
    this.running = false;
    if (this.reader) {
      try {
        this.reader.reset();
      } catch (e) {
        // ignore
      }
      this.reader = null;
    }
  }

  // Only meaningful on a device's own camera (e.g. the mobile scan page) — DroidCam's
  // virtual driver doesn't expose real hardware controls like torch through getUserMedia.
  getVideoTrack() {
    const stream = this.videoEl.srcObject;
    return stream ? stream.getVideoTracks()[0] : null;
  }

  torchSupported() {
    const track = this.getVideoTrack();
    const caps = track && track.getCapabilities ? track.getCapabilities() : null;
    return !!(caps && caps.torch);
  }

  async setTorch(enabled) {
    const track = this.getVideoTrack();
    if (!track || !this.torchSupported()) return false;
    await track.applyConstraints({ advanced: [{ torch: enabled }] });
    return true;
  }
}

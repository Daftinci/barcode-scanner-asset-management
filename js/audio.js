// WebAudio-generated feedback tones. No audio assets needed.
// AudioContext must be created/resumed from a user gesture, so call unlock() on the
// first click/keydown in the app before any beep is expected to play.

let ctx = null;

function ensureContext() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function unlock() {
  ensureContext();
}

function tone(freq, durationMs, type = 'sine', gain = 0.15) {
  const audioCtx = ensureContext();
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gainNode.gain.value = gain;
  osc.connect(gainNode).connect(audioCtx.destination);
  const now = audioCtx.currentTime;
  gainNode.gain.setValueAtTime(gain, now);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
  osc.start(now);
  osc.stop(now + durationMs / 1000);
}

export function playFound() {
  tone(1046.5, 120, 'sine'); // C6, short bright beep
}

export function playDuplicate() {
  tone(659.25, 90, 'triangle');
  setTimeout(() => tone(659.25, 90, 'triangle'), 120);
}

export function playUnrecognized() {
  tone(220, 220, 'sawtooth', 0.12);
}

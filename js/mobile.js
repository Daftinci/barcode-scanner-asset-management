// Phone-facing scan page. Uses the phone's own camera (not DroidCam — this page is meant to be
// opened directly in the phone's browser over the local Wi-Fi) to decode barcodes with the same
// CameraScanner/ZXing setup as the PC page, then relays each one to the PC via server.py's
// /api/scan endpoint. The PC page (js/app.js) polls for and applies them the same way it applies
// camera/HID scans. This page never touches the workbook itself.

import { CameraScanner } from './scanner.js';
import * as relay from './relay.js';

const videoEl = document.getElementById('mobile-video');
const startBtn = document.getElementById('mobile-start-btn');
const torchBtn = document.getElementById('mobile-torch-btn');
const toastEl = document.getElementById('mobile-toast');
const sessionEl = document.getElementById('mobile-session');
const viewfinderEl = document.getElementById('mobile-viewfinder');

let torchOn = false;
let toastTimer = null;
const pendingQueue = [];
let flushing = false;

function showToast(text, ms = 2200) {
  toastEl.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.textContent = '';
  }, ms);
}

function flashViewfinder() {
  viewfinderEl.classList.remove('flash-sent');
  void viewfinderEl.offsetWidth; // restart animation if it's already mid-flash
  viewfinderEl.classList.add('flash-sent');
}

async function flushQueue() {
  if (flushing) return;
  flushing = true;
  while (pendingQueue.length) {
    const item = pendingQueue[0];
    try {
      await relay.postScan(item.text, item.format);
      pendingQueue.shift();
      showToast(`Sent: ${item.text}`);
      flashViewfinder();
      if (navigator.vibrate) navigator.vibrate(60);
    } catch (err) {
      showToast('No connection to PC — retrying…', 4000);
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }
  flushing = false;
}

const scanner = new CameraScanner({
  videoEl,
  onDecode: ({ text, format }) => {
    pendingQueue.push({ text, format });
    flushQueue();
  },
  onError: (err) => {
    showToast(`Camera error: ${err.message || err}`, 5000);
  },
});

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  startBtn.textContent = 'Starting…';
  try {
    await scanner.start();
    startBtn.classList.add('hidden');
    viewfinderEl.classList.remove('hidden');
    if (scanner.torchSupported()) torchBtn.classList.remove('hidden');
  } catch (err) {
    startBtn.disabled = false;
    startBtn.textContent = 'Tap to start scanning';
    showToast(`Could not start camera: ${err.message || err}`, 5000);
  }
});

torchBtn.addEventListener('click', async () => {
  const next = !torchOn;
  const ok = await scanner.setTorch(next);
  if (!ok) return;
  torchOn = next;
  torchBtn.classList.toggle('active', torchOn);
});

async function pollSession() {
  try {
    const info = await relay.fetchSession();
    sessionEl.textContent = info && info.clientName
      ? `${info.clientName} — ${info.status || ''}`
      : 'Waiting for PC to load a workbook…';
  } catch (err) {
    sessionEl.textContent = 'Not connected to PC';
  }
}
pollSession();
setInterval(pollSession, 2000);

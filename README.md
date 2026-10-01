# IP Phone / Network Equipment Barcode Scanner

Scans a device's SN barcode and checks it off against the `SN` column of a client's device-list
workbook. **Each client is its own workbook file** — load one client's file, scan, export, then
load the next client's file when you switch clients. Supports three scanning inputs, usable at
the same time:

- **A physical USB/Bluetooth barcode scanner** (keyboard-wedge type) — just scan, no setup.
- **Your own phone's camera, in its own browser** (recommended) — open this PC's LAN address on
  your phone (same Wi-Fi), get a full-screen viewfinder, and scanned codes appear on the PC
  automatically. No app install, no cable, no DroidCam.
- **A local webcam or DroidCam**, shown directly on the PC page — an optional fallback if you'd
  rather not use a second device, or don't have a phone on the same network.

The original `.xlsx` file is **never modified**. Results are exported as a brand-new file,
`... - Scan Results.xlsx`, next to the original.

## Setup (one-time)

Already done if you're reading this in the built project — `vendor/xlsx` and `vendor/zxing`
contain the two required JS libraries, vendored locally so no internet is needed at scan time.

Instead of running this locally on your own laptop (below), you can also run it as an
always-on service on a shared server so it doesn't depend on one person's machine being
turned on — see [DEPLOYMENT.md](DEPLOYMENT.md) for the Docker setup.

## Running

1. Double-click `Klik Ini 2 kali.bat` to start the local server and open
   `http://localhost:8000` in your browser. (`run-server.ps1` does the same thing if you prefer
   PowerShell, but many laptops block `.ps1` scripts from running by default — the `.bat` avoids
   that and is the more portable choice on a machine you haven't set up before.)
   - Requires Python (the script runs `server.py`, a small local web server); if it's missing,
     the `.bat` file will say so and point you to the installer.
   - Use **Chrome or Edge** on both the PC and the phone (camera device labels/enumeration are
     unreliable in Firefox).
   - Windows may prompt to allow Python through the firewall the first time — allow it on
     **Private networks**; that's what lets your phone reach the PC over Wi-Fi. If it doesn't
     prompt (e.g. the server was started non-interactively) and your phone's browser just hangs
     trying to connect, you'll need to add the rule yourself: `New-NetFirewallRule -DisplayName
     "IP Phone Scanner (8000)" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow
     -Profile Private,Domain` in an **elevated** PowerShell.
   - **iPhone/iOS users**: Safari won't expose the camera API at all on a plain `http://`
     address — you'll get a `getUserMedia`-related error when tapping "start scanning." Generate
     a certificate once with `.\generate-cert.ps1 <this-PC's-LAN-IP>` (needs `openssl`, e.g. from
     Git for Windows), restart the server, and use `https://` instead — see "HTTPS" in
     [DEPLOYMENT.md](DEPLOYMENT.md) for the full explanation and the one-time certificate warning
     you'll need to tap through on the phone. Android/Chrome is more lenient and usually works
     over plain `http://` on a local IP, but `https://` works there too.
2. Click **Load Workbook** and select the client's `.xlsx` file. (You do not need to close Excel
   first.) The app reads whichever sheet in that file has an `SN` header column — any other
   tabs (e.g. a PivotTable summary) are ignored.
3. Confirm/edit the **client name** field next to the file picker — it's pre-filled from the
   sheet's tab name in the workbook, but you can rename it to whatever label you want to show up
   in the UI and in the exported file's sheet name.
4. Scan:
   - **Hardware scanner**: just scan — the "Scanner input" box is always focused and ready.
   - **Remote phone scanner**: open the "Remote phone scanner" section, type the URL it shows
     (e.g. `http://192.168.1.23:8000/mobile.html`) into your phone's browser — both devices must
     be on the **same Wi-Fi network**. Tap "Tap to start scanning" on the phone and point it at a
     barcode; it appears on the PC within about a second.
   - **Local webcam/DroidCam**: open the "Local webcam" section, click **Refresh devices**, pick
     your camera from the dropdown, click **Start Camera**.
5. Green = found, amber = already scanned, orange = that's a MAC barcode not an SN barcode,
   red = not on this list (logged in the "Unrecognized scans" panel).
6. Click **Export Results** any time to download `<client name> - Scan Results.xlsx` with
   Found/Not Found status and scan timestamps.
7. To switch to a different client, just load that client's own workbook file — it replaces the
   currently loaded client. Progress for each file is saved separately (see below), so you can
   come back to an earlier client's file later and resume where you left off.

## Remote phone scanner

The phone doesn't run the app itself — it just points its camera at barcodes and hands the
decoded text to the PC, which does all the matching/checklist work as usual.

- Both devices must be on the **same local Wi-Fi network** (a guest network that isolates
  clients from each other won't work). No internet connection is needed or used.
- The relay is a small in-memory queue inside `server.py` — nothing is written to disk, and
  restarting the server clears it. If the "Remote phone scanner" section on the PC says
  "Not running via the relay server...", you started the app some other way (e.g. plain
  `python -m http.server`, or opening `index.html` directly) — use `Klik Ini 2 kali.bat` or
  `run-server.ps1` instead.
- If you scan on the phone *before* loading a workbook or starting an intake session on the PC,
  those scans aren't lost — they queue up and get applied as soon as a session starts. Just be
  aware of this if you scan into the phone before double-checking which client is loaded on the
  PC.
- The phone page shows the recognized formats (see below), a live "Scanning" viewfinder, and a
  torch/flashlight toggle if your phone's browser exposes one. It shows "Sent: <code>" for every
  scan it hands off, but whether that code was actually a match, a duplicate, or unrecognized is
  only shown on the PC screen — glance over there to confirm.

## Notes & limitations

- **Progress is saved in the browser** (localStorage), keyed to the loaded file's name/size/
  modified-date. If you refresh the page, re-select the *same* file to resume — the app cannot
  silently reopen it for you (a plain static page has no persistent file handle).
- If your hardware scanner is configured to send something other than a bare `Enter` as a
  suffix (some send Tab, or a custom prefix/suffix), reconfigure the scanner itself (via its
  own setup barcodes) to send `Enter` — this is a one-time scanner setting, not an app setting.
- Camera barcode format is assumed to be Code128 (typical for Cisco labels), with Code39, EAN-13,
  UPC-A, UPC-E, QR Code, and PDF417 also recognized — this applies to both the remote phone
  scanner and the local webcam/DroidCam fallback. If real scans aren't decoding, check the
  browser console — each decode logs its detected format.
- Both camera scanners actively decode every video frame the whole time they're running — it's
  not just a live preview you have to screenshot. On the PC's local-webcam panel, a "Scanning…
  last frame analyzed at ..." line under the video updates continuously while it's working; if
  that timestamp freezes, the video feed itself stalled, not the decoder.
- Scanning directly from the phone's own camera (the recommended remote scanner) generally
  decodes far more reliably than DroidCam, since the browser gets the real camera with real
  autofocus/torch control instead of a re-encoded virtual webcam feed. If you do use the
  DroidCam fallback and barcodes aren't picked up, it's almost always DroidCam's video quality:
  raise the resolution/quality slider in the DroidCam Windows client, hold the barcode ~15-20cm
  from the lens so it fills a good chunk of the frame, keep it in focus, and avoid glare/motion
  blur.
- Any tab in the workbook without an `SN` header column (e.g. a PivotTable summary tab) is
  intentionally never read or written by this app — only the first tab that has one is used.
- The old combined `ENI Muara Bakau ... .xlsx` file with separate `ENI` and `RUBY` tabs is no
  longer supported as-is: loading it will only pick up its first sheet with an `SN` column
  (`ENI`). Split each client's data into its own single-sheet workbook file going forward.

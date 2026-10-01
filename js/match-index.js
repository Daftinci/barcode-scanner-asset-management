// Column resolution + SN/MAC indexing for a parsed sheet.

const SN_HEADER = 'sn';
const MAC_HEADER = 'mac';

function normalizeHeader(h) {
  return String(h == null ? '' : h).trim().toLowerCase();
}

function normalizeCode(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s.toUpperCase();
}

// Re-parses a timestamp previously written via `new Date(...).toLocaleString()` on export.
function parseExportedTimestamp(raw) {
  if (raw == null || raw === '') return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d.getTime();
}

// rows: array-of-arrays from XLSX.utils.sheet_to_json(ws, {header:1})
// Returns { records, headerLabels } where records is one entry per data row.
export function parseSheetRows(rows) {
  if (!rows || rows.length === 0) return { records: [], headerLabels: {} };

  const headerRow = rows[0];
  const colByHeader = new Map();
  headerRow.forEach((h, idx) => {
    const norm = normalizeHeader(h);
    if (norm && !colByHeader.has(norm)) colByHeader.set(norm, idx);
  });

  const snCol = colByHeader.get(SN_HEADER);
  const macCol = colByHeader.get(MAC_HEADER);
  if (snCol === undefined) {
    throw new Error(`Could not find a "SN" column in this sheet's header row.`);
  }

  // Preserve original header labels (trimmed) for export, keyed by normalized name.
  const headerLabels = {};
  headerRow.forEach((h) => {
    const norm = normalizeHeader(h);
    if (norm && headerLabels[norm] === undefined) headerLabels[norm] = String(h).trim();
  });

  const wantedCols = {
    product: colByHeader.get('product'),
    tipe: colByHeader.get('tipe'),
    box: colByHeader.get('box'),
    lantai: colByHeader.get('lantai'),
    company: colByHeader.get('company'),
    description: colByHeader.get('description'),
    // Present when re-loading a file this app previously exported (see xlsx-handler.js's
    // buildResultsWorkbook) — lets that export be used directly to resume progress.
    scanStatus: colByHeader.get('scan status'),
    scannedAt: colByHeader.get('scanned at'),
    condition: colByHeader.get('condition'),
    conditionSetAt: colByHeader.get('condition set at'),
  };

  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => c == null || String(c).trim() === '')) continue; // skip fully blank rows

    const rawSn = row[snCol];
    const rawMac = macCol === undefined ? null : row[macCol];
    const snNorm = normalizeCode(rawSn);
    const macNorm = normalizeCode(rawMac);

    let status = snNorm ? 'pending' : 'no-sn';
    let foundAt = null;
    let foundBy = null;
    let condition = null;
    let conditionAt = null;

    if (snNorm && wantedCols.scanStatus !== undefined) {
      const statusNorm = String(row[wantedCols.scanStatus] ?? '').trim().toLowerCase();
      if (statusNorm === 'found') {
        status = 'found';
        foundBy = 'import';
        if (wantedCols.scannedAt !== undefined) foundAt = parseExportedTimestamp(row[wantedCols.scannedAt]);
      }
    }

    if (wantedCols.condition !== undefined) {
      const condStr = row[wantedCols.condition] == null ? '' : String(row[wantedCols.condition]).trim();
      if (condStr) {
        condition = condStr;
        if (wantedCols.conditionSetAt !== undefined) conditionAt = parseExportedTimestamp(row[wantedCols.conditionSetAt]);
      }
    }

    records.push({
      rowIndex: records.length,
      sourceRow: r + 1, // 1-based row number in the original sheet, for reference
      sn: rawSn == null ? null : String(rawSn).trim(),
      snNorm,
      mac: rawMac == null ? null : String(rawMac).trim(),
      macNorm,
      product: wantedCols.product === undefined ? null : row[wantedCols.product],
      tipe: wantedCols.tipe === undefined ? null : row[wantedCols.tipe],
      box: wantedCols.box === undefined ? null : row[wantedCols.box],
      lantai: wantedCols.lantai === undefined ? null : row[wantedCols.lantai],
      company: wantedCols.company === undefined ? null : row[wantedCols.company],
      description: wantedCols.description === undefined ? null : row[wantedCols.description],
      status,
      foundAt,
      foundBy,
      condition,
      conditionAt,
    });
  }

  return { records, headerLabels };
}

// Builds { snIndex: Map<string, number[]>, macIndex: Map<string, number[]> } over records (by rowIndex).
export function buildMatchIndex(records) {
  const snIndex = new Map();
  const macIndex = new Map();
  for (const rec of records) {
    if (rec.snNorm) {
      if (!snIndex.has(rec.snNorm)) snIndex.set(rec.snNorm, []);
      snIndex.get(rec.snNorm).push(rec.rowIndex);
    }
    if (rec.macNorm) {
      if (!macIndex.has(rec.macNorm)) macIndex.set(rec.macNorm, []);
      macIndex.get(rec.macNorm).push(rec.rowIndex);
    }
  }
  return { snIndex, macIndex };
}

// Determines the outcome of a scanned code during a "new product intake" session, where there's
// no preloaded device list — every scan either registers a brand-new item or repeats one already
// added earlier in the same session. No mac-hint concept here: there's no preloaded MAC list to
// compare against.
// Returns { kind: 'duplicate'|'new'|'unrecognized', rowIndex?, codeNorm }
export function matchIntakeScan(rawText, snIndex) {
  const codeNorm = normalizeCode(rawText);
  if (!codeNorm) return { kind: 'unrecognized', codeNorm: rawText };

  const existingRows = snIndex.get(codeNorm);
  if (existingRows && existingRows.length) {
    return { kind: 'duplicate', rowIndex: existingRows[0], codeNorm };
  }
  return { kind: 'new', codeNorm };
}

// Determines the outcome of a scanned code against a sheet's records/index.
// Returns { kind: 'found'|'duplicate'|'mac-hint'|'unrecognized', rowIndex? }
export function matchScan(rawText, records, index) {
  const codeNorm = normalizeCode(rawText);
  if (!codeNorm) return { kind: 'unrecognized', codeNorm: rawText };

  const snRows = index.snIndex.get(codeNorm);
  if (snRows && snRows.length) {
    const pendingRowIndex = snRows.find((ri) => records[ri].status === 'pending');
    if (pendingRowIndex !== undefined) {
      return { kind: 'found', rowIndex: pendingRowIndex, codeNorm };
    }
    // all matching rows already found
    return { kind: 'duplicate', rowIndex: snRows[0], codeNorm };
  }

  const macRows = index.macIndex.get(codeNorm);
  if (macRows && macRows.length) {
    return { kind: 'mac-hint', rowIndex: macRows[0], codeNorm };
  }

  return { kind: 'unrecognized', codeNorm };
}

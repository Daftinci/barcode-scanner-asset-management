// Workbook load + export. Uses the globally-loaded SheetJS `XLSX` (vendor/xlsx/xlsx.full.min.js).
import { parseSheetRows, buildMatchIndex } from './match-index.js';

// Reads a File (from <input type=file>) and returns the single client dataset found in it:
// { fileName, fileSize, lastModified, detectedSheetName, records, index, headerLabels }
//
// Each workbook is expected to hold exactly one client's device list. Sheets are tried in
// workbook order and the first one with an "SN" header column wins; sheets without one (e.g.
// a PivotTable summary tab) are silently skipped rather than treated as an error.
export async function loadWorkbookFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
    if (!rows || rows.length === 0) continue;

    let parsed;
    try {
      parsed = parseSheetRows(rows);
    } catch (err) {
      continue; // no SN column — not a scannable client list
    }

    return {
      fileName: file.name,
      fileSize: file.size,
      lastModified: file.lastModified,
      detectedSheetName: name,
      records: parsed.records,
      index: buildMatchIndex(parsed.records),
      headerLabels: parsed.headerLabels,
    };
  }

  throw new Error('No sheet with an "SN" column was found in this workbook.');
}

const EXPORT_COLUMNS = [
  ['product', 'Product'],
  ['tipe', 'TIPE'],
  ['sn', 'SN'],
  ['mac', 'MAC'],
  ['box', 'BOX'],
  ['lantai', 'LANTAI'],
  ['company', 'Company'],
  ['description', 'Description'],
];

function statusLabel(status) {
  if (status === 'found') return 'Found';
  if (status === 'no-sn') return 'No SN on Record';
  return 'Not Found';
}

// Excel sheet names can't contain [ ] : * ? / \ and are capped at 31 characters.
function sanitizeSheetName(name) {
  const cleaned = String(name || 'Client').replace(/[\[\]:*?/\\]/g, '').trim();
  return (cleaned || 'Client').slice(0, 31);
}

// Builds a brand-new single-sheet results workbook (never touches the source workbook object).
export function buildResultsWorkbook(clientData, clientName) {
  const wb = XLSX.utils.book_new();

  const header = [...EXPORT_COLUMNS.map(([, label]) => label), 'Scan Status', 'Scanned At', 'Condition', 'Condition Set At'];
  const aoa = [header];

  for (const rec of clientData.records) {
    const row = EXPORT_COLUMNS.map(([key]) => (rec[key] == null ? '' : rec[key]));
    row.push(statusLabel(rec.status));
    row.push(rec.foundAt ? new Date(rec.foundAt).toLocaleString() : '');
    row.push(rec.condition || '');
    row.push(rec.conditionAt ? new Date(rec.conditionAt).toLocaleString() : '');
    aoa.push(row);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(clientName));

  const unrecognizedHeader = ['Scanned Text', 'Format', 'Source', 'Scanned At', 'Product', 'Tipe', 'Company', 'Description'];
  const unrecognizedAoa = [unrecognizedHeader];
  for (const entry of clientData.unrecognizedLog || []) {
    unrecognizedAoa.push([
      entry.text ?? '',
      entry.format ?? '',
      entry.source ?? '',
      entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '',
      entry.product ?? '',
      entry.tipe ?? '',
      entry.company ?? '',
      entry.description ?? '',
    ]);
  }
  const unrecognizedWs = XLSX.utils.aoa_to_sheet(unrecognizedAoa);
  XLSX.utils.book_append_sheet(wb, unrecognizedWs, 'Unrecognized');

  return wb;
}

export function exportResultsFile(clientData, clientName) {
  const wb = buildResultsWorkbook(clientData, clientName);
  const outName = `${clientName} - Scan Results.xlsx`;
  XLSX.writeFile(wb, outName);
  return outName;
}

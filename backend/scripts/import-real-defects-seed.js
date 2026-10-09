// DEV ONLY — turn a real QC defects export (the "AllBugs" Excel: the result of
// the defects SQL, one column per SQL alias) into the local seed the dev mock
// mode reads instead of synthetic defects (2026-10-07).
//
//   node scripts/import-real-defects-seed.js "D:/.../QC/AllBugs.xlsx" ["D:/.../QC/RELEASES.xlsx"] ["D:/.../QC/CYCLES.xlsx"]
//
// The export carries release / cycle ids (DETECTED_IN_RELEASE = 353,
// DETECTED_IN_CYCLE = 1079); the optional RELEASES export (REL_ID / REL_NAME)
// and CYCLES export (RCYC_ID / RCYC_PARENT_ID / RCYC_NAME) turn them into names
// (ITv06-2025 / Cycle 1) and also give release-cycles.local.json — the
// release -> cycles list the defect form's release/cycle picker uses in dev.
//
// Output: src/qc/seed-data/allbugs.local.json — that folder is git-ignored
// (real employee names / customer data must never be committed). Used only
// while Oracle is disabled; production reads QC directly.
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const src = process.argv[2];
if (!src) { console.error('usage: node scripts/import-real-defects-seed.js <AllBugs.xlsx>'); process.exit(1); }
const wb = XLSX.read(fs.readFileSync(src), { type: 'buffer', cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
const sheetRows = file => {
  const w = XLSX.read(fs.readFileSync(file), { type: 'buffer' });
  return XLSX.utils.sheet_to_json(w.Sheets[w.SheetNames[0]], { defval: null });
};
const relName = new Map();
const relStart = new Map();
if (process.argv[3]) {
  for (const r of sheetRows(process.argv[3])) {
    if (r.REL_ID != null && r.REL_NAME) { relName.set(String(r.REL_ID).trim(), String(r.REL_NAME).trim()); relStart.set(String(r.REL_ID).trim(), r.REL_START_DATE); }
  }
}
const cycles = [];
const cycName = new Map();
if (process.argv[4]) {
  for (const r of sheetRows(process.argv[4])) {
    if (r.RCYC_ID == null || !r.RCYC_NAME) continue;
    const c = { id: String(r.RCYC_ID).trim(), parentId: String(r.RCYC_PARENT_ID ?? '').trim(), name: String(r.RCYC_NAME).trim(), start: r.RCYC_START_DATE };
    cycles.push(c);
    cycName.set(c.id, c.name);
  }
}
// The export formats some dates as Hebrew text ("31-מאי    -2026") — turn them
// into ISO dates so the dashboards can count by day / month.
const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const heDate = v => {
  const m = typeof v === 'string' && /^\s*(\d{1,2})-\s*([֐-׿]+)\s*-\s*(\d{4})\s*$/.exec(v);
  if (!m) return v;
  const mon = HE_MONTHS.indexOf(m[2]);
  return mon < 0 ? v : `${m[3]}-${String(mon + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
};
const out = rows
  .filter(r => r.DEFECT_ID != null && String(r.DEFECT_ID).trim() !== '')
  .map(r => {
    const o = {};
    for (const [k, v] of Object.entries(r)) {
      const key = String(k).trim();
      if (!key || key.startsWith('__EMPTY')) continue;
      o[key] = v instanceof Date ? v.toISOString() : heDate(v);
    }
    o.DEFECT_ID = String(o.DEFECT_ID).trim();
    for (const k of ['DETECTED_IN_RELEASE', 'TARGET_RELEASE']) {
      if (o[k] != null && relName.has(String(o[k]).trim())) o[k] = relName.get(String(o[k]).trim());
    }
    for (const k of ['DETECTED_IN_CYCLE', 'TARGET_CYCLE']) {
      if (o[k] != null && cycName.has(String(o[k]).trim())) o[k] = cycName.get(String(o[k]).trim());
    }
    return o;
  });
const dest = path.join(__dirname, '..', 'src', 'qc', 'seed-data', 'allbugs.local.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out));
console.log(`wrote ${out.length} real defects -> ${dest}`);
if (relName.size > 0) {
  // same shape as the Oracle RELEASES x RELEASE_CYCLES read (qc.service getReleaseCycleOptions)
  const releases = [...relName.entries()].map(([id, name]) => ({
    id, name, startDate: heDate(relStart.get(id) ?? null),
    cycles: cycles.filter(c => c.parentId === id).map(c => ({ id: c.id, name: c.name, startDate: heDate(c.start ?? null) }))
      .sort((a, b) => String(a.startDate ?? '').localeCompare(String(b.startDate ?? ''))),
  })).sort((a, b) => String(b.startDate ?? '').localeCompare(String(a.startDate ?? '')));
  const rcDest = path.join(path.dirname(dest), 'release-cycles.local.json');
  fs.writeFileSync(rcDest, JSON.stringify(releases));
  console.log(`wrote ${releases.length} releases / ${cycles.length} cycles -> ${rcDest}`);
}

// DEV ONLY: CR testers from a real QC REQ export (REQ.xlsx, "SQL Results"
// sheet: CR_NUMBER = RQ_USER_02, ASSIGN_TO = RQ_USER_05, SECONDARYTESTER =
// RQ_USER_27) → src/qc/seed-data/req-testers.local.json (git-ignored), read by
// QcService.getCrReqTesters when Oracle is disabled. The CR card shows these
// for historical versions DeployCenter never managed.
//
//   node scripts/import-req-testers-seed.js "D:/Downloads (from C)/QC/REQ.xlsx"
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/import-req-testers-seed.js <REQ.xlsx>'); process.exit(1); }
const wb = XLSX.readFile(file);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
const out = {};
for (const r of rows) {
  const cr = String(r.CR_NUMBER ?? '').trim();
  if (!/^\d+$/.test(cr)) continue;
  const e = (out[cr] = out[cr] ?? { assignTo: [], secondary: [] });
  const a = String(r.ASSIGN_TO ?? '').trim();
  const s = String(r.SECONDARYTESTER ?? '').trim();
  if (a && !e.assignTo.includes(a)) e.assignTo.push(a);
  if (s && !e.secondary.includes(s)) e.secondary.push(s);
}
const target = path.join(__dirname, '..', 'src', 'qc', 'seed-data', 'req-testers.local.json');
fs.writeFileSync(target, JSON.stringify(out, null, 1));
console.log(`${Object.keys(out).length} CRs → ${target}`);

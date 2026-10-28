// Shows WHERE the platform saves data and WHAT is inside right now.  Run:  npm run data
// Every service owns one SQLite file inside the "data" folder next to server.js (database per service).
const fs = require('fs'), path = require('path'), Database = require('better-sqlite3');
const dir = path.resolve('data');
if (!fs.existsSync(dir)) { console.log('No data folder yet. Start the server once with: npm start'); process.exit(0); }

const WHO = {
  identity: 'users / logins (phone, role)', patient: 'patient profile + allergies', document: 'uploaded photos + extracted text',
  encounter: 'visits', medication: 'medicines / prescriptions', consent: 'who may see the record', audit: 'access log (append-only)',
  timeline: 'longitudinal timeline (index)', chat: 'WhatsApp conversation state', governance: 'NFR register',
  ayurveda: 'Ayurveda case records', yoga: 'Yoga & Naturopathy case records', unani: 'Unani case records',
  siddha: 'Siddha case records', homoeopathy: 'Homoeopathy case records'
};
const cut = v => typeof v === 'string' && v.length > 60 ? v.slice(0, 60) + '…' : v;

console.log('DATA FOLDER:', dir, '\n');
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.db')).sort()) {
  const p = path.join(dir, f), name = f.replace('.db', '');
  const db = new Database(p, { readonly: true, fileMustExist: true });
  console.log(`=== ${f}  (${(fs.statSync(p).size / 1024).toFixed(0)} KB)  ${WHO[name] ? '- ' + WHO[name] : ''}`);
  for (const { name: t } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
    const n = db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c;
    console.log(`  table ${t}: ${n} row(s)`);
    if (n) console.table(db.prepare(`SELECT * FROM "${t}" ORDER BY rowid DESC LIMIT 3`).all().map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cut(v)]))));
  }
  db.close();
}
const up = path.join(dir, 'uploads');
console.log(`\nPHOTOS: ${fs.existsSync(up) ? fs.readdirSync(up).length : 0} file(s) in ${up}`);
console.log(`WHATSAPP LOGIN SESSION: ${fs.existsSync(path.join(dir, 'wa_auth')) ? 'saved in ' + path.join(dir, 'wa_auth') + ' (keep private)' : 'none yet'}`);

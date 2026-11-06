// WhatsApp channel for the AYUSH platform (ported from the v3_5 project onto this project's database).
// Same patient record as the website: the mobile number is the key. Languages: English, Hindi, Kannada.
// Voice notes: set STT_URL (+ STT_KEY, STT_MODEL) to any OpenAI-compatible /audio/transcriptions endpoint to read them.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { M, LANGS } = require('./i18n');
const makeDrivers = require('./drivers');
const reader = require('./reader');

const { uuid, now } = db;
const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || path.join(__dirname, '..', 'storage'));
fs.mkdirSync(STORAGE_DIR, { recursive: true });

db.exec(`CREATE TABLE IF NOT EXISTS wa_chats (
  chat_key TEXT PRIMARY KEY, phone TEXT, state TEXT NOT NULL DEFAULT 'new', data TEXT NOT NULL DEFAULT '{}', lang TEXT NOT NULL DEFAULT 'en', updated_at TEXT
);`);

db.exec(`CREATE TABLE IF NOT EXISTS wa_drafts (
  draft_id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id TEXT NOT NULL, upload_id INTEGER, extracted TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'review', created_at TEXT NOT NULL
);`);

const SYSTEMS = { ayurveda: 'Ayurveda', yoga: 'Yoga & Naturopathy', unani: 'Unani', siddha: 'Siddha', homoeopathy: 'Homoeopathy', homeopathy: 'Homoeopathy' };
const SYSTEM_WORDS = { // typed words that tell us the AYUSH system (English, Hindi, Kannada)
  Ayurveda: ['ayurveda', 'आयुर्वेद', 'ಆಯುರ್ವೇದ'], 'Yoga & Naturopathy': ['yoga', 'naturopathy', 'योग', 'ಯೋಗ'], Unani: ['unani', 'यूनानी', 'ಯುನಾನಿ'],
  Siddha: ['siddha', 'सिद्ध', 'ಸಿದ್ಧ'], Homoeopathy: ['homoeopathy', 'homeopathy', 'होम्योपैथी', 'ಹೋಮಿಯೋಪತಿ'],
};
const FORM_WORDS = /(churna|choornam|chooranam|tailam|taila|thailam|vati|vatika|gutika|kashayam|kwath|arishta|asava|bhasma|ghrita|lehyam|leha|tablet|tab\b|capsule|cap\b|syrup|drops|ointment|powder|चूर्ण|तेल|वटी|गोली|काढ़ा|ಚೂರ್ಣ|ತೈಲ|ವಟಿ|ಮಾತ್ರೆ|ಕಷಾಯ)/i;
const DOSE = /(\d+(?:\.\d+)?\s?(?:mg|g|gm|gram|grams|ml|tab|tabs|tablet|tablets|drops|spoon|tsp|tbsp|ಗ್ರಾಂ|ग्राम))/i;
const TIMING = /(morning|night|bedtime|evening|afternoon|before food|after food|empty stomach|twice a day|once a day|thrice|subah|raat|सुबह|रात|शाम|ಬೆಳಿಗ್ಗೆ|ರಾತ್ರಿ|ಸಂಜೆ)/i;
const DURATION = /(\d+\s?(?:days?|weeks?|months?|din|दिन|हफ्ते|महीने|ದಿನ|ವಾರ|ತಿಂಗಳು))/i;

const rnd = (n) => Array.from({ length: n }, () => crypto.randomInt(0, 10)).join('');
const uniqueCode = (prefix, table, col, gen) => { for (;;) { const c = `${prefix}${gen()}`; if (!db.prepare(`SELECT 1 FROM ${table} WHERE ${col}=?`).get(c)) return c; } };
const digits = (s) => String(s || '').replace(/\D/g, '');
const isMobile = (m) => /^[6-9]\d{9}$/.test(String(m || ''));

// ---------- patient data (same tables the website uses) ----------
const patientByMobile = (m) => db.prepare('SELECT * FROM patients WHERE mobile_number = ?').get(m);
const userOf = (p) => db.prepare(`SELECT * FROM user_accounts WHERE linked_profile_id = ? AND account_type = 'Patient'`).get(p.patient_id);

function registerPatient({ name, mobile, dob, allergies }) {
  const pid = uuid(); const uid = uuid(); const t = now();
  const healthId = uniqueCode('91-', 'patients', 'health_id', () => `${rnd(4)}-${rnd(4)}-${rnd(4)}`);
  const consultationId = uniqueCode('C-', 'encounters', 'consultation_code', () => rnd(9));
  const enc = uuid();
  db.transaction(() => {
    db.prepare(`INSERT INTO patients (patient_id,health_id,full_name,date_of_birth,mobile_number,mobile_verified,account_status,created_at,updated_at) VALUES (?,?,?,?,?,1,'Active',?,?)`).run(pid, healthId, name, dob, mobile, t, t);
    db.prepare(`INSERT INTO user_accounts (user_id,mobile_number,account_type,linked_profile_id,created_at) VALUES (?,?, 'Patient', ?, ?)`).run(uid, mobile, pid, t);
    db.prepare(`INSERT INTO encounters (encounter_id,consultation_code,patient_id,status) VALUES (?,?,?, 'Scheduled')`).run(enc, consultationId, pid);
    db.prepare(`INSERT INTO consent_records (consent_id,user_id,subject_profile_id,purpose,notice_version,consent_status,captured_at,capture_method) VALUES (?,?,?, 'privacy notice and terms', 'v1', 'Granted', ?, 'Mobile')`).run(uuid(), uid, pid, t);
    if (allergies) db.prepare(`INSERT INTO patient_medical_history (history_id,patient_id,allergies,reported_by,recorded_at) VALUES (?,?,?, 'Patient', ?)`).run(uuid(), pid, allergies, t);
    db.prepare(`INSERT INTO audit_logs (audit_log_id,actor_user_id,action,entity_type,entity_reference_id,timestamp,result,reason) VALUES (?,?,?,?,?,?,?,?)`).run(uuid(), uid, 'CREATE', 'patient', pid, t, 'Success', 'registered on WhatsApp');
  })();
  return { healthId, patientId: pid };
}

const allergiesOf = (p) => db.prepare(`SELECT allergies a FROM patient_medical_history WHERE patient_id = ? AND allergies IS NOT NULL AND allergies != '' ORDER BY recorded_at DESC`).all(p.patient_id).map((r) => r.a).join(', ');
const grantsOf = (p) => db.prepare(`SELECT cr.consent_id id, d.doctor_code code, d.full_name name, g.expires_at exp FROM consent_records cr JOIN consent_grants g ON g.consent_id = cr.consent_id JOIN doctors d ON d.doctor_id = g.doctor_id
  WHERE cr.subject_profile_id = ? AND cr.purpose = 'health-data sharing' AND cr.consent_status = 'Granted' AND (g.expires_at IS NULL OR g.expires_at > ?)`).all(p.patient_id, now());
const recordsOf = (p) => db.prepare(`SELECT r.record_id id, r.saved_at, r.ayush_system sys, r.problem, r.diagnosis, x.prescription_details meds FROM patient_records r LEFT JOIN prescriptions x ON x.prescription_id = r.prescription_id WHERE r.patient_id = ? ORDER BY r.record_id DESC`).all(p.patient_id)
  .map((r) => ({ ...r, meds: JSON.parse(r.meds || '[]') }));
const fmtMed = (m) => `• ${m.name}${[m.dose, m.timing, m.duration].filter(Boolean).map((v) => ` – ${v}`).join('')}`;

function saveRecord(p, d) {
  const enc = db.prepare('SELECT * FROM encounters WHERE patient_id = ? ORDER BY rowid LIMIT 1').get(p.patient_id); const t = d.date ? `${d.date}T00:00:00.000Z` : now(); const rx = uuid();
  db.transaction(() => {
    db.prepare(`INSERT INTO prescriptions (prescription_id,encounter_id,patient_id,prescription_details,instructions,issued_at) VALUES (?,?,?,?,?,?)`).run(rx, enc.encounter_id, p.patient_id, JSON.stringify(d.meds), d.advice || '', t);
    if (d.problem) db.prepare(`INSERT INTO patient_health_concerns (concern_id,patient_id,symptoms,recorded_at,encounter_id) VALUES (?,?,?,?,?)`).run(uuid(), p.patient_id, d.problem, t, enc.encounter_id);
    if (d.allergies && !allergiesOf(p).toLowerCase().includes(d.allergies.toLowerCase())) db.prepare(`INSERT INTO patient_medical_history (history_id,patient_id,allergies,reported_by,recorded_at) VALUES (?,?,?, 'Patient', ?)`).run(uuid(), p.patient_id, d.allergies, now());
    db.prepare(`INSERT INTO patient_records (patient_id,prescription_id,document_type,file_name,ayush_system,problem,diagnosis,prakriti,saved_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(p.patient_id, rx, d.docType || 'Typed on WhatsApp', d.fileName || null, d.system, d.problem || '', d.diagnosis || '', d.prakriti || '', t);
  })();
}

// ---------- reading a photo / PDF / typed text into a draft, safety check, summary (ported from platform v3.5) ----------
const SYS_KEY = { Ayurveda: 'ayurveda', 'Yoga & Naturopathy': 'yoga', Unani: 'unani', Siddha: 'siddha', Homoeopathy: 'homoeopathy' };
const SYS_NAME = reader.SYSL; // key -> display name used in the database
const typedToDraft = (text) => { // rules for typed English / Hindi / Kannada text, used when no AI key is set
  const d = parseDescription(text);
  const x = { system: SYS_KEY[d.system] || '', doctor: '', date: '', complaint: d.problem, diagnosis: '', advice: '', allergies: '', findings: {}, results: [], summary: '',
    medicines: d.meds.map((m) => ({ name: m.name, dose: m.dose, freq: m.timing, duration: m.duration, extra: {} })), _engine: 'rules' };
  x.summary = reader.makeSummary(x); x._sumAuto = true; return x;
};
const readTyped = async (text) => {
  if (process.env.ANTHROPIC_API_KEY) { try { return (await reader.readInput({ text })).ex; } catch (e) { console.error('typed read failed', e.message); } }
  return typedToDraft(text);
};
const draftToRecord = (x, extra = {}) => ({
  system: SYS_NAME[x.system], problem: x.complaint || '', diagnosis: x.diagnosis || '', prakriti: x.findings?.Prakriti || '', advice: x.advice || '', allergies: x.allergies || '', date: /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') ? x.date : '',
  meds: (x.medicines || []).map((m) => ({ name: m.name, dose: m.dose || '', timing: m.freq || '', duration: m.duration || '', ...(Object.keys(m.extra || {}).length ? { extra: m.extra } : {}) })), ...extra,
});
function safety(p, meds, systemName) {
  const w = []; const al = allergiesOf(p).toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const recent = recordsOf(p).filter((r) => r.saved_at > new Date(Date.now() - 30 * 864e5).toISOString());
  const recentNames = new Set(recent.flatMap((r) => r.meds.map((m) => String(m.name).toLowerCase())));
  for (const m of meds) {
    const n = m.name.toLowerCase();
    if (al.some((a) => n.includes(a))) w.push(`${m.name} may contain something you are allergic to (${allergiesOf(p)}).`);
    if (/parpam|chenduram|bhasma/.test(n)) w.push(`${m.name} is a metal/mineral preparation. Take only the exact dose and duration prescribed.`);
    if (recentNames.has(n)) w.push(`${m.name} was already recorded in the last 30 days (possible duplicate).`);
  }
  const other = [...new Set(recent.filter((r) => r.sys !== systemName).map((r) => r.sys))];
  if (other.length && meds.length) w.push(`You also took medicines from ${other.join(', ')} recently. Tell each practitioner so they can check combinations.`);
  return w;
}
function savedSummary(p, x, rec, warnings, header) {
  const fd = Object.entries(x.findings || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ');
  const meds = rec.meds.map((md) => { const ex = Object.entries(md.extra || {}).filter(([k, v]) => (reader.MEDF[x.system] || []).includes(k) && v).map(([k, v]) => `${k}: ${v}`).join(', '); return `${fmtMed(md)}${ex ? ` (${ex})` : ''}`; }).join('\n') || '• none';
  const date = rec.date || now().slice(0, 10);
  const ends = rec.meds.map((md) => { const r = (md.duration || '').match(/(\d+)\s*(day|week|month)/i); const d = new Date(date); if (!r || Number.isNaN(d.getTime())) return 0; d.setDate(d.getDate() + +r[1] * ({ day: 1, week: 7, month: 30 }[r[2].toLowerCase()])); return d; }).filter(Boolean).sort((a, b) => b - a)[0];
  const sum = (x._sumAuto || !x.summary) ? reader.makeSummary({ ...x, medicines: x.medicines }) : String(x.summary).slice(0, 800);
  return [`${header} — ${rec.system}`, `Date: ${date}${x.doctor ? ` · ${x.doctor}` : ''}`, `For: ${x.diagnosis || x.complaint || '-'}`, sum ? `Summary: ${sum}` : '', fd, `Medicines:\n${meds}`, ends ? `Course ends around: ${ends.toISOString().slice(0, 10)}` : '', x.advice ? `Advice: ${x.advice}` : '', allergiesOf(p) ? `Allergies on record: ${allergiesOf(p)}` : '', ...warnings.map((w) => `⚠ ${w}`)].filter(Boolean).join('\n');
}
// the draft the patient checks before anything is saved
function draftText(x) {
  const meds = (x.medicines || []).slice(0, 6).map((m, i) => `${i + 1}. ${m.name}${[m.dose, m.freq, m.duration].filter(Boolean).map((v) => ` – ${v}`).join('')}${Object.keys(m.extra || {}).length ? ` (${Object.entries(m.extra).map(([k, v]) => `${k}: ${v}`).join(', ')})` : ''}`).join('\n') || '(none found)';
  const fd = Object.entries(x.findings || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ');
  const sm = x._sumAuto ? reader.makeSummary(x) : x.summary; const rs = (x.results || []).slice(0, 8).map((r) => `• ${r.test}: ${r.value}${r.range ? ` (normal ${r.range})` : ''}`).join('\n');
  return `I read this (${x._engine || 'rules'}):\n\n${sm ? `📝 Summary: ${sm}\n\n` : ''}System: ${x.system ? SYS_NAME[x.system] : '❓ not sure'}\nDoctor: ${x.doctor || '-'}\nDate: ${x.date || '-'}\nDiagnosis/complaint: ${x.diagnosis || x.complaint || '-'}${fd ? `\n${fd}` : ''}\nMedicines:\n${meds}${rs ? `\nResults:\n${rs}` : ''}${x.allergies ? `\nAllergies: ${x.allergies}` : ''}${/Tesseract|basic|rules/.test(x._engine || '') ? '\n\nℹ Basic reader: please check every line carefully. Use "Edit here" to fix mistakes.' : ''}`;
}
const EDITROWS = [['f_system', 'Medical system'], ['f_doctor', 'Doctor'], ['f_date', 'Visit date'], ['f_diagnosis', 'Diagnosis'], ['f_findings', 'System findings', 'Prakriti, Mizaj, Mukkutram…'], ['f_addmed', 'Add a medicine'], ['f_delmed', 'Remove a medicine'], ['f_advice', 'Diet / lifestyle advice'], ['f_allergies', 'Allergies'], ['f_summary', 'Summary']];
const EDIT_PROMPT = { system: 'Type the system: ayurveda / siddha / unani / yoga / homoeopathy', doctor: "Type the doctor's name", date: 'Type the visit date like 2026-10-22', diagnosis: 'Type the diagnosis', findings: 'Type one finding like: Prakriti: Vata-Pitta',
  addmed: 'Type the medicine in your own words, e.g. Ashwagandha churna 5 g twice daily for 15 days', delmed: 'Type the number of the medicine to remove', advice: 'Type the diet / lifestyle advice', allergies: 'Type the allergies', summary: 'Type the summary you want saved' };

// unregister: delete the patient and everything that belongs to them
function deletePatient(p) {
  const u = userOf(p);
  const del = (sql, ...a) => { try { db.prepare(sql).run(...a); } catch (e) { e.message += ` [${sql}]`; throw e; } };
  db.transaction(() => {
    for (const f of db.prepare('SELECT document_reference r FROM patient_uploads WHERE patient_id = ?').all(p.patient_id)) { try { fs.unlinkSync(path.join(STORAGE_DIR, f.r)); } catch (e) { /* already gone */ } }
    del('DELETE FROM wa_drafts WHERE patient_id = ?', p.patient_id);
    del('DELETE FROM patient_records WHERE patient_id = ?', p.patient_id);
    del('DELETE FROM prescriptions WHERE patient_id = ?', p.patient_id);
    del('DELETE FROM face_profiles WHERE mobile_number = ?', p.mobile_number);
    del('DELETE FROM patient_health_concerns WHERE patient_id = ?', p.patient_id);
    del('DELETE FROM patient_identity_references WHERE patient_id = ?', p.patient_id);
    del('DELETE FROM biometric_verifications WHERE consent_id IN (SELECT consent_id FROM consent_records WHERE subject_profile_id = ?)', p.patient_id);
    del('DELETE FROM consent_grants WHERE consent_id IN (SELECT consent_id FROM consent_records WHERE subject_profile_id = ?)', p.patient_id);
    del('DELETE FROM face_profiles WHERE consent_id IN (SELECT consent_id FROM consent_records WHERE subject_profile_id = ?)', p.patient_id);
    del('DELETE FROM consent_records WHERE subject_profile_id = ?', p.patient_id);
    if (u) {
      del('DELETE FROM face_profiles WHERE consent_id IN (SELECT consent_id FROM consent_records WHERE user_id = ?)', u.user_id);
      del('DELETE FROM biometric_verifications WHERE consent_id IN (SELECT consent_id FROM consent_records WHERE user_id = ?)', u.user_id);
      del('DELETE FROM patient_identity_references WHERE consent_id IN (SELECT consent_id FROM consent_records WHERE user_id = ?)', u.user_id);
      del('DELETE FROM consent_grants WHERE consent_id IN (SELECT consent_id FROM consent_records WHERE user_id = ?)', u.user_id);
      del('DELETE FROM consent_records WHERE user_id = ?', u.user_id);
      del('DELETE FROM authentication_events WHERE user_id = ?', u.user_id);
      del('DELETE FROM biometric_verifications WHERE user_id = ?', u.user_id);
      del('DELETE FROM user_accounts WHERE user_id = ?', u.user_id);
    }
    del('DELETE FROM patients WHERE patient_id = ?', p.patient_id);
    del('DELETE FROM wa_chats WHERE phone = ?', p.mobile_number);
  })();
}

// Understand a typed or spoken description (English / Hindi / Kannada keywords). The patient checks it before saving.
function parseDescription(text) {
  const low = text.toLowerCase();
  const system = Object.entries(SYSTEM_WORDS).find(([, ws]) => ws.some((w) => low.includes(w.toLowerCase())))?.[0] || 'Ayurveda';
  const parts = text.split(/[\n;.।]+/).map((s) => s.trim()).filter(Boolean);
  const meds = []; const problem = [];
  for (const part of parts) {
    const isSystemWord = Object.values(SYSTEM_WORDS).flat().some((w) => part.toLowerCase() === w.toLowerCase());
    if (isSystemWord) continue;
    if (FORM_WORDS.test(part) || DOSE.test(part)) {
      const dose = (part.match(DOSE) || [])[1] || ''; const timing = (part.match(TIMING) || [])[1] || ''; const duration = (part.match(DURATION) || [])[1] || '';
      let name = part;
      [dose, timing, duration].filter(Boolean).forEach((x) => { name = name.replace(x, ''); });
      name = name.replace(/\b(for|at|take|with|warm water|daily)\b/gi, ' ').replace(/[,]+/g, ' ').replace(/\s+/g, ' ').trim();
      meds.push({ name: name || part, dose, timing, duration });
    } else problem.push(part);
  }
  return { system, problem: problem.join(', ').slice(0, 300), meds: meds.slice(0, 8) };
}

const transcribe = (audio, lang) => voice.transcribe(audio, lang); // speech-to-text lives in whatsapp/voice.js

const voice = require('./voice');

module.exports = function install(app) {
  let ch;
  const T = (to, t) => ch.text(to, t);
  const B = (to, t, b) => ch.buttons(to, t, b);
  const L = (to, t, label, rows) => ch.list(to, t, label, rows);
  const MENU_IDS = Object.keys(M.en.rows);
  const menu = (to, lang, name) => L(to, M[lang].menuIntro(name), M[lang].menuBtn, MENU_IDS.map((id) => [id, ...M[lang].rows[id]]));
  const langButtons = (to) => B(to, `${M.en.pickLang}\n${M.hi.pickLang}\n${M.kn.pickLang}`, LANGS.map((l) => [`lang_${l}`, M[l].name]));

  const confirmButtons = (to, x, S) => (x.system ? B(to, `${draftText(x)}\n\nSave this to your record?`, [['save', S().save], ['edit', 'Edit here'], ['cancel', S().cancel]])
    : T(to, `${draftText(x)}\n\nI am not sure which AYUSH system this is. Please type one: ayurveda / siddha / unani / yoga / homoeopathy`));
  // keep a draft (so "My uploads" can bring it back) and ask the patient to check it
  const startDraft = async (to, p, x, uploadId, S) => {
    const empty = !x || (!x.system && !(x.medicines || []).length && !(x.results || []).length && !x.diagnosis && !x.complaint && !(x.summary && !x._sumAuto));
    if (empty) { setState('ready'); return T(to, `I could not read anything clear from this${x?._note ? ` (${x._note})` : ''}.\n\nPlease send a clearer, well-lit photo, or type "add" and describe the visit or medicines in your own words.`); }
    const id = db.prepare('INSERT INTO wa_drafts (patient_id,upload_id,extracted,status,created_at) VALUES (?,?,?,?,?)').run(p.patient_id, uploadId || null, JSON.stringify(x), 'review', now()).lastInsertRowid;
    setState('confirm', { draftId: id, x });
    return confirmButtons(to, x, S);
  };

  // typed menu words (any of the three languages) -> menu id
  const ALIAS = { hi: 'm_menu', hello: 'm_menu', menu: 'm_menu', help: 'm_menu', summary: 'm_summary', timeline: 'm_timeline', medicines: 'm_meds', medicine: 'm_meds', allergies: 'm_allergy', allergy: 'm_allergy', add: 'm_add', type: 'm_add', uploads: 'm_uploads', access: 'm_access', allow: 'm_grant', language: 'm_lang', face: 'm_face', system: 'm_system', unregister: 'm_delete', delete: 'm_delete', 'delete my data': 'm_delete',
    'मेनू': 'm_menu', 'सारांश': 'm_summary', 'दवाइयाँ': 'm_meds', 'ಮೆನು': 'm_menu', 'ಸಾರಾಂಶ': 'm_summary', 'ಔಷಧಿಗಳು': 'm_meds' };

  let setState = () => {}; // the bot's state setter for the chat being handled (messages of one chat run one at a time)
  async function handle(m) {
    const to = m.from; let text = (m.text || '').trim();
    const row = db.prepare('SELECT * FROM wa_chats WHERE chat_key = ?').get(to);
    let st = row?.state || 'new'; let data = JSON.parse(row?.data || '{}'); let lang = row?.lang || 'en';
    let phone = row?.phone || (m.pn ? m.pn.slice(-10) : '');
    const save = () => db.prepare(`INSERT INTO wa_chats (chat_key,phone,state,data,lang,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(chat_key) DO UPDATE SET phone=excluded.phone,state=excluded.state,data=excluded.data,lang=excluded.lang,updated_at=excluded.updated_at`).run(to, phone, st, JSON.stringify(data), lang, now());
    const set = (s, d = {}) => { st = s; data = d; save(); };
    const S = () => M[lang];
    setState = set;

    // voice note -> text (if a speech-to-text service is configured)
    if (m.audio && !text) {
      if (!voice.available()) return T(to, S().voiceOff);
      try { text = await transcribe(m.audio, lang) || ''; } catch (e) { console.error('voice note failed', e.message); }
      if (!text) return T(to, S().voiceFail);
      await T(to, `🎤 “${text}”`);
      text = voice.clean(text, st); // tidy what was said for the current step
    }

    // language choice works at any time
    if (/^lang_(en|hi|kn)$/.test(text)) { lang = text.slice(5); save(); await T(to, S().langSet); if (st === 'lang') set('new'); text = ''; if (patientByMobile(phone)) return menu(to, lang, patientByMobile(phone).full_name); }

    // WhatsApp usually tells us the number; if it hides it we ask once
    if (!isMobile(phone)) {
      if (st === 'phone') {
        const d = digits(text).slice(-10);
        if (!isMobile(d)) return T(to, S().badPhone);
        phone = d; set('new');
      } else {
        if (!row) { set('lang'); return langButtons(to); }
        set('phone'); return T(to, S().askPhone);
      }
    }
    const p = patientByMobile(phone);
    const low = text.toLowerCase();
    const EXIT = /^(bye|goodbye|exit|end|quit|stop)$/.test(low);
    if (EXIT) { set('new'); return T(to, p ? S().bye : S().stopped); }

    if (!row) { set('lang'); return langButtons(to); }
    if (st === 'lang') return langButtons(to);

    // ---------- not registered yet: opt-in -> name -> date of birth -> allergies -> consent ----------
    if (!p) {
      const YES = /^(yes|y|ok|okay|i agree|agree|haan|ha|हाँ|हां|ಹೌದು|ಒಪ್ಪುತ್ತೇನೆ)$/i; const NO = /^(no|n|not now|nahi|नहीं|ಬೇಡ|ಇಲ್ಲ)$/i;
      if (m.image || m.unsupported) { return T(to, S().needRegister); }
      if (st === 'optin') {
        if (NO.test(low) || low === 'no') { set('new'); return T(to, S().declined); }
        if (!(YES.test(low) || low === 'yes')) return B(to, S().welcome, [['yes', S().yes], ['no', S().no]]);
        set('name'); return T(to, S().askName);
      }
      if (st === 'name' && text) { set('dob', { name: text.slice(0, 80) }); return T(to, S().askDob(data.name)); }
      if (st === 'dob') {
        const mm = text.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})$/);
        const iso = mm ? `${mm[3]}-${mm[2].padStart(2, '0')}-${mm[1].padStart(2, '0')}` : '';
        if (!iso || Number.isNaN(Date.parse(iso)) || iso > now().slice(0, 10) || iso < '1900-01-01') return T(to, S().badDob);
        set('allergy', { ...data, dob: iso }); return T(to, S().askAllergy);
      }
      if (st === 'allergy' && text) {
        const none = S().none.includes(low);
        set('consent', { ...data, allergies: none ? '' : text.slice(0, 160) }); return B(to, S().consent, [['yes', S().agree], ['no', S().disagree]]);
      }
      if (st === 'consent') {
        if (NO.test(low)) { set('new'); return T(to, S().declined); }
        if (!(YES.test(low) || low === 'yes')) return B(to, S().consent, [['yes', S().agree], ['no', S().disagree]]);
        if (patientByMobile(phone)) { set('ready'); return menu(to, lang, ''); }
        const r = registerPatient({ name: data.name, mobile: phone, dob: data.dob, allergies: data.allergies });
        const nm = data.name; set('ready');
        await T(to, S().registered(r.healthId, phone));
        return menu(to, lang, nm);
      }
      set('optin'); return B(to, S().welcome, [['yes', S().yes], ['no', S().no]]);
    }

    // ---------- registered patient ----------
    if (m.image) {
      if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(m.image.mime || '')) return T(to, S().unsupported);
      const buf = await m.image.get();
      const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' }[m.image.mime];
      const file = `${uuid()}${ext}`; const fpath = path.join(STORAGE_DIR, file);
      fs.writeFileSync(fpath, buf);
      const up = db.prepare('INSERT INTO patient_uploads (patient_id,file_name,mime_type,size,document_reference,uploaded_at) VALUES (?,?,?,?,?,?)').run(p.patient_id, `whatsapp${ext}`, m.image.mime, buf.length, file, now());
      await T(to, '📷 Got it. Reading your document… this can take up to a minute.');
      let x;
      try { x = (await reader.readInput({ file: fpath, mime: m.image.mime })).ex; } catch (e) { console.error('reading failed', e.message); x = null; }
      return startDraft(to, p, x, up.lastInsertRowid, S);
    }
    if (m.unsupported) return T(to, S().unsupported);

    // unregister: ask once, then delete everything
    if (st === 'delete') {
      if (['del_yes', 'yes', 'y', 'delete'].includes(low)) { deletePatient(p); return T(to, 'Your account and all your records have been deleted. Message "Hi" any time if you want to register again.'); }
      set('ready'); return T(to, 'Okay, nothing was deleted. Type "menu" to continue.');
    }
    // resume a draft that was left under "My uploads"
    if (low.startsWith('resume_')) {
      const d = db.prepare("SELECT * FROM wa_drafts WHERE draft_id = ? AND patient_id = ? AND status = 'review'").get(+low.slice(7), p.patient_id);
      if (!d) return T(to, 'I could not find that upload.');
      const x = JSON.parse(d.extracted); set('confirm', { draftId: d.draft_id, x }); return confirmButtons(to, x, S);
    }
    // editing one field of the draft
    if (st === 'editing' && text) {
      const x = data.x; const f = data.field;
      if (f === 'doctor') x.doctor = text; else if (f === 'diagnosis') x.diagnosis = text; else if (f === 'advice') x.advice = text; else if (f === 'allergies') x.allergies = text;
      else if (f === 'summary') { x.summary = text.slice(0, 800); x._sumAuto = false; }
      else if (f === 'date') { if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return T(to, 'Please type the date like 2026-10-22'); x.date = text; }
      else if (f === 'findings') { const [k, ...v] = text.split(':'); if (!v.length) return T(to, 'Type it like: Prakriti: Vata-Pitta'); x.findings = x.findings || {}; x.findings[k.trim().replace(/^./, (c) => c.toUpperCase())] = v.join(':').trim(); }
      else if (f === 'delmed') { const i = parseInt(text, 10) - 1; if (!(x.medicines || [])[i]) return T(to, 'Type a medicine number from the list.'); x.medicines.splice(i, 1); }
      else if (f === 'addmed') { const y = await readTyped(text); x.medicines = [...(x.medicines || []), ...(y.medicines || [])]; }
      db.prepare('UPDATE wa_drafts SET extracted = ? WHERE draft_id = ?').run(JSON.stringify(x), data.draftId);
      set('confirm', { draftId: data.draftId, x }); return confirmButtons(to, x, S);
    }
    // answers to a draft record: save / edit / cancel (a safety check runs before saving)
    if (st === 'confirm' || st === 'warn') {
      const x = data.x;
      if (reader.SYS.includes(low)) { x.system = low; db.prepare('UPDATE wa_drafts SET extracted = ? WHERE draft_id = ?').run(JSON.stringify(x), data.draftId); set('confirm', data); return confirmButtons(to, x, S); }
      if (['cancel', 'no'].includes(low)) { set('ready'); return T(to, S().cancelled); }
      if (low === 'edit') return L(to, 'What would you like to change?', 'Choose field', EDITROWS);
      if (low.startsWith('f_')) { const f = low.slice(2); if (f === 'system') return T(to, EDIT_PROMPT.system); set('editing', { ...data, field: f }); return T(to, EDIT_PROMPT[f] || 'Type the new value'); }
      if (low === 'save' || (st === 'warn' && ['yes', 'save'].includes(low))) {
        if (!x.system) return T(to, 'Please type the system first: ayurveda / siddha / unani / yoga / homoeopathy');
        const up = data.draftId && db.prepare('SELECT u.file_name f FROM wa_drafts d LEFT JOIN patient_uploads u ON u.upload_id = d.upload_id WHERE d.draft_id = ?').get(data.draftId);
        const rec = draftToRecord(x, { docType: up?.f ? 'WhatsApp photo' : 'Typed on WhatsApp', fileName: up?.f || null });
        const warnings = safety(p, rec.meds, rec.system);
        if (warnings.length && st !== 'warn') { set('warn', data); return B(to, `${warnings.map((w) => `⚠ ${w}`).join('\n')}\n\nSave anyway?`, [['yes', 'Save anyway'], ['cancel', S().cancel]]); }
        saveRecord(p, rec);
        if (data.draftId) db.prepare("UPDATE wa_drafts SET status = 'saved' WHERE draft_id = ?").run(data.draftId);
        set('ready'); await T(to, savedSummary(p, x, rec, warnings, S().saved)); return T(to, 'Type "menu" to see your records.');
      }
      return confirmButtons(to, x, S);
    }
    if (st === 'typing' && text && !ALIAS[low] && !low.startsWith('m_')) {
      if (text.length < 4) return T(to, S().tooShort);
      await T(to, '📝 Reading your description…');
      return startDraft(to, p, await readTyped(text), null, S);
    }

    const id = low.startsWith('m_') || low.startsWith('grant_') || low.startsWith('revoke_') || low.startsWith('sys_') ? low : ALIAS[low];
    if (id === 'm_menu' || (!id && ['ready', 'new', 'optin', 'name', 'dob', 'allergy', 'consent'].includes(st) && !text)) { set('ready'); return menu(to, lang, p.full_name); }
    if (id === 'm_summary') {
      const recs = recordsOf(p);
      return T(to, S().summary({ name: p.full_name, healthId: p.health_id, allergies: allergiesOf(p), records: recs.length, uploads: db.prepare('SELECT COUNT(*) c FROM patient_uploads WHERE patient_id=?').get(p.patient_id).c, doctors: grantsOf(p).length, last: recs[0] ? recs[0].saved_at.slice(0, 10) : '' }));
    }
    if (id === 'm_timeline') {
      const recs = recordsOf(p).slice(0, 5);
      return T(to, recs.length ? recs.map((r) => `📅 ${r.saved_at.slice(0, 10)} · ${r.sys}\n${r.diagnosis || r.problem || '-'}${r.meds.length ? `\n${r.meds.map(fmtMed).join('\n')}` : ''}`).join('\n\n') : S().noTimeline);
    }
    if (id === 'm_meds') {
      const meds = recordsOf(p).flatMap((r) => r.meds.map((x) => ({ ...x, sys: r.sys })));
      if (!meds.length) return T(to, S().noMeds);
      const by = {}; meds.forEach((x) => { (by[x.sys] = by[x.sys] || []).push(x); });
      return T(to, Object.entries(by).map(([s, l]) => `${s}\n${l.slice(0, 8).map(fmtMed).join('\n')}`).join('\n\n'));
    }
    if (id === 'm_allergy') { const a = allergiesOf(p); return T(to, a ? S().allergyIs(a) : S().noAllergy); }
    if (id === 'm_add') { set('typing'); return T(to, S().typePrompt); }
    if (id === 'm_uploads') {
      const u = db.prepare('SELECT upload_id id, uploaded_at t FROM patient_uploads WHERE patient_id = ? ORDER BY upload_id DESC LIMIT 10').all(p.patient_id);
      const pend = db.prepare("SELECT draft_id id, created_at t FROM wa_drafts WHERE patient_id = ? AND status = 'review' ORDER BY draft_id DESC LIMIT 10").all(p.patient_id);
      await T(to, u.length ? S().uploads(u.map((x) => `#U-${x.id} · ${x.t.slice(0, 10)}`).join('\n')) : S().noUploads);
      if (pend.length) await L(to, 'Finish a pending upload here.', 'Finish upload', pend.map((x) => [`resume_${x.id}`, `Draft #${x.id}`, x.t.slice(0, 10)]));
      return;
    }
    if (id === 'm_system') return L(to, 'Which AYUSH system?', 'Choose system', Object.entries(reader.SYSL).map(([k, v]) => [`sys_${k}`, v]));
    if (id && id.startsWith('sys_')) {
      const name = reader.SYSL[id.slice(4)]; const recs = recordsOf(p).filter((r) => r.sys === name).slice(0, 4);
      return T(to, `${name}\n\n` + (recs.length ? recs.map((r) => `📅 ${r.saved_at.slice(0, 10)}\n${r.diagnosis || r.problem || '-'}${r.meds.length ? `\n${r.meds.map(fmtMed).join('\n')}` : ''}`).join('\n\n') : 'No records for this system yet.'));
    }
    if (id === 'm_delete') { set('delete'); return B(to, '⚠ Unregister?\nThis will permanently delete your profile, photos, records, medicines and doctor permissions. It cannot be undone.\n\nDelete everything?', [['del_yes', 'Yes, delete all'], ['del_no', 'No, keep it']]); }
    if (id === 'm_access') {
      const g = grantsOf(p);
      if (!g.length) return T(to, S().accessNone);
      await T(to, S().accessList(g.map((x) => `• ${x.name} (${x.code})${x.exp ? ` – ${x.exp.slice(0, 10)}` : ''}`).join('\n')));
      return L(to, S().revokePrompt, S().revokeBtn, g.map((x) => [`revoke_${x.id}`, x.name]));
    }
    if (id === 'm_grant') {
      const docs = db.prepare(`SELECT doctor_code c, full_name n, ayush_system s FROM doctors WHERE profile_status IN ('Approved','Active') ORDER BY full_name LIMIT 10`).all();
      if (!docs.length) return T(to, S().noDoctors);
      return L(to, S().pickDoctor, S().pickDoctorBtn, docs.map((d) => [`grant_${d.c}`, d.n, d.s]));
    }
    if (id && id.startsWith('grant_')) {
      const d = db.prepare(`SELECT * FROM doctors WHERE doctor_code = ? AND profile_status IN ('Approved','Active')`).get(text.slice(6));
      if (!d) return T(to, S().unknown);
      const cid = uuid(); const u = userOf(p);
      db.transaction(() => {
        db.prepare(`INSERT INTO consent_records (consent_id,user_id,subject_profile_id,purpose,notice_version,consent_status,captured_at,capture_method) VALUES (?,?,?, 'health-data sharing', 'v1', 'Granted', ?, 'Mobile')`).run(cid, u && u.user_id, p.patient_id, now());
        db.prepare('INSERT INTO consent_grants (consent_id,doctor_id,expires_at) VALUES (?,?,?)').run(cid, d.doctor_id, new Date(Date.now() + 30 * 864e5).toISOString());
      })();
      return T(to, S().granted);
    }
    if (id && id.startsWith('revoke_')) {
      db.prepare(`UPDATE consent_records SET consent_status='Withdrawn', withdrawn_at=? WHERE consent_id=? AND subject_profile_id=?`).run(now(), text.slice(7), p.patient_id);
      return T(to, S().revoked);
    }
    if (id === 'm_lang') return langButtons(to);
    if (id === 'm_face') return T(to, S().face);
    return T(to, S().unknown);
  }

  // The website shows this as "Prefer WhatsApp?": scan -> opens the bot chat -> say Hi -> register.
  // Needs the bot's number: WHATSAPP_NUMBER in .env, or (baileys) the number you linked at /whatsapp-link.
  app.get('/v1/whatsapp/qr', async (req, res) => {
    const num = String(process.env.WHATSAPP_NUMBER || app.locals.waNumber || '').replace(/\D/g, '');
    if (!num) return res.json({ enabled: false });
    const link = `https://wa.me/${num}?text=Hi`;
    res.json({ enabled: true, link, number: `+${num}`, qr: await require('qrcode').toDataURL(link, { margin: 2, scale: 6 }) });
  });

  app.locals.waDeliver = (mobile, text) => (ch && ch.deliver ? ch.deliver(mobile, text) : false); // used for one-time codes
  ch = makeDrivers(app, handle, (key) => { const l = db.prepare('SELECT lang FROM wa_chats WHERE chat_key=?').get(key)?.lang || 'en'; return T(key, M[l].unknown); });

  // A record saved on the website is also sent to WhatsApp, but only to patients who chatted with the bot.
  app.locals.waNotify = (patientId, summary) => {
    try {
      const p = db.prepare('SELECT mobile_number FROM patients WHERE patient_id = ?').get(patientId);
      const c = p && db.prepare('SELECT chat_key, lang FROM wa_chats WHERE phone = ?').get(p.mobile_number);
      if (c) Promise.resolve(T(c.chat_key, M[c.lang].web(summary))).catch((e) => console.error('notify failed', e.message));
    } catch (e) { console.error('notify failed', e.message); }
  };
};
module.exports.parseDescription = parseDescription;

// AYUSH Digital Health Platform - backend (Express + SQLite)
// Database design follows "AYUSH Platform - Database Schema & Registration Design" (see db.js and docs/DATABASE.md).
try { require('dotenv').config(); } catch (e) { /* .env is optional */ }
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const sec = require('./security');

const { uuid, now } = db;
const PORT = process.env.PORT || 4000;
const otpStore = require('./otp'); // a different random OTP for every person (OTP_CODE in .env forces one fixed demo code)
const OTP_SHOW = process.env.OTP_SHOW !== '0'; // demo: show the OTP on screen when it could not be sent on WhatsApp. Set 0 in production.
const ADMIN_INVITE = process.env.ADMIN_INVITE || 'AYUSH-ADMIN-2026';
const SEED_DEMO = process.env.SEED_DEMO !== '0';
const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || path.join(__dirname, 'storage'));
const OTP_MAX_FAILS = 5;
const OTP_LOCK_MINUTES = 15;

fs.mkdirSync(STORAGE_DIR, { recursive: true });

const rnd = (n) => Array.from({ length: n }, () => crypto.randomInt(0, 10)).join('');
const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] !== undefined && o[k] !== '') return o[k]; return null; };
const str = (v) => (v === undefined || v === null ? null : String(v).trim() || null);
const arr = (v) => (v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : [v]);
const isMobile = (m) => /^[6-9]\d{9}$/.test(String(m || ''));
const isEmail = (e) => /^\S+@\S+\.\S+$/.test(String(e || '')) && String(e).length <= 254;
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(d));
const today = () => now().slice(0, 10);
const maskMobile = (m) => `XXXXXX${String(m).slice(-4)}`;
const uniqueCode = (prefix, table, col, gen) => { for (;;) { const c = `${prefix}${gen()}`; if (!db.prepare(`SELECT 1 FROM ${table} WHERE ${col}=?`).get(c)) return c; } };

const SYSTEMS = ['Ayurveda', 'Yoga & Naturopathy', 'Unani', 'Siddha', 'Homoeopathy'];
const GENDERS = ['Female', 'Male', 'Non-binary', 'Prefer not to say', 'Other'];
const OWNERSHIP = ['Government', 'Private', 'Trust', 'Society', 'Other'];
const ACCOUNT_TYPE = { patient: 'Patient', practitioner: 'Doctor', doctor: 'Doctor', facility: 'Facility Representative', clinic: 'Facility Representative', admin: 'Admin', auditor: 'Admin' };

// ---------- audit + authentication events ----------
function audit(req, { actor = null, action, type = null, ref = null, result = 'Success', reason = null }) {
  db.prepare(`INSERT INTO audit_logs (audit_log_id,actor_user_id,action,entity_type,entity_reference_id,timestamp,ip_reference,result,reason)
              VALUES (?,?,?,?,?,?,?,?,?)`).run(uuid(), actor, action, type, ref, now(), req && req.ip ? req.ip : null, result, reason);
}

// OTP check. Every attempt is recorded in authentication_events; 5 wrong tries lock the number for 15 minutes.
function checkOtp(mobile, otp, userId = null) {
  const dest = maskMobile(mobile);
  const since = new Date(Date.now() - OTP_LOCK_MINUTES * 60000).toISOString();
  const lastOk = db.prepare(`SELECT MAX(created_at) t FROM authentication_events WHERE destination_masked=? AND event_status='Successful'`).get(dest).t || '';
  const fails = db.prepare(`SELECT COUNT(*) c FROM authentication_events WHERE destination_masked=? AND event_status='Failed' AND created_at > ? AND created_at > ?`)
    .get(dest, since, lastOk).c;
  const event = (status, attempts) => db.prepare(`INSERT INTO authentication_events (auth_event_id,user_id,method,destination_masked,event_status,attempt_count,created_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(uuid(), userId, 'SMS_OTP', dest, status, attempts, now(), null);
  if (fails >= OTP_MAX_FAILS) { event('Locked', fails); return { ok: false, status: 429, message: `Too many wrong OTPs. Try again in ${OTP_LOCK_MINUTES} minutes.` }; }
  if (!otpStore.verify(mobile, otp)) {
    event('Failed', fails + 1);
    return { ok: false, status: 401, message: "That OTP isn't right or has expired. Ask for a new one." };
  }
  event('Successful', fails);
  otpStore.prove(mobile);
  return { ok: true };
}

// Registration steps after the OTP was entered once: accept the proof (no second code), or a live code if none yet.
function checkProof(mobile, otp, userId = null) {
  return otpStore.isProven(mobile) ? { ok: true } : checkOtp(mobile, otp, userId);
}

// ---------- private file storage (document_reference values) ----------
const EXT = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };
const fileFilter = (req, file, cb) => (EXT[file.mimetype] ? cb(null, true) : cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Only PDF, JPG or PNG files are allowed.')));
const disk = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, STORAGE_DIR),
    filename: (req, file, cb) => cb(null, `${uuid()}${EXT[file.mimetype] || ''}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, fileFilter,
});
const mem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const dropFile = (f) => { if (f) fs.unlink(f.path, () => {}); };

// ---------- admin access (roles -> permissions) ----------
function adminCtx(req) {
  const code = req.get('X-Admin-Id');
  if (!code) return null;
  const a = db.prepare(`SELECT ap.*, ua.account_status FROM admin_profiles ap JOIN user_accounts ua ON ua.user_id = ap.user_id WHERE ap.admin_code = ?`).get(code);
  if (!a || a.admin_status !== 'Active' || a.account_status !== 'Active') return null;
  const perms = db.prepare(`SELECT DISTINCT p.permission_code c FROM user_role_assignments ura
      JOIN role_permissions rp ON rp.role_id = ura.role_id JOIN permissions p ON p.permission_id = rp.permission_id
      WHERE ura.user_id = ? AND (ura.expires_at IS NULL OR ura.expires_at > ?)`).all(a.user_id, now()).map((r) => r.c);
  const roles = db.prepare(`SELECT r.role_name n FROM user_role_assignments ura JOIN roles r ON r.role_id = ura.role_id WHERE ura.user_id = ?`).all(a.user_id).map((r) => r.n);
  return { ...a, perms: new Set(perms), roles };
}
const need = (perm) => (req, res, next) => {
  const c = adminCtx(req);
  if (!c || !c.perms.has(perm)) {
    audit(req, { actor: c && c.user_id, action: 'ACCESS', type: 'permission', reason: perm, result: 'Denied' });
    return res.status(403).json({ message: 'You do not have permission for this.' });
  }
  req.admin = c; return next();
};

// ---------- demo data ----------
function seed() {
  if (db.prepare('SELECT COUNT(*) c FROM admin_profiles').get().c > 0) return;
  const t = now();
  db.transaction(() => {
    const fid = uuid();
    db.prepare(`INSERT INTO facilities (facility_id,facility_code,legal_name,display_name,facility_type,ownership_type,official_phone,official_email,facility_status,created_at)
                VALUES (?, 'F-1','Demo Ayush Clinic','Demo Ayush Clinic','Clinic','Private','9000000005','clinic@demo.in','Approved',?)`).run(fid, t);
    db.prepare(`INSERT INTO facility_addresses (facility_address_id,facility_id,address_line,city,state) VALUES (?,?,?,?,?)`).run(uuid(), fid, 'MG Road', 'Bengaluru', 'Karnataka');
    db.prepare(`INSERT INTO facility_registrations (facility_registration_id,facility_id,registration_number,verification_status) VALUES (?,?, 'CL-001','Verified')`).run(uuid(), fid);
    db.prepare(`INSERT INTO facility_services (facility_service_id,facility_id,ayush_system,service_name) VALUES (?,?, 'Ayurveda','Ayurveda consultation')`).run(uuid(), fid);
    const fu = uuid();
    db.prepare(`INSERT INTO user_accounts (user_id,mobile_number,account_type,linked_profile_id,created_at) VALUES (?, '9000000005','Facility Representative',?,?)`).run(fu, fid, t);

    [['D-1', 'Dr. Ayurveda Demo', 'Ayurveda', '9000000001', 'd1@demo.in', 'R-1', 'CCIM', 'BAMS'],
      ['D-2', 'Dr. Siddha Demo', 'Siddha', '9000000002', 'd2@demo.in', 'R-2', 'CCIM', 'BSMS']].forEach(([code, name, sys, mob, email, reg, council, deg]) => {
      const id = uuid();
      db.prepare(`INSERT INTO doctors (doctor_id,doctor_code,full_name,mobile_number,professional_email,ayush_system,profile_status,created_at) VALUES (?,?,?,?,?,?, 'Approved', ?)`)
        .run(id, code, name, mob, email, sys, t);
      db.prepare(`INSERT INTO doctor_qualifications (qualification_id,doctor_id,degree_name,verification_status) VALUES (?,?,?, 'Verified')`).run(uuid(), id, deg);
      db.prepare(`INSERT INTO doctor_registrations (registration_id,doctor_id,registration_number,council_authority,registration_category,verification_status) VALUES (?,?,?,?,?, 'Verified')`)
        .run(uuid(), id, reg, council, sys);
      db.prepare(`INSERT INTO doctor_specializations (doctor_specialization_id,doctor_id,specialization_name,verification_status) VALUES (?,?,?, 'Not Required')`).run(uuid(), id, sys);
      db.prepare(`INSERT INTO user_accounts (user_id,mobile_number,account_type,linked_profile_id,created_at) VALUES (?,?, 'Doctor', ?, ?)`).run(uuid(), mob, id, t);
      db.prepare(`INSERT INTO facility_doctors (facility_doctor_id,facility_id,doctor_reference_id,association_type,association_status,start_date) VALUES (?,?,?, 'Employee','Active',?)`)
        .run(uuid(), fid, id, t.slice(0, 10));
    });

    [['A-1', 'Demo Administrator', '9000000009', 'admin@demo.in', 'Super Admin'], ['A-2', 'Demo Auditor', '9000000008', 'auditor@demo.in', 'Auditor']].forEach(([code, name, mob, email, role]) => {
      const uid = uuid(); const aid = uuid();
      db.prepare(`INSERT INTO user_accounts (user_id,mobile_number,account_type,linked_profile_id,created_at) VALUES (?,?, 'Admin', ?, ?)`).run(uid, mob, aid, t);
      db.prepare(`INSERT INTO admin_profiles (admin_id,admin_code,user_id,full_name,official_email,work_phone,designation,activation_date) VALUES (?,?,?,?,?,?,?,?)`)
        .run(aid, code, uid, name, email, mob, role, t.slice(0, 10));
      db.prepare(`INSERT INTO user_role_assignments (user_role_id,user_id,role_id,assigned_at) VALUES (?,?,(SELECT role_id FROM roles WHERE role_name=?),?)`).run(uuid(), uid, role, t);
    });
  })();
}
if (SEED_DEMO) seed();

// ---------- app ----------
const app = express();
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-Id', 'X-Role', 'X-Doctor-Id', 'X-Admin-Id', 'Idempotency-Key', 'X-Facility-Id', 'X-Face-Token'],
}));
app.use(express.json({ limit: '2mb', verify: (req, res, buf) => { req.rawBody = buf; } })); // rawBody: needed to verify Meta's WhatsApp webhook signature

const v1 = express.Router();
const role = (req) => String(req.get('X-Role') || '').toLowerCase();
const forbid = (res, msg = 'Forbidden') => res.status(403).json({ message: msg });
// Face recognition (shared by every role) and the demo Aadhaar lookup
const face = require('./face')(v1, { checkOtp: checkProof, audit, isMobile });
require('./aadhaar')(v1, { audit });
const invalid = (res, errors, message = 'Please check the highlighted fields.') => res.status(400).json({ message, errors });
const getPatient = (id) => db.prepare('SELECT p.* FROM patients p LEFT JOIN encounters e ON e.patient_id = p.patient_id WHERE p.health_id = ? OR e.consultation_code = ? LIMIT 1').get(id, id);
const primaryEncounter = (patientId) => db.prepare('SELECT * FROM encounters WHERE patient_id = ? ORDER BY rowid LIMIT 1').get(patientId);
const doctorByCode = (code) => db.prepare('SELECT * FROM doctors WHERE doctor_code = ?').get(code);
const userFor = (mobile, type) => db.prepare('SELECT * FROM user_accounts WHERE mobile_number = ? AND account_type = ?').get(mobile, type);
const liveDoctor = (d) => d && ['Approved', 'Active'].includes(d.profile_status);
const idemGet = (key, route) => (key ? db.prepare('SELECT * FROM idempotency WHERE key=? AND route=?').get(key, route) : null);
const idemSet = (key, route, status, out) => { if (key) db.prepare('INSERT OR REPLACE INTO idempotency VALUES (?,?,?,?)').run(key, route, status, JSON.stringify(out)); };

// ================= registration =================

// Patient: only mobile + name + consent are required. Aadhaar / ABHA are optional (report section 10).
function registerPatient(req, res) {
  const key = req.get('Idempotency-Key');
  const prev = idemGet(key, 'patients/register');
  if (prev) return res.status(prev.status).json(JSON.parse(prev.response));

  const b = req.body || {};
  const name = str(pick(b, 'name', 'fullName'));
  const mobile = str(pick(b, 'mobile', 'phone'));
  const email = str(b.email) && String(b.email).trim().toLowerCase();
  const dob = str(pick(b, 'dob', 'dateOfBirth'));
  const gender = str(b.gender);
  const pin = str(pick(b, 'pincode', 'postalCode'));
  const abha = str(b.abha) && String(b.abha).replace(/[\s-]/g, '');
  const aadhaar = str(b.aadhaar) && String(b.aadhaar).replace(/\s/g, '');
  const eName = str(b.emergencyName); const ePhone = str(b.emergencyPhone);
  const E = {};
  if (!name) E.name = 'Full name is required';
  else if (name.length > 150) E.name = 'Name is too long';
  if (!isMobile(mobile)) E.mobile = 'Enter a valid 10-digit mobile number';
  if (dob && (!isDate(dob) || dob > today() || dob < '1900-01-01')) E.dob = 'Enter a valid date of birth';
  if (gender && !GENDERS.includes(gender)) E.gender = 'Choose one of the listed options';
  if (email && !isEmail(email)) E.email = 'Enter a valid email';
  if (pin && !/^\d{6}$/.test(pin)) E.pincode = 'Pincode must be 6 digits';
  if (abha && !/^\d{14}$/.test(abha)) E.abha = 'ABHA number must be 14 digits';
  if (aadhaar && !/^[2-9]\d{11}$/.test(aadhaar)) E.aadhaar = 'Aadhaar must be 12 digits and cannot start with 0 or 1';
  if ((eName || ePhone) && !(eName && isMobile(ePhone))) E.emergencyPhone = 'Give the emergency contact a name and a valid 10-digit number';
  if (!(b.consent === true || b.consent === 'true')) E.consent = 'Please accept the privacy notice';
  if ((aadhaar || abha) && !(b.identityConsent === true || b.identityConsent === 'true')) E.identityConsent = 'Please agree to link the ID you entered';
  if (Object.keys(E).length) return invalid(res, E);

  if (db.prepare('SELECT 1 FROM patients WHERE mobile_number = ?').get(mobile)) return res.status(409).json({ message: 'This mobile number already has a record. Sign in instead.' });
  if (email && db.prepare('SELECT 1 FROM patients WHERE email = ?').get(email)) return res.status(409).json({ message: 'This email is already used by another record.' });
  if (abha && db.prepare('SELECT 1 FROM patient_identity_references WHERE abha_number = ?').get(abha)) return res.status(409).json({ message: 'This ABHA number is already linked to a record.' });

  const otp = checkProof(mobile, b.otp);
  if (!otp.ok) return res.status(otp.status).json({ message: otp.message, errors: { otp: otp.message } });

  const pid = uuid(); const uid = uuid(); const t = now();
  const healthId = uniqueCode('91-', 'patients', 'health_id', () => `${rnd(4)}-${rnd(4)}-${rnd(4)}`);
  const consultationId = uniqueCode('C-', 'encounters', 'consultation_code', () => rnd(9));
  const masked = aadhaar ? `XXXX XXXX ${aadhaar.slice(-4)}` : null;
  db.transaction(() => {
    db.prepare(`INSERT INTO patients (patient_id,health_id,full_name,date_of_birth,gender,mobile_number,mobile_verified,email,address_line,city,state,postal_code,account_status,created_at,updated_at)
                VALUES (?,?,?,?,?,?,1,?,?,?,?,?, 'Active', ?, ?)`)
      .run(pid, healthId, name, dob, gender, mobile, email, str(pick(b, 'addressLine', 'address')), str(b.city), str(b.state), pin, t, t);
    db.prepare(`INSERT INTO user_accounts (user_id,mobile_number,account_type,linked_profile_id,created_at) VALUES (?,?, 'Patient', ?, ?)`).run(uid, mobile, pid, t);
    db.prepare(`INSERT INTO encounters (encounter_id,consultation_code,patient_id,status) VALUES (?,?,?, 'Scheduled')`).run(uuid(), consultationId, pid);
    db.prepare(`INSERT INTO consent_records (consent_id,user_id,subject_profile_id,purpose,notice_version,consent_status,captured_at,capture_method)
                VALUES (?,?,?, 'privacy notice and terms', 'v1', 'Granted', ?, 'Web')`).run(uuid(), uid, pid, t);
    if (eName) {
      db.prepare(`INSERT INTO patient_emergency_contacts (emergency_contact_id,patient_id,contact_name,relationship,phone_number,is_primary,created_at) VALUES (?,?,?,?,?,1,?)`)
        .run(uuid(), pid, eName, str(b.emergencyRelationship), ePhone, t);
    }
    if (aadhaar || abha) {
      const cid = uuid();
      db.prepare(`INSERT INTO consent_records (consent_id,user_id,subject_profile_id,purpose,notice_version,consent_status,captured_at,capture_method)
                  VALUES (?,?,?, 'identity linking', 'v1', 'Granted', ?, 'Web')`).run(cid, uid, pid, t);
      // The full Aadhaar number is never stored: only the masked form. Nothing here verifies it with UIDAI, so status stays Pending.
      db.prepare(`INSERT INTO patient_identity_references (identity_reference_id,patient_id,abha_number,identity_document_type,masked_document_number,verification_status,consent_id)
                  VALUES (?,?,?,?,?,?,?)`).run(uuid(), pid, abha, aadhaar ? 'Aadhaar' : null, masked, 'Pending', cid);
    }
    audit(req, { actor: uid, action: 'CREATE', type: 'patient', ref: pid });
  })();

  const out = { patientId: healthId, healthId, consultationId, name, maskedAadhaar: masked };
  idemSet(key, 'patients/register', 201, out);
  return res.status(201).json(out);
}
v1.post('/auth/register', face.faceGate, registerPatient);
v1.post('/patients/register', face.faceGate, registerPatient);

function cleanupAndFail(res, file, status, body) { dropFile(file); return res.status(status).json(body); }

v1.post('/auth/register/practitioner', disk.single('certificate'), face.faceGate, (req, res) => {
  const b = req.body || {};
  const f = req.file;
  const name = str(pick(b, 'name', 'fullName'));
  const mobile = str(pick(b, 'mobile', 'phone'));
  const system = str(pick(b, 'system', 'ayushSystem')) || 'Ayurveda';
  const email = str(pick(b, 'email', 'professionalEmail')) && String(pick(b, 'email', 'professionalEmail')).trim().toLowerCase();
  const regNo = str(pick(b, 'registrationNo', 'registrationNumber', 'regNo'));
  const year = str(b.graduationYear); const exp = str(b.experience);
  const issue = str(b.issueDate); const expiry = str(b.expiryDate);
  const facCode = str(b.facilityId);
  const E = {};
  if (!name) E.name = 'Full name is required';
  if (!SYSTEMS.includes(system)) E.system = 'Choose a system of medicine';
  if (!isMobile(mobile)) E.mobile = 'Enter a valid 10-digit mobile number';
  if (email && !isEmail(email)) E.email = 'Enter a valid email';
  if (!str(b.qualification)) E.qualification = 'Qualification is required';
  if (!regNo) E.registrationNo = 'Registration number is required';
  if (!str(b.council)) E.council = 'Registering council is required';
  if (year && (!/^\d{4}$/.test(year) || +year < 1950 || +year > new Date().getFullYear())) E.graduationYear = 'Enter a valid 4-digit year';
  if (exp && (!/^\d{1,2}(\.\d)?$/.test(exp))) E.experience = 'Enter years as a number';
  if (issue && !isDate(issue)) E.issueDate = 'Enter a valid date';
  if (expiry && !isDate(expiry)) E.expiryDate = 'Enter a valid date';
  if (issue && expiry && isDate(issue) && isDate(expiry) && expiry < issue) E.expiryDate = 'Expiry cannot be before the issue date';
  if (b.pincode && !/^\d{6}$/.test(String(b.pincode))) E.pincode = 'Pincode must be 6 digits';
  if (!f) E.certificate = 'Upload your registration certificate';
  let fac = null;
  if (facCode) { fac = db.prepare('SELECT * FROM facilities WHERE facility_code = ?').get(facCode); if (!fac) E.facilityId = 'No clinic / hospital has this ID'; }
  if (Object.keys(E).length) return cleanupAndFail(res, f, 400, { message: 'Please check the highlighted fields.', errors: E });

  if (userFor(mobile, 'Doctor') || db.prepare('SELECT 1 FROM doctors WHERE mobile_number = ?').get(mobile)) return cleanupAndFail(res, f, 409, { message: 'This mobile number is already registered.' });
  if (email && db.prepare('SELECT 1 FROM doctors WHERE professional_email = ?').get(email)) return cleanupAndFail(res, f, 409, { message: 'This email is already registered.' });
  const otp = checkProof(mobile, b.otp);
  if (!otp.ok) return cleanupAndFail(res, f, otp.status, { message: otp.message, errors: { otp: otp.message } });

  const did = uuid(); const uid = uuid(); const t = now();
  const code = uniqueCode('DR-', 'doctors', 'doctor_code', () => `${rnd(4)}-${rnd(4)}`);
  const specs = [...new Set(String(b.specializations || '').split(',').map((s) => s.trim()).filter(Boolean))];
  db.transaction(() => {
    db.prepare(`INSERT INTO user_accounts (user_id,mobile_number,account_type,linked_profile_id,created_at) VALUES (?,?, 'Doctor', ?, ?)`).run(uid, mobile, did, t);
    db.prepare(`INSERT INTO doctors (doctor_id,doctor_code,full_name,mobile_number,professional_email,address_line,city,state,ayush_system,experience_years,languages,profile_status,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?, 'Submitted', ?, ?)`)
      .run(did, code, name, mobile, email, str(b.addressLine), str(b.city), str(b.state), system, exp ? Number(exp) : null, str(b.languages), t, t);
    db.prepare(`INSERT INTO doctor_qualifications (qualification_id,doctor_id,degree_name,institution_name,university_name,graduation_year,certificate_reference) VALUES (?,?,?,?,?,?,?)`)
      .run(uuid(), did, str(b.qualification), str(b.institution), str(b.university), year ? +year : null, f.filename);
    db.prepare(`INSERT INTO doctor_registrations (registration_id,doctor_id,registration_number,council_authority,registration_category,issue_date,expiry_date) VALUES (?,?,?,?,?,?,?)`)
      .run(uuid(), did, regNo, str(b.council), system, issue, expiry);
    specs.forEach((s) => db.prepare(`INSERT INTO doctor_specializations (doctor_specialization_id,doctor_id,specialization_name) VALUES (?,?,?)`).run(uuid(), did, s));
    if (fac) db.prepare(`INSERT INTO facility_doctors (facility_doctor_id,facility_id,doctor_reference_id,association_type,association_status) VALUES (?,?,?, 'Other','Pending')`).run(uuid(), fac.facility_id, did);
    db.prepare(`INSERT INTO verification_cases (verification_case_id,subject_type,subject_reference_id,verification_type,status,submitted_at) VALUES (?, 'DOCTOR', ?, 'Professional registration', 'Pending', ?)`).run(uuid(), did, t);
    audit(req, { actor: uid, action: 'CREATE', type: 'doctor', ref: did });
  })();
  return res.status(201).json({ id: code, doctorId: code, status: 'Submitted', needsApproval: true, idLabel: 'Doctor ID', message: 'Submitted for admin verification.' });
});

v1.post('/auth/register/facility', disk.single('certificate'), face.faceGate, (req, res) => {
  const b = req.body || {};
  const f = req.file;
  const name = str(pick(b, 'name', 'facilityName'));
  const mobile = str(pick(b, 'mobile', 'phone'));
  const email = str(b.email) && String(b.email).trim().toLowerCase();
  const systems = arr(b.systems).filter((s) => SYSTEMS.includes(s));
  const year = str(b.establishmentYear);
  const issue = str(b.issueDate); const expiry = str(b.expiryDate);
  const regNo = str(pick(b, 'licenceNo', 'registrationNo', 'registrationNumber'));
  const E = {};
  if (!name) E.name = 'Facility name is required';
  if (!isMobile(mobile)) E.mobile = 'Enter a valid 10-digit mobile number';
  if (email && !isEmail(email)) E.email = 'Enter a valid email';
  if (!str(b.facilityType)) E.facilityType = 'Choose a facility type';
  if (b.ownershipType && !OWNERSHIP.includes(b.ownershipType)) E.ownershipType = 'Choose one of the listed options';
  if (year && (!/^\d{4}$/.test(year) || +year < 1800 || +year > new Date().getFullYear())) E.establishmentYear = 'Enter a valid 4-digit year';
  if (!systems.length) E.systems = 'Choose at least one system';
  if (!regNo) E.licenceNo = 'Licence / registration number is required';
  if (!str(pick(b, 'address', 'addressLine'))) E.address = 'Address is required';
  if (b.pincode && !/^\d{6}$/.test(String(b.pincode))) E.pincode = 'Pincode must be 6 digits';
  if (issue && !isDate(issue)) E.issueDate = 'Enter a valid date';
  if (expiry && !isDate(expiry)) E.expiryDate = 'Enter a valid date';
  if (issue && expiry && isDate(issue) && isDate(expiry) && expiry < issue) E.expiryDate = 'Expiry cannot be before the issue date';
  if (!f) E.certificate = 'Upload the licence document';
  if (Object.keys(E).length) return cleanupAndFail(res, f, 400, { message: 'Please check the highlighted fields.', errors: E });

  if (userFor(mobile, 'Facility Representative')) return cleanupAndFail(res, f, 409, { message: 'This mobile number is already registered.' });
  const otp = checkProof(mobile, b.otp);
  if (!otp.ok) return cleanupAndFail(res, f, otp.status, { message: otp.message, errors: { otp: otp.message } });

  const fid = uuid(); const uid = uuid(); const t = now();
  const code = uniqueCode('F-', 'facilities', 'facility_code', () => rnd(4));
  db.transaction(() => {
    db.prepare(`INSERT INTO user_accounts (user_id,mobile_number,account_type,linked_profile_id,created_at) VALUES (?,?, 'Facility Representative', ?, ?)`).run(uid, mobile, fid, t);
    db.prepare(`INSERT INTO facilities (facility_id,facility_code,legal_name,display_name,facility_type,ownership_type,establishment_year,description,official_phone,official_email,website,facility_status,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?, 'Submitted', ?, ?)`)
      .run(fid, code, name, str(b.displayName) || name, str(b.facilityType), str(b.ownershipType), year ? +year : null, str(b.description), mobile, email, str(b.website), t, t);
    db.prepare(`INSERT INTO facility_addresses (facility_address_id,facility_id,address_line,city,district,state,postal_code,is_primary) VALUES (?,?,?,?,?,?,?,1)`)
      .run(uuid(), fid, str(pick(b, 'address', 'addressLine')), str(b.city), str(b.district), str(b.state), str(b.pincode));
    db.prepare(`INSERT INTO facility_registrations (facility_registration_id,facility_id,registration_number,registration_authority,registration_type,issue_date,expiry_date,document_reference)
                VALUES (?,?,?,?,?,?,?,?)`).run(uuid(), fid, regNo, str(b.authority), str(b.registrationType), issue, expiry, f.filename);
    systems.forEach((s) => db.prepare(`INSERT INTO facility_services (facility_service_id,facility_id,ayush_system,service_name) VALUES (?,?,?,?)`).run(uuid(), fid, s, `${s} consultation`));
    arr(b.infrastructure).forEach((i) => db.prepare(`INSERT INTO facility_infrastructure (infrastructure_id,facility_id,item_type,is_available) VALUES (?,?,?,1)`).run(uuid(), fid, String(i)));
    db.prepare(`INSERT INTO verification_cases (verification_case_id,subject_type,subject_reference_id,verification_type,status,submitted_at) VALUES (?, 'FACILITY', ?, 'Facility licence', 'Pending', ?)`).run(uuid(), fid, t);
    audit(req, { actor: uid, action: 'CREATE', type: 'facility', ref: fid });
  })();
  return res.status(201).json({ id: code, facilityId: code, status: 'Submitted', needsApproval: true, idLabel: 'Facility ID (share it with your doctors)', message: 'Submitted for admin verification.' });
});

v1.post('/auth/register/admin', face.faceGate, (req, res) => {
  const b = req.body || {};
  if (pick(b, 'inviteCode', 'invite', 'code') !== ADMIN_INVITE) return res.status(403).json({ message: 'Invalid admin invite code.', errors: { inviteCode: 'Invalid invite code' } });
  const name = str(pick(b, 'name', 'fullName'));
  const mobile = str(pick(b, 'mobile', 'phone'));
  const email = str(b.email) && String(b.email).trim().toLowerCase();
  const roleName = str(pick(b, 'adminType', 'role')) || 'Auditor';
  const E = {};
  if (!name) E.name = 'Full name is required';
  if (!isMobile(mobile)) E.mobile = 'Enter a valid 10-digit mobile number';
  if (!isEmail(email)) E.email = 'Enter your official email';
  const roleRow = db.prepare('SELECT role_id FROM roles WHERE role_name = ?').get(roleName);
  if (!roleRow) E.adminType = 'Choose a role';
  if (Object.keys(E).length) return invalid(res, E);
  if (userFor(mobile, 'Admin')) return res.status(409).json({ message: 'This mobile number is already registered.' });
  if (db.prepare('SELECT 1 FROM admin_profiles WHERE official_email = ?').get(email)) return res.status(409).json({ message: 'This email is already registered.' });
  const otp = checkProof(mobile, b.otp);
  if (!otp.ok) return res.status(otp.status).json({ message: otp.message, errors: { otp: otp.message } });

  const uid = uuid(); const aid = uuid(); const t = now();
  const code = uniqueCode('A-', 'admin_profiles', 'admin_code', () => rnd(4));
  db.transaction(() => {
    db.prepare(`INSERT INTO user_accounts (user_id,mobile_number,account_type,linked_profile_id,created_at) VALUES (?,?, 'Admin', ?, ?)`).run(uid, mobile, aid, t);
    db.prepare(`INSERT INTO admin_profiles (admin_id,admin_code,user_id,full_name,official_email,work_phone,department,designation,activation_date) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(aid, code, uid, name, email, mobile, str(b.department), str(b.designation), t.slice(0, 10));
    db.prepare(`INSERT INTO user_role_assignments (user_role_id,user_id,role_id,assigned_at) VALUES (?,?,?,?)`).run(uuid(), uid, roleRow.role_id, t);
    audit(req, { actor: uid, action: 'CREATE', type: 'admin', ref: aid, reason: `role ${roleName}` });
  })();
  return res.status(201).json({ id: code, adminId: code, role: roleName, status: 'created', message: 'Staff account created.', idLabel: 'Admin ID' });
});

// ================= one-time passwords =================
// Sends a NEW random code to this number: on WhatsApp when the bot is linked and the number has WhatsApp,
// always printed in the server terminal, and shown on screen in demo mode (OTP_SHOW=0 hides it; plug an SMS provider in here).
v1.post('/auth/otp/send', async (req, res) => {
  const mobile = String((req.body || {}).mobile || '');
  if (!isMobile(mobile)) return res.status(400).json({ message: 'Enter a valid 10-digit mobile number.' });
  const r = otpStore.issue(mobile);
  if (!r.ok) return res.status(429).json({ message: r.message, wait: r.wait });
  // A person who registered through the WhatsApp bot gets the code on WhatsApp ONLY (never shown on the website screen).
  const waOnly = !!db.prepare(`SELECT 1 FROM user_accounts u JOIN audit_logs a ON a.actor_user_id = u.user_id WHERE u.mobile_number = ? AND a.reason = 'registered on WhatsApp' LIMIT 1`).get(mobile);
  let via = 'screen';
  try { if (app.locals.waDeliver && await app.locals.waDeliver(mobile, `Your AYUSH verification code is *${r.code}*. It is valid for 5 minutes. Do not share it with anyone.`)) via = 'whatsapp'; } catch (e) { console.error('OTP on WhatsApp failed:', e.message); }
  if (via !== 'whatsapp') console.log(`[OTP] +91 ${mobile}  ->  ${r.code}   (valid 5 minutes)`);
  audit(req, { action: 'OTP_SENT', type: 'user', reason: via });
  return res.json({ sent: true, via, expiresIn: r.expiresIn, resendIn: r.resendIn, ...(OTP_SHOW && !waOnly ? { demoOtp: r.code } : {}) });
});
// Registration after a face scan: checks the code once; the steps that follow need no second code.
v1.post('/auth/otp/confirm', (req, res) => {
  const { mobile, otp } = req.body || {};
  if (!isMobile(mobile)) return res.status(400).json({ message: 'Enter a valid 10-digit mobile number.' });
  const o = checkOtp(mobile, otp);
  if (!o.ok) return res.status(o.status).json({ message: o.message });
  return res.json({ ok: true });
});

// ================= login =================
v1.post('/auth/login', (req, res) => {
  const { mobile, otp, faceToken } = req.body || {};
  const want = String((req.body || {}).role || 'patient').toLowerCase();
  const type = ACCOUNT_TYPE[want];
  if (!type) return res.status(400).json({ message: 'Unknown role.' });
  if (!isMobile(mobile)) return res.status(400).json({ message: 'Enter a valid 10-digit mobile number.' });
  const user = userFor(mobile, type);
  // Face sign-in = face scan AND a fresh OTP sent to this number. (OTP alone is the fallback when there is no camera / face.)
  const byFace = !!faceToken && face.peekFaceLogin(faceToken, mobile);
  if (faceToken && !byFace) return res.status(401).json({ message: 'The face check expired. Please scan your face again.' });
  let o;
  if (byFace && !otp && user && Date.now() - Date.parse(user.created_at) < 120000 && otpStore.useProof(mobile)) o = { ok: true }; // account created a moment ago: the OTP was just entered
  else o = checkOtp(mobile, otp, user ? user.user_id : null);
  if (!o.ok) { audit(req, { actor: user && user.user_id, action: 'LOGIN', type: 'user', result: 'Failure', reason: faceToken ? 'face + otp' : 'otp' }); return res.status(o.status).json({ message: o.message }); }
  if (byFace) face.consumeFaceLogin(faceToken, mobile);
  const fail = (status, message) => { audit(req, { actor: user && user.user_id, action: 'LOGIN', type: 'user', ref: user && user.user_id, result: 'Denied', reason: message }); return res.status(status).json({ message }); };
  if (!user) return fail(404, 'No account found for this number and role.');
  if (user.account_status !== 'Active') return fail(403, `This account is ${user.account_status.toLowerCase()}. Contact the administrator.`);

  const statusMsg = (s, kind) => {
    if (['Submitted', 'Under Review', 'Draft'].includes(s)) return 'Your registration is waiting for admin approval.';
    if (s === 'More Information Required') {
      const c = db.prepare(`SELECT decision_reason r FROM verification_cases WHERE subject_reference_id = ? AND subject_type = ? ORDER BY submitted_at DESC LIMIT 1`).get(user.linked_profile_id, kind);
      return `The administrator needs more information: ${c && c.r ? c.r : 'please contact the administrator.'}`;
    }
    if (s === 'Rejected') return 'Your registration was rejected. Contact the administrator.';
    if (s === 'Suspended' || s === 'Expired') return `Your registration is ${s.toLowerCase()}. Contact the administrator.`;
    return null;
  };
  let out;
  if (type === 'Patient') {
    const p = db.prepare('SELECT * FROM patients WHERE patient_id = ?').get(user.linked_profile_id);
    if (!p || !['Active', 'Contact Verified'].includes(p.account_status)) return fail(403, 'This record is not active.');
    out = { role: 'patient', name: p.full_name, healthId: p.health_id };
  } else if (type === 'Doctor') {
    const d = db.prepare('SELECT * FROM doctors WHERE doctor_id = ?').get(user.linked_profile_id);
    if (!liveDoctor(d)) return fail(403, statusMsg(d && d.profile_status, 'DOCTOR') || 'Not allowed.');
    out = { role: 'practitioner', name: d.full_name, doctorId: d.doctor_code, system: d.ayush_system };
  } else if (type === 'Facility Representative') {
    const f = db.prepare('SELECT * FROM facilities WHERE facility_id = ?').get(user.linked_profile_id);
    if (!f || !['Approved', 'Active'].includes(f.facility_status)) return fail(403, statusMsg(f && f.facility_status, 'FACILITY') || 'Not allowed.');
    out = { role: 'facility', name: f.display_name || f.legal_name, facilityId: f.facility_code };
  } else {
    const a = db.prepare('SELECT * FROM admin_profiles WHERE admin_id = ?').get(user.linked_profile_id);
    if (!a || a.admin_status !== 'Active') return fail(403, 'This staff account is not active.');
    req.headers['x-admin-id'] = a.admin_code;
    const c = adminCtx(req);
    out = { role: 'admin', name: a.full_name, adminId: a.admin_code, adminType: c.roles[0] || 'Admin', permissions: [...c.perms] };
  }
  db.prepare('UPDATE user_accounts SET last_login_at = ? WHERE user_id = ?').run(now(), user.user_id);
  audit(req, { actor: user.user_id, action: 'LOGIN', type: 'user', ref: user.user_id, reason: byFace ? 'face + otp' : 'otp' });
  return res.json({ ...out, mobile, method: byFace ? 'face + otp' : 'otp', faceRegistered: !!face.profileFor(mobile), token: sec.sign({ u: user.user_id, t: type, m: mobile }, 8 * 3600) });
});

// ================= doctors / facilities =================
v1.get('/doctors', (req, res) => {
  res.json(db.prepare(`SELECT doctor_code id, full_name name, ayush_system system, profile_status status FROM doctors WHERE profile_status IN ('Approved','Active') ORDER BY full_name`).all());
});

v1.get('/facilities/:id/practitioners', (req, res) => {
  const f = db.prepare('SELECT facility_id FROM facilities WHERE facility_code = ?').get(req.params.id);
  if (!f) return res.status(404).json({ message: 'Facility not found.' });
  res.json(db.prepare(`SELECT d.doctor_code id, d.full_name name, d.ayush_system system, d.profile_status status, fd.association_status association
                       FROM facility_doctors fd JOIN doctors d ON d.doctor_id = fd.doctor_reference_id WHERE fd.facility_id = ? ORDER BY d.full_name`).all(f.facility_id));
});

// Doctor weekly availability (report 4.5)
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
v1.get('/doctors/:id/availability', (req, res) => {
  const d = doctorByCode(req.params.id);
  if (!d) return res.status(404).json({ message: 'Doctor not found.' });
  res.json(db.prepare('SELECT day_of_week dayOfWeek, start_time startTime, end_time endTime, consultation_mode mode, is_active isActive FROM doctor_availability WHERE doctor_id = ?').all(d.doctor_id));
});
v1.put('/doctors/:id/availability', (req, res) => {
  const d = doctorByCode(req.params.id);
  if (!d) return res.status(404).json({ message: 'Doctor not found.' });
  if (role(req) !== 'practitioner' || req.get('X-Doctor-Id') !== d.doctor_code) return forbid(res, 'Only this doctor can change availability.');
  const slots = Array.isArray(req.body && req.body.slots) ? req.body.slots : [];
  const modes = ['In-person', 'Video', 'Audio', 'Chat'];
  for (const s of slots) {
    if (!DAYS.includes(s.dayOfWeek) || !/^\d{2}:\d{2}$/.test(s.startTime || '') || !/^\d{2}:\d{2}$/.test(s.endTime || '') || s.endTime <= s.startTime || (s.mode && !modes.includes(s.mode)))
      return res.status(400).json({ message: 'Each slot needs a weekday, a start time and a later end time.' });
  }
  db.transaction(() => {
    db.prepare('DELETE FROM doctor_availability WHERE doctor_id = ?').run(d.doctor_id);
    slots.forEach((s) => db.prepare('INSERT INTO doctor_availability (availability_id,doctor_id,day_of_week,start_time,end_time,consultation_mode) VALUES (?,?,?,?,?,?)')
      .run(uuid(), d.doctor_id, s.dayOfWeek, s.startTime, s.endTime, s.mode || null));
  })();
  res.json({ saved: slots.length });
});

// ================= patient records =================
// Reads a prescription / report photo and returns a DRAFT the patient checks before saving.
// Uses the same reader as the WhatsApp bot: AI vision when ANTHROPIC_API_KEY is set, otherwise the offline Tesseract reader (printed English).
const PRAK_ORDER = ['vata', 'pitta', 'kapha'];
function prakritiFrom(text) {
  const found = PRAK_ORDER.filter((x) => new RegExp(`\\b${x}\\b`, 'i').test(text || ''));
  if (!found.length) return '';
  const cap = (x) => x[0].toUpperCase() + x.slice(1);
  return found.length === 1 ? cap(found[0]) : found.map(cap).join('-');
}
v1.post('/records/extract', mem.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file received.' });
  if (!EXT[req.file.mimetype]) return res.status(400).json({ message: 'Only JPG, PNG or PDF files are allowed.' });
  const tmp = path.join(STORAGE_DIR, `tmp-${uuid()}${EXT[req.file.mimetype]}`);
  try {
    fs.writeFileSync(tmp, req.file.buffer);
    const { readInput } = require('./whatsapp/reader');
    const { raw, ex } = await readInput({ file: tmp, mime: req.file.mimetype });
    const ai = ex._engine === 'AI vision';
    const meds = (ex.medicines || []).map((m) => ({
      name: m.name || '', dose: m.dose || '', timing: m.freq || (m.extra && m.extra.Kala) || '', duration: m.duration || '',
    }));
    const sys = { ayurveda: 'Ayurveda', yoga: 'Yoga & Naturopathy', unani: 'Unani', siddha: 'Siddha', homoeopathy: 'Homoeopathy' }[ex.system] || 'Ayurveda';
    const prakriti = prakritiFrom((ex.findings && ex.findings.Prakriti) || raw);
    let note = '';
    if (!ai) note = 'Read with the offline reader, which handles printed English. Handwriting and Hindi are read better with the AI reader switched on. Please check every field.';
    if (!ai && ex._note && /PDF/.test(ex._note)) note = ex._note;
    res.json({
      documentType: req.body.documentType || 'Prescription', system: sys,
      problem: ex.complaint || '', diagnosis: ex.diagnosis || '', prakriti, medicines: meds, advice: ex.advice || '',
      readWithAi: ai, note,
    });
  } catch (err) {
    console.error('extract failed:', err.message);
    res.status(500).json({ message: 'Could not read the file.' });
  } finally { fs.promises.unlink(tmp).catch(() => {}); }
});

v1.post('/records', (req, res) => {
  const b = req.body || {};
  const p = getPatient(b.healthId);
  if (!p) return res.status(404).json({ message: 'No patient found for this ID.' });
  const enc = primaryEncounter(p.patient_id); const t = now(); const rx = uuid();
  const meds = Array.isArray(b.medicines) ? b.medicines : [];
  const r = db.transaction(() => {
    db.prepare(`INSERT INTO prescriptions (prescription_id,encounter_id,patient_id,prescription_details,instructions,issued_at) VALUES (?,?,?,?,?,?)`)
      .run(rx, enc.encounter_id, p.patient_id, JSON.stringify(meds), b.advice || '', t);
    if (b.problem) db.prepare(`INSERT INTO patient_health_concerns (concern_id,patient_id,symptoms,recorded_at,encounter_id) VALUES (?,?,?,?,?)`).run(uuid(), p.patient_id, b.problem, t, enc.encounter_id);
    return db.prepare(`INSERT INTO patient_records (patient_id,prescription_id,document_type,file_name,ayush_system,problem,diagnosis,prakriti,saved_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(p.patient_id, rx, b.documentType || null, b.fileName || null, b.system || 'Ayurveda', b.problem || '', b.diagnosis || '', b.prakriti || '', t);
  })();
  if (app.locals.waNotify) { // opted-in WhatsApp patients get the same summary there
    app.locals.waNotify(p.patient_id, `${b.system || 'Ayurveda'}${b.problem ? ` · ${b.problem}` : ''}${meds.length ? `\n${meds.map((m) => `• ${[m.name, m.dose, m.timing, m.duration].filter(Boolean).join(' – ')}`).join('\n')}` : ''}`);
  }
  res.status(201).json({ recordId: `R-${r.lastInsertRowid}` });
});

v1.post('/patients/:id/prescriptions', disk.single('file'), (req, res) => {
  const p = getPatient(req.params.id);
  if (!p) return cleanupAndFail(res, req.file, 404, { message: 'No patient found for this ID.' });
  if (!req.file) return res.status(400).json({ message: 'No file received.' });
  const r = db.prepare('INSERT INTO patient_uploads (patient_id,file_name,mime_type,size,document_reference,uploaded_at) VALUES (?,?,?,?,?,?)')
    .run(p.patient_id, req.file.originalname, req.file.mimetype, req.file.size, req.file.filename, now());
  res.status(201).json({ uploadId: `U-${r.lastInsertRowid}`, fileName: req.file.originalname });
});

// Patient profile: medical history and health concerns (report 3.4, 3.5)
const ownPatient = (req, res) => {
  const p = getPatient(req.params.id);
  if (!p) { res.status(404).json({ message: 'No record found for this ID.' }); return null; }
  if (role(req) && role(req) !== 'patient') { forbid(res, 'Only the patient can change this.'); return null; }
  return p;
};
v1.get('/patients/:id/profile', (req, res) => {
  const p = ownPatient(req, res); if (!p) return;
  res.json({
    name: p.full_name, healthId: p.health_id, dob: p.date_of_birth, gender: p.gender, email: p.email, city: p.city, state: p.state,
    emergencyContacts: db.prepare('SELECT contact_name name, relationship, phone_number phone, is_primary isPrimary FROM patient_emergency_contacts WHERE patient_id = ?').all(p.patient_id),
    identity: db.prepare('SELECT abha_number abha, identity_document_type documentType, masked_document_number masked, verification_status status FROM patient_identity_references WHERE patient_id = ?').all(p.patient_id),
    medicalHistory: db.prepare('SELECT history_id id, condition_name conditionName, allergies, current_medications currentMedications, past_surgeries pastSurgeries, family_history familyHistory, chronic_conditions chronicConditions, previous_treatments previousTreatments, reported_by reportedBy, recorded_at recordedAt FROM patient_medical_history WHERE patient_id = ? ORDER BY recorded_at DESC').all(p.patient_id),
    concerns: db.prepare('SELECT concern_id id, symptoms, duration, notes, recorded_at recordedAt FROM patient_health_concerns WHERE patient_id = ? ORDER BY recorded_at DESC').all(p.patient_id),
  });
});
v1.post('/patients/:id/medical-history', (req, res) => {
  const p = ownPatient(req, res); if (!p) return;
  const b = req.body || {};
  const cols = ['conditionName', 'allergies', 'currentMedications', 'pastSurgeries', 'familyHistory', 'chronicConditions', 'previousTreatments'];
  if (!cols.some((c) => str(b[c]))) return invalid(res, { conditionName: 'Fill in at least one field' });
  if (str(b.conditionName) && str(b.conditionName).length > 200) return invalid(res, { conditionName: 'Keep this under 200 characters' });
  const id = uuid();
  db.prepare(`INSERT INTO patient_medical_history (history_id,patient_id,condition_name,allergies,current_medications,past_surgeries,family_history,chronic_conditions,previous_treatments,reported_by,recorded_at)
              VALUES (?,?,?,?,?,?,?,?,?, 'Patient', ?)`).run(id, p.patient_id, ...cols.map((c) => str(b[c])), now());
  audit(req, { action: 'CREATE', type: 'patient_medical_history', ref: id });
  res.status(201).json({ id });
});
v1.post('/patients/:id/health-concerns', (req, res) => {
  const p = ownPatient(req, res); if (!p) return;
  const b = req.body || {};
  if (!str(b.symptoms)) return invalid(res, { symptoms: 'Describe the symptoms' });
  if (str(b.duration) && str(b.duration).length > 100) return invalid(res, { duration: 'Keep this under 100 characters' });
  const id = uuid();
  db.prepare(`INSERT INTO patient_health_concerns (concern_id,patient_id,symptoms,duration,notes,recorded_at,encounter_id) VALUES (?,?,?,?,?,?,?)`)
    .run(id, p.patient_id, str(b.symptoms), str(b.duration), str(b.notes), now(), primaryEncounter(p.patient_id).encounter_id);
  res.status(201).json({ id });
});

// ================= summary + consent =================
const activeGrants = (patientId) => db.prepare(`SELECT d.doctor_code c FROM consent_records cr JOIN consent_grants g ON g.consent_id = cr.consent_id JOIN doctors d ON d.doctor_id = g.doctor_id
    WHERE cr.subject_profile_id = ? AND cr.purpose = 'health-data sharing' AND cr.consent_status = 'Granted' AND (g.expires_at IS NULL OR g.expires_at > ?)`)
  .all(patientId, now()).map((r) => r.c);

v1.get('/patients/:id/summary', (req, res) => {
  const p = getPatient(req.params.id);
  if (!p) return res.status(404).json({ message: 'No record found for this ID.' });
  let actor = null;
  if (role(req) === 'practitioner') {
    const d = doctorByCode(req.get('X-Doctor-Id') || '');
    if (!liveDoctor(d) || !activeGrants(p.patient_id).includes(d.doctor_code)) {
      audit(req, { action: 'VIEW_SENSITIVE', type: 'patient', ref: p.patient_id, result: 'Denied', reason: 'no consent' });
      return forbid(res, 'The patient has not shared the record with you.');
    }
    actor = db.prepare(`SELECT user_id FROM user_accounts WHERE linked_profile_id = ? AND account_type = 'Doctor'`).get(d.doctor_id);
    audit(req, { actor: actor && actor.user_id, action: 'VIEW_SENSITIVE', type: 'patient', ref: p.patient_id });
  }
  const enc = primaryEncounter(p.patient_id);
  const records = db.prepare(`SELECT r.record_id, r.saved_at, r.document_type, r.file_name, r.ayush_system, r.problem, r.diagnosis, r.prakriti, x.prescription_details, x.instructions
      FROM patient_records r LEFT JOIN prescriptions x ON x.prescription_id = r.prescription_id WHERE r.patient_id = ? ORDER BY r.record_id`).all(p.patient_id).map((r) => ({
    recordId: `R-${r.record_id}`, savedAt: r.saved_at, healthId: p.health_id, documentType: r.document_type, fileName: r.file_name,
    system: r.ayush_system, problem: r.problem, diagnosis: r.diagnosis, prakriti: r.prakriti,
    medicines: JSON.parse(r.prescription_details || '[]'), advice: r.instructions || '',
  }));
  const uploads = db.prepare('SELECT * FROM patient_uploads WHERE patient_id = ? ORDER BY upload_id').all(p.patient_id)
    .map((u) => ({ uploadId: `U-${u.upload_id}`, fileName: u.file_name, documentType: u.mime_type, uploadedAt: u.uploaded_at, savedAt: u.uploaded_at }));
  const medicalHistory = db.prepare('SELECT condition_name conditionName, allergies, current_medications currentMedications, past_surgeries pastSurgeries, family_history familyHistory, chronic_conditions chronicConditions, previous_treatments previousTreatments, recorded_at recordedAt FROM patient_medical_history WHERE patient_id = ? ORDER BY recorded_at DESC').all(p.patient_id);
  const concerns = db.prepare('SELECT symptoms, duration, notes, recorded_at recordedAt FROM patient_health_concerns WHERE patient_id = ? ORDER BY recorded_at DESC').all(p.patient_id);
  const lastRec = records.length ? records[records.length - 1] : null; // newest saved record: pre-fills the doctor's forms
  const lastExtracted = lastRec ? { problem: lastRec.problem, diagnosis: lastRec.diagnosis, prakriti: lastRec.prakriti, medicines: lastRec.medicines, advice: lastRec.advice } : null;
  res.json({ name: p.full_name, healthId: p.health_id, consultationId: enc.consultation_code, gender: p.gender, dob: p.date_of_birth, records, uploads, medicalHistory, concerns, lastExtracted, sharedWith: activeGrants(p.patient_id) });
});

v1.post('/patients/:id/consents', (req, res) => {
  const p = getPatient(req.params.id);
  if (!p) return res.status(404).json({ message: 'No record found for this ID.' });
  if (role(req) && role(req) !== 'patient') return forbid(res, 'Only the patient can change sharing.');
  const ids = [...new Set(arr((req.body || {}).doctorIds))];
  const valid = ids.filter((c) => liveDoctor(doctorByCode(c)));
  const current = activeGrants(p.patient_id);
  const user = db.prepare(`SELECT user_id FROM user_accounts WHERE linked_profile_id = ? AND account_type = 'Patient'`).get(p.patient_id);
  const t = now();
  db.transaction(() => {
    current.filter((c) => !valid.includes(c)).forEach((c) => {
      db.prepare(`UPDATE consent_records SET consent_status='Withdrawn', withdrawn_at=? WHERE subject_profile_id=? AND purpose='health-data sharing' AND consent_status='Granted'
                  AND consent_id IN (SELECT g.consent_id FROM consent_grants g JOIN doctors d ON d.doctor_id=g.doctor_id WHERE d.doctor_code=?)`).run(t, p.patient_id, c);
      audit(req, { actor: user && user.user_id, action: 'CONSENT_WITHDRAWN', type: 'doctor', ref: doctorByCode(c).doctor_id });
    });
    valid.filter((c) => !current.includes(c)).forEach((c) => {
      const cid = uuid();
      db.prepare(`INSERT INTO consent_records (consent_id,user_id,subject_profile_id,purpose,notice_version,consent_status,captured_at,capture_method)
                  VALUES (?,?,?, 'health-data sharing', 'v1', 'Granted', ?, 'Web')`).run(cid, user && user.user_id, p.patient_id, t);
      db.prepare('INSERT INTO consent_grants (consent_id,doctor_id) VALUES (?,?)').run(cid, doctorByCode(c).doctor_id);
      audit(req, { actor: user && user.user_id, action: 'CONSENT_GRANTED', type: 'doctor', ref: doctorByCode(c).doctor_id });
    });
  })();
  res.json({ sharedWith: activeGrants(p.patient_id) });
});

// ================= Ayurveda forms =================
// Every save keeps a new version in ayurveda_parts. The values the report defines for ayurveda_assessments
// (prakriti, vikriti, agni, koshtha, digestion, diet, lifestyle) are also copied into that table.
const PARTS = ['prakriti', 'vikriti', 'diagnosis', 'examination', 'dashavidha-pariksha', 'therapy'];
const PRACTITIONER_ONLY = ['diagnosis'];

function latestPart(cid, part) {
  const r = db.prepare('SELECT * FROM ayurveda_parts WHERE consultation_id = ? AND part = ? ORDER BY version DESC LIMIT 1').get(cid, part);
  return r ? { ...JSON.parse(r.data), _version: r.version, _savedAt: r.saved_at } : null;
}
const DOSHAS = ['Vata', 'Pitta', 'Kapha'];
const doshasIn = (s) => DOSHAS.filter((d) => new RegExp(d, 'i').test(String(s || '')));

function syncAssessment(enc, part, body, doctorCode) {
  const d = doctorCode ? doctorByCode(doctorCode) : null;
  let a = db.prepare('SELECT * FROM ayurveda_assessments WHERE encounter_id = ?').get(enc.encounter_id);
  if (!a) {
    const id = uuid();
    db.prepare('INSERT INTO ayurveda_assessments (assessment_id,patient_id,encounter_id) VALUES (?,?,?)').run(id, enc.patient_id, enc.encounter_id);
    a = { assessment_id: id };
  }
  const set = {};
  if (part === 'prakriti') set.prakriti = str(body.prakriti);
  if (part === 'vikriti') set.vikriti = str(body.vikriti);
  if (part === 'examination') { set.agni = str(body.agni); set.koshtha = str(body.koshtha); set.digestion = str(body.relatedFindings); }
  if (part === 'therapy') { set.diet_notes = str(body.dietAdvice); set.lifestyle_notes = str(body.lifestyleAdvice); }
  if (part === 'diagnosis') db.prepare('UPDATE encounters SET clinical_notes = ? WHERE encounter_id = ?').run([str(body.diagnosis), str(body.notes)].filter(Boolean).join('\n'), enc.encounter_id);
  const keys = Object.keys(set);
  if (keys.length) {
    db.prepare(`UPDATE ayurveda_assessments SET ${keys.map((k) => `${k} = ?`).join(', ')}, assessed_by_doctor_id = COALESCE(?, assessed_by_doctor_id), assessed_at = ? WHERE assessment_id = ?`)
      .run(...keys.map((k) => set[k]), d ? d.doctor_id : null, now(), a.assessment_id);
  }
  if (d) db.prepare('UPDATE encounters SET doctor_reference_id = ?, status = ? WHERE encounter_id = ?').run(d.doctor_id, 'Scheduled', enc.encounter_id);
}

const ayurveda = express.Router();

ayurveda.get('/consultations/:cid/prakriti-vikriti', (req, res) => {
  const pk = latestPart(req.params.cid, 'prakriti');
  const vk = latestPart(req.params.cid, 'vikriti');
  if (!pk || !vk) return res.status(404).json({ message: 'Record both Prakriti and Vikriti first.' });
  const P = doshasIn(pk.prakriti), V = doshasIn(vk.vikriti);
  const differences = [
    ...P.filter((d) => !V.includes(d)).map((d) => `${d} (Prakriti) is not currently aggravated`),
    ...V.filter((d) => !P.includes(d)).map((d) => `${d} is aggravated beyond the natural constitution`),
  ];
  res.json({ prakriti: pk.prakriti, vikriti: vk.vikriti, differences });
});

ayurveda.get('/consultations/:cid/:part', (req, res) => {
  if (!PARTS.includes(req.params.part)) return res.status(404).json({ message: 'Unknown form.' });
  const d = latestPart(req.params.cid, req.params.part);
  return d ? res.json(d) : res.status(404).json({ message: 'Nothing saved yet.' });
});

ayurveda.post('/consultations/:cid/:part', (req, res) => {
  const { cid, part } = req.params;
  if (!PARTS.includes(part)) return res.status(404).json({ message: 'Unknown form.' });
  const enc = db.prepare('SELECT * FROM encounters WHERE consultation_code = ?').get(cid);
  if (!enc) return res.status(404).json({ message: 'Consultation not found.' });
  if (PRACTITIONER_ONLY.includes(part) && role(req) !== 'practitioner') return forbid(res);

  const key = req.get('Idempotency-Key');
  const route = `${cid}/${part}`;
  const prev = idemGet(key, route);
  if (prev) return res.status(prev.status).json(JSON.parse(prev.response));
  const body = req.body || {};
  if (!Object.keys(body).length) return res.status(400).json({ message: 'Nothing to save.' });

  const doctorCode = role(req) === 'practitioner' ? req.get('X-Doctor-Id') : null;
  const savedAt = now();
  const version = db.transaction(() => {
    const last = db.prepare('SELECT MAX(version) v FROM ayurveda_parts WHERE consultation_id = ? AND part = ?').get(cid, part).v || 0;
    db.prepare('INSERT INTO ayurveda_parts (consultation_id,part,version,data,saved_by,saved_at) VALUES (?,?,?,?,?,?)')
      .run(cid, part, last + 1, JSON.stringify(body), doctorCode || role(req) || null, savedAt);
    syncAssessment(enc, part, body, doctorCode);
    return last + 1;
  })();
  const out = { ok: true, consultationId: cid, version, savedAt };
  idemSet(key, route, 201, out);
  res.status(201).json(out);
});

v1.use('/ayurveda', ayurveda);
v1.use('/', ayurveda); // frontend may call /v1/consultations/... directly

// ================= admin: verification queue, decisions, documents, audit =================
const OPEN_STATUSES = ['Pending', 'Under Review'];
const DECISIONS = {
  start_review: { case: 'Under Review', profile: 'Under Review', docs: null, needReason: false },
  approve: { case: 'Approved', profile: 'Approved', docs: 'Verified', needReason: false },
  reject: { case: 'Rejected', profile: 'Rejected', docs: 'Rejected', needReason: true },
  request_info: { case: 'More Information Required', profile: 'More Information Required', docs: 'Needs More Information', needReason: true },
};
const KIND = { practitioner: 'DOCTOR', doctor: 'DOCTOR', facility: 'FACILITY', clinic: 'FACILITY' };

function queueRows(perms) {
  const rows = [];
  if (perms.has('doctor.verify')) {
    db.prepare(`SELECT c.verification_case_id caseId, c.status, c.submitted_at submittedAt, c.decision_reason reason, d.doctor_code id, d.full_name name, d.ayush_system sys,
        r.registration_number reg, r.council_authority council, q.degree_name degree, q.certificate_reference doc
        FROM verification_cases c JOIN doctors d ON d.doctor_id = c.subject_reference_id
        LEFT JOIN doctor_registrations r ON r.doctor_id = d.doctor_id LEFT JOIN doctor_qualifications q ON q.doctor_id = d.doctor_id
        WHERE c.subject_type = 'DOCTOR' AND c.status IN ('Pending','Under Review')`).all()
      .forEach((x) => rows.push({ kind: 'practitioner', id: x.id, caseId: x.caseId, name: x.name, status: x.status, detail: `${x.sys} · ${x.degree || '-'} · Reg ${x.reg || '-'} (${x.council || '-'})`, hasDocument: !!x.doc, submittedAt: x.submittedAt }));
  }
  if (perms.has('facility.approve')) {
    db.prepare(`SELECT c.verification_case_id caseId, c.status, c.submitted_at submittedAt, f.facility_code id, f.legal_name name, f.facility_type type,
        r.registration_number reg, r.document_reference doc
        FROM verification_cases c JOIN facilities f ON f.facility_id = c.subject_reference_id
        LEFT JOIN facility_registrations r ON r.facility_id = f.facility_id
        WHERE c.subject_type = 'FACILITY' AND c.status IN ('Pending','Under Review')`).all()
      .forEach((x) => rows.push({ kind: 'facility', id: x.id, caseId: x.caseId, name: x.name, status: x.status, detail: `${x.type || 'Facility'} · Reg ${x.reg || '-'}`, hasDocument: !!x.doc, submittedAt: x.submittedAt }));
  }
  return rows.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}

v1.get('/admin/pending', (req, res) => {
  const c = adminCtx(req);
  if (!c || !(c.perms.has('doctor.verify') || c.perms.has('facility.approve') || c.perms.has('audit.view'))) return forbid(res, 'Administrators only.');
  res.json(queueRows(c.perms));
});

v1.get('/admin/audit', need('audit.view'), (req, res) => {
  res.json(db.prepare(`SELECT a.timestamp at, a.action, a.entity_type kind, a.entity_reference_id targetId, a.result, a.reason,
      COALESCE(ap.full_name, p.full_name, d.full_name, f.legal_name, 'System') by_name
      FROM audit_logs a LEFT JOIN user_accounts u ON u.user_id = a.actor_user_id
      LEFT JOIN admin_profiles ap ON ap.admin_id = u.linked_profile_id AND u.account_type = 'Admin'
      LEFT JOIN patients p ON p.patient_id = u.linked_profile_id AND u.account_type = 'Patient'
      LEFT JOIN doctors d ON d.doctor_id = u.linked_profile_id AND u.account_type = 'Doctor'
      LEFT JOIN facilities f ON f.facility_id = u.linked_profile_id AND u.account_type = 'Facility Representative'
      ORDER BY a.timestamp DESC LIMIT 500`).all()
    .map((r) => ({ at: r.at, by: r.by_name, decision: r.action, action: r.action, kind: r.kind, targetId: r.targetId, result: r.result, reason: r.reason })));
});

v1.get('/admin/documents/:kind/:id', need('document.view'), (req, res) => {
  const sub = KIND[req.params.kind];
  let ref = null; let entity = null;
  if (sub === 'DOCTOR') {
    const d = doctorByCode(req.params.id); entity = d && d.doctor_id;
    ref = d && (db.prepare('SELECT certificate_reference r FROM doctor_qualifications WHERE doctor_id = ? AND certificate_reference IS NOT NULL').get(d.doctor_id) || {}).r;
  } else if (sub === 'FACILITY') {
    const f = db.prepare('SELECT facility_id FROM facilities WHERE facility_code = ?').get(req.params.id); entity = f && f.facility_id;
    ref = f && (db.prepare('SELECT document_reference r FROM facility_registrations WHERE facility_id = ? AND document_reference IS NOT NULL').get(f.facility_id) || {}).r;
  }
  const file = ref && path.join(STORAGE_DIR, path.basename(ref));
  if (!file || !fs.existsSync(file)) return res.status(404).json({ message: 'No document on file.' });
  audit(req, { actor: req.admin.user_id, action: 'VIEW_SENSITIVE', type: sub.toLowerCase(), ref: entity, reason: 'verification document' });
  return res.sendFile(file);
});

v1.post('/admin/decisions', (req, res) => {
  const c = adminCtx(req);
  if (!c) return forbid(res, 'Administrators only.');
  const { kind, id } = req.body || {};
  const decision = String((req.body || {}).decision || '');
  const reason = str((req.body || {}).reason);
  const sub = KIND[kind];
  if (!sub) return res.status(400).json({ message: 'Unknown kind.' });
  const perm = sub === 'DOCTOR' ? 'doctor.verify' : 'facility.approve';
  if (!c.perms.has(perm)) {
    audit(req, { actor: c.user_id, action: decision.toUpperCase(), type: sub.toLowerCase(), ref: id, result: 'Denied', reason: perm });
    return forbid(res, 'Your role cannot approve or reject this. Auditors can view only.');
  }
  const rule = DECISIONS[decision];
  if (!rule) return res.status(400).json({ message: 'Decision must be start_review, approve, reject or request_info.' });
  if (rule.needReason && !reason) return res.status(400).json({ message: 'Please give a reason.', errors: { reason: 'A reason is required' } });
  const row = sub === 'DOCTOR'
    ? db.prepare('SELECT doctor_id eid, profile_status st FROM doctors WHERE doctor_code = ?').get(id)
    : db.prepare('SELECT facility_id eid, facility_status st FROM facilities WHERE facility_code = ?').get(id);
  if (!row) return res.status(404).json({ message: 'Not found.' });
  const cs = db.prepare(`SELECT * FROM verification_cases WHERE subject_type = ? AND subject_reference_id = ? AND status IN ('Pending','Under Review') ORDER BY submitted_at DESC LIMIT 1`).get(sub, row.eid);
  if (!cs) return res.status(409).json({ message: `Already ${row.st}.` });
  if (decision === 'start_review' && cs.status === 'Under Review') return res.status(409).json({ message: 'Already under review.' });

  const t = now();
  db.transaction(() => {
    const final = decision !== 'start_review';
    db.prepare('UPDATE verification_cases SET status=?, assigned_admin_id=?, decision_reason=COALESCE(?, decision_reason), decided_at=? WHERE verification_case_id=?')
      .run(rule.case, c.admin_id, reason, final ? t : null, cs.verification_case_id);
    if (sub === 'DOCTOR') {
      db.prepare('UPDATE doctors SET profile_status=?, updated_at=? WHERE doctor_id=?').run(rule.profile, t, row.eid);
      if (rule.docs) {
        db.prepare('UPDATE doctor_registrations SET verification_status=?, verified_by_admin_id=?, verified_at=? WHERE doctor_id=?').run(rule.docs, c.admin_id, t, row.eid);
        db.prepare('UPDATE doctor_qualifications SET verification_status=? WHERE doctor_id=?').run(rule.docs === 'Needs More Information' ? 'Pending' : rule.docs, row.eid);
      }
      if (decision === 'approve') db.prepare(`UPDATE facility_doctors SET association_status='Active', start_date=? WHERE doctor_reference_id=? AND association_status='Pending'`).run(t.slice(0, 10), row.eid);
      if (decision === 'reject') db.prepare(`UPDATE facility_doctors SET association_status='Rejected' WHERE doctor_reference_id=? AND association_status='Pending'`).run(row.eid);
    } else {
      db.prepare('UPDATE facilities SET facility_status=?, updated_at=? WHERE facility_id=?').run(rule.profile, t, row.eid);
      if (rule.docs) db.prepare('UPDATE facility_registrations SET verification_status=? WHERE facility_id=?').run(rule.docs, row.eid);
    }
    audit(req, { actor: c.user_id, action: decision === 'start_review' ? 'REVIEW' : decision === 'approve' ? 'APPROVE' : decision === 'reject' ? 'REJECT' : 'REQUEST_INFO', type: sub.toLowerCase(), ref: row.eid, reason });
  })();
  res.json({ status: rule.profile, caseStatus: rule.case });
});



// Text translation for the "Speak & translate" page (English, Hindi, Kannada only).
// TRANSLATE_URL (+ TRANSLATE_KEY) = any LibreTranslate-compatible server; otherwise the free MyMemory service is used.
v1.post('/translate', async (req, res) => {
  const { text, source, target } = req.body || {};
  const OK = ['en', 'hi', 'kn'];
  if (!OK.includes(source) || !OK.includes(target)) return res.status(400).json({ message: 'Only English, Hindi and Kannada are supported.' });
  const q = String(text || '').trim().slice(0, 450);
  if (!q) return res.status(400).json({ message: 'Type or speak something first.' });
  try {
    if (process.env.TRANSLATE_URL) {
      const r = await fetch(process.env.TRANSLATE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q, source, target, format: 'text', api_key: process.env.TRANSLATE_KEY || undefined }) });
      if (!r.ok) throw new Error(`translate ${r.status}`);
      return res.json({ translated: (await r.json()).translatedText });
    }
    const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${source}|${target}`);
    if (!r.ok) throw new Error(`mymemory ${r.status}`);
    return res.json({ translated: (await r.json()).responseData.translatedText });
  } catch (e) {
    return res.status(502).json({ message: 'Translation is not available right now. Check the internet connection or TRANSLATE_URL.' });
  }
});

// ================= my details (any role) =================
// Face or OTP sign-in returns a signed token; this returns what is stored for that person.
v1.get('/me', (req, res) => {
  const tok = sec.verify((req.get('Authorization') || '').replace(/^Bearer /, ''));
  if (!tok || !tok.u) return res.status(401).json({ message: 'Please sign in again.' });
  const user = db.prepare('SELECT * FROM user_accounts WHERE user_id = ?').get(tok.u);
  if (!user || user.account_status !== 'Active') return res.status(403).json({ message: 'This account is not active.' });
  const base = { role: face.ROLE_OF[user.account_type], mobile: user.mobile_number, faceRegistered: !!face.profileFor(user.mobile_number), lastLogin: user.last_login_at, otherRoles: db.prepare('SELECT account_type t FROM user_accounts WHERE mobile_number = ? AND user_id != ?').all(user.mobile_number, user.user_id).map((r) => face.ROLE_OF[r.t]) };
  audit(req, { actor: user.user_id, action: 'VIEW', type: 'own details', ref: user.user_id });
  if (user.account_type === 'Patient') {
    const p = db.prepare('SELECT * FROM patients WHERE patient_id = ?').get(user.linked_profile_id);
    return res.json({ ...base, name: p.full_name, code: p.health_id, codeLabel: 'Health Record ID', details: {
      'Date of birth': p.date_of_birth, Gender: p.gender, Email: p.email, Address: p.address_line, City: p.city, State: p.state, Pincode: p.postal_code,
      'Aadhaar (masked)': (db.prepare('SELECT masked_document_number m FROM patient_identity_references WHERE patient_id = ?').get(p.patient_id) || {}).m,
      'ABHA number': (db.prepare('SELECT abha_number a FROM patient_identity_references WHERE patient_id = ?').get(p.patient_id) || {}).a,
      'Emergency contact': (db.prepare('SELECT contact_name || \' (\' || phone_number || \')\' c FROM patient_emergency_contacts WHERE patient_id = ? LIMIT 1').get(p.patient_id) || {}).c,
      'Records saved': db.prepare('SELECT COUNT(*) c FROM patient_records WHERE patient_id = ?').get(p.patient_id).c,
    } });
  }
  if (user.account_type === 'Doctor') {
    const d = db.prepare('SELECT * FROM doctors WHERE doctor_id = ?').get(user.linked_profile_id);
    const reg = db.prepare('SELECT * FROM doctor_registrations WHERE doctor_id = ?').get(d.doctor_id) || {};
    const q = db.prepare('SELECT degree_name FROM doctor_qualifications WHERE doctor_id = ?').all(d.doctor_id).map((x) => x.degree_name).join(', ');
    return res.json({ ...base, name: d.full_name, code: d.doctor_code, codeLabel: 'Doctor ID', details: {
      'System of medicine': d.ayush_system, Qualification: q, 'Council registration': reg.registration_number, Council: reg.council_authority, Status: d.profile_status,
      Email: d.professional_email, City: d.city, State: d.state, Languages: d.languages, 'Experience (years)': d.experience_years } });
  }
  if (user.account_type === 'Facility Representative') {
    const f = db.prepare('SELECT * FROM facilities WHERE facility_id = ?').get(user.linked_profile_id);
    const a = db.prepare('SELECT * FROM facility_addresses WHERE facility_id = ?').get(f.facility_id) || {};
    const reg = db.prepare('SELECT * FROM facility_registrations WHERE facility_id = ?').get(f.facility_id) || {};
    return res.json({ ...base, name: f.display_name || f.legal_name, code: f.facility_code, codeLabel: 'Facility ID', details: {
      'Legal name': f.legal_name, Type: f.facility_type, Ownership: f.ownership_type, Licence: reg.registration_number, Status: f.facility_status,
      Address: a.address_line, City: a.city, State: a.state, Email: f.official_email, Phone: f.official_phone,
      Systems: db.prepare('SELECT DISTINCT ayush_system s FROM facility_services WHERE facility_id = ?').all(f.facility_id).map((x) => x.s).join(', ') } });
  }
  const a = db.prepare('SELECT * FROM admin_profiles WHERE admin_id = ?').get(user.linked_profile_id);
  return res.json({ ...base, name: a.full_name, code: a.admin_code, codeLabel: 'Admin ID', details: {
    Role: db.prepare('SELECT r.role_name n FROM user_role_assignments x JOIN roles r ON r.role_id = x.role_id WHERE x.user_id = ?').all(user.user_id).map((x) => x.n).join(', '),
    Designation: a.designation, Department: a.department, 'Official email': a.official_email } });
});

// Optional WhatsApp channel (mock by default, so nothing connects to WhatsApp unless you choose a mode in .env)
if (process.env.WHATSAPP_MODE !== 'off') require('./whatsapp')(app, { v1 });

app.get('/health', (req, res) => res.json({ service: 'ayush-backend', ok: true }));
app.use('/v1', v1);

// ---------- errors ----------
const DIST = path.join(__dirname, 'dist');
if (fs.existsSync(path.join(DIST, 'index.html'))) { // one-port mode: npm run build && npm start
  app.use(express.static(DIST));
  app.get(/^\/(?!v1\/|whatsapp).*/, (req, res) => res.sendFile(path.join(DIST, 'index.html')));
}
app.use((req, res) => res.status(404).json({ message: 'Not found.' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Invalid JSON' });
  if (err instanceof multer.MulterError) {
    dropFile(req.file);
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 10 MB.' : err.code === 'LIMIT_UNEXPECTED_FILE' ? (err.field || 'Only PDF, JPG or PNG files are allowed.') : err.message;
    return res.status(400).json({ message: msg });
  }
  console.error(err);
  return res.status(500).json({ message: 'Server error.' });
});

if (require.main === module) app.listen(PORT, () => console.log(`AYUSH backend running at http://localhost:${PORT}`));
module.exports = app;

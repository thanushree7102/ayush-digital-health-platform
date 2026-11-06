// One-time move of an old ayush.db (flat tables) into the schema-report tables.
// db.js renames the old tables to legacy_* first, creates the new tables, then calls this.
// The legacy tables are dropped only after everything is copied (all inside one transaction).
const SYSTEMS = ['Ayurveda', 'Yoga & Naturopathy', 'Unani', 'Siddha', 'Homoeopathy'];
const STATUS = { pending: 'Submitted', approved: 'Approved', rejected: 'Rejected' };
const exists = (db, t) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
const all = (db, t) => (exists(db, t) ? db.prepare(`SELECT * FROM ${t}`).all() : []);

module.exports = function migrate(db, { uuid, now }) {
  db.transaction(() => {
    const user = (mobile, type, profileId, status = 'Active', at = now()) => {
      const id = uuid();
      db.prepare(`INSERT INTO user_accounts (user_id,mobile_number,account_type,linked_profile_id,account_status,created_at) VALUES (?,?,?,?,?,?)`)
        .run(id, mobile, type, profileId, status, at);
      return id;
    };
    const log = (action, type, ref, reason) => db.prepare(
      `INSERT INTO audit_logs (audit_log_id,action,entity_type,entity_reference_id,timestamp,result,reason) VALUES (?,?,?,?,?,'Success',?)`
    ).run(uuid(), action, type, ref, now(), reason);

    // ---- patients (+ identity reference, primary encounter) ----
    const pid = {}; const enc = {};
    for (const p of all(db, 'legacy_patients')) {
      let d = {}; try { d = JSON.parse(p.details || '{}') || {}; } catch (e) { /* ignore */ }
      const id = uuid(); pid[p.health_id] = id;
      db.prepare(`INSERT INTO patients (patient_id,health_id,full_name,date_of_birth,gender,mobile_number,mobile_verified,email,account_status,created_at)
                  VALUES (?,?,?,?,?,?,1,?, 'Active', ?)`)
        .run(id, p.health_id, p.name, /^\d{4}-\d{2}-\d{2}$/.test(d.dob || d.dateOfBirth || '') ? (d.dob || d.dateOfBirth) : null,
          d.gender || null, p.mobile, d.email || null, p.created_at);
      user(p.mobile, 'Patient', id, 'Active', p.created_at);
      if (p.masked_aadhaar) {
        db.prepare(`INSERT INTO patient_identity_references (identity_reference_id,patient_id,identity_document_type,masked_document_number,verification_status)
                    VALUES (?,?, 'Aadhaar', ?, 'Pending')`).run(uuid(), id, p.masked_aadhaar);
      }
      const eid = uuid(); enc[p.health_id] = eid;
      db.prepare(`INSERT INTO encounters (encounter_id,consultation_code,patient_id,status) VALUES (?,?,?, 'Scheduled')`).run(eid, p.consultation_id, id);
    }

    // ---- facilities ----
    const fid = {};
    for (const f of all(db, 'legacy_facilities')) {
      const id = uuid(); fid[f.id] = id;
      db.prepare(`INSERT INTO facilities (facility_id,facility_code,legal_name,display_name,facility_type,official_phone,official_email,facility_status,created_at)
                  VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(id, f.id, f.name, f.name, f.facility_type, f.mobile, f.email, STATUS[f.status] || 'Submitted', f.submitted_at);
      db.prepare(`INSERT INTO facility_addresses (facility_address_id,facility_id,address_line) VALUES (?,?,?)`).run(uuid(), id, f.address);
      db.prepare(`INSERT INTO facility_registrations (facility_registration_id,facility_id,registration_number,verification_status) VALUES (?,?,?,?)`)
        .run(uuid(), id, f.registration_no, f.status === 'approved' ? 'Verified' : f.status === 'rejected' ? 'Rejected' : 'Pending');
      user(f.mobile, 'Facility Representative', id, 'Active', f.submitted_at);
      if (f.status === 'pending') {
        db.prepare(`INSERT INTO verification_cases (verification_case_id,subject_type,subject_reference_id,verification_type,status,submitted_at)
                    VALUES (?, 'FACILITY', ?, 'Facility licence', 'Pending', ?)`).run(uuid(), id, f.submitted_at);
      }
    }

    // ---- doctors ----
    const did = {};
    for (const d of all(db, 'legacy_practitioners')) {
      const id = uuid(); did[d.id] = id;
      db.prepare(`INSERT INTO doctors (doctor_id,doctor_code,full_name,mobile_number,professional_email,ayush_system,profile_status,created_at)
                  VALUES (?,?,?,?,?,?,?,?)`)
        .run(id, d.id, d.name, d.mobile, d.email, SYSTEMS.includes(d.system) ? d.system : 'Other', STATUS[d.status] || 'Submitted', d.submitted_at);
      const vs = d.status === 'approved' ? 'Verified' : d.status === 'rejected' ? 'Rejected' : 'Pending';
      db.prepare(`INSERT INTO doctor_qualifications (qualification_id,doctor_id,degree_name,certificate_reference,verification_status) VALUES (?,?,?,?,?)`)
        .run(uuid(), id, d.qualification, d.certificate_name, vs === 'Rejected' ? 'Rejected' : vs);
      db.prepare(`INSERT INTO doctor_registrations (registration_id,doctor_id,registration_number,council_authority,verification_status) VALUES (?,?,?,?,?)`)
        .run(uuid(), id, d.registration_no, d.council, vs);
      user(d.mobile, 'Doctor', id, 'Active', d.submitted_at);
      if (d.status === 'pending') {
        db.prepare(`INSERT INTO verification_cases (verification_case_id,subject_type,subject_reference_id,verification_type,status,submitted_at)
                    VALUES (?, 'DOCTOR', ?, 'Professional registration', 'Pending', ?)`).run(uuid(), id, d.submitted_at);
      }
      if (d.facility_id && fid[d.facility_id]) {
        db.prepare(`INSERT INTO facility_doctors (facility_doctor_id,facility_id,doctor_reference_id,association_status) VALUES (?,?,?,?)`)
          .run(uuid(), fid[d.facility_id], id, d.status === 'approved' ? 'Active' : d.status === 'rejected' ? 'Rejected' : 'Pending');
      }
    }

    // ---- admins -> user + admin_profile + role ----
    for (const a of all(db, 'legacy_admins')) {
      const uid = user(a.mobile, 'Admin', null, 'Active', a.created_at);
      const aid = uuid();
      db.prepare(`INSERT INTO admin_profiles (admin_id,admin_code,user_id,full_name,official_email,work_phone,activation_date) VALUES (?,?,?,?,?,?,?)`)
        .run(aid, a.id, uid, a.name, a.email, a.mobile, a.created_at.slice(0, 10));
      db.prepare('UPDATE user_accounts SET linked_profile_id=? WHERE user_id=?').run(aid, uid);
      const role = db.prepare('SELECT role_id id FROM roles WHERE role_name=?').get(a.role === 'auditor' ? 'Auditor' : 'Super Admin').id;
      db.prepare(`INSERT INTO user_role_assignments (user_role_id,user_id,role_id,assigned_at) VALUES (?,?,?,?)`).run(uuid(), uid, role, a.created_at);
    }

    // ---- records -> prescription + patient_records ----
    for (const r of all(db, 'legacy_records')) {
      if (!pid[r.health_id]) continue;
      const rx = uuid();
      db.prepare(`INSERT INTO prescriptions (prescription_id,encounter_id,patient_id,prescription_details,instructions,issued_at) VALUES (?,?,?,?,?,?)`)
        .run(rx, enc[r.health_id], pid[r.health_id], r.medicines || '[]', r.advice, r.saved_at);
      db.prepare(`INSERT INTO patient_records (patient_id,prescription_id,document_type,file_name,ayush_system,problem,diagnosis,prakriti,saved_at) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(pid[r.health_id], rx, r.document_type, r.file_name, r.system, r.problem, r.diagnosis, r.prakriti, r.saved_at);
      if (r.problem) {
        db.prepare(`INSERT INTO patient_health_concerns (concern_id,patient_id,symptoms,recorded_at,encounter_id) VALUES (?,?,?,?,?)`)
          .run(uuid(), pid[r.health_id], r.problem, r.saved_at, enc[r.health_id]);
      }
    }
    for (const u of all(db, 'legacy_uploads')) {
      if (!pid[u.health_id]) continue;
      db.prepare(`INSERT INTO patient_uploads (patient_id,file_name,mime_type,size,uploaded_at) VALUES (?,?,?,?,?)`)
        .run(pid[u.health_id], u.file_name, u.mime_type, u.size, u.uploaded_at);
    }

    // ---- consents (patient -> doctor sharing) ----
    for (const c of all(db, 'legacy_consents')) {
      if (!pid[c.health_id] || !did[c.doctor_id]) continue;
      const cid = uuid();
      db.prepare(`INSERT INTO consent_records (consent_id,subject_profile_id,purpose,notice_version,consent_status,captured_at,capture_method)
                  VALUES (?,?, 'health-data sharing', 'legacy', 'Granted', ?, 'Web')`).run(cid, pid[c.health_id], c.granted_at);
      db.prepare('INSERT INTO consent_grants (consent_id,doctor_id) VALUES (?,?)').run(cid, did[c.doctor_id]);
    }

    // ---- old approve/reject log ----
    for (const a of all(db, 'legacy_audit_log')) {
      db.prepare(`INSERT INTO audit_logs (audit_log_id,action,entity_type,entity_reference_id,timestamp,result,reason) VALUES (?,?,?,?,?,'Success',?)`)
        .run(uuid(), a.decision === 'approve' ? 'APPROVE' : 'REJECT', a.kind, did[a.target_id] || fid[a.target_id] || a.target_id, a.at, `Migrated from old audit log (decided by ${a.by_name})`);
    }
    log('MIGRATE', 'database', null, 'Old ayush.db tables moved into the schema-report tables');

    ['audit_log', 'consents', 'uploads', 'records', 'admins', 'practitioners', 'facilities', 'patients'] // children before parents
      .forEach((t) => db.exec(`DROP TABLE IF EXISTS legacy_${t}`));
  })();
};

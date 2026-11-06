# Database (follows "AYUSH Platform - Database Schema & Registration Design")

SQLite, file `ayush.db`, created by `db.js` on first start. UUID primary keys, ISO-8601 UTC timestamps, CHECK constraints for every controlled value in the report.
An old `ayush.db` (flat tables) is moved into the new tables automatically on first start (`migrate-legacy.js`).

## Tables from the report (30)
patients, patient_emergency_contacts, patient_identity_references, patient_medical_history, patient_health_concerns, ayurveda_assessments, encounters, prescriptions,
doctors, doctor_qualifications, doctor_registrations, doctor_specializations, doctor_availability,
facilities, facility_addresses, facility_registrations, facility_services, facility_doctors, facility_infrastructure,
user_accounts, admin_profiles, roles, permissions, user_role_assignments, role_permissions,
authentication_events, biometric_verifications, consent_records, verification_cases, audit_logs.

## Extra tables / columns (not in the report)
| Item | Why |
|---|---|
| `patients.health_id`, `doctors.doctor_code`, `facilities.facility_code`, `admin_profiles.admin_code`, `encounters.consultation_code` | Short IDs people type and share. UUIDs stay the real keys. |
| `consent_grants` | The report's `consent_records` has no "shared with" column; this says which doctor a sharing consent is for (and an optional expiry). |
| `patient_records` | The prescription-upload screen saves document type, problem, diagnosis and prakriti next to a `prescriptions` row. |
| `patient_uploads` | Uploaded prescription files (bytes go to private `storage/`). |
| `ayurveda_parts` | Versioned copy of each Ayurveda form save. Report fields are also copied into `ayurveda_assessments`. |
| `idempotency` | Safe retries. |

## Where each screen writes
| Screen | Tables |
|---|---|
| Patient registration | patients, user_accounts, encounters, consent_records, patient_emergency_contacts, patient_identity_references (optional), authentication_events, audit_logs |
| Patient > Profile | patient_medical_history, patient_health_concerns |
| Add record | prescriptions, patient_records, patient_health_concerns |
| Privacy (share with doctors) | consent_records + consent_grants (withdraw = status `Withdrawn`) |
| Doctor registration | user_accounts, doctors, doctor_qualifications, doctor_registrations, doctor_specializations, facility_doctors, verification_cases |
| Clinic registration | user_accounts, facilities, facility_addresses, facility_registrations, facility_services, facility_infrastructure, verification_cases |
| Admin dashboard | verification_cases (Pending > Under Review > Approved / Rejected / More Information Required, with reviewer, reason and time), the profile status, audit_logs |
| Ayurveda forms | ayurveda_parts, ayurveda_assessments, encounters.clinical_notes |

## Choices made where the report left it open
- Aadhaar is optional. Only a masked value is stored, with a consent record; its status stays `Pending` because nothing here verifies it with UIDAI.
- One mobile number can hold several roles: uniqueness is per (mobile, account type) on `user_accounts`.
- `user_accounts.login_email` is nullable because sign-in is by mobile OTP.
- Uploaded certificates are saved with random names in `storage/` (not public). The database keeps only the reference. Admins open them through `/v1/admin/documents/...`, which is logged as `VIEW_SENSITIVE`.
- Roles: Super Admin, Doctor Verification Admin, Facility Verification Admin, Patient Support Admin, Auditor, with permissions such as `doctor.verify`, `facility.approve`, `audit.view`.

## Still demo-level (not database work)
- OTP: a new random code per person (`otp.js`, hashed, 5 min, single use; `OTP_CODE` forces a fixed one). Every attempt is logged and 5 wrong tries lock the number for 15 minutes. Add an SMS provider in `POST /v1/auth/otp/send`.
- There are no login tokens yet: the API trusts the `X-Role`, `X-Doctor-Id` and `X-Admin-Id` headers. Add signed sessions before real use.
- `mfa_enabled` stays 0, although the report says it is mandatory for privileged admins.
- `biometric_verifications` exists but nothing writes to it.
- Doctor availability has an API (`PUT /v1/doctors/:id/availability`) but no screen yet.

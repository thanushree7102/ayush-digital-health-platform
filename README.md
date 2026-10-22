# AYUSH Health Record
Run: `npm install && npm start` then open http://localhost:3000 (first OCR run downloads language data; needs internet).
Patient flow: log in (demo OTP 123456) -> Add record -> photo of prescription/medicine -> OCR + NLP draft -> review/correct -> Confirm.
Confirm fills: Document, Encounter, the AYUSH system's own DB, Medication, Patient (allergies), Longitudinal timeline (via event). Safety check warns on allergies, metal preparations, duplicates, cross-system medicines.
Practitioner demo: 9000000001 / 9000000002 (OTP 123456). Needs patient consent (or audited emergency access).
Data lives in `data/*.db`: one SQLite file per service. Delete `data/` to reset.
`/architecture.html` = requirements map and NFR register for evaluators.
Not built: PDF OCR (PDFs go to manual entry), handwriting accuracy is limited, AI intake, ABDM/FHIR, appointments, multilingual UI.

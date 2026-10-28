# AYUSH Health Record (website + WhatsApp)
One platform, two front doors. Patients register and add records on the website OR on WhatsApp; it is the same record (mobile number is the key).

## Run
1. `npm install` (Node 18+; the WhatsApp QR-link needs the optional `@whiskeysockets/baileys`)
2. Copy `.env.example` to `.env`, fill what you have (never commit `.env`)
3. `npm start` -> http://localhost:3000   (patient login: any 10-digit number, demo OTP 123456)

## WhatsApp modes (`WHATSAPP_MODE` in .env)
- `baileys`: open http://localhost:3000/whatsapp-link and scan the QR (WhatsApp > Linked devices). Use a SPARE number: this is an unofficial route and can get a number banned. Options appear as numbered replies.
- `meta`: official Cloud API (webhook `GET/POST /whatsapp`; set WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN, PUBLIC_URL, WHATSAPP_NUMBER). Tap buttons and lists.
- `mock`: no WhatsApp; `POST /whatsapp-mock {"from":"919876543210","text":"Hi"}` returns the bot's replies. Good for demos and tests.

## Flow
Scan QR (website login page) -> chat opens with "Hi" -> opt-in -> name, age, allergies, consent -> registered.
Add a record by photo or by describing it in words -> draft -> Save / Edit / Cancel -> safety check -> summary (also sent to WhatsApp if the patient opted in there).
Menu: summary, timeline, medicines, allergies, by system, uploads (resume pending), who can see my data, allow a doctor.

## Security
`.env`, `data/` (databases, WhatsApp login session `data/wa_auth`) and `*.traineddata` are git-ignored. Anyone with `data/wa_auth` can control the linked WhatsApp number.
`/architecture.html` = requirements map and NFR register.

# AYUSH Unified – face sign-in for every role, demo Aadhaar, WhatsApp, voice + English / Hindi / Kannada

One project made from your three zips:

| Part | Came from |
|---|---|
| React + Vite screens, Express + SQLite backend, 30-table database, role forms, admin approval | `ayush-with-database` (base and style) |
| WhatsApp bot (Meta / QR / mock), same patient record by mobile number | `ayush-platform-v3_5` (ported onto this database) |
| Voice typing, read aloud, face check idea, translate | `ayush-ayurveda-service-updated` (re-written in React) |

## Run
```
npm install            # also copies the face models into public/models (offline, no CDN)
npm run build && npm start      # everything on http://localhost:4000
# or for development:  npm run dev:all   -> app on http://localhost:5173, API on :4000
npm run smoke          # 58 backend checks + 15 one-time-code checks (face, OTP, Aadhaar, all roles, WhatsApp in 3 languages)
```
Camera and microphone need `localhost` or HTTPS (phones need HTTPS). Voice typing needs Chrome or Edge.

## The flow
1. **Start screen:** choose role, type the **mobile number**.
2. Number has an account → **Scan my face** (just look at the camera) → face matched → **a new OTP is sent to that number** → enter it → signed in. "Use OTP instead" (OTP only, no camera) is always there.
3. No account → **Create an account** → same step for all four roles (**patient, doctor, clinic, admin**): mobile + consent + **face scan** → face found → **a new OTP is sent** → enter it.
4. Then the role's own details. **Fetch my details from Aadhaar (demo)** fills name, date of birth, gender, address, city, state, pincode from a demo number.
5. After sign-in, **My details** (`/me`) fetches everything stored for that person, for any role.
6. One number can hold several roles with the **same face**. Accounts made on WhatsApp are asked to add a face at their first website sign-in.

### Demo Aadhaar numbers (made-up people, valid checksum)
`2345 6789 0124` Ananya Rao · `3456 7890 1238` Ravi Kumar · `4567 8901 2341` Lakshmi Devi · `5678 9012 3458` Dr. Suresh Hegde · `6789 0123 4560` Priya Sharma · `7890 1234 5674` Mohammed Irfan

Other demo logins (the OTP is shown on screen and printed in the server terminal): doctor 9000000001, clinic 9000000005, admin 9000000009, auditor 9000000008. Admin invite code: `AYUSH-ADMIN-2026`.

## Languages and voice
- English, हिन्दी, ಕನ್ನಡ switch in the top bar. Texts live in `src/i18n/dict.js` (keyed by the English text).
- 🎤 on every text field (numbers like "double nine" and Hindi/Kannada digit words work; email: "name at the rate gmail dot com"). "Fill this form by voice" asks each field aloud.
- **Speak & translate** page: speak, translate, read aloud. Needs internet (`TRANSLATE_URL`/`TRANSLATE_KEY` for your own LibreTranslate, otherwise MyMemory).
- The doctor-side Ayurveda clinical forms are still English; the registration, sign-in, my-details and WhatsApp bot are fully 3-language.

## One-time codes (OTP)
- Every person and every request gets a **different random 6-digit code** (`otp.js`): stored only as a keyed hash, valid 5 minutes, single use, 5 wrong tries burn it, a new code can be asked every 30 seconds (6 per hour).
- Delivery: **on WhatsApp** when the bot is linked and the number has WhatsApp; **always printed in the server terminal** (`[OTP] +91 98xxxxxx -> 123456`); and in demo mode **shown on screen** (`OTP_SHOW=0` hides it). To use SMS, send the code from `POST /v1/auth/otp/send` in `server.js`.
- `OTP_CODE=123456` in `.env` forces one fixed code for everybody (old behaviour; the smoke test uses it).
- After a code is accepted the number is "proven" for 10 minutes, so registration (face → OTP → details form → submit) asks for the code only once.

## WhatsApp (`WHATSAPP_MODE` in `.env`, see `.env.example`)
`auto` (**default**: Meta if `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID` are set, otherwise Baileys, otherwise mock) · `baileys` · `meta` (official Cloud API, webhook `/whatsapp`) · `mock` (`POST /whatsapp-mock`) · `off`.
**Linking (Baileys):** run `npm start`. A **QR code is printed in the terminal** (and shown at http://localhost:4000/whatsapp-link on the same computer). On the phone of the bot's number: WhatsApp → Linked devices → Link a device → scan. The link is kept in `data/wa_auth`, so you scan only once. Use a spare number: this is the unofficial route.
Bot: language → register (name, date of birth, allergies, consent) → menu: summary, timeline, medicines, view by system, add by typing, uploads, who can see my data, allow a doctor, change language, unregister.
**Send a photo or PDF of a prescription/report**: the bot reads it (AI vision if `ANTHROPIC_API_KEY` is set in `.env`, otherwise the offline Tesseract reader for printed English), shows a draft → **Save / Edit here / Cancel** → safety check (allergies, metal preparations, duplicates, mixing systems) → summary. Unfinished drafts wait under **My uploads**. "Unregister" deletes the account and all records. Type "bye" any time to end the chat. Records saved on the website are also sent to opted-in WhatsApp users.
(The new draft / edit / safety / unregister messages are in English; the menu and registration are in English, Hindi and Kannada.)
Voice notes: set `STT_URL` (+ `STT_KEY`, `STT_MODEL`) to an OpenAI-compatible transcription endpoint; without it the bot says it cannot read voice notes.

## Face recognition: what it does and does not do
- face-api.js runs in the browser; the photo never leaves it. Only a 128-number template is sent, stored **AES-256-GCM encrypted** in `face_profiles`, one per mobile number, with a consent record and an entry in `biometric_verifications`.
- Sign-in is a 1:1 check against that number's template (distance ≤ 0.5, `FACE_THRESHOLD`), followed by a one-time code. 5 failed scans lock face sign-in for 15 minutes (OTP-only sign-in still works).
- Registration without the face step is refused by the server (`FACE_REQUIRED=0` turns that off).
- **Limit:** there is no liveness check (no blink), so a photo or video of the person may be accepted. Real use needs server-side liveness (presentation-attack detection) or a certified provider.
- **Demo-level, as before:** the OTP is shown on screen in demo mode (`OTP_SHOW=0` to hide); Aadhaar is a demo directory (no UIDAI call); the older doctor/admin screens still trust role headers; only `/v1/me` uses the signed session token. Set `AYUSH_SECRET` in production.

## New files
`face.js`, `aadhaar.js`, `security.js`, `whatsapp/` (backend) · `src/components/FaceCapture.jsx`, `AadhaarFetch.jsx`, `VoiceMic.jsx`, `RoleRegister.jsx`, `src/voice/speech.js`, `src/i18n/`, `src/pages/Me.jsx`, `Assistant.jsx`, `Landing.jsx` (frontend). New tables: `face_profiles`, `face_pending`, `face_attempts`, `demo_aadhaar`, `wa_chats`.

## Latest changes
- **Different OTP for every person**, sent after the face is found (registration and sign-in); WhatsApp delivery; shown on screen in demo mode.
- **WhatsApp connects by default** (`auto` mode) and prints the **QR in the terminal**.
- **Voice listens until you pause**, shows the words live, waits longer for numbers; tap the mic again to finish early.
- **Prescription reading is real now.** `/v1/records/extract` reads the uploaded photo with the same reader as the WhatsApp bot (AI vision when `ANTHROPIC_API_KEY` is set, otherwise the offline Tesseract reader). One Tesseract worker stays warm, so the second photo takes about half a second. Prakriti is matched to the allowed options. The doctor's forms are pre-filled from the patient's newest record (`lastExtracted` in the summary).
- **Faster face scan.** Face models load (and do one dummy scan) while the person types the number or fills the form; the scan itself uses a smaller detector size and shorter gaps between samples. No blink needed.
- **Better voice input.** The speech engine returns up to 5 guesses; the guided form fill and the mic buttons use the first guess that fits the field (digits, email, a choice). `listen()` still works as before.
- **Hindi / Kannada everywhere.** 209 more screen and server messages translated (518 keys per language), and `src/i18n/domTranslate.js` translates any remaining English text on screen automatically. Have a native speaker review the wording before real use.

## WhatsApp voice notes and "read my details" button
- **Voice notes in the bot**: a person can answer by voice (language, "yes", name, date of birth, allergies, menu number). The bot shows what it heard, then continues the normal steps. Speech-to-text is `whatsapp/voice.js`: it uses `STT_URL` if set, otherwise the built-in offline Whisper (optional packages `@huggingface/transformers` + `ffmpeg-static`; the model downloads once). Test: `npm run test:voice`.
- **Website**: the My details page has one voice button that reads all the stored details aloud in the chosen language.
- **OTP**: a different code per person; it is sent to WhatsApp and, in demo mode, also shown on screen (`OTP_SHOW=0` hides it).

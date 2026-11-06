// WhatsApp voice notes -> text, so a person can answer the bot by voice (name, date of birth, allergies, "yes", a menu number...).
// Order: 1) STT_URL if set (any OpenAI-compatible /audio/transcriptions: OpenAI, Groq, a local whisper server...)
//        2) otherwise a built-in offline Whisper (optional npm packages @huggingface/transformers + ffmpeg-static;
//           the model downloads once on the first voice note (~250 MB), then speech works without internet).
// Language = the language the person chose in the chat (English / Hindi / Kannada).
const { spawn } = require('child_process');

const LANG_NAME = { en: 'english', hi: 'hindi', kn: 'kannada' };
const MODEL = process.env.STT_LOCAL_MODEL || 'Xenova/whisper-small';

const has = (name) => { try { require.resolve(name); return true; } catch (e) { return false; } };
const ffmpegPath = () => { try { const f = require('ffmpeg-static'); return f && require('fs').existsSync(f) ? f : 'ffmpeg'; } catch (e) { return 'ffmpeg'; } };
const localReady = () => has('@huggingface/transformers');
const available = () => !!process.env.STT_URL || localReady();

// any WhatsApp audio (ogg/opus, m4a, mp3...) -> 16 kHz mono float samples
function toPcm(buf) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), ['-v', 'error', '-i', 'pipe:0', '-f', 'f32le', '-ac', '1', '-ar', '16000', 'pipe:1']);
    const out = []; let err = '';
    p.stdout.on('data', (d) => out.push(d)); p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => reject(new Error(`ffmpeg not available: ${e.message}`)));
    p.stdin.on('error', () => { /* ffmpeg closed early; the close handler reports it */ });
    p.on('close', (code) => {
      if (code !== 0 && !out.length) return reject(new Error(`ffmpeg failed: ${err.slice(0, 200)}`));
      const b = Buffer.concat(out); const ab = new ArrayBuffer(b.length - (b.length % 4)); new Uint8Array(ab).set(b.subarray(0, ab.byteLength));
      resolve(new Float32Array(ab));
    });
    p.stdin.end(buf);
  });
}

let asr = null;
async function local(buf, lang) {
  if (!asr) asr = import('@huggingface/transformers').then((m) => m.pipeline('automatic-speech-recognition', MODEL)).catch((e) => { asr = null; throw e; });
  const pipe = await asr;
  const pcm = await toPcm(buf);
  const r = await pipe(pcm, { language: LANG_NAME[lang] || 'english', task: 'transcribe', chunk_length_s: 30 });
  return String(r.text || '').trim();
}

async function remote(buf, audio, lang) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: audio.mime || 'audio/ogg' }), 'voice.ogg');
  fd.append('model', process.env.STT_MODEL || 'whisper-1');
  fd.append('language', lang); // en / hi / kn
  const r = await fetch(process.env.STT_URL, { method: 'POST', headers: process.env.STT_KEY ? { Authorization: `Bearer ${process.env.STT_KEY}` } : {}, body: fd });
  if (!r.ok) throw new Error(`STT ${r.status}`);
  return String((await r.json()).text || '').trim();
}

async function transcribe(audio, lang) {
  if (!available()) return null;
  const buf = await audio.get();
  return process.env.STT_URL ? remote(buf, audio, lang) : local(buf, lang);
}

// ---------- tidy what was said so the bot's normal steps understand it ----------
const DIGIT_WORDS = {
  zero: 0, oh: 0, o: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  शून्य: 0, एक: 1, दो: 2, तीन: 3, चार: 4, पांच: 5, पाँच: 5, छह: 6, छः: 6, छे: 6, सात: 7, आठ: 8, नौ: 9,
  ಸೊನ್ನೆ: 0, ಒಂದು: 1, ಎರಡು: 2, ಮೂರು: 3, ನಾಲ್ಕು: 4, ಐದು: 5, ಆರು: 6, ಏಳು: 7, ಎಂಟು: 8, ಒಂಬತ್ತು: 9,
};
const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  जनवरी: 1, फरवरी: 2, फ़रवरी: 2, मार्च: 3, अप्रैल: 4, मई: 5, जून: 6, जुलाई: 7, अगस्त: 8, सितंबर: 9, सितम्बर: 9, अक्टूबर: 10, अक्तूबर: 10, नवंबर: 11, नवम्बर: 11, दिसंबर: 12, दिसम्बर: 12,
  ಜನವರಿ: 1, ಫೆಬ್ರವರಿ: 2, ಮಾರ್ಚ್: 3, ಏಪ್ರಿಲ್: 4, ಮೇ: 5, ಜೂನ್: 6, ಜುಲೈ: 7, ಆಗಸ್ಟ್: 8, ಸೆಪ್ಟೆಂಬರ್: 9, ಅಕ್ಟೋಬರ್: 10, ನವೆಂಬರ್: 11, ಡಿಸೆಂಬರ್: 12,
};
const LANG_WORDS = { english: 'lang_en', hindi: 'lang_hi', हिंदी: 'lang_hi', हिन्दी: 'lang_hi', kannada: 'lang_kn', कन्नड़: 'lang_kn', ಕನ್ನಡ: 'lang_kn', ಹಿಂದಿ: 'lang_hi', ಇಂಗ್ಲಿಷ್: 'lang_en', अंग्रेज़ी: 'lang_en', अंग्रेजी: 'lang_en' };

const asciiDigits = (s) => s.replace(/[०-९]/g, (c) => String(c.charCodeAt(0) - 0x966)).replace(/[೦-೯]/g, (c) => String(c.charCodeAt(0) - 0xCE6));
const words = (s) => s.toLowerCase().replace(/[.,!?।]/g, ' ').split(/\s+/).filter(Boolean);

// "nine eight seven..." / "9 8 7..." / "98765 43210" -> "9876543210"; returns '' if it is not a number
function spokenNumber(s) {
  const out = [];
  for (const w of words(asciiDigits(s))) {
    if (/^\d+$/.test(w)) out.push(w); else if (w in DIGIT_WORDS) out.push(String(DIGIT_WORDS[w])); else if (w === 'double' || w === 'triple') out.push(w); else return '';
  }
  // "double five" / "triple nine"
  const r = []; for (let i = 0; i < out.length; i++) { if (out[i] === 'double' || out[i] === 'triple') { const n = out[++i]; if (n === undefined) return ''; r.push(n.repeat(out[i - 1] === 'double' ? 2 : 3)); } else r.push(out[i]); }
  return r.join('');
}

// "15 March 1990" / "March 5th, 1988" / "15 मार्च 1990" / "1990-03-15" / "15 3 1990" -> "15-3-1990" (the form the bot already reads)
function spokenDate(s) {
  const t = asciiDigits(s.toLowerCase()).replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/[.,]/g, ' ').replace(/\b(of|the)\b/g, ' ').replace(/\s+/g, ' ').trim();
  let m = t.match(/^(\d{4})[-/ ](\d{1,2})[-/ ](\d{1,2})$/); if (m) return `${+m[3]}-${+m[2]}-${m[1]}`;
  m = t.match(/^(\d{1,2})[-/ ](\d{1,2})[-/ ](\d{4})$/); if (m) return `${+m[1]}-${+m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2}) (\S+) (\d{4})$/); if (m && MONTHS[m[2]]) return `${+m[1]}-${MONTHS[m[2]]}-${m[3]}`;
  m = t.match(/^(\S+) (\d{1,2}) (\d{4})$/); if (m && MONTHS[m[1]]) return `${+m[2]}-${MONTHS[m[1]]}-${m[3]}`;
  const n = spokenNumber(s); if (/^\d{8}$/.test(n)) return `${+n.slice(0, 2)}-${+n.slice(2, 4)}-${n.slice(4)}`;
  return s;
}

// state = where the bot is in the chat (lang, phone, name, dob, allergy, consent, ready, ...)
function clean(said, state = '') {
  let t = String(said || '').trim().replace(/^["“”']+|["“”']+$/g, '');
  if (state === 'dob') return spokenDate(t);
  if (state === 'phone') return spokenNumber(t) || t;
  if (state === 'lang') { const w = words(t).find((x) => LANG_WORDS[x]); if (w) return LANG_WORDS[w]; }
  t = t.replace(/[.!?।,\s]+$/, '');
  if (state !== 'name' && state !== 'allergy') { const n = spokenNumber(t); if (n && n.length <= 2) return n; }
  return t;
}

module.exports = { available, transcribe, clean, toPcm, spokenNumber, spokenDate };

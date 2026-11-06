// WhatsApp voice notes: checks that a person can register and use the bot by voice alone.  npm run test:voice
// A tiny fake transcription server plays the part of the speech-to-text service (so no model download is needed here).
const { spawn, execFileSync } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 5100 + Math.floor(Math.random() * 300); const STT = PORT + 400;
const DB = path.join(os.tmpdir(), `ayush-voice-${process.pid}.db`);
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0; let fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${extra}`); } };
const voice = require('../whatsapp/voice');
const j = async (p, o = {}) => { const r = await fetch(BASE + p, { ...o, headers: o.json ? { 'Content-Type': 'application/json' } : {}, body: o.json ? JSON.stringify(o.json) : o.body }); let b = null; try { b = await r.json(); } catch (e) { /* empty */ } return b; };
const flat = (a) => a.map((x) => x.text + (x.options ? ` [${x.options.join(' | ')}]` : '')).join('\n');

(async () => {
  console.log('Tidying what was said');
  ok(voice.clean('Yes.', 'consent') === 'Yes', 'trailing full stop removed ("Yes.")');
  ok(voice.clean('Ananya Rao.', 'name') === 'Ananya Rao', 'name keeps its words');
  ok(voice.clean('15 March 1990.', 'dob') === '15-3-1990', 'spoken date "15 March 1990"');
  ok(voice.clean('March 5th, 1988', 'dob') === '5-3-1988', 'spoken date "March 5th, 1988"');
  ok(voice.clean('15 मार्च 1990', 'dob') === '15-3-1990', 'Hindi month');
  ok(voice.clean('15 ಮಾರ್ಚ್ 1990', 'dob') === '15-3-1990', 'Kannada month');
  ok(voice.clean('Two.', 'ready') === '2', 'menu choice "Two" -> 2');
  ok(voice.clean('nine eight seven six five four three two one zero', 'phone') === '9876543210', 'number said word by word');
  ok(voice.clean('Kannada', 'lang') === 'lang_kn', 'language chosen by voice');

  console.log('Audio decoding');
  const ogg = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libopus', '-f', 'ogg', 'pipe:1'], { maxBuffer: 1e7 });
  const pcm = await voice.toPcm(ogg);
  ok(pcm.length > 15000 && pcm.length < 17500, 'an ogg/opus voice note becomes 1 s of 16 kHz samples', String(pcm.length));

  console.log('Register by voice notes (fake speech service)');
  const said = []; // what the fake service will "hear", in order
  const stt = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ text: said.shift() || '' })); }); }).listen(STT);
  const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT, DB_FILE: DB, WHATSAPP_MODE: 'mock', STT_URL: `http://127.0.0.1:${STT}/v1/audio/transcriptions`, AYUSH_SECRET: 'voice-test-secret' }, cwd: path.join(__dirname, '..') });
  srv.stderr.on('data', (d) => process.stderr.write(d));
  for (let i = 0; i < 50; i++) { try { await fetch(`${BASE}/health`); break; } catch (e) { await new Promise((r) => setTimeout(r, 200)); } }
  const P = '919876500022';
  const note = async (text) => { said.push(text); return flat(await j('/whatsapp-mock', { method: 'POST', json: { from: P, text: '', audio: { mime: 'audio/ogg', base64: ogg.toString('base64') } } })); };
  const typed = async (text) => flat(await j('/whatsapp-mock', { method: 'POST', json: { from: P, text } }));
  try {
    let out = await typed('Hi');
    ok(/lang_en/.test(out), 'bot asks for a language');
    out = await note('English.'); ok(/🎤/.test(out) && /\[yes|yes =/i.test(out) || /register|AYUSH/i.test(out), 'voice picks the language, bot continues', out.slice(0, 120));
    out = await note('Yes.'); ok(/name/i.test(out), 'voice "Yes" starts registration, bot asks the name', out.slice(0, 160));
    out = await note('Ananya Rao.'); ok(/birth/i.test(out), 'voice name is taken, bot asks the date of birth', out.slice(0, 160));
    out = await note('15 March 1990.'); ok(/allerg/i.test(out), 'voice date of birth is accepted', out.slice(0, 160));
    out = await note('None.'); ok(/consent|agree/i.test(out), 'voice "None" for allergies, bot asks consent', out.slice(0, 160));
    out = await note('Yes.'); ok(/91-\d{4}-\d{4}-\d{4}/.test(out), 'voice "Yes" completes registration', out.slice(0, 160));
    said.push(''); out = await note('');
    ok(/could not understand|समझ नहीं|ಅರ್ಥವಾಗಲಿಲ್ಲ/i.test(out), 'an unclear voice note gets a friendly retry message', out.slice(0, 120));
  } catch (e) { fail++; console.log('  ✗ voice test crashed', e.message); }
  srv.kill(); stt.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

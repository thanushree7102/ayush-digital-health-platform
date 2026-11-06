// Voice in / voice out, in English, Hindi and Kannada. Uses the browser's own speech engine
// (Chrome / Edge; needs localhost or HTTPS). Nothing is sent to our server.
import { localeOf, tr } from '../i18n';

const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
export const speechInSupported = !!SR;
export const speechOutSupported = typeof window !== 'undefined' && !!window.speechSynthesis;

const ERR = {
  'not-allowed': 'Microphone is blocked. Allow it from the lock icon in the address bar.',
  'service-not-allowed': 'Microphone is blocked. Allow it from the address bar.',
  'no-speech': 'Did not hear anything. Tap the mic and try again.',
  'audio-capture': 'No microphone found.',
  network: 'Voice typing needs an internet connection.',
  aborted: 'Stopped.',
};

let active = null;
// Stop and throw away what was heard (e.g. the person left the page).
export const stopListening = () => { if (active) { active.cancelled = true; try { active.abort(); } catch (e) { /* already stopped */ } } active = null; };
// Stop listening NOW but keep what was heard so far (the person tapped the mic again to say "I am done").
export const finishListening = () => { try { active && active.stop(); } catch (e) { /* already stopped */ } };

// Listen until the person has finished speaking (a pause), not just for the first word.
//  - keeps listening through short pauses, so "Bangalore", full names and long numbers are not cut off;
//  - shows the words live through onInterim(text);
//  - resolves with the possible transcripts, best first (several guesses help with numbers and names);
//  - rejects with a message that can be shown to the person.
// opts: silenceMs = how long a pause means "finished" (numbers need longer), firstMs = how long to wait for the first word.
export function listenAlts(lang, { silenceMs = 1800, firstMs = 8000, maxMs = 40000, onInterim } = {}) {
  return new Promise((resolve, reject) => {
    if (!SR) return reject(new Error(tr('Voice typing is not supported in this browser. Use Chrome or Edge, or just type.')));
    stopListening();
    const r = new SR();
    r.lang = localeOf(lang); r.interimResults = true; r.maxAlternatives = 5; r.continuous = true;
    const segs = []; // one entry per phrase the engine has heard: its alternatives, best first
    let timer = null; let done = false; let failed = null;
    const clear = () => { clearTimeout(timer); timer = null; };
    const arm = (ms) => { clear(); timer = setTimeout(() => { try { r.stop(); } catch (e) { /* ended */ } }, ms); };
    const finish = () => {
      if (done) return; done = true; clear();
      if (active === r) active = null;
      if (r.cancelled) return reject(new Error(tr(ERR.aborted)));
      const have = segs.filter((x) => x.length);
      if (!have.length) return reject(failed || new Error(tr(ERR['no-speech'])));
      // guess 1 = best words of every phrase joined; guesses 2..5 = the engine's alternative hearings
      const out = [];
      for (let k = 0; k < 5; k++) { const g = have.map((x) => x[k] || x[0]).join(' ').replace(/\s+/g, ' ').trim(); if (g && !out.includes(g)) out.push(g); }
      resolve(out);
    };
    r.onresult = (e) => {
      for (let i = 0; i < e.results.length; i++) segs[i] = Array.from(e.results[i]).map((a) => a.transcript.trim()).filter(Boolean);
      if (onInterim) onInterim(segs.map((x) => x[0] || '').join(' ').trim());
      arm(silenceMs); // every new word restarts the "has the person stopped?" timer
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      failed = new Error(tr(ERR[e.error] || `Voice error: ${e.error}`));
    };
    r.onend = finish;
    active = r;
    try { r.start(); } catch (e) { done = true; reject(e); return; }
    arm(firstMs); // nothing heard at all
    setTimeout(() => { if (!done) { try { r.stop(); } catch (e) { /* ended */ } } }, maxMs);
  });
}
export const listen = (lang, o) => listenAlts(lang, o).then((a) => a[0]);

// Read text aloud. Resolves true if a voice for the language exists, false if the device has none installed.
export function speak(text, lang) {
  return new Promise((resolve) => {
    if (!speechOutSupported || !text) return resolve(false);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = localeOf(lang);
    const v = speechSynthesis.getVoices().find((x) => x.lang.toLowerCase().startsWith(lang));
    if (v) u.voice = v;
    u.onend = () => resolve(!!v); u.onerror = () => resolve(false);
    setTimeout(() => resolve(!!v), 6000);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}
export const hasVoiceFor = (lang) => speechOutSupported && speechSynthesis.getVoices().some((x) => x.lang.toLowerCase().startsWith(lang));

// ---- turn what was said into what the field needs ----
const WORDS = {
  zero: 0, oh: 0, o: 0, one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6, seven: 7, eight: 8, ate: 8, nine: 9,
  शून्य: 0, ज़ीरो: 0, जीरो: 0, एक: 1, दो: 2, तीन: 3, चार: 4, पांच: 5, पाँच: 5, छह: 6, छः: 6, छे: 6, सात: 7, आठ: 8, नौ: 9,
  ಸೊನ್ನೆ: 0, ಒಂದು: 1, ಎರಡು: 2, ಮೂರು: 3, ನಾಲ್ಕು: 4, ಐದು: 5, ಆರು: 6, ಏಳು: 7, ಎಂಟು: 8, ಒಂಬತ್ತು: 9,
};
const NATIVE_DIGITS = /[\u0966-\u096F\u0CE6-\u0CEF]/g; // Devanagari and Kannada digits
export function digitsFrom(said) {
  const s = said.replace(NATIVE_DIGITS, (ch) => { const c = ch.codePointAt(0); return String(c - (c >= 0x0CE6 ? 0x0CE6 : 0x0966)); });
  let out = ''; let mult = 1;
  for (const w of s.toLowerCase().replace(/(\d)/g, ' $1 ').split(/[\s,.\-]+/).filter(Boolean)) {
    if (['double', 'डबल', 'ಡಬಲ್'].includes(w)) { mult = 2; continue; }
    if (['triple', 'ट्रिपल', 'ಟ್ರಿಪಲ್'].includes(w)) { mult = 3; continue; }
    if (/^\d+$/.test(w)) { out += w.length === 1 ? w.repeat(mult) : w; mult = 1; } else if (Object.hasOwn(WORDS, w)) { out += String(WORDS[w]).repeat(mult); mult = 1; }
  }
  return out;
}
export const emailFrom = (s) => s.toLowerCase().replace(/\bat the rate( of)?\b|\bat sign\b|\bat\b|एट द रेट|ಅಟ್ ದಿ ರೇಟ್/g, '@').replace(/\bdot\b|\bpoint\b|\bfull stop\b|डॉट|ಡಾಟ್/g, '.').replace(/\bunderscore\b/g, '_').replace(/\b(dash|hyphen)\b/g, '-').replace(/\s+/g, '').replace(/\.$/, '');
export const SKIP_WORDS = /^(skip|next|छोड़ो|छोड़ें|आगे|ಬಿಡಿ|ಮುಂದೆ)\.?$/i;
export const STOP_WORDS = /^(stop|finish|done|बस|रुको|ನಿಲ್ಲಿಸಿ|ಸಾಕು)\.?$/i;

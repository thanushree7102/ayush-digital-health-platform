// WhatsApp transports. The bot (bot.js) never talks to WhatsApp directly; it calls channel.text / buttons / list.
//   WHATSAPP_MODE=auto     (default) Meta if WHATSAPP_TOKEN + WHATSAPP_PHONE_ID are set, else Baileys (QR in the terminal) if installed, else mock
//   WHATSAPP_MODE=mock     no WhatsApp at all: POST /whatsapp-mock {from,text}  -> replies come back as JSON
//   WHATSAPP_MODE=baileys  scan a QR once to link your own spare number (unofficial route, can get a number banned)
//   WHATSAPP_MODE=meta     official Meta WhatsApp Cloud API (webhook GET/POST /whatsapp)
// Every incoming message is normalised to: { from, pn, text, image?:{mime,get}, audio?:{mime,get}, unsupported }
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4000;

// one message at a time per chat, so a quick double tap or a photo + text can never race each other
const chain = new Map();
const run = (key, fn) => {
  const p = (chain.get(key) || Promise.resolve()).then(fn, fn);
  chain.set(key, p);
  p.then(() => { if (chain.get(key) === p) chain.delete(key); });
};

module.exports = function drivers(app, handle, onError) {
  const channel = { text: async () => {}, buttons: async () => {}, list: async () => {}, deliver: async () => false }; // deliver(mobile, text) -> true when the text really went out on WhatsApp
  const use = (c) => Object.assign(channel, c);
  const dispatch = (key, msg) => run(key, () => handle(msg).catch((e) => { console.error(e); onError(key, e); }));

  // ---------- Meta WhatsApp Cloud API ----------
  function meta() {
    const TOKEN = process.env.WHATSAPP_TOKEN; const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
    const VERIFY = process.env.WHATSAPP_VERIFY_TOKEN || 'ayush-verify'; const SECRET = process.env.WHATSAPP_APP_SECRET;
    const G = 'https://graph.facebook.com/v21.0';
    const post = (body) => fetch(`${G}/${PHONE_ID}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
    }).then(async (r) => { if (!r.ok) console.error('WhatsApp send failed', r.status, await r.text()); return r.ok; }).catch((e) => { console.error('send failed', e.message); return false; });
    use({
      deliver: (mobile, t) => post({ to: `91${mobile}`, type: 'text', text: { body: t.slice(0, 4000) } }),
      text: (to, t) => post({ to, type: 'text', text: { body: t.slice(0, 4000) } }),
      buttons: (to, t, b) => post({ to, type: 'interactive', interactive: { type: 'button', body: { text: t.slice(0, 1000) }, action: { buttons: b.map(([id, title]) => ({ type: 'reply', reply: { id, title: title.slice(0, 20) } })) } } }),
      list: (to, t, label, rows) => post({ to, type: 'interactive', interactive: { type: 'list', body: { text: t.slice(0, 1000) }, action: { button: label.slice(0, 20), sections: [{ title: '·', rows: rows.slice(0, 10).map(([id, title, desc]) => ({ id, title: title.slice(0, 24), ...(desc ? { description: desc.slice(0, 72) } : {}) })) }] } } }),
    });
    const valid = (req) => {
      if (process.env.WHATSAPP_SKIP_SIGNATURE === '1') return true;
      const sig = req.get('X-Hub-Signature-256') || '';
      const exp = `sha256=${crypto.createHmac('sha256', SECRET || '').update(req.rawBody || '').digest('hex')}`;
      return sig.length === exp.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp));
    };
    app.get('/whatsapp', (req, res) => (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY ? res.send(req.query['hub.challenge']) : res.sendStatus(403)));
    const seen = new Set();
    app.post('/whatsapp', (req, res) => {
      if (!valid(req)) return res.sendStatus(403);
      res.sendStatus(200);
      for (const m of req.body.entry?.[0]?.changes?.[0]?.value?.messages || []) {
        if (seen.has(m.id)) continue;
        seen.add(m.id); if (seen.size > 500) seen.delete(seen.values().next().value);
        const text = m.type === 'text' ? m.text.body : m.type === 'interactive' ? (m.interactive.button_reply?.id || m.interactive.list_reply?.id || '') : '';
        const media = (x) => x && { mime: x.mime_type, get: async () => {
          const info = await (await fetch(`${G}/${x.id}`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
          return Buffer.from(await (await fetch(info.url, { headers: { Authorization: `Bearer ${TOKEN}` } })).arrayBuffer());
        } };
        const image = media(m.type === 'image' ? m.image : m.type === 'document' ? m.document : null);
        const audio = media(m.type === 'audio' ? m.audio : null);
        dispatch(m.from, { from: m.from, pn: m.from, text, image, audio, unsupported: !text && !image && !audio });
      }
    });
    console.log('WhatsApp (Meta Cloud API) ready: GET/POST /whatsapp');
  }

  // ---------- Baileys: link your own number by scanning a QR ----------
  function baileys() {
    let B;
    try { B = require('@whiskeysockets/baileys'); } catch (e) { console.error('Baileys is not installed. Run: npm install @whiskeysockets/baileys pino'); return; }
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } = B;
    const pino = require('pino'); const QR = require('qrcode');
    const AUTH = path.join(process.cwd(), 'data', 'wa_auth');
    let sock; let qrUrl = null; let status = 'starting'; let retry = 0;
    const opts = new Map(); const seen = new Set(); // numbered options: replying "2" maps back to the 2nd option's id
    const raw = async (to, t) => { if (!sock || status !== 'connected') return console.error('WhatsApp not linked yet'); await sock.sendMessage(to, { text: t.slice(0, 4000) }); };
    use({
      // one-time codes: only when the bot is linked AND the number really has WhatsApp
      deliver: async (mobile, t) => {
        if (!sock || status !== 'connected') return false;
        const ask = sock.onWhatsApp(`91${mobile}@s.whatsapp.net`);
        const r = await Promise.race([ask, new Promise((res) => setTimeout(() => res(null), 6000))]);
        const hit = Array.isArray(r) ? r[0] : null;
        if (!hit || !hit.exists) return false;
        await sock.sendMessage(hit.jid, { text: t });
        return true;
      },
      text: async (to, t) => { opts.delete(to); return raw(to, t); },
      buttons: async (to, t, b) => { opts.set(to, b.map((x) => x[0])); return raw(to, `${t}\n\n${b.map((x, i) => `${i + 1}. ${x[1]}`).join('\n')}\n\n↩ 1–${b.length}`); },
      list: async (to, t, label, rows) => { rows = rows.slice(0, 10); opts.set(to, rows.map((x) => x[0])); return raw(to, `${t}\n\n${rows.map((x, i) => `${i + 1}. ${x[1]}${x[2] ? ` – ${x[2]}` : ''}`).join('\n')}\n\n↩ 1–${rows.length}`); },
    });
    const pick = (jid, t) => { const n = /^\d{1,2}$/.test(t) ? +t : 0; const o = opts.get(jid); if (n && o && o[n - 1]) { opts.delete(jid); return o[n - 1]; } return t; };
    const start = async () => {
      const { state, saveCreds } = await useMultiFileAuthState(AUTH); const { version } = await fetchLatestBaileysVersion();
      sock = makeWASocket({ version, logger: pino({ level: 'silent' }), auth: state, browser: ['AYUSH Health Record', 'Chrome', '1.0.0'] });
      sock.ev.on('creds.update', saveCreds);
      sock.ev.on('connection.update', async (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) {
          qrUrl = await QR.toDataURL(qr, { margin: 2, scale: 7 }); status = 'qr_ready';
          // the QR is printed right here in the terminal: WhatsApp > Settings > Linked devices > Link a device
          console.log('\n==================== LINK WHATSAPP ====================');
          console.log(await QR.toString(qr, { type: 'terminal', small: true }));
          console.log('On the phone of the bot number: WhatsApp > Linked devices > Link a device, then scan the QR above.');
          console.log(`(Or open http://localhost:${PORT}/whatsapp-link in this computer's browser.)`);
          console.log('=======================================================\n');
        }
        if (connection === 'open') { status = 'connected'; qrUrl = null; retry = 0; app.locals.waNumber = (sock.user?.id || '').split(':')[0].split('@')[0]; console.log(`WhatsApp linked as +${app.locals.waNumber}`); }
        if (connection === 'close') {
          status = 'disconnected';
          if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) { retry += 1; setTimeout(start, Math.min(3000 * retry, 60000)); }
          else console.log('Logged out. Delete data/wa_auth and restart to scan again.');
        }
      });
      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
          const jid = msg.key.remoteJid;
          if (!msg.message || msg.key.fromMe || !jid || jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) continue;
          if (msg.key.id) { if (seen.has(msg.key.id)) continue; seen.add(msg.key.id); if (seen.size > 1000) seen.delete(seen.values().next().value); }
          const ts = Number(msg.messageTimestamp?.toNumber?.() ?? msg.messageTimestamp) || 0;
          if (ts && Date.now() / 1000 - ts > 600) continue; // old messages replayed after the server was off
          const alt = msg.key.remoteJidAlt || '';
          const pnJid = jid.endsWith('@s.whatsapp.net') ? jid : alt.endsWith('@s.whatsapp.net') ? alt : '';
          let pn = pnJid.split('@')[0].split(':')[0];
          if (!pn && jid.endsWith('@lid')) { try { pn = JSON.parse(fs.readFileSync(path.join(AUTH, `lid-mapping-${jid.split('@')[0].split(':')[0]}_reverse.json`), 'utf8')); } catch (e) { /* number stays unknown: the bot asks for it */ } }
          const b0 = msg.message.ephemeralMessage?.message || msg.message;
          const body = b0.documentWithCaptionMessage?.message || b0.viewOnceMessage?.message || b0;
          const text = (body.conversation || body.extendedTextMessage?.text || body.imageMessage?.caption || body.documentMessage?.caption || '').trim();
          const img = body.imageMessage || body.documentMessage; const aud = body.audioMessage;
          const dl = () => downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
          // pick() runs when this message's turn comes, so numbered options are always the latest ones
          run(jid, () => handle({ from: jid, pn: String(pn || '').replace(/\D/g, ''), text: pick(jid, text), image: img ? { mime: img.mimetype, get: dl } : null, audio: aud ? { mime: aud.mimetype, get: dl } : null, unsupported: !text && !img && !aud }).catch((e) => { console.error(e); onError(jid, e); }));
        }
      });
    };
    app.get('/whatsapp-link', (req, res) => {
      const local = !req.get('x-forwarded-for') && /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.ip);
      if (!local && !(process.env.WA_LINK_KEY && req.query.key === process.env.WA_LINK_KEY)) return res.status(403).send('Only available on the server itself (or with WA_LINK_KEY). Anyone who scans this QR controls the bot number.');
      res.send(`<meta http-equiv="refresh" content="5"><body style="font-family:system-ui;text-align:center"><h2>Link the bot's WhatsApp number</h2><p>Status: <b>${status}</b>${app.locals.waNumber ? ` · +${app.locals.waNumber}` : ''}</p>${qrUrl ? `<img src="${qrUrl}"><p>WhatsApp → Linked devices → Link a device</p>` : ''}`);
    });
    start().catch((e) => console.error('Baileys start failed:', e.message));
    console.log(`WhatsApp (Baileys) starting... a QR code will be printed here in the terminal (also at http://localhost:${PORT}/whatsapp-link).`);
  }

  // ---------- mock: test the whole bot without WhatsApp ----------
  function mock() {
    const out = [];
    use({
      text: async (to, t) => { out.push({ text: t }); },
      buttons: async (to, t, b) => { out.push({ text: t, options: b.map((x) => `${x[0]} = ${x[1]}`) }); },
      list: async (to, t, label, rows) => { out.push({ text: t, options: rows.map((x) => `${x[0]} = ${x[1]}`) }); },
    });
    app.post('/whatsapp-mock', async (req, res) => {
      out.length = 0;
      const { from = '919999900001', text = '', image, audio } = req.body || {};
      const file = (f) => f && { mime: f.mime, get: async () => Buffer.from(f.base64 || '', 'base64') };
      try { await handle({ from, pn: from, text, image: file(image), audio: file(audio), unsupported: false }); } catch (e) { console.error(e); out.push({ text: `ERROR: ${e.message}` }); }
      res.json(out);
    });
    console.log('WhatsApp MOCK mode: POST /whatsapp-mock {"from":"919876543210","text":"Hi"}');
  }

  let mode = (process.env.WHATSAPP_MODE || 'auto').toLowerCase();
  if (mode === 'auto') {
    if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID) mode = 'meta';
    else { try { require.resolve('@whiskeysockets/baileys'); mode = 'baileys'; } catch (e) { mode = 'mock'; } }
  }
  ({ meta, baileys, mock }[mode] || mock)();
  return channel;
};

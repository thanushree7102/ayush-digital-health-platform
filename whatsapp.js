// WhatsApp channel for the AYUSH platform: ONE bot (below) + interchangeable drivers, like a notification gateway:
//   WHATSAPP_MODE=baileys  scan a QR once to link your own number (same idea as your SAD project; unofficial, use a spare number)
//   WHATSAPP_MODE=meta     official Meta WhatsApp Cloud API (production route)
//   WHATSAPP_MODE=mock     no WhatsApp at all: POST /whatsapp-mock for testing
// The bot is only a CLIENT of the platform's REST API (like the website). Registration is the only place it touches identity/patient services.
const crypto=require('crypto'),fs=require('fs'),path=require('path');
module.exports=(app,{open,sessions,idDb,patDb})=>{
const MODE=(process.env.WHATSAPP_MODE||(process.env.WHATSAPP_TOKEN?'meta':'baileys')).toLowerCase(),PORT=process.env.PORT||3000,BASE='http://127.0.0.1:'+PORT;
const SYSTEMS=['ayurveda','yoga','unani','siddha','homoeopathy'],SYSL={ayurveda:'Ayurveda',yoga:'Yoga & Naturopathy',unani:'Unani',siddha:'Siddha',homoeopathy:'Homoeopathy'};
const db=open('chat','CREATE TABLE IF NOT EXISTS chats(phone TEXT PRIMARY KEY,state TEXT,data TEXT);CREATE TABLE IF NOT EXISTS links(key TEXT PRIMARY KEY,phone TEXT)'); // channel service: conversation state only
let ch={};const T=(to,t)=>ch.text(to,t),B=(to,t,b)=>ch.buttons(to,t,b),L=(to,t,l,r)=>ch.list(to,t,l,r);
const chain=new Map(),run=(key,fn)=>{const p=(chain.get(key)||Promise.resolve()).then(fn,fn);chain.set(key,p);p.then(()=>{if(chain.get(key)===p)chain.delete(key)})}; // ONE message at a time per chat, so a quick double tap or a photo + text can never race each other
const WELCOME='Namaste 🌿 Welcome to AYUSH Health Record.\nI keep your Ayurveda, Yoga & Naturopathy, Unani, Siddha and Homoeopathy records in one place and check your medicines for safety.\n\nWould you like to register?';
const CONSENT='Before we finish:\n• Your records are stored securely and shown only to doctors you allow.\n• Photos and text you send are read by an AI service. You always check the result before anything is saved.\n• I will send you a summary after each record you add.\n• You can type "unregister" at any time to delete your account and all your records.';
const summary=x=>{const meds=(x.medicines||[]).slice(0,6).map((m,i)=>`${i+1}. ${m.name}${[m.dose,m.freq,m.duration].filter(Boolean).map(v=>' – '+v).join('')}${Object.keys(m.extra||{}).length?' ('+Object.entries(m.extra).map(([k,v])=>k+': '+v).join(', ')+')':''}`).join('\n')||'(none found)';
  const fd=Object.entries(x.findings||{}).filter(([,v])=>v).map(([k,v])=>`${k}: ${v}`).join(' · ');
  const sm=x._sumAuto?app.locals.makeSummary(x):x.summary,rs=(x.results||[]).slice(0,8).map(r=>`• ${r.test}: ${r.value}${r.range?' (normal '+r.range+')':''}`).join('\n');
  return `I read this (${x._engine||'rules'}):\n\n${sm?'📝 Summary: '+sm+'\n\n':''}System: ${x.system?SYSL[x.system]:'❓ not sure'}\nDoctor: ${x.doctor||'-'}\nDate: ${x.date||'-'}\nDiagnosis/complaint: ${x.diagnosis||x.complaint||'-'}${fd?'\n'+fd:''}\nMedicines:\n${meds}${rs?'\nResults:\n'+rs:''}${x.allergies?'\nAllergies: '+x.allergies:''}${/Tesseract|basic/.test(x._engine||'')?'\n\nℹ Basic reader: please check every line. Handwriting and Hindi need the AI reader switched on.':''}`};
const askConfirm=(to,x)=>x.system?B(to,summary(x)+'\n\nSave this to your record?',[['save','Save'],['edit','Edit here'],['cancel','Cancel']])
  :T(to,summary(x)+'\n\nI am not sure which AYUSH system this is. Please type one: ayurveda / siddha / unani / yoga / homoeopathy');
const EDITROWS=[['f_system','Medical system'],['f_doctor','Doctor'],['f_date','Visit date'],['f_diagnosis','Diagnosis'],['f_findings','System findings','Prakriti, Mizaj, Mukkutram…'],['f_addmed','Add a medicine'],['f_delmed','Remove a medicine'],['f_advice','Diet / lifestyle advice'],['f_allergies','Allergies'],['f_summary','Summary']];
const PROMPT={system:'Type the system: ayurveda / siddha / unani / yoga / homoeopathy',doctor:"Type the doctor's name",date:'Type the visit date like 2026-10-22',diagnosis:'Type the diagnosis',findings:'Type one finding like: Prakriti: Vata-Pitta',addmed:'Type the medicine in your own words, e.g. Ashwagandha churna 5 g twice daily for 15 days with warm water',delmed:'Type the number of the medicine to remove (see the list)',advice:'Type the diet / lifestyle advice',allergies:'Type allergies separated by commas',summary:'Type the summary you want saved for this document'};

// ---- patient menu: everything the website shows, via the same API ----
const MENU_ROWS=[
  ['m_summary','My summary','Overview of your record'],['m_timeline','My timeline','Latest visits, all systems'],['m_meds','My medicines','From every AYUSH system'],['m_allergy','My allergies'],
  ['m_system','View by system','Ayurveda, Yoga, Unani, Siddha, Homoeopathy'],['m_type','Add by typing','Describe a visit or medicine in words'],['m_uploads','My uploads','Photos you added'],['m_access','Who can see my data','Access and recent activity'],['m_grant','Allow a doctor','Give a doctor access'],['m_delete','Unregister','Delete my account and all records']],MENU_IDS=MENU_ROWS.map(r=>r[0]); // the menu numbers 1-10 always map to this order
const menu=(to,name)=>L(to,`Hi ${name||''} 🌿 What would you like to do? You can also send a photo or PDF of a prescription or report. Type "bye" any time to end the chat.`,'Open menu',MENU_ROWS);
const ALIAS={hi:'m_menu',hello:'m_menu',menu:'m_menu',help:'m_menu',summary:'m_summary',timeline:'m_timeline',medicines:'m_meds',medicine:'m_meds',allergies:'m_allergy',allergy:'m_allergy',system:'m_system',uploads:'m_uploads',access:'m_access',type:'m_type',add:'m_type',unregister:'m_delete',delete:'m_delete','delete my data':'m_delete',stop:'m_delete'};
const fmtMed=m=>{const ex=Object.entries(JSON.parse(m.extra||'{}')).map(([k,v])=>`${k}: ${v}`).join(', ');return `• ${m.name}${[m.dose,m.freq,m.duration].filter(Boolean).map(v=>' – '+v).join('')}${ex?'\n   ('+ex+')':''}`};
const fmtVisit=e=>{const v=e.visit;if(!v)return `📅 ${e.event_date} · ${SYSL[e.system]||e.system}\n${e.summary}`;
  const fd=Object.entries(v.findings||{}).filter(([,x])=>x).map(([k,x])=>`${k}: ${x}`).join(' · ');
  return `📅 ${e.event_date} · ${SYSL[e.system]||e.system}\n${v.diagnosis||v.complaint||'Visit'}${v.doctor?' ('+v.doctor+')':''}${v.summary?'\n📝 '+v.summary:''}${fd?'\n'+fd:''}${v.medicines?.length?'\n'+v.medicines.map(fmtMed).join('\n'):''}${v.advice?'\nAdvice: '+v.advice:''}`};
async function browse(id,to,api){const say=async t=>{await T(to,t);return true},rec=async()=>(await api('/me/record')).j;
  if(id==='m_menu'){await menu(to,(await rec()).patient.name);return true}
  if(id==='m_summary'){const r=await rec(),by={};r.timeline.forEach(e=>by[e.system]=(by[e.system]||0)+1);const last=r.timeline[0];
    return say(`🧾 ${r.patient.name}${r.patient.age?', '+r.patient.age:''}\nHealth ID: ${r.patient.abha_id}\nAllergies: ${r.patient.allergies||'none recorded'}\n\nVisits: ${r.timeline.length}${Object.keys(by).length?' ('+Object.entries(by).map(([s,n])=>(SYSL[s]||s)+' '+n).join(', ')+')':''}\nMedicines on record: ${r.medicines.length}\nLast visit: ${last?last.event_date+' · '+(SYSL[last.system]||last.system):'none yet'}\n\nType "menu" for more.`)}
  if(id==='m_timeline'){const r=await rec();return say(r.timeline.slice(0,5).map(fmtVisit).join('\n\n')||'No visits yet. Send a photo of a prescription to add one.')}
  if(id==='m_meds'){const r=await rec();if(!r.medicines.length)return say('No medicines yet. Send a photo of a prescription or medicine.');
    return say(Object.keys(SYSL).filter(s=>r.medicines.some(m=>m.system===s)).map(s=>SYSL[s]+'\n'+r.medicines.filter(m=>m.system===s).slice(0,8).map(fmtMed).join('\n')).join('\n\n'))}
  if(id==='m_allergy'){const r=await rec();return say(r.patient.allergies?'⚠ Allergies on record: '+r.patient.allergies:'No allergies recorded. They are added when a prescription mentions them.')}
  if(id==='m_system'){await L(to,'Which AYUSH system?','Choose system',Object.entries(SYSL).map(([k,v])=>['sys_'+k,v]));return true}
  if(id.startsWith('sys_')){const sys=id.slice(4),r=await rec(),v=r.timeline.filter(e=>e.system===sys).slice(0,4),m=r.medicines.filter(x=>x.system===sys).slice(0,8);
    return say(`${SYSL[sys]||sys}\n\n`+(v.length?v.map(fmtVisit).join('\n\n'):'No visits recorded yet.')+(m.length&&!v.length?'\n\n'+m.map(fmtMed).join('\n'):''))}
  if(id==='m_uploads'){const d=(await api('/documents')).j,pend=d.filter(x=>x.status==='review');
    await say(d.length?'Your uploads:\n'+d.slice(0,10).map(x=>`#${x.id} · ${x.type} · ${x.status==='review'?'waiting for your check':x.status} · ${x.created_at}`).join('\n'):'No uploads yet.');
    if(pend.length)await L(to,'Finish a pending upload here.','Finish upload',pend.slice(0,10).map(x=>['resume_'+x.id,`#${x.id} ${x.type}`,x.created_at]));return true}
  if(id==='m_access'){const cs=(await api('/consents')).j,lg=(await api('/me/access-log')).j,act=cs.filter(c=>c.status==='active');
    await say('🔒 Doctors with access:\n'+(act.length?act.map(c=>`• ${c.grantee} until ${c.valid_till}`).join('\n'):'none')+'\n\nRecent activity:\n'+(lg.slice(0,5).map(l=>`• ${l.ts} ${l.role} ${l.action} (${l.outcome})`).join('\n')||'none'));
    if(act.length)await L(to,'Tap to take back access from a doctor.','Revoke access',act.map(c=>['revoke_'+c.id,'Revoke: '+c.grantee]));return true}
  if(id==='m_grant'){const p=(await api('/practitioners')).j;if(!p.length)return say('No doctors are registered yet.');await L(to,'Choose a doctor to allow for 30 days. You can revoke any time.','Choose doctor',p.map(x=>['grant_'+x.id,x.name,x.system]));return true}
  if(id.startsWith('grant_')){const r=await api('/consents',{method:'POST',json:{grantee_user_id:+id.slice(6),days:30}});return say(r.ok?'✅ Access given for 30 days. Type "access" to see or revoke it.':'Could not give access.')}
  if(id.startsWith('revoke_')){await api(`/consents/${id.slice(7)}/revoke`,{method:'POST'});return say('✅ Access removed. That doctor can no longer see your record.')}
  return false}

// ---- the bot ----
async function handle(m){
  const to=m.from,text=(m.text||'').trim();let low=text.toLowerCase();
  const c=db.prepare('SELECT * FROM chats WHERE phone=?').get(to);let st=c?.state||'new',data=JSON.parse(c?.data||'{}');
  const set=(s,d=data)=>{st=s;data=d;db.prepare('INSERT INTO chats(phone,state,data) VALUES(?,?,?) ON CONFLICT(phone) DO UPDATE SET state=?,data=?').run(to,s,JSON.stringify(d),s,JSON.stringify(d))};
  let phone=db.prepare('SELECT phone FROM links WHERE key=?').get(to)?.phone||(m.pn?m.pn.slice(-10):''); // WhatsApp has verified this number: no OTP
  const EXIT=/^(bye|goodbye|exit|end|quit|end chat)$/.test(low); // end the chat at any step: forget what we were asking, nothing more is saved
  if(!phone){ // some WhatsApp accounts hide the number: ask for it once
    if(EXIT||low==='cancel'){set('new',{});return T(to,'Okay, I stopped. Nothing was stored. Message "Hi" any time to start again.')}
    if(st==='phone'){const d=text.replace(/\D/g,'').slice(-10);if(d.length!==10)return T(to,'Please send your 10-digit mobile number.');db.prepare('INSERT OR REPLACE INTO links(key,phone) VALUES(?,?)').run(to,d);phone=d;set('new',{})}
    else{set('phone',{});return T(to,'Namaste 🌿 WhatsApp did not share your number with me. Please send your 10-digit mobile number. You will also use it to log in on the website.')}}
  const user=idDb.prepare("SELECT * FROM users WHERE phone=? AND role='patient'").get(phone);
  if(EXIT||(low==='cancel'&&['optin','name','age','allergy','consent'].includes(st))){const draft=['confirm','warn','editing'].includes(st);set(user?'ready':'new',{});
    return T(to,user?`Chat ended. Your saved records are safe.${draft?' The unsaved draft stays under "My uploads" so you can finish it later.':''} Message "Hi" or "menu" any time to come back.`:'Okay, I stopped the registration. Nothing was stored. Message "Hi" any time to start again.')}
  if(user&&['ready','new'].includes(st)&&/^\d{1,2}$/.test(low)&&MENU_IDS[+low-1])low=MENU_IDS[+low-1]; // a number from the menu works at any time, even after other replies (the numbered options are not forgotten)
  // ---- scan / "Hi" -> opt-in -> registration (name, age, allergies, consent) ----
  if(!user){
    if(m.image||m.unsupported){const again={optin:()=>B(to,WELCOME,[['yes','Yes, register me'],['no','Not now']]),name:()=>T(to,'What is your full name?'),age:()=>T(to,'How old are you?'),allergy:()=>T(to,'Any allergies to medicines or food? Type them (for example: penicillin, honey) or type NONE.'),consent:()=>B(to,CONSENT,[['yes','I agree'],['no','No thanks']])}[st];
      if(again){await T(to,'Thanks! I can read your document right after you finish registering. First, one quick question:');return again()}} // a photo or voice note must not restart or repeat the registration
    const YES=/^(yes|y|i agree|agree|ok|okay|haan|ha)$/,NO=/^(no|n|no thanks|not now|nahi)$/; // typed answers work as well as tapping / replying with the number
    if(st==='optin'){if(NO.test(low)){set('new',{});return T(to,'No problem. Nothing was stored. Message "Hi" any time.')}
      if(!YES.test(low))return B(to,WELCOME,[['yes','Yes, register me'],['no','Not now']]);set('name',{});return T(to,'Great! What is your full name?')}
    if(st==='name'&&text){set('age',{name:text.slice(0,60)});return T(to,`Thanks ${data.name}. How old are you?`)}
    if(st==='age'){const a=parseInt(text);if(!(a>0&&a<120))return T(to,'Please send your age as a number, e.g. 34');set('allergy',{...data,age:a});return T(to,'Any allergies to medicines or food? Type them (for example: penicillin, honey) or type NONE. I use this to warn you before unsafe medicines.')}
    if(st==='allergy'&&text){if(YES.test(low))return T(to,'Please type the names of the allergies (for example: penicillin, honey), or type NONE if you have none.');
      set('consent',{...data,allergies:['none','no','nil','nothing','nahi'].includes(low)?'':text.slice(0,120)});return B(to,CONSENT,[['yes','I agree'],['no','No thanks']])}
    if(st==='consent'){if(NO.test(low)){set('new',{});return T(to,'No problem. Nothing was stored. Message "Hi" any time.')}
      if(!YES.test(low))return B(to,CONSENT,[['yes','I agree'],['no','No thanks']]);
      const abha='91-'+[4,4,4].map(n=>String(Math.floor(Math.random()*10**n)).padStart(n,'0')).join('-');
      const pid=patDb.prepare('INSERT INTO patients(abha_id,name,age,allergies) VALUES(?,?,?,?)').run(abha,data.name,data.age,data.allergies||'').lastInsertRowid;
      idDb.prepare('INSERT INTO users(phone,name,role,patient_id) VALUES(?,?,?,?)').run(phone,data.name,'patient',pid);const nm=data.name;set('ready',{});
      await T(to,`You are registered ✅\nYour health ID: ${abha}\n\nSend a photo of a prescription or medicine, or describe it in words, and I will send you a summary. The same record is on the website: log in with ${phone}.`);return menu(to,nm)}
    set('optin',{});return B(to,WELCOME,[['yes','Yes, register me'],['no','Not now']])}
  // ---- registered patient: act through the API gateway as this patient ----
  const token=crypto.randomBytes(16).toString('hex');sessions.set(token,user);
  const api=async(p,o={})=>{const r=await fetch(BASE+'/api/v1'+p,{method:o.method||'GET',headers:{Authorization:'Bearer '+token,'X-Channel':'whatsapp',...(o.json?{'Content-Type':'application/json'}:{})},body:o.json?JSON.stringify(o.json):o.body});return {ok:r.ok,status:r.status,j:await r.json().catch(()=>({}))}};
  const wait=async id=>{let d;for(let i=0;i<45;i++){d=(await api('/documents/'+id)).j;if(d.status!=='processing')break;await new Promise(r=>setTimeout(r,2000))}return d};
  const draft=async id=>{const d=await wait(id);
    if(d.status==='processing')return T(to,'I am still reading your document. Type "uploads" in a minute to finish it.');
    const x=d.extracted||{};
    if(!x.system&&!(x.medicines||[]).length&&!(x.results||[]).length&&!x.diagnosis&&!x.complaint&&!(x.summary&&!x._sumAuto)){set('ready',{});
      return T(to,'I could not read anything clear from this'+(x._note?' ('+x._note+')':'')+'.\n\nPlease send a clearer, well-lit photo, or type the details: send "add" and describe the visit or medicines in your own words.')}
    set('confirm',{doc:id,x});return askConfirm(to,x)};
  try{
    if(m.unsupported)return T(to,'I can read photos, PDF reports and typed text. Please send one of those, or type "menu" to see the options.');
    if(m.image){if(!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(m.image.mime||''))return T(to,'Please send a JPG or PNG photo, or a PDF report.');
      await T(to,'📷 Got it. Reading your document… this can take up to a minute.');
      const fd=new FormData();fd.append('type','prescription');fd.append('file',new Blob([Buffer.from(await m.image.get())],{type:m.image.mime}),'whatsapp');
      const up=await api('/documents',{method:'POST',body:fd});if(!up.ok)return T(to,'Could not store that file: '+(up.j.error||up.status));return await draft(up.j.id)}
    if(low.startsWith('resume_')){const d=(await api('/documents/'+(+low.slice(7)))).j;if(!d.extracted)return T(to,'I could not find that upload.');set('confirm',{doc:d.id,x:d.extracted});return askConfirm(to,d.extracted)}
    // ---- unregister: ask once, then delete everything through the API and forget this chat ----
    if(st==='delete'){set('ready',{});
      if(['del_yes','yes','y','delete'].includes(low)){const r=await api('/me',{method:'DELETE'});if(!r.ok)return T(to,'Could not delete your account right now. Please try again.');
        db.prepare('DELETE FROM chats WHERE phone=?').run(to);db.prepare('DELETE FROM links WHERE key=?').run(to);
        return T(to,'Your account and all your records have been deleted. Message "Hi" any time if you want to register again.')}
      return T(to,'Okay, nothing was deleted. Type "menu" to continue.')}
    if(!['typing','editing','confirm','warn'].includes(st)&&(ALIAS[low]==='m_delete'||low==='m_delete')){set('delete',{});
      return B(to,'⚠ Unregister?\nThis will permanently delete your profile, photos, visits, medicines and doctor permissions. It cannot be undone.\n\nDelete everything?',[['del_yes','Yes, delete all'],['del_no','No, keep it']])}
    {const id=ALIAS[low]||low;if(id==='m_type'){set('typing',{});return T(to,'Describe the visit or medicine in your own words, e.g.\n"Triphala churna 5 g at night with warm water for 30 days, Ayurveda, Dr Ravi"')}
      if(await browse(id,to,api)){if(['typing','editing'].includes(st))set('ready',{});return}}
    if(st==='typing'&&text){await T(to,'📝 Reading your description…');const up=await api('/documents/text',{method:'POST',json:{text}});if(!up.ok)return T(to,up.j.error||'Could not read that.');return await draft(up.j.id)}
    if(st==='editing'&&text){const x=data.x,f=data.field;
      if(f==='doctor')x.doctor=text;else if(f==='diagnosis')x.diagnosis=text;else if(f==='advice')x.advice=text;else if(f==='allergies')x.allergies=text;else if(f==='summary'){x.summary=text.slice(0,800);x._sumAuto=false}
      else if(f==='date'){if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return T(to,'Please type the date like 2026-10-22');x.date=text}
      else if(f==='findings'){const [k,...v]=text.split(':');if(!v.length)return T(to,'Type it like: Prakriti: Vata-Pitta');x.findings=x.findings||{};x.findings[k.trim().replace(/^./,s=>s.toUpperCase())]=v.join(':').trim()}
      else if(f==='delmed'){const i=parseInt(text)-1;if(!(x.medicines||[])[i])return T(to,'Type a medicine number from the list.');x.medicines.splice(i,1)}
      else if(f==='addmed'){const up=await api('/documents/text',{method:'POST',json:{text}});if(!up.ok)return T(to,'Could not read that.');x.medicines=[...(x.medicines||[]),...((await wait(up.j.id)).extracted.medicines||[])]}
      set('confirm',{doc:data.doc,x});return askConfirm(to,x)}
    if(st==='confirm'||st==='warn'){const x=data.x;
      if(SYSTEMS.includes(low)){x.system=low;set('confirm',data);return askConfirm(to,x)}
      if(low==='cancel'){set('ready',{});return T(to,'Cancelled. Nothing was saved.')}
      if(low==='edit')return L(to,'What would you like to change?','Choose field',EDITROWS);
      if(low.startsWith('f_')){const f=low.slice(2);if(f==='system')return T(to,PROMPT.system);set('editing',{...data,field:f});return T(to,PROMPT[f]||'Type the new value')}
      if(low==='save'||(st==='warn'&&low==='yes')){if(!x.system)return T(to,'Please type the system first: ayurveda / siddha / unani / yoga / homoeopathy');
        const r=await api(`/documents/${data.doc}/confirm`,{method:'POST',json:{...x,ack:st==='warn'}});
        if(r.status===409){set('warn',data);return B(to,r.j.warnings.map(w=>'⚠ '+w.msg).join('\n'),[['yes','Save anyway'],['cancel','Cancel']])}
        if(!r.ok)return T(to,'Could not save: '+(r.j.error||r.status));
        set('ready',{});await T(to,r.j.summary);return T(to,'Type "menu" to see your records.')}
      return askConfirm(to,x)}
    return T(to,'Sorry, I did not understand that. Type "menu" to see the options (you can then reply with a number), send a photo or PDF of a prescription or report, or type "add" to describe it in your own words.') // never re-send the whole menu for unknown input
  }finally{sessions.delete(token)}}

// website save -> WhatsApp summary, but ONLY for patients who opted in on WhatsApp
app.locals.notify=(pid,text)=>{const u=idDb.prepare('SELECT phone FROM users WHERE patient_id=?').get(pid);if(!u)return;
  const keys=[db.prepare('SELECT key FROM links WHERE phone=?').get(u.phone)?.key,'91'+u.phone,'91'+u.phone+'@s.whatsapp.net'].filter(Boolean);
  const to=keys.find(k=>db.prepare('SELECT 1 FROM chats WHERE phone=?').get(k));if(to)Promise.resolve(T(to,'📄 New record added on the website:\n\n'+text)).catch(e=>console.error('notify failed',e.message))};

// ---- driver: Meta WhatsApp Cloud API ----
function metaDriver(){const TOKEN=process.env.WHATSAPP_TOKEN,PHONE_ID=process.env.WHATSAPP_PHONE_ID,VERIFY=process.env.WHATSAPP_VERIFY_TOKEN||'ayush-verify',SECRET=process.env.WHATSAPP_APP_SECRET,G='https://graph.facebook.com/v21.0';
  const post=body=>fetch(`${G}/${PHONE_ID}/messages`,{method:'POST',headers:{Authorization:'Bearer '+TOKEN,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',...body})}).then(async r=>{if(!r.ok)console.error('WhatsApp send failed',r.status,await r.text())}).catch(e=>console.error('send failed',e.message));
  ch={text:(to,t)=>post({to,type:'text',text:{body:t.slice(0,4000)}}),
    buttons:(to,t,b)=>post({to,type:'interactive',interactive:{type:'button',body:{text:t.slice(0,1000)},action:{buttons:b.map(([id,title])=>({type:'reply',reply:{id,title:title.slice(0,20)}}))}}}),
    list:(to,t,l,rows)=>post({to,type:'interactive',interactive:{type:'list',body:{text:t.slice(0,1000)},action:{button:l.slice(0,20),sections:[{title:'Options',rows:rows.slice(0,10).map(([id,title,desc])=>({id,title:title.slice(0,24),...(desc?{description:desc.slice(0,72)}:{})}))}]}}})};
  const valid=req=>{if(process.env.WHATSAPP_SKIP_SIGNATURE==='1')return true;const sig=req.get('X-Hub-Signature-256')||'',exp='sha256='+crypto.createHmac('sha256',SECRET||'').update(req.rawBody||'').digest('hex');return sig.length===exp.length&&crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(exp))};
  app.get('/whatsapp',(req,res)=>req.query['hub.mode']==='subscribe'&&req.query['hub.verify_token']===VERIFY?res.send(req.query['hub.challenge']):res.sendStatus(403));
  const seen=new Set();app.post('/whatsapp',(req,res)=>{if(!valid(req))return res.sendStatus(403);res.sendStatus(200);
    for(const m of req.body.entry?.[0]?.changes?.[0]?.value?.messages||[]){if(seen.has(m.id))continue;seen.add(m.id);if(seen.size>500)seen.delete(seen.values().next().value);
      const text=m.type==='text'?m.text.body:m.type==='interactive'?(m.interactive.button_reply?.id||m.interactive.list_reply?.id||''):'';
      const med=m.type==='image'?m.image:m.type==='document'?m.document:null,image=med?{mime:med.mime_type,get:async()=>{const meta=await(await fetch(`${G}/${med.id}`,{headers:{Authorization:'Bearer '+TOKEN}})).json();return Buffer.from(await(await fetch(meta.url,{headers:{Authorization:'Bearer '+TOKEN}})).arrayBuffer())}}:null;
      run(m.from,()=>handle({from:m.from,pn:m.from,text,image,unsupported:!text&&!image}).catch(e=>{console.error(e);T(m.from,'Sorry, something went wrong. Please try again.')}))}});
  console.log('WhatsApp (Meta Cloud API) ready: GET/POST /whatsapp')}

// ---- driver: Baileys (scan a QR once to link your own number) ----
function baileysDriver(){let B_;try{B_=require('@whiskeysockets/baileys')}catch{console.error('Baileys is not installed. Run: npm install @whiskeysockets/baileys pino');return}
  const {default:makeWASocket,useMultiFileAuthState,DisconnectReason,fetchLatestBaileysVersion,downloadMediaMessage}=B_,pino=require('pino'),QR=require('qrcode'),AUTH=path.join(process.cwd(),'data','wa_auth');
  let sock,qrUrl=null,status='starting';const opts=new Map(),seen=new Set(); // Baileys cannot send reliable buttons: options become numbered text, numbers map back to ids
  const raw=async(to,t)=>{if(!sock||status!=='connected')return console.error('WhatsApp not linked yet');await sock.sendMessage(to,{text:t.slice(0,4000)})};
  ch={text:async(to,t)=>{opts.delete(to);return raw(to,t)},
    buttons:async(to,t,b)=>{opts.set(to,b.map(x=>x[0]));return raw(to,t+'\n\n'+b.map((x,i)=>`${i+1}. ${x[1]}`).join('\n')+'\n\nReply with the number.')},
    list:async(to,t,l,rows)=>{rows=rows.slice(0,10);opts.set(to,rows.map(x=>x[0]));return raw(to,t+'\n\n'+rows.map((x,i)=>`${i+1}. ${x[1]}${x[2]?' – '+x[2]:''}`).join('\n')+'\n\nReply with the number.')}};
  const pick=(jid,t)=>{const n=/^\d{1,2}$/.test(t)?+t:0,o=opts.get(jid);if(n&&o&&o[n-1]){opts.delete(jid);return o[n-1]}return t};
  const start=async()=>{const {state,saveCreds}=await useMultiFileAuthState(AUTH),{version}=await fetchLatestBaileysVersion();
    sock=makeWASocket({version,logger:pino({level:'silent'}),auth:state,browser:['AYUSH Health Record','Chrome','1.0.0']});sock.ev.on('creds.update',saveCreds);
    sock.ev.on('connection.update',async u=>{const {connection,lastDisconnect,qr}=u;
      if(qr){qrUrl=await QR.toDataURL(qr,{margin:2,scale:7});status='qr_ready';console.log(`Scan the QR at http://localhost:${PORT}/whatsapp-link (WhatsApp > Linked devices)`)}
      if(connection==='open'){status='connected';qrUrl=null;app.locals.waNumber=(sock.user?.id||'').split(':')[0].split('@')[0];console.log('WhatsApp linked as +'+app.locals.waNumber)}
      if(connection==='close'){status='disconnected';if(lastDisconnect?.error?.output?.statusCode!==DisconnectReason.loggedOut)setTimeout(start,3000);else console.log('Logged out. Delete data/wa_auth and restart to scan again.')}});
    sock.ev.on('messages.upsert',async({messages,type})=>{if(type!=='notify')return;for(const msg of messages){
      const jid=msg.key.remoteJid;if(!msg.message||msg.key.fromMe||!jid||jid.endsWith('@g.us')||jid.endsWith('@broadcast')||jid.endsWith('@newsletter'))continue;
      if(msg.key.id){if(seen.has(msg.key.id))continue;seen.add(msg.key.id);if(seen.size>1000)seen.delete(seen.values().next().value)} // WhatsApp can deliver the same message twice (reconnects): answer it once
      const ts=Number(msg.messageTimestamp?.toNumber?.()??msg.messageTimestamp)||0;if(ts&&Date.now()/1000-ts>600)continue; // ignore old messages replayed after the server was off
      const alt=msg.key.remoteJidAlt||'',pnJid=jid.endsWith('@s.whatsapp.net')?jid:alt.endsWith('@s.whatsapp.net')?alt:'';let pn=pnJid.split('@')[0].split(':')[0];
      if(!pn&&jid.endsWith('@lid')){try{pn=JSON.parse(fs.readFileSync(path.join(AUTH,`lid-mapping-${jid.split('@')[0].split(':')[0]}_reverse.json`),'utf8'))}catch{}}
      const b0=msg.message.ephemeralMessage?.message||msg.message,body=b0.documentWithCaptionMessage?.message||b0.viewOnceMessage?.message||b0,text=body.conversation||body.extendedTextMessage?.text||body.imageMessage?.caption||body.documentMessage?.caption||'',img=body.imageMessage||body.documentMessage;
      const pn2=String(pn||'').replace(/\D/g,'');
      run(jid,()=>handle({from:jid,pn:pn2,text:pick(jid,text.trim()),image:img?{mime:img.mimetype,get:()=>downloadMediaMessage(msg,'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage})}:null,unsupported:!text.trim()&&!img}).catch(e=>{console.error(e);T(jid,'Sorry, something went wrong. Please try again.')}))}})}; // pick() runs when this message's turn comes, so numbered options are always the latest ones
  app.get('/whatsapp-link',(req,res)=>{const local=!req.get('x-forwarded-for')&&/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.ip);
    if(!local&&!(process.env.WA_LINK_KEY&&req.query.key===process.env.WA_LINK_KEY))return res.status(403).send('Only available on the server itself (or with WA_LINK_KEY). Anyone who scans this QR controls the bot number.');
    res.send(`<meta http-equiv="refresh" content="5"><body style="font-family:system-ui;text-align:center"><h2>Link the bot's WhatsApp number</h2><p>Status: <b>${status}</b>${app.locals.waNumber?' · +'+app.locals.waNumber:''}</p>${qrUrl?`<img src="${qrUrl}"><p>WhatsApp → Linked devices → Link a device</p>`:''}`)});
  start().catch(e=>console.error('Baileys start failed:',e.message));console.log('WhatsApp (Baileys) starting. Open http://localhost:'+PORT+'/whatsapp-link to scan the QR')}

// ---- driver: mock (testing without WhatsApp) ----
function mockDriver(){const out=[];ch={text:async(to,t)=>{out.push({text:t});console.log('[mock send to '+to+']',t.slice(0,60).replace(/\n/g,' '))},buttons:async(to,t,b)=>{out.push({text:t,options:b.map(x=>x[0]+' = '+x[1])})},list:async(to,t,l,r)=>{out.push({text:t,options:r.map(x=>x[0]+' = '+x[1])})}};
  app.post('/whatsapp-mock',async(req,res)=>{out.length=0;const {from='919999900001',text='',image}=req.body;
    try{await handle({from,pn:from,text,image:image?{mime:image.mime,get:async()=>Buffer.from(image.base64,'base64')}:null})}catch(e){console.error(e);out.push({text:'ERROR: '+e.message})}res.json(out)});console.log('WhatsApp MOCK mode: POST /whatsapp-mock {from,text}')}
({meta:metaDriver,mock:mockDriver}[MODE]||baileysDriver)();};

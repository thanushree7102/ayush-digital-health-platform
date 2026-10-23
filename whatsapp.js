// WhatsApp channel adapter for the META WhatsApp Cloud API.
// It is just another CLIENT of the API gateway: registration touches identity/patient services; everything else uses the same REST API as the website.
const crypto=require('crypto');
module.exports=(app,{open,sessions,idDb,patDb})=>{
const TOKEN=process.env.WHATSAPP_TOKEN,PHONE_ID=process.env.WHATSAPP_PHONE_ID,VERIFY=process.env.WHATSAPP_VERIFY_TOKEN||'ayush-verify',SECRET=process.env.WHATSAPP_APP_SECRET;
const G='https://graph.facebook.com/v21.0',BASE='http://127.0.0.1:'+(process.env.PORT||3000),SYSTEMS=['ayurveda','yoga','unani','siddha','homoeopathy'];
const db=open('chat','CREATE TABLE IF NOT EXISTS chats(phone TEXT PRIMARY KEY,state TEXT,data TEXT)'); // channel service: conversation state only
const post=body=>fetch(`${G}/${PHONE_ID}/messages`,{method:'POST',headers:{Authorization:'Bearer '+TOKEN,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',...body})})
  .then(async r=>{if(!r.ok)console.error('WhatsApp send failed',r.status,await r.text())}).catch(e=>console.error('send failed',e.message));
const send=(to,text)=>post({to,type:'text',text:{body:text.slice(0,4000)}});
const buttons=(to,text,btns)=>post({to,type:'interactive',interactive:{type:'button',body:{text:text.slice(0,1000)},action:{buttons:btns.map(([id,title])=>({type:'reply',reply:{id,title}}))}}});
const valid=req=>{if(process.env.WHATSAPP_SKIP_SIGNATURE==='1')return true; // dev only
  const sig=req.get('X-Hub-Signature-256')||'',exp='sha256='+crypto.createHmac('sha256',SECRET||'').update(req.rawBody||'').digest('hex');
  return sig.length===exp.length&&crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(exp))};
const HELLO='Namaste 🌿 Welcome to AYUSH Health Record. I keep your Ayurveda, Yoga & Naturopathy, Unani, Siddha and Homoeopathy records in one place.\n\nWhat is your name?';
const CONSENT='Before we start:\n• Your records are stored securely and shown only to doctors you allow.\n• Photos you send are read by an AI service. You always check the result before anything is saved.';
const summary=x=>{const meds=(x.medicines||[]).slice(0,6).map((m,i)=>`${i+1}. ${m.name}${[m.dose,m.freq,m.duration].filter(Boolean).map(v=>' – '+v).join('')}${Object.keys(m.extra||{}).length?' ('+Object.entries(m.extra).map(([k,v])=>k+': '+v).join(', ')+')':''}`).join('\n')||'(none found)';
  return `I read this (${x._engine||'OCR'}):\n\nSystem: ${x.system||'❓ not sure'}\nDoctor: ${x.doctor||'-'}\nDate: ${x.date||'-'}\nComplaint/diagnosis: ${x.diagnosis||x.complaint||'-'}\nMedicines:\n${meds}`};
const askConfirm=(to,x)=>x.system?buttons(to,summary(x)+'\n\nSave this to your record?',[['save','Save'],['edit','Correct on website'],['cancel','Cancel']])
  :send(to,summary(x)+'\n\nI am not sure which AYUSH system this is. Please type one: ayurveda / siddha / unani / yoga / homoeopathy');

// ---- patient-facing menu: everything a patient can see on WhatsApp (read through the same gateway API) ----
const SYSL={ayurveda:'Ayurveda',yoga:'Yoga & Naturopathy',unani:'Unani',siddha:'Siddha',homoeopathy:'Homoeopathy'};
const list=(to,text,button,rows)=>post({to,type:'interactive',interactive:{type:'list',body:{text:text.slice(0,1000)},action:{button:button.slice(0,20),sections:[{title:'Options',rows:rows.slice(0,10).map(([id,title,desc])=>({id,title:title.slice(0,24),...(desc?{description:desc.slice(0,72)}:{})}))}]}}});
const menu=(to,name)=>list(to,`Hi ${name||''} 🌿 What would you like to see? You can also send a photo of a prescription or medicine to add it.`,'Open menu',[
  ['m_summary','My summary','Overview of your record'],['m_timeline','My timeline','Latest visits, all systems'],['m_meds','My medicines','From every AYUSH system'],['m_allergy','My allergies'],
  ['m_system','View by system','Ayurveda, Yoga, Unani, Siddha, Homoeopathy'],['m_uploads','My uploads','Photos you added'],['m_access','Who can see my data','Access and recent activity'],['m_grant','Allow a doctor','Give a doctor access']]);
const ALIAS={hi:'m_menu',hello:'m_menu',menu:'m_menu',help:'m_menu',summary:'m_summary',timeline:'m_timeline',medicines:'m_meds',medicine:'m_meds',allergies:'m_allergy',allergy:'m_allergy',system:'m_system',uploads:'m_uploads',access:'m_access'};
const fmtMed=m=>{const ex=Object.entries(JSON.parse(m.extra||'{}')).map(([k,v])=>`${k}: ${v}`).join(', ');return `• ${m.name}${[m.dose,m.freq,m.duration].filter(Boolean).map(v=>' – '+v).join('')}${ex?'\n   ('+ex+')':''}`};
const fmtVisit=e=>{const v=e.visit;if(!v)return `📅 ${e.event_date} · ${SYSL[e.system]||e.system}\n${e.summary}`;
  const fd=Object.entries(v.findings||{}).filter(([,x])=>x).map(([k,x])=>`${k}: ${x}`).join(' · ');
  return `📅 ${e.event_date} · ${SYSL[e.system]||e.system}\n${v.diagnosis||v.complaint||'Visit'}${v.doctor?' ('+v.doctor+')':''}${fd?'\n'+fd:''}${v.medicines?.length?'\n'+v.medicines.map(fmtMed).join('\n'):''}${v.advice?'\nAdvice: '+v.advice:''}`};
async function browse(id,to,api){const say=async t=>{await send(to,t);return true},rec=async()=>(await api('/me/record')).j;
  if(id==='m_menu'){await menu(to,(await rec()).patient.name);return true}
  if(id==='m_summary'){const r=await rec(),by={};r.timeline.forEach(e=>by[e.system]=(by[e.system]||0)+1);const last=r.timeline[0];
    return say(`🧾 ${r.patient.name}${r.patient.age?', '+r.patient.age:''}\nHealth ID: ${r.patient.abha_id}\nAllergies: ${r.patient.allergies||'none recorded'}\n\nVisits: ${r.timeline.length}${Object.keys(by).length?' ('+Object.entries(by).map(([s,n])=>(SYSL[s]||s)+' '+n).join(', ')+')':''}\nMedicines on record: ${r.medicines.length}\nLast visit: ${last?last.event_date+' · '+(SYSL[last.system]||last.system):'none yet'}\n\nType "menu" for more.`)}
  if(id==='m_timeline'){const r=await rec();return say(r.timeline.slice(0,5).map(fmtVisit).join('\n\n')||'No visits yet. Send a photo of a prescription to add one.')}
  if(id==='m_meds'){const r=await rec();if(!r.medicines.length)return say('No medicines yet. Send a photo of a prescription or medicine.');
    return say(Object.keys(SYSL).filter(s=>r.medicines.some(m=>m.system===s)).map(s=>SYSL[s]+'\n'+r.medicines.filter(m=>m.system===s).slice(0,8).map(fmtMed).join('\n')).join('\n\n'))}
  if(id==='m_allergy'){const r=await rec();return say(r.patient.allergies?'⚠ Allergies on record: '+r.patient.allergies:'No allergies recorded. They are added when a prescription mentions them.')}
  if(id==='m_system'){await list(to,'Which AYUSH system?','Choose system',Object.entries(SYSL).map(([k,v])=>['sys_'+k,v]));return true}
  if(id.startsWith('sys_')){const sys=id.slice(4),r=await rec(),v=r.timeline.filter(e=>e.system===sys).slice(0,4),m=r.medicines.filter(x=>x.system===sys).slice(0,8);
    return say(`${SYSL[sys]||sys}\n\n`+(v.length?v.map(fmtVisit).join('\n\n'):'No visits recorded yet.')+(m.length&&!v.length?'\n\n'+m.map(fmtMed).join('\n'):''))}
  if(id==='m_uploads'){const d=(await api('/documents')).j;return say(d.length?'Your uploads:\n'+d.slice(0,10).map(x=>`#${x.id} · ${x.type} · ${x.status==='review'?'waiting for your check':x.status} · ${x.created_at}`).join('\n'):'No uploads yet.')}
  if(id==='m_access'){const cs=(await api('/consents')).j,lg=(await api('/me/access-log')).j,act=cs.filter(c=>c.status==='active');
    await say('🔒 Doctors with access:\n'+(act.length?act.map(c=>`• ${c.grantee} until ${c.valid_till}`).join('\n'):'none')+'\n\nRecent activity:\n'+(lg.slice(0,5).map(l=>`• ${l.ts} ${l.role} ${l.action} (${l.outcome})`).join('\n')||'none'));
    if(act.length)await list(to,'Tap to take back access from a doctor.','Revoke access',act.map(c=>['revoke_'+c.id,'Revoke: '+c.grantee]));return true}
  if(id==='m_grant'){const p=(await api('/practitioners')).j;if(!p.length)return say('No doctors are registered yet.');await list(to,'Choose a doctor to allow for 30 days. You can revoke any time.','Choose doctor',p.map(x=>['grant_'+x.id,x.name,x.system]));return true}
  if(id.startsWith('grant_')){const r=await api('/consents',{method:'POST',json:{grantee_user_id:+id.slice(6),days:30}});return say(r.ok?'✅ Access given for 30 days. Type "access" to see or revoke it.':'Could not give access.')}
  if(id.startsWith('revoke_')){await api(`/consents/${id.slice(7)}/revoke`,{method:'POST'});return say('✅ Access removed. That doctor can no longer see your record.')}
  return false}

// webhook verification (Meta calls this once when you click "Verify and save")
app.get('/whatsapp',(req,res)=>req.query['hub.mode']==='subscribe'&&req.query['hub.verify_token']===VERIFY?res.send(req.query['hub.challenge']):res.sendStatus(403));
const seen=new Set(); // Meta retries deliveries; ignore duplicates
app.post('/whatsapp',(req,res)=>{if(!valid(req))return res.sendStatus(403);res.sendStatus(200);
  for(const m of req.body.entry?.[0]?.changes?.[0]?.value?.messages||[]){if(seen.has(m.id))continue;seen.add(m.id);if(seen.size>500)seen.delete(seen.values().next().value);
    handle(m).catch(e=>{console.error(e);send(m.from,'Sorry, something went wrong. Please try again.')})}});

async function handle(m){
  const to=m.from,phone=to.slice(-10); // WhatsApp has already verified this number, so no OTP
  const text=(m.type==='text'?m.text.body:m.type==='interactive'?(m.interactive.button_reply?.id||m.interactive.list_reply?.id||''):'').trim(),low=text.toLowerCase();
  const c=db.prepare('SELECT * FROM chats WHERE phone=?').get(phone);let st=c?.state||'new',data=JSON.parse(c?.data||'{}');
  const set=(s,d=data)=>{st=s;data=d;db.prepare('INSERT INTO chats(phone,state,data) VALUES(?,?,?) ON CONFLICT(phone) DO UPDATE SET state=?,data=?').run(phone,s,JSON.stringify(d),s,JSON.stringify(d))};
  const user=idDb.prepare("SELECT * FROM users WHERE phone=? AND role='patient'").get(phone);
  // ---- registration ----
  if(!user){
    if(st==='name'&&text){set('age',{name:text.slice(0,60)});return send(to,`Thanks ${data.name}. How old are you?`)}
    if(st==='age'){const a=parseInt(text);if(!(a>0&&a<120))return send(to,'Please send your age as a number, e.g. 34');set('consent',{...data,age:a});return buttons(to,CONSENT,[['yes','I agree'],['no','No thanks']])}
    if(st==='consent'){if(low==='no'){set('new',{});return send(to,'No problem. Nothing was stored. Message me again any time.')}
      if(low!=='yes')return buttons(to,CONSENT,[['yes','I agree'],['no','No thanks']]);
      const abha='91-'+[4,4,4].map(n=>String(Math.floor(Math.random()*10**n)).padStart(n,'0')).join('-');
      const pid=patDb.prepare('INSERT INTO patients(abha_id,name,age) VALUES(?,?,?)').run(abha,data.name,data.age).lastInsertRowid;
      idDb.prepare('INSERT INTO users(phone,name,role,patient_id) VALUES(?,?,?,?)').run(phone,data.name,'patient',pid);const nm=data.name;set('ready',{});
      await send(to,`You are registered ✅\nYour health ID: ${abha}\n\nSend me a photo of a prescription or medicine to add it to your record.`);return menu(to,nm)}
    set('name',{});return send(to,HELLO)}
  // ---- registered: act through the API gateway as this patient ----
  const token=crypto.randomBytes(16).toString('hex');sessions.set(token,user);
  const api=async(p,o={})=>{const r=await fetch(BASE+'/api/v1'+p,{method:o.method||'GET',headers:{Authorization:'Bearer '+token,...(o.json?{'Content-Type':'application/json'}:{})},body:o.json?JSON.stringify(o.json):o.body});return {ok:r.ok,status:r.status,j:await r.json().catch(()=>({}))}};
  try{
    if(m.type==='image'){const mime=m.image.mime_type;
      if(!/^image\/(jpeg|png|webp)$/.test(mime))return send(to,'Please send a JPG or PNG photo.');
      await send(to,'📷 Got it. Reading your document… this can take up to a minute.');
      const meta=await(await fetch(`${G}/${m.image.id}`,{headers:{Authorization:'Bearer '+TOKEN}})).json();
      const buf=Buffer.from(await(await fetch(meta.url,{headers:{Authorization:'Bearer '+TOKEN}})).arrayBuffer());
      const fd=new FormData();fd.append('type','prescription');fd.append('file',new Blob([buf],{type:mime}),'whatsapp');
      const up=await api('/documents',{method:'POST',body:fd});if(!up.ok)return send(to,'Could not store that file: '+(up.j.error||up.status));
      let d;for(let i=0;i<45;i++){d=(await api('/documents/'+up.j.id)).j;if(d.status!=='processing')break;await new Promise(r=>setTimeout(r,2000))}
      set('confirm',{doc:up.j.id,x:d.extracted});return askConfirm(to,d.extracted)}
    {const id=ALIAS[low]||low;if(await browse(id,to,api))return}
    if(st==='confirm'||st==='warn'){const x=data.x;
      if(SYSTEMS.includes(low)){x.system=low;set('confirm',data);return askConfirm(to,x)}
      if(low==='cancel'){set('ready',{});return send(to,'Cancelled. Nothing was saved.')}
      if(low==='edit')return send(to,`Open ${process.env.PUBLIC_URL||'the website'} and log in with your mobile number. Your upload is under "My uploads" → Finish review.`);
      if(low==='save'||(st==='warn'&&low==='yes')){if(!x.system)return send(to,'Please type the system first: ayurveda / siddha / unani / yoga / homoeopathy');
        const r=await api(`/documents/${data.doc}/confirm`,{method:'POST',json:{...x,ack:st==='warn'}});
        if(r.status===409){set('warn',data);return buttons(to,r.j.warnings.map(w=>'⚠ '+w.msg).join('\n'),[['yes','Save anyway'],['cancel','Cancel']])}
        if(!r.ok)return send(to,'Could not save: '+(r.j.error||r.status));
        set('ready',{});return send(to,'✅ Saved to:\n'+r.j.saved_to.map(s=>'• '+s).join('\n')+(r.j.warnings.length?'\n\n'+r.j.warnings.map(w=>'⚠ '+w.msg).join('\n'):''))}
      return askConfirm(to,x)}
    return menu(to,user.name)
  }finally{sessions.delete(token)}}
console.log('WhatsApp (Meta Cloud API) adapter ready: GET/POST /whatsapp');};

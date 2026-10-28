// AYUSH Digital Health Platform v2 - API gateway + services (each owns ONE sqlite file) + event bus + OCR/NLP worker.
try{require('dotenv').config()}catch{} // optional .env file (never commit it)
const express=require('express'),multer=require('multer'),Database=require('better-sqlite3'),fs=require('fs'),path=require('path'),crypto=require('crypto'),EventEmitter=require('events');
fs.mkdirSync('data/uploads',{recursive:true});
const open=(n,ddl)=>{const d=new Database('data/'+n+'.db');d.exec(ddl);return d};
const SYS=['ayurveda','yoga','unani','siddha','homoeopathy'], bus=new EventEmitter();
// ---- service databases (database per service: no service opens another's file) ----
const idDb=open('identity',`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,phone TEXT UNIQUE,name TEXT,role TEXT,system TEXT,patient_id INTEGER)`);
const patDb=open('patient',`CREATE TABLE IF NOT EXISTS patients(id INTEGER PRIMARY KEY,abha_id TEXT,name TEXT,age INTEGER,allergies TEXT DEFAULT '')`);
const docDb=open('document',`CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY,patient_id INTEGER,type TEXT,file TEXT,mime TEXT,status TEXT,ocr_text TEXT,extracted TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
const encDb=open('encounter',`CREATE TABLE IF NOT EXISTS encounters(id INTEGER PRIMARY KEY,patient_id INTEGER,system TEXT,doctor TEXT,visit_date TEXT,complaint TEXT,doc_id INTEGER)`);
const medDb=open('medication',`CREATE TABLE IF NOT EXISTS prescriptions(id INTEGER PRIMARY KEY,patient_id INTEGER,encounter_id INTEGER,system TEXT,name TEXT,dose TEXT,freq TEXT,duration TEXT,safety TEXT,extra TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
try{medDb.exec('ALTER TABLE prescriptions ADD COLUMN extra TEXT')}catch{} // upgrade older data/ folders
try{docDb.exec('ALTER TABLE documents ADD COLUMN summary TEXT')}catch{}
const conDb=open('consent',`CREATE TABLE IF NOT EXISTS consents(id INTEGER PRIMARY KEY,patient_id INTEGER,grantee_user_id INTEGER,valid_till TEXT,status TEXT DEFAULT 'active')`);
const audDb=open('audit',`CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,ts TEXT DEFAULT CURRENT_TIMESTAMP,user_id INTEGER,role TEXT,action TEXT,resource TEXT,outcome TEXT,cid TEXT);
 CREATE TRIGGER IF NOT EXISTS a_u BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'append-only'); END; CREATE TRIGGER IF NOT EXISTS a_d BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'append-only'); END;`);
const tlDb=open('timeline',`CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,patient_id INTEGER,system TEXT,type TEXT,summary TEXT,event_date TEXT,doc_id INTEGER,enc_id INTEGER)`); // index/projection built from events: holds only a reference (enc_id), not the clinical data
try{tlDb.exec('ALTER TABLE events ADD COLUMN enc_id INTEGER')}catch{}
const DOM=`CREATE TABLE IF NOT EXISTS case_record(id INTEGER PRIMARY KEY,patient_id INTEGER,encounter_id INTEGER,diagnosis TEXT,findings TEXT,advice TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`;
const dom=Object.fromEntries(SYS.map(s=>[s,open(s,DOM)])); // findings JSON differs per system (Prakriti / Mizaj / Mukkutram / Miasm / Lifestyle)
if(!idDb.prepare('SELECT 1 FROM users').get())idDb.exec(`INSERT INTO users(phone,name,role,system) VALUES('9000000001','Dr. Ravi (Ayurveda)','practitioner','ayurveda'),('9000000002','Dr. Meena (Siddha)','practitioner','siddha')`);

// ---- API GATEWAY: correlation id, rate limit, sessions, roles ----
const app=express(),sessions=new Map(),hits=new Map();app.use(express.json({limit:'15mb',verify:(req,res,buf)=>{req.rawBody=buf}})); // rawBody is needed to verify Meta's webhook signature
app.use(express.static('public'));
app.use('/api',(req,res,next)=>{req.cid=crypto.randomBytes(4).toString('hex');res.set('X-Correlation-ID',req.cid);
  const n=Date.now(),h=(hits.get(req.ip)||[]).filter(t=>n-t<6e4);h.push(n);hits.set(req.ip,h);h.length>200?res.status(429).json({error:'rate_limited'}):next();});
const auth=(req,res,next)=>{const u=sessions.get((req.get('Authorization')||'').replace('Bearer ',''));u?(req.user=u,next()):res.status(401).json({error:'unauthenticated'})};
const roles=(...r)=>(req,res,next)=>r.includes(req.user.role)?next():res.status(403).json({error:'forbidden_role'});
const audit=(req,a,r,o)=>audDb.prepare('INSERT INTO audit(user_id,role,action,resource,outcome,cid) VALUES(?,?,?,?,?,?)').run(req.user?.id??null,req.user?.role??null,a,r,o,req.cid);

// ---- login (demo OTP 123456; production = ABHA/OAuth2 + OTP via Notification service) ----
app.post('/api/v1/auth/login',(req,res)=>{const {phone,name,age,otp}=req.body;
  if(!/^\d{10}$/.test(phone||''))return res.status(400).json({error:'Enter a 10-digit mobile number'});
  if(otp!=='123456')return res.status(401).json({error:'Wrong OTP (demo OTP is 123456)'});
  let u=idDb.prepare('SELECT * FROM users WHERE phone=?').get(phone);
  if(!u){if(!name)return res.status(404).json({error:'new_user'});
    const abha='91-'+[4,4,4].map(n=>String(Math.floor(Math.random()*10**n)).padStart(n,'0')).join('-');
    const pid=patDb.prepare('INSERT INTO patients(abha_id,name,age) VALUES(?,?,?)').run(abha,name,+age||null).lastInsertRowid;
    u=idDb.prepare('SELECT * FROM users WHERE id=?').get(idDb.prepare('INSERT INTO users(phone,name,role,patient_id) VALUES(?,?,?,?)').run(phone,name,'patient',pid).lastInsertRowid);}
  const t=crypto.randomBytes(16).toString('hex');sessions.set(t,u);
  res.json({token:t,user:u,patient:u.patient_id?patDb.prepare('SELECT * FROM patients WHERE id=?').get(u.patient_id):null});});

// ---- OCR/NLP worker: rule-based extraction (suggestions only until the patient confirms) ----
const KW={ayurveda:/taila|tailam|avipattikar|triphala|ashwagandha|guggulu|trikatu|kashayam|kashaya|churna|vati\b|ghrita|bhasma|prakriti|vikriti|vata|pitta|kapha|panchakarma|arishta|asava|ayurved|vaidya|baidyanath|zandu|dabur|patanjali|आयुर्वेद|चूर्ण/g,siddha:/chooranam|mathirai|kudineer|thailam|parpam|chenduram|vatham|pitham|kabam|varmam|siddha/g,unani:/majun|qurs|sharbat|arq\b|mizaj|hijama|safravi|balghami|saudavi|damvi|unani/g,homoeopathy:/\b\d+\s?(?:c|ch|cm|x)\b|\bq\b|dilution|pulsatilla|nux vomica|arnica|sulphur|belladonna|calcarea|miasm|homoeo|homeo/g,yoga:/asana|pranayama|kriya|meditation|yoga|naturopathy|hydrotherapy|mud therapy/g};
const FIELDS={ayurveda:['Prakriti','Vikriti'],yoga:['Stress','Sleep'],unani:['Mizaj'],siddha:['Mukkutram'],homoeopathy:['Miasm']};
const MED=/(\btab(?:let)?s?\b|\bcap(?:sule)?s?\b|\bsyp\b|syrup|powder|tailam|taila\b|\btsp\b|kashayam|kashaya|churna|chooranam|vati\b|mathirai|ghrita|thailam|parpam|chenduram|majun|qurs|sharbat|arq\b|bhasma|\b\d+\s?(?:c|ch|cm|x)\b|\d+\s?(?:mg|ml|gm)\b)/i;
const DOSE=/\d+(?:\.\d+)?\s?(?:mg|ml|gm|g|c|ch|cm|x|tsp|tbsp|tabs?|tablets?|caps?|capsules?|drops?)\b/i,FREQ=/\b(\d-\d-\d(?:-\d)?|od|bd|bid|tds|tid|qid|hs|twice daily|once daily|thrice daily|three times (?:a day|daily)|two times (?:a day|daily)|twice a day|once a day|at night|at bedtime|before food|after food)\b/i,DUR=/\d+\s*(?:days?|weeks?|wks?|months?|d)\b/i; // 7d, 7 days, 2 weeks
const iso=s=>{const m=(s||'').match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);return m?`${m[3].length==2?'20'+m[3]:m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:''};
// system-specific medicine details: Ayurveda Matra(dose)/Anupana/Kala, Siddha Anupana, Unani Badal, Homoeopathy Potency/Repetition
const MEDF={ayurveda:['Form','Anupana','Kala'],siddha:['Form','Anupana'],unani:['Form','Badal'],homoeopathy:['Potency','Repetition'],yoga:[]};
const FORM=/(powder|kashayam|kashaya|kwath|churna|chooranam|vati|vatika|gutika|mathirai|ghrita|ghritam|thailam|taila|parpam|chenduram|bhasma|arishta|asava|lehyam|leha|majun|qurs|sharbat|arq|jawarish|itrifal|tincture|dilution|globules)/i;
const medExtra=l=>({Form:(l.match(FORM)||[''])[0],Anupana:(l.match(/(?:anupa?nam?a?|along with|with)\s*[:\-]?\s*(warm water|hot water|rose water|honey|milk|ghee|buttermilk|jaggery|water)/i)||[])[1]||'',
  Kala:(l.match(/(before food|after food|empty stomach|at bedtime|after meals|before meals)/i)||[''])[0],Potency:(l.match(/\b(\d+\s?(?:c|ch|cm)|1m|10m|50m|lm\s?\d+|\d+x)\b/i)||[''])[0],
  Badal:(l.match(/(?:badal|substitute)\s*[:\-]?\s*([a-z ]{3,25})/i)||[])[1]||'',Repetition:(l.match(/(?:repeat|rep\.?)\s*[:\-]?\s*([^,\n]{2,30})/i)||[])[1]||''});
// lab report lines like "Haemoglobin 11.2 g/dL (12-16)" -> {test, value, range}  (the basic reader's way of reading lab reports)
const labLines=t=>t.split(/\n/).map(l=>l.match(/^\s*([A-Za-z][A-Za-z0-9 .\-\/]{2,40}?)\s*[:\-]?\s+(\d+(?:\.\d+)?)\s*([A-Za-z%µ\/0-9^.]*)\s*\(?\s*(\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?)\s*\)?\s*$/)).filter(Boolean).map(m=>({test:m[1].trim(),value:m[2]+(m[3]?' '+m[3]:''),range:m[4].replace(/\s+/g,'')})).slice(0,12);
function extract(text){const t=text||'',lc=t.toLowerCase(),pick=r=>(t.match(r)||[])[1]?.trim()||'';
  const score=Object.fromEntries(SYS.map(s=>[s,(lc.match(KW[s])||[]).length]));const best=SYS.reduce((a,b)=>score[b]>score[a]?b:a,'ayurveda');
  const system=score[best]?best:'';const findings={};
  for(const f of FIELDS[system||'ayurveda'])findings[f]=pick(new RegExp(f+'\\s*[:\\-]\\s*([^\\n,;.]+)','i'));
  if(!findings.Prakriti&&(system||'ayurveda')==='ayurveda'){const m=t.match(/\b((?:vata|pitta|kapha)(?:[\s\-\/,]+(?:vata|pitta|kapha))*)\s+pr[ao]k\w*/i);if(m)findings.Prakriti=m[1].replace(/\s+/g,' ')} // "Vata prakriti" (value written before the word)
  const labs=labLines(t),isLab=labs.length>=2,meds=isLab?[]:t.split(/\n|;|\.\s+(?=[A-Z])/).filter(l=>l.length<160&&MED.test(l)).map(l=>{l=l.replace(/[|]+/g,' ').replace(/\s{2,}/g,' ');const dose=(l.match(DOSE)||[''])[0],freq=(l.match(FREQ)||[''])[0],duration=(l.match(DUR)||[''])[0];
    return {name:l.replace(dose,'').replace(freq,'').replace(duration,'').trim().split(/\s{2,}/)[0].split(/\s+(?:for|with|along with|after|before|at|every)\s+/i)[0].replace(/^[\s\d.\-)*]+/,'').replace(/^(?:rx|r\/|℞)[\s:.\-]*/i,'').replace(/(?:\s+[x×])+\s*$/i,'').replace(/[\s,\-:.]+$/,''),dose,freq,duration,extra:Object.fromEntries(Object.entries(medExtra(l)).filter(([,v])=>v))}}).filter(m=>m.name);
  return {system,results:labs,doc_type:isLab?'lab_report':'',doctor:pick(/(dr\.?\s+[a-z]+(?:\s[a-z]{2,})?)/i),date:iso(t),complaint:pick(/(?:c\/o|complaints?|chief complaint)\s*[:\-]?\s*([^\n.;|]+)/i),diagnosis:pick(/(?:diagnosis|dx|noi naadal)\s*[:\-]?\s*([^\n.;|]+)/i),
    advice:pick(/(?:advice|pathya|pathyam|ghiza|diet)\s*[:\-]?\s*([^\n.;|]+)/i),allergies:pick(/allerg(?:y|ic)\s*(?:to|:)?\s*([a-z, ]+)/i),findings,medicines:meds};}
// OCR/NLP service. Engine 1 (best, reads handwriting + Hindi): vision AI when ANTHROPIC_API_KEY is set. Engine 2 (fallback): Tesseract + rules.
// Output is only a DRAFT: the patient reviews it before anything is saved (FR-DOC-05 / FR-AI-05).
const PROMPT=`You read Indian AYUSH prescriptions (Ayurveda, Yoga & Naturopathy, Unani, Siddha, Homoeopathy), including handwriting and Hindi/Devanagari. Return ONLY one JSON object, no other text: {"transcription":"all text you can read","doc_type":"prescription, lab_report, discharge_summary or other","summary":"2-3 plain sentences a patient can understand: what this document is, the main diagnosis or findings, the medicines and the advice; say 'not clearly readable' for anything unclear","results":[{"test":"","value":"","range":""}],"system":"ayurveda|yoga|unani|siddha|homoeopathy, or empty string if this is modern/allopathic medicine","doctor":"","date":"YYYY-MM-DD or empty","complaint":"","diagnosis":"","advice":"","allergies":"","findings":{"Prakriti":"","Vikriti":"","Mizaj":"","Mukkutram":"","Miasm":"","Stress":"","Sleep":""},"medicines":[{"name":"","dose":"","freq":"","duration":"","extra":{"Form":"","Anupana":"","Kala":"","Potency":"","Badal":"","Repetition":""}}]}. Translate Hindi to English. For lab reports fill "results" with up to 12 key test values (empty list otherwise). Use an empty string for anything not written. Never guess or invent.`;
async function visionRead(file,mime,text){const content=text?[{type:'text',text:PROMPT+'\n\nThe patient typed this description instead of sending a photo:\n'+text}]:[{type:mime==='application/pdf'?'document':'image',source:{type:'base64',media_type:mime,data:fs.readFileSync(file).toString('base64')}},{type:'text',text:PROMPT}]; // photos and PDF reports
  const r=await fetch((process.env.ANTHROPIC_BASE_URL||'https://api.anthropic.com')+'/v1/messages',{method:'POST',headers:{'x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','content-type':'application/json'},body:JSON.stringify({model:process.env.ANTHROPIC_MODEL||'claude-sonnet-5-5',max_tokens:3000,messages:[{role:'user',content}]})});
  if(!r.ok)throw new Error('vision API '+r.status);const t=(await r.json()).content.map(c=>c.text||'').join('');return JSON.parse(t.slice(t.indexOf('{'),t.lastIndexOf('}')+1))}
const normalize=v=>{const sys=SYS.includes(v.system)?v.system:'';return {system:sys,summary:String(v.summary||'').slice(0,800),doc_type:v.doc_type||'',results:(v.results||[]).filter(r=>r&&r.test).slice(0,12).map(r=>({test:String(r.test),value:String(r.value||''),range:String(r.range||'')})),doctor:v.doctor||'',date:v.date||'',complaint:v.complaint||'',diagnosis:v.diagnosis||'',advice:v.advice||'',allergies:v.allergies||'',
  findings:Object.fromEntries(Object.entries(v.findings||{}).filter(([k,x])=>x&&(FIELDS[sys]||[]).includes(k))),
  medicines:(v.medicines||[]).filter(m=>m.name).map(m=>({name:m.name,dose:m.dose||'',freq:m.freq||'',duration:m.duration||'',extra:Object.fromEntries(Object.entries(m.extra||{}).filter(([,x])=>x))}))}};
// Photo reader fallback (Tesseract). The English language file ships in ./tessdata so it works OFFLINE; without it, it would be downloaded from the internet.
const TESS=path.join(__dirname,'tessdata'),OCR_MS=+process.env.OCR_TIMEOUT_MS||70000;
async function ocrFile(file){const {createWorker}=require('tesseract.js'),local=fs.existsSync(path.join(TESS,'eng.traineddata'));let w;
  const run=(async()=>{w=await createWorker('eng',1,{...(local?{langPath:TESS,gzip:false,cacheMethod:'none'}:{}),errorHandler:e=>console.error('photo reader:',e?.message||e)});return (await w.recognize(file)).data.text})();run.catch(()=>{});
  try{return await Promise.race([run,new Promise((_,rej)=>setTimeout(()=>rej(new Error('the photo reader took too long (is eng.traineddata missing and the internet blocked?)')),OCR_MS))])}finally{if(w)w.terminate().catch(()=>{})}}
async function readInput({file,mime,text}){let raw=text||'',ex=null,why='';
  if(process.env.ANTHROPIC_API_KEY){try{const v=await visionRead(file,mime,text);raw=v.transcription||raw;ex=normalize(v);ex._engine='AI vision'}catch(err){why=err.message;console.error('AI read failed, using fallback:',err.message)}}
  if(!ex){const pdf=mime==='application/pdf';
    if(file&&!pdf){try{raw=await ocrFile(file)}catch(err){why='Photo reader failed: '+err.message;console.error('OCR failed:',err.message)}}
    else if(pdf)why=why||'PDF reports need the AI reader (set ANTHROPIC_API_KEY). Send a photo of the page, or type the details.';
    ex=extract(raw);ex._engine=file?(pdf?'no reader for PDF':'Tesseract (printed English only)'):'basic rules';ex._note=why||(process.env.ANTHROPIC_API_KEY?'':'ANTHROPIC_API_KEY is not set')}
  if(!ex.summary){ex.summary=makeSummary(ex);ex._sumAuto=true} // plain-language summary: written by the AI, or built from the fields found
  return {raw,ex}}
const finish=(id,{raw,ex})=>docDb.prepare("UPDATE documents SET status='review',ocr_text=?,extracted=? WHERE id=?").run(raw,JSON.stringify(ex),id);
const safeFinish=async(id,job)=>{try{finish(id,await job())}catch(err){console.error('reading failed:',err.message);finish(id,{raw:'',ex:{system:'',doctor:'',date:'',complaint:'',diagnosis:'',advice:'',allergies:'',findings:{},medicines:[],summary:'',_engine:'failed',_note:err.message}})}}; // a failure must never leave the upload stuck on "processing"
bus.on('DocumentUploaded',e=>setImmediate(()=>safeFinish(e.id,()=>readInput(e))));
bus.on('TextSubmitted',e=>setImmediate(()=>safeFinish(e.id,()=>readInput({text:e.text}))));

// ---- DOCUMENT service ----
const up=multer({dest:'data/uploads',limits:{fileSize:10*1024*1024}});
app.post('/api/v1/documents',auth,roles('patient'),up.single('file'),(req,res)=>{const f=req.file,img=f&&/^image\/(jpeg|png|webp)$/.test(f.mimetype),pdf=f&&f.mimetype==='application/pdf';
  if(f&&!img&&f.mimetype!=='application/pdf'){fs.unlinkSync(f.path);return res.status(400).json({error:'Only JPG, PNG or PDF files'})}
  const id=docDb.prepare('INSERT INTO documents(patient_id,type,file,mime,status,extracted) VALUES(?,?,?,?,?,?)').run(req.user.patient_id,req.body.type||'prescription',f?.path||null,f?.mimetype||null,(img||pdf)?'processing':'review','{}').lastInsertRowid;
  audit(req,'UPLOAD_DOCUMENT','document:'+id,'ok');if(img||pdf)bus.emit('DocumentUploaded',{id,file:f.path,mime:f.mimetype});res.status(201).json({id});});
const myDoc=(req)=>docDb.prepare('SELECT * FROM documents WHERE id=? AND patient_id=?').get(+req.params.id,req.user.patient_id);
app.get('/api/v1/documents',auth,roles('patient'),(req,res)=>res.json(docDb.prepare('SELECT id,type,status,created_at FROM documents WHERE patient_id=? ORDER BY id DESC').all(req.user.patient_id)));
app.get('/api/v1/documents/:id',auth,roles('patient'),(req,res)=>{const d=myDoc(req);d?res.json({...d,extracted:JSON.parse(d.extracted),file:!!d.file}):res.status(404).json({error:'not_found'})});
app.get('/api/v1/documents/:id/file',auth,roles('patient'),(req,res)=>{const d=myDoc(req);d?.file?res.type(d.mime).sendFile(path.resolve(d.file)):res.status(404).end()});

// typed description instead of a photo (website textarea or WhatsApp "Add by typing")
app.post('/api/v1/documents/text',auth,roles('patient'),(req,res)=>{const t=String(req.body.text||'').trim().slice(0,3000);if(t.length<5)return res.status(400).json({error:'Please describe the visit or medicine'});
  const id=docDb.prepare('INSERT INTO documents(patient_id,type,status,ocr_text,extracted) VALUES(?,?,?,?,?)').run(req.user.patient_id,'typed','processing',t,'{}').lastInsertRowid;
  audit(req,'SUBMIT_TEXT','document:'+id,'ok');bus.emit('TextSubmitted',{id,text:t});res.status(201).json({id})});
// ---- SAFETY service ----
function safety(p,meds,system){const w=[],al=(p.allergies||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
  for(const m of meds){const n=m.name.toLowerCase();
    if(al.some(a=>n.includes(a)))w.push({med:m.name,level:'high',msg:`${m.name} may contain something you are allergic to (${p.allergies}).`});
    if(/parpam|chenduram|bhasma/.test(n))w.push({med:m.name,level:'medium',msg:`${m.name} is a metal/mineral preparation. Take only the exact dose and duration prescribed.`});
    if(medDb.prepare("SELECT 1 FROM prescriptions WHERE patient_id=? AND lower(name)=? AND date(created_at)>date('now','-30 day')").get(p.id,n))w.push({med:m.name,level:'low',msg:`${m.name} was already recorded in the last 30 days (possible duplicate).`});}
  const other=medDb.prepare("SELECT DISTINCT system FROM prescriptions WHERE patient_id=? AND system!=? AND date(created_at)>date('now','-30 day')").all(p.id,system).map(r=>r.system);
  if(other.length&&meds.length)w.push({med:'',level:'low',msg:`You also took medicines from ${other.join(', ')} recently. Tell each practitioner so they can check combinations.`});
  return w;}

const SYSL={ayurveda:'Ayurveda',yoga:'Yoga & Naturopathy',unani:'Unani',siddha:'Siddha',homoeopathy:'Homoeopathy'};
function makeSummary(x){const L=[],j=a=>a.filter(Boolean).join(', '),kind=['lab_report','discharge_summary'].includes(x.doc_type)?x.doc_type.replace('_',' '):'record';
  const meds=(x.medicines||[]).filter(m=>m.name).map(m=>m.name+(j([m.dose,m.freq,m.duration])?' ('+j([m.dose,m.freq,m.duration])+')':'')),fd=Object.entries(x.findings||{}).filter(([,v])=>v).map(([k,v])=>k+': '+v).join(', ');
  const rs=(x.results||[]).filter(r=>r&&r.test).map(r=>{const v=parseFloat(r.value),g=(r.range||'').match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/),flag=g&&!isNaN(v)?(v<+g[1]?'low':v>+g[2]?'high':''):'',p=[flag,r.range&&'normal '+r.range].filter(Boolean); // low/high flag from the normal range printed on the report
    return `${r.test} ${r.value}${p.length?' ('+p.join('; ')+')':''}`});
  if(!(x.system||x.complaint||x.diagnosis||meds.length||fd||x.advice||rs.length))return '';
  L.push(`${x.system?SYSL[x.system]:'Medical'} ${kind}${x.doctor?' from '+x.doctor:''}${x.date?' dated '+x.date:''}.`);
  if(x.complaint)L.push('Problem: '+x.complaint+'.');if(x.diagnosis)L.push('Diagnosis: '+x.diagnosis+'.');if(fd)L.push(fd+'.');if(rs.length)L.push(`${rs.length} result${rs.length>1?'s':''}: ${rs.join('; ')}.`);
  if(meds.length)L.push('Medicines: '+meds.join('; ')+'.');if(x.advice)L.push('Advice: '+x.advice+'.');return L.join(' ')}
app.locals.makeSummary=makeSummary;
function buildSummary(p,x,meds,warnings,date,sum){ // plain-language summary the patient receives after every saved record
  const fd=Object.entries(x.findings||{}).filter(([,v])=>v).map(([k,v])=>`${k}: ${v}`).join(' · ');
  const m=meds.map(md=>{const ex=Object.entries(md.extra||{}).filter(([k,v])=>(MEDF[x.system]||[]).includes(k)&&v).map(([k,v])=>`${k}: ${v}`).join(', ');
    return `• ${md.name}${[md.dose,md.freq,md.duration].filter(Boolean).map(v=>' – '+v).join('')}${ex?' ('+ex+')':''}`}).join('\n')||'• none';
  const ends=meds.map(md=>{const r=(md.duration||'').match(/(\d+)\s*(day|week|month)/i),d=new Date(date);if(!r||isNaN(d))return 0;d.setDate(d.getDate()+ +r[1]*({day:1,week:7,month:30}[r[2].toLowerCase()]));return d}).filter(Boolean).sort((a,b)=>b-a)[0];
  return [`✅ Saved to your record — ${SYSL[x.system]}`,`Date: ${date}${x.doctor?' · '+x.doctor:''}`,`For: ${x.diagnosis||x.complaint||'-'}`,sum?'Summary: '+sum:'',fd,`Medicines:\n${m}`,ends?`Course ends around: ${ends.toISOString().slice(0,10)}`:'',x.advice?`Advice: ${x.advice}`:'',p.allergies?`Allergies on record: ${p.allergies}`:'',...warnings.map(w=>'⚠ '+w.msg)].filter(Boolean).join('\n')}
// ---- CONFIRM: fan-out into the services (saga; production adds outbox for reliability) ----
app.post('/api/v1/documents/:id/confirm',auth,roles('patient'),(req,res)=>{const d=myDoc(req);if(!d)return res.status(404).json({error:'not_found'});
  const x=req.body,pid=req.user.patient_id;if(!SYS.includes(x.system))return res.status(400).json({error:'Please choose the AYUSH system'});
  const meds=(x.medicines||[]).filter(m=>m.name&&m.name.trim());
  if(!x.complaint&&!x.diagnosis&&!meds.length&&!x.summary)return res.status(400).json({error:'Add at least a complaint, diagnosis, medicine or summary'});
  let p=patDb.prepare('SELECT * FROM patients WHERE id=?').get(pid);
  if(x.allergies){const all=[...new Set([...(p.allergies||'').split(','),...x.allergies.split(',')].map(s=>s.trim()).filter(Boolean))].join(', ');patDb.prepare('UPDATE patients SET allergies=? WHERE id=?').run(all,pid);p.allergies=all}
  const warnings=safety(p,meds,x.system);if(warnings.length&&!x.ack)return res.status(409).json({warnings});
  const date=x.date||new Date().toISOString().slice(0,10),sum=(x._sumAuto||!x.summary)?makeSummary({...x,medicines:meds}):String(x.summary).slice(0,800);
  const enc=encDb.prepare('INSERT INTO encounters(patient_id,system,doctor,visit_date,complaint,doc_id) VALUES(?,?,?,?,?,?)').run(pid,x.system,x.doctor||'',date,x.complaint||'',d.id).lastInsertRowid;
  dom[x.system].prepare('INSERT INTO case_record(patient_id,encounter_id,diagnosis,findings,advice) VALUES(?,?,?,?,?)').run(pid,enc,x.diagnosis||'',JSON.stringify(x.findings||{}),x.advice||'');
  for(const m of meds){const ex=Object.fromEntries((MEDF[x.system]||[]).map(k=>[k,(m.extra?.[k]||'').trim()]).filter(([,v])=>v));
    medDb.prepare('INSERT INTO prescriptions(patient_id,encounter_id,system,name,dose,freq,duration,safety,extra) VALUES(?,?,?,?,?,?,?,?,?)').run(pid,enc,x.system,m.name,m.dose||'',m.freq||'',m.duration||'',warnings.some(w=>w.med===m.name)?'warned':'ok',JSON.stringify(ex));}
  docDb.prepare("UPDATE documents SET status='saved',summary=? WHERE id=?").run(sum,d.id);audit(req,'CONFIRM_RECORD','encounter:'+enc,'warnings:'+warnings.length);
  bus.emit('ConsultationSaved',{pid,system:x.system,doc:d.id,enc,date,summary:sum||[x.diagnosis||x.complaint,x.doctor&&'by '+x.doctor,meds.length&&meds.map(m=>m.name).join(', ')].filter(Boolean).join(' · ')});
  const summary=buildSummary(p,x,meds,warnings,date,sum);if(req.get('X-Channel')!=='whatsapp')app.locals.notify?.(pid,summary); // website saves are also sent to WhatsApp (only if the patient opted in there)
  res.status(201).json({summary,saved_to:['Document service (original + extracted text)','Encounter service (visit)',`${x.system[0].toUpperCase()+x.system.slice(1)} service (own database)`,`Medication service (${meds.length} medicine${meds.length==1?'':'s'})`,'Patient service (allergies)','Longitudinal timeline (via event)'],warnings});});
bus.on('ConsultationSaved',e=>tlDb.prepare('INSERT INTO events(patient_id,system,type,summary,event_date,doc_id,enc_id) VALUES(?,?,?,?,?,?,?)').run(e.pid,e.system,'Visit',e.summary,e.date,e.doc,e.enc)); // Longitudinal record builder

// ---- Longitudinal record + consent ----
// Longitudinal service resolves each timeline reference through the owning services (Encounter, the AYUSH system's DB, Medication)
const visit=e=>{if(!e.enc_id)return e;const enc=encDb.prepare('SELECT doctor,complaint FROM encounters WHERE id=?').get(e.enc_id)||{},
  cr=dom[e.system]?.prepare('SELECT diagnosis,findings,advice FROM case_record WHERE encounter_id=?').get(e.enc_id)||{};
  return {...e,visit:{summary:docDb.prepare('SELECT summary FROM documents WHERE id=?').get(e.doc_id)?.summary||'',doctor:enc.doctor,complaint:enc.complaint,diagnosis:cr.diagnosis,findings:JSON.parse(cr.findings||'{}'),advice:cr.advice,
    medicines:medDb.prepare('SELECT name,dose,freq,duration,extra FROM prescriptions WHERE encounter_id=?').all(e.enc_id)}}};
const record=pid=>({patient:patDb.prepare('SELECT id,abha_id,name,age,allergies FROM patients WHERE id=?').get(pid),
  medicines:medDb.prepare('SELECT system,name,dose,freq,duration,safety,extra,created_at FROM prescriptions WHERE patient_id=? ORDER BY id DESC').all(pid),
  timeline:tlDb.prepare('SELECT system,type,summary,event_date,enc_id,doc_id FROM events WHERE patient_id=? ORDER BY event_date DESC,id DESC').all(pid).map(visit)});
app.get('/api/v1/me/record',auth,roles('patient'),(req,res)=>res.json(record(req.user.patient_id)));
app.get('/api/v1/practitioners',auth,(req,res)=>res.json(idDb.prepare("SELECT id,name,system FROM users WHERE role='practitioner'").all()));
app.get('/api/v1/consents',auth,roles('patient'),(req,res)=>res.json(conDb.prepare('SELECT * FROM consents WHERE patient_id=? ORDER BY id DESC').all(req.user.patient_id).map(c=>({...c,grantee:idDb.prepare('SELECT name FROM users WHERE id=?').get(c.grantee_user_id)?.name}))));
app.post('/api/v1/consents',auth,roles('patient'),(req,res)=>{const till=new Date(Date.now()+(+req.body.days||30)*864e5).toISOString().slice(0,10);
  conDb.prepare('INSERT INTO consents(patient_id,grantee_user_id,valid_till) VALUES(?,?,?)').run(req.user.patient_id,+req.body.grantee_user_id,till);audit(req,'CONSENT_GRANT','user:'+req.body.grantee_user_id,'till '+till);res.status(201).json({ok:true})});
app.post('/api/v1/consents/:id/revoke',auth,roles('patient'),(req,res)=>{conDb.prepare("UPDATE consents SET status='revoked' WHERE id=? AND patient_id=?").run(+req.params.id,req.user.patient_id);audit(req,'CONSENT_REVOKE','consent:'+req.params.id,'ok');res.json({ok:true})});
app.get('/api/v1/me/access-log',auth,roles('patient'),(req,res)=>res.json(audDb.prepare("SELECT ts,role,action,outcome FROM audit WHERE resource=? ORDER BY id DESC LIMIT 50").all('patient:'+req.user.patient_id)));
// ---- UNREGISTER (right to erasure / withdraw consent): the patient deletes their own profile and every record, in every service's own database ----
app.delete('/api/v1/me',auth,roles('patient'),(req,res)=>{const pid=req.user.patient_id,uid=req.user.id;
  for(const d of docDb.prepare('SELECT file FROM documents WHERE patient_id=?').all(pid))if(d.file){try{fs.unlinkSync(d.file)}catch{}} // the uploaded photos
  docDb.prepare('DELETE FROM documents WHERE patient_id=?').run(pid);
  for(const s of SYS)dom[s].prepare('DELETE FROM case_record WHERE patient_id=?').run(pid);
  encDb.prepare('DELETE FROM encounters WHERE patient_id=?').run(pid);medDb.prepare('DELETE FROM prescriptions WHERE patient_id=?').run(pid);
  tlDb.prepare('DELETE FROM events WHERE patient_id=?').run(pid);conDb.prepare('DELETE FROM consents WHERE patient_id=?').run(pid);
  patDb.prepare('DELETE FROM patients WHERE id=?').run(pid);idDb.prepare('DELETE FROM users WHERE id=?').run(uid);
  audit(req,'ACCOUNT_DELETED','patient:'+pid,'ok'); // the audit log is append-only by design, so this one line stays (who/when, no medical data)
  for(const [t,u] of sessions)if(u.id===uid)sessions.delete(t);
  res.json({ok:true})});
app.get('/api/v1/patients/lookup',auth,roles('practitioner'),(req,res)=>{const u=idDb.prepare("SELECT patient_id,name FROM users WHERE phone=? AND role='patient'").get(req.query.phone||'');u?res.json({id:u.patient_id,name:u.name}):res.status(404).json({error:'No patient with that number'})});
app.get('/api/v1/patients/:id/record',auth,roles('practitioner'),(req,res)=>{const pid=+req.params.id,res_='patient:'+pid;
  const ok=conDb.prepare("SELECT 1 FROM consents WHERE patient_id=? AND grantee_user_id=? AND status='active' AND valid_till>=date('now')").get(pid,req.user.id);
  if(!ok&&!req.query.break_glass){audit(req,'READ_RECORD',res_,'denied_no_consent');return res.status(403).json({error:'consent_required'})}
  audit(req,ok?'READ_RECORD':'BREAK_GLASS',res_,ok?'allowed':'reason: '+req.query.break_glass);res.json(record(pid));});
app.get('/api/v1/whatsapp/qr',async(req,res)=>{const num=(process.env.WHATSAPP_NUMBER||app.locals.waNumber||'').replace(/\D/g,'');if(!num)return res.json({enabled:false});
  const link=`https://wa.me/${num}?text=Hi`;res.json({enabled:true,link,number:'+'+num,qr:await require('qrcode').toDataURL(link,{margin:2,scale:7})})}); // scan -> opens the bot chat -> opt-in registration
app.get('/health',(q,r)=>r.json({status:'up',reader:process.env.ANTHROPIC_API_KEY?'AI vision':'Tesseract + rules (basic)',vision_enabled:!!process.env.ANTHROPIC_API_KEY,whatsapp_mode:process.env.WHATSAPP_MODE||(process.env.WHATSAPP_TOKEN?'meta':'off'),node:process.version}));
app.get('/api/v1/nfr',(q,r)=>{const d=open('governance',fs.readFileSync('db/nfr.sql','utf8').replace(/^INSERT OR IGNORE/m,'INSERT OR IGNORE'));r.json(d.prepare('SELECT * FROM nfr').all());d.close()});
if(process.env.WHATSAPP_MODE!=='off')require('./whatsapp')(app,{open,sessions,idDb,patDb}); // WhatsApp channel (optional)
app.listen(process.env.PORT||3000,()=>{console.log('http://localhost:'+(process.env.PORT||3000));
  console.log(process.env.ANTHROPIC_API_KEY?'Document reader: AI vision ON (photos, handwriting, Hindi, PDF reports, summaries)':'!! Document reader: BASIC (no ANTHROPIC_API_KEY in .env). Printed English photos only, summaries are rough, PDFs cannot be read. Add the key to .env for proper summaries.')});

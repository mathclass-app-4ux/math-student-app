const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const ENVADM=[[process.env.ADMIN_USER||'admin',process.env.ADMIN_PASSWORD||'change-me']];for(let n=2;n<=9;n++){const u=process.env['ADMIN'+n+'_USER'],p=process.env['ADMIN'+n+'_PASSWORD'];if(u&&p)ENVADM.push([u,p])}
const seq=(a,b)=>{const x=crypto.createHash('sha256').update(String(a)).digest(),y=crypto.createHash('sha256').update(String(b)).digest();return crypto.timingSafeEqual(x,y)};
const hashPw=(p,salt)=>crypto.scryptSync(String(p),salt,32).toString('hex');
const PORT=process.env.PORT||3000, ADMIN_USER=process.env.ADMIN_USER||'admin', ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||'change-me';
const GEMINI_API_KEY=process.env.GEMINI_API_KEY||'', GEMINI_MODEL=process.env.GEMINI_MODEL||'gemini-3.8-flash';
const SOLVE_PER_DAY=+process.env.SOLVE_PER_DAY||20;
const DATA=path.join(__dirname,'data'),DB=path.join(DATA,'db.json'),UP=path.join(DATA,'uploads');
fs.mkdirSync(UP,{recursive:true});
let db={codes:[],posts:[],questions:[],sessions:{},logs:[],solves:{},settings:{secure:true}};
if(fs.existsSync(DB)) db=Object.assign(db,JSON.parse(fs.readFileSync(DB)));
db.ws=db.ws||{};db.wsOf=db.wsOf||{};
if(db.mg){const ow=(ENVADM[1]?ENVADM[1][0]:ENVADM[0][0]).toLowerCase();if(!db.ws[ow])db.ws[ow]=db.mg;delete db.mg}
const uOf=se=>String((se&&se.user)||ENVADM[0][0]).toLowerCase();
const wsId=u=>db.wsOf[u]||u;
const WS=u=>{const k=wsId(u);return db.ws[k]||(db.ws[k]={groups:[],att:{},pay:{}})};
const allGroups=()=>Object.values(db.ws).flatMap(w=>w.groups);
const SIGN={};
const save=()=>fs.writeFileSync(DB,JSON.stringify(db));
const LINKS={whatsapp:'https://wa.me/201142104969',facebook:[
 {name:'Page 1',url:'https://www.facebook.com/share/1J3ZLst87q/'},
 {name:'Group',url:'https://www.facebook.com/share/g/14wPVxcD8uP/'},
 {name:'Page 2',url:'https://www.facebook.com/share/1JDvGSC1Cd/'}],phone:'01142104969'};
const SOLVER_KEY=process.env.SOLVER_KEY||'mrk-solver-7f3a9c',SOLVER_DAY_ALL=+process.env.SOLVER_DAY_ALL||1800,SOLVER_DAY_DEV=+process.env.SOLVER_DAY_DEV||12,SOLVER_DAY_IP=+process.env.SOLVER_DAY_IP||30;let SL={d:'',all:0,dev:{},ip:{}};
const id=()=>crypto.randomBytes(6).toString('hex');
const json=(r,c,o)=>{r.writeHead(c,{'Content-Type':'application/json','Cache-Control':'no-store'});r.end(JSON.stringify(o))};
const body=q=>new Promise(res=>{let b=[],n=0;q.on('data',d=>{n+=d.length;if(n<12e6)b.push(d)});q.on('end',()=>{try{res(JSON.parse(Buffer.concat(b)))}catch{res({})}})});
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};
const A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',newCode=()=>{let s='';for(let i=0;i<8;i++)s+=A[crypto.randomInt(A.length)];return s};
const saveImg=im=>{const m=/^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(im||'');if(!m)return null;const f=id()+'.'+(m[1]==='jpeg'?'jpg':m[1]);fs.writeFileSync(path.join(UP,f),Buffer.from(m[2],'base64'));return f};
const isApp=q=>(q.headers['user-agent']||'').includes('MathAppAPK');
const day=()=>new Date().toISOString().slice(0,10);
async function solve(text,image,opt){
 opt=opt||{};
 if(!GEMINI_API_KEY) return {error:'ai_not_configured'};
 const m=/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(image||'');
 if(!text&&!m) return {error:'empty'};
 const img=m?[{inline_data:{mime_type:m[1],data:m[2]}}]:[];
 const call=(parts,gc,ms,mdl)=>fetch((process.env.GEMINI_BASE||'https://generativelanguage.googleapis.com')+'/v1beta/models/'+(mdl||GEMINI_MODEL)+':generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':GEMINI_API_KEY},body:JSON.stringify({contents:[{parts}],generationConfig:gc}),signal:AbortSignal.timeout(ms||85000)});
 const MODELS=[GEMINI_MODEL,...(process.env.GEMINI_FALLBACKS||'gemini-3.8-flash,gemini-2.5-flash-lite').split(',').map(x=>x.trim()).filter(x=>x&&x!==GEMINI_MODEL)];
 const run=async(parts,tok,think,ms)=>{const one=async(mdl)=>{try{let r=await call(parts,think?{thinkingConfig:{thinkingLevel:think},maxOutputTokens:tok}:{maxOutputTokens:tok},ms,mdl);if(r.status===400)r=await call(parts,{maxOutputTokens:tok},ms,mdl);const j=await r.json().catch(()=>({}));return {r,j}}catch(e){return {r:{ok:false,status:0},j:{}}}};
  let x,first=null;for(const m of MODELS){x=await one(m);if(x.r.ok)return x;if(!first)first=x;if(![429,503,500,404].includes(x.r.status))break}x=first;
  if(!x.r.ok&&(x.r.status===429||x.r.status===503)){await new Promise(z=>setTimeout(z,3000));x=await one(MODELS[0])}return x};
 const aiErr=(r,j)=>({model:GEMINI_MODEL,error:(r.status===429||r.status===503)?'ai_busy':r.status===0?'ai_timeout':'ai_failed',status:r.status,detail:(j.error&&j.error.message||'').slice(0,200)});
 const textOf=j=>((j.candidates||[])[0]?.content?.parts||[]).map(p=>p.text||'').join('');
 if(opt.detect){
  const {r,j}=await run([{text:'Look at the image. List every separate math problem or question you can see, in the order they appear (top to bottom). Reply with ONLY JSON, no other text, in this shape: {"problems":[{"n":1,"text":"<short transcription of the problem start, max 100 characters, English digits and symbols>"}]}. If there is only one problem, or the image is unreadable, return at most one entry.'},...img],3000,'low',30000);
  if(!r.ok) return aiErr(r,j);
  const t=textOf(j).replace(/```json|```/g,'').trim();let pr=[];try{pr=(JSON.parse(t).problems||[]).slice(0,30).map((x,i)=>({n:+x.n||i+1,text:String(x.text||'').slice(0,140)}))}catch(e){}
  return {problems:pr};
 }
 const parts=[{text:'You are a math teacher for Egyptian students. Solve the problem in the text and/or image. FORMATTING RULES: write math as plain Unicode text only. Never use LaTeX, never use $ or backslash commands, never use markdown. Use real symbols: ∴ (therefore), ∵ (because), ∠ (angle), △ (triangle), ∥ (parallel), ⊥ (perpendicular), π, √, ≤ ≥ ≠ ≈, ×, ÷, ±, °, ∈, ∞, ⇒, ², ³, superscripts/subscripts as Unicode, and write fractions like (a)/(b) or a/b. Reply in exactly this format:\nDIRECT:\n<the short final solution steps; use English digits and math symbols only, no Arabic words>\nEXPLAINED:\n<step by step explanation in simple Egyptian Arabic; keep all numbers, variables and symbols in English>\nIf the image is not a math problem or is unreadable, reply with DIRECT:\nUNREADABLE\nEXPLAINED:\nالصورة مش واضحة'}];
 if(opt.pick&&opt.pick.n) parts.push({text:'The image has several problems. Solve ONLY problem number '+(+opt.pick.n)+(opt.pick.text?' (it starts with: '+String(opt.pick.text).slice(0,140)+')':'')+'. Ignore every other problem in the image.'});
 if(text) parts.push({text:'Problem text: '+text});
 parts.push(...img);
 let {r,j}=await run(parts,8000,'low');
 let fin=(j.candidates||[])[0]?.finishReason;
 if(r.ok&&fin==='MAX_TOKENS'){const x=await run(parts,16000,'low');if(x.r.ok){r=x.r;j=x.j;fin=(j.candidates||[])[0]?.finishReason}}
 if(!r.ok) return aiErr(r,j);
 const t=textOf(j);
 const mm=/DIRECT:\s*([\s\S]*?)\s*EXPLAINED:\s*([\s\S]*)/i.exec(t);
 const out=mm?{direct:mm[1].trim(),explained:mm[2].trim()}:{direct:'',explained:t.trim()};
 if(fin==='MAX_TOKENS') out.truncated=true;
 return out;
}
http.createServer(async(q,r)=>{
 const u=new URL(q.url,'http://x'),p=u.pathname,tok=(q.headers.authorization||'').replace('Bearer ','');
 const sess=db.sessions[tok],isAdmin=sess&&sess.role==='admin',isStudent=sess&&sess.role==='student';
 try{
 if(p.startsWith('/api/')){
  if(p==='/api/solver'){
   const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,X-App-Key,X-Device','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Max-Age':'86400'};
   if(q.method==='OPTIONS'){r.writeHead(204,cors);return r.end()}
   const cj=(c,o)=>{r.writeHead(c,{'Content-Type':'application/json','Cache-Control':'no-store',...cors});r.end(JSON.stringify(o))};
   if(q.method==='GET'&&u.searchParams.get('links')) return cj(200,{links:LINKS});
   if(q.method!=='POST') return cj(405,{error:'method'});
   if(SOLVER_KEY&&q.headers['x-app-key']!==SOLVER_KEY) return cj(403,{error:'bad_app'});
   const dev=String(q.headers['x-device']||'').replace(/[^\w-]/g,'').slice(0,40);
   if(dev.length<8) return cj(403,{error:'bad_app'});
   const ip=String(q.headers['x-forwarded-for']||q.socket.remoteAddress||'').split(',')[0].trim();
   const b=await body(q),det=!!b.detect,d=day();
   if(SL.d!==d){SL={d,all:0,dev:{},ip:{}}}
   const w=det?1:3;
   if(SL.all+w>SOLVER_DAY_ALL) return cj(429,{error:'busy'});
   if((SL.dev[dev]||0)+w>SOLVER_DAY_DEV*3||(SL.ip[ip]||0)+w>SOLVER_DAY_IP*3) return cj(429,{error:'daily_limit'});
   if(b.image&&String(b.image).length>6e6) return cj(413,{error:'too_big'});
   const out=await solve(det?'':String(b.text||'').slice(0,3000),b.image,det?{detect:true}:{pick:b.pick});
   if(!out.error){SL.all+=w;SL.dev[dev]=(SL.dev[dev]||0)+w;SL.ip[ip]=(SL.ip[ip]||0)+w}
   return cj(out.error==='empty'?400:out.error?502:200,out);}
  if(p==='/api/status') return json(r,200,{open:!!db.settings.open,closed:!!db.settings.closed});
  if(p==='/api/signup'&&q.method==='POST'){
   const b=await body(q);
   if(db.settings.closed) return json(r,423,{error:'closed'});
   if(!db.settings.open) return json(r,403,{error:'signup off'});
   const dv=String(b.device||'').slice(0,40);
   if(dv){const prev=db.codes.find(x=>x.single&&x.gdev===dv&&!x.disabled);if(prev){db.codes.length;Object.entries(db.sessions).filter(([k,x])=>x.role==='student'&&x.code===prev.code).forEach(([k])=>delete db.sessions[k]);const t0=id()+id();db.sessions[t0]={role:'student',code:prev.code,device:dv};save();return json(r,200,{token:t0,role:'student',registered:!!prev.student,code:prev.code,again:true});}}
   const ip=String(q.headers['x-forwarded-for']||q.socket.remoteAddress||'').split(',')[0].trim(),hr=Math.floor(Date.now()/3600000);
   SIGN[ip+hr]=(SIGN[ip+hr]||0)+1; if(SIGN[ip+hr]>10) return json(r,429,{error:'too many'});
   const c={code:newCode(),label:'تسجيل مفتوح',maxDevices:0,single:true,gdev:String(b.device||'').slice(0,40),devices:[],disabled:false,created:Date.now()};db.codes.push(c);
   const t=id()+id();db.sessions[t]={role:'student',code:c.code,device:String(b.device||'')};save();return json(r,200,{token:t,role:'student',registered:false,code:c.code});}
  if(p==='/api/logout'&&q.method==='POST'){delete db.sessions[tok];save();return json(r,200,{ok:1});}
  if(p==='/api/login'&&q.method==='POST'){
   const b=await body(q);
   if(b.role==='admin'){ const un=String(b.username||'').trim().toLowerCase();let who=null;
     for(const [u,p] of ENVADM)if(seq(u.toLowerCase(),un)&seq(p,b.password||''))who=u;
     for(const a of (db.admins||[]))if(a.user===un&&seq(a.hash,hashPw(b.password||'',a.salt)))who=a.user;
     if(!who) return json(r,401,{error:'bad credentials'});
     const t=id()+id();db.sessions[t]={role:'admin',user:who};save();return json(r,200,{token:t,role:'admin'});}
   const c=db.codes.find(x=>x.code===String(b.code||'').trim().toUpperCase());
   if(!c||c.disabled) return json(r,401,{error:'invalid code'});
   if(db.settings.closed) return json(r,423,{error:'closed'});
   if(c.single){const act=Object.entries(db.sessions).filter(([k,x])=>x.role==='student'&&x.code===c.code);if(act.some(([k,x])=>!x.device||x.device!==b.device)) return json(r,403,{error:'code already logged in'});act.forEach(([k])=>delete db.sessions[k]);}
   if(c.maxDevices&&!c.devices.includes(b.device)){ if(c.devices.length>=c.maxDevices) return json(r,403,{error:'code already used on another device'}); c.devices.push(b.device);}
   const t=id()+id();db.sessions[t]={role:'student',code:c.code,device:b.device||''};save();return json(r,200,{token:t,role:'student',registered:!!c.student});}
  if(!sess) return json(r,401,{error:'login required'});
  const me=isStudent?db.codes.find(x=>x.code===sess.code):null;
  if(isStudent&&(!me||me.disabled)) return json(r,401,{error:'code disabled'});
  if(isStudent&&db.settings.closed) return json(r,423,{error:'closed'});
  if(p==='/api/me') return json(r,200,{role:sess.role,code:isStudent?me.code:'',registered:isStudent?!!me.student:true,name:me&&me.student?me.student.name:'',phone:me&&me.student?me.student.phone:''});
  if(p==='/api/register'&&isStudent){const b=await body(q);const name=String(b.name||'').trim().slice(0,60),phone=String(b.phone||'').replace(/[^0-9+]/g,'').slice(0,20);
   if(!name||phone.length<8) return json(r,400,{error:'name and phone required'});
   const photo=b.photo?saveImg(b.photo):null;me.student={name,phone,photo,date:Date.now()};save();return json(r,200,{ok:1});}
  if(p==='/api/like'&&q.method==='POST'&&isStudent){const b=await body(q);const po=db.posts.find(x=>x.id===b.id&&x.kind==='top');if(!po)return json(r,404,{error:'none'});po.likes=po.likes||[];const k=po.likes.indexOf(me.code);if(k>=0)po.likes.splice(k,1);else po.likes.push(me.code);save();return json(r,200,{liked:k<0,likes:po.likes.length,likers:po.likes.map(c=>{const d=db.codes.find(y=>y.code===c);return d&&d.student?d.student.name:null}).filter(Boolean)});}
  if(p==='/api/content'&&q.method==='GET'){
   if(isStudent&&!me.student) return json(r,403,{error:'register first'});
   const strip=x=>({adminName:x.by||'',id:x.id,title:x.title,text:x.text,date:x.date,kind:x.kind,count:x.images.length,likes:(x.likes||[]).length,liked:!!(me&&(x.likes||[]).includes(me.code)),likers:(x.likes||[]).map(c=>{const d=db.codes.find(y=>y.code===c);return d&&d.student?d.student.name:null}).filter(Boolean)});
   return json(r,200,{adminName:'',links:LINKS,posts:db.posts.filter(x=>x.kind!=='top').map(x=>({...strip(x),images:x.images})),top:db.posts.filter(x=>x.kind==='top').map(strip),questions:db.questions,appOnly:true,isApp:isApp(q),secure:db.settings.secure!==false,open:!!db.settings.open,closed:!!db.settings.closed});}
  if(p==='/api/top-image'&&q.method==='GET'){
   const post=db.posts.find(x=>x.id===u.searchParams.get('id')),i=+u.searchParams.get('i')||0;
   if(!post||!post.images[i]) return json(r,404,{error:'not found'});
   if(isStudent&&!isApp(q)) return json(r,403,{error:'app only'});
   if(isStudent&&!me.student) return json(r,403,{error:'register first'});
   const f=path.join(UP,path.basename(post.images[i]));
   r.writeHead(200,{'Content-Type':types[path.extname(f)]||'image/jpeg','Cache-Control':'no-store'});return fs.createReadStream(f).pipe(r);}
  if(p==='/api/solve'&&q.method==='POST'){
   if(isStudent&&!me.student) return json(r,403,{error:'register first'});
   const key=isStudent?me.code:'admin',k=key+day();db.solves[k]=(db.solves[k]||0);const b=await body(q);
   if(b.detect){const dk='d'+k;db.solves[dk]=(db.solves[dk]||0);if(isStudent&&db.solves[dk]>=40)return json(r,429,{error:'daily_limit'});const o2=await solve('',b.image,{detect:true});if(!o2.error){db.solves[dk]++;save()}return json(r,o2.error?502:200,o2);}
   if(isStudent&&db.solves[k]>=SOLVE_PER_DAY) return json(r,429,{error:'daily_limit',limit:SOLVE_PER_DAY});
   const out=await solve(String(b.text||'').slice(0,3000),b.image,{pick:b.pick});
   if(!out.error){db.solves[k]++;for(const o in db.solves) if(!o.endsWith(day())) delete db.solves[o];save()}
   return json(r,out.error==='empty'?400:out.error?502:200,out);}
  if(p==='/api/security-event'&&isStudent&&q.method==='POST'){
   const b=await body(q);db.logs.unshift({date:Date.now(),code:me.code,name:me.student?me.student.name:'',phone:me.student?me.student.phone:'',type:String(b.type||'screenshot').slice(0,30),where:String(b.where||'').slice(0,80)});db.logs=db.logs.slice(0,500);save();return json(r,200,{ok:1});}
  if(p==='/api/my-grades'&&isStudent){let st=null,gn='';for(const g of allGroups()){st=g.students.find(x=>x.code===me.code);if(st){gn=g.name;break}}if(!st)return json(r,200,{linked:false,grades:[]});return json(r,200,{linked:true,name:st.name,group:gn,grades:(st.grades||[]).slice().sort((a,b)=>b.date-a.date)});}
  if(!isAdmin) return json(r,403,{error:'admin only'});
  if(p==='/api/admins'&&q.method==='GET') return json(r,200,{me:sess.user||'',list:ENVADM.map(x=>({user:x[0],src:'env'})).concat((db.admins||[]).map(a=>({user:a.user,email:a.email||'',by:a.by||'',src:'app'})))});
  if(p==='/api/admins/add'&&q.method==='POST'){const b=await body(q),u=String(b.username||'').trim().toLowerCase(),pw=String(b.password||''),em=String(b.email||'').trim().slice(0,80);
   if(!/^[a-z0-9_.]{3,30}$/.test(u)) return json(r,400,{error:'اسم المستخدم حروف إنجليزي وأرقام (3 على الأقل)'});
   if(pw.length<8) return json(r,400,{error:'كلمة السر 8 حروف على الأقل'});
   if(ENVADM.some(x=>x[0].toLowerCase()===u)||(db.admins||[]).some(a=>a.user===u)) return json(r,400,{error:'اسم المستخدم موجود'});
   const salt=crypto.randomBytes(16).toString('hex');db.admins=db.admins||[];db.admins.push({user:u,email:em,salt,hash:hashPw(pw,salt),by:sess.user||'',date:Date.now()});save();return json(r,200,{ok:1});}
  if(p==='/api/admins/share'&&q.method==='GET'){const me=uOf(sess),w=wsId(me),all=ENVADM.map(x=>x[0].toLowerCase()).concat((db.admins||[]).map(a=>a.user));return json(r,200,{me,owner:w===me,linkedTo:w===me?'':w,members:all.filter(u=>u!==me&&db.wsOf[u]===me),others:all.filter(u=>u!==me)});}
  if(p==='/api/admins/link'&&q.method==='POST'){const b=await body(q),me=uOf(sess),u=String(b.user||'').toLowerCase(),all=ENVADM.map(x=>x[0].toLowerCase()).concat((db.admins||[]).map(a=>a.user));
   if(wsId(me)!==me) return json(r,400,{error:'حسابك نفسه مربوط، فك الربط الأول'});
   if(!all.includes(u)||u===me) return json(r,400,{error:'مشرف غير صحيح'});
   if(db.wsOf[u]) return json(r,400,{error:'المشرف ده مربوط بحساب تاني'});
   if(Object.values(db.wsOf).includes(u)) return json(r,400,{error:'فيه مشرفين مربوطين على بيانات المشرف ده'});
   db.wsOf[u]=me;save();return json(r,200,{ok:1});}
  if(p==='/api/admins/unlink'&&q.method==='POST'){const b=await body(q),me=uOf(sess),u=String(b.user||me).toLowerCase();if(u!==me&&db.wsOf[u]!==me)return json(r,400,{error:'مش مربوط بحسابك'});delete db.wsOf[u];save();return json(r,200,{ok:1});}
  if(p==='/api/admins/delete'&&q.method==='POST'){const b=await body(q),u=String(b.username||'').toLowerCase();if(u===String(sess.user||'').toLowerCase())return json(r,400,{error:'مينفعش تحذف حسابك'});db.admins=(db.admins||[]).filter(a=>a.user!==u);for(const k of Object.keys(db.sessions))if(db.sessions[k].role==='admin'&&db.sessions[k].user===u)delete db.sessions[k];delete db.wsOf[u];for(const k of Object.keys(db.wsOf))if(db.wsOf[k]===u)delete db.wsOf[k];save();return json(r,200,{ok:1});}
  if(p==='/api/codes'&&q.method==='GET') return json(r,200,db.codes.map(c=>({...c,student:c.student?{name:c.student.name,phone:c.student.phone,date:c.student.date,hasPhoto:!!c.student.photo}:null})));
  if(p==='/api/codes'&&q.method==='POST'){const b=await body(q);const n=Math.min(+b.count||1,200),out=[];
   for(let i=0;i<n;i++){const c={code:newCode(),label:b.label||'',maxDevices:+b.maxDevices||1,devices:[],disabled:false,created:Date.now()};db.codes.push(c);out.push(c)}
   save();return json(r,200,out);}
  if(p==='/api/codes/toggle'){const b=await body(q);const c=db.codes.find(x=>x.code===b.code);if(c){c.disabled=!c.disabled;save()}return json(r,200,{ok:1});}
  if(p==='/api/codes/delete'){const b=await body(q);db.codes=db.codes.filter(x=>x.code!==b.code);save();return json(r,200,{ok:1});}
  if(p==='/api/student-photo'){const c=db.codes.find(x=>x.code===u.searchParams.get('code'));if(!c||!c.student||!c.student.photo)return json(r,404,{error:'none'});const f=path.join(UP,path.basename(c.student.photo));r.writeHead(200,{'Content-Type':types[path.extname(f)]||'image/jpeg'});return fs.createReadStream(f).pipe(r);}
  if(p==='/api/settings'&&q.method==='POST'){const b=await body(q);for(const k of ['secure','open','closed'])if(k in b)db.settings[k]=!!b[k];save();return json(r,200,{ok:1});}
  if(p==='/api/codes/endsession'){const b=await body(q);for(const k of Object.keys(db.sessions))if(db.sessions[k].code===b.code)delete db.sessions[k];save();return json(r,200,{ok:1});}
  if(p==='/api/logs') return json(r,200,db.logs);
  if(p==='/api/posts'&&q.method==='POST'){const b=await body(q);const post={id:id(),kind:b.kind==='top'?'top':'news',title:b.title||'',text:b.text||'',images:[],by:WS(uOf(sess)).adminName||'',date:Date.now()};
   for(const im of b.images||[]){const f=saveImg(im);if(f)post.images.push(f.startsWith('/')?f:(post.kind==='top'?f:'/uploads/'+f))}
   if((b.images||[]).length&&!post.images.length) return json(r,400,{error:'bad_image'});
   db.posts.unshift(post);save();return json(r,200,{id:post.id});}
  if(p==='/api/posts/delete'){const b=await body(q);db.posts=db.posts.filter(x=>x.id!==b.id);save();return json(r,200,{ok:1});}
  if(p==='/api/questions'&&q.method==='POST'){const b=await body(q);const x={id:id(),subject:b.subject||'',question:b.question||'',direct:b.direct||'',explained:b.explained||'',date:Date.now()};db.questions.unshift(x);save();return json(r,200,x);}
  if(p==='/api/questions/delete'){const b=await body(q);db.questions=db.questions.filter(x=>x.id!==b.id);save();return json(r,200,{ok:1});}
  if(p==='/api/mg-photo'){const sid=u.searchParams.get('id');let st=null;for(const g of WS(uOf(sess)).groups){st=g.students.find(x=>x.id===sid);if(st)break}if(!st||!st.photo)return json(r,404,{error:'none'});const f=path.join(UP,path.basename(st.photo));r.writeHead(200,{'Content-Type':types[path.extname(f)]||'image/jpeg','Cache-Control':'private, max-age=3600'});return fs.createReadStream(f).pipe(r);}
  if(p==='/api/mg'&&q.method==='GET') return json(r,200,WS(uOf(sess)));
  if(p==='/api/mg'&&q.method==='POST'){const b=await body(q),M=WS(uOf(sess)),S=x=>String(x||'').slice(0,80);const g=M.groups.find(x=>x.id===b.gid);
   const D=/^\d{4}-\d{2}-\d{2}$/,MO=/^\d{4}-\d{2}$/;
   if(b.op==='setName'){M.adminName=String(b.name||'').trim().slice(0,40);}
   else if(b.op==='addGroup'){if(!S(b.name))return json(r,400,{error:'name'});M.groups.push({id:id(),name:S(b.name),fee:Math.max(0,+b.fee||0),students:[]});}
   else if(!g) return json(r,404,{error:'group'});
   else if(b.op==='editGroup'){if(S(b.name))g.name=S(b.name);g.fee=Math.max(0,+b.fee||0);}
   else if(b.op==='delGroup'){M.groups=M.groups.filter(x=>x!==g);for(const k of Object.keys(M.att))if(k.startsWith(g.id+'|'))delete M.att[k];for(const k of Object.keys(M.pay))if(k.startsWith(g.id+'|'))delete M.pay[k];}
   else if(b.op==='addStudent'){if(!S(b.name))return json(r,400,{error:'name'});g.students.push({id:id(),name:S(b.name),phone:String(b.phone||'').replace(/[^0-9]/g,'').slice(0,20),photo:b.photo?saveImg(b.photo):null});}
   else if(b.op==='moveStudent'){const st=g.students.find(x=>x.id===b.sid),t=M.groups.find(x=>x.id===b.to);if(!st||!t||t===g)return json(r,400,{error:'group'});g.students=g.students.filter(x=>x!==st);t.students.push(st);for(const T of [M.att,M.pay])for(const k of Object.keys(T)){if(!k.startsWith(g.id+'|')||!T[k]||!(b.sid in T[k]))continue;const nk=t.id+'|'+k.slice(g.id.length+1);T[nk]=T[nk]||{};T[nk][b.sid]=T[k][b.sid];delete T[k][b.sid];if(!Object.keys(T[k]).length)delete T[k];}}
   else if(b.op==='delStudent'){g.students=g.students.filter(x=>x.id!==b.sid);}
   else if(b.op==='editStudent'){const st=g.students.find(x=>x.id===b.sid);if(!st||!S(b.name))return json(r,400,{error:'student'});st.name=S(b.name);st.phone=String(b.phone||'').replace(/[^0-9]/g,'').slice(0,20);if(b.photo){const f=saveImg(b.photo);if(f)st.photo=f}else if(b.rmPhoto)st.photo=null;}
   else if(b.op==='reorder'){const o=Array.isArray(b.order)?b.order:[];const mp=new Map(g.students.map(x=>[x.id,x]));const ns=[];for(const i of o)if(mp.has(i)){ns.push(mp.get(i));mp.delete(i)}for(const x of mp.values())ns.push(x);g.students=ns;}
   else if(b.op==='linkCode'){const st=g.students.find(x=>x.id===b.sid);const c=db.codes.find(x=>x.code===String(b.code||'').trim().toUpperCase());if(!st)return json(r,400,{error:'student'});if(!c)return json(r,400,{error:'الكود غير موجود'});if(allGroups().some(x=>x.students.some(y=>y.code===c.code&&y!==st)))return json(r,400,{error:'الكود مربوط بطالب تاني'});st.code=c.code;}
   else if(b.op==='newCode'){const st=g.students.find(x=>x.id===b.sid);if(!st)return json(r,400,{error:'student'});if(st.code)return json(r,400,{error:'مربوط بكود بالفعل'});const c={code:newCode(),label:st.name,maxDevices:1,devices:[],disabled:false,created:Date.now(),student:{name:st.name,phone:st.phone,photo:st.photo||null,date:Date.now()}};db.codes.push(c);st.code=c.code;}
   else if(b.op==='unlink'){const st=g.students.find(x=>x.id===b.sid);if(st)delete st.code;}
   else if(b.op==='addGrade'){const st=g.students.find(x=>x.id===b.sid);const t=S(b.title);if(!st||!t)return json(r,400,{error:'title'});const sc=String(b.score||'').slice(0,10),mx=String(b.max||'').slice(0,10);st.grades=st.grades||[];st.grades.push({id:id(),title:t,score:sc,max:mx,date:Date.now()});}
   else if(b.op==='delGrade'){const st=g.students.find(x=>x.id===b.sid);if(st)st.grades=(st.grades||[]).filter(x=>x.id!==b.gr);}
   else if(b.op==='fromCodes'){const have=new Set(allGroups().flatMap(x=>x.students.map(y=>y.code).filter(Boolean)));for(const c of db.codes)if(c.student&&!have.has(c.code))g.students.push({id:id(),name:c.student.name,phone:c.student.phone,code:c.code,photo:c.student.photo||null});}
   else if(b.op==='addSched'){const dy=+b.day,tm=String(b.time||''),du=Math.min(600,Math.max(10,+b.dur||60));if(!(dy>=0&&dy<=6)||!/^\d{2}:\d{2}$/.test(tm))return json(r,400,{error:'sched'});g.sched=g.sched||[];g.sched.push({id:id(),day:dy,time:tm,dur:du});}
   else if(b.op==='delSched'){g.sched=(g.sched||[]).filter(x=>x.id!==b.sid);}
   else if(b.op==='setAtt'){if(!D.test(b.date||''))return json(r,400,{error:'date'});const k=g.id+'|'+b.date;M.att[k]=M.att[k]||{};const ids=b.sid==='*'?g.students.map(x=>x.id):[b.sid];for(const i of ids){if(b.status==='present'||b.status==='absent')M.att[k][i]=b.status;else delete M.att[k][i];}if(!Object.keys(M.att[k]).length)delete M.att[k];}
   else if(b.op==='setPay'){if(!MO.test(b.month||''))return json(r,400,{error:'month'});const k=g.id+'|'+b.month;M.pay[k]=M.pay[k]||{};if(b.paid)M.pay[k][b.sid]=String(b.date||'').slice(0,10);else delete M.pay[k][b.sid];}
   else return json(r,400,{error:'op'});
   save();return json(r,200,M);}
  return json(r,404,{error:'not found'});
 }
 if(p.startsWith('/uploads/')){ // news images only (top images are never served here)
  const f=path.basename(p);const okNews=db.posts.some(x=>x.kind!=='top'&&x.images.includes('/uploads/'+f));
  if(!okNews){r.writeHead(403);return r.end('no')}
  const fp=path.join(UP,f);return fs.readFile(fp,(e,d)=>{if(e){r.writeHead(404);return r.end('not found')}r.writeHead(200,{'Content-Type':types[path.extname(fp)]||'application/octet-stream'});r.end(d)});}
 const f=path.join(__dirname,{'/':'index.html','/admin':'manage.html','/manage':'manage.html','/style.css':'style.css','/sw.js':'sw.js'}[p]||'404');
 fs.readFile(f,(e,d)=>{if(e){r.writeHead(404);return r.end('not found')}r.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'});r.end(d)});
 }catch(e){console.error(e);if(!r.headersSent)json(r,500,{error:'server'})}
}).listen(PORT,()=>console.log('http://localhost:'+PORT));

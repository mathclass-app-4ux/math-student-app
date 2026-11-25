const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=process.env.PORT||3000, ADMIN_USER=process.env.ADMIN_USER||'admin', ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||'change-me';
const GEMINI_API_KEY=process.env.GEMINI_API_KEY||'', GEMINI_MODEL=process.env.GEMINI_MODEL||'gemini-3.8-flash';
const SOLVE_PER_DAY=+process.env.SOLVE_PER_DAY||20;
const DATA=path.join(__dirname,'data'),DB=path.join(DATA,'db.json'),UP=path.join(DATA,'uploads');
fs.mkdirSync(UP,{recursive:true});
let db={codes:[],posts:[],questions:[],sessions:{},logs:[],solves:{},settings:{secure:true}};
if(fs.existsSync(DB)) db=Object.assign(db,JSON.parse(fs.readFileSync(DB)));
db.mg=db.mg||{groups:[],att:{},pay:{}};
const save=()=>fs.writeFileSync(DB,JSON.stringify(db));
const LINKS={whatsapp:'https://wa.me/201142104969',facebook:[
 {name:'Page 1',url:'https://www.facebook.com/share/1J3ZLst87q/'},
 {name:'Group',url:'https://www.facebook.com/share/g/14wPVxcD8uP/'},
 {name:'Page 2',url:'https://www.facebook.com/share/1JDvGSC1Cd/'}],phone:'01142104969'};
const id=()=>crypto.randomBytes(6).toString('hex');
const json=(r,c,o)=>{r.writeHead(c,{'Content-Type':'application/json'});r.end(JSON.stringify(o))};
const body=q=>new Promise(res=>{let b=[],n=0;q.on('data',d=>{n+=d.length;if(n<12e6)b.push(d)});q.on('end',()=>{try{res(JSON.parse(Buffer.concat(b)))}catch{res({})}})});
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};
const A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',newCode=()=>{let s='';for(let i=0;i<8;i++)s+=A[crypto.randomInt(A.length)];return s};
const saveImg=im=>{const m=/^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(im||'');if(!m)return null;const f=id()+'.'+(m[1]==='jpeg'?'jpg':m[1]);fs.writeFileSync(path.join(UP,f),Buffer.from(m[2],'base64'));return f};
const isApp=q=>(q.headers['user-agent']||'').includes('MathAppAPK');
const day=()=>new Date().toISOString().slice(0,10);
async function solve(text,image){
 if(!GEMINI_API_KEY) return {error:'ai_not_configured'};
 const parts=[{text:'You are a math teacher for Egyptian students. Solve the problem in the text and/or image. Reply in exactly this format:\nDIRECT:\n<the short final solution steps; use English digits and math symbols only, no Arabic words>\nEXPLAINED:\n<step by step explanation in simple Egyptian Arabic; keep all numbers, variables and symbols in English>\nIf the image is not a math problem or is unreadable, reply with DIRECT:\nUNREADABLE\nEXPLAINED:\nالصورة مش واضحة'}];
 if(text) parts.push({text:'Problem text: '+text});
 const m=/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(image||'');
 if(m) parts.push({inline_data:{mime_type:m[1],data:m[2]}});
 if(!text&&!m) return {error:'empty'};
 const call=gc=>fetch('https://generativelanguage.googleapis.com/v1beta/models/'+GEMINI_MODEL+':generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':GEMINI_API_KEY},body:JSON.stringify({contents:[{parts}],generationConfig:gc}),signal:AbortSignal.timeout(55000)});
 let r=await call({thinkingConfig:{thinkingLevel:'low'},maxOutputTokens:2500});
 if(r.status===400) r=await call({maxOutputTokens:2500});
 const j=await r.json().catch(()=>({}));
 if(!r.ok) return {error:'ai_failed',status:r.status,detail:(j.error&&j.error.message||'').slice(0,200)};
 const t=((j.candidates||[])[0]?.content?.parts||[]).map(p=>p.text||'').join('');
 const mm=/DIRECT:\s*([\s\S]*?)\s*EXPLAINED:\s*([\s\S]*)/i.exec(t);
 return mm?{direct:mm[1].trim(),explained:mm[2].trim()}:{direct:'',explained:t.trim()};
}
http.createServer(async(q,r)=>{
 const u=new URL(q.url,'http://x'),p=u.pathname,tok=(q.headers.authorization||'').replace('Bearer ','');
 const sess=db.sessions[tok],isAdmin=sess&&sess.role==='admin',isStudent=sess&&sess.role==='student';
 try{
 if(p.startsWith('/api/')){
  if(p==='/api/login'&&q.method==='POST'){
   const b=await body(q);
   if(b.role==='admin'){ if(b.username!==ADMIN_USER||b.password!==ADMIN_PASSWORD) return json(r,401,{error:'bad credentials'});
     const t=id()+id();db.sessions[t]={role:'admin'};save();return json(r,200,{token:t,role:'admin'});}
   const c=db.codes.find(x=>x.code===String(b.code||'').trim().toUpperCase());
   if(!c||c.disabled) return json(r,401,{error:'invalid code'});
   if(c.maxDevices&&!c.devices.includes(b.device)){ if(c.devices.length>=c.maxDevices) return json(r,403,{error:'code already used on another device'}); c.devices.push(b.device);}
   const t=id()+id();db.sessions[t]={role:'student',code:c.code};save();return json(r,200,{token:t,role:'student',registered:!!c.student});}
  if(!sess) return json(r,401,{error:'login required'});
  const me=isStudent?db.codes.find(x=>x.code===sess.code):null;
  if(isStudent&&(!me||me.disabled)) return json(r,401,{error:'code disabled'});
  if(p==='/api/me') return json(r,200,{role:sess.role,registered:isStudent?!!me.student:true,name:me&&me.student?me.student.name:'',phone:me&&me.student?me.student.phone:''});
  if(p==='/api/register'&&isStudent){const b=await body(q);const name=String(b.name||'').trim().slice(0,60),phone=String(b.phone||'').replace(/[^0-9+]/g,'').slice(0,20);
   if(!name||phone.length<8) return json(r,400,{error:'name and phone required'});
   const photo=b.photo?saveImg(b.photo):null;me.student={name,phone,photo,date:Date.now()};save();return json(r,200,{ok:1});}
  if(p==='/api/like'&&q.method==='POST'&&isStudent){const b=await body(q);const po=db.posts.find(x=>x.id===b.id&&x.kind==='top');if(!po)return json(r,404,{error:'none'});po.likes=po.likes||[];const k=po.likes.indexOf(me.code);if(k>=0)po.likes.splice(k,1);else po.likes.push(me.code);save();return json(r,200,{liked:k<0,likes:po.likes.length,likers:po.likes.map(c=>{const d=db.codes.find(y=>y.code===c);return d&&d.student?d.student.name:null}).filter(Boolean)});}
  if(p==='/api/content'&&q.method==='GET'){
   if(isStudent&&!me.student) return json(r,403,{error:'register first'});
   const strip=x=>({id:x.id,title:x.title,text:x.text,date:x.date,kind:x.kind,count:x.images.length,likes:(x.likes||[]).length,liked:!!(me&&(x.likes||[]).includes(me.code)),likers:(x.likes||[]).map(c=>{const d=db.codes.find(y=>y.code===c);return d&&d.student?d.student.name:null}).filter(Boolean)});
   return json(r,200,{links:LINKS,posts:db.posts.filter(x=>x.kind!=='top').map(x=>({...strip(x),images:x.images})),top:db.posts.filter(x=>x.kind==='top').map(strip),questions:db.questions,appOnly:true,isApp:isApp(q),secure:db.settings.secure!==false});}
  if(p==='/api/top-image'&&q.method==='GET'){
   const post=db.posts.find(x=>x.id===u.searchParams.get('id')),i=+u.searchParams.get('i')||0;
   if(!post||!post.images[i]) return json(r,404,{error:'not found'});
   if(isStudent&&!isApp(q)) return json(r,403,{error:'app only'});
   if(isStudent&&!me.student) return json(r,403,{error:'register first'});
   const f=path.join(UP,path.basename(post.images[i]));
   r.writeHead(200,{'Content-Type':types[path.extname(f)]||'image/jpeg','Cache-Control':'no-store'});return fs.createReadStream(f).pipe(r);}
  if(p==='/api/solve'&&q.method==='POST'){
   if(isStudent&&!me.student) return json(r,403,{error:'register first'});
   const key=isStudent?me.code:'admin',k=key+day();db.solves[k]=(db.solves[k]||0);
   if(isStudent&&db.solves[k]>=SOLVE_PER_DAY) return json(r,429,{error:'daily_limit',limit:SOLVE_PER_DAY});
   const b=await body(q);const out=await solve(String(b.text||'').slice(0,3000),b.image);
   if(!out.error){db.solves[k]++;for(const o in db.solves) if(!o.endsWith(day())) delete db.solves[o];save()}
   return json(r,out.error==='empty'?400:out.error?502:200,out);}
  if(p==='/api/security-event'&&isStudent&&q.method==='POST'){
   const b=await body(q);db.logs.unshift({date:Date.now(),code:me.code,name:me.student?me.student.name:'',phone:me.student?me.student.phone:'',type:String(b.type||'screenshot').slice(0,30),where:String(b.where||'').slice(0,80)});db.logs=db.logs.slice(0,500);save();return json(r,200,{ok:1});}
  if(!isAdmin) return json(r,403,{error:'admin only'});
  if(p==='/api/codes'&&q.method==='GET') return json(r,200,db.codes.map(c=>({...c,student:c.student?{name:c.student.name,phone:c.student.phone,hasPhoto:!!c.student.photo}:null})));
  if(p==='/api/codes'&&q.method==='POST'){const b=await body(q);const n=Math.min(+b.count||1,200),out=[];
   for(let i=0;i<n;i++){const c={code:newCode(),label:b.label||'',maxDevices:+b.maxDevices||1,devices:[],disabled:false,created:Date.now()};db.codes.push(c);out.push(c)}
   save();return json(r,200,out);}
  if(p==='/api/codes/toggle'){const b=await body(q);const c=db.codes.find(x=>x.code===b.code);if(c){c.disabled=!c.disabled;save()}return json(r,200,{ok:1});}
  if(p==='/api/codes/delete'){const b=await body(q);db.codes=db.codes.filter(x=>x.code!==b.code);save();return json(r,200,{ok:1});}
  if(p==='/api/student-photo'){const c=db.codes.find(x=>x.code===u.searchParams.get('code'));if(!c||!c.student||!c.student.photo)return json(r,404,{error:'none'});const f=path.join(UP,path.basename(c.student.photo));r.writeHead(200,{'Content-Type':types[path.extname(f)]||'image/jpeg'});return fs.createReadStream(f).pipe(r);}
  if(p==='/api/settings'&&q.method==='POST'){const b=await body(q);db.settings.secure=!!b.secure;save();return json(r,200,{ok:1});}
  if(p==='/api/logs') return json(r,200,db.logs);
  if(p==='/api/posts'&&q.method==='POST'){const b=await body(q);const post={id:id(),kind:b.kind==='top'?'top':'news',title:b.title||'',text:b.text||'',images:[],date:Date.now()};
   for(const im of b.images||[]){const f=saveImg(im);if(f)post.images.push(f.startsWith('/')?f:(post.kind==='top'?f:'/uploads/'+f))}
   if((b.images||[]).length&&!post.images.length) return json(r,400,{error:'bad_image'});
   db.posts.unshift(post);save();return json(r,200,{id:post.id});}
  if(p==='/api/posts/delete'){const b=await body(q);db.posts=db.posts.filter(x=>x.id!==b.id);save();return json(r,200,{ok:1});}
  if(p==='/api/questions'&&q.method==='POST'){const b=await body(q);const x={id:id(),subject:b.subject||'',question:b.question||'',direct:b.direct||'',explained:b.explained||'',date:Date.now()};db.questions.unshift(x);save();return json(r,200,x);}
  if(p==='/api/questions/delete'){const b=await body(q);db.questions=db.questions.filter(x=>x.id!==b.id);save();return json(r,200,{ok:1});}
  if(p==='/api/mg-photo'){const sid=u.searchParams.get('id');let st=null;for(const g of db.mg.groups){st=g.students.find(x=>x.id===sid);if(st)break}if(!st||!st.photo)return json(r,404,{error:'none'});const f=path.join(UP,path.basename(st.photo));r.writeHead(200,{'Content-Type':types[path.extname(f)]||'image/jpeg','Cache-Control':'private, max-age=3600'});return fs.createReadStream(f).pipe(r);}
  if(p==='/api/mg'&&q.method==='GET') return json(r,200,db.mg);
  if(p==='/api/mg'&&q.method==='POST'){const b=await body(q),M=db.mg,S=x=>String(x||'').slice(0,80);const g=M.groups.find(x=>x.id===b.gid);
   const D=/^\d{4}-\d{2}-\d{2}$/,MO=/^\d{4}-\d{2}$/;
   if(b.op==='addGroup'){if(!S(b.name))return json(r,400,{error:'name'});M.groups.push({id:id(),name:S(b.name),fee:Math.max(0,+b.fee||0),students:[]});}
   else if(!g) return json(r,404,{error:'group'});
   else if(b.op==='editGroup'){if(S(b.name))g.name=S(b.name);g.fee=Math.max(0,+b.fee||0);}
   else if(b.op==='delGroup'){M.groups=M.groups.filter(x=>x!==g);for(const k of Object.keys(M.att))if(k.startsWith(g.id+'|'))delete M.att[k];for(const k of Object.keys(M.pay))if(k.startsWith(g.id+'|'))delete M.pay[k];}
   else if(b.op==='addStudent'){if(!S(b.name))return json(r,400,{error:'name'});g.students.push({id:id(),name:S(b.name),phone:String(b.phone||'').replace(/[^0-9]/g,'').slice(0,20),photo:b.photo?saveImg(b.photo):null});}
   else if(b.op==='delStudent'){g.students=g.students.filter(x=>x.id!==b.sid);}
   else if(b.op==='editStudent'){const st=g.students.find(x=>x.id===b.sid);if(!st||!S(b.name))return json(r,400,{error:'student'});st.name=S(b.name);st.phone=String(b.phone||'').replace(/[^0-9]/g,'').slice(0,20);if(b.photo){const f=saveImg(b.photo);if(f)st.photo=f}else if(b.rmPhoto)st.photo=null;}
   else if(b.op==='reorder'){const o=Array.isArray(b.order)?b.order:[];const mp=new Map(g.students.map(x=>[x.id,x]));const ns=[];for(const i of o)if(mp.has(i)){ns.push(mp.get(i));mp.delete(i)}for(const x of mp.values())ns.push(x);g.students=ns;}
   else if(b.op==='fromCodes'){const have=new Set(M.groups.flatMap(x=>x.students.map(y=>y.code).filter(Boolean)));for(const c of db.codes)if(c.student&&!have.has(c.code))g.students.push({id:id(),name:c.student.name,phone:c.student.phone,code:c.code,photo:c.student.photo||null});}
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

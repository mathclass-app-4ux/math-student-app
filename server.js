const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=process.env.PORT||3000, ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||'change-me';
const DB=path.join(__dirname,'data','db.json'), UP=path.join(__dirname,'data','uploads');
fs.mkdirSync(UP,{recursive:true});
let db={codes:[],posts:[],questions:[],sessions:{}};
if(fs.existsSync(DB)) db=JSON.parse(fs.readFileSync(DB));
const save=()=>fs.writeFileSync(DB,JSON.stringify(db));
const LINKS={whatsapp:'https://wa.me/201142104969',facebook:[
 {name:'Page 1',url:'https://www.facebook.com/share/1J3ZLst87q/'},
 {name:'Group',url:'https://www.facebook.com/share/g/14wPVxcD8uP/'},
 {name:'Page 2',url:'https://www.facebook.com/share/1JDvGSC1Cd/'}],phone:'01142104969'};
const id=()=>crypto.randomBytes(6).toString('hex');
const json=(r,c,o)=>{r.writeHead(c,{'Content-Type':'application/json'});r.end(JSON.stringify(o))};
const body=q=>new Promise(res=>{let b=[];q.on('data',d=>b.push(d));q.on('end',()=>{try{res(JSON.parse(Buffer.concat(b)))}catch{res({})}})});
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.json':'application/json'};
const newCode=()=>{const A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let s='';for(let i=0;i<8;i++)s+=A[crypto.randomInt(A.length)];return s};
http.createServer(async(q,r)=>{
 const u=new URL(q.url,'http://x'),p=u.pathname,tok=(q.headers.authorization||'').replace('Bearer ','');
 const sess=db.sessions[tok], isAdmin=sess&&sess.role==='admin', isStudent=sess&&sess.role==='student';
 if(p.startsWith('/api/')){
  if(p==='/api/login'&&q.method==='POST'){
   const b=await body(q);
   if(b.password!==undefined){ if(b.password!==ADMIN_PASSWORD) return json(r,401,{error:'bad password'});
     const t=id()+id();db.sessions[t]={role:'admin'};save();return json(r,200,{token:t,role:'admin'});}
   const c=db.codes.find(x=>x.code===String(b.code||'').trim().toUpperCase());
   if(!c||c.disabled) return json(r,401,{error:'invalid code'});
   if(c.maxDevices&&!c.devices.includes(b.device)){ if(c.devices.length>=c.maxDevices) return json(r,403,{error:'code already used on another device'}); c.devices.push(b.device);}
   const t=id()+id();db.sessions[t]={role:'student',code:c.code};save();return json(r,200,{token:t,role:'student'});}
  if(!sess) return json(r,401,{error:'login required'});
  if(p==='/api/content'&&q.method==='GET'){
   if(isStudent){const c=db.codes.find(x=>x.code===sess.code); if(!c||c.disabled) return json(r,401,{error:'code disabled'});}
   return json(r,200,{links:LINKS,posts:db.posts,questions:db.questions});}
  if(!isAdmin) return json(r,403,{error:'admin only'});
  if(p==='/api/codes'&&q.method==='GET') return json(r,200,db.codes);
  if(p==='/api/codes'&&q.method==='POST'){const b=await body(q);const n=Math.min(+b.count||1,200),out=[];
   for(let i=0;i<n;i++){const c={code:newCode(),label:b.label||'',maxDevices:+b.maxDevices||1,devices:[],disabled:false,created:Date.now()};db.codes.push(c);out.push(c)}
   save();return json(r,200,out);}
  if(p==='/api/codes/toggle'){const b=await body(q);const c=db.codes.find(x=>x.code===b.code);if(c){c.disabled=!c.disabled;save()}return json(r,200,{ok:1});}
  if(p==='/api/codes/delete'){const b=await body(q);db.codes=db.codes.filter(x=>x.code!==b.code);save();return json(r,200,{ok:1});}
  if(p==='/api/posts'&&q.method==='POST'){const b=await body(q);const post={id:id(),title:b.title||'',text:b.text||'',images:[],date:Date.now()};
   for(const im of b.images||[]){const m=/^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(im);if(!m)continue;const f=id()+'.'+(m[1]==='jpeg'?'jpg':m[1]);fs.writeFileSync(path.join(UP,f),Buffer.from(m[2],'base64'));post.images.push('/uploads/'+f)}
   db.posts.unshift(post);save();return json(r,200,post);}
  if(p==='/api/posts/delete'){const b=await body(q);db.posts=db.posts.filter(x=>x.id!==b.id);save();return json(r,200,{ok:1});}
  if(p==='/api/questions'&&q.method==='POST'){const b=await body(q);const x={id:id(),subject:b.subject||'',question:b.question||'',direct:b.direct||'',explained:b.explained||'',date:Date.now()};db.questions.unshift(x);save();return json(r,200,x);}
  if(p==='/api/questions/delete'){const b=await body(q);db.questions=db.questions.filter(x=>x.id!==b.id);save();return json(r,200,{ok:1});}
  return json(r,404,{error:'not found'});
 }
 let f=p.startsWith('/uploads/')?path.join(UP,path.basename(p)):path.join(__dirname,{'/':'index.html','/admin':'admin.html','/style.css':'style.css','/sw.js':'sw.js'}[p]||'404');
 fs.readFile(f,(e,d)=>{if(e){r.writeHead(404);return r.end('not found')}r.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'});r.end(d)});
}).listen(PORT,()=>console.log('http://localhost:'+PORT));

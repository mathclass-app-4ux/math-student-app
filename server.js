const FB=(()=>{const module={exports:{}};
// Firestore persistence (REST, no dependencies). Active only when FIREBASE_SA env holds the service-account JSON.
const crypto=require('crypto'),https=require('https'),fs=require('fs'),path=require('path');
let K=null;try{if(process.env.FIREBASE_SA)K=JSON.parse(process.env.FIREBASE_SA)}catch(e){console.log('FIREBASE_SA invalid json')}
const on=!!(K&&K.project_id&&K.private_key&&K.client_email);
const CH=600000;
const BASE=on?`https://firestore.googleapis.com/v1/projects/${K.project_id}/databases/(default)/documents`:'';
let tok='',tokExp=0;
function rq(u,m,h,b){return new Promise((res,rej)=>{const q=https.request(u,{method:m,headers:h},s=>{const bs=[];s.on('data',c=>bs.push(c));s.on('end',()=>res({c:s.statusCode,d:Buffer.concat(bs).toString('utf8')}))});q.on('error',rej);q.setTimeout(30000,()=>q.destroy(new Error('timeout')));if(b)q.write(b);q.end()})}
async function token(){
 if(tok&&Date.now()<tokExp-60000)return tok;
 const b=o=>Buffer.from(JSON.stringify(o)).toString('base64url'),now=Math.floor(Date.now()/1000);
 const h=b({alg:'RS256',typ:'JWT'})+'.'+b({iss:K.client_email,scope:'https://www.googleapis.com/auth/datastore',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3000});
 const sig=crypto.sign('RSA-SHA256',Buffer.from(h),K.private_key).toString('base64url');
 const r=await rq('https://oauth2.googleapis.com/token','POST',{'Content-Type':'application/x-www-form-urlencoded'},'grant_type='+encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')+'&assertion='+h+'.'+sig);
 if(r.c!==200)throw new Error('token '+r.c);
 const j=JSON.parse(r.d);tok=j.access_token;tokExp=Date.now()+(j.expires_in||3000)*1000;return tok;
}
async function api(m,p,body){const t=await token();const r=await rq(BASE+p,m,{Authorization:'Bearer '+t,'Content-Type':'application/json'},body?JSON.stringify(body):undefined);if(r.c>=300)throw new Error(m+' '+p.slice(0,40)+' '+r.c+' '+r.d.slice(0,120));return r.d?JSON.parse(r.d):{}}
async function commit(writes){for(let i=0;i<writes.length;i+=400){await api('POST',':commit',{writes:writes.slice(i,i+400)})}}
const dn=(col,id)=>`projects/${K.project_id}/databases/(default)/documents/${col}/${id}`;
async function listAll(col){const out=[];let pt='';do{const r=await api('GET','/'+col+'?pageSize=200'+(pt?'&pageToken='+encodeURIComponent(pt):''));(r.documents||[]).forEach(d=>out.push(d.fields));pt=r.nextPageToken||''}while(pt);return out}
const written={};   // key -> {h,n}
const dirty=new Set(),imgQ=[];let timer=null,busy=false,lastHot=0;
const HOT=new Set(['sessions','cache','stats','solves']);
let getDb=()=>({}),froze=false;
function mark(keys){if(!on)return;(keys||Object.keys(getDb())).forEach(k=>dirty.add(k));if(!timer)timer=setTimeout(()=>{timer=null;flush().catch(e=>console.log('fb flush',e.message))},3000)}
async function flush(force){
 if(!on||froze)return false;
 if(busy){if(!force)return false;while(busy)await new Promise(r=>setTimeout(r,50))}
 busy=true;let okk=true;
 try{
  const db=getDb(),w=[];
  const hotOk=force||Date.now()-lastHot>30000;
  for(const k of [...dirty]){
   if(HOT.has(k)&&!hotOk&&dirty.size>0&&k!=='sessions'){continue}
   const s=JSON.stringify(db[k]===undefined?null:db[k]),h=crypto.createHash('md5').update(s).digest('hex');
   dirty.delete(k);if(written[k]&&written[k].h===h)continue;
   if(HOT.has(k))lastHot=Date.now();
   const n=Math.max(1,Math.ceil(s.length/CH));
   for(let i=0;i<n;i++)w.push({update:{name:dn('kv',k+'_'+i),fields:{k:{stringValue:k},i:{integerValue:String(i)},n:{integerValue:String(n)},s:{stringValue:s.slice(i*CH,(i+1)*CH)}}}});
   const old=written[k]?written[k].n:0;for(let i=n;i<old;i++)w.push({delete:dn('kv',k+'_'+i)});
   written[k]={h,n};
  }
  while(imgQ.length){const {f,buf}=imgQ.shift();const s=buf.toString('base64'),n=Math.max(1,Math.ceil(s.length/CH));for(let i=0;i<n;i++)w.push({update:{name:dn('img',f.replace(/\./g,'_')+'_'+i),fields:{f:{stringValue:f},i:{integerValue:String(i)},n:{integerValue:String(n)},s:{stringValue:s.slice(i*CH,(i+1)*CH)}}}})}
  if(w.length)await commit(w);
  if([...dirty].some(k=>HOT.has(k)))setTimeout(()=>mark([]),31000);
 }catch(e){okk=false;console.log('fb error',e.message);Object.keys(getDb()).forEach(k=>{if(!HOT.has(k))dirty.add(k)});setTimeout(()=>mark([]),20000)}
 finally{busy=false}
 return okk;
}
async function sync(){if(!on)return true;if(froze)return false;mark([]);Object.keys(getDb()).forEach(k=>dirty.add(k));if(timer){clearTimeout(timer);timer=null}let ok=await flush(true);if(!ok)ok=await flush(true);return ok}
async function load(UP,target){
 if(!on)return false;
 const kv=await listAll('kv'),by={};
 kv.forEach(f=>{const k=f.k.stringValue;(by[k]=by[k]||[])[+f.i.integerValue]=f.s.stringValue});
 let got=0;
 for(const k of Object.keys(by)){const s=by[k].join('');try{target[k]=JSON.parse(s);written[k]={h:crypto.createHash('md5').update(s).digest('hex'),n:by[k].length};got++}catch(e){console.log('fb bad key',k)}}
 const im=await listAll('img'),bf={};
 im.forEach(f=>{const k=f.f.stringValue;(bf[k]=bf[k]||[])[+f.i.integerValue]=f.s.stringValue});
 let ni=0;for(const f of Object.keys(bf)){try{const fp=path.join(UP,path.basename(f));if(!fs.existsSync(fp)){fs.writeFileSync(fp,Buffer.from(bf[f].join(''),'base64'))}ni++}catch(e){}}
 console.log('firestore loaded keys',got,'images',ni);return got>0;
}
module.exports={sync,freeze:()=>{froze=true;console.log('firestore frozen: no writes (load failed)')},on,mark,flush,load,img:(f,buf)=>{if(!on)return;imgQ.push({f,buf});mark([])},setDb:g=>{getDb=g}};

return module.exports})();
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
const dkey=t=>{const d=new Date((+t||0)+3*3600e3);return d.toISOString().slice(0,10)};
const numOrStr=v=>{const n=+v;return String(v).trim()!==''&&isFinite(n)?n:String(v)};
function migGrades(M){for(const g of M.groups||[]){g.exams=g.exams||[];for(const st of g.students||[]){if(st.gm||!(st.grades&&st.grades.length)){st.gm=1;continue}for(const gr of st.grades){const mx=Math.max(0,+gr.max||0);let ex=g.exams.find(e=>e.title===gr.title&&(+e.max||0)===mx&&dkey(e.date)===dkey(gr.date));if(!ex){ex={id:id(),title:gr.title,max:mx,date:gr.date||Date.now(),scores:{}};g.exams.push(ex)}if(!(st.id in ex.scores)&&String(gr.score||'').trim()!=='')ex.scores[st.id]=numOrStr(gr.score)}st.gm=1}}}
const FIXT=new Set(["427194e6e414", "6cfffb6825a5", "e03edc49cebe", "9e797599f2c4", "38d0da2fafad", "64da4abc2967", "4b7498f2ef24", "773b90d4cc9a", "a1c16ea69f72", "5ab8370eb4e4", "8aabcf38d001", "72878d5172a0", "6feba1a03036", "f013b929221c", "44aefa38be45", "16d7378aab82", "750857b1f9bd", "cd7a1a141a7e", "f56722fa08d4", "8298dc50c13a", "6f729ed0c83b", "e383947ae7ba", "eefc7f159072", "5f81b5f9a69d"]);const migSched=w=>{let ch=0;for(const g of w.groups||[])for(const x of g.sched||[])if(FIXT.has(x.id)&&!x.fx){const[h,m]=String(x.time).split(':');if(+h<8){x.t0=x.time;x.time=String(+h+12).padStart(2,'0')+':'+m}x.fx=1;ch++}if(ch)save()};
const WS=u=>{const k=wsId(u);const w=db.ws[k]||(db.ws[k]={groups:[],att:{},pay:{}});migGrades(w);migSched(w);return w};
const allGroups=()=>Object.values(db.ws).flatMap(w=>{migGrades(w);return w.groups});
const SIGN={};
FB.setDb(()=>db);
const save=()=>{if(FB.on)FB.mark();else fs.writeFileSync(DB,JSON.stringify(db))};
process.on('SIGTERM',()=>{FB.flush().finally(()=>process.exit(0))});
const LINKS={whatsapp:'https://wa.me/201142104969',facebook:[
 {name:'Page 1',url:'https://www.facebook.com/share/1J3ZLst87q/'},
 {name:'Group',url:'https://www.facebook.com/share/g/14wPVxcD8uP/'},
 {name:'Page 2',url:'https://www.facebook.com/share/1JDvGSC1Cd/'}],phone:'01142104969'};
const SOLVER_KEY=process.env.SOLVER_KEY||'mrk-solver-7f3a9c',SOLVER_DAY_ALL=+process.env.SOLVER_DAY_ALL||1800,SOLVER_DAY_DEV=+process.env.SOLVER_DAY_DEV||12,SOLVER_DAY_IP=+process.env.SOLVER_DAY_IP||30;let SL={d:'',all:0,dev:{},ip:{}};
const id=()=>crypto.randomBytes(6).toString('hex');
const json=(r,c,o)=>{const send=(c2,o2,h)=>{r.writeHead(c2,Object.assign({'Content-Type':'application/json','Cache-Control':'no-store'},h||{}));r.end(JSON.stringify(o2))};
 if(r.wt&&FB.on&&c<300){FB.sync().then(ok=>ok?send(c,o,{'X-Saved':'1'}):send(500,{error:'فشل الحفظ على Firebase، حاول تاني',saveFailed:1})).catch(()=>send(500,{error:'فشل الحفظ على Firebase، حاول تاني',saveFailed:1}));return}
 if(r.wt&&c<300)return send(c,o,{'X-Saved':'1'});send(c,o)};
const body=q=>new Promise(res=>{let b=[],n=0;q.on('data',d=>{n+=d.length;if(n<12e6)b.push(d)});q.on('end',()=>{try{res(JSON.parse(Buffer.concat(b)))}catch{res({})}})});
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};
const A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',newCode=()=>{let s='';for(let i=0;i<8;i++)s+=A[crypto.randomInt(A.length)];return s};
const saveImg=im=>{const m=/^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(im||'');if(!m)return null;const f=id()+'.'+(m[1]==='jpeg'?'jpg':m[1]);{const bf=Buffer.from(m[2],'base64');fs.writeFileSync(path.join(UP,f),bf);FB.img(f,bf)}return f};
const isApp=q=>(q.headers['user-agent']||'').includes('MathAppAPK');
const day=()=>new Date().toISOString().slice(0,10);
const nrm=t=>String(t||'').toLowerCase().replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[\s$\\{}]+/g,'').replace(/[.,،؟?!:;]+$/g,'');
const ckey=t=>{const n=nrm(t);return n.length<3?null:crypto.createHash('sha1').update(n).digest('hex').slice(0,20)};
const cacheKey=(text,image,pick)=>{if(!image)return text?ckey(text):null;if(pick&&pick.text&&!text&&String(pick.text).length<300)return ckey(pick.text);return null};
const st=()=>{db.stats=db.stats||{};const d=day();if(!db.stats[d]){db.stats[d]={ai:0,hits:0,fail:0,quota:0,det:0};const ks=Object.keys(db.stats).sort();while(ks.length>14)delete db.stats[ks.shift()]}return db.stats[d]};
const perStudent=()=>db.settings.perStudent>0?db.settings.perStudent:SOLVE_PER_DAY,listLimit=()=>db.settings.listLimit>0?db.settings.listLimit:40;
const capHit=()=>{const c=+db.settings.globalCap||0;if(!c)return false;const t=st();return t.ai+t.det>=c};
const getHit=(text,image,pick)=>{if(!image&&text&&typeof localSolve==='function'&&localSolve(text))return 'local';const k=cacheKey(text,image,pick);return k&&db.cache&&db.cache[k]?k:null};
// ===== local math engine (free, no AI): numbers, linear/quadratic equations, 2x2 systems, polynomial derivative/integral =====
const LM=(()=>{
 const LIM=1e15,gcd=(a,b)=>{a=Math.abs(a);b=Math.abs(b);while(b){[a,b]=[b,a%b]}return a||1};
 const F=(n,d=1)=>{if(!Number.isFinite(n)||!Number.isFinite(d)||d===0)throw 0;if(d<0){n=-n;d=-d}const g=gcd(n,d);n/=g;d/=g;if(Math.abs(n)>LIM||d>LIM)throw 0;return {n,d}};
 const add=(a,b)=>F(a.n*b.d+b.n*a.d,a.d*b.d),sub=(a,b)=>F(a.n*b.d-b.n*a.d,a.d*b.d),mul=(a,b)=>F(a.n*b.n,a.d*b.d),dv=(a,b)=>F(a.n*b.d,a.d*b.n),neg=a=>F(-a.n,a.d),isz=a=>a.n===0;
 const fs=a=>a.d===1?String(a.n):a.n+'/'+a.d,dec=a=>{const v=a.n/a.d;return String(+v.toFixed(4))};
 const fsd=a=>a.d===1?String(a.n):fs(a)+' = '+dec(a);
 // polynomial: Map monomialKey -> Fraction ; key like "x2y1" or "" for constant
 const mk=o=>Object.keys(o).sort().filter(v=>o[v]>0).map(v=>v+o[v]).join(''),pk=k=>{const o={};k.replace(/([a-z])(\d+)/g,(_,v,e)=>{o[v]=+e});return o};
 const P=(m)=>m||new Map(),cst=f=>new Map(isz(f)?[]:[['',f]]),vr=v=>new Map([[v+'1',F(1)]]);
 const padd=(a,b)=>{const r=new Map(a);for(const[k,v]of b){const s=r.has(k)?add(r.get(k),v):v;isz(s)?r.delete(k):r.set(k,s)}return r};
 const pneg=a=>new Map([...a].map(([k,v])=>[k,neg(v)]));
 const pmul=(a,b)=>{let r=new Map();for(const[k1,v1]of a)for(const[k2,v2]of b){const o1=pk(k1),o2=pk(k2),o={...o1};for(const v in o2)o[v]=(o[v]||0)+o2[v];if(Object.values(o).some(e=>e>8))throw 0;r=padd(r,new Map([[mk(o),mul(v1,v2)]]))}return r};
 const isC=a=>a.size===0||(a.size===1&&a.has(''));const cv=a=>a.size?a.get(''):F(0);
 const ppow=(a,e)=>{if(e<0||e>(isC(a)?40:8))throw 0;let r=cst(F(1));for(let i=0;i<e;i++)r=pmul(r,a);return r};
 const sqf=f=>{if(f.n<0)return null;const a=Math.round(Math.sqrt(f.n)),b=Math.round(Math.sqrt(f.d));return a*a===f.n&&b*b===f.d?F(a,b):null};
 function parse(s){
  const T=[];let i=0;
  while(i<s.length){const c=s[i];
   if(c===' '){i++;continue}
   if(/[0-9.]/.test(c)){let j=i;while(j<s.length&&/[0-9.]/.test(s[j]))j++;const t=s.slice(i,j);if(!/^\d*\.?\d+$|^\d+\.?$/.test(t))throw 0;const[ip,fp='']=t.split('.');T.push({t:'n',v:F(+(ip+fp||'0'),Math.pow(10,fp.length))});i=j;continue}
   if(/[a-z]/.test(c)){T.push({t:'v',v:c});i++;continue}
   if('+-*/^()√'.includes(c)){T.push({t:c});i++;continue}
   throw 0}
  let p=0;const pk2=()=>T[p],nx=()=>T[p++];
  const expr=()=>{let a=term();while(pk2()&&(pk2().t==='+'||pk2().t==='-')){const o=nx().t,b=term();a=o==='+'?padd(a,b):padd(a,pneg(b))}return a};
  const term=()=>{let a=unary();for(;;){const t=pk2();if(!t)break;if(t.t==='*'){nx();a=pmul(a,unary())}else if(t.t==='/'){nx();const b=unary();if(!isC(b)||isz(cv(b)))throw 0;a=pmul(a,cst(dv(F(1),cv(b))))}else if(t.t==='v'||t.t==='('||t.t==='√'){a=pmul(a,power())}else break}return a};
  const unary=()=>{const t=pk2();if(t&&t.t==='-'){nx();return pneg(unary())}if(t&&t.t==='+'){nx();return unary()}return power()};
  const power=()=>{let b=atom();if(pk2()&&pk2().t==='^'){nx();let sg=1;if(pk2()&&pk2().t==='-'){nx();sg=-1}let e;if(pk2()&&pk2().t==='('){nx();const x=expr();if(!pk2()||nx().t!==')')throw 0;if(!isC(x))throw 0;e=cv(x)}else{const t=nx();if(!t||t.t!=='n')throw 0;e=t.v}if(e.d!==1)throw 0;e=e.n*sg;if(e<0){if(!isC(b)||isz(cv(b))||e<-40)throw 0;return cst(dv(F(1),cv(ppow(b,-e))))}b=ppow(b,e)}return b};
  const atom=()=>{const t=nx();if(!t)throw 0;if(t.t==='n')return cst(t.v);if(t.t==='v')return vr(t.v);if(t.t==='√'){let x;if(pk2()&&pk2().t==='('){nx();x=expr();if(!pk2()||nx().t!==')')throw 0}else{const q=nx();if(!q||q.t!=='n')throw 0;x=cst(q.v)}if(!isC(x))throw 0;const r=sqf(cv(x));if(!r)throw 0;return cst(r)}if(t.t==='('){const x=expr();if(!pk2()||nx().t!==')')throw 0;return x}throw 0};
  const r=expr();if(p!==T.length)throw 0;return r}
 const vars=a=>{const s=new Set();for(const k of a.keys())Object.keys(pk(k)).forEach(v=>s.add(v));return s};
 const deg=(a,v)=>{let d=0;for(const k of a.keys())d=Math.max(d,pk(k)[v]||0);return d};
 const coef=(a,v,e)=>{let r=F(0);for(const[k,x]of a){const o=pk(k);if((o[v]||0)===e&&Object.keys(o).filter(q=>q!==v).length===0)r=add(r,x)}return r};
 const show=(a,v)=>{ // univariate polynomial string, high to low
  const d=deg(a,v),out=[];for(let e=d;e>=0;e--){const c=coef(a,v,e);if(isz(c))continue;const ab=c.n<0?neg(c):c,one=ab.n===1&&ab.d===1;let t=(one&&e>0?'':(ab.d===1?String(ab.n):'('+fs(ab)+')'))+(e>0?v+(e>1?'^'+e:''):'');out.push([c.n<0?'-':'+',t])}
  if(!out.length)return '0';return out.map(([g,t],i)=>i===0?(g==='-'?'-':'')+t:' '+g+' '+t).join('')};
 const clean=raw=>{
  let s=String(raw||'').toLowerCase().trim();
  s=s.replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/٫/g,'.').replace(/[،]/g,',').replace(/[×·]/g,'*').replace(/÷/g,'/').replace(/[−–—]/g,'-').replace(/²/g,'^2').replace(/³/g,'^3').replace(/sqrt/g,'√').replace(/[؟?]/g,' ');
  return s};
 const solveLin=(a,v)=>{const A=coef(a,v,1),B=coef(a,v,0);return dv(neg(B),A)};
 function solve(raw){
  try{
   let s=clean(raw);if(s.length>200)return null;
   let mode='';
   const m1=/^(?:derivative of|differentiate|d\/dx of|d\/dx|مشتقة|مشتقه|اشتق|جد مشتقة|أوجد مشتقة|اوجد مشتقة)\s*/.exec(s);if(m1){mode='d';s=s.slice(m1[0].length)}
   const m2=/^(?:integral of|integrate|∫|تكامل|جد تكامل|أوجد تكامل|اوجد تكامل)\s*/.exec(s);if(m2){mode='i';s=s.slice(m2[0].length).replace(/\s*d[xyz]\s*$/,'')}
   if(!mode){for(let n=0;n<3;n++){const r=s.replace(/^(?:solve|calculate|compute|evaluate|simplify|find|what is|what's|حل|احسب|أوجد|اوجد|جد|ما ناتج|ما هو ناتج|ناتج|المعادلة|المعادله|معادلة|معادله|المعادلتين|المعادلتان)(?:\s+(?:for|the equation|the equations|equation|equations))?\s*[:：]?\s+/,'');if(r===s)break;s=r}}
   s=s.replace(/\s+(?:و|and)\s+/g,',').replace(/[.]+\s*$/,'').replace(/\s*=\s*$/,'').trim();
   if(!s||!/^[0-9a-z+\-*\/^().=,; \n√]+$/.test(s))return null;
   if(/[a-z]{2,}/.test(s.replace(/\s+/g,''))&&/[a-z][a-z]/.test(s))return null;
   const parts=s.split(/[,;\n]/).map(x=>x.trim()).filter(Boolean);
   if(parts.length>2)return null;
   if(mode){ if(parts.length!==1||s.includes('='))return null;const e=parse(s),vs=[...vars(e)];if(vs.length!==1)return null;const v=vs[0];const d=deg(e,v);if(d>8)return null;for(const k of e.keys())if(/[a-z]\d+[a-z]/.test(k))return null;
    let r=new Map();
    for(let k=0;k<=d;k++){const c=coef(e,v,k);if(isz(c))continue;if(mode==='d'){if(k>0)r=padd(r,new Map([[mk(k-1?{[v]:k-1}:{}),mul(c,F(k))]]))}else r=padd(r,new Map([[mk({[v]:k+1}),dv(c,F(k+1))]]))}
    const rs=show(r,v);
    return mode==='d'?{direct:`f(${v}) = ${show(e,v)}\nf'(${v}) = ${rs}`,explained:`بنشتق كل حد لوحده: القوة بتنزل كمعامل وبننقص من الأس واحد (مثلاً x^n بتبقى n·x^(n-1))، والثابت مشتقته 0.\nالناتج: f'(${v}) = ${rs}`}
     :{direct:`∫ (${show(e,v)}) d${v} = ${rs} + C`,explained:`بنكامل كل حد لوحده: بنزود الأس واحد ونقسم على الأس الجديد (x^n بتبقى x^(n+1)/(n+1))، وبنضيف ثابت التكامل C.\nالناتج: ${rs} + C`}};
   // equations
   if(parts.length===1&&!s.includes('=')){ // numeric expression only
    const e=parse(s);if(!isC(e))return null;const r=cv(e);
    return {direct:`${s.replace(/\*/g,'×').replace(/\//g,'÷')} = ${fsd(r)}`,explained:`بنحسب التعبير بترتيب العمليات (الأقواس، ثم القوى، ثم الضرب والقسمة، ثم الجمع والطرح).\nالناتج: ${fsd(r)}`}}
   const eqs=parts.map(x=>{const sp=x.split('=');if(sp.length!==2||!sp[0].trim()||!sp[1].trim())throw 0;return padd(parse(sp[0]),pneg(parse(sp[1])))});
   if(eqs.length===1){
    const a=eqs[0],vs=[...vars(a)];
    if(vs.length===0){const z=a.size===0,hv=/[a-z]/.test(s);return {direct:z?(hv?'المعادلة صحيحة لأي قيمة (حلول لا نهائية)':'العبارة صحيحة'):(hv?'مفيش حل':'العبارة غير صحيحة'),explained:z?'بعد التبسيط الطرفين متساويين.':'بعد التبسيط بيطلع تناقض، يعني مفيش قيمة تحقق المعادلة.'}}
    if(vs.length!==1)return null;const v=vs[0],d=deg(a,v);
    for(const k of a.keys())if(/[a-z]\d+[a-z]/.test(k))return null;
    const ex=s.replace(/\*/g,'×');
    if(d===0)return null;
    if(d===1){const A=coef(a,v,1),B=coef(a,v,0),x=dv(neg(B),A);
     return {direct:`${ex}\n${show(a,v)} = 0\n${v} = ${fsd(x)}`,explained:`بننقل كل الحدود في طرف واحد ونبسط: ${show(a,v)} = 0.\nبعدين بنفصل المجهول: ${v} = ${fs(neg(B))} ÷ ${fs(A)}.\nيعني ${v} = ${fsd(x)}`}}
    if(d===2){const A=coef(a,v,2),B=coef(a,v,1),C=coef(a,v,0),D=sub(mul(B,B),mul(F(4),mul(A,C)));
     const head=`${show(a,v)} = 0\na = ${fs(A)}, b = ${fs(B)}, c = ${fs(C)}\nΔ = b² - 4ac = ${fs(D)}`;
     const exp=`بنحط المعادلة على الصورة a${v}² + b${v} + c = 0 ونحسب المميز Δ = b² - 4ac.`;
     if(D.n<0)return {direct:head+'\nΔ < 0 ⇒ مفيش جذور حقيقية',explained:exp+'\nلأن Δ أقل من الصفر، المعادلة ملهاش حل في مجموعة الأعداد الحقيقية.'};
     const A2=mul(F(2),A);
     if(isz(D)){const x=dv(neg(B),A2);return {direct:head+`\nΔ = 0 ⇒ ${v} = -b/2a = ${fsd(x)}`,explained:exp+`\nلأن Δ = 0 فيه جذر واحد مكرر: ${v} = -b ÷ 2a = ${fsd(x)}`}}
     const r=sqf(D);
     if(r){const x1=dv(add(neg(B),r),A2),x2=dv(sub(neg(B),r),A2);return {direct:head+`\n√Δ = ${fs(r)}\n${v} = (-b ± √Δ)/2a\n${v}₁ = ${fsd(x1)}\n${v}₂ = ${fsd(x2)}`,explained:exp+`\nΔ أكبر من الصفر وجذرها ${fs(r)}، فيه حلين بالقانون ${v} = (-b ± √Δ) ÷ 2a:\n${v}₁ = ${fsd(x1)}\n${v}₂ = ${fsd(x2)}`}}
     const sd=Math.sqrt(D.n/D.d),x1=(-B.n/B.d+sd)/(2*A.n/A.d),x2=(-B.n/B.d-sd)/(2*A.n/A.d),f4=z=>String(+z.toFixed(4));
     return {direct:head+`\n${v} = (${fs(neg(B))} ± √(${fs(D)})) / ${fs(A2)}\n${v}₁ ≈ ${f4(x1)}\n${v}₂ ≈ ${f4(x2)}`,explained:exp+`\nΔ أكبر من الصفر لكن مش مربع كامل، فالحلين بيطلعوا بجذر:\n${v} = (${fs(neg(B))} ± √(${fs(D)})) ÷ ${fs(A2)}\nتقريباً ${v}₁ ≈ ${f4(x1)} و ${v}₂ ≈ ${f4(x2)}`}}
    return null}
   // two equations
   const vs=new Set();eqs.forEach(e=>vars(e).forEach(x=>vs.add(x)));const vv=[...vs].sort();
   if(eqs.length!==2||vv.length!==2)return null;const[x,y]=vv;
   for(const e of eqs)for(const k of e.keys()){const o=pk(k),dg=Object.values(o).reduce((a,b)=>a+b,0);if(dg>1)return null}
   const a1=coef(eqs[0],x,1),b1=coef(eqs[0],y,1),c1=neg(coef(eqs[0],x,0)),a2=coef(eqs[1],x,1),b2=coef(eqs[1],y,1),c2=neg(coef(eqs[1],x,0));
   const L=e=>show(e,x).includes(y)?'':'';
   const cf=(c,v)=>(c.n===1&&c.d===1?'':c.n===-1&&c.d===1?'-':c.d===1?String(c.n):'('+fs(c)+')')+v;const lin=(a,b,c)=>`${cf(a,x)} ${b.n<0?'-':'+'} ${cf(b.n<0?neg(b):b,y)} = ${fs(c)}`;
   const Dt=sub(mul(a1,b2),mul(a2,b1));
   if(isz(Dt)){return {direct:'المعادلتين مفيش لهم حل وحيد (يا إما مفيش حل يا إما حلول لا نهائية)',explained:'محدد المعاملات = 0، يعني الخطين متوازيين أو منطبقين.'}}
   const X=dv(sub(mul(c1,b2),mul(c2,b1)),Dt),Y=dv(sub(mul(a1,c2),mul(a2,c1)),Dt);
   return {direct:`${lin(a1,b1,c1)}\n${lin(a2,b2,c2)}\n${x} = ${fsd(X)}\n${y} = ${fsd(Y)}`,explained:`بنحل المعادلتين مع بعض بالحذف: بنضرب المعادلتين في أرقام مناسبة عشان نخلي معامل ${y} (أو ${x}) متساوي ونطرحهم، فنطلع بمعادلة فيها مجهول واحد.\nبعدين بنعوض بقيمته في أي معادلة تانية.\nالحل: ${x} = ${fsd(X)} و ${y} = ${fsd(Y)}\nوتتأكد بالتعويض في المعادلتين.`};
  }catch(e){return null}
 }
 return {solve};
})();
const localSolve=t=>{try{return LM.solve(t)}catch(e){return null}};
async function solveC(text,image,opt){opt=opt||{};
 if(!opt.detect&&!opt.forceGroq&&!image&&text){const L=localSolve(text);if(L){const t=st();t.loc=(t.loc||0)+1;return {direct:L.direct,explained:L.explained,cached:true,local:true}}}
 if(opt.detect){const o=await solve(text,image,opt);if(o.error){st().fail++;if(o.error==='ai_busy')st().quota++}else st().det++;return o}
 const k=opt.forceGroq?null:cacheKey(text,image,opt.pick);
 if(k&&db.cache&&db.cache[k]){const c=db.cache[k];c.h=(c.h||0)+1;st().hits++;return {direct:c.d,explained:c.e,cached:true}}
 const o=await solve(text,image,opt);
 if(o.error){if(o.error!=='empty'){st().fail++;if(o.error==='ai_busy')st().quota++}}
 else{st().ai++;if(k&&!o.truncated&&o.direct!=='UNREADABLE'&&(o.direct||o.explained)){db.cache=db.cache||{};db.cache[k]={d:o.direct,e:o.explained,t:Date.now(),h:0};const ks=Object.keys(db.cache);if(ks.length>3000){ks.sort((a,b)=>db.cache[a].t-db.cache[b].t).slice(0,ks.length-3000).forEach(x=>delete db.cache[x])}}}
 return o}
async function solve(text,image,opt){
 opt=opt||{};
 if(!GEMINI_API_KEY) return {error:'ai_not_configured'};
 const m=/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(image||'');
 if(!text&&!m) return {error:'empty'};
 const img=m?[{inline_data:{mime_type:m[1],data:m[2]}}]:[];
 const call=(parts,gc,ms,mdl)=>fetch((process.env.GEMINI_BASE||'https://generativelanguage.googleapis.com')+'/v1beta/models/'+(mdl||GEMINI_MODEL)+':generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':GEMINI_API_KEY},body:JSON.stringify({contents:[{parts}],generationConfig:gc}),signal:AbortSignal.timeout(ms||85000)});
 const MODELS=[GEMINI_MODEL,...(process.env.GEMINI_FALLBACKS||'gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite').split(',').map(x=>x.trim()).filter(x=>x&&x!==GEMINI_MODEL)];
 const run=async(parts,tok,think,ms)=>{const one=async(mdl)=>{try{let r=await call(parts,think?{thinkingConfig:{thinkingLevel:think},maxOutputTokens:tok}:{maxOutputTokens:tok},ms,mdl);if(r.status===400)r=await call(parts,{maxOutputTokens:tok},ms,mdl);const j=await r.json().catch(()=>({}));return {r,j}}catch(e){return {r:{ok:false,status:0},j:{}}}};
  let x,first=null;for(const m of MODELS){x=await one(m);if(x.r.ok)return x;if(!first)first=x;if(![429,503,500,404].includes(x.r.status))break}x=first;
  if(!x.r.ok&&(x.r.status===429||x.r.status===503)){await new Promise(z=>setTimeout(z,3000));x=await one(MODELS[0])}return x};
 let gdet='';const aiErr=(r,j)=>({groq:gdet||undefined,model:GEMINI_MODEL,error:(r.status===429||r.status===503)?'ai_busy':r.status===0?'ai_timeout':'ai_failed',status:r.status,detail:(j.error&&j.error.message||'').slice(0,200)});
 const textOf=j=>((j.candidates||[])[0]?.content?.parts||[]).map(p=>p.text||'').join('');
 if(opt.detect){
  const {r,j}=await run([{text:'Look at the image. List every separate math problem or question you can see, in the order they appear (top to bottom). Reply with ONLY JSON, no other text, in this shape: {"problems":[{"n":1,"text":"<full transcription of that problem, max 280 characters, English digits and symbols>"}]}. If there is only one problem, or the image is unreadable, return at most one entry.'},...img],3000,'low',30000);
  if(!r.ok) return aiErr(r,j);
  const t=textOf(j).replace(/```json|```/g,'').trim();let pr=[];try{pr=(JSON.parse(t).problems||[]).slice(0,30).map((x,i)=>({n:+x.n||i+1,text:String(x.text||'').slice(0,300)}))}catch(e){}
  return {problems:pr};
 }
 const parts=[{text:'You are a math teacher for Egyptian students. Solve the problem in the text and/or image. FORMATTING RULES: write math as plain Unicode text only. Never use LaTeX, never use $ or backslash commands, never use markdown. Use real symbols: ∴ (therefore), ∵ (because), ∠ (angle), △ (triangle), ∥ (parallel), ⊥ (perpendicular), π, √, ≤ ≥ ≠ ≈, ×, ÷, ±, °, ∈, ∞, ⇒, ², ³, superscripts/subscripts as Unicode, and write fractions like (a)/(b) or a/b. Reply in exactly this format:\nDIRECT:\n<the short final solution steps; use English digits and math symbols only, no Arabic words>\nEXPLAINED:\n<step by step explanation in simple Egyptian Arabic; keep all numbers, variables and symbols in English>\nIf the image is not a math problem or is unreadable, reply with DIRECT:\nUNREADABLE\nEXPLAINED:\nالصورة مش واضحة'}];
 if(opt.pick&&opt.pick.n) parts.push({text:'The image has several problems. Solve ONLY problem number '+(+opt.pick.n)+(opt.pick.text?' (it starts with: '+String(opt.pick.text).slice(0,300)+')':'')+'. Ignore every other problem in the image.'});
 if(text) parts.push({text:'Problem text: '+text});
 parts.push(...img);
 let {r,j}=opt.forceGroq?{r:{ok:false,status:429},j:{}}:await run(parts,8000,'low');
 if(!r.ok&&!m&&process.env.GROQ_API_KEY&&[429,503,500,0].includes(r.status)){try{const gr=await fetch((process.env.GROQ_BASE||'https://api.groq.com')+'/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.GROQ_API_KEY},body:JSON.stringify({model:process.env.GROQ_MODEL||'openai/gpt-oss-120b',messages:[{role:'user',content:parts.map(x=>x.text).filter(Boolean).join('\n\n')}],max_tokens:6000,reasoning_effort:'low'}),signal:AbortSignal.timeout(60000)});const gj=await gr.json().catch(()=>({}));gdet=gr.ok?'ok-no-content':gr.status+' '+String(gj.error&&gj.error.message||'').slice(0,160);const gt=gj.choices&&gj.choices[0]&&gj.choices[0].message&&gj.choices[0].message.content;if(gr.ok&&gt){const g2=/DIRECT:\s*([\s\S]*?)\s*EXPLAINED:\s*([\s\S]*)/i.exec(gt);st().groq=(st().groq||0)+1;return g2?{direct:g2[1].trim(),explained:g2[2].trim()}:{direct:'',explained:gt.trim()}}}catch(e){gdet='exc '+String(e.message).slice(0,80)}}
 let fin=(j.candidates||[])[0]?.finishReason;
 if(r.ok&&fin==='MAX_TOKENS'){const x=await run(parts,16000,'low');if(x.r.ok){r=x.r;j=x.j;fin=(j.candidates||[])[0]?.finishReason}}
 if(!r.ok) return aiErr(r,j);
 const t=textOf(j);
 const mm=/DIRECT:\s*([\s\S]*?)\s*EXPLAINED:\s*([\s\S]*)/i.exec(t);
 const out=mm?{direct:mm[1].trim(),explained:mm[2].trim()}:{direct:'',explained:t.trim()};
 if(fin==='MAX_TOKENS') out.truncated=true;
 return out;
}
const XL=(()=>{
const T=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;T[n]=c>>>0}
const crc=b=>{let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=T[(c^b[i])&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0};
function zip(files){const parts=[],cd=[];let off=0;
 for(const [name,data] of files){const nb=Buffer.from(name),d=Buffer.from(data),c=crc(d);
  const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(0x0800,6);h.writeUInt16LE(0,8);h.writeUInt16LE(0,10);h.writeUInt16LE(0x21,12);h.writeUInt32LE(c,14);h.writeUInt32LE(d.length,18);h.writeUInt32LE(d.length,22);h.writeUInt16LE(nb.length,26);h.writeUInt16LE(0,28);
  parts.push(h,nb,d);
  const e=Buffer.alloc(46);e.writeUInt32LE(0x02014b50,0);e.writeUInt16LE(20,4);e.writeUInt16LE(20,6);e.writeUInt16LE(0x0800,8);e.writeUInt16LE(0,10);e.writeUInt16LE(0,12);e.writeUInt16LE(0x21,14);e.writeUInt32LE(c,16);e.writeUInt32LE(d.length,20);e.writeUInt32LE(d.length,24);e.writeUInt16LE(nb.length,28);e.writeUInt32LE(off,42);
  cd.push(e,nb);off+=30+nb.length+d.length}
 const cb=Buffer.concat(cd),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(cb.length,12);end.writeUInt32LE(off,16);
 return Buffer.concat([...parts,cb,end])}
const esc=s=>String(s==null?'':s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const col=i=>{let s='';i++;while(i>0){const m=(i-1)%26;s=String.fromCharCode(65+m)+s;i=Math.floor((i-1)/26)}return s};
function sheet(rows,widths){
 let x='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>'+widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')+'</cols><sheetData>';
 rows.forEach((r,ri)=>{x+=`<row r="${ri+1}">`+r.map((v,ci)=>{const ref=col(ci)+(ri+1),st=ri==0?' s="1"':'';if(typeof v==='number'&&isFinite(v))return `<c r="${ref}"${st}><v>${v}</v></c>`;return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`}).join('')+'</row>'});
 return x+'</sheetData></worksheet>'}
function build(sheets){ // sheets:[{name,rows,widths}]
 const files=[['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+sheets.map((s,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')+'</Types>'],
 ['_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
 ['xl/workbook.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+sheets.map((s,i)=>`<sheet name="${esc(s.name).slice(0,31)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')+'</sheets></workbook>'],
 ['xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+sheets.map((s,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')+`<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
 ['xl/styles.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF7C3AED"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>']];
 sheets.forEach((s,i)=>files.push([`xl/worksheets/sheet${i+1}.xml`,sheet(s.rows,s.widths)]));
 return zip(files)}
return {build}})();
const fdate=t=>{try{return new Date(t).toISOString().slice(0,10)}catch(e){return ''}};
function exportSheets(M,codes){
 const DAYS=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
 const gs=M.groups||[],att=M.att||{},pay=M.pay||{};
 const rG=[['المجموعة','المصروف الشهري','عدد الطلاب','المواعيد']],rS=[['المجموعة','الاسم','الموبايل','الكود','عدد الدرجات']],rP=[['المجموعة','الطالب','الموبايل','الشهر','الحالة','تاريخ الدفع']],rA=[['المجموعة','الطالب','الموبايل','التاريخ','الحالة']],rD=[['المجموعة','الطالب','الموبايل','الاختبار','الدرجة','من','التاريخ']],rC=[['الكود','الاسم','الموبايل','الحالة','تاريخ الإنشاء']];
 for(const g of gs){
  rG.push([g.name,g.fee||0,(g.students||[]).length,(g.sched||[]).map(s=>DAYS[s.day]+' '+s.time).join(' | ')]);
  const months=[...new Set(Object.keys(pay).filter(k=>k.startsWith(g.id+'|')).map(k=>k.slice(g.id.length+1)))].sort();
  const dates=Object.keys(att).filter(k=>k.startsWith(g.id+'|')).map(k=>k.slice(g.id.length+1)).sort();
  for(const s of g.students||[]){
   rS.push([g.name,s.name,s.phone||'',s.code||'',(g.exams||[]).filter(e=>s.id in (e.scores||{})).length]);
   for(const m of months){const d=(pay[g.id+'|'+m]||{})[s.id];rP.push([g.name,s.name,s.phone||'',m,d?'دفع':'لم يدفع',d&&d!==''?String(d):''])}
   for(const d of dates){const st=(att[g.id+'|'+d]||{})[s.id];if(st)rA.push([g.name,s.name,s.phone||'',d,st==='present'?'حضر':'غاب'])}
   for(const e of g.exams||[]){if(s.id in (e.scores||{})){const v=e.scores[s.id];rD.push([g.name,s.name,s.phone||'',e.title,v==='abs'?'غايب':v,e.max||'',fdate(e.date)])}}
  }}
 for(const c of codes||[])rC.push([c.code,(c.student&&c.student.name)||c.label||'',(c.student&&c.student.phone)||'',c.disabled?'موقوف':'شغال',fdate(c.created)]);
 return [{name:'المجموعات',rows:rG,widths:[24,16,12,40]},{name:'الطلاب',rows:rS,widths:[22,26,16,14,12]},{name:'الدفع',rows:rP,widths:[22,26,16,12,12,14]},{name:'الحضور',rows:rA,widths:[22,26,16,14,10]},{name:'الدرجات',rows:rD,widths:[22,26,16,24,10,10,14]},{name:'الأكواد',rows:rC,widths:[14,26,16,12,14]}]}

const EXT={},ADM_TTL=90*86400e3,RLI={},RLU={};
const rlIp=q=>String((q.headers['x-forwarded-for']||q.socket.remoteAddress||'')).split(',')[0].trim().slice(0,60);
const rlHit=(m,k,max,win)=>{const e=m[k];const n=Date.now();if(!e||n-e.t>win){return false}return e.n>=max};
const rlFail=(m,k,win)=>{const n=Date.now(),e=m[k];if(!e||n-e.t>win)m[k]={n:1,t:n};else e.n++;if(Object.keys(m).length>2000)for(const x of Object.keys(m))if(n-m[x].t>win)delete m[x]};
const srv=http.createServer(async(q,r)=>{
 const u=new URL(q.url,'http://x'),p=u.pathname;let tok=(q.headers.authorization||'').replace('Bearer ','');
 if(!tok&&p==='/api/export'){const tk=EXT[u.searchParams.get('t')||''];if(tk&&tk.exp>Date.now())tok=tk.tok}
 let sess=db.sessions[tok];
 if(sess&&sess.role==='admin'){const nw=Date.now();if(sess.seen&&nw-sess.seen>ADM_TTL){delete db.sessions[tok];sess=null}else if(!sess.seen||nw-sess.seen>3600e3)sess.seen=nw}
 const isAdmin=sess&&sess.role==='admin',isStudent=sess&&sess.role==='student';
 if(isAdmin&&q.method==='POST'&&p.startsWith('/api/'))r.wt=true;
 try{
 if(p==='/api/export'){if(!isAdmin){r.writeHead(401);return r.end('login required')}
  const M=WS(uOf(sess)),mine=new Set(M.groups.flatMap(g=>g.students.map(s=>s.code).filter(Boolean))),day=new Date().toISOString().slice(0,10);
  if(u.searchParams.get('fmt')==='json'){r.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="backup-'+day+'.json"','Cache-Control':'no-store'});return r.end(JSON.stringify({exported:Date.now(),workspace:M,codes:db.codes.filter(c=>mine.has(c.code))}))}
  const buf=XL.build(exportSheets(M,db.codes.filter(c=>mine.has(c.code))));r.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="backup-'+day+'.xlsx"','Cache-Control':'no-store'});return r.end(buf)}
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
   if(b.image&&String(b.image).length>6e6) return cj(413,{error:'too_big'});
   const stx=det?'':String(b.text||'').slice(0,3000),hit2=det?null:getHit(stx,b.image,b.pick);
   if(!hit2){
   if(SL.all+w>SOLVER_DAY_ALL||capHit()) return cj(429,{error:'busy'});
   if((SL.dev[dev]||0)+w>SOLVER_DAY_DEV*3||(SL.ip[ip]||0)+w>SOLVER_DAY_IP*3) return cj(429,{error:'daily_limit'});}
   const out=await solveC(stx,b.image,det?{detect:true}:{pick:b.pick,forceGroq:b.provider==='groq'&&!b.image});
   if(!out.error&&!out.cached){SL.all+=w;SL.dev[dev]=(SL.dev[dev]||0)+w;SL.ip[ip]=(SL.ip[ip]||0)+w}
   save();
   return cj(out.error==='empty'?400:out.error?502:200,out);}
  if(p==='/api/status') return json(r,200,{open:!!db.settings.open,closed:!!db.settings.closed});
  if(p==='/api/signup'&&q.method==='POST'){
   const b=await body(q);
   if(db.settings.closed) return json(r,423,{error:'closed'});
   if(!db.settings.open) return json(r,403,{error:'signup off'});
   const dv=String(b.device||'').slice(0,40);
   const lg0=String(b.legacy||'').slice(0,40);
   if(dv){const prev=db.codes.find(x=>x.single&&(x.gdev===dv||(lg0&&x.gdev===lg0))&&!x.disabled);if(prev){prev.gdev=dv;db.codes.length;Object.entries(db.sessions).filter(([k,x])=>x.role==='student'&&x.code===prev.code).forEach(([k])=>delete db.sessions[k]);const t0=id()+id();db.sessions[t0]={role:'student',code:prev.code,device:dv};save();return json(r,200,{token:t0,role:'student',registered:!!prev.student,code:prev.code,again:true});}}
   const ip=String(q.headers['x-forwarded-for']||q.socket.remoteAddress||'').split(',')[0].trim(),hr=Math.floor(Date.now()/3600000);
   SIGN[ip+hr]=(SIGN[ip+hr]||0)+1; if(SIGN[ip+hr]>10) return json(r,429,{error:'too many'});
   const c={code:newCode(),label:'تسجيل مفتوح',maxDevices:0,single:true,gdev:String(b.device||'').slice(0,40),devices:[],disabled:false,created:Date.now()};db.codes.push(c);
   const t=id()+id();db.sessions[t]={role:'student',code:c.code,device:String(b.device||'')};save();return json(r,200,{token:t,role:'student',registered:false,code:c.code});}
  if(p==='/api/logout'&&q.method==='POST'){delete db.sessions[tok];save();return json(r,200,{ok:1});}
  if(p==='/api/import-once'&&process.env.IMPORT_TOKEN){
   const tk=String(u.searchParams.get('k')||''),T=process.env.IMPORT_TOKEN;
   if(tk.length!==T.length||!require('crypto').timingSafeEqual(Buffer.from(tk),Buffer.from(T)))return json(r,404,{error:'not found'});
   const admins=[...new Set([...ENVADM.map(a=>String(a[0]).toLowerCase()),...(db.admins||[]).map(a=>String(a.user).toLowerCase()),...Object.keys(db.ws||{})])];
   if(q.method==='GET')return json(r,200,{admins:admins.length,done:!!db.importDone,ws:Object.fromEntries(admins.map(a=>[a,{to:wsId(a),groups:((db.ws[wsId(a)]||{}).groups||[]).length,students:((db.ws[wsId(a)]||{}).groups||[]).reduce((n,g)=>n+(g.students||[]).length,0)}]))});
   if(q.method==='POST'){
    if(db.importDone)return json(r,409,{error:'done'});
    const b=await body(q);const to=wsId(String(b.to||'').toLowerCase());
    if(!admins.includes(String(b.to||'').toLowerCase())||!b.ws||!Array.isArray(b.ws.groups))return json(r,400,{error:'bad'});
    const M=WS(String(b.to).toLowerCase());const before=JSON.parse(JSON.stringify(M));
    if(b.wipe){M.groups=[];M.att={};M.pay={}}const have=new Set();for(const g of M.groups)have.add(g.id);
    let ng=0,ns=0,na=0,np=0,nc=0,nph=0;const gm={};
    for(const g of b.ws.groups){if(have.has(g.id))continue;const G={id:g.id,name:String(g.name||'').slice(0,80),fee:Math.max(0,+g.fee||0),students:[],exams:[],sched:[]};
     for(const s of g.students||[]){const st={id:s.id,name:String(s.name||'').slice(0,80),phone:String(s.phone||'').replace(/[^0-9]/g,'').slice(0,20),photo:null};if(s.photoData){const f=saveImg(s.photoData);if(f){st.photo=f;nph++}}G.students.push(st);ns++}
     for(const x of g.sched||[]){G.sched.push({id:x.id,day:+x.day,time:String(x.time),dur:+x.dur||60});nc++}
     M.groups.push(G);ng++}
    for(const k of Object.keys(b.ws.att||{})){if(!M.att[k]){M.att[k]=b.ws.att[k];na+=Object.keys(b.ws.att[k]).length}}
    for(const k of Object.keys(b.ws.pay||{})){if(!M.pay[k]){M.pay[k]=b.ws.pay[k];np+=Object.keys(b.ws.pay[k]).length}}
    db.importDone=Date.now();save();
    const ok=FB.on?await FB.sync():true;
    return json(r,200,{ok,groups:ng,students:ns,att:na,pay:np,sched:nc,photos:nph,before});}
  }
  if(p==='/api/login'&&q.method==='POST'){
   const b=await body(q);
   if(b.role==='admin'){ const un=String(b.username||'').trim().toLowerCase().slice(0,60);let who=null;const ip=rlIp(q),WIN=15*60e3;
     if(rlHit(RLI,ip,8,WIN)||rlHit(RLU,un,40,WIN)){return json(r,429,{error:'too many attempts'})}
     for(const [u,p] of ENVADM)if(seq(u.toLowerCase(),un)&seq(p,b.password||''))who=u;
     for(const a of (db.admins||[]))if(a.user===un&&seq(a.hash,hashPw(b.password||'',a.salt)))who=a.user;
     if(!who){rlFail(RLI,ip,WIN);rlFail(RLU,un,WIN);await new Promise(z=>setTimeout(z,500));return json(r,401,{error:'bad credentials'})}
     delete RLI[ip];
     const t=id()+id();db.sessions[t]={role:'admin',user:who,seen:Date.now()};save();return json(r,200,{token:t,role:'admin'});}
   const c=db.codes.find(x=>x.code===String(b.code||'').trim().toUpperCase());
   if(!c||c.disabled) return json(r,401,{error:'invalid code'});
   if(db.settings.closed) return json(r,423,{error:'closed'});
   {const lg=String(b.legacy||'').slice(0,40),nw=String(b.device||'').slice(0,40);if(lg&&nw&&lg!==nw){c.devices=[...new Set((c.devices||[]).map(d=>d===lg?nw:d))];if(c.gdev===lg)c.gdev=nw;for(const k of Object.keys(db.sessions)){const x=db.sessions[k];if(x.role==='student'&&x.code===c.code&&x.device===lg)x.device=nw}}}
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
   const photo=b.photo?saveImg(b.photo):null;
   const nm=x=>String(x||'').replace(/\D/g,'').slice(-10);
   const old=(me.single&&!me.student)?db.codes.find(x=>x!==me&&x.single&&x.student&&!x.disabled&&nm(x.student.phone)&&nm(x.student.phone)===nm(phone)):null;
   if(old){ // same phone registered before (e.g. app data was cleared): give back the existing code, never a second one
    for(const k of Object.keys(db.sessions))if(db.sessions[k].role==='student'&&(db.sessions[k].code===old.code||db.sessions[k].code===me.code))delete db.sessions[k];
    db.codes=db.codes.filter(x=>x!==me);old.gdev=me.gdev||old.gdev;old.student.name=name;if(photo)old.student.photo=photo;old.restored=Date.now();
    const t2=id()+id();db.sessions[t2]={role:'student',code:old.code,device:String(sess.device||'')};save();return json(r,200,{ok:1,restored:true,token:t2,code:old.code});}
   me.student={name,phone,photo,date:Date.now()};save();return json(r,200,{ok:1});}
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
   if(b.detect){const dk='d'+k;db.solves[dk]=(db.solves[dk]||0);if(isStudent&&db.solves[dk]>=listLimit())return json(r,429,{error:'daily_limit'});if(capHit())return json(r,429,{error:'busy'});const o2=await solveC('',b.image,{detect:true});if(!o2.error){db.solves[dk]++}save();return json(r,o2.error?502:200,o2);}
   const txt=String(b.text||'').slice(0,3000),hit=getHit(txt,b.image,b.pick);
   if(!hit){if(isStudent&&db.solves[k]>=perStudent()) return json(r,429,{error:'daily_limit',limit:perStudent()});if(capHit())return json(r,429,{error:'busy'})}
   const out=await solveC(txt,b.image,{pick:b.pick});
   if(!out.error&&!out.cached){db.solves[k]++;for(const o in db.solves) if(!o.endsWith(day())&&!o.endsWith(day()+'')) delete db.solves[o]}
   save();
   return json(r,out.error==='empty'?400:out.error?502:200,out);}
  if(p==='/api/security-event'&&isStudent&&q.method==='POST'){
   const b=await body(q);db.logs.unshift({date:Date.now(),code:me.code,name:me.student?me.student.name:'',phone:me.student?me.student.phone:'',type:String(b.type||'screenshot').slice(0,30),where:String(b.where||'').slice(0,80),posts:Array.isArray(b.posts)?b.posts.slice(0,4).map(x=>({id:String((x&&x.id)||'').slice(0,40),title:String((x&&x.title)||'').slice(0,40),text:String((x&&x.text)||'').slice(0,30),pct:+(x&&x.pct)||0,at:+(x&&x.at)||0})):[]});db.logs=db.logs.slice(0,500);save();return json(r,200,{ok:1});}
  if(p==='/api/my-grades'&&isStudent){let st=null,gn='',gg=null;for(const g of allGroups()){st=g.students.find(x=>x.code===me.code);if(st){gn=g.name;gg=g;break}}if(!st)return json(r,200,{linked:false,grades:[]});const gl=(gg.exams||[]).filter(e=>st.id in (e.scores||{})).map(e=>{const v=e.scores[st.id];return v==='abs'?{id:e.id,title:e.title,score:'غايب',max:'',date:e.date}:{id:e.id,title:e.title,score:v,max:e.max?e.max:'',date:e.date}}).sort((a,b)=>b.date-a.date);return json(r,200,{linked:true,name:st.name,group:gn,grades:gl});}
  if(!isAdmin) return json(r,403,{error:'admin only'});
  if(p==='/api/export-ticket'&&q.method==='POST'){const tk=id()+id();EXT[tk]={tok,exp:Date.now()+90e3};for(const k of Object.keys(EXT))if(EXT[k].exp<Date.now())delete EXT[k];return json(r,200,{t:tk});}
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
  if(p==='/api/codes/maxdev'){const b=await body(q);const c=db.codes.find(x=>x.code===b.code);if(!c)return json(r,404,{error:'code'});if(b.reset)c.devices=[];else{const n=Math.max(1,Math.min(20,Math.floor(+b.max||1)));c.maxDevices=n;if(c.single&&n>1){c.single=false;if(!(c.devices||[]).length&&c.gdev)c.devices=[c.gdev]}}save();return json(r,200,{ok:1,maxDevices:c.maxDevices,devices:c.devices.length});}
  if(p==='/api/codes/toggle'){const b=await body(q);const c=db.codes.find(x=>x.code===b.code);if(c){c.disabled=!c.disabled;save()}return json(r,200,{ok:1});}
  if(p==='/api/codes/delete'){const b=await body(q);db.codes=db.codes.filter(x=>x.code!==b.code);save();return json(r,200,{ok:1});}
  if(p==='/api/student-photo'){const c=db.codes.find(x=>x.code===u.searchParams.get('code'));if(!c||!c.student||!c.student.photo)return json(r,404,{error:'none'});const f=path.join(UP,path.basename(c.student.photo));r.writeHead(200,{'Content-Type':types[path.extname(f)]||'image/jpeg'});return fs.createReadStream(f).pipe(r);}
  if(p==='/api/solve-admin'&&q.method==='GET'){const ks=Object.keys(db.stats||{}).sort().slice(-7).reverse();return json(r,200,{cfg:{perStudent:db.settings.perStudent||0,listLimit:db.settings.listLimit||0,globalCap:db.settings.globalCap||0},defaults:{perStudent:SOLVE_PER_DAY,listLimit:40},today:st(),days:ks.map(d=>({d,...db.stats[d]})),cacheSize:Object.keys(db.cache||{}).length,cacheHitsTotal:Object.values(db.cache||{}).reduce((a,c)=>a+(c.h||0),0)});}
  if(p==='/api/solve-admin'&&q.method==='POST'){const b=await body(q);const cl=(v,m)=>Math.max(0,Math.min(m,Math.floor(+v||0)));if('perStudent' in b)db.settings.perStudent=cl(b.perStudent,500);if('listLimit' in b)db.settings.listLimit=cl(b.listLimit,500);if('globalCap' in b)db.settings.globalCap=cl(b.globalCap,100000);if(b.clearCache)db.cache={};save();return json(r,200,{ok:1});}
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
   else if(b.op==='moveStudent'){const st=g.students.find(x=>x.id===b.sid),t=M.groups.find(x=>x.id===b.to);if(!st||!t||t===g)return json(r,400,{error:'group'});g.students=g.students.filter(x=>x!==st);t.students.push(st);t.exams=t.exams||[];for(const e of g.exams||[]){if(!(b.sid in (e.scores||{})))continue;const mx=+e.max||0;let ne=t.exams.find(x=>x.title===e.title&&(+x.max||0)===mx&&dkey(x.date)===dkey(e.date));if(!ne){ne={id:id(),title:e.title,max:mx,date:e.date,scores:{}};t.exams.push(ne)}if(b.sid in ne.scores)continue;ne.scores[b.sid]=e.scores[b.sid];delete e.scores[b.sid]}for(const T of [M.att,M.pay])for(const k of Object.keys(T)){if(!k.startsWith(g.id+'|')||!T[k]||!(b.sid in T[k]))continue;const nk=t.id+'|'+k.slice(g.id.length+1);T[nk]=T[nk]||{};T[nk][b.sid]=T[k][b.sid];delete T[k][b.sid];if(!Object.keys(T[k]).length)delete T[k];}}
   else if(b.op==='delStudent'){g.students=g.students.filter(x=>x.id!==b.sid);for(const e of g.exams||[])delete (e.scores||{})[b.sid];}
   else if(b.op==='editStudent'){const st=g.students.find(x=>x.id===b.sid);if(!st||!S(b.name))return json(r,400,{error:'student'});st.name=S(b.name);st.phone=String(b.phone||'').replace(/[^0-9]/g,'').slice(0,20);if(b.photo){const f=saveImg(b.photo);if(f)st.photo=f}else if(b.rmPhoto)st.photo=null;}
   else if(b.op==='reorder'){const o=Array.isArray(b.order)?b.order:[];const mp=new Map(g.students.map(x=>[x.id,x]));const ns=[];for(const i of o)if(mp.has(i)){ns.push(mp.get(i));mp.delete(i)}for(const x of mp.values())ns.push(x);g.students=ns;}
   else if(b.op==='linkCode'){const st=g.students.find(x=>x.id===b.sid);const c=db.codes.find(x=>x.code===String(b.code||'').trim().toUpperCase());if(!st)return json(r,400,{error:'student'});if(!c)return json(r,400,{error:'الكود غير موجود'});if(allGroups().some(x=>x.students.some(y=>y.code===c.code&&y!==st)))return json(r,400,{error:'الكود مربوط بطالب تاني'});st.code=c.code;}
   else if(b.op==='newCode'){const st=g.students.find(x=>x.id===b.sid);if(!st)return json(r,400,{error:'student'});if(st.code)return json(r,400,{error:'مربوط بكود بالفعل'});const c={code:newCode(),label:st.name,maxDevices:1,devices:[],disabled:false,created:Date.now(),student:{name:st.name,phone:st.phone,photo:st.photo||null,date:Date.now()}};db.codes.push(c);st.code=c.code;}
   else if(b.op==='unlink'){const st=g.students.find(x=>x.id===b.sid);if(st)delete st.code;}
   else if(b.op==='addExam'){const t=S(b.title);if(!t)return json(r,400,{error:'اكتب اسم الامتحان'});const mx=+b.max;if(!(mx>0))return json(r,400,{error:'اكتب الدرجة النهائية'});g.exams=g.exams||[];g.exams.push({id:id(),title:t,max:mx,date:Date.now(),scores:{}});}
   else if(b.op==='editExam'){const e=(g.exams||[]).find(x=>x.id===b.xid);if(!e)return json(r,404,{error:'exam'});const t=S(b.title),mx=+b.max;if(!t)return json(r,400,{error:'اكتب اسم الامتحان'});if(!(mx>0))return json(r,400,{error:'اكتب الدرجة النهائية'});if(Object.values(e.scores||{}).some(v=>typeof v==='number'&&v>mx))return json(r,400,{error:'فيه درجات أكبر من الدرجة النهائية الجديدة'});e.title=t;e.max=mx;}
   else if(b.op==='delExam'){g.exams=(g.exams||[]).filter(x=>x.id!==b.xid);}
   else if(b.op==='setScore'){const e=(g.exams||[]).find(x=>x.id===b.xid);if(!e||!g.students.some(x=>x.id===b.sid))return json(r,404,{error:'exam'});e.scores=e.scores||{};const v=String(b.score==null?'':b.score).trim();if(v==='')delete e.scores[b.sid];else if(v==='abs')e.scores[b.sid]='abs';else{const n=+v;if(!isFinite(n)||n<0)return json(r,400,{error:'درجة غير صحيحة'});if(e.max>0&&n>e.max)return json(r,400,{error:'الدرجة أكبر من الدرجة النهائية ('+e.max+')'});e.scores[b.sid]=n}}
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
});
(async()=>{try{if(FB.on){let ok=false,er;for(let i=0;i<4&&!ok;i++){try{await FB.load(UP,db);ok=true}catch(e){er=e;await new Promise(r=>setTimeout(r,3000))}}if(!ok){FB.freeze();throw er}db.ws=db.ws||{};db.wsOf=db.wsOf||{};console.log('storage: firestore')}else console.log('storage: local file')}catch(e){console.log('firestore load failed:',e.message)}
srv.listen(PORT,()=>console.log('http://localhost:'+PORT))})();

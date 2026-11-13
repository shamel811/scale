(function(){
'use strict';
document.documentElement.lang='ar';document.documentElement.dir='rtl';
const $=(s,r)=>(r||document).querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nf=new Intl.NumberFormat('en-US',{maximumFractionDigits:2});
const nf3=new Intl.NumberFormat('en-US',{maximumFractionDigits:3});
const money=n=>nf.format(Math.round((+n||0)*100)/100);
const qn=n=>nf3.format(Math.round((+n||0)*1000)/1000);
const N=v=>'<span class="num">'+v+'</span>';
const pad=n=>String(n).padStart(2,'0');
const isoDate=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const today=()=>isoDate(new Date());
const fd=s=>{if(!s)return '—';const p=s.split('-');return p[2]+'/'+p[1]};
const PAYS=['نقدي','بطاقة','تحويل','آجل'];
const uid_=()=>Math.random().toString(36).slice(2,10);

const S={menu:[],raws:[],recipes:{},customers:[],salesBy:{},purchases:{},expenses:{},payments:{},staff:[],names:{},ready:{},err:null};
const ui={tab:'home',preset:'all',from:'',to:'',stock:'raw',q:'',cust:null,cat:'items',recItem:'',edit:null,sq:'',sqs:''};
const F={
  sale:{date:today(),cust:'',pay:'نقدي',note:'',cart:[],cat:'الكل',q:''},
  purch:{date:today(),sup:'',inv:'',pay:'',rows:[{kind:'item',code:'',qty:'',total:''}]},
  exp:{date:today(),type:'',desc:'',amount:'',pay:'نقدي'},
  pay:{date:today(),cust:'',amount:'',method:'نقدي',note:''}
};
let db=null,user=null,uid=null,role='viewer',busy=false;
const subs={};

/* ---------- tiny helpers ---------- */
function toast(m){const t=$('#toast');t.textContent=m;t.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(()=>{t.hidden=true},2600)}
let rq=false;
function sched(){if(rq)return;rq=true;requestAnimationFrame(()=>{rq=false;const a=document.activeElement;
  if(a&&/INPUT|SELECT|TEXTAREA/.test(a.tagName)&&$('#root').contains(a)){sched.pending=true;return}
  render()})}
document.addEventListener('focusout',()=>{setTimeout(()=>{const a=document.activeElement;if(sched.pending&&!(a&&/INPUT|SELECT|TEXTAREA/.test(a.tagName))){sched.pending=false;render()}},50)});
window.MZ_render=sched;
let chain=Promise.resolve();
function enqueue(fn){chain=chain.then(fn).catch(e=>{console.error(e);toast('تعذر الحفظ: '+(e&&e.message||e&&e.code||'خطأ'))});return chain}
function getPath(o,p){return p.split('.').reduce((a,k)=>a&&a[k],o)}
function setPath(o,p,v){const k=p.split('.');const l=k.pop();const t=k.reduce((a,x)=>a[x],o);t[l]=v}

/* ---------- data subscriptions ---------- */
function subDoc(path,cb){if(subs[path])return;subs[path]=db.doc(path).onSnapshot(s=>{cb(s.exists?s.data():null);S.ready[path]=1;sched()},e=>{S.err=e&&e.code;S.ready[path]=1;sched()})}
function subCol(path,cb){if(subs[path])return;subs[path]=db.collection(path).onSnapshot(snap=>{cb(snap);S.ready[path]=1;sched()},e=>{S.err=e&&e.code;S.ready[path]=1;sched()})}
const mapDocs=(snap,base)=>{const o={};snap.docs.forEach(d=>{o[d.id]=Object.assign({},d.data(),{_id:d.id,_path:base+'/'+d.id})});return o};
function watchSales(who){subCol('sales/'+who+'/lines',snap=>{S.salesBy[who]=mapDocs(snap,'sales/'+who+'/lines')})}
async function start(){
  subDoc('menu/items',d=>{S.menu=(d&&d.list)||[]});
  subDoc('lookup/customers',d=>{S.customers=(d&&d.names)||[]});
  if(role==='manager'){
    subDoc('catalog/raws',d=>{S.raws=(d&&d.list)||[]});
    subDoc('catalog/recipes',d=>{S.recipes=(d&&d.map)||{}});
    subCol('purchases',s=>{S.purchases=mapDocs(s,'purchases')});
    subCol('expenses',s=>{S.expenses=mapDocs(s,'expenses')});
    subCol('payments',s=>{S.payments=mapDocs(s,'payments')});
    subCol('staff',s=>{S.staff=s.docs.map(d=>d.id);S.staff.forEach(watchSales);resolveNames()});
    watchSales('import');
  }
  if(uid){watchSales(uid);
    try{const r=db.doc('staff/'+uid);const g=await r.get();if(!g.exists)await r.set({t:Date.now()})}catch(e){}}
  setTimeout(()=>{if(!S.ready['menu/items']){S.slow=true;sched()}},10000);
}
async function resolveNames(){
  if(!user)return;const ids=S.staff.filter(i=>i!=='import');if(!ids.length)return;
  try{const ps=await user.profiles(ids);ids.forEach(i=>{S.names[i]=(ps[i]&&ps[i].name)||''});sched()}catch(e){}}
const who=u=>u==='import'?'مستورد من الملف':(u===uid&&role==='manager'?'المدير':(S.names[u]||'كاشير'));

/* ---------- model ---------- */
function model(){
  const M={};
  M.itemMap=new Map(S.menu.map(i=>[i.code,i]));M.rawMap=new Map(S.raws.map(r=>[r.code,r]));
  M.sales=[];
  Object.keys(S.salesBy).forEach(u=>Object.values(S.salesBy[u]).forEach(d=>(d.rows||[]).forEach((r,i)=>M.sales.push(Object.assign({},r,{date:d.date,by:u,inv:d.inv||'',path:d._path,idx:i,ts:d.ts||0,total:(+r.qty||0)*(+r.price||0)})))));
  M.sales.sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:b.ts-a.ts);
  M.purch=[];Object.values(S.purchases).forEach(d=>(d.rows||[]).forEach((r,i)=>M.purch.push(Object.assign({},r,{date:d.date,supplier:d.supplier,invoice:d.invoice,pay:d.pay,path:d._path,idx:i}))));
  M.purch.sort((a,b)=>a.date<b.date?1:-1);
  M.exp=[];Object.values(S.expenses).forEach(d=>(d.rows||[]).forEach((r,i)=>M.exp.push(Object.assign({},r,{date:d.date,path:d._path,idx:i}))));
  M.exp.sort((a,b)=>a.date<b.date?1:-1);
  M.pays=Object.values(S.payments).sort((a,b)=>a.date<b.date?1:-1);
  const pa={};M.purch.forEach(p=>{const o=pa[p.code]||(pa[p.code]={q:0,t:0});o.q+=+p.qty||0;o.t+=+p.total||0});M.pa=pa;
  const sold={},used={};
  M.sales.forEach(s=>{sold[s.code]=(sold[s.code]||0)+(+s.qty||0);(S.recipes[s.code]||[]).forEach(l=>{used[l.raw]=(used[l.raw]||0)+(+s.qty||0)*l.qty})});
  M.sold=sold;M.used=used;
  M.rawCost=c=>{const p=pa[c];if(p&&p.q>0)return p.t/p.q;const r=M.rawMap.get(c);return r?+r.price||0:0};
  M.recCost=c=>(S.recipes[c]||[]).reduce((a,l)=>a+l.qty*M.rawCost(l.raw),0);
  M.unitCost=c=>{const p=pa[c];return (p&&p.q>0?p.t/p.q:0)+M.recCost(c)};
  M.rawStock=S.raws.map(r=>{const p=pa[r.code]||{q:0,t:0};const u=used[r.code]||0;const bal=(+r.open||0)+p.q-u;const cost=M.rawCost(r.code);return {r,pq:p.q,used:u,bal,cost,val:Math.max(bal,0)*cost}});
  M.itemStock=S.menu.filter(i=>pa[i.code]||(+i.open||0)>0).map(i=>{const p=pa[i.code]||{q:0,t:0};const s=sold[i.code]||0;const bal=(+i.open||0)+p.q-s;const cost=p.q>0?p.t/p.q:0;return {i,pq:p.q,sold:s,bal,cost,val:Math.max(bal,0)*cost}});
  /* credit */
  const cr={};
  M.sales.forEach(s=>{if(s.pay==='آجل'){const n=(s.cust||'').trim()||'(بدون اسم)';(cr[n]||(cr[n]={name:n,total:0,paid:0,n:0}));cr[n].total+=s.total;cr[n].n++}});
  M.pays.forEach(p=>{const n=(p.cust||'').trim();(cr[n]||(cr[n]={name:n,total:0,paid:0,n:0}));cr[n].paid+=+p.amount||0});
  M.credit=Object.values(cr).map(c=>Object.assign(c,{bal:c.total-c.paid})).sort((a,b)=>b.bal-a.bal);
  M.creditBal=M.credit.reduce((a,c)=>a+c.bal,0);
  return M;
}
function range(M){
  const all=[...M.sales.map(s=>s.date),...M.purch.map(s=>s.date),...M.exp.map(s=>s.date)].filter(Boolean).sort();
  let f='',t='';const td=today();
  if(ui.preset==='today'){f=t=td}
  else if(ui.preset==='7'){const d=new Date();d.setDate(d.getDate()-6);f=isoDate(d);t=td}
  else if(ui.preset==='month'){f=td.slice(0,8)+'01';t=td}
  else if(ui.preset==='custom'){f=ui.from;t=ui.to}
  else {f=all[0]||'';t=all[all.length-1]||''}
  return {f,t,inr:d=>(!f||d>=f)&&(!t||d<=t)};
}
function kpis(M,R){
  const ss=M.sales.filter(s=>R.inr(s.date));
  const sales=ss.reduce((a,s)=>a+s.total,0);
  const cogs=ss.reduce((a,s)=>a+(+s.qty||0)*M.unitCost(s.code),0);
  const expn=M.exp.filter(e=>R.inr(e.date)).reduce((a,e)=>a+(+e.amount||0),0);
  const pur=M.purch.filter(p=>R.inr(p.date)).reduce((a,p)=>a+(+p.total||0),0);
  const prof=sales-cogs;
  const byPay={};ss.forEach(s=>{const k=s.pay||'غير محدد';byPay[k]=(byPay[k]||0)+s.total});
  const byDay={};ss.forEach(s=>{byDay[s.date]=(byDay[s.date]||0)+s.total});
  const byItem={};ss.forEach(s=>{const k=s.code;(byItem[k]||(byItem[k]={code:k,q:0,t:0}));byItem[k].q+=+s.qty||0;byItem[k].t+=s.total});
  return {ss,sales,cogs,prof,expn,pur,net:prof-expn,margin:sales?prof/sales:0,byPay,byDay,byItem:Object.values(byItem).sort((a,b)=>b.t-a.t),
    stockVal:M.rawStock.reduce((a,x)=>a+x.val,0)+M.itemStock.reduce((a,x)=>a+x.val,0)};
}

/* ---------- views ---------- */
const itemName=(M,c)=>{const i=M.itemMap.get(c);return i?i.name:c};
function barChart(data){
  if(!data.length)return '<div class="empty">لا توجد بيانات في هذه الفترة</div>';
  const W=Math.max(320,data.length*52),H=190,pl=8,pr=8,pt=22,pb=26;const mx=Math.max(...data.map(d=>d.v))||1;
  const step=Math.pow(10,Math.floor(Math.log10(mx)));const top=Math.ceil(mx/step)*step;
  const bw=(W-pl-pr)/data.length;let s='<svg viewBox="0 0 '+W+' '+H+'" style="min-width:'+Math.min(W,data.length*52)+'px" role="img" aria-label="المبيعات اليومية">';
  [0,.5,1].forEach(f=>{const y=pt+(H-pt-pb)*(1-f);s+='<line x1="'+pl+'" x2="'+(W-pr)+'" y1="'+y+'" y2="'+y+'"/>'});
  data.forEach((d,i)=>{const h=(H-pt-pb)*d.v/top;const x=pl+i*bw+bw*.18;const w=bw*.64;const y=H-pb-h;
    s+='<rect class="bar" x="'+x+'" y="'+y+'" width="'+w+'" height="'+Math.max(h,1)+'" rx="3"/><text class="v" x="'+(x+w/2)+'" y="'+(y-5)+'" text-anchor="middle">'+money(d.v)+'</text><text x="'+(x+w/2)+'" y="'+(H-8)+'" text-anchor="middle">'+d.l+'</text>'});
  return s+'</svg>';
}
function alerts(M,K){
  const a=[];
  const negR=M.rawStock.filter(x=>x.bal<0),negI=M.itemStock.filter(x=>x.bal<0);
  if(negR.length)a.push(['bad','رصيد سالب في خامات: '+negR.map(x=>x.r.name+' ('+qn(x.bal)+')').join('، ')]);
  if(negI.length)a.push(['bad','رصيد سالب في أصناف: '+negI.map(x=>x.i.name+' ('+qn(x.bal)+')').join('، ')]);
  const low=M.rawStock.filter(x=>x.r.min>0&&x.bal>=0&&x.bal<=x.r.min);if(low.length)a.push(['','تحتاج إعادة طلب: '+low.map(x=>x.r.name).join('، ')]);
  const lowI=M.itemStock.filter(x=>(+x.i.min||0)>0&&x.bal>=0&&x.bal<=x.i.min);if(lowI.length)a.push(['','أصناف تحتاج إعادة طلب: '+lowI.map(x=>x.i.name).join('، ')]);
  const nocost=[...new Set(M.sales.filter(s=>M.unitCost(s.code)===0&&s.price>0).map(s=>itemName(M,s.code)))];
  if(nocost.length)a.push(['','أصناف مباعة بدون تكلفة معروفة (الربح محسوب بالكامل): '+nocost.join('، ')]);
  const noq=M.sales.filter(s=>!(+s.qty>0));if(noq.length)a.push(['','حركات بيع بدون كمية: '+noq.length+' (راجعها من تبويب المبيعات)']);
  const noname=M.sales.filter(s=>s.pay==='آجل'&&!(s.cust||'').trim());if(noname.length)a.push(['bad','مبيعات آجل بدون اسم عميل: '+noname.length]);
  return a;
}
function rangeBar(M,R){
  const p=(k,l)=>'<button data-act="preset" data-v="'+k+'" aria-pressed="'+(ui.preset===k)+'">'+l+'</button>';
  return '<div class="row"><div class="seg" role="group" aria-label="الفترة">'+p('today','اليوم')+p('7','٧ أيام')+p('month','الشهر')+p('all','الكل')+'</div>'+
   '<div class="field" style="flex:0 0 140px"><label for="rf">من</label><input id="rf" type="date" data-ui="from" value="'+esc(ui.preset==='custom'?ui.from:R.f)+'"></div>'+
   '<div class="field" style="flex:0 0 140px"><label for="rt">إلى</label><input id="rt" type="date" data-ui="to" value="'+esc(ui.preset==='custom'?ui.to:R.t)+'"></div></div>';
}
function vHome(M){
  const R=range(M),K=kpis(M,R);
  const days=Object.keys(K.byDay).sort().map(d=>({l:fd(d),v:K.byDay[d]}));
  const mxI=K.byItem[0]?K.byItem[0].t:1;
  const pays=Object.entries(K.byPay).sort((a,b)=>b[1]-a[1]);const mxP=pays[0]?pays[0][1]:1;
  const al=alerts(M,K);
  const empty=!M.sales.length&&!M.purch.length;
  return '<div class="row" style="align-items:center"><h2>لوحة التحكم</h2><span class="sp"></span>'+rangeBar(M,R)+'</div>'+
  (empty?'<div class="card empty">لم تُسجَّل أي حركة بعد. ابدأ من تبويب «المبيعات» أو «المشتريات».</div>':'')+
  '<div class="kpis">'+
   '<div class="kpi main"><div class="l">إجمالي المبيعات</div><div class="v">'+N(money(K.sales))+'</div><div class="s">'+K.ss.length+' حركة بيع</div></div>'+
   '<div class="kpi"><div class="l">الربح الإجمالي التقديري</div><div class="v">'+N(money(K.prof))+'</div><div class="s">هامش '+N((K.margin*100).toFixed(1)+'%')+'</div></div>'+
   '<div class="kpi"><div class="l">المصروفات</div><div class="v">'+N(money(K.expn))+'</div><div class="s">المشتريات في الفترة '+N(money(K.pur))+'</div></div>'+
   '<div class="kpi"><div class="l">صافي الحركة</div><div class="v '+(K.net<0?'neg':'')+'">'+N(money(K.net))+'</div><div class="s">الربح الإجمالي − المصروفات</div></div>'+
   '<div class="kpi"><div class="l">آجل مستحق</div><div class="v">'+N(money(M.creditBal))+'</div><div class="s">'+M.credit.filter(c=>c.bal>0).length+' عميل عليهم رصيد</div></div>'+
   '<div class="kpi"><div class="l">قيمة المخزون</div><div class="v">'+N(money(K.stockVal))+'</div><div class="s">بسعر الشراء الحالي</div></div>'+
  '</div>'+
  (al.length?'<div class="list">'+al.map(a=>'<div class="alert '+a[0]+'"><span>'+esc(a[1])+'</span></div>').join('')+'</div>':'')+
  '<div class="card"><header><h3>المبيعات اليومية</h3><span class="muted sm">بالجنيه</span></header><div class="chart">'+barChart(days)+'</div></div>'+
  '<div class="grid g2"><div class="card"><header><h3>أعلى الأصناف مبيعاً</h3></header><div class="bars">'+
   (K.byItem.slice(0,8).map(x=>'<div class="r"><span>'+esc(itemName(M,x.code))+'</span><span class="t"><i style="width:'+(x.t/mxI*100)+'%"></i></span><span>'+N(money(x.t))+'</span></div>').join('')||'<div class="empty">لا مبيعات</div>')+
  '</div></div><div class="card"><header><h3>طرق الدفع</h3></header><div class="bars">'+
   (pays.map(x=>'<div class="r"><span>'+esc(x[0])+'</span><span class="t"><i style="width:'+(x[1]/mxP*100)+'%"></i></span><span>'+N(money(x[1]))+'</span></div>').join('')||'<div class="empty">لا مبيعات</div>')+
  '</div></div></div>';
}

/* ----- POS ----- */
function posHTML(M,mgr){
  const f=F.sale;const cats=['الكل',...new Set(S.menu.map(i=>i.cat))];
  const q=f.q.trim().toLowerCase();
  const list=S.menu.filter(i=>(f.cat==='الكل'||i.cat===f.cat)&&(!q||(i.name+i.code).toLowerCase().includes(q)));
  const total=f.cart.reduce((a,l)=>a+(+l.qty||0)*(+l.price||0),0);
  const credit=f.pay==='آجل';
  return '<div class="pos"><div class="card"><header><h3>اختر الأصناف</h3><span class="sp"></span><div style="flex:1 1 180px"><input id="pq" data-f="sale.q" data-keep="1" type="search" placeholder="بحث بالاسم أو الكود" value="'+esc(f.q)+'"></div></header>'+
   '<div class="cats">'+cats.map(c=>'<button data-act="cat" data-v="'+esc(c)+'" aria-pressed="'+(f.cat===c)+'">'+esc(c)+'</button>').join('')+'</div>'+
   '<div class="items" style="margin-top:10px">'+(list.map(i=>'<button class="it" data-act="add" data-v="'+esc(i.code)+'"><b>'+esc(i.name)+'</b><span>'+N(money(i.price))+'</span></button>').join('')||'<div class="empty" style="grid-column:1/-1">'+(S.menu.length?'لا يوجد صنف مطابق':'لا توجد أصناف بعد')+'</div>')+'</div></div>'+
  '<div class="card cart"><header><h3>الفاتورة الحالية</h3><span class="sp"></span>'+(f.cart.length?'<button class="btn sm bad" data-act="clearcart">إفراغ</button>':'')+'</header>'+
   (f.cart.length?f.cart.map((l,i)=>'<div class="line"><span class="b sm">'+esc(itemName(M,l.code))+'</span><input type="number" min="0" step="any" inputmode="decimal" aria-label="الكمية" data-f="sale.cart.'+i+'.qty" data-sum="1" value="'+esc(l.qty)+'"><input type="number" min="0" step="any" inputmode="decimal" aria-label="السعر" data-f="sale.cart.'+i+'.price" data-sum="1" value="'+esc(l.price)+'"><button class="btn sm bad" data-act="rm" data-i="'+i+'" aria-label="حذف">✕</button></div>').join(''):'<div class="empty">اضغط على صنف لإضافته</div>')+
   '<div class="total"><span>الإجمالي</span><span id="cartTotal">'+N(money(total))+'</span></div>'+
   '<div class="list" style="margin-top:12px"><div class="paypick" role="group" aria-label="طريقة الدفع">'+PAYS.map(p=>'<button data-act="pay" data-v="'+p+'" aria-pressed="'+(f.pay===p)+'">'+p+'</button>').join('')+'</div>'+
   (credit?'<div class="field"><label for="sc">اسم العميل (مطلوب للآجل)</label><input id="sc" list="custlist" data-f="sale.cust" value="'+esc(f.cust)+'" placeholder="اكتب أو اختر العميل"><datalist id="custlist">'+S.customers.map(c=>'<option value="'+esc(c)+'">').join('')+'</datalist></div>':
     '<div class="field"><label for="sc">اسم العميل (اختياري)</label><input id="sc" list="custlist" data-f="sale.cust" value="'+esc(f.cust)+'"><datalist id="custlist">'+S.customers.map(c=>'<option value="'+esc(c)+'">').join('')+'</datalist></div>')+
   (mgr?'<div class="field"><label for="sd">التاريخ</label><input id="sd" type="date" data-f="sale.date" value="'+esc(f.date)+'"></div>':'')+
   '<div class="field"><label for="sn">ملاحظة</label><input id="sn" data-f="sale.note" value="'+esc(f.note)+'"></div>'+
   '<button class="btn pri" data-act="savesale" '+(f.cart.length?'':'disabled')+'>تسجيل البيع</button></div></div></div>';
}
function myToday(M){
  const mine=Object.values(S.salesBy[uid]||{}).filter(d=>d.date===today()).sort((a,b)=>(b.ts||0)-(a.ts||0));
  const tot=mine.reduce((a,d)=>a+(d.rows||[]).reduce((x,r)=>x+r.qty*r.price,0),0);
  return '<div class="card"><header><h3>ما سجلته اليوم</h3><span class="sp"></span><span class="chip">'+N(money(tot))+' ج</span></header>'+
   (mine.length?'<div class="tbl"><table><tbody>'+mine.map(d=>'<tr><td class="sm muted">'+esc(d.inv||'')+'<br>'+(d.ts?new Date(d.ts).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'}):'')+'</td><td>'+(d.rows||[]).map(r=>esc(itemName(M,r.code))+' ×'+qn(r.qty)).join('، ')+'</td><td>'+esc((d.rows[0]||{}).pay||'')+'</td><td class="n">'+N(money(d.rows.reduce((x,r)=>x+r.qty*r.price,0)))+'</td><td><button class="btn sm bad" data-act="delsaledoc" data-p="'+esc(d._path)+'">إلغاء</button></td></tr>').join('')+'</tbody></table></div>':'<div class="empty">لم تسجل أي بيع اليوم</div>')+'</div>';
}
function vSales(M){
  const q=ui.sq.trim().toLowerCase();
  const rows=M.sales.filter(s=>(!q||(itemName(M,s.code)+' '+s.code+' '+(s.cust||'')).toLowerCase().includes(q))&&(!ui.sqs||s.pay===ui.sqs)).slice(0,300);
  const tot=rows.reduce((a,s)=>a+s.total,0);
  return '<h2>المبيعات</h2>'+receiptHTML(M)+posHTML(M,true)+
  '<div class="card"><header><h3>سجل المبيعات</h3><span class="sp"></span><div style="flex:1 1 200px"><input id="sqi" data-ui="sq" type="search" placeholder="بحث بصنف أو عميل" value="'+esc(ui.sq)+'"></div>'+
   '<select id="sqp" data-ui="sqs" style="width:auto"><option value="">كل طرق الدفع</option>'+PAYS.map(p=>'<option '+(ui.sqs===p?'selected':'')+'>'+p+'</option>').join('')+'</select></header>'+
   '<div class="tbl" style="max-height:520px"><table><thead><tr><th>التاريخ</th><th>الفاتورة</th><th>الصنف</th><th class="n">الكمية</th><th class="n">السعر</th><th class="n">الإجمالي</th><th>العميل</th><th>الدفع</th><th>المُدخِل</th><th></th></tr></thead><tbody>'+
   rows.map(s=>'<tr><td>'+fd(s.date)+'</td><td class="sm muted">'+esc(s.inv||'—')+'</td><td>'+esc(itemName(M,s.code))+(s.note?' <span class="chip warn">'+esc(s.note)+'</span>':'')+'</td><td class="n">'+qn(s.qty)+'</td><td class="n">'+money(s.price)+'</td><td class="n">'+money(s.total)+'</td><td>'+esc(s.cust||'')+'</td><td>'+(s.pay?'<span class="chip '+(s.pay==='آجل'?'warn':'gray')+'">'+esc(s.pay)+'</span>':'<select aria-label="تحديد طريقة الدفع" style="width:auto;padding:3px 6px" data-act-change="setpay" data-p="'+esc(s.path)+'" data-i="'+s.idx+'"><option value="">حدد…</option>'+PAYS.map(x=>'<option>'+x+'</option>').join('')+'</select>')+'</td><td class="sm muted">'+esc(who(s.by))+'</td><td><button class="btn sm bad" data-act="delrow" data-p="'+esc(s.path)+'" data-i="'+s.idx+'">حذف</button></td></tr>').join('')+
   '</tbody><tfoot><tr><td colspan="5">الإجمالي ('+rows.length+' حركة)</td><td class="n">'+money(tot)+'</td><td colspan="4"></td></tr></tfoot></table></div></div>';
}
function vPurch(M){
  const f=F.purch;const opts=(k)=>k==='raw'?S.raws.map(r=>'<option value="'+esc(r.code)+'">'+esc(r.name)+' ('+esc(r.code)+')</option>').join(''):S.menu.map(i=>'<option value="'+esc(i.code)+'">'+esc(i.name)+' ('+esc(i.code)+')</option>').join('');
  const tot=f.rows.reduce((a,r)=>a+(+r.total||0),0);
  return '<h2>المشتريات</h2><div class="card"><header><h3>فاتورة مشتريات جديدة</h3></header><div class="list">'+
   '<div class="row"><div class="field"><label for="pd">التاريخ</label><input id="pd" type="date" data-f="purch.date" value="'+esc(f.date)+'"></div>'+
   '<div class="field"><label for="ps">المورد</label><input id="ps" data-f="purch.sup" value="'+esc(f.sup)+'"></div>'+
   '<div class="field"><label for="pi">رقم الفاتورة</label><input id="pi" data-f="purch.inv" value="'+esc(f.inv)+'"></div>'+
   '<div class="field"><label for="pp">الدفع</label><select id="pp" data-f="purch.pay"><option value="">غير محدد</option>'+PAYS.map(p=>'<option '+(f.pay===p?'selected':'')+'>'+p+'</option>').join('')+'</select></div></div>'+
   f.rows.map((r,i)=>'<div class="row"><div class="field" style="flex:0 0 110px"><label>النوع</label><select data-f="purch.rows.'+i+'.kind" data-r="1"><option value="item" '+(r.kind==='item'?'selected':'')+'>صنف</option><option value="raw" '+(r.kind==='raw'?'selected':'')+'>خامة</option></select></div>'+
     '<div class="field" style="flex:2 1 220px"><label>الصنف / الخامة</label><select data-f="purch.rows.'+i+'.code" data-r="1"><option value="">اختر…</option>'+opts(r.kind).replace('value="'+esc(r.code)+'"','value="'+esc(r.code)+'" selected')+'</select></div>'+
     '<div class="field" style="flex:0 0 100px"><label>الكمية</label><input type="number" min="0" step="any" inputmode="decimal" data-f="purch.rows.'+i+'.qty" value="'+esc(r.qty)+'"></div>'+packHtml(r,i)+
     '<div class="field" style="flex:0 0 130px"><label>إجمالي التكلفة</label><input type="number" min="0" step="any" inputmode="decimal" data-f="purch.rows.'+i+'.total" data-psum="1" value="'+esc(r.total)+'"></div>'+
     '<button class="btn sm bad" data-act="prm" data-i="'+i+'" aria-label="حذف السطر">✕</button></div>').join('')+
   '<div class="row"><button class="btn" data-act="padd">+ سطر</button><span class="sp"></span><b>الإجمالي: <span id="pTotal">'+N(money(tot))+'</span></b><button class="btn pri" data-act="savepurch">حفظ الفاتورة</button></div></div></div>'+
  '<div class="card"><header><h3>سجل المشتريات</h3><span class="sp"></span><span class="chip">'+N(money(M.purch.reduce((a,p)=>a+(+p.total||0),0)))+' ج</span></header><div class="tbl" style="max-height:520px"><table><thead><tr><th>التاريخ</th><th>الصنف</th><th class="n">الكمية</th><th class="n">سعر الوحدة</th><th class="n">الإجمالي</th><th>المورد</th><th>فاتورة</th><th>الدفع</th><th></th></tr></thead><tbody>'+
   M.purch.map(p=>{const nm=p.kind==='raw'?((M.rawMap.get(p.code)||{}).name||p.code):itemName(M,p.code);return '<tr><td>'+fd(p.date)+'</td><td>'+esc(nm)+(p.kind==='raw'?' <span class="chip gray">خامة</span>':'')+(p.note?'<div class="sm muted">'+esc(p.note)+'</div>':'')+'</td><td class="n">'+qn(p.qty)+'</td><td class="n">'+money((+p.total||0)/(+p.qty||1))+'</td><td class="n">'+money(p.total)+'</td><td>'+esc(p.supplier||'')+'</td><td>'+esc(p.invoice||'')+'</td><td>'+esc(p.pay||'')+'</td><td><button class="btn sm bad" data-act="delrow" data-p="'+esc(p.path)+'" data-i="'+p.idx+'">حذف</button></td></tr>'}).join('')+'</tbody></table></div></div>';
}
function vExp(M){
  const f=F.exp;const types=[...new Set(M.exp.map(e=>e.type))];
  const by={};M.exp.forEach(e=>{by[e.type]=(by[e.type]||0)+(+e.amount||0)});const bt=Object.entries(by).sort((a,b)=>b[1]-a[1]);const mx=bt[0]?bt[0][1]:1;
  return '<h2>المصروفات</h2><div class="grid g2"><div class="card"><header><h3>مصروف جديد</h3></header><div class="list">'+
   '<div class="row"><div class="field"><label for="ed">التاريخ</label><input id="ed" type="date" data-f="exp.date" value="'+esc(f.date)+'"></div><div class="field"><label for="et">نوع المصروف</label><input id="et" list="etypes" data-f="exp.type" value="'+esc(f.type)+'"><datalist id="etypes">'+types.map(t=>'<option value="'+esc(t)+'">').join('')+'</datalist></div></div>'+
   '<div class="row"><div class="field"><label for="ea">المبلغ</label><input id="ea" type="number" min="0" step="any" inputmode="decimal" data-f="exp.amount" value="'+esc(f.amount)+'"></div><div class="field"><label for="ep">الدفع</label><select id="ep" data-f="exp.pay">'+PAYS.filter(p=>p!=='آجل').map(p=>'<option '+(f.pay===p?'selected':'')+'>'+p+'</option>').join('')+'</select></div></div>'+
   '<div class="field"><label for="ex">البيان</label><input id="ex" data-f="exp.desc" value="'+esc(f.desc)+'"></div><button class="btn pri" data-act="saveexp">حفظ المصروف</button></div></div>'+
   '<div class="card"><header><h3>حسب النوع</h3><span class="sp"></span><span class="chip">'+N(money(M.exp.reduce((a,e)=>a+(+e.amount||0),0)))+' ج</span></header><div class="bars">'+bt.map(x=>'<div class="r"><span>'+esc(x[0])+'</span><span class="t"><i style="width:'+(x[1]/mx*100)+'%"></i></span><span>'+N(money(x[1]))+'</span></div>').join('')+'</div></div></div>'+
  '<div class="card"><header><h3>سجل المصروفات</h3></header><div class="tbl" style="max-height:480px"><table><thead><tr><th>التاريخ</th><th>النوع</th><th>البيان</th><th class="n">المبلغ</th><th>الدفع</th><th></th></tr></thead><tbody>'+
   M.exp.map(e=>'<tr><td>'+fd(e.date)+'</td><td>'+esc(e.type)+'</td><td>'+esc(e.desc||'')+'</td><td class="n">'+money(e.amount)+'</td><td>'+esc(e.pay||'')+'</td><td><button class="btn sm bad" data-act="delrow" data-p="'+esc(e.path)+'" data-i="'+e.idx+'">حذف</button></td></tr>').join('')+'</tbody></table></div></div>';
}
function vCredit(M){
  const sel=ui.cust;const f=F.pay;
  const sl=sel!=null?M.sales.filter(s=>s.pay==='آجل'&&(((s.cust||'').trim()||'(بدون اسم)')===sel)):[];
  const sp=sel!=null?M.pays.filter(p=>(p.cust||'').trim()===sel):[];
  return '<h2>عملاء الآجل</h2><div class="kpis"><div class="kpi main"><div class="l">إجمالي المستحق</div><div class="v">'+N(money(M.creditBal))+'</div></div><div class="kpi"><div class="l">إجمالي الآجل</div><div class="v">'+N(money(M.credit.reduce((a,c)=>a+c.total,0)))+'</div></div><div class="kpi"><div class="l">إجمالي المسدد</div><div class="v">'+N(money(M.credit.reduce((a,c)=>a+c.paid,0)))+'</div></div></div>'+
  '<div class="grid g2"><div class="card"><header><h3>أرصدة العملاء</h3></header><div class="tbl"><table><thead><tr><th>العميل</th><th class="n">الآجل</th><th class="n">المسدد</th><th class="n">المتبقي</th></tr></thead><tbody>'+
   M.credit.map(c=>'<tr style="cursor:pointer" data-act="cust" data-v="'+esc(c.name)+'"><td><button class="btn sm" data-act="cust" data-v="'+esc(c.name)+'">'+esc(c.name||'—')+'</button></td><td class="n">'+money(c.total)+'</td><td class="n">'+money(c.paid)+'</td><td class="n b '+(c.bal>0?'':'muted')+'">'+money(c.bal)+'</td></tr>').join('')+'</tbody></table></div>'+
   '<p class="sm muted">أسماء العملاء كما أُدخلت في الملف. الأسماء المتشابهة (مثل mo photo / mo phoro) تظهر منفصلة حتى توحّدها بنفسك.</p></div>'+
   '<div class="card"><header><h3>تسجيل سداد</h3></header><div class="list">'+
    '<div class="row"><div class="field"><label for="yc">العميل</label><input id="yc" list="ycl" data-f="pay.cust" value="'+esc(f.cust||(sel&&sel!=='(بدون اسم)'?sel:''))+'"><datalist id="ycl">'+M.credit.filter(c=>c.name).map(c=>'<option value="'+esc(c.name)+'">').join('')+'</datalist></div><div class="field"><label for="yd">التاريخ</label><input id="yd" type="date" data-f="pay.date" value="'+esc(f.date)+'"></div></div>'+
    '<div class="row"><div class="field"><label for="ya">المبلغ</label><input id="ya" type="number" min="0" step="any" inputmode="decimal" data-f="pay.amount" value="'+esc(f.amount)+'"></div><div class="field"><label for="ym">طريقة السداد</label><select id="ym" data-f="pay.method">'+PAYS.filter(p=>p!=='آجل').map(p=>'<option '+(f.method===p?'selected':'')+'>'+p+'</option>').join('')+'</select></div></div>'+
    '<div class="field"><label for="yn">ملاحظة</label><input id="yn" data-f="pay.note" value="'+esc(f.note)+'"></div><button class="btn pri" data-act="savepay">تسجيل السداد</button></div></div></div>'+
  (sel!=null?'<div class="card"><header><h3>كشف حساب: '+esc(sel)+'</h3><span class="sp"></span><button class="btn sm" data-act="cust" data-v="">إغلاق</button></header><div class="tbl"><table><thead><tr><th>التاريخ</th><th>البيان</th><th class="n">مدين</th><th class="n">دائن</th></tr></thead><tbody>'+
   sl.map(s=>'<tr><td>'+fd(s.date)+'</td><td>'+esc(itemName(M,s.code))+' ×'+qn(s.qty)+'</td><td class="n">'+money(s.total)+'</td><td></td></tr>').join('')+
   sp.map(p=>'<tr><td>'+fd(p.date)+'</td><td>سداد '+esc(p.method||'')+' <button class="btn sm bad" data-act="delpay" data-p="payments/'+esc(p._id)+'">حذف</button></td><td></td><td class="n">'+money(p.amount)+'</td></tr>').join('')+'</tbody></table></div></div>':'');
}
function vStock(M){
  const q=ui.q.trim().toLowerCase();
  const isRaw=ui.stock==='raw';
  const head='<h2>المخزون</h2><div class="row" style="align-items:center"><div class="seg"><button data-act="stock" data-v="raw" aria-pressed="'+isRaw+'">الخامات</button><button data-act="stock" data-v="item" aria-pressed="'+!isRaw+'">الأصناف الجاهزة</button></div><div class="field" style="flex:1 1 200px"><input id="stq" data-ui="q" type="search" placeholder="بحث" value="'+esc(ui.q)+'"></div></div>';
  if(isRaw){
    const rows=M.rawStock.filter(x=>!q||(x.r.name+x.r.code).toLowerCase().includes(q));
    return head+'<div class="card"><div class="tbl" style="max-height:640px"><table><thead><tr><th>الكود</th><th>الخامة</th><th>الوحدة</th><th class="n">افتتاحي</th><th class="n">مشتريات</th><th class="n">مستهلك</th><th class="n">الرصيد</th><th class="n">سعر الوحدة</th><th class="n">القيمة</th></tr></thead><tbody>'+
     rows.map(x=>'<tr><td class="muted">'+esc(x.r.code)+'</td><td>'+esc(x.r.name)+'</td><td>'+esc(x.r.unit)+'</td><td class="n">'+qn(x.r.open)+'</td><td class="n">'+qn(x.pq)+'</td><td class="n">'+qn(x.used)+'</td><td class="n '+(x.bal<0?'neg':'')+'">'+qn(x.bal)+(x.r.min>0&&x.bal>=0&&x.bal<=x.r.min?' <span class="chip warn">أعد الطلب</span>':'')+'</td><td class="n">'+money(x.cost)+'</td><td class="n">'+money(x.val)+'</td></tr>').join('')+
     '</tbody><tfoot><tr><td colspan="8">قيمة الخامات</td><td class="n">'+money(M.rawStock.reduce((a,x)=>a+x.val,0))+'</td></tr></tfoot></table></div><p class="sm muted">الاستهلاك محسوب من مبيعات المشروبات حسب كروت التكلفة (تبويب الأصناف والوصفات).</p></div>';
  }
  const rows=M.itemStock.filter(x=>!q||(x.i.name+x.i.code).toLowerCase().includes(q));
  return head+'<div class="card"><div class="tbl" style="max-height:640px"><table><thead><tr><th>الكود</th><th>الصنف</th><th class="n">افتتاحي</th><th class="n">مشتريات</th><th class="n">مبيعات</th><th class="n">الرصيد</th><th class="n">متوسط التكلفة</th><th class="n">القيمة</th></tr></thead><tbody>'+
   rows.map(x=>'<tr><td class="muted">'+esc(x.i.code)+'</td><td>'+esc(x.i.name)+'</td><td class="n">'+qn(x.i.open)+'</td><td class="n">'+qn(x.pq)+'</td><td class="n">'+qn(x.sold)+'</td><td class="n '+(x.bal<0?'neg':'')+'">'+qn(x.bal)+(x.i.min>0&&x.bal>=0&&x.bal<=x.i.min?' <span class="chip warn">أعد الطلب</span>':'')+'</td><td class="n">'+money(x.cost)+'</td><td class="n">'+money(x.val)+'</td></tr>').join('')+
   '</tbody><tfoot><tr><td colspan="7">قيمة الأصناف الجاهزة</td><td class="n">'+money(M.itemStock.reduce((a,x)=>a+x.val,0))+'</td></tr></tfoot></table></div></div>';
}
function vCatalog(M){
  const v=ui.cat;
  const seg='<div class="seg"><button data-act="catv" data-v="items" aria-pressed="'+(v==='items')+'">الأصناف</button><button data-act="catv" data-v="recipes" aria-pressed="'+(v==='recipes')+'">الوصفات</button><button data-act="catv" data-v="raws" aria-pressed="'+(v==='raws')+'">الخامات</button></div>';
  let body='';
  if(v==='items'){
    const e=ui.edit&&ui.edit.t==='item'?ui.edit:null;
    body='<div class="card"><header><h3>'+(e?(e.isNew?'صنف جديد':'تعديل صنف'):'إضافة / تعديل صنف')+'</h3></header><div class="row">'+
     '<div class="field" style="flex:0 0 110px"><label for="ic">الكود</label><input id="ic" data-e="code" value="'+esc(e?e.code:'')+'" '+(e&&!e.isNew?'readonly':'')+'></div>'+
     '<div class="field" style="flex:2 1 200px"><label for="in">الاسم</label><input id="in" data-e="name" value="'+esc(e?e.name:'')+'"></div>'+
     '<div class="field"><label for="icat">التصنيف</label><input id="icat" list="catl" data-e="cat" value="'+esc(e?e.cat:'')+'"><datalist id="catl">'+[...new Set(S.menu.map(i=>i.cat))].map(c=>'<option value="'+esc(c)+'">').join('')+'</datalist></div>'+
     '<div class="field" style="flex:0 0 110px"><label for="ip">سعر البيع</label><input id="ip" type="number" step="any" data-e="price" value="'+esc(e?e.price:'')+'"></div>'+
     '<div class="field" style="flex:0 0 110px"><label for="io">رصيد افتتاحي</label><input id="io" type="number" step="any" data-e="open" value="'+esc(e?e.open:'')+'"></div>'+
     '<div class="field" style="flex:0 0 110px"><label for="im">حد إعادة الطلب</label><input id="im" type="number" step="any" data-e="min" value="'+esc(e?e.min:'')+'"></div>'+
     '<button class="btn pri" data-act="saveitem">حفظ</button></div></div>'+
     '<div class="card"><div class="tbl" style="max-height:560px"><table><thead><tr><th>الكود</th><th>الاسم</th><th>التصنيف</th><th class="n">سعر البيع</th><th class="n">التكلفة</th><th class="n">الهامش</th><th></th></tr></thead><tbody>'+
     S.menu.map(i=>{const c=M.unitCost(i.code);return '<tr><td class="muted">'+esc(i.code)+'</td><td>'+esc(i.name)+'</td><td>'+esc(i.cat)+'</td><td class="n">'+money(i.price)+'</td><td class="n">'+(c?money(c):'<span class="muted">—</span>')+'</td><td class="n">'+(c&&i.price?((1-c/i.price)*100).toFixed(0)+'%':'—')+'</td><td><button class="btn sm" data-act="edititem" data-v="'+esc(i.code)+'">تعديل</button> <button class="btn sm bad" data-act="delitem" data-v="'+esc(i.code)+'">حذف</button></td></tr>'}).join('')+'</tbody></table></div></div>';
  } else if(v==='recipes'){
    const code=ui.recItem||(S.menu.find(i=>S.recipes[i.code])||S.menu[0]||{}).code||'';
    const lines=S.recipes[code]||[];
    body='<div class="card"><header><h3>كرت التكلفة</h3><span class="sp"></span><div style="flex:1 1 260px"><select id="ri" data-ui="recItem">'+S.menu.map(i=>'<option value="'+esc(i.code)+'" '+(i.code===code?'selected':'')+'>'+esc(i.name)+(S.recipes[i.code]?'':' (بدون وصفة)')+'</option>').join('')+'</select></div></header>'+
     '<div class="tbl"><table><thead><tr><th>الخامة</th><th class="n">الكمية للوحدة</th><th>الوحدة</th><th class="n">التكلفة</th><th></th></tr></thead><tbody>'+
     lines.map((l,i)=>{const r=M.rawMap.get(l.raw);return '<tr><td>'+esc(r?r.name:l.raw)+'</td><td class="n"><input type="number" step="any" style="width:90px" data-act-change="reclineqty" data-i="'+i+'" value="'+esc(l.qty)+'"></td><td>'+esc(r?r.unit:'')+'</td><td class="n">'+money(l.qty*M.rawCost(l.raw))+'</td><td><button class="btn sm bad" data-act="recrm" data-i="'+i+'">حذف</button></td></tr>'}).join('')+
     '</tbody><tfoot><tr><td colspan="3">تكلفة الوحدة</td><td class="n">'+money(M.recCost(code))+'</td><td></td></tr></tfoot></table></div>'+
     '<div class="row" style="margin-top:12px"><div class="field" style="flex:2 1 200px"><label for="rr">إضافة خامة</label><select id="rr" data-e="rr"><option value="">اختر…</option>'+S.raws.map(r=>'<option value="'+esc(r.code)+'">'+esc(r.name)+' ('+esc(r.unit)+')</option>').join('')+'</select></div><div class="field" style="flex:0 0 110px"><label for="rq">الكمية</label><input id="rq" type="number" step="any" data-e="rq"></div><button class="btn pri" data-act="recadd">إضافة</button></div>'+
     (S.recipes[code]?'':'<p class="sm muted">هذا الصنف بلا وصفة، لذلك تكلفته من سعر الشراء فقط.</p>')+'</div>';
  } else {
    const e=ui.edit&&ui.edit.t==='raw'?ui.edit:null;
    body='<div class="card"><header><h3>'+(e?(e.isNew?'خامة جديدة':'تعديل خامة'):'إضافة / تعديل خامة')+'</h3></header><div class="row">'+
     '<div class="field" style="flex:0 0 110px"><label for="xc">الكود</label><input id="xc" data-e="code" value="'+esc(e?e.code:'')+'" '+(e&&!e.isNew?'readonly':'')+'></div>'+
     '<div class="field" style="flex:2 1 180px"><label for="xn">الاسم</label><input id="xn" data-e="name" value="'+esc(e?e.name:'')+'"></div>'+
     '<div class="field" style="flex:0 0 110px"><label for="xu">الوحدة</label><select id="xu" data-e="unit">'+['جرام','ملليلتر','قطعة'].map(u=>'<option '+(e&&e.unit===u?'selected':'')+'>'+u+'</option>').join('')+'</select></div>'+
     '<div class="field" style="flex:0 0 110px"><label for="xp">سعر الوحدة</label><input id="xp" type="number" step="any" data-e="price" value="'+esc(e?e.price:'')+'"></div>'+
     '<div class="field" style="flex:0 0 110px"><label for="xo">افتتاحي</label><input id="xo" type="number" step="any" data-e="open" value="'+esc(e?e.open:'')+'"></div>'+
     '<div class="field" style="flex:0 0 110px"><label for="xm">حد إعادة الطلب</label><input id="xm" type="number" step="any" data-e="min" value="'+esc(e?e.min:'')+'"></div>'+
     '<div class="field" style="flex:0 0 110px"><label for="xk">اسم العبوة</label><input id="xk" data-e="packName" placeholder="كيس" value="'+esc(e&&e.packName||'')+'"></div>'+
     '<div class="field" style="flex:0 0 110px"><label for="xs">محتوى العبوة</label><input id="xs" type="number" step="any" data-e="packSize" placeholder="1000" value="'+esc(e&&e.packSize||'')+'"></div>'+
     '<button class="btn pri" data-act="saveraw">حفظ</button></div></div>'+
     '<div class="card"><div class="tbl" style="max-height:560px"><table><thead><tr><th>الكود</th><th>الخامة</th><th>الوحدة</th><th class="n">السعر</th><th class="n">افتتاحي</th><th class="n">حد الطلب</th><th></th></tr></thead><tbody>'+
     S.raws.map(r=>'<tr><td class="muted">'+esc(r.code)+'</td><td>'+esc(r.name)+'</td><td>'+esc(r.unit)+'</td><td class="n">'+money(r.price)+'</td><td class="n">'+qn(r.open)+'</td><td class="n">'+qn(r.min)+'</td><td><button class="btn sm" data-act="editraw" data-v="'+esc(r.code)+'">تعديل</button> <button class="btn sm bad" data-act="delraw" data-v="'+esc(r.code)+'">حذف</button></td></tr>').join('')+'</tbody></table></div></div>';
  }
  return '<div class="row" style="align-items:center"><h2>الأصناف والوصفات</h2><span class="sp"></span>'+seg+'</div>'+body;
}
function vCashier(M){
  return receiptHTML(M)+posHTML(M,false)+myToday(M);
}


/* ---------- receipt, helpers ---------- */
function receiptHTML(M){
  const r=ui.receipt;if(!r)return '';
  const tot=r.rows.reduce((a,l)=>a+l.qty*l.price,0);
  return '<div class="card rc"><header><h3>فاتورة رقم <span class="num">'+esc(r.inv)+'</span></h3><span class="sp"></span><span class="chip">'+esc(r.pay)+'</span><button class="btn sm" data-act="closerc">فاتورة جديدة</button></header>'+
   '<div class="tbl"><table><tbody>'+r.rows.map(l=>'<tr><td>'+esc(itemName(M,l.code))+'</td><td class="n">'+qn(l.qty)+' × '+money(l.price)+'</td><td class="n">'+money(l.qty*l.price)+'</td></tr>').join('')+'</tbody><tfoot><tr><td colspan="2">الإجمالي'+(r.cust?' — '+esc(r.cust):'')+'</td><td class="n">'+money(tot)+'</td></tr></tfoot></table></div></div>';
}
function packOf(code){const r=S.raws.find(x=>x.code===code);return r&&+r.packSize>0?{name:r.packName||'عبوة',size:+r.packSize,unit:r.unit}:null}
function packHtml(r,i){
  if(r.kind!=='raw')return '';const pk=packOf(r.code);if(!pk)return '';
  return '<div class="field" style="flex:0 0 130px"><label>عدد '+esc(pk.name)+' ('+qn(pk.size)+' '+esc(pk.unit)+')</label><input type="number" min="0" step="any" inputmode="decimal" data-f="purch.rows.'+i+'.packs" data-pack="'+i+'" value="'+esc(r.packs||'')+'"></div>';
}
async function saveCsv(name,rows){
  const q=v=>{v=v==null?'':String(v);return /[",\n\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
  const text='﻿'+rows.map(r=>r.map(q).join(',')).join('\r\n');
  try{const d=await window.claude.use('downloads');if(!d){toast('التصدير غير متاح في هذا العرض');return}await d.save({filename:name,data:text});toast('تم التصدير')}
  catch(e){if(!(e&&e.code==='declined'))toast('تعذر التصدير')}
}
const parseNum=v=>{if(typeof v==='number')return isFinite(v)?v:0;let t=String(v==null?'':v).trim();t=t.replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٫/g,'.').replace(/[٬,\s]/g,'');const n=parseFloat(t);return isFinite(n)?n:0};
function parseDate(v){
  if(v instanceof Date&&!isNaN(v)){const d=new Date(v.getTime()+12*3600e3);return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate())}
  const t=String(v==null?'':v).trim().replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d));let m;
  if((m=t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)))return m[1]+'-'+pad(+m[2])+'-'+pad(+m[3]);
  if((m=t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/)))return m[3]+'-'+pad(+m[2])+'-'+pad(+m[1]);
  return '';
}
function parseText(text){
  const sep=text.split('\n')[0].includes('\t')?'\t':(text.split('\n')[0].split(';').length>text.split('\n')[0].split(',').length?';':',');
  const rows=[];let cur=[],f='',q=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i++}else q=false}else f+=c}
    else if(c==='"')q=true;else if(c===sep){cur.push(f);f=''}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;cur.push(f);f='';if(cur.some(x=>String(x).trim()!==''))rows.push(cur);cur=[]}
    else f+=c}
  cur.push(f);if(cur.some(x=>String(x).trim()!==''))rows.push(cur);return rows;
}
const ALIAS={
  items:{code:['كود','كود المنتج','كود الصنف','code'],name:['اسم','اسم المنتج','اسم الصنف','الصنف','name'],cat:['تصنيف','التصنيف','category'],price:['سعر البيع','السعر','price'],open:['رصيد افتتاحي','الرصيد الافتتاحي','افتتاحي','opening'],min:['حد إعادة الطلب','حد الطلب','min']},
  raws:{code:['كود','كود الخامة','code'],name:['اسم','اسم الخامة','الخامة','name'],unit:['وحدة','وحدة القياس','unit'],price:['سعر الوحدة','سعر','price'],open:['رصيد افتتاحي','الرصيد الافتتاحي','افتتاحي','opening'],min:['حد إعادة الطلب','حد الطلب','min']},
  purch:{date:['تاريخ','التاريخ','date'],code:['كود','كود الصنف','كود الخامة','code'],qty:['كمية','الكمية','qty'],total:['إجمالي التكلفة','الإجمالي','إجمالي','total'],supplier:['مورد','المورد'],invoice:['رقم الفاتورة','فاتورة'],kind:['نوع','النوع','نوع الصنف'],pay:['الدفع','طريقة الدفع']}
};
const TPL={items:['كود','اسم','تصنيف','سعر البيع','رصيد افتتاحي','حد إعادة الطلب'],raws:['كود','اسم','وحدة','سعر الوحدة','رصيد افتتاحي','حد إعادة الطلب'],purch:['تاريخ','كود','الكمية','إجمالي التكلفة','المورد','رقم الفاتورة','نوع','الدفع']};
const TPLN={items:'نموذج-الأصناف.csv',raws:'نموذج-الخامات.csv',purch:'نموذج-المشتريات.csv'};
function mapTable(type,table){
  if(!table.length)return {rows:[],errs:['الملف فارغ']};
  const al=ALIAS[type];const head=table[0].map(h=>String(h==null?'':h).trim().toLowerCase());
  const idx={};Object.keys(al).forEach(k=>{const i=head.findIndex(h=>al[k].some(a=>a.toLowerCase()===h));if(i>=0)idx[k]=i});
  const need=type==='purch'?['code','qty']:['code','name'];const miss=need.filter(k=>!(k in idx));
  if(miss.length)return {rows:[],errs:['لم أجد الأعمدة المطلوبة: '+miss.map(k=>al[k][0]).join('، ')+'. حمّل النموذج واستخدم نفس عناوين الأعمدة.']};
  const g=(r,k)=>k in idx?r[idx[k]]:'';
  const rows=[],errs=[];
  table.slice(1).forEach((r,n)=>{
    const ln=n+2;const code=String(g(r,'code')||'').trim();if(!code&&r.every(x=>String(x).trim()===''))return;
    if(!code){errs.push('سطر '+ln+': بدون كود');return}
    if(type==='items'){const name=String(g(r,'name')||'').trim();if(!name){errs.push('سطر '+ln+': بدون اسم');return}
      rows.push({code,name,cat:String(g(r,'cat')||'').trim(),price:g(r,'price')===''?null:parseNum(g(r,'price')),open:g(r,'open')===''?null:parseNum(g(r,'open')),min:g(r,'min')===''?null:parseNum(g(r,'min'))})}
    else if(type==='raws'){const name=String(g(r,'name')||'').trim();if(!name){errs.push('سطر '+ln+': بدون اسم');return}
      rows.push({code,name,unit:String(g(r,'unit')||'').trim(),price:g(r,'price')===''?null:parseNum(g(r,'price')),open:g(r,'open')===''?null:parseNum(g(r,'open')),min:g(r,'min')===''?null:parseNum(g(r,'min'))})}
    else{const qty=parseNum(g(r,'qty'));if(!(qty>0)){errs.push('سطر '+ln+': كمية غير صحيحة');return}
      const kt=String(g(r,'kind')||'').trim().toLowerCase();let kind=/خام|raw/.test(kt)?'raw':(/صنف|item|منتج/.test(kt)?'item':(S.raws.some(x=>x.code===code)?'raw':'item'));
      const known=kind==='raw'?S.raws.some(x=>x.code===code):S.menu.some(x=>x.code===code);
      if(!known){errs.push('سطر '+ln+': الكود '+code+' غير موجود في '+(kind==='raw'?'الخامات':'الأصناف'));return}
      const date=parseDate(g(r,'date'))||today();
      rows.push({date,code,qty,total:parseNum(g(r,'total')),supplier:String(g(r,'supplier')||'').trim(),invoice:String(g(r,'invoice')||'').trim(),pay:String(g(r,'pay')||'').trim(),kind})}
  });
  return {rows,errs};
}
function loadImportFile(file){
  const type=ui.imp.type;const name=file.name||'';const fr=new FileReader();
  const done=table=>{const m=mapTable(type,table);ui.imp.rows=m.rows;ui.imp.errs=m.errs;ui.imp.fname=name;render()};
  fr.onerror=()=>{toast('تعذرت قراءة الملف')};
  if(/\.(xlsx|xls)$/i.test(name)){
    if(!window.XLSX){toast('مكتبة Excel لم تُحمَّل، احفظ الملف بصيغة CSV');return}
    fr.onload=()=>{try{const wb=XLSX.read(new Uint8Array(fr.result),{type:'array',cellDates:true});const ws=wb.Sheets[wb.SheetNames[0]];done(XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true}))}catch(e){toast('تعذرت قراءة ملف Excel')}};
    fr.readAsArrayBuffer(file);
  }else{fr.onload=()=>done(parseText(String(fr.result||'').replace(/^﻿/,'')));fr.readAsText(file,'utf-8')}
}

/* ---------- daily summary / reports / sellers / import views ---------- */
const PKEY={'نقدي':'cash','بطاقة':'card','تحويل':'tr','آجل':'cr'};
function vDaily(M){
  const R=range(M);const days={};
  const g=d=>days[d]||(days[d]={d,cash:0,card:0,tr:0,cr:0,u:0,sales:0,pays:0,exp:0,pur:0});
  M.sales.filter(s=>R.inr(s.date)).forEach(s=>{const o=g(s.date);o.sales+=s.total;const k=PKEY[s.pay];if(k)o[k]+=s.total;else o.u+=s.total});
  M.pays.filter(p=>R.inr(p.date)).forEach(p=>{g(p.date).pays+=+p.amount||0});
  M.exp.filter(e=>R.inr(e.date)).forEach(e=>{g(e.date).exp+=+e.amount||0});
  M.purch.filter(p=>R.inr(p.date)).forEach(p=>{if(p.pay&&p.pay!=='آجل')g(p.date).pur+=+p.total||0});
  const rows=Object.values(days).sort((a,b)=>a.d<b.d?1:-1);rows.forEach(o=>{o.net=o.cash+o.card+o.tr+o.pays-o.exp-o.pur});
  const T={cash:0,card:0,tr:0,cr:0,u:0,sales:0,pays:0,exp:0,pur:0,net:0};rows.forEach(o=>Object.keys(T).forEach(k=>T[k]+=o[k]));
  const c=v=>'<td class="n">'+(v?money(v):'<span class="muted">—</span>')+'</td>';
  return '<div class="row" style="align-items:center"><h2>الملخص اليومي</h2><span class="sp"></span>'+rangeBar(M,R)+'</div>'+
  (T.u>0?'<div class="alert">مبيعات بقيمة '+money(T.u)+' بدون طريقة دفع لم تدخل في صافي النقدية. حدد طريقة دفعها من سجل المبيعات ليكتمل الحساب.</div>':'')+
  '<div class="kpis"><div class="kpi main"><div class="l">صافي الحركة النقدية</div><div class="v">'+N(money(T.net))+'</div><div class="s">مقبوضات − مصروفات − مشتريات مدفوعة</div></div><div class="kpi"><div class="l">مبيعات مقبوضة</div><div class="v">'+N(money(T.cash+T.card+T.tr))+'</div><div class="s">نقدي وبطاقة وتحويل</div></div><div class="kpi"><div class="l">سداد من عملاء الآجل</div><div class="v">'+N(money(T.pays))+'</div></div><div class="kpi"><div class="l">مبيعات آجلة</div><div class="v">'+N(money(T.cr))+'</div><div class="s">لم تُقبض بعد</div></div></div>'+
  '<div class="card"><header><h3>حركة كل يوم</h3><span class="sp"></span><button class="btn sm" data-act="exp-daily">تصدير CSV</button></header><div class="tbl"><table><thead><tr><th>التاريخ</th><th class="n">نقدي</th><th class="n">بطاقة</th><th class="n">تحويل</th><th class="n">آجل</th><th class="n">غير محدد</th><th class="n">إجمالي المبيعات</th><th class="n">سداد آجل</th><th class="n">مصروفات</th><th class="n">مشتريات مدفوعة</th><th class="n">صافي النقدية</th></tr></thead><tbody>'+
   rows.map(o=>'<tr><td>'+fd(o.d)+'</td>'+c(o.cash)+c(o.card)+c(o.tr)+c(o.cr)+c(o.u)+'<td class="n b">'+money(o.sales)+'</td>'+c(o.pays)+c(o.exp)+c(o.pur)+'<td class="n b '+(o.net<0?'neg':'')+'">'+money(o.net)+'</td></tr>').join('')+
   '</tbody><tfoot><tr><td>الإجمالي</td><td class="n">'+money(T.cash)+'</td><td class="n">'+money(T.card)+'</td><td class="n">'+money(T.tr)+'</td><td class="n">'+money(T.cr)+'</td><td class="n">'+money(T.u)+'</td><td class="n">'+money(T.sales)+'</td><td class="n">'+money(T.pays)+'</td><td class="n">'+money(T.exp)+'</td><td class="n">'+money(T.pur)+'</td><td class="n">'+money(T.net)+'</td></tr></tfoot></table></div>'+
   '<p class="sm muted">المبيعات بدون طريقة دفع («غير محدد») والمشتريات بدون طريقة دفع لا تدخل في صافي النقدية حتى تحدد طريقتها.</p></div>';
}
function reportData(M,R){
  const K=kpis(M,R);const cat={},it={},sel={};
  K.ss.forEach(s=>{const i=M.itemMap.get(s.code);const cost=(+s.qty||0)*M.unitCost(s.code);
    const c=(i&&i.cat)||'غير مصنف';(cat[c]||(cat[c]={n:c,q:0,t:0,c:0}));cat[c].q+=+s.qty||0;cat[c].t+=s.total;cat[c].c+=cost;
    (it[s.code]||(it[s.code]={n:itemName(M,s.code),code:s.code,q:0,t:0,c:0}));it[s.code].q+=+s.qty||0;it[s.code].t+=s.total;it[s.code].c+=cost;
    (sel[s.by]||(sel[s.by]={n:who(s.by),q:0,t:0,k:0}));sel[s.by].t+=s.total;sel[s.by].k++});
  return {K,cat:Object.values(cat).sort((a,b)=>b.t-a.t),it:Object.values(it).sort((a,b)=>b.t-a.t),sel:Object.values(sel).sort((a,b)=>b.t-a.t)};
}
function vReports(M){
  const R=range(M),D=reportData(M,R),K=D.K;
  const pm=(t,c)=>t?((1-c/t)*100).toFixed(0)+'%':'—';
  const tbl=(rows,first)=>'<div class="tbl" style="max-height:420px"><table><thead><tr><th>'+first+'</th><th class="n">الكمية</th><th class="n">المبيعات</th><th class="n">التكلفة</th><th class="n">الربح</th><th class="n">الهامش</th></tr></thead><tbody>'+
    rows.map(x=>'<tr><td>'+esc(x.n)+'</td><td class="n">'+qn(x.q)+'</td><td class="n">'+money(x.t)+'</td><td class="n">'+money(x.c)+'</td><td class="n b '+(x.t-x.c<0?'neg':'')+'">'+money(x.t-x.c)+'</td><td class="n">'+pm(x.t,x.c)+'</td></tr>').join('')+'</tbody></table></div>';
  return '<div class="row" style="align-items:center"><h2>التقارير</h2><span class="sp"></span>'+rangeBar(M,R)+'</div>'+
  '<div class="card"><header><h3>ملخص الفترة'+(R.f?' ('+fd(R.f)+' إلى '+fd(R.t)+')':'')+'</h3></header><div class="tbl"><table><tbody>'+
   '<tr><td>إجمالي المبيعات</td><td class="n">'+money(K.sales)+'</td></tr><tr><td>تكلفة المبيعات (من أسعار الشراء والوصفات)</td><td class="n">'+money(K.cogs)+'</td></tr>'+
   '<tr><td class="b">الربح الإجمالي التقديري</td><td class="n b">'+money(K.prof)+'</td></tr><tr><td>هامش الربح</td><td class="n">'+(K.margin*100).toFixed(1)+'%</td></tr>'+
   '<tr><td>المصروفات</td><td class="n">'+money(K.expn)+'</td></tr><tr><td class="b">صافي الربح التقديري بعد المصروفات</td><td class="n b '+(K.net<0?'neg':'')+'">'+money(K.net)+'</td></tr>'+
   '<tr><td>المشتريات في الفترة (للعلم، ليست مصروفاً)</td><td class="n">'+money(K.pur)+'</td></tr></tbody></table></div></div>'+
  '<div class="grid g2"><div class="card"><header><h3>حسب التصنيف</h3></header>'+tbl(D.cat,'التصنيف')+'</div><div class="card"><header><h3>حسب البائع</h3></header><div class="tbl"><table><thead><tr><th>البائع</th><th class="n">حركات</th><th class="n">المبيعات</th></tr></thead><tbody>'+D.sel.map(x=>'<tr><td>'+esc(x.n)+'</td><td class="n">'+x.k+'</td><td class="n">'+money(x.t)+'</td></tr>').join('')+'</tbody></table></div></div></div>'+
  '<div class="card"><header><h3>ربحية الأصناف</h3><span class="sp"></span><button class="btn sm" data-act="exp-items">تصدير CSV</button><button class="btn sm" data-act="exp-sales">تصدير المبيعات CSV</button></header>'+tbl(D.it,'الصنف')+'</div>';
}
function vSellers(M){
  const ids=[...new Set([...S.staff,uid].filter(Boolean))];
  const td=today();
  const rows=ids.map(u=>{const ds=Object.values(S.salesBy[u]||{});let all=0,tdv=0,n=0,last=0;
    ds.forEach(d=>(d.rows||[]).forEach(r=>{const t=r.qty*r.price;all+=t;n++;if(d.date===td)tdv+=t}));ds.forEach(d=>{if((d.ts||0)>last)last=d.ts});
    return {u,name:who(u),all,tdv,n,last}}).sort((a,b)=>b.all-a.all);
  const imp=Object.values(S.salesBy.import||{});let ia=0,inn=0;imp.forEach(d=>(d.rows||[]).forEach(r=>{ia+=r.qty*r.price;inn++}));
  return '<h2>البائعون</h2><div class="card"><header><h3>فريق العمل</h3></header>'+
   '<div class="tbl"><table><thead><tr><th>البائع</th><th class="n">حركات</th><th class="n">مبيعات اليوم</th><th class="n">إجمالي المبيعات</th><th>آخر عملية</th></tr></thead><tbody>'+
   rows.map(x=>'<tr><td>'+esc(x.name)+(x.u===uid?' <span class="chip gray">أنت</span>':'')+'</td><td class="n">'+x.n+'</td><td class="n">'+money(x.tdv)+'</td><td class="n">'+money(x.all)+'</td><td class="sm muted">'+(x.last?new Date(x.last).toLocaleString('ar-EG',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—')+'</td></tr>').join('')+
   (inn?'<tr><td>مستورد من الملف</td><td class="n">'+inn+'</td><td class="n">0</td><td class="n">'+money(ia)+'</td><td class="muted">—</td></tr>':'')+'</tbody></table></div></div>'+
  MZ.teamHTML();
}
function vImport(M){
  const im=ui.imp||(ui.imp={type:'items',rows:[],errs:[],fname:'',text:''});
  const t=im.type;const nm={items:'أصناف',raws:'خامات',purch:'مشتريات'};
  const cols=TPL[t].join(' | ');
  const prev=im.rows.slice(0,12);
  const keys=t==='items'?['code','name','cat','price','open','min']:t==='raws'?['code','name','unit','price','open','min']:['date','code','qty','total','supplier','invoice','kind','pay'];
  const lbl=TPL[t];
  return '<h2>استيراد البيانات</h2><div class="card"><header><h3>ما الذي تستورده؟</h3><span class="sp"></span><div class="seg">'+Object.keys(nm).map(k=>'<button data-act="imptype" data-v="'+k+'" aria-pressed="'+(t===k)+'">'+nm[k]+'</button>').join('')+'</div></header>'+
   '<div class="list"><div class="sm muted">الأعمدة المطلوبة بالترتيب: '+esc(cols)+'. الأصناف والخامات تُحدَّث بالكود إن كانت موجودة، وتُضاف إن كانت جديدة. المشتريات تُضاف كفواتير جديدة ويجب أن تكون أكوادها موجودة.</div>'+
   '<div class="row"><button class="btn" data-act="imptpl">تحميل النموذج</button></div>'+
   '<div class="drop"><div class="field"><label for="impf">ارفع ملف Excel أو CSV</label><input id="impf" type="file" accept=".csv,.txt,.xlsx,.xls" data-imp="file"></div></div>'+
   '<div class="field"><label for="impt">أو الصق البيانات من جدول (مع صف العناوين)</label><textarea id="impt" data-imp="text" placeholder="الصق هنا">'+esc(im.text||'')+'</textarea></div>'+
   '<div class="row"><button class="btn" data-act="impparse">قراءة المنسوخ</button></div></div></div>'+
  (im.fname||im.rows.length||im.errs.length?'<div class="card"><header><h3>معاينة'+(im.fname?': '+esc(im.fname):'')+'</h3><span class="sp"></span><span class="chip good">'+im.rows.length+' سطر جاهز</span>'+(im.errs.length?'<span class="chip bad">'+im.errs.length+' بها مشكلة</span>':'')+'</header>'+
   (im.errs.length?'<div class="list" style="margin-bottom:12px">'+im.errs.slice(0,8).map(e=>'<div class="alert bad">'+esc(e)+'</div>').join('')+(im.errs.length>8?'<div class="muted sm">وأخطاء أخرى غير معروضة.</div>':'')+'</div>':'')+
   (prev.length?'<div class="tbl"><table><thead><tr>'+lbl.map(l=>'<th>'+esc(l)+'</th>').join('')+'</tr></thead><tbody>'+prev.map(r=>'<tr>'+keys.map(k=>'<td>'+esc(r[k]==null?'':(k==='kind'?(r[k]==='raw'?'خامة':'صنف'):r[k]))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':'')+
   '<div class="row" style="margin-top:12px"><button class="btn pri" data-act="impgo" '+(im.rows.length?'':'disabled')+'>استيراد '+im.rows.length+' سطر</button><button class="btn" data-act="impclear">مسح</button></div></div>':'');
}

/* ---------- shell ---------- */
const TABS=[['home','لوحة التحكم'],['sales','المبيعات'],['purch','المشتريات'],['exp','المصروفات'],['credit','الآجل'],['stock','المخزون'],['daily','الملخص اليومي'],['reports','التقارير'],['cat','الأصناف والوصفات'],['sellers','الفريق والبائعون'],['import','استيراد'],['account','الاشتراك']];
function render(){
  const root=$('#root');
  if(!db){root.innerHTML='<div class="card empty" style="margin-top:24px">هذا التطبيق يحتاج تسجيل الدخول وصلاحية الكتابة. افتح الرابط من حسابك أو اطلب دعوة من المدير.</div>';return}
  if(!S.ready['menu/items']&&!S.slow){root.innerHTML='<div class="load">جارٍ تحميل البيانات…</div>';return}
  const mgr=role==='manager';
  const scrollY=window.scrollY;
  let M=null;try{M=model()}catch(e){console.error(e)}
  let main='';
  if(role==='viewer')main='<div class="card empty">حسابك يسمح بالاطلاع فقط. اطلب من المدير رفع صلاحيتك إلى «مساهم» لتسجيل المبيعات.</div>';
  else if(!mgr)main=vCashier(M);
  else main=({home:vHome,sales:vSales,purch:vPurch,exp:vExp,credit:vCredit,stock:vStock,daily:vDaily,reports:vReports,sellers:vSellers,import:vImport,cat:vCatalog,account:()=>MZ.accountView()}[ui.tab]||vHome)(M);
  if(MZ.locked())main=mgr?MZ.accountView():MZ.lockedMsg();
  else if(mgr&&ui.tab==='home'&&!S.menu.length&&S.ready['menu/items'])main=MZ.onboard()+main;
  const slow=S.slow&&!S.ready['menu/items']?'<div class="alert" style="margin-top:16px">تعذر الوصول إلى البيانات حتى الآن. قد تكون الأرقام غير محدثة.</div>':'';
  root.innerHTML='<header class="top"><div class="bar"><div class="brand">'+MZ.brand()+'</div><span class="sp"></span><span class="chip '+(mgr?'':'gray')+'">'+(mgr?'المدير':role==='cashier'?'كاشير':'اطلاع فقط')+'</span>'+MZ.logoutBtn()+'</div>'+
   (mgr?'<nav class="tabs" role="tablist">'+TABS.map(t=>'<button role="tab" data-act="tab" data-v="'+t[0]+'" aria-selected="'+((MZ.locked()?'account':ui.tab)===t[0])+'">'+t[1]+'</button>').join('')+'</nav>':'')+'</header>'+MZ.banner()+slow+'<main>'+main+'</main>';
  window.scrollTo(0,scrollY);
}

/* ---------- actions ---------- */
const A={
  tab:e=>{ui.tab=e.dataset.v;ui.edit=null;render();window.scrollTo(0,0)},
  preset:e=>{ui.preset=e.dataset.v;render()},
  cat:e=>{F.sale.cat=e.dataset.v;render()},
  add:e=>{const c=e.dataset.v;const it=S.menu.find(i=>i.code===c);if(!it)return;const l=F.sale.cart.find(x=>x.code===c&&+x.price===+it.price);if(l)l.qty=(+l.qty||0)+1;else F.sale.cart.push({code:c,qty:1,price:it.price});render()},
  rm:e=>{F.sale.cart.splice(+e.dataset.i,1);render()},
  clearcart:()=>{F.sale.cart=[];render()},
  pay:e=>{F.sale.pay=e.dataset.v;render()},
  savesale:()=>{
    const f=F.sale;const rows=f.cart.filter(l=>+l.qty>0).map(l=>({code:l.code,qty:+l.qty,price:+l.price||0,cust:f.cust.trim(),pay:f.pay,note:f.note.trim()}));
    if(!rows.length){toast('أضف صنفاً بكمية صحيحة');return}
    if(f.pay==='آجل'&&!f.cust.trim()){toast('اكتب اسم العميل للبيع الآجل');return}
    const date=role==='manager'?(f.date||today()):today();
    const own=Object.values(S.salesBy[uid]||{}).filter(d=>d.date===date).length;
    ui.invSeq=ui.invSeq||{};const n=Math.max(own,ui.invSeq[date]||0)+1;ui.invSeq[date]=n;
    const inv=date.slice(2).replace(/-/g,'')+'-'+String(uid||'x').slice(-2).toUpperCase()+pad(n);
    const data={date,rows,ts:Date.now(),inv};
    ui.receipt={inv,date,rows,pay:f.pay,cust:f.cust.trim()};clearTimeout(ui.rt);ui.rt=setTimeout(()=>{ui.receipt=null;render()},20000);
    f.cart=[];f.cust='';f.note='';f.pay='نقدي';render();window.scrollTo(0,0);
    enqueue(async()=>{await db.collection('sales/'+uid+'/lines').add(data);toast('تم تسجيل البيع')});
  },
  delsaledoc:e=>{const p=e.dataset.p;enqueue(async()=>{await db.doc(p).delete();toast('تم الإلغاء')})},
  delrow:e=>{const p=e.dataset.p,i=+e.dataset.i;enqueue(async()=>{const r=db.doc(p);const g=await r.get();if(!g.exists)return;const d=Object.assign({},g.data());d.rows=d.rows.filter((_,k)=>k!==i);if(d.rows.length)await r.set(d);else await r.delete();toast('تم الحذف')})},
  padd:()=>{F.purch.rows.push({kind:'item',code:'',qty:'',total:''});render()},
  prm:e=>{F.purch.rows.splice(+e.dataset.i,1);if(!F.purch.rows.length)F.purch.rows.push({kind:'item',code:'',qty:'',total:''});render()},
  savepurch:()=>{
    const f=F.purch;const rows=f.rows.filter(r=>r.code&&+r.qty>0).map(r=>({code:r.code,qty:+r.qty,total:+r.total||0,kind:r.kind,note:''}));
    if(!rows.length){toast('أضف صنفاً وكمية');return}
    const data={date:f.date||today(),supplier:f.sup.trim(),invoice:f.inv.trim(),pay:f.pay,rows};
    F.purch={date:today(),sup:'',inv:'',pay:'',rows:[{kind:'item',code:'',qty:'',total:''}]};render();
    enqueue(async()=>{await db.collection('purchases').add(data);toast('تم حفظ فاتورة المشتريات')});
  },
  saveexp:()=>{
    const f=F.exp;if(!f.type.trim()||!(+f.amount>0)){toast('اكتب نوع المصروف والمبلغ');return}
    const data={date:f.date||today(),rows:[{type:f.type.trim(),desc:f.desc.trim(),amount:+f.amount,pay:f.pay}]};
    F.exp.type='';F.exp.desc='';F.exp.amount='';render();
    enqueue(async()=>{await db.collection('expenses').add(data);toast('تم حفظ المصروف')});
  },
  cust:e=>{ui.cust=e.dataset.v===''?null:e.dataset.v;F.pay.cust='';render()},
  savepay:()=>{
    const f=F.pay;const c=(f.cust||(ui.cust&&ui.cust!=='(بدون اسم)'?ui.cust:'')).trim();
    if(!c||!(+f.amount>0)){toast('اختر العميل واكتب المبلغ');return}
    const data={date:f.date||today(),cust:c,amount:+f.amount,method:f.method,note:f.note.trim()};
    F.pay.amount='';F.pay.note='';render();
    enqueue(async()=>{await db.collection('payments').add(data);toast('تم تسجيل السداد')});
  },
  delpay:e=>{const p=e.dataset.p;enqueue(async()=>{await db.doc(p).delete();toast('تم الحذف')})},
  stock:e=>{ui.stock=e.dataset.v;render()},
  catv:e=>{ui.cat=e.dataset.v;ui.edit=null;render()},
  edititem:e=>{const i=S.menu.find(x=>x.code===e.dataset.v);ui.edit=Object.assign({t:'item'},i);render();window.scrollTo(0,0)},
  saveitem:()=>{
    const e=ui.edit||{t:'item'};const g=id=>$('#'+id).value;const code=g('ic').trim();if(!code||!g('in').trim()){toast('اكتب الكود والاسم');return}
    const isNew=!S.menu.some(i=>i.code===code);
    const it={code,name:g('in').trim(),cat:g('icat').trim()||'منتجات أخرى',price:+g('ip')||0,open:+g('io')||0,min:+g('im')||0};
    const list=isNew?[...S.menu,it]:S.menu.map(i=>i.code===code?it:i);ui.edit=null;
    enqueue(async()=>{await db.doc('menu/items').set({list});toast('تم حفظ الصنف')});
  },
  delitem:e=>{const c=e.dataset.v;if(ui.del!==c){ui.del=c;toast('اضغط حذف مرة ثانية للتأكيد');setTimeout(()=>{ui.del=null},3000);return}
    ui.del=null;const list=S.menu.filter(i=>i.code!==c);enqueue(async()=>{await db.doc('menu/items').set({list});toast('تم حذف الصنف')})},
  reclineqty:null,
  closerc:()=>{ui.receipt=null;clearTimeout(ui.rt);render()},
  'exp-daily':()=>{const M=model(),R=range(M);const days={};const g=d=>days[d]||(days[d]={d,cash:0,card:0,tr:0,cr:0,u:0,sales:0,pays:0,exp:0,pur:0});
    M.sales.filter(s=>R.inr(s.date)).forEach(s=>{const o=g(s.date);o.sales+=s.total;const k=PKEY[s.pay];if(k)o[k]+=s.total;else o.u+=s.total});
    M.pays.filter(p=>R.inr(p.date)).forEach(p=>{g(p.date).pays+=+p.amount||0});M.exp.filter(e=>R.inr(e.date)).forEach(e=>{g(e.date).exp+=+e.amount||0});
    M.purch.filter(p=>R.inr(p.date)).forEach(p=>{if(p.pay&&p.pay!=='آجل')g(p.date).pur+=+p.total||0});
    const rows=Object.values(days).sort((a,b)=>a.d<b.d?-1:1).map(o=>[o.d,o.cash,o.card,o.tr,o.cr,o.u,o.sales,o.pays,o.exp,o.pur,o.cash+o.card+o.tr+o.pays-o.exp-o.pur]);
    saveCsv('الملخص-اليومي.csv',[['التاريخ','نقدي','بطاقة','تحويل','آجل','غير محدد','إجمالي المبيعات','سداد آجل','مصروفات','مشتريات مدفوعة','صافي النقدية'],...rows])},
  'exp-items':()=>{const M=model(),D=reportData(M,range(M));saveCsv('ربحية-الأصناف.csv',[['الكود','الصنف','الكمية','المبيعات','التكلفة','الربح'],...D.it.map(x=>[x.code,x.n,x.q,x.t,x.c,x.t-x.c])])},
  'exp-sales':()=>{const M=model(),R=range(M);saveCsv('المبيعات.csv',[['التاريخ','الفاتورة','الكود','الصنف','الكمية','السعر','الإجمالي','العميل','الدفع','المُدخِل'],...M.sales.filter(s=>R.inr(s.date)).map(s=>[s.date,s.inv,s.code,itemName(M,s.code),s.qty,s.price,s.total,s.cust,s.pay,who(s.by)])])},
  imptype:e=>{ui.imp={type:e.dataset.v,rows:[],errs:[],fname:'',text:''};render()},
  imptpl:()=>{const t=(ui.imp||{type:'items'}).type;saveCsv(TPLN[t],[TPL[t]])},
  impparse:()=>{const im=ui.imp||(ui.imp={type:'items',rows:[],errs:[],fname:'',text:''});const el=$('#impt');const tx=el?el.value:im.text;im.text=tx;if(!tx.trim()){toast('الصق البيانات أولاً');return}
    const m=mapTable(im.type,parseText(tx));im.rows=m.rows;im.errs=m.errs;im.fname='بيانات ملصوقة';render()},
  impclear:()=>{ui.imp={type:(ui.imp||{}).type||'items',rows:[],errs:[],fname:'',text:''};render()},
  impgo:()=>{
    const im=ui.imp;if(!im||!im.rows.length)return;const t=im.type,rows=im.rows;ui.imp={type:t,rows:[],errs:[],fname:'',text:''};render();
    if(t==='items'){const list=S.menu.map(x=>Object.assign({},x));let add=0,upd=0;
      rows.forEach(r=>{const i=list.findIndex(x=>x.code===r.code);if(i>=0){const o=list[i];o.name=r.name||o.name;if(r.cat)o.cat=r.cat;if(r.price!=null)o.price=r.price;if(r.open!=null)o.open=r.open;if(r.min!=null)o.min=r.min;upd++}
        else{list.push({code:r.code,name:r.name,cat:r.cat||'منتجات أخرى',price:r.price||0,open:r.open||0,min:r.min||0});add++}});
      enqueue(async()=>{await db.doc('menu/items').set({list});toast('تمت إضافة '+add+' وتحديث '+upd+' صنف')})}
    else if(t==='raws'){const list=S.raws.map(x=>Object.assign({},x));let add=0,upd=0;
      rows.forEach(r=>{const i=list.findIndex(x=>x.code===r.code);if(i>=0){const o=list[i];o.name=r.name||o.name;if(r.unit)o.unit=r.unit;if(r.price!=null)o.price=r.price;if(r.open!=null)o.open=r.open;if(r.min!=null)o.min=r.min;upd++}
        else{list.push({code:r.code,name:r.name,cat:'',unit:r.unit||'جرام',price:r.price||0,open:r.open||0,min:r.min||0});add++}});
      enqueue(async()=>{await db.doc('catalog/raws').set({list});toast('تمت إضافة '+add+' وتحديث '+upd+' خامة')})}
    else{const grp={};rows.forEach(r=>{const k=[r.date,r.supplier,r.invoice,r.pay].join('|');(grp[k]||(grp[k]={date:r.date,supplier:r.supplier,invoice:r.invoice,pay:r.pay,rows:[]})).rows.push({code:r.code,qty:r.qty,total:r.total,kind:r.kind,note:'مستورد من ملف'})});
      const docs=Object.values(grp);enqueue(async()=>{for(const d of docs)await db.collection('purchases').add(d);toast('تم استيراد '+rows.length+' سطر في '+docs.length+' فاتورة')})}
  },
  recrm:e=>{const code=curRec();const m=Object.assign({},S.recipes);m[code]=(m[code]||[]).filter((_,i)=>i!==+e.dataset.i);if(!m[code].length)delete m[code];enqueue(async()=>{await db.doc('catalog/recipes').set({map:m})})},
  recadd:()=>{const code=curRec();const r=$('#rr').value,q=+$('#rq').value;if(!r||!(q>0)){toast('اختر الخامة واكتب الكمية');return}
    const m=Object.assign({},S.recipes);m[code]=[...(m[code]||[]),{raw:r,qty:q}];enqueue(async()=>{await db.doc('catalog/recipes').set({map:m});toast('تمت الإضافة')})},
  editraw:e=>{const r=S.raws.find(x=>x.code===e.dataset.v);ui.edit=Object.assign({t:'raw'},r);render();window.scrollTo(0,0)},
  saveraw:()=>{
    const g=id=>$('#'+id).value;const code=g('xc').trim();if(!code||!g('xn').trim()){toast('اكتب الكود والاسم');return}
    const isNew=!S.raws.some(r=>r.code===code);const r={code,name:g('xn').trim(),cat:'',unit:g('xu'),price:+g('xp')||0,open:+g('xo')||0,min:+g('xm')||0,packName:g('xk').trim(),packSize:+g('xs')||0};
    const old=S.raws.find(x=>x.code===code);if(old)r.cat=old.cat;
    const list=isNew?[...S.raws,r]:S.raws.map(x=>x.code===code?r:x);ui.edit=null;
    enqueue(async()=>{await db.doc('catalog/raws').set({list});toast('تم حفظ الخامة')});
  },
  delraw:e=>{const c=e.dataset.v;if(ui.del!==c){ui.del=c;toast('اضغط حذف مرة ثانية للتأكيد');setTimeout(()=>{ui.del=null},3000);return}
    ui.del=null;const list=S.raws.filter(r=>r.code!==c);enqueue(async()=>{await db.doc('catalog/raws').set({list});toast('تم حذف الخامة')})}
};
function curRec(){return ui.recItem||(S.menu.find(i=>S.recipes[i.code])||S.menu[0]||{}).code||''}
document.addEventListener('click',ev=>{const b=ev.target.closest('[data-act]');if(!b||!$('#root').contains(b))return;const fn=A[b.dataset.act];if(fn){ev.stopPropagation();fn(b)}});
/* inputs */
function onInput(ev){
  const t=ev.target;if(!$('#root').contains(t))return;
  if(t.dataset.f){let v=t.value;setPath(F,t.dataset.f,v);
    if(t.dataset.sum){const tot=F.sale.cart.reduce((a,l)=>a+(+l.qty||0)*(+l.price||0),0);const el=$('#cartTotal');if(el)el.innerHTML=N(money(tot))}
    if(t.dataset.pack!=null&&t.dataset.pack!==''){const i=+t.dataset.pack;const r=F.purch.rows[i];const pk=packOf(r.code);if(pk){r.qty=String(Math.round((+t.value||0)*pk.size*1000)/1000);const q=document.querySelector('[data-f="purch.rows.'+i+'.qty"]');if(q)q.value=r.qty}}
    if(t.dataset.psum){const tot=F.purch.rows.reduce((a,r)=>a+(+r.total||0),0);const el=$('#pTotal');if(el)el.innerHTML=N(money(tot))}
    if(t.dataset.keep&&ev.type==='input'){render();const n=$('#'+t.id);if(n){n.focus();try{n.setSelectionRange(v.length,v.length)}catch(e){}}}
    if(ev.type==='change'&&(t.dataset.r||t.tagName==='SELECT'&&t.dataset.f.indexOf('purch.rows')===0&&t.dataset.f.endsWith('.kind'))){
      if(t.dataset.f.endsWith('.kind')){const i=+t.dataset.f.split('.')[2];F.purch.rows[i].code=''}render()}
  }
  if(t.dataset.ui){ui[t.dataset.ui]=t.value;if(t.dataset.ui==='from'||t.dataset.ui==='to')ui.preset='custom';
    if(ev.type==='change'||t.dataset.ui==='sq'||t.dataset.ui==='q'){const id=t.id,v=t.value;render();const n=$('#'+id);if(n&&t.type==='search'){n.focus();try{n.setSelectionRange(v.length,v.length)}catch(e){}}}}
  if(t.dataset.e&&ui.edit){ui.edit[t.dataset.e]=t.value}
  if(t.dataset.imp==='file'&&ev.type==='change'&&t.files&&t.files[0]){if(!ui.imp)ui.imp={type:'items',rows:[],errs:[],fname:'',text:''};loadImportFile(t.files[0])}
  if(t.dataset.imp==='text'){(ui.imp||(ui.imp={type:'items',rows:[],errs:[],fname:'',text:''})).text=t.value}
  if(t.dataset.actChange==='setpay'&&ev.type==='change'&&t.value){const pth=t.dataset.p,i=+t.dataset.i,v=t.value;
    if(v==='آجل'){toast('للبيع الآجل احذف السطر وسجله باسم العميل');t.value='';return}
    enqueue(async()=>{const r=db.doc(pth);const g=await r.get();if(!g.exists)return;const d=Object.assign({},g.data());d.rows=d.rows.map((x,k)=>k===i?Object.assign({},x,{pay:v}):x);await r.set(d);toast('تم تحديد طريقة الدفع')})}
  if(t.dataset.actChange==='reclineqty'&&ev.type==='change'){const code=curRec();const m=Object.assign({},S.recipes);m[code]=(m[code]||[]).map((l,i)=>i===+t.dataset.i?{raw:l.raw,qty:+t.value||0}:l);enqueue(async()=>{await db.doc('catalog/recipes').set({map:m})})}
}
document.addEventListener('input',onInput);document.addEventListener('change',onInput);

/* ---------- boot ---------- */
async function boot(){
  try{
    if(!(window.claude&&window.claude.use)){render();return}
    db=await window.claude.use('db');user=await window.claude.use('user');
    if(!db){render();return}
    uid=user?await user.id():null;
    const edit=user?await user.canEdit():false;
    let w=null;try{w=user?await user.can('data.write'):null}catch(e){}
    role=edit?'manager':(w===false?'viewer':'cashier');
    if(role==='cashier'&&!uid)role='viewer';
    if(edit&&!uid){/* manager without id still reads everything */}
    render();await start();
  }catch(e){console.error(e);render()}
}
boot();
/* keep customers lookup in sync for cashiers */
setInterval(async()=>{if(role!=='manager'||!db)return;try{
  const names=[...new Set(Object.keys(S.salesBy).flatMap(u=>Object.values(S.salesBy[u]).flatMap(d=>(d.rows||[]).map(r=>(r.cust||'').trim()))).filter(Boolean))].sort();
  const cur=S.customers.slice().sort();
  if(S.ready['lookup/customers']&&Object.keys(S.salesBy).length&&JSON.stringify(names)!==JSON.stringify(cur)&&names.length){S.customers=names;await db.doc('lookup/customers').set({names})}
}catch(e){}},8000);
})();

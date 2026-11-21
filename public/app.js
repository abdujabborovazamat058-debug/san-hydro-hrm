(function(){
'use strict';
var app=document.getElementById('app'),mroot=document.getElementById('modal-root');
var me=null,view='',month=new Date().toISOString().slice(0,7),attDate='',q='';
var cache={};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function fmt(n){return Math.round(n).toLocaleString('en-US').replace(/,/g,' ');}
function pad(n){return String(n).padStart(2,'0');}
function toMin(h){var p=String(h).split(':').map(Number);return p[0]*60+p[1];}
function init2(n){return String(n||'?').split(/\s+/).filter(Boolean).slice(0,2).map(function(w){return w.charAt(0).toUpperCase();}).join('');}
function av(e,cls){return e&&e.photo?'<img class="av '+(cls||'')+'" src="'+esc(e.photo)+'" alt="">':'<span class="av '+(cls||'')+'">'+esc(init2(e&&e.name))+'</span>';}
var toastT;function toast(m){var t=document.getElementById('toast');t.textContent=m;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(function(){t.hidden=true;},3200);}
function $(id){return document.getElementById(id);}

function api(method,url,body){
  var o={method:method,credentials:'same-origin',headers:{}};
  if(body!==undefined){o.headers['Content-Type']='application/json';o.body=JSON.stringify(body);}
  return fetch(url,o).then(function(r){
    return r.json().catch(function(){return {};}).then(function(j){
      if(r.ok)return j;
      if(r.status===401&&url!=='/api/login'){me=null;renderLogin();}
      var e=new Error(j.error||'server_error');e.code=j.error||'server_error';throw e;
    });
  },function(){var e=new Error('network');e.code='network';throw e;});
}
function fail(e){toast(errText(e&&e.code));}

/* ---------- kirish ---------- */
function langSeg(){return '<div class="seg" role="group" aria-label="'+T('lang')+'"><button data-lang="uz" aria-pressed="'+(getLang()==='uz')+'">UZ</button><button data-lang="ru" aria-pressed="'+(getLang()==='ru')+'">RU</button></div>';}
function renderLogin(){
  mroot.innerHTML='';
  app.innerHTML='<div class="login"><div class="row" style="justify-content:space-between"><h1 class="brand">'+T('app')+'</h1>'+langSeg()+'</div>'
   +'<form class="card" id="lf"><h2>'+T('login')+'</h2><label class="f">'+T('username')+'<input id="lu" autocomplete="username" autocapitalize="characters" required></label>'
   +'<label class="f" style="margin-top:10px">'+T('password')+'<input id="lp" type="password" autocomplete="current-password" required></label>'
   +'<div id="le" class="msg no" role="alert" hidden></div><button class="btn p big" style="margin-top:14px" type="submit">'+T('signin')+'</button></form></div>';
}
document.addEventListener('submit',function(ev){
  if(ev.target.id!=='lf')return;ev.preventDefault();
  api('POST','/api/login',{username:$('lu').value.trim(),password:$('lp').value}).then(function(){return boot();}).catch(function(e){var el=$('le');if(el){el.hidden=false;el.textContent=errText(e.code);}});
});

/* ---------- qobiq ---------- */
function isHr(){return me&&(me.role==='admin'||me.role==='hr');}
function tabs(){return isHr()?[['panel','n_panel'],['emps','n_emps'],['att','n_att'],['pay','n_pay'],['cand','n_cand'],['set','n_set']]:[['me','n_me']];}
function shell(){
  var t=tabs();
  app.innerHTML='<div class="shell"><div class="bar"><div class="brand">'+T('app')+'</div><div class="row" style="margin:0">'+langSeg()+'<span class="muted">'+esc(me.name)+'</span><button class="btn sm" data-act="logout">'+T('logout')+'</button></div></div>'
   +'<div id="main"></div></div>'
   +'<nav class="nav" aria-label="menu">'+t.map(function(x){return '<a href="#'+x[0]+'" data-v="'+x[0]+'"'+(x[0]===view?' aria-current="page"':'')+'>'+T(x[1])+'</a>';}).join('')+'</nav>';
}
function go(){
  if(!me)return;
  var h=(location.hash||'').slice(1),t=tabs().map(function(x){return x[0];});
  view=t.indexOf(h)>=0?h:t[0];
  shell();
  var m=$('main');
  var fn={panel:vPanel,emps:vEmps,att:vAtt,pay:vPay,cand:vCand,set:vSet,me:vMe}[view];
  fn(m);
}
function boot(){
  return api('GET','/api/me').then(function(j){me=j;attDate=j.today.date;go();}).catch(function(){renderLogin();});
}

/* ---------- xodim ---------- */
function vMe(m){
  var e=me.emp,pid='';
  m.innerHTML='<div class="card"><h2>'+T('m_hello',esc(me.name))+'</h2><div id="today" class="muted">…</div>'
   +(e&&!e.hasFace?'<div class="msg w">'+T('m_noface')+'</div>':'<button class="btn p big" style="margin-top:12px" data-act="punch">'+T('m_punch')+'</button>')+'</div>'
   +'<div class="card"><h2>'+T('m_hist')+'</h2><div id="hist"></div></div>';
  api('GET','/api/attendance?month='+month).then(function(rows){
    rows.sort(function(a,b){return b.date<a.date?-1:1;});
    var t=rows.filter(function(r){return r.date===me.today.date;})[0];
    $('today').innerHTML=t?T('m_in')+': <b>'+(t.in||'—')+'</b> · '+T('m_out')+': <b>'+(t.out||'—')+'</b>':T('m_none');
    $('hist').innerHTML=rows.length?'<div class="tw" style="margin:0"><table style="min-width:0"><tbody>'+rows.map(function(r){return '<tr><td>'+r.date+'</td><td class="num">'+(r.in||'—')+'</td><td class="num">'+(r.out||'—')+'</td></tr>';}).join('')+'</tbody></table></div>':'<p class="note">'+T('m_none')+'</p>';
  }).catch(fail);
}
function punchModal(){
  mroot.innerHTML='<div class="overlay"><div class="modal" role="dialog" aria-modal="true"><h2>'+T('p_title')+'</h2><video id="vid" playsinline muted></video><div id="ps" class="msg w">'+T('p_load')+'</div><div class="row"><button class="btn" data-act="close">'+T('close')+'</button><button class="btn p" id="retry" data-act="punch-run" hidden>'+T('p_retry')+'</button></div></div></div>';
  runPunch();
}
function setPs(cls,txt,retry){var p=$('ps');if(!p)return;p.className='msg '+cls;p.textContent=txt;var r=$('retry');if(r)r.hidden=!retry;}
async function runPunch(){
  var v=$('vid');setPs('w',T('p_load'),false);
  try{await Face.loadModels();}catch(e){return setPs('no',T('p_modelfail'),true);}
  try{setPs('w',T('p_cam'),false);await Face.startCamera(v);}catch(e){return setPs('no',T('p_camfail'),true);}
  var cap;
  try{setPs('w',T('p_look'),false);cap=await Face.capture(v);}catch(e){return setPs('no',errText('no_face_detected'),true);}
  var g;
  try{setPs('w',T('p_gps'),false);g=await Face.gps();}catch(e){Face.stopCamera(v);return setPs('no',T('p_gpsfail'),true);}
  Face.stopCamera(v);
  try{
    setPs('w',T('p_send'),false);
    var r=await api('POST','/api/punch',{descriptor:cap.descriptor,photo:cap.photo,lat:g.lat,lng:g.lng,acc:g.acc});
    setPs('ok',T(r.type==='in'?'p_ok_in':'p_ok_out',r.time,r.dist),false);go();
  }catch(e){setPs('no',errText(e.code),true);}
}

/* ---------- HR: panel ---------- */
function stat(emp,row,today,rules){
  var st=toMin(emp.start);
  if(!row||!row.in){
    var wd=new Date(today.date+'T00:00:00Z').getUTCDay();
    if(wd===0||wd===6)return {k:'off',t:T('st_off')};
    if(today.min>st+rules.grace)return {k:'absent',t:T('st_absent')};
    return {k:'wait',t:T('st_wait')};
  }
  var l=toMin(row.in)-st;
  return l>rules.grace?{k:'late',t:T('st_late',l)}:{k:'ok',t:T('st_ok')};
}
function vPanel(m){
  Promise.all([api('GET','/api/employees'),api('GET','/api/attendance?date='+me.today.date)]).then(function(r){
    var emps=r[0],rows=r[1],by={};rows.forEach(function(x){by[x.empId]=x;});
    var c={ok:0,late:0,absent:0,here:0};
    var list=emps.filter(function(e){return e.hired<=me.today.date;}).map(function(e){var s=stat(e,by[e.id],me.today,me.rules);if(s.k==='ok')c.ok++;if(s.k==='late')c.late++;if(s.k==='absent')c.absent++;if(by[e.id]&&by[e.id].in)c.here++;return {e:e,r:by[e.id],s:s};});
    m.innerHTML='<div class="grid"><div class="tile"><div class="l">'+T('d_total')+'</div><div class="v">'+list.length+'</div></div><div class="tile"><div class="l">'+T('d_here')+'</div><div class="v good">'+c.here+'</div></div><div class="tile"><div class="l">'+T('d_late')+'</div><div class="v warn">'+c.late+'</div></div><div class="tile"><div class="l">'+T('d_abs')+'</div><div class="v bad">'+c.absent+'</div></div></div>'
     +'<div class="tw"><table><thead><tr><th>'+T('a_emp')+'</th><th>'+T('a_in')+'</th><th>'+T('a_out')+'</th><th>'+T('a_dist')+'</th><th>'+T('a_status')+'</th></tr></thead><tbody>'
     +list.map(function(x){return '<tr><td><div class="who">'+av(x.e)+'<div>'+esc(x.e.name)+'<small>'+esc(x.e.role)+'</small></div></div></td><td class="num"><div class="who">'+(x.r&&x.r.in||'—')+(x.r&&x.r.inPhoto?'<img class="av sq" src="'+esc(x.r.inPhoto)+'" alt="">':'')+'</div></td><td class="num"><div class="who">'+(x.r&&x.r.out||'—')+(x.r&&x.r.outPhoto?'<img class="av sq" src="'+esc(x.r.outPhoto)+'" alt="">':'')+'</div></td><td class="num">'+(x.r&&x.r.inDist!=null?T('d_dist',x.r.inDist):'—')+'</td><td><span class="pill '+x.s.k+'">'+x.s.t+'</span></td></tr>';}).join('')
     +'</tbody></table></div>';
  }).catch(fail);
}

/* ---------- HR: xodimlar ---------- */
function vEmps(m){
  api('GET','/api/employees').then(function(list){
    cache.emps=list;
    m.innerHTML='<div class="row"><input class="grow" id="q" type="search" placeholder="'+esc(T('e_search'))+'" value="'+esc(q)+'"><button class="btn p" data-act="emp-add">'+T('e_add')+'</button></div><div class="tw" id="ew"></div>';
    empTable();
  }).catch(fail);
}
function empTable(){
  var w=$('ew');if(!w)return;
  var l=(cache.emps||[]).filter(function(e){return !q||(e.name+' '+e.role+' '+e.no).toLowerCase().indexOf(q.toLowerCase())>=0;});
  w.innerHTML='<table><thead><tr><th>'+T('e_no')+'</th><th>'+T('e_name')+'</th><th>'+T('e_dept')+'</th><th>'+T('e_start')+'</th><th class="r">'+T('e_sal')+'</th><th>'+T('e_face')+'</th><th></th></tr></thead><tbody>'
   +l.map(function(e){return '<tr><td class="num">'+esc(e.no)+'</td><td><div class="who">'+av(e)+'<div>'+esc(e.name)+'<small>'+esc(e.role)+'</small></div></div></td><td>'+esc(e.dept)+'</td><td class="num">'+e.start+'–'+e.end+'</td><td class="num r">'+fmt(e.salary)+'</td><td><span class="pill '+(e.hasFace?'ok':'absent')+'">'+(e.hasFace?T('e_face_yes'):T('e_face_no'))+'</span></td>'
   +'<td class="num"><button class="btn sm" data-act="emp-face" data-id="'+e.id+'">'+T('e_enroll')+'</button> <button class="btn sm" data-act="emp-edit" data-id="'+e.id+'">'+T('edit')+'</button> <button class="btn sm" data-act="emp-pw" data-id="'+e.id+'">'+T('e_reset')+'</button> <button class="btn sm d" data-act="emp-del" data-id="'+e.id+'">'+T('del')+'</button></td></tr>';}).join('')+'</tbody></table>';
}
function empFormHtml(e,extra){
  e=e||{start:'09:00',end:'18:00',hired:me.today.date,name:'',role:'',dept:'',salary:''};
  var depts=[];(cache.emps||[]).forEach(function(x){if(depts.indexOf(x.dept)<0)depts.push(x.dept);});
  return '<form class="form" id="ef" data-id="'+(e.id||'')+'" data-cand="'+((extra&&extra.cand)||'')+'">'
   +'<label class="f full">'+T('e_name')+'<input id="e-name" value="'+esc(e.name)+'" required></label>'
   +'<label class="f">'+T('e_role')+'<input id="e-role" value="'+esc(e.role)+'" required></label>'
   +'<label class="f">'+T('e_dept')+'<input id="e-dept" list="dl" value="'+esc(e.dept)+'" required autocomplete="off"></label><datalist id="dl">'+depts.map(function(d){return '<option value="'+esc(d)+'">';}).join('')+'</datalist>'
   +'<label class="f">'+T('e_start')+'<input id="e-start" type="time" value="'+e.start+'" required></label>'
   +'<label class="f">'+T('e_end')+'<input id="e-end" type="time" value="'+e.end+'" required></label>'
   +'<label class="f">'+T('e_sal')+'<input id="e-sal" type="number" min="1" value="'+esc(e.salary)+'" required></label>'
   +'<label class="f">'+T('e_hired')+'<input id="e-hired" type="date" value="'+e.hired+'" required></label>'
   +(e.id?'':'<label class="f full">'+T('e_pw')+'<input id="e-pw" type="text" minlength="6" required autocomplete="off"></label><p class="note full">'+T('e_login')+'</p>')
   +'<div class="msg no full" id="ee" hidden></div><div class="full row" style="justify-content:flex-end;margin:0"><button type="button" class="btn" data-act="close">'+T('cancel')+'</button><button class="btn p" type="submit">'+T('save')+'</button></div></form>';
}
function readEmpForm(){return {name:$('e-name').value,role:$('e-role').value,dept:$('e-dept').value,start:$('e-start').value,end:$('e-end').value,salary:$('e-sal').value,hired:$('e-hired').value};}
document.addEventListener('submit',function(ev){
  if(ev.target.id!=='ef')return;ev.preventDefault();
  var f=ev.target,b=readEmpForm(),id=f.dataset.id,cand=f.dataset.cand;
  var p;
  if(id)p=api('PUT','/api/employees/'+id,b);
  else{b.password=$('e-pw').value;p=cand?api('POST','/api/candidates/'+cand+'/hire',b):api('POST','/api/employees',b);}
  p.then(function(){mroot.innerHTML='';toast(T('saved'));go();}).catch(function(e){var el=$('ee');el.hidden=false;el.textContent=errText(e.code);});
});
var faceEmp=null;
function faceModal(id){
  var e=cache.emps.filter(function(x){return String(x.id)===String(id);})[0];faceEmp=e;
  mroot.innerHTML='<div class="overlay"><div class="modal" role="dialog" aria-modal="true"><h2>'+T('f_title')+': '+esc(e.name)+'</h2><video id="vid" playsinline muted></video><div id="ps" class="msg w">'+T('p_load')+'</div><p class="note">'+T('f_hint')+'</p><div class="row" style="margin-top:10px"><button class="btn" data-act="close">'+T('close')+'</button><button class="btn p" id="take" data-act="face-take" disabled>'+T('f_take')+'</button></div></div></div>';
  (async function(){
    var v=$('vid');
    try{await Face.loadModels();}catch(x){return setPs('no',T('p_modelfail'),false);}
    try{await Face.startCamera(v);}catch(x){return setPs('no',T('p_camfail'),false);}
    setPs('ok',T('p_look'),false);var t=$('take');if(t)t.disabled=false;
  })();
}
async function faceTake(){
  var v=$('vid'),t=$('take');t.disabled=true;
  try{
    var cap=await Face.capture(v);
    await api('PUT','/api/employees/'+faceEmp.id+'/face',cap);
    Face.stopCamera(v);mroot.innerHTML='';toast(T('f_done'));go();
  }catch(e){setPs('no',e.code?errText(e.code):errText('no_face_detected'),false);t.disabled=false;}
}

/* ---------- HR: davomat ---------- */
function vAtt(m){
  Promise.all([api('GET','/api/employees'),api('GET','/api/attendance?date='+attDate)]).then(function(r){
    var emps=r[0].filter(function(e){return e.hired<=attDate;}),by={};r[1].forEach(function(x){by[x.empId]=x;});
    m.innerHTML='<div class="row"><input type="date" id="ad" value="'+attDate+'" style="width:auto"><span class="note">'+T('a_manual')+'</span></div><div class="tw"><table><thead><tr><th>'+T('a_emp')+'</th><th>'+T('a_in')+'</th><th>'+T('a_out')+'</th><th>'+T('a_dist')+'</th></tr></thead><tbody>'
     +emps.map(function(e){var x=by[e.id]||{};return '<tr><td><div class="who">'+av(e)+'<div>'+esc(e.name)+'<small>'+esc(e.start)+'–'+esc(e.end)+'</small></div></div></td>'
      +'<td><div class="who"><input type="time" style="width:120px" data-att="'+e.id+'" data-f="in" value="'+(x.in||'')+'">'+(x.inPhoto?'<img class="av sq" src="'+esc(x.inPhoto)+'" alt="">':'')+'</div></td>'
      +'<td><div class="who"><input type="time" style="width:120px" data-att="'+e.id+'" data-f="out" value="'+(x.out||'')+'">'+(x.outPhoto?'<img class="av sq" src="'+esc(x.outPhoto)+'" alt="">':'')+'</div></td>'
      +'<td class="num">'+(x.inDist!=null?T('d_dist',x.inDist):'—')+'</td></tr>';}).join('')+'</tbody></table></div>';
  }).catch(fail);
}

/* ---------- HR: oylik ---------- */
function vPay(m){
  api('GET','/api/report?month='+month).then(function(rows){
    var t={earned:0,lateDed:0,ot:0,bonus:0,tax:0,net:0,abs:0};rows.forEach(function(r){for(var k in t)t[k]+=r[k];});
    var opts='';for(var i=-3;i<=0;i++){var d=new Date();d.setDate(1);d.setMonth(d.getMonth()+i);var k=d.toISOString().slice(0,7);opts+='<option value="'+k+'"'+(k===month?' selected':'')+'>'+k+'</option>';}
    m.innerHTML='<div class="row"><select id="pm" style="width:auto" aria-label="'+T('o_month')+'">'+opts+'</select><a class="btn p" href="/api/report.csv?month='+month+'&lang='+getLang()+'" download>'+T('o_csv')+'</a></div>'
     +'<div class="tw"><table style="min-width:860px"><thead><tr><th>'+T('a_emp')+'</th><th class="r">'+T('o_days')+'</th><th class="r">'+T('o_miss')+'</th><th class="r">'+T('o_accr')+'</th><th class="r">'+T('o_late')+'</th><th class="r">'+T('o_ot')+'</th><th>'+T('o_kpi')+'</th><th class="r">'+T('o_bonus')+'</th><th class="r">'+T('o_tax')+'</th><th class="r">'+T('o_net')+'</th></tr></thead><tbody>'
     +rows.map(function(r){return '<tr><td>'+esc(r.name)+'<small>'+esc(r.role)+' · '+fmt(r.salary)+'</small></td><td class="num r">'+r.att+' / '+r.plan+'</td><td class="num r '+(r.abs?'bad':'')+'">'+r.abs+'</td><td class="num r">'+fmt(r.earned)+'</td><td class="num r warn">'+(r.lateDed?'−'+fmt(r.lateDed):'0')+'</td><td class="num r">'+fmt(r.ot)+'</td><td><input type="number" min="0" max="100" style="width:80px" data-kpi="'+r.id+'" value="'+Math.round(r.kpi.plan)+'"></td><td class="num r">'+fmt(r.bonus)+'</td><td class="num r">−'+fmt(r.tax)+'</td><td class="num r"><b>'+fmt(r.net)+'</b></td></tr>';}).join('')
     +'</tbody><tfoot><tr><td><b>'+T('o_total')+'</b></td><td></td><td class="num r">'+t.abs+'</td><td class="num r">'+fmt(t.earned)+'</td><td class="num r">−'+fmt(t.lateDed)+'</td><td class="num r">'+fmt(t.ot)+'</td><td></td><td class="num r">'+fmt(t.bonus)+'</td><td class="num r">−'+fmt(t.tax)+'</td><td class="num r"><b>'+fmt(t.net)+'</b></td></tr></tfoot></table></div><p class="note">'+T('o_note')+'</p>';
  }).catch(fail);
}

/* ---------- HR: qabul ---------- */
var STAGES=['new','interview','offer','hired'];
function mapLink(c){return c.lat!=null&&c.lng!=null?'<a href="https://www.google.com/maps/search/?api=1&query='+c.lat+','+c.lng+'" target="_blank" rel="noopener">'+T('c_map')+'</a> <span class="muted">('+Number(c.lat).toFixed(5)+', '+Number(c.lng).toFixed(5)+')</span>':'<span class="muted">'+T('c_nogps')+'</span>';}
function vCand(m){
  Promise.all([api('GET','/api/candidates'),api('GET','/api/employees')]).then(function(r){
    cache.cands=r[0];cache.emps=r[1];var url=location.origin+'/apply';
    m.innerHTML='<div class="card"><h2>'+T('c_link')+'</h2><div class="row" style="margin:0"><code>'+esc(url)+'</code><button class="btn sm" data-act="copy" data-txt="'+esc(url)+'">'+T('copied').replace(/.*/,'Copy')+'</button></div></div>'
     +'<div class="board">'+STAGES.map(function(st,si){var l=cache.cands.filter(function(c){return c.stage===st;});
      return '<div class="col"><h3>'+T('c_'+st)+' <span class="muted">'+l.length+'</span></h3>'+l.map(function(c){
       return '<div class="cand"><div class="who">'+av(c)+'<div><b>'+esc(c.name)+'</b><small class="muted" style="display:block">'+esc(c.role||'')+(c.salary?' · '+fmt(c.salary):'')+'</small></div></div>'
        +'<div class="note">'+esc(c.phone||'')+'</div>'+(c.address?'<div class="note">'+esc(c.address)+'</div>':'')+'<div class="note">'+mapLink(c)+'</div>'
        +'<div class="acts">'+(si>0?'<button class="btn sm" data-act="c-move" data-id="'+c.id+'" data-st="'+STAGES[si-1]+'">←</button>':'')+(si<3?'<button class="btn sm" data-act="c-move" data-id="'+c.id+'" data-st="'+STAGES[si+1]+'">→</button>':'<button class="btn sm p" data-act="c-hire" data-id="'+c.id+'">'+T('c_hire')+'</button>')+'<button class="btn sm d" data-act="c-del" data-id="'+c.id+'">×</button></div></div>';}).join('')+(l.length?'':'<span class="note">'+T('c_none')+'</span>')+'</div>';}).join('')+'</div>';
    var b=m.querySelector('[data-act=copy]');if(b)b.textContent=getLang()==='ru'?'Копировать':'Nusxalash';
  }).catch(fail);
}

/* ---------- HR: sozlamalar ---------- */
function vSet(m){
  api('GET','/api/me').then(function(j){
    me.place=j.place;me.rules=j.rules;me.face=j.face;var p=j.place,r=j.rules;
    var map=p.lat!=null&&p.lng!=null?'<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query='+p.lat+','+p.lng+'">'+T('s_map')+'</a>':'';
    function rf(k,l,s){return '<label class="f">'+l+'<input data-rule="'+k+'" type="number" step="'+s+'" min="0" value="'+r[k]+'"></label>';}
    m.innerHTML='<div class="card"><h2>'+T('s_place')+'</h2><form id="pf" class="form"><label class="f full">'+T('s_addr')+'<input id="p-addr" value="'+esc(p.addr)+'"></label>'
     +'<label class="f">'+T('s_lat')+'<input id="p-lat" inputmode="decimal" value="'+(p.lat==null?'':p.lat)+'"></label><label class="f">'+T('s_lng')+'<input id="p-lng" inputmode="decimal" value="'+(p.lng==null?'':p.lng)+'"></label>'
     +'<label class="f">'+T('s_r')+'<input id="p-r" type="number" min="10" step="10" value="'+p.r+'"></label><div class="full row" style="margin:0"><button type="button" class="btn" data-act="here">'+T('s_here')+'</button>'+map+'<button class="btn p" type="submit">'+T('save')+'</button></div><p class="note full">'+T('s_placehint')+'</p></form></div>'
     +'<div class="card"><h2>'+T('s_rules')+'</h2><form id="rf" class="form">'+rf('grace',T('s_grace'),1)+rf('otMin',T('s_otmin'),5)+rf('otk',T('s_otk'),0.1)+rf('kpiMax',T('s_kpimax'),1)+rf('jshds',T('s_jshds'),0.1)+rf('inps',T('s_inps'),0.1)+'<div class="full"><button class="btn p" type="submit">'+T('save')+'</button></div></form></div>'
     +'<div class="card"><h2>'+T('s_face')+'</h2><form id="ff" class="form"><label class="f full">'+T('s_thr')+'<input id="f-thr" type="number" step="0.05" min="0.3" max="0.7" value="'+j.face.threshold+'"></label><div class="full"><button class="btn p" type="submit">'+T('save')+'</button></div></form></div>'
     +'<div class="card"><h2>'+T('s_pw')+'</h2><form id="wf" class="form"><label class="f">'+T('s_old')+'<input id="w-old" type="password" autocomplete="current-password" required></label><label class="f">'+T('s_new')+'<input id="w-new" type="password" minlength="6" autocomplete="new-password" required></label><div class="full"><button class="btn p" type="submit">'+T('save')+'</button></div></form></div>'
     +(me.role==='admin'?'<a class="btn" href="/api/backup" download>'+T('s_backup')+'</a>':'');
  }).catch(fail);
}
document.addEventListener('submit',function(ev){
  var id=ev.target.id;if(['pf','rf','ff','wf'].indexOf(id)<0)return;ev.preventDefault();var p;
  if(id==='pf'){
    var la=$('p-lat').value.trim(),ln=$('p-lng').value.trim();
    var mm=la.match(/^(-?\d+(?:[.,]\d+)?)\s*[,;]\s*(-?\d+(?:[.,]\d+)?)$/);if(mm){la=mm[1];ln=mm[2];}
    p=api('PUT','/api/settings',{place:{addr:$('p-addr').value,lat:la.replace(',','.'),lng:ln.replace(',','.'),r:$('p-r').value}});
  }else if(id==='rf'){var o={};document.querySelectorAll('[data-rule]').forEach(function(i){o[i.dataset.rule]=i.value;});p=api('PUT','/api/settings',{rules:o});}
  else if(id==='ff')p=api('PUT','/api/settings',{face:{threshold:$('f-thr').value}});
  else p=api('POST','/api/password',{oldPassword:$('w-old').value,newPassword:$('w-new').value});
  p.then(function(){toast(T('saved'));go();}).catch(fail);
});

/* ---------- umumiy hodisalar ---------- */
document.addEventListener('click',function(ev){
  var t=ev.target;
  if(t.dataset&&t.dataset.lang){setLang(t.dataset.lang);if(me)go();else renderLogin();return;}
  if(t.classList&&t.classList.contains('overlay')){closeModal();return;}
  var b=t.closest('[data-act]');if(!b)return;var a=b.dataset.act,id=b.dataset.id;
  if(a==='logout'){api('POST','/api/logout',{}).then(function(){me=null;renderLogin();});}
  else if(a==='close')closeModal();
  else if(a==='punch')punchModal();
  else if(a==='punch-run')runPunch();
  else if(a==='emp-add'){mroot.innerHTML='<div class="overlay"><div class="modal" role="dialog" aria-modal="true"><h2>'+T('e_new')+'</h2>'+empFormHtml()+'</div></div>';}
  else if(a==='emp-edit'){var e=cache.emps.filter(function(x){return String(x.id)===id;})[0];mroot.innerHTML='<div class="overlay"><div class="modal" role="dialog" aria-modal="true"><h2>'+T('edit')+'</h2>'+empFormHtml(e)+'</div></div>';}
  else if(a==='emp-face')faceModal(id);
  else if(a==='face-take')faceTake();
  else if(a==='emp-pw'){mroot.innerHTML='<div class="overlay"><div class="modal"><h2>'+T('e_reset')+'</h2><form class="form" id="pwf" data-id="'+id+'"><label class="f full">'+T('e_newpw')+'<input id="np" type="text" minlength="6" required autocomplete="off"></label><div class="full row" style="justify-content:flex-end;margin:0"><button type="button" class="btn" data-act="close">'+T('cancel')+'</button><button class="btn p" type="submit">'+T('save')+'</button></div></form></div></div>';}
  else if(a==='emp-del'){var e2=cache.emps.filter(function(x){return String(x.id)===id;})[0];mroot.innerHTML='<div class="overlay"><div class="modal"><h2>'+T('del')+'</h2><p>'+esc(T('e_delq',e2.name))+'</p><div class="row" style="justify-content:flex-end"><button class="btn" data-act="close">'+T('cancel')+'</button><button class="btn p" data-act="emp-del-yes" data-id="'+id+'">'+T('yes_del')+'</button></div></div></div>';}
  else if(a==='emp-del-yes'){api('DELETE','/api/employees/'+id).then(function(){closeModal();toast(T('deleted'));go();}).catch(fail);}
  else if(a==='c-move'){api('PUT','/api/candidates/'+id+'/stage',{stage:b.dataset.st}).then(go).catch(fail);}
  else if(a==='c-del'){api('DELETE','/api/candidates/'+id).then(go).catch(fail);}
  else if(a==='c-hire'){var c=cache.cands.filter(function(x){return String(x.id)===id;})[0];mroot.innerHTML='<div class="overlay"><div class="modal" role="dialog" aria-modal="true"><h2>'+esc(T('c_hireq',c.name))+'</h2>'+empFormHtml({name:c.name,role:c.role||'',dept:'',start:'09:00',end:'18:00',salary:c.salary||'',hired:me.today.date},{cand:c.id})+'</div></div>';}
  else if(a==='copy'){var tx=b.dataset.txt;if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(tx).then(function(){toast(T('copied'));},function(){toast(tx);});else toast(tx);}
  else if(a==='here'){Face.gps().then(function(g){$('p-lat').value=g.lat.toFixed(6);$('p-lng').value=g.lng.toFixed(6);toast(T('saved').replace(/.*/,'GPS ±'+Math.round(g.acc)+' m'));}).catch(function(){toast(T('p_gpsfail'));});}
});
document.addEventListener('submit',function(ev){
  if(ev.target.id!=='pwf')return;ev.preventDefault();
  api('POST','/api/employees/'+ev.target.dataset.id+'/password',{password:$('np').value}).then(function(){closeModal();toast(T('saved'));}).catch(fail);
});
function closeModal(){var v=$('vid');if(v)Face.stopCamera(v);mroot.innerHTML='';}
document.addEventListener('input',function(ev){if(ev.target.id==='q'){q=ev.target.value;empTable();}});
document.addEventListener('change',function(ev){
  var t=ev.target;
  if(t.id==='ad'&&t.value){attDate=t.value;go();}
  else if(t.id==='pm'){month=t.value;go();}
  else if(t.dataset&&t.dataset.att){
    var inp=document.querySelector('[data-att="'+t.dataset.att+'"][data-f=in]'),out=document.querySelector('[data-att="'+t.dataset.att+'"][data-f=out]');
    api('PUT','/api/attendance',{empId:t.dataset.att,date:attDate,in:inp.value,out:out.value}).then(function(){toast(T('saved'));}).catch(fail);
  }else if(t.dataset&&t.dataset.kpi){api('PUT','/api/kpi',{empId:t.dataset.kpi,month:month,plan:t.value}).then(go).catch(fail);}
});
document.addEventListener('keydown',function(ev){if(ev.key==='Escape')closeModal();});
window.addEventListener('hashchange',go);
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(function(){});
boot();
})();

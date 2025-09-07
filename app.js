// ===== Tiny helpers =====
const $ = (sel, node=document)=> node.querySelector(sel);
const $$ = (sel, node=document)=> Array.from(node.querySelectorAll(sel));
const uid = ()=> Math.random().toString(36).slice(2)+Date.now().toString(36);

// ===== ENV (loaded at runtime) =====
let AFRIMONEY_NUMBER='—', ORANGEMONEY_NUMBER='—', GOOGLE_MAPS_API_KEY='',
    ADMIN_EMAILS=[], COUNTRY_CODE_ALLOW='', GOOGLE_OAUTH_CLIENT_ID='',
    ADMIN_PANEL_PASSWORD='';

// ===== Local DB in localStorage =====
const DB = {
  get data(){
    const raw = localStorage.getItem('sl_data');
    let d = raw ? JSON.parse(raw) : {};
    d.users ||= []; d.sessions ||= {}; d.posts ||= []; d.threads ||= []; d.messages ||= [];
    d.notifications ||= []; d.mails ||= []; d.saved ||= []; d.transactions ||= [];
    d.quoteRequests ||= []; d.bloggers ||= []; d.adCampaigns ||= []; d.appAds ||= [];
    d.users.forEach(u=>{ u.createdAt ||= new Date().toISOString(); u.profile_photo_data ||= ''; u.limitedAdminStatus ||= 'none'; });
    return d;
  },
  set data(v){ localStorage.setItem('sl_data', JSON.stringify(v)); }
};

// ===== Auth + API shim =====
const API = {
  token: localStorage.getItem('token') || null,
  setToken(t){ this.token=t; if(t) localStorage.setItem('token',t); else localStorage.removeItem('token'); renderAuth(); toggleAdminLink(); },
  _requireUser(){
    try{
      const t=this.token; if(!t) return null;
      const d=DB.data; const s=d.sessions[t]; if(!s) return null;
      return d.users.find(u=>u.id===s.userId)||null;
    }catch{return null}
  },
  async get(path){
    // Routes
    if (path.startsWith('/api/posts')){
      const url = new URL(location.origin+path);
      const cat = url.searchParams.get('category');
      const d=DB.data;
      let list = d.posts.slice();
      if (cat) list = list.filter(p=> p.category===cat);
      return list;
    }
    if (path==='/api/ads/campaigns/list'){
      const d=DB.data; return {campaigns:d.adCampaigns||[]};
    }
    return {error:'Unknown GET '+path};
  },
  async post(path, body){
    // ---- Auth flows
    if (path==='/api/auth/login'){
      const {email,password}=body||{};
      const d=DB.data; const u=d.users.find(x=>x.email===(email||'').trim().toLowerCase());
      if(!u || (u.password||'')!==String(password||'')) return {error:'Invalid credentials'};
      const t='t_'+uid(); d.sessions[t]={userId:u.id,ts:Date.now()}; DB.data=d; return {token:t};
    }
    if (path==='/api/auth/send-code'){
      const {email}=body||{}; const code=String(Math.floor(100000+Math.random()*900000));
      localStorage.setItem('sl_signup_code_'+String(email||'').toLowerCase(), JSON.stringify({code,ts:Date.now()}));
      alert(`Demo verification code for ${email}: ${code}`);
      return {ok:true};
    }
    if (path==='/api/auth/verify-signup'){
      const {email, password, code}=body||{};
      const key='sl_signup_code_'+String(email||'').toLowerCase();
      const obj=JSON.parse(localStorage.getItem(key)||'{}'); if(!obj.code || obj.code!==String(code||'')) return {error:'Invalid code'};
      localStorage.removeItem(key);
      const d=DB.data;
      let u=d.users.find(x=>x.email===(email||'').toLowerCase());
      if (!u){
        u={id:uid(),email:(email||'').toLowerCase(),password,limitedAdminStatus:'none',verified:true,createdAt:new Date().toISOString()};
        d.users.push(u);
      }else{ u.password=password; u.verified=true; }
      const t='t_'+uid(); d.sessions[t]={userId:u.id,ts:Date.now()}; DB.data=d; return {token:t};
    }
    if (path==='/api/auth/google-id-token'){
      const idt=(body||{}).id_token; if(!idt) return {error:'Missing id token'};
      // demo: just create a fake user
      const email='googleuser+'+idt.slice(-6)+'@example.com';
      const d=DB.data; let u=d.users.find(x=>x.email===email);
      if(!u){ u={id:uid(),email,password:'',verified:true,createdAt:new Date().toISOString()}; d.users.push(u); }
      const t='t_'+uid(); d.sessions[t]={userId:u.id,ts:Date.now()}; DB.data=d; return {token:t};
    }
    if (path==='/api/auth/change-password'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      const {oldPass,newPass}=body||{};
      const d=DB.data; const u=d.users.find(x=>x.id===me.id);
      if((u.password||'')!==String(oldPass||'')) return {error:'Old password incorrect'};
      u.password=String(newPass||''); DB.data=d; return {ok:true};
    }
    if (path==='/api/auth/forgot/send'){
      const {email}=body||{}; const d=DB.data; const u=d.users.find(x=>x.email===String(email||'')); if(!u) return {error:'Email not found'};
      const code=String(Math.floor(100000+Math.random()*900000));
      localStorage.setItem(`sl_reset_${email.toLowerCase()}`, JSON.stringify({code,ts:Date.now()}));
      alert(`Demo reset code for ${email}: ${code}`);
      return {ok:true};
    }
    if (path==='/api/auth/forgot/verify'){
      const {email,code,newPass}=body||{};
      const key=`sl_reset_${String(email||'').toLowerCase()}`;
      const obj=JSON.parse(localStorage.getItem(key)||'{}'); if(!obj.code || obj.code!==String(code||'')) return {error:'Invalid code'};
      localStorage.removeItem(key);
      const d=DB.data; const u=d.users.find(x=>x.email===String(email||'')); if(!u) return {error:'Email not found'};
      u.password=String(newPass||''); DB.data=d; return {ok:true};
    }

    // ---- Saved toggle
    if (path==='/api/saved/toggle'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      const {postId}=body||{}; const d=DB.data; d.saved ||= [];
      const i=d.saved.findIndex(s=> s.userId===me.id && s.postId===postId);
      if (i>=0){ d.saved.splice(i,1); DB.data=d; return {saved:false}; }
      d.saved.push({id:uid(),userId:me.id,postId}); DB.data=d; return {saved:true};
    }

    // ---- Post create
    if (path==='/api/posts'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      const b=body||{};
      // Sierra Leone-only gate for non-admins
      if (!isAdminOrLimited(me) && COUNTRY_CODE_ALLOW==='SL'){
        // If you wired geolocation/ISO lookup, enforce here. Demo: allow.
      }
      const isAds = (b.category==='ads');
      const months = Math.max(0, Number(b.boosted_months||0));
      if (isAds && months<=0) return {error:'Ads require paid boost (no trial).'};
      if (months>0 && !b.payment_screenshot_name) return {error:'Payment screenshot required for boost.'};

      const p={
        id:uid(), userId:me.id, category:b.category||'goods',
        title:b.title||'', description:b.description||'',
        price_cents: Number(b.price_cents||0),
        photos: Array.isArray(b.photos)? b.photos.slice(0,8) : [],
        photos_data: Array.isArray(b.photos_data)? b.photos_data.slice(0,8) : [],
        boosted_months: months,
        boost_contact_phone: (b.boost_contact_phone||'').trim(),
        payment_screenshot_name: b.payment_screenshot_name||'',
        location_lat: b.location_lat!=null? Number(b.location_lat): null,
        location_lng: b.location_lng!=null? Number(b.location_lng): null,
        location_address: b.location_address||'',
        service_parent: b.service_parent||'',
        status: 'available',
        createdAt: Date.now()
      };
      // 14d trial for non-ads when not paid
      if (!isAds && months===0){
        p.boost_trial_start = Date.now();
      }

      const d=DB.data; d.posts.push(p); DB.data=d;
      if (months>0){
        addTransaction({userId:me.id,type:'boost_purchase',amount_nle:months*100,meta:{postId:p.id,category:p.category}});
      }
      return p;
    }

    // ---- Boost existing listing from Account
    if (path==='/api/posts/boost'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      const d=DB.data; const {postId,months,payment_screenshot_name}=body||{};
      const p=d.posts.find(x=>x.id===postId && x.userId===me.id); if(!p) return {error:'Post not found or not yours'};
      const m=Math.max(1, Number(months||0));
      if (!payment_screenshot_name) return {error:'Payment screenshot required'};
      p.boosted_months = (Number(p.boosted_months||0) + m);
      p.payment_screenshot_name = payment_screenshot_name;
      DB.data=d;
      addTransaction({userId:me.id,type:'boost_purchase',amount_nle:m*100,meta:{postId:p.id}});
      return {ok:true,post:p};
    }

    // ---- Main admin: set limited-admin status
    if (path==='/api/admin/users/set-limited'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      if (!isMainAdmin(me)) return {error:'Admins only'};
      const d=DB.data;
      const {userId, status} = body||{};
      if (!['approved','pending','none'].includes(status||'')) return {error:'Bad status'};
      const u=d.users.find(x=>x.id===userId); if(!u) return {error:'User not found'};
      u.limitedAdminStatus = status;
      DB.data=d;
      return {ok:true, user:{id:u.id,email:u.email,limitedAdminStatus:u.limitedAdminStatus}};
    }

    return {error:'Unknown POST '+path};
  },
  async postForm(path, form){
    // Convert FormData to JSON, preserving file names and data URLs
    const obj={}, photos=[];
    for (const [k,v] of form.entries()){
      if (k==='photos' && v instanceof File){ photos.push(v.name||'photo'); }
      else if (k==='photos_data_json'){ try{ obj.photos_data = JSON.parse(v||'[]'); }catch{ obj.photos_data=[]; } }
      else if (v instanceof File){ obj[`${k}_name`]= v.name||'upload'; }
      else obj[k]=v;
    }
    if (photos.length) obj.photos=photos;
    return this.post(path,obj);
  }
};

// ===== Helpers =====
function isMainAdmin(u){ if(!u) return false; return (ADMIN_EMAILS||[]).map(x=>x.toLowerCase()).includes(String(u.email||'').toLowerCase()); }
function isAdminOrLimited(u){ if(!u) return false; return isMainAdmin(u) || u.limitedAdminStatus==='approved'; }
function trialActive(p){ if(!p?.boost_trial_start) return false; return (Date.now()-Number(p.boost_trial_start)) < 14*24*3600*1000; }
function addTransaction({userId,type,amount_nle=0,meta={}}){
  const d=DB.data; d.transactions ||= [];
  d.transactions.push({id:uid(),userId,type,amount_nle,meta,ts:Date.now()});
  DB.data=d;
}
function getUserById(id){ return (DB.data.users||[]).find(u=>u.id===id)||null; }

// ===== Auth UI (header mini) =====
function renderAuth(){
  const me = API._requireUser();
  if (me) { $('#accountBtn')?.style && ($('#accountBtn').style.display=''); }
  else { $('#accountBtn')?.style && ($('#accountBtn').style.display='none'); }
  toggleAdminLink();
}
function toggleAdminLink(){
  const me = API._requireUser();
  const settingsLink      = $('#settingsLink');
  const adminLink         = $('#adminLink');
  const quotesLink        = $('#quotesLink');
  const adCampLink        = $('#adCampLink');
  const adminAppAdsLink   = $('#adminAppAdsLink');

  if (settingsLink)    settingsLink.style.display   = isAdminOrLimited(me) ? '' : 'none';
  if (adminLink)       adminLink.style.display      = isMainAdmin(me) ? '' : 'none';
  if (quotesLink)      quotesLink.style.display     = isAdminOrLimited(me) ? '' : 'none';
  if (adCampLink)      adCampLink.style.display     = (isAdminOrLimited(me)) ? '' : 'none';
  if (adminAppAdsLink) adminAppAdsLink.style.display= isMainAdmin(me) ? '' : 'none';
}

// ===== Auth Gate (full-screen) =====
function showAuthGate(on){ const g=$('#authGate'); if(g) g.style.display = on?'block':'none'; }
function setStep(id){ $$('.step',$('#authGate')).forEach(s=>s.classList.remove('active')); $('#'+id)?.classList.add('active'); }
function wireAuthGate(){
  const g=$('#authGate'); if(!g) return;
  $('#chooseLogin').onclick = ()=> setStep('stepLogin');
  $('#chooseSignup').onclick = ()=> setStep('stepSignup1');
  $('#toSignup').onclick = (e)=>{e.preventDefault(); setStep('stepSignup1');};
  $('#toLogin').onclick = (e)=>{e.preventDefault(); setStep('stepLogin');};
  $('#doLogin').onclick = async()=>{
    const email=$('#loginEmail').value.trim(), password=$('#loginPass').value;
    const r=await API.post('/api/auth/login',{email,password});
    if(r.token){ API.setToken(r.token); showAuthGate(false); route(); } else alert(r.error||'Login failed');
  };
  $('#sendCode').onclick = async()=>{
    const email=$('#signEmail').value.trim(); if(!email) return alert('Enter email');
    const r=await API.post('/api/auth/send-code',{email});
    if(r.error) alert(r.error); else setStep('stepSignup2');
  };
  $('#doVerify').onclick = async()=>{
    const email=$('#signEmail').value.trim(), password=$('#signPass').value, code=$('#signCode').value.trim();
    const r=await API.post('/api/auth/verify-signup',{email,password,code});
    if(r.token){ API.setToken(r.token); showAuthGate(false); route(); } else alert(r.error||'Signup failed');
  };
  if (GOOGLE_OAUTH_CLIENT_ID && window.google?.accounts?.id){
    window.google.accounts.id.renderButton($('#googleBtnGate'), { theme:'outline', size:'large', type:'standard', shape:'pill' });
    window.google.accounts.id.initialize({
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      callback: async (resp)=>{
        const r = await API.post('/api/auth/google-id-token', { id_token: resp.credential });
        if (r.token){ API.setToken(r.token); showAuthGate(false); route(); } else alert(r.error||'Google sign-in failed');
      }
    });
  } else {
    $('#googleBtnGate').innerHTML = `<button class="btn">Continue with Google</button>`;
    $('#googleBtnGate button').onclick = ()=> alert('Add GOOGLE_OAUTH_CLIENT_ID in env.json');
  }
}

// ===== Header hero rotator (tiny) =====
function setHeroVisible(on){ const h=$('#heroSection'); if(h) h.style.display = on?'block':'none'; }
function mountHero(){
  const host=$('#heroRotator'); if(!host) return;
  host.innerHTML = `
    <a class="hero-slide active" id="hs1" href="#/services">
      <div class="floaty" style="display:grid;place-items:center;background:#fff;border-radius:10px;margin-left:6px"><span>🧰</span></div>
      <div><strong>Let us handle service needs</strong><br/><span class="muted">Find pros near you</span></div>
    </a>
    <a class="hero-slide" id="hs2" href="#/post/goods">
      <div class="floaty" style="display:grid;place-items:center;background:#fff;border-radius:10px;margin-left:6px"><span>🚀</span></div>
      <div><strong>Be first to see new items</strong><br/><span class="muted">Boost — try free</span></div>
    </a>
  `;
  let i=0; setInterval(()=>{ i^=1; $('#hs1').classList.toggle('active', !i); $('#hs2').classList.toggle('active', !!i); }, 60000);
}

// ===== Location + filters =====
function setMyLoc(lat,lng){ localStorage.setItem('sl_my_loc', JSON.stringify({lat,lng})); }
function getMyLoc(){ try{ return JSON.parse(localStorage.getItem('sl_my_loc')||'{}'); }catch{return {}} }
function haversineMiles(a,b){
  if(!a||!b||a.lat==null||b.lat==null) return Infinity;
  const R=3958.8, toRad=x=>x*Math.PI/180;
  const dLat=toRad((b.lat-a.lat)), dLon=toRad((b.lng-a.lng));
  const la=toRad(a.lat), lb=toRad(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.cos(la)*Math.cos(lb)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
function renderGoodsFilterBar(container, onChange){
  const bar=document.createElement('div'); bar.className='filterbar';
  bar.innerHTML = `
    <label>Range
      <select id="fMiles">
        <option value="0">Any</option>
        <option>5</option><option>10</option><option>15</option><option>20</option>
      </select>
    </label>
    <label><input type="checkbox" id="fBoosted"/> Sellers with boosting</label>
    <button class="btn" id="fUseLoc">Use my location</button>
    <button class="btn" id="fApply">Apply</button>
  `;
  container.parentNode.insertBefore(bar, container);
  $('#fUseLoc',bar).onclick = ()=>{
    if(!navigator.geolocation){ alert('Geolocation not supported'); return; }
    navigator.geolocation.getCurrentPosition(pos=>{ setMyLoc(pos.coords.latitude,pos.coords.longitude); alert('Location set.'); }, ()=>alert('Could not get location'));
  };
  $('#fApply',bar).onclick = ()=> onChange({
    miles: Number($('#fMiles',bar).value||0),
    boostedOnly: $('#fBoosted',bar).checked,
    myloc: getMyLoc()
  });
}

// ===== Google Maps (optional) =====
let _mapsLoaded=false,_mapsPromise=null;
function ensureGoogleMaps(){
  if (!GOOGLE_MAPS_API_KEY) return Promise.resolve(null);
  if (_mapsLoaded) return Promise.resolve(window.google.maps);
  if (_mapsPromise) return _mapsPromise;
  _mapsPromise = new Promise((res)=>{
    const s=document.createElement('script');
    s.src=`https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}`;
    s.onload=()=>{ _mapsLoaded=true; res(window.google.maps); };
    document.head.appendChild(s);
  });
  return _mapsPromise;
}

// ===== UI helpers =====
const app = $('#app');
function renderBackBtn(show){
  if (show && !$('#backBtn')){
    const b=document.createElement('button'); b.id='backBtn'; b.textContent='Back'; b.onclick=()=>history.back();
    app.before(b);
  }
  if (!show && $('#backBtn')) $('#backBtn').remove();
}
const card = (t,d,badge)=>{ const div=document.createElement('div'); div.className='card'; div.innerHTML=`<span class="badge">${badge||''}</span><h3>${t}</h3><p class="muted">${d||''}</p>`; return div; };

// ===== Goods feed thumbnails =====
function renderGoodsThumb(p, grid){
  const div=document.createElement('div'); div.className='goods-card';
  const src=(p.photos_data&&p.photos_data[0])?p.photos_data[0]:'';
  div.innerHTML = `
    <a href="#/item/${p.id}" style="display:block">
      <img alt="${p.title||'item'}" ${src?`src="${src}"`:''}/>
    </a>
    <div class="meta"><h4>${p.title||''}</h4><p>${p.description||''}</p></div>
  `;
  grid.appendChild(div);
}

// ===== Item page =====
function daysSince(ts){ const d=ts?new Date(ts):new Date(); return Math.max(0, Math.floor((Date.now()-d.getTime())/(24*3600*1000))); }
function daysSinceJoined(u){ return daysSince(u?.createdAt || Date.now()); }
async function viewItem(itemId){
  renderBackBtn(true); setHeroVisible(false);
  const d=DB.data; const p=(d.posts||[]).find(x=>x.id===itemId); if(!p){ app.innerHTML='<p>Item not found.</p>'; return; }
  const owner=getUserById(p.userId)||{email:'unknown'};
  const src=(p.photos_data&&p.photos_data[0])?p.photos_data[0]:'';
  app.innerHTML = `
    <div class="item-hero" id="itemHero">
      <img ${src?`src="${src}"`:''} alt="${p.title||'item'}"/>
      <div class="topbar">
        <a href="javascript:history.back()" class="chip btn">Back</a>
        <div>
          <button id="shareTop" class="chip btn">Share</button>
          <button id="saveTop"  class="chip btn">${isSaved(p.id)?'Saved':'Save'}</button>
        </div>
      </div>
    </div>
    <section style="padding:10px 0 64px">
      <h2>${p.title||''}</h2>
      <p class="muted" style="margin-top:-6px">${p.category||''} • Posted ${daysSince(p.createdAt)} day(s) ago</p>
      <div class="card">
        <p><strong>Seller:</strong> ${owner.email||''} • joined ${daysSinceJoined(owner)} day(s) ago</p>
        ${p.location_address?`<p class="muted">📍 ${p.location_address}</p>`:''}
        ${p.description?`<p>${p.description}</p>`:''}
        ${(p.brand||p.item_type||p.color||p.condition)?`<p class="muted">${[p.brand,p.item_type,p.color,p.condition].filter(Boolean).join(' • ')}</p>`:''}
        <p class="muted">Status: ${p.status||'available'}</p>
        <p class="muted"><a href="#/post/goods" style="text-decoration:underline">get faster responses — Boost</a></p>
      </div>
      <div id="mapWrap" style="margin-top:10px"></div>
    </section>
    <div id="fixedBuyBar" style="position:fixed;left:0;right:0;bottom:60px;padding:6px 8px;display:flex;gap:6px;justify-content:space-around;background:linear-gradient(180deg,#fff8ec,#fff3db);border-top:1px solid var(--border)">
      <button class="btn" id="askBtn">Ask</button>
      <button class="btn" id="offerBtn">Make Offer</button>
      <button class="btn" id="buyBtn">Buy Now</button>
    </div>
  `;
  const hero=$('#itemHero'); window.addEventListener('scroll', ()=>{ hero.classList.toggle('hidden', window.scrollY>80); }, {passive:true});
  $('#shareTop').onclick = async()=>{
    const url=`${location.origin}${location.pathname}#/item/${p.id}`;
    try{ if(navigator.share) await navigator.share({title:p.title||'Listing', url}); else { await navigator.clipboard.writeText(url); alert('Link copied'); } }catch{}
  };
  $('#saveTop').onclick = async()=>{ const r=await API.post('/api/saved/toggle',{postId:p.id}); if(r.error) alert(r.error); else $('#saveTop').textContent=r.saved?'Saved':'Save'; };
  $('#askBtn').onclick   = ()=> messageOwner(p, `Hi! Is "${p.title}" still available?`);
  $('#offerBtn').onclick = ()=>{ const amount=prompt('Your offer (NLe):'); if(amount==null||!String(amount).trim()) return; const note=prompt('Add a note (optional):')||''; messageOwner(p, `Offer for "${p.title}": NLe ${String(amount).trim()}${note?` — ${note}`:''}`); };
  $('#buyBtn').onclick = ()=>{
    const sheet=document.createElement('div');
    sheet.style='position:fixed;inset:0;background:#0007;display:flex;align-items:flex-end;z-index:9999';
    const box=document.createElement('div');
    box.style='background:#fff;border-radius:16px 16px 0 0;padding:12px;width:100%;max-width:520px;margin:0 auto';
    box.innerHTML = `
      <h3 style="margin:0 0 8px 0">Buy Now — Mobile Money</h3>
      <p class="muted">Upload payment screenshot (NLe)</p>
      <div class="row"><div><label>Screenshot <input id="buyShot" type="file" accept="image/*"></label></div></div>
      <div id="buyMap" style="height:220px;margin-top:8px;border:1px solid #e5e7eb;border-radius:10px;${(p.location_lat&&p.location_lng)?'':'display:none'}"></div>
      <p class="muted" style="margin-top:6px"><a href="#/post/goods" style="text-decoration:underline">get faster responses — Boost</a></p>
      <div class="actions" style="margin-top:8px">
        <button class="btn" id="buySubmit">Submit</button>
        <button class="btn" id="buyCancel" style="background:#f3f4f6;border-color:#e5e7eb">Cancel</button>
      </div>`;
    sheet.appendChild(box); document.body.appendChild(sheet);
    $('#buyCancel').onclick = ()=> sheet.remove();
    $('#buySubmit').onclick = ()=>{
      const f=$('#buyShot').files?.[0]; if(!f){ alert('Screenshot required'); return; }
      addTransaction({userId:API._requireUser().id,type:'buy_screenshot',amount_nle:0,meta:{postId:p.id,screenshot:f.name||'screenshot'}});
      alert('Thanks! Admin will verify your payment screenshot.'); sheet.remove();
    };
    (async()=>{
      if (p.location_lat!=null && p.location_lng!=null){
        const g=await ensureGoogleMaps(); if(!g) return;
        const map=new g.Map($('#buyMap'), {center:{lat:p.location_lat,lng:p.location_lng}, zoom:14});
        new g.Marker({map, position:{lat:p.location_lat,lng:p.location_lng}});
      }
    })();
  };
  if (p.location_lat!=null && p.location_lng!=null){
    const g=await ensureGoogleMaps(); if(g){
      const div=document.createElement('div'); div.style='height:220px;border:1px solid #e5e7eb;border-radius:10px';
      $('#mapWrap').appendChild(div);
      const map=new g.Map(div,{center:{lat:p.location_lat,lng:p.location_lng},zoom:14});
      new g.Marker({map, position:{lat:p.location_lat,lng:p.location_lng}});
    }
  }
}
function isSaved(postId){ const me=API._requireUser(); if(!me) return false; return (DB.data.saved||[]).some(s=>s.userId===me.id && s.postId===postId); }
function messageOwner(p, text){ alert('Message sent to owner:\n\n'+text); }

// ===== Post forms =====
function openQuickPostChooser(){
  const sheet=document.createElement('div');
  sheet.style='position:fixed;inset:0;background:#0007;display:flex;align-items:flex-end;z-index:9999';
  const box=document.createElement('div');
  box.style='background:#fff;border-radius:16px 16px 0 0;padding:12px;width:100%;max-width:520px;margin:0 auto';
  box.innerHTML=`
    <h3 style="margin:0 0 8px 0">Create a post</h3>
    <div class="actions">
      <a class="btn" href="#/post/goods">Goods</a>
      <a class="btn" href="#/post/services">Services</a>
      <a class="btn" href="#/post/rentals">Rentals</a>
      <a class="btn" href="#/post/jobs">Jobs</a>
    </div>
    <div class="actions" style="margin-top:8px">
      <button class="btn" id="qpClose" style="background:#f3f4f6;border-color:#e5e7eb">Close</button>
    </div>`;
  sheet.appendChild(box); document.body.appendChild(sheet);
  $('#qpClose').onclick = ()=> sheet.remove();
}

function boostBlock(){ return `
  <div class="card">
    <h3>Boost (optional) — NLe</h3>
    <div class="row">
      <div><label>Months (0–12) <input name="boosted_months" id="boostMonths" type="number" min="0" max="12" value="0"></label></div>
      <div><label>Contact phone (for admin verify) <input name="boost_contact_phone" placeholder="+232 ..."></label></div>
    </div>
    <div id="boostPriceLine" class="muted">NLe 100 per month · Est. total: <strong>NLe 0</strong></div>
    <div id="mmPayBlock" style="display:none;margin-top:8px"><label>Mobile-money payment screenshot <input id="paymentScreenshot" name="payment_screenshot" type="file" accept="image/*"></label></div>
    <small class="muted">14-day free trial applies when months = 0 (not for Ads).</small>
  </div>`; }

function postForm(category){
  const wrap=document.createElement('div');
  const title=`Post ${category.charAt(0).toUpperCase()+category.slice(1)}`;
  wrap.innerHTML = `
    <h2>${title}</h2>
    <form id="pform">
      <div class="row">
        <div><label>Title<input name="title" required></label></div>
        <div><label>Price (¢)<input name="price_cents" type="number" min="0"></label></div>
      </div>
      <label>Description<textarea name="description"></textarea></label>

      ${category==='services' ? `
        <div class="row">
          <div><label>Category
            <select name="service_parent">
              <option>Personal Chef</option><option>Plumber</option><option>Contractor</option>
              <option>Interior Decoration</option><option>AC Specialist</option><option>TV Repairer</option>
              <option>Furniture Assembly</option><option>House Cleaning</option><option>Painting</option><option>Other</option>
            </select>
          </label></div>
        </div>` : ''}

      <div class="card">
        <h3>Photos</h3>
        <div class="row">
          <div><label>Select photos <input id="postSel" type="file" accept="image/*" multiple></label></div>
          <div><label>Take photos <input id="postCam" type="file" accept="image/*" capture="environment" multiple></label></div>
        </div>
      </div>

      <div class="card">
        <h3>Location</h3>
        <div class="row">
          <div><label>Address <input name="location_address" placeholder="Freetown…"></label></div>
          <div><label>Latitude <input name="location_lat"  type="number" step="any"></label></div>
          <div><label>Longitude<input name="location_lng"  type="number" step="any"></label></div>
        </div>
        <div class="actions"><button type="button" class="btn" id="useMyLoc">Use my location</button></div>
      </div>

      ${boostBlock()}

      <div class="actions" style="margin-top:8px">
        <button class="btn" type="submit">Publish</button>
      </div>
    </form>
  `;
  $('#app').innerHTML=''; app.appendChild(wrap);

  const f=$('#pform');
  const updateBoostUI=()=>{
    const months=Math.max(0, Number($('#boostMonths').value||0));
    $('#boostPriceLine').innerHTML = `NLe 100 per month · Est. total: <strong>NLe ${months*100}</strong>`;
    $('#mmPayBlock').style.display = months>0 ? 'block':'none';
  };
  $('#boostMonths').oninput = updateBoostUI; updateBoostUI();

  $('#useMyLoc').onclick = ()=>{
    if(!navigator.geolocation) return alert('Geolocation not supported');
    navigator.geolocation.getCurrentPosition(pos=>{
      f.location_lat.value=pos.coords.latitude; f.location_lng.value=pos.coords.longitude; setMyLoc(pos.coords.latitude,pos.coords.longitude);
    }, ()=>alert('Could not get location'));
  };

  f.addEventListener('submit', async(e)=>{
    e.preventDefault();
    const me=API._requireUser(); if(!me){ showAuthGate(true); return; }

    // Collect selected images → data URLs
    const files=[];
    ['postSel','postCam'].forEach(id=>{
      const inp=$('#'+id); if(inp?.files) for(const file of inp.files){ if(file && file.type.startsWith('image/')) files.push(file); }
    });
    const toDataURL=(file)=> new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); });
    const photos_data=[]; for(const fl of files.slice(0,8)){ try{ photos_data.push(await toDataURL(fl)); }catch{} }

    const fd=new FormData(f);
    fd.append('category', category);
    fd.append('photos_data_json', JSON.stringify(photos_data));
    const pay=$('#paymentScreenshot'); if (pay?.files?.[0]) fd.append('payment_screenshot', pay.files[0]);
    const r=await API.postForm('/api/posts', fd);
    if(r.error){ alert(r.error); return; }
    alert('Published!'); location.hash = `#/${category}`;
  });
}

// ===== Views =====
async function viewHome(){
  renderBackBtn(false); setHeroVisible(true);
  app.innerHTML = `<h2>Home · Goods Feed</h2><div class="goods-grid" id="ggrid"></div>`;
  const g=$('#ggrid');
  renderGoodsFilterBar(g, applyGoodsFilter);
  const posts = await API.get('/api/posts?category=goods');
  g.dataset.all = JSON.stringify(posts);
  applyGoodsFilter();

  function applyGoodsFilter(opts){
    const all = JSON.parse(g.dataset.all||'[]');
    let list = all.slice();
    if (opts?.boostedOnly) list = list.filter(p=> (p.boosted_months||0)>0 || trialActive(p));
    if (opts?.miles>0){
      const here = opts.myloc||getMyLoc();
      list = list.filter(p=> haversineMiles(here,{lat:p.location_lat,lng:p.location_lng}) <= opts.miles);
    }
    g.innerHTML=''; list.sort((a,b)=> (Number(b.boosted_months||0)+ (trialActive(b)?1:0)) - (Number(a.boosted_months||0)+(trialActive(a)?1:0)) || b.createdAt-a.createdAt);
    list.forEach(p=> renderGoodsThumb(p,g));
  }
}

async function viewCategory(category){
  renderBackBtn(true); setHeroVisible(category==='goods');
  if (category==='goods'){
    app.innerHTML = `<h2>Goods Feed</h2><div class="goods-grid" id="ggrid"></div>`;
    const g=$('#ggrid'); renderGoodsFilterBar(g, applyGoodsFilter);
    const posts = await API.get('/api/posts?category=goods'); g.dataset.all = JSON.stringify(posts); applyGoodsFilter();
    function applyGoodsFilter(opts){
      const all = JSON.parse(g.dataset.all||'[]');
      let list = all.slice();
      if (opts?.boostedOnly) list = list.filter(p=> (p.boosted_months||0)>0 || trialActive(p));
      if (opts?.miles>0){ const here=opts.myloc||getMyLoc(); list=list.filter(p=> haversineMiles(here,{lat:p.location_lat,lng:p.location_lng})<=opts.miles); }
      g.innerHTML=''; list.sort((a,b)=> (Number(b.boosted_months||0)+(trialActive(b)?1:0)) - (Number(a.boosted_months||0)+(trialActive(a)?1:0)) || b.createdAt-a.createdAt);
      list.forEach(p=> renderGoodsThumb(p,g));
    }
    return;
  }

  if (category==='services'){
    const CATS=[
      {k:'Personal Chef',icon:'M3 14l3-3 4 4 8-8 3 3-11 11z'},
      {k:'Plumber',icon:'M4 7h16v2H4z'},
      {k:'Contractor',icon:'M12 3l9 8h-3v9H6v-9H3z'},
      {k:'Interior Decoration',icon:'M6 2h12v2H6z'},
      {k:'AC Specialist',icon:'M3 5h18v4H3z'},
      {k:'TV Repairer',icon:'M5 6h14v10H5z'},
      {k:'Furniture Assembly',icon:'M4 12h16v2H4z'},
      {k:'House Cleaning',icon:'M2 14h20v2H2z'},
      {k:'Painting',icon:'M4 4h8v4H4z'},
      {k:'Other',icon:'M2 2h20v2H2z'}
    ];
    app.innerHTML = `<h2>Services</h2><div class="boxgrid" id="svcCats"></div><div class="grid" id="grid"></div>`;
    const box=$('#svcCats'), grid=$('#grid');
    CATS.forEach(c=>{ const div=document.createElement('div'); div.className='catbox'; div.innerHTML=`<svg viewBox="0 0 24 24"><path d="${c.icon}" fill="#b1840f"/></svg><span>${c.k}</span>`; div.onclick=()=>filterBy(c.k); box.appendChild(div); });
    const posts = await API.get('/api/posts?category=services');
    function render(list){ grid.innerHTML=''; list.sort((a,b)=>b.createdAt-a.createdAt); list.forEach(p=> grid.appendChild(card(p.title,p.description, (p.boosted_months>0||trialActive(p))?'Boosted':''))); }
    function filterBy(k){ render(posts.filter(p=> (p.service_parent||'')===k)); }
    render(posts); return;
  }

  if (['rentals','jobs','ads'].includes(category)){
    const posts = await API.get('/api/posts?category='+category);
    app.innerHTML = `<h2>${category.charAt(0).toUpperCase()+category.slice(1)}</h2><div class="grid" id="grid"></div>`;
    const grid=$('#grid');
    posts.sort((a,b)=>b.createdAt-a.createdAt).forEach(p=> grid.appendChild(card(p.title,p.description, (p.boosted_months>0||trialActive(p))?'Boosted':'')));
    return;
  }
}

function viewSearch(q){
  renderBackBtn(true); setHeroVisible(false);
  const all = DB.data.posts||[];
  const term=(q||'').toLowerCase();
  const res = all.filter(p=> [p.title,p.description,p.category].join(' ').toLowerCase().includes(term));
  app.innerHTML = `<h2>Search</h2><div class="grid" id="grid"></div>`;
  const grid=$('#grid'); res.sort((a,b)=>b.createdAt-a.createdAt).forEach(p=> grid.appendChild(card(p.title,p.description,p.category)));
}

function viewPost(category){ renderBackBtn(true); setHeroVisible(false); postForm(category); }

function viewListings(){
  renderBackBtn(true); setHeroVisible(false);
  const me=API._requireUser(); if(!me){ showAuthGate(true); return; }
  const mine=(DB.data.posts||[]).filter(p=> p.userId===me.id).sort((a,b)=>b.createdAt-a.createdAt);
  app.innerHTML = `<h2>Your Listings</h2><div class="goods-grid" id="ggrid"></div>`;
  const g=$('#ggrid'); mine.forEach(p=> renderGoodsThumb(p,g));
}
function viewInbox(){ renderBackBtn(true); setHeroVisible(false); app.innerHTML=`<h2>Inbox</h2><p class="muted">Coming soon.</p>`; }

function viewAccount(){
  renderBackBtn(true); setHeroVisible(false);
  const me=API._requireUser(); if(!me){ showAuthGate(true); return; }
  const d=DB.data;
  const savedIds=(d.saved||[]).filter(s=>s.userId===me.id).map(s=>s.postId);
  const savedGoods=(d.posts||[]).filter(p=> savedIds.includes(p.id) && p.category==='goods');
  const savedRentals=(d.posts||[]).filter(p=> savedIds.includes(p.id) && p.category==='rentals');
  const mine=(d.posts||[]).filter(p=> p.userId===me.id);
  const tx=(d.transactions||[]).filter(t=> t.userId===me.id).sort((a,b)=>b.ts-a.ts);

  app.innerHTML = `
    <section>
      <h2>Account</h2>
      <div class="card">
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <img id="avatarImg" class="avatar" src="${me.profile_photo_data||''}" alt="Profile"/>
          <div>
            <div><strong>${me.email||''}</strong></div>
            <div class="muted">Joined ${daysSince(me.createdAt)} day(s) ago</div>
          </div>
        </div>
        <div class="actions" style="margin-top:8px">
          <button class="btn" id="avatarTake">Take photo</button>
          <button class="btn" id="avatarPick">Select photo</button>
          <button class="btn" id="logoutBtn">Logout</button>
        </div>
        <input type="file" id="avatarFile" accept="image/*" style="display:none"/>
      </div>

      <div class="card" style="margin-top:10px">
        <h3>Security</h3>
        <div class="row">
          <div>
            <h4 style="margin:0 0 6px 0">Change password</h4>
            <label>Old password <input id="oldPass" type="password"/></label>
            <label>New password <input id="newPass" type="password"/></label>
            <div class="actions"><button class="btn" id="doChangePass">Change</button></div>
          </div>
          <div>
            <h4 style="margin:0 0 6px 0">Forgot password</h4>
            <label>Email <input id="fpEmail" placeholder="you@example.com" value="${me.email||''}"/></label>
            <div class="actions"><button class="btn" id="fpSend">Send reset code</button></div>
            <label>Code <input id="fpCode" placeholder="6-digit"/></label>
            <label>New password <input id="fpNew" type="password"/></label>
            <div class="actions"><button class="btn" id="fpVerify">Verify & Reset</button></div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:10px">
        <h3>Boost a listing (NLe)</h3>
        <div class="row">
          <div><label>Your listing
            <select id="boostPostSel">
              ${mine.map(p=>`<option value="${p.id}">${p.title} — ${p.category} (${p.boosted_months||0}m)</option>`).join('')}
            </select></label></div>
          <div><label>Months (1–12) <input id="boostMonthsAcc" type="number" min="1" max="12" value="1"></label></div>
          <div><label>Payment screenshot <input id="boostShotAcc" type="file" accept="image/*"></label></div>
        </div>
        <div class="actions"><button class="btn" id="boostApplyAcc">Apply Boost</button></div>
        <small class="muted">NLe 100 per month. Screenshot is required.</small>
      </div>

      <div class="card" style="margin-top:10px">
        <h3>Saved — Goods</h3>
        <div class="goods-grid" id="savedGoodsGrid"></div>
      </div>

      <div class="card" style="margin-top:10px">
        <h3>Saved — Rentals</h3>
        <div class="goods-grid" id="savedRentalsGrid"></div>
      </div>

      <div class="card" style="margin-top:10px">
        <h3>Your Listings</h3>
        <div class="goods-grid" id="mineGrid"></div>
      </div>

      <div class="card" style="margin-top:10px">
        <h3>Transactions</h3>
        <table><thead><tr><th>When</th><th>Type</th><th>Amount</th><th>Meta</th></tr></thead>
        <tbody id="txBody"></tbody></table>
      </div>
    </section>
  `;

  // Avatar handlers
  const fileInput=$('#avatarFile');
  const toDataURL=(f)=> new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(f); });
  $('#avatarPick').onclick = ()=> fileInput.click();
  $('#avatarTake').onclick = ()=>{ fileInput.setAttribute('capture','user'); fileInput.click(); fileInput.removeAttribute('capture'); };
  fileInput.onchange = async()=>{ const f=fileInput.files?.[0]; if(!f) return;
    const data=await toDataURL(f); const d=DB.data; const u=d.users.find(x=>x.id===me.id); u.profile_photo_data=data; DB.data=d; $('#avatarImg').src=data; alert('Profile photo updated.');
  };

  // Security
  $('#logoutBtn').onclick = ()=>{ API.setToken(null); location.reload(); };
  $('#doChangePass').onclick = async()=>{
    const r=await API.post('/api/auth/change-password',{oldPass:$('#oldPass').value,newPass:$('#newPass').value});
    if(r.error) alert(r.error); else alert('Password changed.');
  };
  $('#fpSend').onclick = async()=>{ const r=await API.post('/api/auth/forgot/send',{email:$('#fpEmail').value}); if(r.error) alert(r.error); else alert('Reset code sent (demo shows in alert).'); };
  $('#fpVerify').onclick = async()=>{ const r=await API.post('/api/auth/forgot/verify',{email:$('#fpEmail').value,code:$('#fpCode').value,newPass:$('#fpNew').value}); if(r.error) alert(r.error); else alert('Password reset.'); };

  // Boost
  $('#boostApplyAcc').onclick = async()=>{
    const pid=$('#boostPostSel').value; const m=Math.max(1, Number($('#boostMonthsAcc').value||1));
    const f=$('#boostShotAcc').files?.[0]; if(!f){ alert('Screenshot required'); return; }
    const r=await API.post('/api/posts/boost',{postId:pid,months:m,payment_screenshot_name:f.name||'screenshot'});
    if(r.error){ alert(r.error); return; }
    alert('Boost applied.'); route();
  };

  // Grids
  const sG=$('#savedGoodsGrid'), sR=$('#savedRentalsGrid'), mG=$('#mineGrid');
  savedGoods.forEach(p=> renderGoodsThumb(p, sG));
  savedRentals.forEach(p=> renderGoodsThumb(p, sR));
  mine.forEach(p=> renderGoodsThumb(p, mG));

  // Transactions
  const tb=$('#txBody'); tb.innerHTML = tx.map(t=>{
    const when=new Date(t.ts).toLocaleString();
    const meta=Object.entries(t.meta||{}).map(([k,v])=>`${k}:${v}`).join(', ');
    return `<tr><td>${when}</td><td>${t.type}</td><td>${t.amount_nle?`NLe ${t.amount_nle}`:'—'}</td><td class="muted">${meta}</td></tr>`;
  }).join('') || `<tr><td colspan="4" class="muted">No transactions yet.</td></tr>`;
}

// ===== Settings (admin / limited-admin) =====
function adminPanelAuthorized(){ const me=API._requireUser(); if(!me) return false; return sessionStorage.getItem('sl_admin_ok_'+me.id)==='1'; }
async function ensureAdminPanelAuth(){
  const me=API._requireUser(); if(!me) return false;
  if (!isAdminOrLimited(me)) return false;
  if (adminPanelAuthorized()) return true;
  const pwd=prompt('Enter admin panel password:'); if(!pwd) return false;
  if (pwd===ADMIN_PANEL_PASSWORD){ sessionStorage.setItem('sl_admin_ok_'+me.id,'1'); return true; }
  alert('Incorrect admin panel password.'); return false;
}
async function viewSettings(){
  renderBackBtn(true); setHeroVisible(false);
  const me=API._requireUser(); if(!me){ app.innerHTML='<p>Please log in.</p>'; return; }
  if (!isAdminOrLimited(me)){ app.innerHTML='<p>Restricted.</p>'; return; }
  const ok=await ensureAdminPanelAuth(); if(!ok){ app.innerHTML='<p>Admin password required.</p>'; return; }
  if (isMainAdmin(me)) return renderSettingsAdmin(); return renderSettingsLimited();
}
function renderSettingsLimited(){
  const d=DB.data;
  const boosted=(d.posts||[]).filter(p=> (Number(p.boosted_months||0)>0) || trialActive(p));
  const txByUser={}; (d.transactions||[]).forEach(t=>{ (txByUser[t.userId] ||= []).push(t); });
  app.innerHTML = `
    <section>
      <h2>Settings (Limited Admin)</h2>
      <div class="card">
        <h3>Boosted Users & Contacts</h3>
        <table><thead><tr><th>Listing</th><th>Owner</th><th>Boost</th><th>Contact phone</th><th>Transactions</th></tr></thead>
        <tbody id="limRows"></tbody></table>
      </div>
    </section>`;
  const tb=$('#limRows'); tb.innerHTML = boosted.map(p=>{
    const u=getUserById(p.userId)||{}; const tx=(txByUser[p.userId]||[]).map(x=>`<div>${new Date(x.ts).toLocaleDateString()} — ${x.type} — ${x.amount_nle?('NLe '+x.amount_nle):'—'}</div>`).join('')||'<span class="muted">None</span>';
    return `<tr><td><a href="#/item/${p.id}">${p.title||'—'}</a> <small class="muted">(${p.category})</small></td><td>${u.email||'—'}</td><td>${Number(p.boosted_months||0)} m ${trialActive(p)?' + trial':''}</td><td>${(p.boost_contact_phone||'').trim()||'—'}</td><td>${tx}</td></tr>`;
  }).join('') || `<tr><td colspan="5" class="muted">No boosted users yet.</td></tr>`;
}
function renderSettingsAdmin(){
  const d=DB.data;
  const pending=d.users.filter(u=>u.limitedAdminStatus==='pending');
  const approved=d.users.filter(u=>u.limitedAdminStatus==='approved');
  app.innerHTML = `
    <section>
      <h2>Settings (Main Admin)</h2>
      <div class="card">
        <h3>Limited Admin Management</h3>
        <h4 style="margin:6px 0">Pending</h4>
        <div id="laPending">${pending.length?'':''}</div>
        <h4 style="margin:12px 0 6px 0">Approved</h4>
        <div id="laApproved">${approved.length?'':''}</div>
      </div>
      <div class="card" style="margin-top:10px">
        <h3>Ads & Bloggers</h3>
        <div class="actions" style="margin-bottom:8px">
          <a class="btn" href="#/admin">Open Blogger Approvals</a>
          <a class="btn" href="#/ads/campaigns">Open Campaigns</a>
          <a class="btn" href="#/admin/app-ads">Send App Ads</a>
        </div>
        <p class="muted">Use these panels to approve bloggers, verify/assign campaigns, and broadcast in-app ads.</p>
      </div>
    </section>`;
  const mkRow=(u,kind)=>{
    const row=document.createElement('div'); row.style='display:flex;gap:8px;align-items:center;margin:6px 0;flex-wrap:wrap';
    row.innerHTML = `<span>${u.email}</span>`+
      (kind==='pending'
        ? ` <button class="btn ap">Approve</button> <button class="btn rej" style="background:#eee;border-color:#ddd">Reject</button>`
        : ` <button class="btn rm"  style="background:#eee;border-color:#ddd">Remove</button>`);
    if (kind==='pending'){
      row.querySelector('.ap').onclick=async()=>{ const r=await API.post('/api/admin/users/set-limited',{userId:u.id,status:'approved'}); if(r.error) return alert(r.error); alert('Approved'); renderSettingsAdmin(); };
      row.querySelector('.rej').onclick=async()=>{ const r=await API.post('/api/admin/users/set-limited',{userId:u.id,status:'none'});     if(r.error) return alert(r.error); alert('Rejected'); renderSettingsAdmin(); };
    }else{
      row.querySelector('.rm').onclick = async()=>{ const r=await API.post('/api/admin/users/set-limited',{userId:u.id,status:'none'}); if(r.error) return alert(r.error); alert('Removed'); renderSettingsAdmin(); };
    }
    return row;
  };
  const pwrap=$('#laPending'); pending.forEach(u=> pwrap.appendChild(mkRow(u,'pending')));
  const awrap=$('#laApproved'); approved.forEach(u=> awrap.appendChild(mkRow(u,'approved')));
}

// ===== Routing =====
function route(){
  const me=API._requireUser(); const hasToken=!!me;
  showAuthGate(!hasToken); if(!hasToken){ setStep('stepChoice'); return; }

  const h=location.hash.slice(2); const seg=h.split('?')[0].split('/').filter(Boolean);
  const qs=new URLSearchParams(location.hash.split('?')[1]||'');

  if (!seg.length) return viewHome();
  if (seg[0]==='goods') return viewCategory('goods');
  if (seg[0]==='services') return viewCategory('services');
  if (seg[0]==='rentals') return viewCategory('rentals');
  if (seg[0]==='jobs') return viewCategory('jobs');
  if (seg[0]==='ads') return viewCategory('ads');
  if (seg[0]==='search') return viewSearch(qs.get('q')||'');
  if (seg[0]==='post') return viewPost(seg[1]||'goods');
  if (seg[0]==='item') return viewItem(seg[1]);
  if (seg[0]==='inbox') return viewInbox();
  if (seg[0]==='listings') return viewListings();
  if (seg[0]==='account') return viewAccount();
  if (seg[0]==='settings') return viewSettings();

  // fallback
  return viewHome();
}
window.addEventListener('hashchange', route);

// ===== Admin panel password gate helpers already above =====

// ===== DOM Ready =====
window.addEventListener('DOMContentLoaded', async ()=>{
  const env = await fetch('./env.json').then(r=>r.json()).catch(()=>({}));
  AFRIMONEY_NUMBER = env.AFRIMONEY_NUMBER||'—';
  ORANGEMONEY_NUMBER = env.ORANGEMONEY_NUMBER||'—';
  GOOGLE_MAPS_API_KEY = env.GOOGLE_MAPS_API_KEY||'';
  ADMIN_EMAILS = Array.isArray(env.ADMIN_EMAILS)?env.ADMIN_EMAILS:[];
  COUNTRY_CODE_ALLOW = env.COUNTRY_CODE_ALLOW||'';
  GOOGLE_OAUTH_CLIENT_ID = env.GOOGLE_OAUTH_CLIENT_ID||'';
  ADMIN_PANEL_PASSWORD = env.ADMIN_PANEL_PASSWORD||'';

  $('#afr').textContent = AFRIMONEY_NUMBER; $('#orm').textContent = ORANGEMONEY_NUMBER;
  $('#globalSearch').addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ const q=e.currentTarget.value||''; location.hash = `#/search?q=${encodeURIComponent(q)}`; } });
  $('#goLocation').addEventListener('click', ()=>{ if(navigator.geolocation){ navigator.geolocation.getCurrentPosition(p=>{ setMyLoc(p.coords.latitude,p.coords.longitude); alert('Location set.'); }); } });

  renderAuth(); wireAuthGate(); mountHero();

  const fp=$('#footPost'); if(fp){ fp.addEventListener('click',(e)=>{ e.preventDefault(); openQuickPostChooser(); }); }
  route();
});

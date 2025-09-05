/* ===========================
   Minimal SPA + Local DB API
   =========================== */

// DOM helpers
const $ = (sel, node=document) => node.querySelector(sel);
const $$ = (sel, node=document) => Array.from(node.querySelectorAll(sel));
const cap = s => (s||'').charAt(0).toUpperCase() + (s||'').slice(1);

// Global ENV (loaded from /env.json at boot)
let AFRIMONEY_NUMBER = '—', ORANGEMONEY_NUMBER = '—', GOOGLE_MAPS_API_KEY = '', ADMIN_EMAILS = [], COUNTRY_CODE_ALLOW='';

// Emoji headings
const EMO = { goods:"🛍️", services:"🛠️", rentals:"🏡", jobs:"💼", ads:"📣", search:"🔎", inbox:"💬", listings:"📦", profile:"👤", location:"📍", admin:"🛡️" };
const titled = (key, text) => `${EMO[key] ? EMO[key]+" " : ""}${text}`;

// Local DB
const DB = {
  get data(){
    const raw = localStorage.getItem('sl_data');
    let d = raw ? JSON.parse(raw) : {};
    d.users ||= []; d.sessions ||= {}; d.posts ||= []; d.threads ||= []; d.messages ||= [];
    d.notifications ||= []; d.mails ||= [];
    d.quoteRequests ||= [];
    d.bloggers ||= [];
    d.adCampaigns ||= [];
    d.saved ||= [];
    return d;
  },
  set data(v){ localStorage.setItem('sl_data', JSON.stringify(v)); }
};
const uid = () => Math.random().toString(36).slice(2,9)+Date.now().toString(36);

// Geo helpers
function inSierraLeone(){
  // hard geofence via ISO country (from env), plus best-effort IP free check using localStorage cache
  // Since we are static, we can only enforce at UI level.
  return COUNTRY_CODE_ALLOW === 'SL';
}

// API shim
const API = {
  token: localStorage.getItem('token') || null,
  setToken(t){ this.token = t; localStorage.setItem('token', t||''); renderAuth(); route(); },
  _requireUser(){
    const d=DB.data, s=this.token && d.sessions[this.token];
    return s ? d.users.find(u=>u.id===s.userId) : null;
  },
  async get(path){
    // minimal GETs
    const d=DB.data;
    const me=this._requireUser();
    if (path.startsWith('/api/messages/thread')){
      const tid = new URLSearchParams(path.split('?')[1]).get('tid');
      const list = d.messages.filter(m=>m.threadId===tid).sort((a,b)=>a.ts-b.ts);
      return list;
    }
    if (path.startsWith('/api/messages/threads')){
      const mine = d.threads
        .filter(t=>me && t.participants.includes(me.id))
        .sort((a,b)=> b.updatedAt.localeCompare(a.updatedAt))
        .map(t=>{
          const otherId = t.participants.find(id=>id!==me.id);
          const other = d.users.find(u=>u.id===otherId) || {};
          const last = d.messages.filter(m=>m.threadId===t.id).sort((a,b)=>b.ts-a.ts)[0];
          let seenByOther=false;
          if (last && last.from===me.id){
            const rb = last.readBy || [];
            seenByOther = rb.includes(otherId);
          }
          return { id:t.id, withEmail:other.email||'(unknown)', lastText:last?last.text:'', updatedAt:t.updatedAt, seenByOther };
        });
      return mine;
    }
    if (path.startsWith('/api/posts?category=')){
      const cat = path.split('=')[1];
      return d.posts.filter(p=>p.category===cat);
    }
    return {};
  },
  async post(path, body){
    const d=DB.data;

    // ===== Auth =====
    if (path==='/api/auth/signup'){
      const {email,password} = body||{};
      if(!email||!password) return {error:'Email & password required'};
      if (d.users.some(u=>u.email===email)) return {error:'User exists'};
      const u = {id:uid(), email, password, limitedAdminStatus:'none'};
      d.users.push(u);
      const tok = uid(); d.sessions[tok]={userId:u.id}; DB.data=d;
      return {token:tok};
    }
    if (path==='/api/auth/login'){
      const {email,password}=body||{};
      const u=d.users.find(x=>x.email===email && x.password===password);
      if(!u) return {error:'Invalid credentials'};
      const tok=uid(); d.sessions[tok]={userId:u.id}; DB.data=d;
      return {token:tok};
    }
    if (path==='/api/auth/google/mock'){
      const {email}=body||{};
      let u=d.users.find(x=>x.email===email);
      if(!u){ u={id:uid(),email,password:'',limitedAdminStatus:'none'}; d.users.push(u); }
      const tok=uid(); d.sessions[tok]={userId:u.id}; DB.data=d;
      return {token:tok};
    }

    // ===== Admin helpers =====
    if (path==='/api/users/request-limited-admin'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      me.limitedAdminStatus = me.limitedAdminStatus==='approved' ? 'approved' : 'pending';
      DB.data=d; return {status:me.limitedAdminStatus};
    }

    // ===== Messaging =====
    if (path==='/api/messages/start'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      const {otherEmail} = body||{};
      const other = d.users.find(u=>u.email===otherEmail);
      if(!other) return {error:'No such user'};
      let th=d.threads.find(t=>t.participants?.length===2 && t.participants.includes(me.id) && t.participants.includes(other.id));
      if(!th){ th={id:uid(),participants:[me.id,other.id],updatedAt:new Date().toISOString()}; d.threads.push(th); DB.data=d; }
      return {threadId:th.id};
    }
    if (path==='/api/messages/start-with-user'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      const {userId}=body||{}; if(!userId) return {error:'userId required'};
      const other=d.users.find(u=>u.id===userId); if(!other) return {error:'User not found'};
      let th=d.threads.find(t=>t.participants?.length===2 && t.participants.includes(me.id) && t.participants.includes(other.id));
      if(!th){ th={id:uid(),participants:[me.id,other.id],updatedAt:new Date().toISOString()}; d.threads.push(th); DB.data=d; }
      return {threadId:th.id};
    }
    if (path==='/api/messages/send'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      const {threadId,text}=body||{};
      const th = d.threads.find(t=>t.id===threadId); if(!th) return {error:'No thread'};
      th.updatedAt = new Date().toISOString();
      const msg = { id:uid(), threadId, from:me.id, text:(text||'').trim(), ts:Date.now(), readBy:[me.id] };
      d.messages.push(msg); DB.data=d; return {ok:true};
    }
    if (path==='/api/messages/seen'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      if (isAdminOrLimited(me)) return {ok:true, skipped:'admin'};
      const {threadId}=body||{};
      const th = d.threads.find(t=>t.id===threadId);
      if (!th || !th.participants.includes(me.id)) return {error:'Not in thread'};
      let changed=0;
      d.messages.forEach(m=>{
        if (m.threadId!==threadId) return;
        m.readBy ||= [];
        if (!m.readBy.includes(me.id) && m.from!==me.id){ m.readBy.push(me.id); changed++; }
      });
      if (changed) DB.data=d;
      return {ok:true,changed};
    }

    // ===== Posts =====
    if (path==='/api/posts'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      // Sierra Leone geofence (UI-level)
      if (!isAdminOrLimited(me) && !inSierraLeone()) return {error:'Service available in Sierra Leone only'};
      const p = {
        id:uid(), userId:me.id,
        category:body.category,
        title:(body.title||'').trim(),
        price_cents:Number(body.price_cents||0),
        description:(body.description||'').trim(),
        boosted_months:Number(body.boosted_months||0),
        boost_contact_phone:(body.boost_contact_phone||'').trim(),
        is_pinned:false, pinned_at:null, pinned_by:null,

        // optional structured
        parent_cat: body.parent_cat||'',
        child_cat: body.child_cat||'',
        condition: body.condition||'',
        item_type: (body.item_type||'').trim(),
        brand: (body.brand||'').trim(),
        color: (body.color||'').trim(),
        price_firm: !!(body.price_firm==='1' || body.price_firm===true),
        photos: Array.isArray(body.photos)? body.photos.slice(0,8) : [],

        // Google location (all: goods/services/rentals supported)
        location_address: (body.location_address||'').trim(),
        location_lat: body.location_lat!=null ? Number(body.location_lat) : null,
        location_lng: body.location_lng!=null ? Number(body.location_lng) : null,
        location_place_id: (body.location_place_id||'').trim(),

        // Services specific
        intro:(body.intro||'').trim(),
        service_desc:(body.service_desc||'').trim(),
        service_parent:(body.service_parent||'').trim(),
        service_child:(body.service_child||'').trim(),
        price_model:(body.price_model||'').trim(),
        min_price_cents: body.min_price_cents!=null ? Number(body.min_price_cents) : null,
        service_radius_km: body.service_radius_km!=null ? Number(body.service_radius_km) : null,
        availability_days: Array.isArray(body.availability_days) ? body.availability_days : [],
        profile_photo_name: (body.profile_photo_name||'').trim(),
        portfolio_names: Array.isArray(body.portfolio_names) ? body.portfolio_names.slice(0,8) : [],

        createdAt:new Date().toISOString()
      };
      d.posts.push(p); DB.data=d; return p;
    }

    // Pin/Unpin by staff
    if (path==='/api/admin/posts/pin'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      if(!isAdminOrLimited(me)) return {error:'Staff only'};
      const {postId,pin}=body||{};
      const p = d.posts.find(x=>x.id===postId);
      if(!p) return {error:'Post not found'};
      p.is_pinned=!!pin; p.pinned_at = pin? new Date().toISOString(): null; p.pinned_by = pin? me.id : null;
      DB.data=d; return {ok:true,post:p};
    }

    // Saved toggle
    if (path==='/api/saved/toggle'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      const {postId} = body||{};
      const idx = d.saved.findIndex(s=>s.userId===me.id && s.postId===postId);
      let saved;
      if (idx>=0){ d.saved.splice(idx,1); saved=false; }
      else { d.saved.push({id:uid(), userId:me.id, postId, ts:Date.now()}); saved=true; }
      DB.data=d; return {ok:true, saved, count: saveCount(postId)};
    }

    // ===== Quotes (Services) =====
    if (path==='/api/quotes/create'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      const {postId, details} = body||{};
      const post = d.posts.find(p=>p.id===postId); if(!post) return {error:'Post not found'};
      if (post.category!=='services') return {error:'Quotes only for services'};
      const q = { id:uid(), postId, requesterId:me.id, providerId:post.userId, details:(details||'').trim(), status:'open', createdAt:new Date().toISOString() };
      d.quoteRequests.push(q); DB.data=d;
      // notify provider
      const th = await API.post('/api/messages/start-with-user',{userId:q.providerId});
      if(!th.error){ await API.post('/api/messages/send',{threadId:th.threadId, text:`New quote request for "${post.title}": ${q.details}`}); }
      notifyUser(post.userId,'New Quote Request', `For "${post.title}"`);
      sendMailMock(getUserById(post.userId)?.email||'', 'New Quote Request', q.details);
      return {ok:true, quote:q};
    }
    if (path==='/api/admin/quotes/list'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      if(!isAdminOrLimited(me)) return {error:'Staff only'};
      const list = d.quoteRequests.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(q=>{
        const buyer=d.users.find(u=>u.id===q.requesterId)||{}, prov=d.users.find(u=>u.id===q.providerId)||{}, post=d.posts.find(p=>p.id===q.postId)||{};
        return {...q, requesterEmail:buyer.email||'', providerEmail:prov.email||'', postTitle:post.title||''};
      });
      return {quotes:list};
    }
    if (path==='/api/admin/quotes/update'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      if(!isAdminOrLimited(me)) return {error:'Staff only'};
      const {quoteId,action}=body||{};
      const q=d.quoteRequests.find(x=>x.id===quoteId); if(!q) return {error:'Quote not found'};
      if (!['in_progress','closed','rejected'].includes(action)) return {error:'Unknown action'};
      q.status=action; DB.data=d; return {ok:true,quote:q};
    }

    // ===== Advertising (Bloggers & Campaigns) =====
    if (path==='/api/ads/blogger/create'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      const { platform, handle, price_cents, bio, followers, profile_photo_name } = body||{};
      let b = d.bloggers.find(x=>x.userId===me.id);
      if (!b){
        b = { id:uid(), userId:me.id, platform:(platform||'').trim(), handle:(handle||'').trim(), profile_photo_name:(profile_photo_name||'').trim(),
              followers:Number(followers||0), price_cents:Number(price_cents||0), bio:(bio||'').trim(), status:'pending', createdAt:new Date().toISOString()};
        d.bloggers.push(b);
      } else {
        b.platform=(platform||'').trim(); b.handle=(handle||'').trim(); b.profile_photo_name=(profile_photo_name||'').trim();
        b.followers=Number(followers||0); b.price_cents=Number(price_cents||0); b.bio=(bio||'').trim(); b.status=b.status||'pending';
      }
      DB.data=d; return {ok:true, blogger:b};
    }
    if (path==='/api/ads/blogger/list'){
      const list=(d.bloggers||[]).filter(b=>b.status==='approved').sort((a,b)=>(b.followers||0)-(a.followers||0));
      return {bloggers:list};
    }
    if (path==='/api/admin/bloggers/update'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      if(!isAdminOrLimited(me)) return {error:'Staff only'};
      const {bloggerId,action}=body||{};
      const b=d.bloggers.find(x=>x.id===bloggerId); if(!b) return {error:'Blogger not found'};
      if (!['approved','rejected','pending'].includes(action)) return {error:'Bad action'};
      b.status=action; DB.data=d; return {ok:true,blogger:b};
    }
    if (path==='/api/ads/campaign/create'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      const {product_title,product_desc,target_platform,budget_cents,payment_screenshot_name}=body||{};
      const c={ id:uid(), ownerId:me.id, product_title:(product_title||'').trim(), product_desc:(product_desc||'').trim(),
        target_platform:(target_platform||'').trim(), budget_cents:Number(budget_cents||0), payment_screenshot_name:(payment_screenshot_name||'').trim(),
        status:'pending_payment', assigned_blogger_id:null, commission_cents:null, createdAt:new Date().toISOString() };
      d.adCampaigns.push(c); DB.data=d; return {ok:true,campaign:c};
    }
    if (path==='/api/ads/campaigns/list'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      if(!isStaffOrBlogger(me)) return {error:'Restricted'};
      const items = d.adCampaigns.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(c=>{
        const owner=d.users.find(u=>u.id===c.ownerId)||{};
        return {...c, ownerEmail: isAdminOrLimited(me) ? (owner.email||'') : '' };
      });
      return {campaigns:items};
    }
    if (path==='/api/admin/ads/campaigns/verify'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      if(!isAdminOrLimited(me)) return {error:'Staff only'};
      const {campaignId}=body||{}; const c=d.adCampaigns.find(x=>x.id===campaignId); if(!c) return {error:'Campaign not found'};
      c.status='verified'; c.commission_cents=Math.round((c.budget_cents||0)*0.05); DB.data=d; return {ok:true,campaign:c};
    }
    if (path==='/api/admin/ads/campaigns/assign'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      if(!isAdminOrLimited(me)) return {error:'Staff only'};
      const {campaignId,bloggerId}=body||{}; const c=d.adCampaigns.find(x=>x.id===campaignId); const b=d.bloggers.find(x=>x.id===bloggerId && x.status==='approved');
      if(!c) return {error:'Campaign not found'}; if(!b) return {error:'Approved blogger not found'};
      c.assigned_blogger_id=b.id; c.status='assigned'; DB.data=d; return {ok:true,campaign:c};
    }
    if (path==='/api/admin/ads/campaigns/update'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      if(!isAdminOrLimited(me)) return {error:'Staff only'};
      const {campaignId,action}=body||{}; const c=d.adCampaigns.find(x=>x.id===campaignId); if(!c) return {error:'Campaign not found'};
      if (!['completed','rejected','pending_payment'].includes(action)) return {error:'Bad action'};
      c.status=action; DB.data=d; return {ok:true,campaign:c};
    }

    return {};
  },
  async postForm(path, form){
    const obj={}, photos=[];
    for (const [k,v] of form.entries()){
      if (k==='photos' && v instanceof File){ photos.push(v.name||'photo'); }
      else if (k==='portfolio' && v instanceof File){ (obj.portfolio_names ||= []).push(v.name||'photo'); }
      else if (k==='availability_days'){ (obj.availability_days ||= []).push(v); }
      else if (v instanceof File){ obj[`${k}_name`]= v.name||'upload'; }
      else {
        if (k==='portfolio_names'){ try{ obj.portfolio_names=JSON.parse(v); }catch{ obj.portfolio_names=[]; } }
        else obj[k]=v;
      }
    }
    if (photos.length) obj.photos=photos;
    return this.post(path,obj);
  }
};

// ENV load
window.addEventListener('DOMContentLoaded', async () => {
  const env = await fetch('./env.json').then(r=>r.json()).catch(()=>({}));
  AFRIMONEY_NUMBER = env.AFRIMONEY_NUMBER||'—';
  ORANGEMONEY_NUMBER = env.ORANGEMONEY_NUMBER||'—';
  GOOGLE_MAPS_API_KEY = env.GOOGLE_MAPS_API_KEY||'';
  ADMIN_EMAILS = Array.isArray(env.ADMIN_EMAILS)?env.ADMIN_EMAILS:[];
  COUNTRY_CODE_ALLOW = env.COUNTRY_CODE_ALLOW||'';
  $('#afr').textContent = AFRIMONEY_NUMBER; $('#orm').textContent = ORANGEMONEY_NUMBER;
  renderAuth(); route();
});

// Auth area
function isMainAdmin(user){ return !!user && ADMIN_EMAILS.includes(user.email); }
function isLimitedAdmin(user){ return !!user && user.limitedAdminStatus==='approved'; }
function isAdminOrLimited(user){ return isMainAdmin(user) || isLimitedAdmin(user); }

function renderAuth(){
  const el=$('#authArea'), me=API._requireUser();
  if (!me){
    el.innerHTML = `
      <input id="email" placeholder="email" /> <input id="pass" type="password" placeholder="password"/>
      <button id="loginBtn">Login</button>
      <button id="signupBtn">Sign up</button>
      <button id="googleBtn">Continue with Google</button>
    `;
    $('#loginBtn').onclick = async()=>{ const email=$('#email').value, password=$('#pass').value; const r=await API.post('/api/auth/login',{email,password}); if(r.token){ API.setToken(r.token); } else alert(r.error||'Login failed'); };
    $('#signupBtn').onclick = async()=>{ const email=$('#email').value, password=$('#pass').value; const r=await API.post('/api/auth/signup',{email,password}); if(r.token){ API.setToken(r.token); } else alert(r.error||'Signup failed'); };
    $('#googleBtn').onclick = async()=>{ const email=prompt('Google email (mock)'); if(!email) return; const r=await API.post('/api/auth/google/mock',{googleId:'mock-'+Date.now(),email}); if(r.token){ API.setToken(r.token); } };
  } else {
    el.innerHTML = `
      <span class="pill">Hi, ${me.email}</span>
      <button id="logoutBtn">Logout</button>
      <button id="reqLA">Request Limited Admin</button>
    `;
    $('#logoutBtn').onclick = ()=>{ API.setToken(null); location.hash='#/'; };
    $('#reqLA').onclick = async()=>{ const r=await API.post('/api/users/request-limited-admin',{}); alert('Limited admin status: '+(r.status||JSON.stringify(r))); };
  }
  toggleAdminLink();
}

function toggleAdminLink(){
  const me = API._requireUser();
  const adminLink  = $('#adminLink');
  const quotesLink = $('#quotesLink');
  const adCampLink = $('#adCampLink');
  if (adminLink)  adminLink.style.display  = isMainAdmin(me) ? '' : 'none';
  if (quotesLink) quotesLink.style.display = isAdminOrLimited(me) ? '' : 'none';
  if (adCampLink) adCampLink.style.display = (isAdminOrLimited(me) || isApprovedBlogger(me)) ? '' : 'none';
}

// Notif + mail helpers
function notifyUser(userId,title,body){
  const d=DB.data; d.notifications ||= []; d.notifications.push({id:uid(),userId,title,body,ts:Date.now(),read:false}); DB.data=d;
}
function listMyNotifications(){ const me=API._requireUser(); if(!me) return []; const d=DB.data; return (d.notifications||[]).filter(n=>n.userId===me.id).sort((a,b)=>b.ts-a.ts); }
function markAllNotificationsRead(){ const me=API._requireUser(); if(!me) return; const d=DB.data; (d.notifications||[]).forEach(n=>{ if(n.userId===me.id) n.read=true; }); DB.data=d; }
function sendMailMock(to,subject,body){ if(!to) return; const d=DB.data; d.mails ||= []; d.mails.push({id:uid(),to,subject,body,ts:Date.now()}); DB.data=d; }
function getUserById(id){ const d=DB.data; return d.users.find(u=>u.id===id)||null; }
function cents(n){ n=Number(n||0); return 'NLe '+(n/100).toFixed(2); }

// Blogger helper
function isApprovedBlogger(user){ if(!user) return false; const d=DB.data; return (d.bloggers||[]).some(b=>b.userId===user.id && b.status==='approved'); }
function isStaffOrBlogger(u){ return isAdminOrLimited(u) || isApprovedBlogger(u); }

// Google Maps loader
let _mapsLoading=null;
function ensureGoogleMaps(){
  if (!GOOGLE_MAPS_API_KEY) return Promise.resolve(null);
  if (_mapsLoading) return _mapsLoading;
  _mapsLoading = new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&libraries=places`;
    s.async=true; s.defer=true;
    s.onload=()=>resolve(window.google?.maps||null);
    s.onerror=()=>reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(s);
  });
  return _mapsLoading;
}

// Sorting: pinned -> boosted -> newest
function sortPostsForFeed(items){
  return items.slice().sort((a,b)=>{
    const ap=a.is_pinned?1:0, bp=b.is_pinned?1:0;
    if (bp!==ap) return bp-ap;
    const ab=(Number(b.boosted_months||0)-Number(a.boosted_months||0));
    if (ab!==0) return ab;
    return (b.createdAt||'').localeCompare(a.createdAt||'');
  });
}

// Saved helpers
function isSaved(postId){ const me=API._requireUser?.(); if(!me) return false; const d=DB.data; return (d.saved||[]).some(s=>s.userId===me.id && s.postId===postId); }
function saveCount(postId){ const d=DB.data; return (d.saved||[]).filter(s=>s.postId===postId).length; }

// UI primitives
const app = $('#app');
const card = (t,d,b) => { const div=document.createElement('div'); div.className='card'; if(b){ const s=document.createElement('span'); s.className='badge'; s.textContent=b; div.appendChild(s); } div.innerHTML += `<h3>${t}</h3><p class="muted">${d||''}</p>`; return div; };

// Attach Share & Save
function attachShareSave(container, post){
  const bar=document.createElement('div'); bar.className='actions'; bar.style.marginTop='8px';
  const saved=isSaved(post.id), count=saveCount(post.id);
  const shareUrl=`${location.origin}${location.pathname}#/item/${post.id}`;
  bar.innerHTML = `
    <button class="shareBtn">Share</button>
    <button class="saveBtn">${saved?'Saved':'Save'}</button>
    <small class="muted" style="margin-left:6px">${count?`${count} saved`:''}</small>
  `;
  bar.querySelector('.shareBtn').onclick = async()=>{
    const text=`${post.title||'Listing'} — ${post.category||''}`;
    try{
      if (navigator.share){ await navigator.share({title:post.title||'Listing', text, url:shareUrl}); }
      else { await navigator.clipboard.writeText(shareUrl); alert('Link copied!'); }
    }catch{}
  };
  bar.querySelector('.saveBtn').onclick = async()=>{
    const me=API._requireUser(); if(!me){ alert('Please log in first.'); return; }
    const r=await API.post('/api/saved/toggle',{postId:post.id});
    if(r.error){ alert(r.error); return; }
    bar.querySelector('.saveBtn').textContent = r.saved?'Saved':'Save';
    const cnt=bar.querySelector('small'); cnt.textContent = r.count?`${r.count} saved`:'';
  };
  container.appendChild(bar);
}

/* ===========================
   Views
   =========================== */

async function viewHome(){
  app.innerHTML = `<h2>${titled('goods','Home · Goods Feed')}</h2><div class="grid" id="grid"></div>`;
  const posts = await API.get('/api/posts?category=goods');
  const list = sortPostsForFeed(posts);
  const grid=$('#grid');
  list.forEach(p=> renderCard(p, grid));
}

function renderCard(p, grid){
  const bits=[];
  if (p.is_pinned) bits.push('Top');
  if (p.boosted_months>0) bits.push('Premium');
  if (p.price_firm) bits.push('Firm');
  if (p.condition) bits.push(p.condition);

  const c = card(p.title, p.description, bits.join(' • '));

  if (p.location_address){
    const loc=document.createElement('p'); loc.className='muted'; loc.style.marginTop='6px';
    loc.textContent=`📍 ${p.location_address}`; c.appendChild(loc);
  }

  // per-category actions
  if (p.category==='goods'){
    const actions=document.createElement('div'); actions.className='actions'; actions.style.marginTop='8px';
    actions.innerHTML = `<button class="contact">Message Seller</button>`;
    actions.querySelector('.contact').onclick = async()=>{
      const me=API._requireUser(); if(!me){ alert('Please log in first.'); return; }
      const r=await API.post('/api/messages/start-with-user',{userId:p.userId});
      if(r.error){ alert(r.error); return; } location.hash=`#/chat/${r.threadId}`;
    };
    c.appendChild(actions);
  }
  if (p.category==='services'){
    const actions=document.createElement('div'); actions.className='actions'; actions.style.marginTop='8px';
    actions.innerHTML = `<button class="quote">Request Quote</button> <button class="contact">Message Provider</button>`;
    actions.querySelector('.contact').onclick = async()=>{
      const me=API._requireUser(); if(!me){ alert('Please log in first.'); return; }
      const r=await API.post('/api/messages/start-with-user',{userId:p.userId}); if(r.error){ alert(r.error); return; }
      location.hash=`#/chat/${r.threadId}`;
    };
    actions.querySelector('.quote').onclick = async()=>{
      const me=API._requireUser(); if(!me){ alert('Please log in first.'); return; }
      const details=prompt('Describe the work and timeline for your quote:'); if(details==null||!details.trim()) return;
      const r=await API.post('/api/quotes/create',{postId:p.id, details}); if(r.error){ alert(r.error); return; }
      alert('Quote request sent! We also messaged the provider.'); location.hash='#/inbox';
    };
    c.appendChild(actions);
  }

  // staff pin control
  const me=API._requireUser?.();
  if (isAdminOrLimited(me)){
    const staff=document.createElement('div'); staff.className='actions'; staff.style.marginTop='6px';
    staff.innerHTML = `<button class="pinBtn">${p.is_pinned?'Unpin from Top':'Pin to Top'}</button>`;
    staff.querySelector('.pinBtn').onclick = async()=>{
      const r=await API.post('/api/admin/posts/pin',{postId:p.id, pin:!p.is_pinned});
      if(r.error){ alert(r.error); return; } route();
    };
    // show seller phone (boost)
    if ((p.boosted_months||0)>0 && (p.boost_contact_phone||'').trim()){
      const phone=document.createElement('p'); phone.className='muted'; phone.style.margin='4px 0 0';
      const tel=String(p.boost_contact_phone).trim();
      phone.innerHTML = `☎️ <strong>Seller phone:</strong> <a href="tel:${tel}">${tel}</a>`;
      staff.appendChild(phone);
    }
    c.appendChild(staff);
  }

  // share & save
  attachShareSave(c,p);

  grid.appendChild(c);
}

async function viewCategory(category){
  const label=cap(category);
  app.innerHTML = `<h2>${titled(category, `${label} Feed`)}</h2><div class="grid" id="grid"></div>`;
  const grid=$('#grid');

  // Jobs CTA
  if (category==='jobs'){
    const cta=document.createElement('div');
    cta.style='margin:8px 0 14px 0; display:flex; justify-content:flex-start;';
    cta.innerHTML = `<a href="#/post/jobs" class="btn">Post a Job</a>`;
    grid.parentNode.insertBefore(cta, grid);
  }

  if (category==='ads'){ return viewAds(); }

  const posts = await API.get(`/api/posts?category=${category}`);
  sortPostsForFeed(posts).forEach(p=> renderCard(p, grid));
}

async function viewItem(itemId){
  const d=DB.data; const p=(d.posts||[]).find(x=>x.id===itemId);
  if(!p){ app.innerHTML='<p>Item not found.</p>'; return; }
  app.innerHTML = `<section><h2>${(p.category||'').toUpperCase()} · ${p.title||''}</h2><div class="card" id="itemCard"></div><p style="margin-top:10px"><a href="#/${p.category||''}">← Back to ${p.category||'feed'}</a></p></section>`;
  const c = card(p.title, p.description, [p.is_pinned?'Top':'',(p.boosted_months||0)>0?'Premium':'',p.condition||''].filter(Boolean).join(' • '));
  if (p.location_address){ const loc=document.createElement('p'); loc.className='muted'; loc.style.marginTop='6px'; loc.textContent=`📍 ${p.location_address}`; c.appendChild(loc); }
  // per-category minimal action
  if (p.category==='goods'){
    const a=document.createElement('div'); a.className='actions'; a.style.marginTop='8px';
    a.innerHTML=`<button class="contact">Message Seller</button>`;
    a.querySelector('.contact').onclick=async()=>{ const me=API._requireUser(); if(!me){ alert('Please log in'); return; } const r=await API.post('/api/messages/start-with-user',{userId:p.userId}); if(r.error){ alert(r.error); return; } location.hash=`#/chat/${r.threadId}`; };
    c.appendChild(a);
  }
  attachShareSave(c,p);
  $('#itemCard').appendChild(c);
}

async function viewSearch(){
  const q = prompt('Search term:')||'';
  const d=DB.data;
  const list = d.posts.filter(p=> [p.title,p.description].join(' ').toLowerCase().includes(q.toLowerCase()));
  app.innerHTML = `<h2>${titled('search','Search')}</h2><p class="muted">Results for: <strong>${q||'—'}</strong></p><div class="grid" id="grid"></div>`;
  const grid=$('#grid');
  sortPostsForFeed(list).forEach(p=>{
    const c=card(p.title, p.description, [(p.is_pinned?'Top':''),(p.boosted_months>0?'Premium':'')].filter(Boolean).join(' • '));
    if (p.location_address){ const loc=document.createElement('p'); loc.className='muted'; loc.style.marginTop='6px'; loc.textContent=`📍 ${p.location_address}`; c.appendChild(loc); }
    attachShareSave(c,p);
    grid.appendChild(c);
  });
}

async function viewListings(){
  const me=API._requireUser(); if(!me){ app.innerHTML='<p>Please log in.</p>'; return; }
  const d=DB.data; const mine=d.posts.filter(p=>p.userId===me.id);
  app.innerHTML = `<section><h2>${titled('listings','Your Listings')}</h2><div class="grid" id="grid"></div></section>`;
  const grid=$('#grid');
  sortPostsForFeed(mine).forEach(p=> renderCard(p,grid));
}

async function viewInbox(){
  const me=API._requireUser(); if(!me){ app.innerHTML='<p>Please log in.</p>'; return; }
  app.innerHTML = `<section><h2>${titled('inbox','Inbox')}</h2><div id="threads"></div></section>`;

  // notifications card
  const notes=listMyNotifications();
  if (notes.length){
    const n=document.createElement('div'); n.className='card';
    n.innerHTML = `<h3 style="margin:0 0 8px 0;">Notifications</h3><ul style="margin:0;padding-left:18px">${notes.map(n=>`<li><strong>${n.title}</strong> — ${n.body}<br/><small class="muted">${new Date(n.ts).toLocaleString()}</small></li>`).join('')}</ul><div class="actions" style="margin-top:8px"><button id="markNotes">Mark all read</button></div>`;
    $('#threads').appendChild(n);
    $('#markNotes').onclick=()=>{ markAllNotificationsRead(); alert('Notifications marked read'); route(); };
  }

  const tgrid=document.createElement('div'); tgrid.className='grid'; $('#threads').appendChild(tgrid);
  const list = await API.get('/api/messages/threads');
  list.forEach(t=>{
    const div=document.createElement('div'); div.className='card';
    div.innerHTML = `<h3>${t.withEmail}</h3><p class="muted">${t.lastText||'—'}</p>${t.seenByOther?'<small class="muted">Seen</small>':''}<div class="actions" style="margin-top:8px"><a class="btn" href="#/chat/${t.id}">Open</a></div>`;
    tgrid.appendChild(div);
  });
}

async function viewChat(threadId){
  const me=API._requireUser(); if(!me){ app.innerHTML='<p>Please log in.</p>'; return; }
  app.innerHTML = `<section><h2>${titled('inbox','Chat')}</h2><div class="card" style="display:flex;flex-direction:column;gap:8px;height:60vh"><div id="msgs" style="overflow:auto;display:flex;flex-direction:column;gap:8px"></div><div class="row"><div><input id="msgText" placeholder="Type a message"/></div><div><button id="sendBtn">Send</button></div></div></div></section>`;

  async function render(){
    const msgs = await API.get(`/api/messages/thread?tid=${encodeURIComponent(threadId)}`);
    const d=DB.data; const th=d.threads.find(t=>t.id===threadId); const otherId=th?.participants?.find(id=>id!==me.id);
    const box=$('#msgs'); box.innerHTML='';
    msgs.forEach(m=>{
      const mine = m.from===me.id;
      const item=document.createElement('div'); item.style.alignSelf=mine?'flex-end':'flex-start'; item.className='card'; item.style.maxWidth='75%';
      const ts=new Date(m.ts).toLocaleString();
      item.innerHTML = `<p>${m.text}</p><small class="muted">${ts}</small>`;
      if (mine){
        const rb=m.readBy||[]; const seenByOther=otherId?rb.includes(otherId):false;
        const isMyLast = msgs.filter(x=>x.from===me.id).slice(-1)[0]?.id===m.id;
        if (isMyLast && seenByOther){ const s=document.createElement('div'); s.innerHTML='<small class="muted">Seen</small>'; item.appendChild(s); }
      }
      box.appendChild(item);
    });
    box.scrollTop=box.scrollHeight;
  }

  $('#sendBtn').onclick = async()=>{
    const t=$('#msgText').value.trim(); if(!t) return;
    await API.post('/api/messages/send',{threadId, text:t}); $('#msgText').value=''; await render();
  };

  await render();
  await API.post('/api/messages/seen',{threadId});
}

async function viewLocation(){
  app.innerHTML = `<section><h2>${titled('location','My Location')}</h2><p class="muted">Used to improve search and show nearby items. (Static demo)</p></section>`;
}

/* ---------- Ads pages ---------- */
async function viewAds(){
  app.innerHTML = `<h2>${titled('ads','Advertising')}</h2><div class="grid" id="adsGrid"></div>`;
  const g=$('#adsGrid');

  // blogger CTA
  const b1=document.createElement('div'); b1.className='card'; b1.innerHTML=`<h3>Are you a Blogger/Influencer?</h3><p class="muted">List your account, show your price, and get campaigns.</p><div class="actions"><a href="#/ads/become-blogger" class="btn">List my account</a></div>`; g.appendChild(b1);
  // advertiser CTA
  const b2=document.createElement('div'); b2.className='card'; b2.innerHTML=`<h3>Promote a Product</h3><p class="muted">Create a campaign with a payment screenshot. Admin will verify and assign a blogger. 5% commission applies.</p><div class="actions"><a href="#/ads/create-campaign" class="btn">Create campaign</a></div>`; g.appendChild(b2);

  const list=await API.post('/api/ads/blogger/list',{});
  const rows=(list.bloggers||[]).map(b=>`
    <tr data-id="${b.id}">
      <td>${b.platform||''}</td><td>${b.handle||''}</td><td>${b.followers||0}</td><td>${cents(b.price_cents||0)}</td><td>${b.profile_photo_name||'—'}</td>
      <td><button class="msg">Message</button></td>
    </tr>`).join('');
  const table=document.createElement('div');
  table.innerHTML=`<div class="card" style="margin-top:10px"><h3 style="margin:0 0 8px 0;">Approved Bloggers</h3>
  <table class="table"><thead><tr><th>Platform</th><th>Handle</th><th>Followers</th><th>Price</th><th>Profile Pic</th><th></th></tr></thead><tbody>${rows||''}</tbody></table>
  ${!rows?'<p class="muted">No bloggers yet.</p>':''}</div>`;
  g.appendChild(table);
  table.querySelectorAll('tr').forEach(tr=>{
    const id=tr.getAttribute('data-id');
    tr.querySelector('.msg').onclick=async()=>{
      const d=DB.data; const b=(d.bloggers||[]).find(x=>x.id===id); if(!b){alert('Missing blogger');return;}
      const r=await API.post('/api/messages/start-with-user',{userId:b.userId}); if(r.error){ alert(r.error); return; } location.hash=`#/chat/${r.threadId}`;
    };
  });
}
async function viewBecomeBlogger(){
  const me=API._requireUser(); if(!me){ app.innerHTML='<p>Please log in.</p>'; return; }
  app.innerHTML = `<h2>${titled('ads','List your Blogger Account')}</h2>
  <form id="bform" class="card">
    <label>Platform <select name="platform" required><option value="">— Select —</option><option>Facebook</option><option>Instagram</option><option>TikTok</option><option>Twitter</option><option>Other</option></select></label>
    <label>Handle <input name="handle" placeholder="@yourhandle" required /></label>
    <label>Followers <input name="followers" type="number" min="0" placeholder="e.g., 12000" /></label>
    <label>Price per Post (¢) <input name="price_cents" type="number" min="0" placeholder="e.g., 250000" /></label>
    <label>Profile Picture <input type="file" id="bloggerPic" accept="image/*" /></label>
    <label>About / Bio <textarea name="bio" placeholder="Short pitch…"></textarea></label>
    <div class="actions"><button type="submit">Submit for Approval</button></div>
  </form>`;
  $('#bform').onsubmit=async(e)=>{e.preventDefault();const fd=new FormData(e.target);const pic=$('#bloggerPic')?.files?.[0]; if(pic&&pic.name) fd.set('profile_photo_name',pic.name); const obj={}; for(const [k,v] of fd.entries()){ if(!(v instanceof File)) obj[k]=v; } const r=await API.post('/api/ads/blogger/create',obj); if(r.error){alert(r.error);return;} alert('Submitted! Wait for approval.'); location.hash='#/ads';};
}
async function viewCreateCampaign(){
  const me=API._requireUser(); if(!me){ app.innerHTML='<p>Please log in.</p>'; return; }
  app.innerHTML=`<h2>${titled('ads','Create Ad Campaign')}</h2>
  <form id="cform" class="card">
    <label>Product / Offer Title <input name="product_title" required placeholder="e.g., Honey 1L Promo" /></label>
    <label>Description / Goals <textarea name="product_desc" required placeholder="Describe the product, target audience, goals…"></textarea></label>
    <label>Target Platform <select name="target_platform"><option>Any</option><option>Facebook</option><option>Instagram</option><option>TikTok</option><option>Twitter</option></select></label>
    <label>Budget (¢) <input name="budget_cents" type="number" min="0" placeholder="e.g., 1000000" /></label>
    <label>Payment Screenshot <input type="file" id="payShot" accept="image/*,application/pdf" required /></label>
    <div class="actions"><button type="submit">Submit Campaign</button></div>
  </form>
  <p class="muted" style="margin-top:8px">Only Admin and approved Bloggers can view campaigns. A <strong>5% commission</strong> is applied on verification.</p>`;
  $('#cform').onsubmit=async(e)=>{e.preventDefault(); const fd=new FormData(e.target); const shot=$('#payShot')?.files?.[0]; if(shot&&shot.name) fd.set('payment_screenshot_name',shot.name); const obj={}; for(const [k,v] of fd.entries()){ if(!(v instanceof File)) obj[k]=v; } const r=await API.post('/api/ads/campaign/create',obj); if(r.error){ alert(r.error); return;} alert('Campaign submitted!'); location.hash='#/inbox'; };
}
async function viewAdCampaigns(){
  const me=API._requireUser(); if(!me){ app.innerHTML='<p>Please log in.</p>'; return; }
  if(!isStaffOrBlogger(me)){ app.innerHTML='<p>Restricted.</p>'; return; }
  app.innerHTML = `<section><h2>${titled('ads','Ad Campaigns')}</h2><div id="campWrap" class="card"></div>${isAdminOrLimited(me)?`<div id="bloggerApprove" class="card" style="margin-top:10px"></div>`:''}</section>`;
  async function renderCampaigns(){
    const res=await API.post('/api/ads/campaigns/list',{}); if(res.error){ $('#campWrap').innerHTML=`<p>${res.error}</p>`; return; }
    const d=DB.data; const bloggers=(d.bloggers||[]).filter(b=>b.status==='approved');
    const options=bloggers.map(b=>`<option value="${b.id}">${b.platform} · ${b.handle} (${cents(b.price_cents||0)})</option>`).join('');
    const rows=(res.campaigns||[]).map(c=>`
      <tr data-id="${c.id}">
        <td>${c.product_title||''}<br/><small class="muted">${c.target_platform||'Any'}</small></td>
        <td>${c.ownerEmail||''}</td>
        <td>${cents(c.budget_cents||0)}<br/><small class="muted">Fee 5%: ${c.commission_cents!=null?cents(c.commission_cents):'—'}</small></td>
        <td>${c.payment_screenshot_name||'—'}</td>
        <td><span class="badge">${c.status}</span></td>
        <td>
          ${isAdminOrLimited(me)?`
            <button class="verify">Verify</button>
            <select class="assignSel"><option value="">Assign blogger…</option>${options}</select>
            <button class="complete">Complete</button>
            <button class="reject">Reject</button>
          `:`<button class="msg-owner">Message Owner</button>`}
        </td>
      </tr>`).join('');
    $('#campWrap').innerHTML=`<table class="table"><thead><tr><th>Campaign</th><th>Owner</th><th>Budget</th><th>Screenshot</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows||''}</tbody></table>${!rows?'<p class="muted">No campaigns yet.</p>':''}`;
    $('#campWrap').querySelectorAll('tr').forEach(tr=>{
      const id=tr.dataset.id;
      const call=async(p,pl)=>{ const r=await API.post(p,pl); if(r.error){ alert(r.error);} await renderCampaigns(); };
      tr.querySelector('.verify')?.addEventListener('click', ()=>call('/api/admin/ads/campaigns/verify',{campaignId:id}));
      tr.querySelector('.complete')?.addEventListener('click', ()=>call('/api/admin/ads/campaigns/update',{campaignId:id,action:'completed'}));
      tr.querySelector('.reject')?.addEventListener('click', ()=>call('/api/admin/ads/campaigns/update',{campaignId:id,action:'rejected'}));
      const sel=tr.querySelector('.assignSel'); sel && (sel.onchange=()=>{ const bloggerId=sel.value; if(!bloggerId) return; call('/api/admin/ads/campaigns/assign',{campaignId:id, bloggerId}); });
      tr.querySelector('.msg-owner')?.addEventListener('click', async()=>{
        const cam=DB.data.adCampaigns.find(x=>x.id===id); if(!cam){alert('Missing');return;}
        const r=await API.post('/api/messages/start-with-user',{userId:cam.ownerId}); if(r.error){alert(r.error);return;} location.hash=`#/chat/${r.threadId}`;
      });
    });
  }
  async function renderBloggerApprovals(){
    if(!isAdminOrLimited(me)) return;
    const d=DB.data; const pen=(d.bloggers||[]).filter(b=>b.status!=='approved');
    const rows=pen.map(b=>`<tr data-id="${b.id}"><td>${b.platform||''}</td><td>${b.handle||''}</td><td>${b.followers||0}</td><td>${cents(b.price_cents||0)}</td><td>${b.profile_photo_name||'—'}</td><td>${b.status}</td><td><button class="approve">Approve</button><button class="reject">Reject</button></td></tr>`).join('');
    $('#bloggerApprove').innerHTML = `<h3 style="margin:0 0 8px 0;">Blogger Approvals</h3><table class="table"><thead><tr><th>Platform</th><th>Handle</th><th>Followers</th><th>Price</th><th>Photo</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows||''}</tbody></table>${!rows?'<p class="muted">Nothing to review.</p>':''}`;
    $('#bloggerApprove').querySelectorAll('tr').forEach(tr=>{
      const id=tr.dataset.id;
      tr.querySelector('.approve').onclick=async()=>{ await API.post('/api/admin/bloggers/update',{bloggerId:id,action:'approved'}); await renderBloggerApprovals(); await renderCampaigns(); };
      tr.querySelector('.reject').onclick =async()=>{ await API.post('/api/admin/bloggers/update',{bloggerId:id,action:'rejected'}); await renderBloggerApprovals(); await renderCampaigns(); };
    });
  }
  await renderCampaigns(); await renderBloggerApprovals();
}

/* ---------- Post forms (Goods/Services/Rentals/Jobs/Ads) ---------- */

const SERVICES_TAXONOMY = {
  "Home Services": ["Plumber","Electrician","Contractor","House Cleaning","Painting","Furniture Assembly","Interior Decoration","AC Specialist","TV Repairer","Appliance Repair","Pest Control"],
  "Food & Events": ["Personal Chef","Catering","Baker","Event Planner","Decorator","DJ/MC","Photography","Videography"],
  "Personal & Wellness": ["Hair Stylist","Makeup Artist","Massage","Fitness Trainer","Nail Technician","Tailor"],
  "Tech & Office": ["Computer Repair","Phone Repair","IT Support","Graphic Design","Web Design","Printing"],
  "Transport & Moving": ["Driver","Motorbike Delivery","Moving Help","Courier"],
  "Lessons & Coaching": ["Tutoring","Language Lessons","Music Lessons","Career Coaching"],
  "Other": ["General Labor","Errands","Carpentry","Masonry"]
};
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

function googleLocationBlock(){
  return `
<div class="card" style="margin-top:10px;">
  <h3 style="margin:4px 0 8px 0;">Location</h3>
  <div class="row">
    <div><label>Search address (Google) <input id="placeInput" placeholder="Start typing… (Sierra Leone)" /></label></div>
    <div><label>Chosen address <input name="location_address" id="locAddress" readonly /></label></div>
  </div>
  <div class="row">
    <div><button type="button" id="useGPS">Use my current location</button></div>
    <div><small class="muted">We save a general location with your listing.</small></div>
  </div>
  <div id="postMap" style="height:240px;display:none;margin-top:10px;border:1px solid #e5e7eb;border-radius:10px;"></div>
  <input type="hidden" name="location_lat" id="locLat">
  <input type="hidden" name="location_lng" id="locLng">
  <input type="hidden" name="location_place_id" id="locPid">
</div>`;
}

function boostBlock(){
  return `
<div class="card" id="boostCard" style="margin-top:10px;">
  <h3 style="margin:4px 0 8px 0;">Boost & Premium</h3>
  <label>Boost Months (0-12)
    <input name="boosted_months" id="boostMonths" type="number" min="0" max="12" value="0"/>
  </label>
  <label>Seller Contact Phone (Admin only; for boosted posts)
    <input name="boost_contact_phone" placeholder="+232…"/>
    <small class="muted">Only visible to Admin/Limited Admin to verify boosted listings.</small>
  </label>
  <div id="premiumTeaser" class="muted" style="margin-top:6px; display:flex; align-items:center; gap:8px;">
    <span class="badge">Premium</span>
    <span>Get quick responses when you upgrade to <strong>Premium</strong>.</span>
  </div>
  <div class="muted" style="margin-top:6px">Let your item be <strong>priority at the top</strong>.</div>
</div>`;
}

function postForm({category, allowBoost=false}){
  const wrap=document.createElement('div');
  const niceTitle=(category==='jobs')?'Post a Job':`Create ${cap(category)} Post`;
  wrap.innerHTML = `
  <h2>${EMO[category]||''} ${niceTitle}</h2>
  <form id="pform">
    <div class="row">
      <div><label>Title <input name="title" required /></label></div>
      <div><label>Price (¢) <input name="price_cents" type="number" min="0" /></label></div>
    </div>

    ${category!=='services'? googleLocationBlock(): ''}

    ${category==='services' ? `
      <div class="card" style="margin-top:10px;">
        <h3 style="margin:4px 0 8px 0;">About Your Service</h3>
        <div class="row">
          <div><label>Introduction (short) <input name="intro" placeholder="e.g., Reliable plumber with 8+ years experience" /></label></div>
        </div>
        <div class="row">
          <div><label>Parent Category <select name="service_parent" id="svcParent"></select></label></div>
          <div><label>Sub-Category <select name="service_child" id="svcChild"></select></label></div>
        </div>
        <div class="row">
          <div><label>Price Model
            <select name="price_model" id="priceModel">
              <option value="">— Select —</option><option value="hourly">Hourly</option><option value="flat">Flat Rate</option><option value="negotiable">Negotiable</option><option value="free">Free</option>
            </select></label></div>
          <div><label>Minimum Price (¢) <input name="min_price_cents" type="number" min="0" placeholder="e.g., 50000" /></label></div>
        </div>
        <div class="row">
          <div><label>Service Area Radius (km) <input name="service_radius_km" type="number" min="0" placeholder="e.g., 10" /></label></div>
          <div><label>Availability (days) <div id="daysBox" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;"></div></label></div>
        </div>
        <label>Services Description <textarea name="service_desc" placeholder="Describe what you offer…"></textarea></label>
      </div>

      ${googleLocationBlock()}

      <div class="card" style="margin-top:10px;">
        <h3 style="margin:4px 0 8px 0;">Photos</h3>
        <div class="row">
          <div>
            <label>Profile Picture <input type="file" id="profilePic" accept="image/*" /></label>
            <div id="profilePrev" class="photos" style="margin-top:6px;"></div>
          </div>
          <div>
            <label>Portfolio (up to 8) <input type="file" id="portfolio" accept="image/*" multiple /></label>
            <div id="portfolioStrip" class="photos" style="margin-top:6px;"></div>
          </div>
        </div>
      </div>
    ` : ''}

    ${allowBoost? boostBlock(): ''}

    <label>Description <textarea name="description"></textarea></label>

    <div class="actions"><button type="submit" id="submitBtn">${category==='jobs'?'Post Job':'Publish'}</button></div>
  </form>
  `;

  // init google location widgets for any block present
  const form = wrap.querySelector('#pform');

  const wireMaps = async(root)=>{
    const mapEl=root.querySelector('#postMap'); if(!mapEl) return;
    const input=root.querySelector('#placeInput'), addr=root.querySelector('#locAddress');
    const latEl=root.querySelector('#locLat'), lngEl=root.querySelector('#locLng'), pidEl=root.querySelector('#locPid');
    const gpsBtn=root.querySelector('#useGPS');
    const maps = await ensureGoogleMaps().catch(()=>null);
    let map=null, marker=null, geocoder=null, autocomplete=null;
    function updateLocation(lat,lng,address='',placeId=''){
      if (!isFinite(lat)||!isFinite(lng)) return;
      latEl.value=String(lat); lngEl.value=String(lng); if(address) addr.value=address; if(placeId) pidEl.value=placeId;
      if (map&&marker){ const pos={lat:Number(lat),lng:Number(lng)}; marker.setPosition(pos); map.setCenter(pos); if(mapEl.style.display==='none'){mapEl.style.display='block';} map.setZoom(15); }
    }
    if (maps){
      geocoder=new maps.Geocoder(); const centerSL={lat:8.465, lng:-11.779};
      map=new maps.Map(mapEl,{center:centerSL,zoom:12}); marker=new maps.Marker({map,position:centerSL,draggable:true}); mapEl.style.display='block';
      if (maps.places && input){
        autocomplete = new maps.places.Autocomplete(input,{componentRestrictions:{country:['sl']}});
        autocomplete.addListener('place_changed', ()=>{ const plc=autocomplete.getPlace(); const loc=plc?.geometry?.location; if(!loc) return; updateLocation(loc.lat(),loc.lng(), plc.formatted_address||plc.name||'', plc.place_id||''); });
      }
      marker.addListener('dragend', ()=>{ const pos=marker.getPosition(); const lat=pos.lat(),lng=pos.lng(); if(geocoder){ geocoder.geocode({location:{lat,lng}}, (res)=>{ const r0=res?.[0]; updateLocation(lat,lng, r0?.formatted_address||'', r0?.place_id||''); }); } else updateLocation(lat,lng); });
    }
    gpsBtn?.addEventListener('click', ()=>{
      if(!('geolocation' in navigator)){ alert('Geolocation not supported'); return; }
      gpsBtn.disabled=true; gpsBtn.textContent='Locating…';
      navigator.geolocation.getCurrentPosition((pos)=>{
        const lat=pos.coords.latitude,lng=pos.coords.longitude;
        if(geocoder){ geocoder.geocode({location:{lat,lng}}, (res)=>{ const r0=res?.[0]; updateLocation(lat,lng, r0?.formatted_address||'', r0?.place_id||''); gpsBtn.disabled=false; gpsBtn.textContent='Use my current location'; }); }
        else { updateLocation(lat,lng); gpsBtn.disabled=false; gpsBtn.textContent='Use my current location'; }
      }, (err)=>{ alert('Could not get location: '+(err.message||err)); gpsBtn.disabled=false; gpsBtn.textContent='Use my current location'; }, {enableHighAccuracy:true,timeout:10000,maximumAge:0});
    });
  };

  // wire any location blocks present
  wireMaps(wrap); // goods/rentals/ads (first block)
  // services has two blocks, wire the second too
  wrap.querySelectorAll('#postMap').forEach((_,i)=>{ if(i>0) wireMaps(wrap); });

  // services taxonomy, photos, availability
  if (category==='services'){
    const pSel=wrap.querySelector('#svcParent'), cSel=wrap.querySelector('#svcChild');
    pSel.innerHTML=`<option value="">— Select —</option>`+Object.keys(SERVICES_TAXONOMY).map(k=>`<option>${k}</option>`).join('');
    cSel.innerHTML=`<option value="">— Select —</option>`;
    pSel.addEventListener('change',()=>{ const kids=SERVICES_TAXONOMY[pSel.value]||[]; cSel.innerHTML=`<option value="">— Select —</option>`+kids.map(v=>`<option>${v}</option>`).join(''); });
    const daysBox=wrap.querySelector('#daysBox'); DAYS.forEach(d=>{ const lab=document.createElement('label'); lab.style.display='inline-flex'; lab.style.alignItems='center'; lab.style.gap='6px'; const cb=document.createElement('input'); cb.type='checkbox'; cb.name='availability_days'; cb.value=d; lab.appendChild(cb); lab.appendChild(document.createTextNode(d)); daysBox.appendChild(lab); });
    const profIn=wrap.querySelector('#profilePic'), profPrev=wrap.querySelector('#profilePrev'); const portIn=wrap.querySelector('#portfolio'), portStrip=wrap.querySelector('#portfolioStrip'); let profileFile=null; const portfolioFiles=[];
    function drawPrev(){ profPrev.innerHTML=''; if(profileFile){ const ph=document.createElement('div'); ph.className='ph'; const img=document.createElement('img'); img.src=URL.createObjectURL(profileFile); ph.appendChild(img); profPrev.appendChild(ph); }
      portStrip.innerHTML=''; portfolioFiles.slice(0,8).forEach((f,i)=>{ const ph=document.createElement('div'); ph.className='ph'; const img=document.createElement('img'); img.src=URL.createObjectURL(f); const x=document.createElement('button'); x.className='x'; x.type='button'; x.textContent='×'; x.onclick=()=>{ portfolioFiles.splice(i,1); drawPrev(); }; ph.appendChild(img); ph.appendChild(x); portStrip.appendChild(ph); }); }
    profIn?.addEventListener('change', e=>{ const f=e.target.files?.[0]; if(f&&f.type.startsWith('image/')) profileFile=f; drawPrev(); });
    portIn?.addEventListener('change', e=>{ for(const f of e.target.files||[]){ if(f.type.startsWith('image/')) portfolioFiles.push(f); } if(portfolioFiles.length>8) portfolioFiles.length=8; drawPrev(); });
    // augment submit with names
    form._collectServices = ()=>({ profile_photo_file:profileFile, portfolio_files:portfolioFiles.slice(0,8) });
  }

  // premium teaser react
  const bm = wrap.querySelector('#boostMonths'), teaser=wrap.querySelector('#premiumTeaser');
  if (bm && teaser){ const togg=()=>{ teaser.style.opacity = Number(bm.value||0)>0?'1':'0.55'; }; bm.addEventListener('input',togg); togg(); }

  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd=new FormData(form);
    fd.set('category', category);

    if (category==='services'){
      const svc=form._collectServices?form._collectServices():null;
      if (svc){ const pf=svc.profile_photo_file; if(pf) fd.set('profile_photo', pf); (svc.portfolio_files||[]).forEach(f=> fd.append('portfolio', f)); }
      ['intro','service_desc','service_parent','service_child','price_model','min_price_cents','service_radius_km'].forEach(k=>{ if(!fd.get(k)) fd.set(k,''); });
    }

    // capture file names (static mode)
    const prof = fd.get('profile_photo'); if (prof && prof.name) fd.set('profile_photo_name', prof.name);
    const portNames=[]; for (const [k,v] of fd.entries()){ if(k==='portfolio' && v instanceof File) portNames.push(v.name||'photo'); }
    if (portNames.length) fd.set('portfolio_names', JSON.stringify(portNames));

    const res = await API.postForm('/api/posts', fd);
    if(res.error){ alert(res.error); return; }
    alert('Post created!');
    location.hash = `#/${category}`;
  });

  app.innerHTML=''; app.appendChild(wrap);
}

/* ---------- Admin ---------- */
async function viewAdmin(){
  const me=API._requireUser(); if(!me||!isMainAdmin(me)){ app.innerHTML='<p>Admins only.</p>'; return; }
  app.innerHTML = `<section>
    <h2>${titled('admin','Admin · Limited Admin Requests')}</h2>
    <div class="card" id="laWrap"></div>
    <div class="card" style="margin-top:10px">
      <h3 style="margin:0 0 8px 0;">Settings</h3>
      <p class="muted">Allow-list emails are set in env.json (ADMIN_EMAILS). You can also approve Limited Admin requests here.</p>
    </div>
  </section>`;
  const d=DB.data; const list=d.users.filter(u=>u.limitedAdminStatus==='pending').map(u=>`<li>${u.email} <button data-id="${u.id}">Approve</button></li>`).join('');
  $('#laWrap').innerHTML = `<h3 style="margin:0 0 8px 0;">Pending Limited Admin</h3><ul>${list||'<li class="muted">None</li>'}</ul>`;
  $('#laWrap').querySelectorAll('button').forEach(b=>{
    b.onclick=()=>{ const u=d.users.find(x=>x.id===b.dataset.id); if(!u) return; u.limitedAdminStatus='approved'; DB.data=d; alert('Approved'); route(); };
  });
}

async function viewAdminQuotes(){ // staff console
  const me=API._requireUser(); if(!me || !isAdminOrLimited(me)){ app.innerHTML='<p>Staff only.</p>'; return; }
  app.innerHTML = `<section><h2>${titled('admin','Quotes (Service Requests)')}</h2><div id="quotesWrap"></div></section>`;
  const res=await API.post('/api/admin/quotes/list',{}); if(res.error){ $('#quotesWrap').innerHTML=`<p>${res.error}</p>`; return; }
  const rows=(res.quotes||[]).map(q=>`
    <tr data-id="${q.id}">
      <td>${q.postTitle||'(service)'}</td>
      <td>${q.requesterEmail||''} → <small class="muted">${q.providerEmail||''}</small></td>
      <td>${q.details||''}</td>
      <td><span class="badge">${q.status}</span></td>
      <td><button class="inprog">In Progress</button><button class="closed">Close</button><button class="rejected">Reject</button><button class="msg-buyer">Msg Buyer</button><button class="msg-provider">Msg Provider</button></td>
    </tr>`).join('');
  $('#quotesWrap').innerHTML = `<table class="table"><thead><tr><th>Service</th><th>Buyer → Provider</th><th>Details</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows||''}</tbody></table>${!rows?'<p class="muted">No quotes yet.</p>':''}`;
  $('#quotesWrap').querySelectorAll('tr').forEach(tr=>{
    const id=tr.dataset.id; const doUpd=async(act)=>{ const r=await API.post('/api/admin/quotes/update',{quoteId:id, action:act}); if(r.error){alert(r.error);} route('#/admin/quotes'); };
    tr.querySelector('.inprog').onclick =()=>doUpd('in_progress');
    tr.querySelector('.closed').onclick =()=>doUpd('closed');
    tr.querySelector('.rejected').onclick=()=>doUpd('rejected');
    tr.querySelector('.msg-buyer').onclick=async()=>{ const q=DB.data.quoteRequests.find(x=>x.id===id); if(!q){alert('Missing');return;} const r=await API.post('/api/messages/start-with-user',{userId:q.requesterId}); if(r.error){alert(r.error);return;} location.hash=`#/chat/${r.threadId}`; };
    tr.querySelector('.msg-provider').onclick=async()=>{ const q=DB.data.quoteRequests.find(x=>x.id===id); if(!q){alert('Missing');return;} const r=await API.post('/api/messages/start-with-user',{userId:q.providerId}); if(r.error){alert(r.error);return;} location.hash=`#/chat/${r.threadId}`; };
  });
}

/* ---------- Router ---------- */
window.addEventListener('hashchange', route);
async function route(){
  const hash = location.hash.slice(2); // remove "#/"
  const seg = hash.split('/').filter(Boolean);
  toggleAdminLink();

  if (!hash || seg[0]==='') return viewHome();

  if (seg[0]==='goods')      return viewCategory('goods');
  if (seg[0]==='services')   return viewCategory('services');
  if (seg[0]==='rentals')    return viewCategory('rentals');
  if (seg[0]==='jobs')       return viewCategory('jobs');
  if (seg[0]==='ads' && !seg[1]) return viewCategory('ads');

  if (seg[0]==='ads' && seg[1]==='become-blogger') return viewBecomeBlogger();
  if (seg[0]==='ads' && seg[1]==='create-campaign') return viewCreateCampaign();
  if (seg[0]==='ads' && seg[1]==='campaigns') return viewAdCampaigns();

  if (seg[0]==='post' && seg[1]){ 
    const allowBoost = ['goods','services','rentals','ads','jobs'].includes(seg[1]);
    return app.innerHTML='', app.appendChild(postForm({category:seg[1], allowBoost}));
  }

  if (seg[0]==='item' && seg[1]) return viewItem(seg[1]);

  if (seg[0]==='search')     return viewSearch();
  if (seg[0]==='inbox')      return viewInbox();
  if (seg[0]==='chat' && seg[1]) return viewChat(seg[1]);
  if (seg[0]==='listings')   return viewListings();
  if (seg[0]==='location')   return viewLocation();

  if (seg[0]==='admin' && !seg[1]) return viewAdmin();
  if (seg[0]==='admin' && seg[1]==='quotes') return viewAdminQuotes();

  // fallback
  return viewHome();
}

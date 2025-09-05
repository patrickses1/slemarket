/* ===========================
   Minimal SPA + Local DB API
   (compiled with ALL requested changes, including header hero rotator)
   =========================== */

// DOM helpers
const $ = (sel, node=document) => node.querySelector(sel);
const $$ = (sel, node=document) => Array.from(node.querySelectorAll(sel));
const cap = s => (s||'').charAt(0).toUpperCase() + (s||'').slice(1);
const cents = n => 'NLe ' + (Math.round(Number(n||0))/100).toLocaleString(); // display helper

// Global ENV
let AFRIMONEY_NUMBER='—', ORANGEMONEY_NUMBER='—', GOOGLE_MAPS_API_KEY='', ADMIN_EMAILS=[], COUNTRY_CODE_ALLOW='';

// Emojis for titles
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
    d.appAds ||= [];
    d.saved ||= [];
    return d;
  },
  set data(v){ localStorage.setItem('sl_data', JSON.stringify(v)); }
};
const uid = () => Math.random().toString(36).slice(2,9)+Date.now().toString(36);

// Geo helpers
function inSierraLeone(){ return COUNTRY_CODE_ALLOW === 'SL'; }

// Auth helpers
function isMainAdmin(user){ return !!user && ADMIN_EMAILS.includes(user.email); }
function isLimitedAdmin(user){ return !!user && user.limitedAdminStatus==='approved'; }
function isAdminOrLimited(user){ return isMainAdmin(user) || isLimitedAdmin(user); }
function isApprovedBlogger(user){ if(!user) return false; const d=DB.data; return (d.bloggers||[]).some(b=>b.userId===user.id && b.status==='approved'); }
function isAdminOrBlogger(u){ return isAdminOrLimited(u) || isApprovedBlogger(u); }

// Notifications / Mail (mock)
function notifyUser(userId,title,body,extra={}){
  const d=DB.data;
  d.notifications ||= [];
  d.notifications.push({
    id: uid(),
    userId,
    title,
    body,
    type: extra.type || 'info',
    cta_label: extra.cta_label || '',
    cta_url: extra.cta_url || '',
    image_name: extra.image_name || '',
    ts: Date.now(),
    read: false
  });
  DB.data = d;
}
function listMyNotifications(){ const me=API._requireUser(); if(!me) return []; const d=DB.data; return (d.notifications||[]).filter(n=>n.userId===me.id).sort((a,b)=>b.ts-a.ts); }
function markAllNotificationsRead(){ const me=API._requireUser(); if(!me) return; const d=DB.data; (d.notifications||[]).forEach(n=>{ if(n.userId===me.id) n.read=true; }); DB.data=d; }
function sendMailMock(to,subject,body){ if(!to) return; const d=DB.data; d.mails ||= []; d.mails.push({id:uid(),to,subject,body,ts:Date.now()}); DB.data=d; }
function getUserById(id){ const d=DB.data; return d.users.find(u=>u.id===id)||null; }

// Gentle notification sound
function boop(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type='sine'; o.frequency.value=880; g.gain.value=0.0001;
    o.connect(g); g.connect(ctx.destination); o.start();
    const now=ctx.currentTime;
    g.gain.exponentialRampToValueAtTime(0.08, now+0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now+0.20);
    o.stop(now+0.22);
  }catch{}
}
function playBoopOnNew(){
  const me = API._requireUser?.(); if(!me) return;
  const d=DB.data; const lastKey=`sl_last_booped_ts_${me.id}`; const last=Number(localStorage.getItem(lastKey)||0);
  const mine=(d.notifications||[]).filter(n=>n.userId===me.id && !n.read);
  if(!mine.length) return;
  const maxTs=Math.max(...mine.map(n=>n.ts||0));
  if (maxTs>last){
    const hasBroadcast = mine.some(n=>n.type==='broadcast' && (n.ts||0)>last);
    if (hasBroadcast || mine.some(n=>(n.ts||0)>last)){
      boop(); localStorage.setItem(lastKey,String(maxTs));
    }
  }
}

// Saved state
function isSaved(postId){ const me=API._requireUser?.(); if(!me) return false; const d=DB.data; return (d.saved||[]).some(s=>s.userId===me.id && s.postId===postId); }
function saveCount(postId){ const d=DB.data; return (d.saved||[]).filter(s=>s.postId===postId).length; }

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

// Boost trial helpers
function trialActive(p){
  if (!p || !p.boost_trial_started_at || !p.boost_trial_days) return false;
  const ms = p.boost_trial_days * 24 * 60 * 60 * 1000;
  return (Date.now() - new Date(p.boost_trial_started_at).getTime()) < ms;
}
function getAllStaffUserIds(){
  const d=DB.data; const ids=new Set();
  d.users.forEach(u=>{ if (ADMIN_EMAILS.includes(u.email) || u.limitedAdminStatus==='approved') ids.add(u.id); });
  return Array.from(ids);
}
function sweepTrials(){
  const d=DB.data; let changed=false;
  (d.posts||[]).forEach(p=>{
    if (p.boost_trial_days>0 && p.boost_trial_started_at && !p.boost_trial_ended_notified){
      if (!trialActive(p)){
        getAllStaffUserIds().forEach(uid=>{
          notifyUser(uid,'Trial Ended',`Trial ended for "${p.title}" (${p.category}).`,{type:'info'});
          const to=getUserById(uid)?.email||''; if(to) sendMailMock(to,'Trial Ended',`Listing "${p.title}" (category: ${p.category}) trial has ended.`);
        });
        p.boost_trial_ended_notified=true; changed=true;
      }
    }
  });
  if (changed) DB.data=d;
}

// API shim (local)
const API = {
  token: localStorage.getItem('token') || null,
  setToken(t){ this.token=t; localStorage.setItem('token', t||''); renderAuth(); route(); },
  _requireUser(){ const d=DB.data, s=this.token && d.sessions[this.token]; return s ? d.users.find(u=>u.id===s.userId) : null; },
  async get(path){
    const d=DB.data; const me=this._requireUser();
    if (path.startsWith('/api/messages/thread')){
      const tid = new URLSearchParams(path.split('?')[1]).get('tid');
      return d.messages.filter(m=>m.threadId===tid).sort((a,b)=>a.ts-b.ts);
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
    if (path==='/api/ads/blogger/list'){ return {bloggers:(d.bloggers||[]).filter(b=>b.status==='approved')}; }
    if (path==='/api/ads/campaigns/list'){
      const me=this._requireUser(); if (!isAdminOrBlogger(me)) return {error:'Restricted'};
      const items = (d.adCampaigns||[]).slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(c=>{
        const owner=d.users.find(u=>u.id===c.ownerId)||{};
        return {...c, ownerEmail: isAdminOrLimited(me) ? (owner.email||'') : '' };
      });
      return {campaigns:items};
    }
    return {};
  },
  async post(path, body){
    const d=DB.data;

    // Auth
    if (path==='/api/auth/signup'){
      const {email,password}=body||{}; if(!email||!password) return {error:'Email & password required'};
      if (d.users.some(u=>u.email===email)) return {error:'User exists'};
      const u={id:uid(),email,password,limitedAdminStatus:'none'}; d.users.push(u);
      const tok=uid(); d.sessions[tok]={userId:u.id}; DB.data=d; return {token:tok};
    }
    if (path==='/api/auth/login'){
      const {email,password}=body||{}; const u=d.users.find(x=>x.email===email && x.password===password);
      if(!u) return {error:'Invalid credentials'}; const tok=uid(); d.sessions[tok]={userId:u.id}; DB.data=d; return {token:tok};
    }
    if (path==='/api/auth/google/mock'){
      const {email}=body||{}; let u=d.users.find(x=>x.email===email);
      if(!u){ u={id:uid(),email,password:'',limitedAdminStatus:'none'}; d.users.push(u); }
      const tok=uid(); d.sessions[tok]={userId:u.id}; DB.data=d; return {token:tok};
    }

    // Admin helpers
    if (path==='/api/users/request-limited-admin'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      me.limitedAdminStatus = me.limitedAdminStatus==='approved' ? 'approved' : 'pending';
      DB.data=d; return {status:me.limitedAdminStatus};
    }

    // Messaging
    if (path==='/api/messages/start-with-user'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      const {userId}=body||{}; const other=d.users.find(u=>u.id===userId); if(!other) return {error:'User not found'};
      let th=d.threads.find(t=>t.participants?.length===2 && t.participants.includes(me.id) && t.participants.includes(other.id));
      if(!th){ th={id:uid(),participants:[me.id,other.id],updatedAt:new Date().toISOString()}; d.threads.push(th); DB.data=d; }
      return {threadId:th.id};
    }
    if (path==='/api/messages/send'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      const {threadId,text}=body||{}; const th=d.threads.find(t=>t.id===threadId); if(!th) return {error:'No thread'};
      th.updatedAt=new Date().toISOString();
      const msg={id:uid(),threadId,from:me.id,text:(text||'').trim(),ts:Date.now(),readBy:[me.id]};
      d.messages.push(msg); DB.data=d; return {ok:true};
    }
    if (path==='/api/messages/seen'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      if (isAdminOrLimited(me)) return {ok:true, skipped:'admin'};
      const {threadId}=body||{}; const th=d.threads.find(t=>t.id===threadId);
      if (!th || !th.participants.includes(me.id)) return {error:'Not in thread'};
      let changed=0;
      d.messages.forEach(m=>{ if(m.threadId!==threadId) return; m.readBy ||= []; if(!m.readBy.includes(me.id) && m.from!==me.id){ m.readBy.push(me.id); changed++; } });
      if (changed) DB.data=d; return {ok:true,changed};
    }

    // Saved toggle
    if (path==='/api/saved/toggle'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      const {postId}=body||{}; const idx=(d.saved||[]).findIndex(s=>s.userId===me.id && s.postId===postId);
      let saved; if(idx>=0){ d.saved.splice(idx,1); saved=false; } else { d.saved.push({id:uid(),userId:me.id,postId,ts:Date.now()}); saved=true; }
      DB.data=d; return {ok:true, saved, count: saveCount(postId)};
    }

    // Posts
    if (path==='/api/posts'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      if (!isAdminOrLimited(me) && !inSierraLeone()) return {error:'Service available in Sierra Leone only'};

      // Ads must be boosted (min 1 month)
      if (body.category === 'ads' && Number(body.boosted_months || 0) <= 0){
        return { error: 'Advertising posts require Boost (minimum 1 month).' };
      }

      // Require mobile money screenshot when months>0 (trial-only allowed), Ads always require
      const months = Number(body.boosted_months || 0);
      const trialOnly = !!body.boost_trial && months === 0;
      if (body.category === 'ads'){
        if (!(body.payment_screenshot_name && String(body.payment_screenshot_name).trim().length)){
          return { error:'Advertising requires a mobile money payment screenshot.' };
        }
      } else {
        if (!trialOnly && months > 0){
          if (!(body.payment_screenshot_name && String(body.payment_screenshot_name).trim().length)){
            return { error:'Mobile money payment screenshot is required for Boost.' };
          }
        }
      }

      const p = {
        id:uid(), userId:me.id,
        category:body.category,
        title:(body.title||'').trim(),
        price_cents:Number(body.price_cents||0),
        description:(body.description||'').trim(),

        boosted_months:Number(body.boosted_months||0),
        boost_contact_phone:(body.boost_contact_phone||'').trim(),
        boost_trial_days: (body.boost_trial ? 14 : 0),
        boost_trial_started_at: (body.boost_trial ? new Date().toISOString() : null),
        payment_screenshot_name: (body.payment_screenshot_name || '').trim(),

        is_pinned:false, pinned_at:null, pinned_by:null,

        // Common item facets
        parent_cat: body.parent_cat||'',
        child_cat: body.child_cat||'',
        condition: body.condition||'',
        item_type: (body.item_type||'').trim(),
        brand: (body.brand||'').trim(),
        color: (body.color||'').trim(),
        price_firm: !!(body.price_firm==='1' || body.price_firm===true),
        photos: Array.isArray(body.photos)? body.photos.slice(0,8) : [],

        // Google location
        location_address: (body.location_address||'').trim(),
        location_lat: body.location_lat!=null ? Number(body.location_lat) : null,
        location_lng: body.location_lng!=null ? Number(body.location_lng) : null,
        location_place_id: (body.location_place_id||'').trim(),

        // Services fields
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

        // Rentals fields
        listing_type: (body.listing_type || 'rent'),
        property_parent: (body.property_parent || '').trim(),
        property_child: (body.property_child || '').trim(),
        bedrooms: (body.bedrooms || '').trim(),
        bathrooms: (body.bathrooms || '').trim(),
        furnished: (body.furnished || '').trim(),
        size_sqm: body.size_sqm!=null ? Number(body.size_sqm) : null,
        lease_term: (body.lease_term || '').trim(),
        available_from: (body.available_from || '').trim(),
        deposit_cents: body.deposit_cents!=null ? Number(body.deposit_cents) : null,
        pets_allowed: (body.pets_allowed || '').trim(),
        parking_spots: body.parking_spots!=null ? Number(body.parking_spots) : null,
        amenities: Array.isArray(body.amenities) ? body.amenities : (body.amenities? [body.amenities] : []),
        utilities: Array.isArray(body.utilities) ? body.utilities : (body.utilities? [body.utilities] : []),

        createdAt:new Date().toISOString()
      };
      d.posts.push(p); DB.data=d; return p;
    }

    // Pin/Unpin
    if (path==='/api/admin/posts/pin'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      if(!isAdminOrLimited(me)) return {error:'Staff only'};
      const {postId,pin}=body||{}; const p=d.posts.find(x=>x.id===postId); if(!p) return {error:'Post not found'};
      p.is_pinned=!!pin; p.pinned_at=pin?new Date().toISOString():null; p.pinned_by=pin?me.id:null;
      DB.data=d; return {ok:true,post:p};
    }

    // Quotes (Services)
    if (path==='/api/quotes/create'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      const {postId,details}=body||{}; const post=d.posts.find(p=>p.id===postId); if(!post) return {error:'Post not found'};
      if (post.category!=='services') return {error:'Quotes only for services'};
      const q={id:uid(),postId,requesterId:me.id,providerId:post.userId,details:(details||'').trim(),status:'open',createdAt:new Date().toISOString()};
      d.quoteRequests.push(q); DB.data=d;
      const th=await API.post('/api/messages/start-with-user',{userId:q.providerId});
      if(!th.error){ await API.post('/api/messages/send',{threadId:th.threadId,text:`New quote request for "${post.title}": ${q.details}`}); }
      notifyUser(post.userId,'New Quote Request', `For "${post.title}"`,{type:'info'});
      sendMailMock(getUserById(post.userId)?.email||'','New Quote Request', q.details);
      return {ok:true,quote:q};
    }
    if (path==='/api/admin/quotes/list'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      if(!isAdminOrLimited(me)) return {error:'Staff only'};
      const list=d.quoteRequests.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(q=>{
        const buyer=d.users.find(u=>u.id===q.requesterId)||{}, prov=d.users.find(u=>u.id===q.providerId)||{}, post=d.posts.find(p=>p.id===q.postId)||{};
        return {...q, requesterEmail:buyer.email||'', providerEmail:prov.email||'', postTitle:post.title||''};
      }); return {quotes:list};
    }
    if (path==='/api/admin/quotes/update'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      if(!isAdminOrLimited(me)) return {error:'Staff only'};
      const {quoteId,action}=body||{}; const q=d.quoteRequests.find(x=>x.id===quoteId); if(!q) return {error:'Quote not found'};
      if (!['in_progress','closed','rejected'].includes(action)) return {error:'Unknown action'};
      q.status=action; DB.data=d; return {ok:true,quote:q};
    }

    // Advertising bloggers/campaigns (minimal to keep routes working)
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
    if (path==='/api/admin/bloggers/update'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      if(!isAdminOrLimited(me)) return {error:'Staff only'};
      const {bloggerId,action}=body||{}; const b=d.bloggers.find(x=>x.id===bloggerId); if(!b) return {error:'Blogger not found'};
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

    // Admin App Broadcast
    if (path==='/api/admin/broadcast/create'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      if (!isMainAdmin(me)) return {error:'Admins only'};
      const { title, message, cta_label, cta_url, audience } = body || {};
      if (!title || !message) return {error:'Title and message are required'};
      d.appAds ||= [];
      const ad = {
        id: uid(),
        title: String(title).trim(),
        message: String(message).trim(),
        cta_label: (cta_label||'').trim(),
        cta_url: (cta_url||'').trim(),
        image_name: (body.image_name || body.adImg_name || '').trim(),
        audience: (audience || 'all'),
        createdAt: new Date().toISOString(),
        senderId: me.id
      };
      d.appAds.push(ad);

      const users = d.users.slice(); const posts=d.posts||[];
      const userHasPostedCat=(uid,cat)=> posts.some(p=>p.userId===uid && p.category===cat);
      const isBoosted=(uid)=> posts.some(p=>p.userId===uid && (Number(p.boosted_months||0)>0));
      const isTrial=(uid)=> posts.some(p=>p.userId===uid && trialActive(p));
      let recipients = users.filter(u=>u.id!==me.id);
      if (ad.audience==='boosted') recipients = recipients.filter(u=>isBoosted(u.id));
      else if (ad.audience==='trial') recipients = recipients.filter(u=>isTrial(u.id));
      else if (ad.audience?.startsWith('cat:')){
        const cat=ad.audience.split(':')[1]; recipients = recipients.filter(u=>userHasPostedCat(u.id,cat));
      }
      recipients.forEach(u=>{
        notifyUser(u.id, ad.title, ad.message, {type:'broadcast', cta_label:ad.cta_label, cta_url:ad.cta_url, image_name:ad.image_name});
      });
      DB.data=d; return {ok:true, broadcast:ad, sent:recipients.length};
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
        else if (k==='amenities' || k==='utilities'){ (obj[k] ||= []).push(v); }
        else obj[k]=v;
      }
    }
    if (photos.length) obj.photos=photos;
    return this.post(path,obj);
  }
};

// ENV load + footer Quick Post wiring + hero render
window.addEventListener('DOMContentLoaded', async () => {
  const env = await fetch('./env.json').then(r=>r.json()).catch(()=>({}));
  AFRIMONEY_NUMBER = env.AFRIMONEY_NUMBER||'—';
  ORANGEMONEY_NUMBER = env.ORANGEMONEY_NUMBER||'—';
  GOOGLE_MAPS_API_KEY = env.GOOGLE_MAPS_API_KEY||'';
  ADMIN_EMAILS = Array.isArray(env.ADMIN_EMAILS)?env.ADMIN_EMAILS:[];
  COUNTRY_CODE_ALLOW = env.COUNTRY_CODE_ALLOW||'';
  $('#afr').textContent = AFRIMONEY_NUMBER; $('#orm').textContent = ORANGEMONEY_NUMBER;

  sweepTrials();
  setInterval(sweepTrials, 60*60*1000);
  playBoopOnNew();
  setInterval(playBoopOnNew, 20000);

  // Footer Post quick chooser
  const fp=$('#footPost');
  if (fp){ fp.addEventListener('click', (e)=>{ e.preventDefault(); openQuickPostChooser(); }); }

  renderHero();          // NEW: header hero rotator
  renderAuth(); route();
});

// Auth UI
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
  const adminAppAdsLink = $('#adminAppAdsLink');
  if (adminLink)  adminLink.style.display  = isMainAdmin(me) ? '' : 'none';
  if (quotesLink) quotesLink.style.display = isAdminOrLimited(me) ? '' : 'none';
  if (adCampLink) adCampLink.style.display = (isAdminOrLimited(me) || isApprovedBlogger(me)) ? '' : 'none';
  if (adminAppAdsLink) adminAppAdsLink.style.display = isMainAdmin(me) ? '' : 'none';
}

// UI primitives
const app = $('#app');
const card = (t,d,b) => { const div=document.createElement('div'); div.className='card'; if(b){ const s=document.createElement('span'); s.className='badge'; s.textContent=b; div.appendChild(s); } div.innerHTML += `<h3>${t}</h3><p class="muted">${d||''}</p>`; return div; };

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

// Start a chat with owner with prefilled message
async function messageOwner(post, text){
  const me = API._requireUser();
  if (!me){ alert('Please log in first.'); return; }
  if (me.id === post.userId){ alert('This is your own listing.'); return; }
  const r = await API.post('/api/messages/start-with-user', { userId: post.userId });
  if (r.error){ alert(r.error); return; }
  await API.post('/api/messages/send', { threadId: r.threadId, text });
  location.hash = `#/chat/${r.threadId}`;
}

// Photos chooser block + footer quick chooser
function photosBlock(idPrefix, title='Photos'){
  return `
  <div class="card" style="margin-top:10px;">
    <h3 style="margin:4px 0 8px 0;">${title}</h3>
    <div class="row">
      <div><label>Take Photo <input type="file" id="${idPrefix}Cam" accept="image/*" capture="environment" /></label></div>
      <div><label>Select Photos (up to 8) <input type="file" id="${idPrefix}Gal" accept="image/*" multiple /></label></div>
    </div>
    <div id="${idPrefix}Strip" class="photos" style="margin-top:6px"></div>
  </div>`;
}
window._preUploadPhotos = [];
function openQuickPostChooser(){
  const ov=document.createElement('div');
  ov.style='position:fixed;inset:0;background:#0007;display:flex;align-items:flex-end;z-index:9999';
  const sheet=document.createElement('div');
  sheet.style='background:#fff;border-radius:16px 16px 0 0;padding:12px;box-shadow:0 -8px 24px rgba(0,0,0,.18);width:100%;max-width:520px;margin:0 auto';
  sheet.innerHTML=`
    <h3 style="margin:0 0 8px 0">Create post</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button id="qpTake" class="btn">📷 Take photo</button>
      <button id="qpSelect" class="btn">🖼️ Select photos</button>
      <button id="qpCancel" class="btn" style="background:#f3f4f6;border-color:#e5e7eb">Cancel</button>
    </div>
    <p class="muted" style="margin-top:8px">We’ll open the Goods form next.</p>`;
  ov.appendChild(sheet); document.body.appendChild(ov);
  const close=()=>ov.remove();
  const cam=document.createElement('input'); cam.type='file'; cam.accept='image/*'; cam.capture='environment';
  const gal=document.createElement('input'); gal.type='file'; gal.accept='image/*'; gal.multiple=true;
  cam.addEventListener('change', ()=>{ window._preUploadPhotos=[]; if (cam.files?.[0]) window._preUploadPhotos.push(cam.files[0]); close(); location.hash='#/post/goods'; });
  gal.addEventListener('change', ()=>{ window._preUploadPhotos=[]; for(const f of gal.files||[]){ if(f.type.startsWith('image/')) window._preUploadPhotos.push(f); } if(_preUploadPhotos.length>8) _preUploadPhotos.length=8; close(); location.hash='#/post/goods'; });
  $('#qpTake',sheet).onclick = ()=> cam.click();
  $('#qpSelect',sheet).onclick = ()=> gal.click();
  $('#qpCancel',sheet).onclick = close;
  ov.addEventListener('click', (e)=>{ if(e.target===ov) close(); });
}

/* ========== HEADER HERO ROTATOR ========== */
function renderHero(){
  const host = document.getElementById('heroRotator');
  if (!host || host.dataset.wired) return;
  host.dataset.wired = '1';

  host.innerHTML = `
    <!-- Slide 1: Services -->
    <div class="hero-slide active" data-kind="services" style="
      background: radial-gradient(120% 120% at 0% 0%, #fff7e6 0%, #fdebc8 45%, #f4dfa9 100%);
    ">
      <div class="hero-art">
        <svg viewBox="0 0 240 180" width="100%" height="100%" class="floaty" aria-hidden="true">
          <defs>
            <linearGradient id="gHat" x1="0" x2="1">
              <stop offset="0" stop-color="#f3d48a"/><stop offset="1" stop-color="#d4a017"/>
            </linearGradient>
            <linearGradient id="gShirt" x1="0" x2="1">
              <stop offset="0" stop-color="#ffe6b3"/><stop offset="1" stop-color="#ffcf6f"/>
            </linearGradient>
          </defs>
          <circle cx="40" cy="40" r="30" fill="#ffe9c4" opacity=".6"/>
          <circle cx="210" cy="130" r="26" fill="#ffe1a6" opacity=".6"/>
          <path d="M80 78c0-22 18-40 40-40s40 18 40 40" fill="url(#gHat)" stroke="#b1840f" stroke-width="2" />
          <circle cx="120" cy="96" r="22" fill="#ffddb2" stroke="#e7c08c" stroke-width="2"/>
          <circle cx="112" cy="96" r="3" fill="#2d1f12"/>
          <circle cx="128" cy="96" r="3" fill="#2d1f12"/>
          <path d="M112 106c4 6 12 6 16 0" stroke="#2d1f12" stroke-width="2" fill="none" stroke-linecap="round"/>
          <rect x="92" y="120" width="56" height="34" rx="8" fill="url(#gShirt)" stroke="#e6c384" stroke-width="2"/>
          <path d="M102 140 h16" stroke="#b1840f" stroke-width="4" stroke-linecap="round"/>
          <path d="M140 126 l8 8 -8 8" stroke="#b1840f" stroke-width="4" stroke-linecap="round" fill="none"/>
        </svg>
      </div>
      <div class="hero-copy">
        <h3>Let us handle your service needs</h3>
        <p>Find trusted plumbers, electricians, cleaners, and more.</p>
        <a class="hero-cta btn" href="#/services">Browse Services</a>
      </div>
    </div>

    <!-- Slide 2: Boost -->
    <div class="hero-slide" data-kind="boost" style="
      background: radial-gradient(120% 120% at 100% 0%, #fff7e6 0%, #ffe6b8 45%, #f0d089 100%);
    ">
      <div class="hero-art">
        <svg viewBox="0 0 240 180" width="100%" height="100%" class="floaty" aria-hidden="true">
          <defs>
            <linearGradient id="gBolt" x1="0" x2="1">
              <stop offset="0" stop-color="#ffd766"/><stop offset="1" stop-color="#d4a017"/>
            </linearGradient>
          </defs>
          <circle cx="50" cy="30" r="6" fill="#ffe9b0"/><circle cx="190" cy="60" r="5" fill="#ffe2a0"/>
          <circle cx="170" cy="130" r="4" fill="#ffecbf"/><circle cx="70" cy="120" r="5" fill="#ffefcf"/>
          <path d="M120 20 L90 100 L130 100 L110 160 L160 80 L120 80 Z" fill="url(#gBolt)" stroke="#b1840f" stroke-width="2" />
          <path d="M60 80 h30" stroke="#e3c06a" stroke-width="4" stroke-linecap="round"/>
          <path d="M50 95 h40" stroke="#e3c06a" stroke-width="4" stroke-linecap="round"/>
          <path d="M65 110 h25" stroke="#e3c06a" stroke-width="4" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="hero-copy">
        <h3>Be the first to see new items — try for free</h3>
        <p>Boost your listings for faster responses with a 14-day trial.</p>
        <a class="hero-cta btn" href="#/post/goods">Try Boost</a>
      </div>
    </div>
  `;

  let idx = 0;
  const slides = host.querySelectorAll('.hero-slide');
  setInterval(()=>{
    slides[idx].classList.remove('active');
    idx = (idx + 1) % slides.length;
    slides[idx].classList.add('active');
  }, 60 * 1000);
}

/* ===========================
   Views
   =========================== */

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

// Boost UI
function boostBlock({ category, mandatory=false }){
  const trialPart = !mandatory ? `
    <label style="display:flex;gap:8px;align-items:center;margin-top:6px;">
      <input type="checkbox" name="boost_trial" id="boostTrial"/>
      <span>Start <strong>14-day free trial</strong> (no charge)</span>
    </label>
  ` : `
    <div class="muted" style="margin-top:6px">
      Boost is <strong>required</strong> for Advertising. No free trial.
    </div>
  `;
  return `
<div class="card" id="boostCard" style="margin-top:10px;">
  <h3 style="margin:4px 0 8px 0;">Boost & Premium</h3>

  <label>Boost Months (0–12)
    <input name="boosted_months" id="boostMonths" type="number" min="${mandatory?1:0}" max="12" value="${mandatory?1:0}"/>
    <small class="muted">${mandatory?'Minimum 1 month for Ads.':'0 means no boost.'}</small>
  </label>

  <div id="boostPriceLine" class="muted" style="margin:4px 0 0 0">
    NLe 100 per month · Est. total: <strong>NLe ${mandatory?100:0}</strong>
  </div>

  <div id="mmPayBlock" style="margin-top:8px; display:${mandatory?'block':'none'}">
    <label>Mobile money payment screenshot (PNG/JPG)
      <input type="file" id="paymentScreenshot" name="payment_screenshot" accept="image/*" />
      <small class="muted">Required when Boost months &gt; 0${mandatory?' (Ads require Boost).':''}</small>
    </label>
  </div>

  <label>Seller Contact Phone (Admin only; for boosted posts)
    <input name="boost_contact_phone" placeholder="+232…"/>
    <small class="muted">Only visible to Admin/Limited Admin to verify boosted listings.</small>
  </label>

  <div id="premiumTeaser" class="muted" style="margin-top:6px; display:flex; align-items:center; gap:8px;">
    <span class="badge">Premium</span>
    <span>Get quick responses when you upgrade to <strong>Premium</strong>.</span>
  </div>

  <div class="muted" style="margin-top:6px">Let your item be <strong>priority at the top</strong>.</div>
  ${trialPart}
</div>`;
}

// Sorting: pinned → (boost or trial) → boosted months desc → newest
function sortPostsForFeed(items){
  return items.slice().sort((a,b)=>{
    const ap=a.is_pinned?1:0, bp=b.is_pinned?1:0;
    if (bp !== ap) return bp - ap;
    const abBoost = ((b.boosted_months||0)>0 || trialActive(b)) - ((a.boosted_months||0)>0 || trialActive(a));
    if (abBoost !== 0) return abBoost;
    const abMonths = (Number(b.boosted_months||0) - Number(a.boosted_months||0));
    if (abMonths !== 0) return abMonths;
    return (b.createdAt||'').localeCompare(a.createdAt||'');
  });
}

async function viewHome(){
  app.innerHTML = `
    <h2>${titled('goods','Home · Goods Feed')}</h2>
    <p class="muted" style="margin:4px 0 10px 0; font-size:13px;">
      <a href="#/post/goods" style="text-decoration:underline">
        ⚡ Boost your listing — get faster responses. Try for free
      </a>
    </p>
    <div class="grid" id="grid"></div>
  `;
  const posts = await API.get('/api/posts?category=goods');
  const grid=$('#grid');
  sortPostsForFeed(posts).forEach(p=> renderCard(p, grid));
  playBoopOnNew();
}

function renderCard(p, grid){
  const bits=[];
  if (p.is_pinned) bits.push('Top');
  if (p.boosted_months>0 || trialActive(p)) bits.push('Premium');
  if (p.price_firm) bits.push('Firm');
  if (p.condition) bits.push(p.condition);

  const c = card(p.title, p.description, bits.join(' • '));

  if (p.location_address){
    const loc=document.createElement('p'); loc.className='muted'; loc.style.marginTop='6px';
    loc.textContent=`📍 ${p.location_address}`; c.appendChild(loc);
  }

  // Rentals highlights
  if (p.category === 'rentals'){
    const meta=document.createElement('p'); meta.className='muted'; meta.style.marginTop='6px';
    const parts=[];
    if (p.property_child) parts.push(p.property_child);
    if (p.bedrooms) parts.push((p.bedrooms==='0'?'Studio':`${p.bedrooms} BR`));
    if (p.bathrooms) parts.push(`${p.bathrooms} BA`);
    if (p.furnished) parts.push(p.furnished==='yes'?'Furnished':(p.furnished==='partly'?'Partly furnished':'Unfurnished'));
    if (p.size_sqm) parts.push(`${p.size_sqm} m²`);
    if (p.listing_type) parts.push(p.listing_type==='sell'?'For Sale':'For Rent');
    meta.textContent = parts.join(' • ');
    c.appendChild(meta);
  }

  // Per-card actions (Ask / Make offer everywhere; plus Quote for Services)
  {
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.style.marginTop = '8px';

    const me=API._requireUser?.();
    if (!me || me.id !== p.userId){
      const askBtn = document.createElement('button');
      askBtn.textContent = 'Ask';
      askBtn.title = 'Is this still available?';
      askBtn.onclick = ()=> messageOwner(p, `Hi! Is "${p.title}" still available?`);

      const offerBtn = document.createElement('button');
      offerBtn.textContent = 'Make an offer';
      offerBtn.onclick = ()=>{
        const amount = prompt('Your offer (NLe):');
        if (amount == null || !String(amount).trim()) return;
        const note = prompt('Add a note (optional):') || '';
        messageOwner(p, `Offer for "${p.title}": NLe ${String(amount).trim()}${note ? ` — ${note}` : ''}`);
      };

      actions.appendChild(askBtn);
      actions.appendChild(offerBtn);

      if (p.category === 'services'){
        const quoteBtn = document.createElement('button');
        quoteBtn.textContent = 'Request Quote';
        quoteBtn.onclick = async()=>{
          const me = API._requireUser(); if(!me){ alert('Please log in first.'); return; }
          const details = prompt('Describe the work and timeline for your quote:');
          if (details == null || !details.trim()) return;
          const r = await API.post('/api/quotes/create', { postId: p.id, details });
          if (r.error){ alert(r.error); return; }
          alert('Quote request sent! We also messaged the provider.');
          location.hash = '#/inbox';
        };
        actions.appendChild(quoteBtn);
      }

      c.appendChild(actions);
    }
  }

  // Staff pin + boosted phone
  const me=API._requireUser?.();
  if (isAdminOrLimited(me)){
    const staff=document.createElement('div'); staff.className='actions'; staff.style.marginTop='6px';
    staff.innerHTML = `<button class="pinBtn">${p.is_pinned?'Unpin from Top':'Pin to Top'}</button>`;
    staff.querySelector('.pinBtn').onclick = async()=>{
      const r=await API.post('/api/admin/posts/pin',{postId:p.id, pin:!p.is_pinned});
      if(r.error){ alert(r.error); return; } route();
    };
    if ((p.boosted_months||0)>0 && (p.boost_contact_phone||'').trim()){
      const phone=document.createElement('p'); phone.className='muted'; phone.style.margin='4px 0 0';
      const tel=String(p.boost_contact_phone).trim();
      phone.innerHTML = `☎️ <strong>Seller phone:</strong> <a href="tel:${tel}">${tel}</a>`;
      staff.appendChild(phone);
    }
    c.appendChild(staff);
  }

  // Owner-only upsell for goods
  const meOwner = API._requireUser?.();
  if (p.category==='goods' && meOwner && p.userId===meOwner.id && !(p.boosted_months>0 || trialActive(p))){
    const upsell = document.createElement('small');
    upsell.className = 'muted'; upsell.style.display='block'; upsell.style.marginTop='6px';
    upsell.innerHTML = `<a href="#/post/goods" style="text-decoration:underline">⚡ Boost this — 14-day trial</a>`;
    c.appendChild(upsell);
  }

  attachShareSave(c,p);
  grid.appendChild(c);
}

async function viewCategory(category){
  const label=cap(category);
  app.innerHTML = `<h2>${titled(category, `${label} Feed`)}</h2><div class="grid" id="grid"></div>`;
  const grid=$('#grid');

  // In-page Post CTAs (moved to page)
  const ctaNeeded = ['services','rentals','jobs'].includes(category);
  if (ctaNeeded){
    const cta = document.createElement('div');
    cta.style = 'margin:8px 0 14px 0; display:flex; justify-content:flex-start;';
    const btnLabel = category==='services' ? 'Post a Service' : category==='rentals' ? 'Post a Rental' : 'Post a Job';
    cta.innerHTML = `<a href="#/post/${category}" class="btn">${btnLabel}</a>`;
    grid.parentNode.insertBefore(cta, grid);
  }

  if (category==='ads'){ return viewAds(); }

  const posts = await API.get(`/api/posts?category=${category}`);
  sortPostsForFeed(posts).forEach(p=> renderCard(p, grid));
  playBoopOnNew();
}

async function viewItem(itemId){
  const d=DB.data; const p=(d.posts||[]).find(x=>x.id===itemId);
  if(!p){ app.innerHTML='<p>Item not found.</p>'; return; }
  app.innerHTML = `<section><h2>${(p.category||'').toUpperCase()} · ${p.title||''}</h2><div class="card" id="itemCard"></div><p style="margin-top:10px"><a href="#/${p.category||''}">← Back to ${p.category||'feed'}</a></p></section>`;
  const c = card(p.title, p.description, [p.is_pinned?'Top':'',(p.boosted_months>0||trialActive(p))?'Premium':'',p.condition||''].filter(Boolean).join(' • '));
  if (p.location_address){ const loc=document.createElement('p'); loc.className='muted'; loc.style.marginTop='6px'; loc.textContent=`📍 ${p.location_address}`; c.appendChild(loc); }
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
    const c=card(p.title, p.description, [(p.is_pinned?'Top':''),(p.boosted_months>0||trialActive(p)?'Premium':'')].filter(Boolean).join(' • '));
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

  const notes=listMyNotifications();
  if (notes.length){
    const n=document.createElement('div'); n.className='card';
    n.innerHTML = `<h3 style="margin:0 0 8px 0;">Notifications</h3>
      <ul id="noteList" style="margin:0;padding-left:18px"></ul>
      <div class="actions" style="margin-top:8px"><button id="markNotes">Mark all read</button></div>`;
    $('#threads').appendChild(n);

    const ul = $('#noteList', n);
    notes.forEach(nt=>{
      const li = document.createElement('li');
      const when = new Date(nt.ts).toLocaleString();
      const img = nt.image_name ? `<div style="margin:6px 0"><span class="muted">Image: ${nt.image_name}</span></div>` : '';
      const cta = nt.cta_url && nt.cta_label ? `<div style="margin-top:6px"><a class="btn" href="${nt.cta_url}" target="_blank" rel="noopener">${nt.cta_label}</a></div>` : '';
      const badge = nt.type==='broadcast' ? `<span class="badge" style="position:static;margin-left:6px">App Ad</span>` : '';
      li.innerHTML = `<strong>${nt.title}</strong> ${badge}<br/>${nt.body}<br/><small class="muted">${when}</small>${img}${cta}`;
      ul.appendChild(li);
    });

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

/* ---------- Ads (browse) minimal ---------- */
async function viewAds(){
  app.innerHTML = `<section>
    <h2>${titled('ads','Advertising Hub')}</h2>
    <div class="card"><h3>Approved Bloggers</h3><div id="blogList" class="muted">Loading…</div></div>
    <div class="card" style="margin-top:10px"><h3>Actions</h3>
      <div class="actions">
        <a class="btn" href="#/ads/become-blogger">Become a Blogger</a>
        <a class="btn" href="#/ads/create-campaign">Create Ad Campaign</a>
        <a class="btn" id="seeCamps" href="#/ads/campaigns" style="display:none">View Campaigns</a>
      </div>
    </div>
  </section>`;
  const me=API._requireUser(); if (isAdminOrBlogger(me)) $('#seeCamps').style.display='';
  const res=await API.get('/api/ads/blogger/list'); if(res.error){ $('#blogList').textContent=res.error; return; }
  $('#blogList').innerHTML = (res.bloggers||[]).map(b=>`<div style="margin:6px 0"><strong>${b.platform||'—'}</strong> — ${b.handle||''} · ${b.followers||0} followers · ${cents(b.price_cents||0)} per promo</div>`).join('') || '<p class="muted">No approved bloggers yet.</p>';
}
async function viewBecomeBlogger(){
  const me=API._requireUser(); if(!me){ app.innerHTML='<p>Please log in.</p>'; return; }
  app.innerHTML = `<section><h2>${titled('ads','Become a Blogger')}</h2>
  <div class="card"><form id="bf">
    <div class="row">
      <div><label>Platform <input name="platform" placeholder="TikTok, Instagram…"/></label></div>
      <div><label>Handle <input name="handle" placeholder="@handle"/></label></div>
      <div><label>Followers <input name="followers" type="number" min="0"/></label></div>
    </div>
    <div class="row">
      <div><label>Price per promo (¢) <input name="price_cents" type="number" min="0"/></label></div>
      <div><label>Profile Photo <input type="file" name="profile_photo" accept="image/*"/></label></div>
    </div>
    <label>Bio <textarea name="bio" placeholder="About your audience…"></textarea></label>
    <div class="actions"><button class="btn" type="submit">Submit</button></div>
  </form></div></section>`;
  $('#bf').addEventListener('submit', async(e)=>{ e.preventDefault(); const r=await API.postForm('/api/ads/blogger/create', new FormData(e.target)); if(r.error){alert(r.error);return;} alert('Submitted! Pending approval.'); location.hash='#/ads'; });
}
async function viewCreateCampaign(){
  const me=API._requireUser(); if(!me){ app.innerHTML='<p>Please log in.</p>'; return; }
  app.innerHTML = `<section><h2>${titled('ads','Create Ad Campaign')}</h2>
  <div class="card"><form id="cf">
    <div class="row">
      <div><label>Product Title <input name="product_title" required/></label></div>
      <div><label>Budget (¢) <input name="budget_cents" type="number" min="0"/></label></div>
    </div>
    <label>Product Description <textarea name="product_desc"></textarea></label>
    <div class="row">
      <div><label>Target Platform <input name="target_platform" placeholder="TikTok / Instagram / …"/></label></div>
      <div><label>Payment Screenshot <input type="file" name="payment_screenshot" accept="image/*"/></label></div>
    </div>
    <div class="actions"><button class="btn" type="submit">Create</button></div>
  </form></div></section>`;
  $('#cf').addEventListener('submit', async(e)=>{ e.preventDefault(); const r=await API.postForm('/api/ads/campaign/create', new FormData(e.target)); if(r.error){alert(r.error);return;} alert('Campaign submitted.'); location.hash='#/ads'; });
}
async function viewAdCampaigns(){
  const me=API._requireUser(); if(!me){ app.innerHTML='<p>Please log in.</p>'; return; }
  const res=await API.get('/api/ads/campaigns/list'); if(res.error){ app.innerHTML='<p>'+res.error+'</p>'; return; }
  app.innerHTML = `<section><h2>${titled('ads','Ad Campaigns')}</h2><div id="wrap" class="grid"></div></section>`;
  const wrap=$('#wrap'); (res.campaigns||[]).forEach(c=>{
    const div=document.createElement('div'); div.className='card';
    div.innerHTML=`<h3>${c.product_title}</h3><p class="muted">${c.product_desc||''}</p><p class="muted">Budget: ${cents(c.budget_cents||0)} · Status: ${c.status}</p>`;
    wrap.appendChild(div);
  });
}

/* ---------- Post forms ---------- */

function postForm({category, allowBoost=false, boostMandatory=false}){
  const wrap=document.createElement('div');
  const niceTitle=(category==='jobs')?'Post a Job':`Create ${cap(category)} Post`;
  wrap.innerHTML = `
  <h2>${EMO[category]||''} ${niceTitle}</h2>
  <form id="pform">
    <div class="row">
      <div><label>Title <input name="title" required /></label></div>
      <div><label>Price (¢) <input name="price_cents" type="number" min="0" /></label></div>
    </div>

    ${category!=='services' ? googleLocationBlock() : ''}

    ${category==='goods' ? photosBlock('goods') : ''}

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

    ${category==='rentals' ? `
      <div class="card" style="margin-top:10px;">
        <h3 style="margin:4px 0 8px 0;">Property Details</h3>

        <div class="row">
          <div>
            <label>Listing Type
              <select name="listing_type" id="listingType" required>
                <option value="rent" selected>Rent</option>
                <option value="sell">Sell</option>
              </select>
            </label>
          </div>
          <div>
            <label>Property Category
              <select name="property_parent" id="rentParent" required></select>
            </label>
          </div>
          <div>
            <label>Sub-category
              <select name="property_child" id="rentChild" required></select>
            </label>
          </div>
        </div>

        <div class="row">
          <div><label>Bedrooms
            <select name="bedrooms" id="bedrooms" required>
              <option value="0">Studio</option><option value="1">1 Bedroom</option><option value="2">2 Bedrooms</option>
              <option value="3">3 Bedrooms</option><option value="4">4 Bedrooms</option><option value="5">5 Bedrooms</option><option value="6+">6+ Bedrooms</option>
            </select></label></div>
          <div><label>Bathrooms
            <select name="bathrooms" id="bathrooms" required>
              <option value="1">1 Bath</option><option value="1.5">1.5 Baths</option><option value="2">2 Baths</option><option value="3">3 Baths</option><option value="4+">4+ Baths</option>
            </select></label></div>
          <div><label>Furnished
            <select name="furnished" id="furnished"><option value="no">No</option><option value="partly">Partly</option><option value="yes">Yes</option></select></label></div>
        </div>

        <div class="row">
          <div><label>Condition
            <select name="condition" id="condition"><option value="">— Select —</option><option>New</option><option>Like New</option><option>Good</option><option>Needs Work</option></select></label></div>
          <div><label>Size (m²) <input name="size_sqm" type="number" min="0" placeholder="e.g., 85"/></label></div>
          <div><label>Floor Level <input name="floor_level" type="number" min="0" placeholder="e.g., 2"/></label></div>
        </div>

        <div class="row">
          <div><label>Parking Spots <input name="parking_spots" type="number" min="0" placeholder="e.g., 1"/></label></div>
          <div><label>Available From <input name="available_from" type="date"/></label></div>
          <div id="leaseTermWrap"><label>Lease Term
            <select name="lease_term" id="leaseTerm"><option value="">— Select —</option><option>Month-to-month</option><option>6 months</option><option>12 months</option><option>24 months</option></select></label></div>
        </div>

        <div class="row">
          <div><label>Deposit (¢) <input name="deposit_cents" type="number" min="0" placeholder="e.g., 300000"/></label></div>
          <div><label>Price Firm <select name="price_firm"><option value="">No</option><option value="1">Yes</option></select></label></div>
          <div><label>Pets Allowed <select name="pets_allowed"><option value="">—</option><option value="no">No</option><option value="yes">Yes</option></select></label></div>
        </div>

        <div class="row">
          <div><label>Amenities</label><div id="amenitiesBox" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:6px"></div></div>
          <div><label>Utilities Included</label><div id="utilitiesBox" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:6px"></div></div>
        </div>
      </div>

      ${photosBlock('rent')}
    ` : ''}

    ${allowBoost? boostBlock({ category, mandatory: !!boostMandatory }): ''}

    <label>Description <textarea name="description"></textarea></label>

    <div class="actions"><button type="submit" id="submitBtn">${category==='jobs'?'Post Job':'Publish'}</button></div>
  </form>
  `;

  const form = wrap.querySelector('#pform');

  // Google Maps block(s)
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
  wrap.querySelectorAll('#postMap').forEach(()=> wireMaps(wrap));

  // Services taxonomy, photos, availability
  if (category==='services'){
    const SERVICES_TAXONOMY = {
      "Home Services": ["Plumber","Electrician","Contractor","House Cleaning","Painting","Furniture Assembly","Interior Decoration","AC Specialist","TV Repairer","Appliance Repair","Pest Control"],
      "Food & Events": ["Personal Chef","Catering","Baker","Event Planner","Decorator","DJ/MC","Photography","Videography"],
      "Personal & Wellness": ["Hair Stylist","Makeup Artist","Massage","Fitness Trainer","Nail Technician","Tailor"],
      "Tech & Office": ["Computer Repair","Phone Repair","IT Support","Graphic Design","Web Design","Printing"],
      "Transport & Moving": ["Driver","Motorbike Delivery","Moving Help","Courier"],
      "Lessons & Coaching": ["Tutoring","Language Lessons","Music Lessons","Career Coaching"],
      "Other": ["General Labor","Errands","Carpentry","Masonry"]
    };
    const DAYS=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
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
    form._collectServices = ()=>({ profile_photo_file:profileFile, portfolio_files:portfolioFiles.slice(0,8) });
  }

  // Rentals taxonomy + dynamic
  if (category==='rentals'){
    const RENTAL_TAXONOMY = {
      "Homes": ["Apartment","House","Townhouse","Room in Shared Home","Guesthouse","Bungalow","Duplex"],
      "Land": ["Residential Land","Commercial Land","Farm Land"],
      "Commercial": ["Shop/Store","Office","Warehouse","Restaurant/Bar Space","Event Space"]
    };
    const AMENITIES = ["Air Conditioning","Balcony","Built-in Wardrobes","Ceiling Fans","Security","Generator","Water Tank","Back-up Water","Gated Compound","Garden","Laundry","Swimming Pool","Sea View"];
    const UTILITIES = ["Water","Electricity","Internet","Gas","Trash"];
    const pSel=wrap.querySelector('#rentParent'), cSel=wrap.querySelector('#rentChild');
    pSel.innerHTML = `<option value="">— Select —</option>` + Object.keys(RENTAL_TAXONOMY).map(k=>`<option>${k}</option>`).join('');
    cSel.innerHTML = `<option value="">— Select —</option>`;
    pSel.addEventListener('change', ()=>{ const kids=RENTAL_TAXONOMY[pSel.value]||[]; cSel.innerHTML = `<option value="">— Select —</option>` + kids.map(v=>`<option>${v}</option>`).join(''); });
    const amenBox=wrap.querySelector('#amenitiesBox'), utilBox=wrap.querySelector('#utilitiesBox');
    AMENITIES.forEach(a=>{ const lab=document.createElement('label'); lab.style.display='inline-flex'; lab.style.alignItems='center'; lab.style.gap='6px'; const cb=document.createElement('input'); cb.type='checkbox'; cb.name='amenities'; cb.value=a; lab.appendChild(cb); lab.appendChild(document.createTextNode(a)); amenBox.appendChild(lab); });
    UTILITIES.forEach(u=>{ const lab=document.createElement('label'); lab.style.display='inline-flex'; lab.style.alignItems='center'; lab.style.gap='6px'; const cb=document.createElement('input'); cb.type='checkbox'; cb.name='utilities'; cb.value=u; lab.appendChild(cb); lab.appendChild(document.createTextNode(u)); utilBox.appendChild(lab); });
    const priceInput = form.querySelector('input[name="price_cents"]'); const listingType = wrap.querySelector('#listingType'); const leaseWrap = wrap.querySelector('#leaseTermWrap');
    function refreshListingType(){ const isRent = (listingType.value==='rent'); priceInput?.setAttribute('placeholder', isRent ? 'e.g., 150000 (per month)' : 'e.g., 25000000'); leaseWrap.style.display = isRent ? '' : 'none'; }
    listingType.addEventListener('change', refreshListingType); refreshListingType();

    // Rentals photos
    const phInCam = wrap.querySelector('#rentCam'), phInGal=wrap.querySelector('#rentGal'), strip=wrap.querySelector('#rentStrip'); const files=[];
    function drawRentPreviews(){ strip.innerHTML=''; files.slice(0,8).forEach((f,i)=>{ const ph=document.createElement('div'); ph.className='ph'; const img=document.createElement('img'); img.src=URL.createObjectURL(f); const x=document.createElement('button'); x.className='x'; x.type='button'; x.textContent='×'; x.onclick=()=>{ files.splice(i,1); drawRentPreviews(); }; ph.appendChild(img); ph.appendChild(x); strip.appendChild(ph); }); }
    phInCam?.addEventListener('change', e=>{ const f=e.target.files?.[0]; if(f&&f.type.startsWith('image/')) files.unshift(f); if(files.length>8) files.length=8; drawRentPreviews(); });
    phInGal?.addEventListener('change', e=>{ for(const f of e.target.files||[]){ if(f.type.startsWith('image/')) files.push(f); } if(files.length>8) files.length=8; drawRentPreviews(); });
    form._collectRentals = ()=>({ rental_photo_files: files.slice(0,8) });
  }

  // Goods photos + preload from footer
  if (category === 'goods'){
    const cam = wrap.querySelector('#goodsCam'); const gal=wrap.querySelector('#goodsGal'); const strip=wrap.querySelector('#goodsStrip'); const files=[];
    function drawPrev(){ strip.innerHTML=''; files.slice(0,8).forEach((f,i)=>{ const ph=document.createElement('div'); ph.className='ph'; const img=document.createElement('img'); img.src=URL.createObjectURL(f); const x=document.createElement('button'); x.className='x'; x.type='button'; x.textContent='×'; x.onclick=()=>{ files.splice(i,1); drawPrev(); }; ph.appendChild(img); ph.appendChild(x); strip.appendChild(ph); }); }
    cam?.addEventListener('change', e=>{ const f=e.target.files?.[0]; if(f&&f.type.startsWith('image/')) files.unshift(f); if(files.length>8) files.length=8; drawPrev(); });
    gal?.addEventListener('change', e=>{ for(const f of e.target.files||[]){ if(f.type.startsWith('image/')) files.push(f); } if(files.length>8) files.length=8; drawPrev(); });
    if (Array.isArray(window._preUploadPhotos) && window._preUploadPhotos.length){ files.splice(0,0, ...window._preUploadPhotos.slice(0,8)); window._preUploadPhotos=[]; drawPrev(); }
    form._collectGoods = ()=>({ goods_photo_files: files.slice(0,8) });
  }

  // Boost UI react (price + trial + screenshot requirement)
  const bm = wrap.querySelector('#boostMonths');
  const teaser = wrap.querySelector('#premiumTeaser');
  const priceLine = wrap.querySelector('#boostPriceLine');
  const trialChk = wrap.querySelector('#boostTrial');
  const payBlock = wrap.querySelector('#mmPayBlock');
  const payInput = wrap.querySelector('#paymentScreenshot');
  const isAds = category === 'ads';
  if (bm && teaser && priceLine){
    const PRICE_PER_MONTH = 100; // NLe
    const refresh = ()=>{
      let m = Math.max(isAds?1:0, Math.min(12, Number(bm.value || 0)));
      if (isAds && m < 1){ m = 1; bm.value = 1; }
      const trial = !!(trialChk && trialChk.checked && !isAds);
      const total = trial && m===0 ? 0 : (PRICE_PER_MONTH * m);
      teaser.style.opacity = (trial || m > 0) ? '1' : '0.55';
      priceLine.innerHTML = trial && m===0
        ? `NLe 100 per month · Est. total: <strong>NLe 0</strong> <small class="muted">(14-day trial)</small>`
        : trial && m>0
          ? `NLe 100 per month · Est. total: <strong>NLe ${total}</strong> <small class="muted">(first 14 days free)</small>`
          : `NLe 100 per month · Est. total: <strong>NLe ${total}</strong>`;
      const requirePay = isAds || m > 0;
      if (payBlock) payBlock.style.display = requirePay ? 'block' : 'none';
      if (payInput){ if (requirePay) payInput.setAttribute('required','required'); else payInput.removeAttribute('required'); }
    };
    bm.addEventListener('input', refresh);
    trialChk && trialChk.addEventListener('change', refresh);
    refresh();
  }

  // Submit (auto-publish if Boost untouched)
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd=new FormData(form);
    fd.set('category', category);

    // Normalize boost for auto-publish case
    const bmEl = form.querySelector('#boostMonths');
    if (bmEl) {
      const m = Math.max(0, Math.min(12, parseInt(bmEl.value || '0', 10) || 0));
      fd.set('boosted_months', String(m));
    }
    const trialEl = form.querySelector('#boostTrial');
    if (!trialEl || !trialEl.checked) fd.delete('boost_trial');

    if (form._collectGoods){ const gg=form._collectGoods(); (gg.goods_photo_files||[]).forEach(f=> fd.append('photos', f)); }
    if (form._collectRentals){ const rr=form._collectRentals(); (rr.rental_photo_files||[]).forEach(f=> fd.append('photos', f)); }
    if (form._collectServices){ const ss=form._collectServices(); (ss.portfolio_files||[]).forEach(f=> fd.append('portfolio', f)); if(ss.profile_photo_file) fd.append('profile_photo', ss.profile_photo_file); }

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
    <div class="card" style="margin-top:10px"><h3 style="margin:0 0 8px 0;">Settings</h3><p class="muted">Allow-list emails are set in env.json (ADMIN_EMAILS). Approve Limited Admin requests here.</p></div>
  </section>`;
  const d=DB.data; const list=d.users.filter(u=>u.limitedAdminStatus==='pending').map(u=>`<li>${u.email} <button data-id="${u.id}">Approve</button></li>`).join('');
  $('#laWrap').innerHTML = `<h3 style="margin:0 0 8px 0;">Pending Limited Admin</h3><ul>${list||'<li class="muted">None</li>'}</ul>`;
  $('#laWrap').querySelectorAll('button').forEach(b=>{
    b.onclick=()=>{ const u=d.users.find(x=>x.id===b.dataset.id); if(!u) return; u.limitedAdminStatus='approved'; DB.data=d; alert('Approved'); route(); };
  });
}
async function viewAdminQuotes(){
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

// Admin → App Ads (broadcast)
async function viewAdminAppAds(){
  const me = API._requireUser(); 
  if (!me || !isMainAdmin(me)){ app.innerHTML = '<p>Admins only.</p>'; return; }

  app.innerHTML = `<section>
    <h2>${titled('admin','Admin · App Advertisements')}</h2>
    <div class="card" id="adForm">
      <h3 style="margin:0 0 8px 0;">Compose Broadcast</h3>
      <form id="bf">
        <div class="row">
          <div><label>Title <input name="title" required placeholder="Promo, update, reminder…"/></label></div>
          <div><label>CTA Label <input name="cta_label" placeholder="Shop Now"/></label></div>
          <div><label>CTA URL <input name="cta_url" placeholder="https://…"/></label></div>
        </div>
        <label>Message <textarea name="message" required placeholder="Write your announcement to users…"></textarea></label>
        <div class="row">
          <div><label>Image (optional) <input type="file" id="adImg" name="adImg" accept="image/*"/></label></div>
          <div><label>Audience
            <select name="audience" id="aud">
              <option value="all">All users</option>
              <option value="boosted">Boosted only</option>
              <option value="trial">Trial only</option>
              <option value="cat:goods">Users who posted Goods</option>
              <option value="cat:services">Users who posted Services</option>
              <option value="cat:rentals">Users who posted Rentals</option>
              <option value="cat:jobs">Users who posted Jobs</option>
              <option value="cat:ads">Users who posted Ads</option>
            </select>
          </label></div>
        </div>
        <div class="actions" style="margin-top:8px">
          <button type="submit" class="btn">Send Broadcast</button>
        </div>
      </form>
    </div>
    <div class="card" style="margin-top:10px">
      <h3 style="margin:0 0 8px 0;">Previous Broadcasts</h3>
      <div id="adList" class="muted">Loading…</div>
    </div>
  </section>`;

  $('#bf').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const res=await API.postForm('/api/admin/broadcast/create', fd);
    if(res.error){ alert(res.error); return; }
    alert('Broadcast sent!');
    route('#/admin/app-ads');
  });

  const d=DB.data;
  const items=(d.appAds||[]).slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  if (!items.length){ $('#adList').textContent='No broadcasts yet.'; }
  else {
    $('#adList').innerHTML = items.map(x=>{
      const when = new Date(x.createdAt).toLocaleString();
      return `<div style="margin:8px 0">
        <strong>${x.title}</strong> <small class="muted">(${when})</small><br/>
        <span>${x.message}</span>
        ${x.cta_label && x.cta_url ? `<div style="margin-top:4px"><a class="btn" href="${x.cta_url}" target="_blank" rel="noopener">${x.cta_label}</a></div>`:''}
        ${x.image_name ? `<div class="muted" style="margin-top:4px">Image: ${x.image_name}</div>`:''}
        <div class="muted" style="margin-top:4px">Audience: ${x.audience}</div>
      </div>`;
    }).join('');
  }
}

/* ---------- Router ---------- */
window.addEventListener('hashchange', route);
async function route(){
  const hash = location.hash.slice(2);
  const seg = hash.split('/').filter(Boolean);
  toggleAdminLink();
  sweepTrials();
  playBoopOnNew();

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
    const boostMandatory = (seg[1] === 'ads'); // only Ads requires boost
    app.innerHTML=''; app.appendChild(postForm({ category: seg[1], allowBoost, boostMandatory }));
    return;
  }

  if (seg[0]==='item' && seg[1]) return viewItem(seg[1]);

  if (seg[0]==='search')     return viewSearch();
  if (seg[0]==='inbox')      return viewInbox();
  if (seg[0]==='chat' && seg[1]) return viewChat(seg[1]);
  if (seg[0]==='listings')   return viewListings();
  if (seg[0]==='location')   return viewLocation();

  if (seg[0]==='admin' && !seg[1]) return viewAdmin();
  if (seg[0]==='admin' && seg[1]==='quotes') return viewAdminQuotes();
  if (seg[0]==='admin' && seg[1]==='app-ads') return viewAdminAppAds();

  return viewHome();
}


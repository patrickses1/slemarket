/* Sleconomicmarket SPA (localStorage backend)
   Mobile-first with big Search & My Location row, category boxes, tiny hero on Home,
   tiny footer, “Return” button, Google Sign-In + email code verification.
   Business logic includes:
   - Goods/Services/Rentals/Jobs/Ads with separate feeds
   - Boost in NLe (NLe100/mo), 14-day trial for all except Ads (mandatory boost)
   - Google location picker on Goods/Rentals/Services forms
   - Messaging + Inbox with "Seen" for users (not for admins)
   - Save/Share, Search, Listings, Post quick chooser
   - Admin & Limited Admin: approve limited-admin, pin posts, bloggers, campaigns, app ads
   - Post status: available | pending | sold
   - Sierra Leone–only posting for non-admins (COUNTRY_CODE_ALLOW="SL")
*/

const $ = (sel, node=document) => node.querySelector(sel);
const $$ = (sel, node=document) => Array.from(node.querySelectorAll(sel));
const cap = s => (s||'').charAt(0).toUpperCase() + (s||'').slice(1);
const cents = n => 'NLe ' + (Math.round(Number(n||0))/100).toLocaleString();

let AFRIMONEY_NUMBER='—', ORANGEMONEY_NUMBER='—', GOOGLE_MAPS_API_KEY='', ADMIN_EMAILS=[], COUNTRY_CODE_ALLOW='', GOOGLE_OAUTH_CLIENT_ID='';

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
function getUserById(id){ const d=DB.data; return d.users.find(u=>u.id===id)||null; }
function isMainAdmin(user){ return !!user && ADMIN_EMAILS.includes(user.email); }
function isLimitedAdmin(user){ return !!user && user.limitedAdminStatus==='approved'; }
function isAdminOrLimited(user){ return isMainAdmin(user) || isLimitedAdmin(user); }
function isApprovedBlogger(user){ if(!user) return false; const d=DB.data; return (d.bloggers||[]).some(b=>b.userId===user.id && b.status==='approved'); }
function isAdminOrBlogger(u){ return isAdminOrLimited(u) || isApprovedBlogger(u); }

// Notifications / Mail
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

// Boop sound
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
  if (maxTs>last){ boop(); localStorage.setItem(lastKey,String(maxTs)); }
}

// Saved
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

/* ---------------------------------
   API shim (localStorage backend)
-----------------------------------*/
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

    // Email verification code (demo)
    if (path==='/api/auth/send-code'){
      const {email} = body||{}; if(!email) return {error:'Email required'};
      const code = String(Math.floor(100000 + Math.random()*900000));
      const key = `sl_verify_${email.toLowerCase()}`;
      localStorage.setItem(key, JSON.stringify({code, ts: Date.now()}));
      alert(`Demo verification code (for ${email}): ${code}`);
      return {ok:true};
    }
    if (path==='/api/auth/verify-signup'){
      const {email,password,code}=body||{}; if(!email||!password||!code) return {error:'All fields required'};
      const key=`sl_verify_${email.toLowerCase()}`, obj=JSON.parse(localStorage.getItem(key)||'{}');
      if (!obj.code || obj.code!==String(code)) return {error:'Invalid code'};
      localStorage.removeItem(key);
      if (d.users.some(u=>u.email===email)) return {error:'User exists'};
      const u={id:uid(),email,password,limitedAdminStatus:'none',verified:true}; d.users.push(u);
      const tok=uid(); d.sessions[tok]={userId:u.id}; DB.data=d; return {token:tok};
    }

    // Email/password login
    if (path==='/api/auth/login'){
      const {email,password}=body||{}; const u=d.users.find(x=>x.email===email && x.password===password);
      if(!u) return {error:'Invalid credentials'}; const tok=uid(); d.sessions[tok]={userId:u.id}; DB.data=d; return {token:tok};
    }

    // Google Sign-In (ID token from Google Identity Services) — demo trust
    if (path==='/api/auth/google-id-token'){
      const {id_token} = body||{}; if(!id_token) return {error:'Missing token'};
      const payload = JSON.parse(atob(id_token.split('.')[1]||'{}')); // {email, sub}
      const email = payload.email; if(!email) return {error:'No email in token'};
      let u=d.users.find(x=>x.email===email);
      if(!u){ u={id:uid(),email,password:'',limitedAdminStatus:'none',verified:true, googleSub:payload.sub}; d.users.push(u); }
      const tok=uid(); d.sessions[tok]={userId:u.id}; DB.data=d; return {token:tok};
    }

    // Legacy mock Google (kept for fallback)
    if (path==='/api/auth/google/mock'){
      const {email}=body||{}; let u=d.users.find(x=>x.email===email);
      if(!u){ u={id:uid(),email,password:'',limitedAdminStatus:'none'}; d.users.push(u); }
      const tok=uid(); d.sessions[tok]={userId:u.id}; DB.data=d; return {token:tok};
    }

    // Limited admin request
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
      if (isAdminOrLimited(me)) return {ok:true, skipped:'admin'}; // admins don't show "seen"
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

    // Create posts
    if (path==='/api/posts'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      if (!isAdminOrLimited(me) && !inSierraLeone()) return {error:'Service available in Sierra Leone only'};

      // Ads require Boost ≥1 month + payment screenshot
      if (body.category === 'ads' && Number(body.boosted_months || 0) <= 0){
        return { error: 'Advertising posts require Boost (minimum 1 month).' };
      }

      const months = Number(body.boosted_months || 0);
      const trialOnly = !!body.boost_trial && months === 0;
      if (body.category === 'ads'){
        if (!(body.payment_screenshot_name && String(body.payment_screenshot_name).trim())){
          return { error:'Advertising requires a mobile money payment screenshot.' };
        }
      } else if (!trialOnly && months > 0){
        if (!(body.payment_screenshot_name && String(body.payment_screenshot_name).trim())){
          return { error:'Mobile money payment screenshot is required for Boost.' };
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

        parent_cat: body.parent_cat||'',
        child_cat: body.child_cat||'',
        condition: body.condition||'',
        item_type: (body.item_type||'').trim(),
        brand: (body.brand||'').trim(),
        color: (body.color||'').trim(),
        price_firm: !!(body.price_firm==='1' || body.price_firm===true),
        photos: Array.isArray(body.photos)? body.photos.slice(0,8) : [],

        location_address: (body.location_address||'').trim(),
        location_lat: body.location_lat!=null ? Number(body.location_lat) : null,
        location_lng: body.location_lng!=null ? Number(body.location_lng) : null,
        location_place_id: (body.location_place_id||'').trim(),

        // Services
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

        // Rentals
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

        status: 'available',
        createdAt:new Date().toISOString()
      };
      d.posts.push(p); DB.data=d; return p;
    }

    // Update post status
    if (path === '/api/posts/update-status'){
      const me = this._requireUser(); if(!me) return {error:'Unauthorized'};
      const { postId, status } = body || {};
      if (!['available','pending','sold'].includes(status)) return {error:'Bad status'};
      const p = d.posts.find(x => x.id === postId);
      if (!p) return {error:'Post not found'};
      const canEdit = (p.userId === me.id) || isAdminOrLimited(me);
      if (!canEdit) return {error:'Forbidden'};
      p.status = status;
      DB.data = d;
      return {ok:true, post:p};
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

    // Bloggers/Campaigns
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

    // Admin App Broadcast (selected users supported)
    if (path==='/api/admin/broadcast/create'){
      const me=this._requireUser(); if(!me) return {error:'Unauthorized'};
      if (!isMainAdmin(me)) return {error:'Admins only'};
      const { title, message, cta_label, cta_url, audience } = body || {};

      let targetEmails = [];
      if (typeof body.target_emails === 'string' && body.target_emails.trim()){
        try { targetEmails = JSON.parse(body.target_emails); }
        catch { targetEmails = String(body.target_emails).split(',').map(s=>s.trim()).filter(Boolean); }
      } else if (Array.isArray(body.target_emails)){
        targetEmails = body.target_emails.map(String).map(s=>s.trim()).filter(Boolean);
      }

      d.appAds ||= [];
      const ad = {
        id: uid(),
        title: String(title||'').trim(),
        message: String(message||'').trim(),
        cta_label: (cta_label||'').trim(),
        cta_url: (cta_url||'').trim(),
        image_name: (body.image_name || body.adImg_name || '').trim(),
        audience: (audience || (targetEmails.length ? 'selected' : 'all')),
        createdAt: new Date().toISOString(),
        senderId: me.id
      };
      d.appAds.push(ad);

      let recipients = d.users.filter(u=>u.id!==me.id);
      const posts=d.posts||[];
      const userHasPostedCat=(uid,cat)=> posts.some(p=>p.userId===uid && p.category===cat);
      const isBoosted=(uid)=> posts.some(p=>p.userId===uid && (Number(p.boosted_months||0)>0));
      const isTrial=(uid)=> posts.some(p=>p.userId===uid && trialActive(p));

      if (ad.audience==='boosted') recipients = recipients.filter(u=>isBoosted(u.id));
      else if (ad.audience==='trial') recipients = recipients.filter(u=>isTrial(u.id));
      else if (ad.audience?.startsWith('cat:')){
        const cat=ad.audience.split(':')[1]; recipients = recipients.filter(u=>userHasPostedCat(u.id,cat));
      } else if (ad.audience==='selected' && targetEmails.length){
        const set = new Set(targetEmails.map(e=>e.toLowerCase()));
        recipients = recipients.filter(u=> set.has((u.email||'').toLowerCase()));
      }

      recipients.forEach(u=>{
        notifyUser(u.id, ad.title, ad.message, {type:'broadcast', cta_label:ad.cta_label, cta_url:ad.cta_url, image_name:ad.image_name});
      });
      DB.data=d; 
      return {ok:true, broadcast:ad, sent:recipients.length};
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

/* -----------------
   DOMContentLoaded
-------------------*/
window.addEventListener('DOMContentLoaded', async () => {
  const env = await fetch('./env.json').then(r=>r.json()).catch(()=>({}));
  AFRIMONEY_NUMBER = env.AFRIMONEY_NUMBER||'—';
  ORANGEMONEY_NUMBER = env.ORANGEMONEY_NUMBER||'—';
  GOOGLE_MAPS_API_KEY = env.GOOGLE_MAPS_API_KEY||'';
  ADMIN_EMAILS = Array.isArray(env.ADMIN_EMAILS)?env.ADMIN_EMAILS:[];
  COUNTRY_CODE_ALLOW = env.COUNTRY_CODE_ALLOW||'';
  GOOGLE_OAUTH_CLIENT_ID = env.GOOGLE_OAUTH_CLIENT_ID||'';

  $('#afr').textContent = AFRIMONEY_NUMBER; $('#orm').textContent = ORANGEMONEY_NUMBER;

  // Wire big search row
  $('#globalSearch').addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ const q=e.currentTarget.value||''; location.hash = `#/search?q=${encodeURIComponent(q)}`; } });
  $('#goLocation').addEventListener('click', ()=>{ location.hash = '#/location'; });

  // Init Google Identity Services button when client id is present
  if (GOOGLE_OAUTH_CLIENT_ID && window.google?.accounts?.id){
    window.google.accounts.id.initialize({
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      callback: async (resp)=>{
        const r = await API.post('/api/auth/google-id-token', { id_token: resp.credential });
        if (r.token) API.setToken(r.token); else alert(r.error||'Google sign-in failed');
      }
    });
  }

  sweepTrials();
  setInterval(sweepTrials, 60*60*1000);
  playBoopOnNew();
  setInterval(playBoopOnNew, 20000);

  // Footer Post quick chooser opens Goods form
  const fp=$('#footPost');
  if (fp){ fp.addEventListener('click', (e)=>{ e.preventDefault(); openQuickPostChooser(); }); }

  renderAuth(); route();
});

/* ------------
   Auth UI
-------------*/
function renderAuth(){
  const el=$('#authArea'), me=API._requireUser();
  if (!me){
    el.innerHTML = `
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <input id="email" placeholder="email" />
        <input id="pass" type="password" placeholder="password"/>
        <input id="code" placeholder="verification code (for signup)"/>
        <button id="sendCodeBtn">Send code</button>
        <button id="verifySignupBtn">Verify & Sign up</button>
        <button id="loginBtn">Login</button>
        <span id="googleBtnContainer"></span>
      </div>
    `;
    $('#sendCodeBtn').onclick = async()=>{ const email=$('#email').value.trim(); if(!email) return alert('Enter email'); const r=await API.post('/api/auth/send-code',{email}); if(r.error) alert(r.error); else alert('Code sent (demo shows it in alert).'); };
    $('#verifySignupBtn').onclick = async()=>{ const email=$('#email').value.trim(), password=$('#pass').value, code=$('#code').value.trim(); const r=await API.post('/api/auth/verify-signup',{email,password,code}); if(r.token){ API.setToken(r.token); } else alert(r.error||'Signup failed'); };
    $('#loginBtn').onclick = async()=>{ const email=$('#email').value, password=$('#pass').value; const r=await API.post('/api/auth/login',{email,password}); if(r.token){ API.setToken(r.token); } else alert(r.error||'Login failed'); };

    // Render Google button if GIS available
    if (GOOGLE_OAUTH_CLIENT_ID && window.google?.accounts?.id){
      window.google.accounts.id.renderButton($('#googleBtnContainer'), { theme: 'outline', size: 'medium', type:'standard', shape:'pill' });
    } else {
      const btn=document.createElement('button'); btn.textContent='Continue with Google'; btn.onclick=()=>alert('Google Sign-In requires GOOGLE_OAUTH_CLIENT_ID in env.json'); $('#googleBtnContainer').appendChild(btn);
    }
  } else {
    el.innerHTML = `
      <span class="pill" style="background:#fff">Hi, ${me.email}</span>
      <button id="logoutBtn">Logout</button>
      <button id="reqLA">Request Limited Admin</button>
    `;
    $('#logoutBtn').onclick = ()=>{ API.setToken(null); location.hash='#/'; };
    $('#reqLA').onclick = async()=>{ const r=await API.post('/api/users/request-limited-admin',{}); alert('Limited admin status: '+(r.status||JSON.stringify(r))); };
  }
  toggleAdminLink();
}

/* ------------
   Back button
-------------*/
function renderBackBtn(show){
  const app = $('#app');
  let b = $('#backBtn');
  if (!b){
    b=document.createElement('button'); b.id='backBtn'; b.textContent='← Return';
    b.onclick=()=>{ history.length>1 ? history.back() : (location.hash='#/'); };
    app.parentNode.insertBefore(b, app);
  }
  b.style.display = show ? '' : 'none';
}

/* ------------
   Photos picker
-------------*/
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

/* ========== HEADER HERO (TINY + clickable) ========== */
function renderHero(){
  const host = document.getElementById('heroRotator');
  if (!host || host.dataset.wired) return;
  host.dataset.wired = '1';

  host.innerHTML = `
    <div class="hero-slide active" data-kind="services" style="background: radial-gradient(120% 120% at 0% 0%, #fff7e6 0%, #fdebc8 45%, #f4dfa9 100%);">
      <div class="hero-art">
        <a href="#/services" aria-label="Browse Services">
          <svg viewBox="0 0 240 180" width="100%" height="100%" class="floaty" aria-hidden="true">
            <defs>
              <linearGradient id="gHat" x1="0" x2="1"><stop offset="0" stop-color="#f3d48a"/><stop offset="1" stop-color="#d4a017"/></linearGradient>
              <linearGradient id="gShirt" x1="0" x2="1"><stop offset="0" stop-color="#ffe6b3"/><stop offset="1" stop-color="#ffcf6f"/></linearGradient>
            </defs>
            <path d="M80 78c0-22 18-40 40-40s40 18 40 40" fill="url(#gHat)" stroke="#b1840f" stroke-width="2" />
            <circle cx="120" cy="96" r="22" fill="#ffddb2" stroke="#e7c08c" stroke-width="2"/>
            <circle cx="112" cy="96" r="3" fill="#2d1f12"/><circle cx="128" cy="96" r="3" fill="#2d1f12"/>
            <path d="M112 106c4 6 12 6 16 0" stroke="#2d1f12" stroke-width="2" fill="none" stroke-linecap="round"/>
            <rect x="92" y="120" width="56" height="34" rx="8" fill="url(#gShirt)" stroke="#e6c384" stroke-width="2"/>
          </svg>
        </a>
      </div>
      <div class="hero-copy">
        <h3>Let us handle your service needs</h3>
        <p>Find trusted plumbers, electricians, cleaners, and more.</p>
        <a class="hero-cta btn" href="#/services">Browse Services</a>
      </div>
    </div>

    <div class="hero-slide" data-kind="boost" style="background: radial-gradient(120% 120% at 100% 0%, #fff7e6 0%, #ffe6b8 45%, #f0d089 100%);">
      <div class="hero-art">
        <a href="#/post/goods" aria-label="Try Boost">
          <svg viewBox="0 0 240 180" width="100%" height="100%" class="floaty" aria-hidden="true">
            <path d="M120 20 L90 100 L130 100 L110 160 L160 80 L120 80 Z" fill="#ffd766" stroke="#b1840f" stroke-width="2" />
          </svg>
        </a>
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
function setHeroVisible(on){
  const sec = document.getElementById('heroSection');
  if(!sec) return;
  sec.style.display = on ? '' : 'none';
  if (on) renderHero();
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
  renderBackBtn(false);
  setHeroVisible(true);
  app.innerHTML = `
    <h2>Home · Goods Feed</h2>
    <p class="muted" style="margin:4px 0 10px 0; font-size:13px;">
      <a href="#/post/goods" style="text-decoration:underline">
        Boost your listing — get faster responses. Try for free
      </a>
    </p>
    <div class="grid" id="grid"></div>
  `;
  const posts = await API.get('/api/posts?category=goods');
  const grid=$('#grid');
  sortPostsForFeed(posts).forEach(p=> renderCard(p, grid));
  playBoopOnNew();
}

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

async function messageOwner(post, text){
  const me = API._requireUser();
  if (!me){ alert('Please log in first.'); return; }
  if (me.id === post.userId){ alert('This is your own listing.'); return; }
  const r = await API.post('/api/messages/start-with-user', { userId: post.userId });
  if (r.error){ alert(r.error); return; }
  await API.post('/api/messages/send', { threadId: r.threadId, text });
  location.hash = `#/chat/${r.threadId}`;
}

function renderCard(p, grid, opts={}){
  const bits=[];
  if (p.is_pinned) bits.push('Top');
  if (p.boosted_months>0 || trialActive(p)) bits.push('Premium');
  if (p.price_firm) bits.push('Firm');
  if (p.condition) bits.push(p.condition);
  if (p.status && p.status !== 'available') bits.push(p.status.toUpperCase());

  const c = card(p.title, p.description, bits.join(' • '));
  if (p.status === 'sold'){ c.style.opacity = '0.6'; }

  if (p.location_address){
    const loc=document.createElement('p'); loc.className='muted'; loc.style.marginTop='6px';
    loc.textContent=`📍 ${p.location_address}`; c.appendChild(loc);
  }

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

  // Ask / Offer / Quote (blocked if SOLD)
  {
    const me=API._requireUser?.();
    const isOwner = !!me && me.id === p.userId;
    const canMessage = (p.status !== 'sold');

    if (!me || !isOwner){
      if (canMessage){
        const actions = document.createElement('div');
        actions.className = 'actions';
        actions.style.marginTop = '8px';

        const askBtn = document.createElement('button');
        askBtn.textContent = 'Ask';
        askBtn.title = 'Is this still available?';
        askBtn.onclick = ()=> messageOwner(p, `Hi! Is "${p.title}" still available?`);
        actions.appendChild(askBtn);

        const offerBtn = document.createElement('button');
        offerBtn.textContent = 'Make an offer';
        offerBtn.onclick = ()=>{
          const amount = prompt('Your offer (NLe):');
          if (amount == null || !String(amount).trim()) return;
          const note = prompt('Add a note (optional):') || '';
          messageOwner(p, `Offer for "${p.title}": NLe ${String(amount).trim()}${note ? ` — ${note}` : ''}`);
        };
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

  // Owner/Admin: status control on feed when owner view (or admin)
  {
    const me = API._requireUser?.();
    const canEdit = (me && (me.id === p.userId || isAdminOrLimited(me)));
    if ((opts.ownerControls || isAdminOrLimited(me)) && canEdit){
      const ctl = document.createElement('div');
      ctl.className = 'actions';
      ctl.style.marginTop = '8px';
      ctl.innerHTML = `
        <label style="display:flex;align-items:center;gap:8px">
          <span class="muted">Status</span>
          <select class="statusSel">
            <option value="available" ${p.status==='available'?'selected':''}>Available</option>
            <option value="pending" ${p.status==='pending'?'selected':''}>Pending</option>
            <option value="sold" ${p.status==='sold'?'selected':''}>Sold</option>
          </select>
          <button class="applyBtn">Update</button>
        </label>
      `;
      ctl.querySelector('.applyBtn').onclick = async()=>{
        const val = ctl.querySelector('.statusSel').value;
        const r = await API.post('/api/posts/update-status', { postId: p.id, status: val });
        if (r.error){ alert(r.error); return; }
        alert('Status updated.');
        route();
      };
      c.appendChild(ctl);
    }
  }

  const meOwner = API._requireUser?.();
  if (p.category==='goods' && meOwner && p.userId===meOwner.id && !(p.boosted_months>0 || trialActive(p))){
    const upsell = document.createElement('small');
    upsell.className = 'muted'; upsell.style.display='block'; upsell.style.marginTop='6px';
    upsell.innerHTML = `<a href="#/post/goods" style="text-decoration:underline">Boost this — 14-day trial</a>`;
    c.appendChild(upsell);
  }

  attachShareSave(c,p);
  grid.appendChild(c);
}

async function viewCategory(category){
  renderBackBtn(true);
  setHeroVisible(false);

  const label=cap(category);
  app.innerHTML = `<h2>${label} Feed</h2><div class="grid" id="grid"></div>`;
  const grid=$('#grid');

  // In-page Post CTAs
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
  renderBackBtn(true);
  setHeroVisible(false);

  const d=DB.data; const p=(d.posts||[]).find(x=>x.id===itemId);
  if(!p){ app.innerHTML='<p>Item not found.</p>'; return; }
  app.innerHTML = `<section><h2>${(p.category||'').toUpperCase()} · ${p.title||''}</h2><div class="card" id="itemCard"></div><p style="margin-top:10px"><a href="#/${p.category||''}">← Back to ${p.category||'feed'}</a></p></section>`;
  const c = card(p.title, p.description, [p.is_pinned?'Top':'',(p.boosted_months>0||trialActive(p))?'Premium':'',p.condition||'',(p.status!=='available'?p.status.toUpperCase():'')].filter(Boolean).join(' • '));
  if (p.location_address){ const loc=document.createElement('p'); loc.className='muted'; loc.style.marginTop='6px'; loc.textContent=`📍 ${p.location_address}`; c.appendChild(loc); }
  attachShareSave(c,p);

  // Owner/Admin control on item page
  const me = API._requireUser?.();
  const canEdit = (me && (me.id === p.userId || isAdminOrLimited(me)));
  if (canEdit){
    const ctl = document.createElement('div'); ctl.className='actions'; ctl.style.marginTop='8px';
    ctl.innerHTML = `
      <label style="display:flex;align-items:center;gap:8px">
        <span class="muted">Status</span>
        <select class="statusSel">
          <option value="available" ${p.status==='available'?'selected':''}>Available</option>
          <option value="pending" ${p.status==='pending'?'selected':''}>Pending</option>
          <option value="sold" ${p.status==='sold'?'selected':''}>Sold</option>
        </select>
        <button class="applyBtn">Update</button>
      </label>`;
    ctl.querySelector('.applyBtn').onclick = async()=>{
      const val = ctl.querySelector('.statusSel').value;
      const r = await API.post('/api/posts/update-status', { postId: p.id, status: val });
      if (r.error){ alert(r.error); return; }
      alert('Status updated.'); route();
    };
    c.appendChild(ctl);
  }

  $('#itemCard').appendChild(c);
}

async function viewSearch(){
  renderBackBtn(true);
  setHeroVisible(false);

  const q = new URLSearchParams((location.hash.split('?')[1]||'')).get('q') || prompt('Search term:') || '';
  const d=DB.data;
  const list = d.posts.filter(p=> [p.title,p.description].join(' ').toLowerCase().includes(q.toLowerCase()));
  app.innerHTML = `<h2>Search</h2><p class="muted">Results for: <strong>${q||'—'}</strong></p><div class="grid" id="grid"></div>`;
  const grid=$('#grid');
  sortPostsForFeed(list).forEach(p=>{
    renderCard(p, grid);
  });
}

async function viewListings(){
  renderBackBtn(true);
  setHeroVisible(false);

  const me=API._requireUser(); if(!me){ app.innerHTML='<p>Please log in.</p>'; return; }
  const d=DB.data; const mine=d.posts.filter(p=>p.userId===me.id);
  app.innerHTML = `<section><h2>Your Listings</h2><div class="grid" id="grid"></div></section>`;
  const grid=$('#grid');
  sortPostsForFeed(mine).forEach(p=> renderCard(p, grid, { ownerControls: true }));
}

async function viewInbox(){
  renderBackBtn(true);
  setHeroVisible(false);

  const me=API._requireUser(); if(!me){ app.innerHTML='<p>Please log in.</p>'; return; }
  app.innerHTML = `<section><h2>Inbox</h2><div id="threads"></div></section>`;

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
  renderBackBtn(true);
  setHeroVisible(false);

  const me=API._requireUser(); if(!me){ app.innerHTML='<p>Please log in.</p>'; return; }
  app.innerHTML = `<section><h2>Chat</h2><div class="card" style="display:flex;flex-direction:column;gap:8px;height:60vh"><div id="msgs" style="overflow:auto;display:flex;flex-direction:column;gap:8px"></div><div class="row"><div><input id="msgText" placeholder="Type a message"/></div><div><button id="sendBtn">Send</button></div></div></div></section>`;

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
  renderBackBtn(true);
  setHeroVisible(false);

  app.innerHTML = `<section><h2>My Location</h2><p class="muted">Used to improve search and show nearby items. (Static demo)</p></section>`;
}

/* ---------- Ads / Bloggers ---------- */
async function viewAds(){
  renderBackBtn(true);
  setHeroVisible(false);

  app.innerHTML = `<section>
    <h2>Advert with Bloggers</h2>
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
  renderBackBtn(true);
  setHeroVisible(false);

  const me=API._requireUser(); if(!me){ app.innerHTML='<p>Please log in.</p>'; return; }
  app.innerHTML = `<section><h2>Become a Blogger</h2>
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
  renderBackBtn(true);
  setHeroVisible(false);

  const me=API._requireUser(); if(!me){ app.innerHTML='<p>Please log in.</p>'; return; }
  app.innerHTML = `<section><h2>Create Ad Campaign</h2>
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
  renderBackBtn(true);
  setHeroVisible(false);

  const me=API._requireUser(); if(!me){ app.innerHTML='<p>Please log in.</p>'; return; }
  const res=await API.get('/api/ads/campaigns/list'); if(res.error){ app.innerHTML='<p>'+res.error+'</p>'; return; }
  app.innerHTML = `<section><h2>Advert with Bloggers · Campaigns</h2><div id="wrap" class="grid"></div></section>`;
  const wrap=$('#wrap'); (res.campaigns||[]).forEach(c=>{
    const div=document.createElement('div'); div.className='card';
    div.innerHTML=`<h3>${c.product_title}</h3><p class="muted">${c.product_desc||''}</p><p class="muted">Budget: ${cents(c.budget_cents||0)} · Status: ${c.status}</p>`;
    wrap.appendChild(div);
  });
}

/* ---------- Post forms ---------- */
function postForm({category, allowBoost=false, boostMandatory=false}){
  const wrap = document.createElement('div');
  const title = `Create ${cap(category)} Post`;
  wrap.innerHTML = `<h2>${title}</h2><form id="pform"></form>`;
  const f = $('#pform', wrap);

  // Common: photos
  f.insertAdjacentHTML('beforeend', photosBlock('post'));
  const pre = window._preUploadPhotos || [];
  const strip = $('#postStrip', wrap);
  const addPhotoThumb = (file)=>{
    const ph=document.createElement('div'); ph.className='ph';
    const img=document.createElement('img'); img.alt='upload'; img.src=URL.createObjectURL(file);
    const x=document.createElement('button'); x.className='x'; x.type='button'; x.textContent='×';
    x.onclick=()=>ph.remove();
    ph.appendChild(img); ph.appendChild(x); strip.appendChild(ph);
  };
  pre.forEach(addPhotoThumb);

  if (category==='goods' || category==='jobs' || category==='ads'){
    f.insertAdjacentHTML('beforeend', `
      <div class="row">
        <div><label>Title <input name="title" required /></label></div>
        <div><label>Price (¢) <input name="price_cents" type="number" min="0" /></label></div>
      </div>
      <label>Description<textarea name="description"></textarea></label>
    `);
    if (category==='goods'){
      f.insertAdjacentHTML('beforeend', `
        <div class="row">
          <div><label>Parent Category
            <select name="parent_cat">
              <option>Electronics & Media</option><option>Home & Garden</option><option>Home Decoration</option>
              <option>Clothing & Shoes</option><option>Vehicles</option><option>Sports & Outdoors</option>
              <option>Baby & Kids</option><option>Health & Beauty</option><option>Pets</option><option>Other</option>
            </select></label></div>
          <div><label>Sub-category (Child) <input name="child_cat" placeholder="Phones, Laptops, Sofas…"/></label></div>
        </div>
        <div class="row">
          <div><label>Condition
            <select name="condition"><option value="">—</option><option>New</option><option>Like new</option><option>Normal wear</option><option>Needs repair</option></select>
          </label></div>
          <div><label>Type <input name="item_type" placeholder="Type/model"/></label></div>
        </div>
        <div class="row">
          <div><label>Brand <input name="brand" /></label></div>
          <div><label>Color <input name="color" /></label></div>
          <div><label>Price firm? <select name="price_firm"><option value="">No</option><option value="1">Yes</option></select></label></div>
        </div>
      `);
    }
  }
  if (category==='services'){
    f.insertAdjacentHTML('beforeend', `
      <div class="row">
        <div><label>Title <input name="title" required /></label></div>
        <div><label>Min Price (¢) <input name="min_price_cents" type="number" min="0" /></label></div>
      </div>
      <label>Introduction<textarea name="intro" placeholder="Short intro…"></textarea></label>
      <label>Services Description<textarea name="service_desc" placeholder="What you offer"></textarea></label>
      <div class="row">
        <div><label>Parent Category
          <select name="service_parent">
            <option>Personal Chef</option><option>Plumber</option><option>Contractor</option><option>Interior Decoration</option>
            <option>AC Specialist</option><option>TV Repairer</option><option>Furniture Assembly</option><option>House Cleaning</option>
            <option>Painting</option><option>Other</option>
          </select></label></div>
        <div><label>Sub-category <input name="service_child" placeholder="e.g., Deep cleaning, Wall painting"/></label></div>
      </div>
      <div class="row">
        <div><label>Pricing model <input name="price_model" placeholder="Fixed / Hourly"/></label></div>
        <div><label>Service radius (km) <input name="service_radius_km" type="number" min="0"/></label></div>
      </div>
      <div class="row">
        <div><label>Availability
          <select name="availability_days" multiple>
            <option>Mon</option><option>Tue</option><option>Wed</option><option>Thu</option><option>Fri</option><option>Sat</option><option>Sun</option>
          </select></label></div>
        <div><label>Profile Photo <input type="file" name="profile_photo" accept="image/*"/></label></div>
        <div><label>Portfolio (up to 8) <input type="file" name="portfolio" accept="image/*" multiple/></label></div>
      </div>
    `);
  }
  if (category==='rentals'){
    f.insertAdjacentHTML('beforeend', `
      <div class="row">
        <div><label>Title <input name="title" required /></label></div>
        <div><label>Price (¢) <input name="price_cents" type="number" min="0" /></label></div>
      </div>
      <label>Description<textarea name="description"></textarea></label>
      <div class="row">
        <div><label>Listing Type
          <select name="listing_type"><option value="rent">Rent</option><option value="sell">Sell</option></select></label></div>
        <div><label>Home Details (Parent)
          <select name="property_parent">
            <option>House</option><option>Apartment</option><option>Townhouse</option><option>Duplex</option><option>Land</option><option>Commercial</option>
          </select></label></div>
        <div><label>Sub Type (Child) <input name="property_child" placeholder="1-bed, Studio, Shop…"/></label></div>
      </div>
      <div class="row">
        <div><label>Bedrooms <input name="bedrooms" type="number" min="0" placeholder="0=Studio"/></label></div>
        <div><label>Bathrooms <input name="bathrooms" type="number" min="0"/></label></div>
        <div><label>Furnished
          <select name="furnished"><option value="">—</option><option value="yes">Yes</option><option value="partly">Partly</option><option value="no">No</option></select></label></div>
      </div>
      <div class="row">
        <div><label>Size (m²) <input name="size_sqm" type="number" min="0"/></label></div>
        <div><label>Lease Term <input name="lease_term" placeholder="12 months"/></label></div>
        <div><label>Available From <input name="available_from" placeholder="YYYY-MM-DD"/></label></div>
      </div>
      <div class="row">
        <div><label>Deposit (¢) <input name="deposit_cents" type="number" min="0"/></label></div>
        <div><label>Pets Allowed <select name="pets_allowed"><option value="">—</option><option>Yes</option><option>No</option></select></label></div>
        <div><label>Parking Spots <input name="parking_spots" type="number" min="0"/></label></div>
      </div>
      <div class="row">
        <div><label>Amenities (multi) <select name="amenities" multiple><option>Water</option><option>Electricity</option><option>Backup Power</option><option>Security</option></select></label></div>
        <div><label>Utilities (multi) <select name="utilities" multiple><option>Included</option><option>Not included</option></select></label></div>
      </div>
    `);
  }

  // Google location
  f.insertAdjacentHTML('beforeend', googleLocationBlock());

  // Boost
  if (allowBoost){
    f.insertAdjacentHTML('beforeend', boostBlock({category, mandatory: boostMandatory}));
  }

  // Submit
  const submitBar = document.createElement('div'); submitBar.className='actions'; submitBar.style.marginTop='10px';
  submitBar.innerHTML = `<button class="btn" type="submit">Publish</button>`;
  f.appendChild(submitBar);

  // Wire photos chooser
  const gal = $('#postGal', wrap), cam = $('#postCam', wrap);
  const pushThumbs = (files)=>{
    for (const f of files||[]){ if (!f || !f.type || !f.type.startsWith('image/')) continue;
      const ph=document.createElement('div'); ph.className='ph'; const img=document.createElement('img'); img.alt='upload'; img.src=URL.createObjectURL(f);
      const x=document.createElement('button'); x.className='x'; x.type='button'; x.textContent='×'; x.onclick=()=>ph.remove();
      ph.appendChild(img); ph.appendChild(x); $('#postStrip', wrap).appendChild(ph);
    }
  };
  if (gal) gal.addEventListener('change', ()=> pushThumbs(gal.files));
  if (cam) cam.addEventListener('change', ()=> pushThumbs(cam.files));

  // Google maps autocomplete
  (async()=>{
    const g = await ensureGoogleMaps(); if(!g) return;
    const input = $('#placeInput', wrap); const mapDiv=$('#postMap', wrap);
    const map = new g.Map(mapDiv, {center:{lat:8.4606,lng:-11.7799}, zoom:7}); // Sierra Leone approx
    const autocomplete = new g.places.Autocomplete(input, { fields: ['formatted_address','geometry','place_id'] });
    autocomplete.addListener('place_changed', ()=>{
      const place = autocomplete.getPlace(); if(!place || !place.geometry) return;
      $('#locAddress',wrap).value = place.formatted_address || '';
      $('#locLat',wrap).value = place.geometry.location.lat();
      $('#locLng',wrap).value = place.geometry.location.lng();
      $('#locPid',wrap).value = place.place_id || '';
      mapDiv.style.display='block';
      map.setCenter(place.geometry.location); map.setZoom(14);
      new g.Marker({map, position: place.geometry.location});
    });
    $('#useGPS',wrap).onclick = ()=>{
      if (!navigator.geolocation){ alert('Geolocation not supported'); return; }
      navigator.geolocation.getCurrentPosition(pos=>{
        const {latitude:lat, longitude:lng} = pos.coords||{};
        $('#locLat',wrap).value=lat; $('#locLng',wrap).value=lng; $('#locAddress',wrap).value='My location (approx)';
        mapDiv.style.display='block'; const ll={lat,lng}; map.setCenter(ll); map.setZoom(14); new g.Marker({map, position: ll});
      }, ()=> alert('Could not get your location'));
    };
  })();

  // Boost dynamic parts
  const mline = ()=>{
    const months = Number($('#boostMonths',wrap)?.value||0);
    $('#boostPriceLine',wrap).innerHTML = `NLe 100 per month · Est. total: <strong>NLe ${months*100}</strong>`;
    const trial = !!$('#boostTrial',wrap)?.checked;
    $('#mmPayBlock',wrap).style.display = (months>0) ? 'block' : (trial ? 'none' : 'none');
  };
  $('#boostMonths',wrap)?.addEventListener('input', mline);
  $('#boostTrial',wrap)?.addEventListener('change', mline);
  mline();

  // Submit handler
  f.addEventListener('submit', async(e)=>{
    e.preventDefault();
    const me=API._requireUser(); if(!me){ alert('Please log in first.'); return; }
    const fd = new FormData(f);
    fd.append('category', category);

    // Add a placeholder blob so names are parsed
    const names=[];
    $$('#postStrip .ph img', wrap).forEach((img,i)=>{ names.push(`photo_${i+1}.jpg`); });
    if (names.length) fd.append('photos', new Blob([]), names.join(','));

    // Boost screenshot name (if file chosen)
    const pay = $('#paymentScreenshot',wrap);
    if (pay && pay.files && pay.files[0]){ fd.append('payment_screenshot', pay.files[0]); }

    const r = await API.postForm('/api/posts', fd);
    if (r.error){ alert(r.error); return; }
    alert('Published!');
    location.hash = `#/${category}`;
  });

  return wrap;
}

/* ---------- Admin ---------- */
async function viewAdmin(){
  renderBackBtn(true);
  setHeroVisible(false);

  const me=API._requireUser(); if(!me){ app.innerHTML='<p>Please log in.</p>'; return; }
  if (!isMainAdmin(me)) { app.innerHTML='<p>Admins only.</p>'; return; }
  const d=DB.data;
  const pending = d.users.filter(u=>u.limitedAdminStatus==='pending');
  const allBloggers = d.bloggers||[];
  app.innerHTML = `<section><h2>Admin</h2>
    <div class="card">
      <h3>Limited Admin Requests</h3>
      <div id="laList">${pending.length?'':'<p class="muted">No pending requests.</p>'}</div>
    </div>
    <div class="card" style="margin-top:10px">
      <h3>Bloggers</h3>
      <div id="blogList">${allBloggers.length?'' : '<p class="muted">No blogger submissions yet.</p>'}</div>
    </div>
  </section>`;

  const la=$('#laList');
  pending.forEach(u=>{
    const row=document.createElement('div'); row.style='display:flex;gap:8px;align-items:center;margin:6px 0';
    row.innerHTML = `<span>${u.email}</span> <button class="btn approve">Approve</button> <button class="btn reject" style="background:#eee;border-color:#ddd">Reject</button>`;
    row.querySelector('.approve').onclick = ()=>{ u.limitedAdminStatus='approved'; DB.data=DB.data; alert('Approved'); route(); };
    row.querySelector('.reject').onclick = ()=>{ u.limitedAdminStatus='none'; DB.data=DB.data; alert('Rejected'); route(); };
    la.appendChild(row);
  });

  const bl=$('#blogList');
  allBloggers.forEach(b=>{
    const u=getUserById(b.userId)||{};
    const row=document.createElement('div'); row.style='display:flex;gap:8px;align-items:center;margin:6px 0;flex-wrap:wrap';
    row.innerHTML = `<strong>${b.platform||'—'}</strong> ${b.handle||''} — ${b.followers||0} followers — ${cents(b.price_cents||0)} · ${b.status} · by ${u.email||''}
      <div class="actions">
        <button class="btn ap">Approve</button>
        <button class="btn rej" style="background:#eee;border-color:#ddd">Reject</button>
      </div>`;
    row.querySelector('.ap').onclick = async()=>{ const r=await API.post('/api/admin/bloggers/update',{bloggerId:b.id,action:'approved'}); if(r.error){alert(r.error);return;} alert('Approved'); route(); };
    row.querySelector('.rej').onclick = async()=>{ const r=await API.post('/api/admin/bloggers/update',{bloggerId:b.id,action:'rejected'}); if(r.error){alert(r.error);return;} alert('Rejected'); route(); };
    bl.appendChild(row);
  });
}
async function viewAdminQuotes(){
  renderBackBtn(true);
  setHeroVisible(false);

  const me=API._requireUser(); if(!me){ app.innerHTML='<p>Please log in.</p>'; return; }
  if(!isAdminOrLimited(me)) { app.innerHTML='<p>Staff only.</p>'; return; }
  const r=await API.post('/api/admin/quotes/list',{}); if(r.error){ app.innerHTML='<p>'+r.error+'</p>'; return; }
  app.innerHTML = `<section><h2>Quotes</h2><div id="qwrap" class="grid"></div></section>`;
  const wrap=$('#qwrap');
  (r.quotes||[]).forEach(q=>{
    const div=document.createElement('div'); div.className='card';
    div.innerHTML = `<h3>${q.postTitle||'Service'}</h3>
      <p class="muted">From: ${q.requesterEmail||''} → Provider: ${q.providerEmail||''}</p>
      <p>${q.details||''}</p>
      <p class="muted">Status: ${q.status}</p>
      <div class="actions">
        <button class="btn act" data-a="in_progress">In progress</button>
        <button class="btn act" data-a="closed">Closed</button>
        <button class="btn act" data-a="rejected" style="background:#eee;border-color:#ddd">Reject</button>
      </div>`;
    div.querySelectorAll('.act').forEach(b=> b.onclick = async()=>{
      const a=b.dataset.a; const rr=await API.post('/api/admin/quotes/update',{quoteId:q.id,action:a}); if(rr.error){alert(rr.error);return;} alert('Updated'); route();
    });
    wrap.appendChild(div);
  });
}
async function viewAdminAppAds(){
  renderBackBtn(true);
  setHeroVisible(false);

  const me=API._requireUser(); if(!me){ app.innerHTML='<p>Please log in.</p>'; return; }
  if(!isMainAdmin(me)) { app.innerHTML='<p>Admins only.</p>'; return; }
  app.innerHTML = `<section><h2>App Advertisements</h2>
    <div class="card"><form id="adf">
      <div class="row">
        <div><label>Title <input name="title" required/></label></div>
        <div><label>CTA Label <input name="cta_label" placeholder="Open"/></label></div>
        <div><label>CTA URL <input name="cta_url" placeholder="https://…"/></label></div>
      </div>
      <label>Message<textarea name="message" required></textarea></label>
      <div class="row">
        <div><label>Audience
          <select name="audience">
            <option value="all">All users</option>
            <option value="boosted">Boosted users</option>
            <option value="trial">Users on trial</option>
            <option value="cat:goods">Users who posted Goods</option>
            <option value="cat:services">Users who posted Services</option>
            <option value="cat:rentals">Users who posted Rentals</option>
            <option value="selected">Selected emails</option>
          </select>
        </label></div>
        <div><label>Target Emails (JSON array or comma list) <input name="target_emails" placeholder='["a@b.com","c@d.com"] or a@b.com,c@d.com'/></label></div>
      </div>
      <div class="actions"><button class="btn" type="submit">Send</button></div>
    </form></div>
  </section>`;
  $('#adf').addEventListener('submit', async(e)=>{
    e.preventDefault();
    const fd=new FormData(e.target); const obj=Object.fromEntries(fd.entries());
    const r=await API.post('/api/admin/broadcast/create', obj);
    if (r.error){ alert(r.error); return; }
    alert(`Sent to ${r.sent} user(s).`); location.hash='#/inbox';
  });
}

/* ---------- UI helpers ---------- */
const app = $('#app');
const card = (t,d,b) => { const div=document.createElement('div'); div.className='card'; if(b){ const s=document.createElement('span'); s.className='badge'; s.textContent=b; div.appendChild(s); } div.innerHTML += `<h3>${t}</h3><p class="muted">${d||''}</p>`; return div; };

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

/* ---------- Router ---------- */
window.addEventListener('hashchange', route);
async function route(){
  const hash = location.hash.slice(2);
  const seg = hash.split('/').filter(Boolean);
  toggleAdminLink();
  sweepTrials();
  playBoopOnNew();

  const isHome = (!hash || seg[0]==='');  // Home = Goods feed only
  setHeroVisible(isHome);

  if (!hash || seg[0]==='') return viewHome();

  renderBackBtn(true);

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
    const boostMandatory = (seg[1] === 'ads');
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

// ============================================================
// TallyField — app.js
// Router + screens, wired to the real PHP/MySQL API. Reads go straight
// through fetch(); writes that must survive offline (check-in, log
// outcome) go through window.TallyFieldQueue (see queue.js).
// ============================================================

// GitHub Pages build: no PHP backend is reachable here, so every call
// goes through mock.js's localStorage-backed mock instead of fetch().
// See public/app.js for the fetch()-based version that talks to the
// real api/ folder once a PHP/MySQL host is available.

/* ---------------- state (persisted across reloads) ---------------- */
const state = {
  token: localStorage.getItem('tf_token') || null,
  user: JSON.parse(localStorage.getItem('tf_user') || 'null'),
  screen: 'login',
  params: {},
  otpSent: false,
  otpCountdown: 0,
  online: navigator.onLine,
  toast: null,
};
if (state.token && state.user) state.screen = state.user.role === 'rep' ? 'rep-home' : 'owner-dashboard';

/* ---------------- transport (mock — see mock.js) ---------------- */
async function api(method, path, body) {
  return window.TallyFieldMockApi(method, path, body || {});
}
async function apiJson(method, path, body) {
  const res = await api(method, path, body);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/* ---------------- security: HTML escaping (QA Defect 5 fix) ---------------- */
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function money(n) { return '₹' + Number(n).toLocaleString('en-IN'); }

/* ---------------- router ---------------- */
function nav(screen, params = {}) {
  state.screen = screen;
  state.params = params;
  render();
  document.getElementById('main').focus();
}

/* ---------------- toast ---------------- */
function showToast(msg) {
  state.toast = { msg };
  paintToast();
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { state.toast = null; paintToast(); }, 2600);
}
function paintToast() {
  let el = document.getElementById('toast');
  if (el) el.remove();
  if (!state.toast) return;
  el = document.createElement('div');
  el.id = 'toast';
  el.setAttribute('role', 'status');
  el.style.cssText = 'position:fixed;left:50%;bottom:calc(84px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:#0a1628;color:#fff;padding:10px 18px;border-radius:999px;font-size:13px;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,.25);z-index:100;';
  el.textContent = state.toast.msg;
  document.body.appendChild(el);
}

/* ---------------- top bar / bottom nav ---------------- */
function renderTopbar() {
  const top = document.getElementById('topbar');
  if (!state.token) {
    top.innerHTML = `<div class="brand"><span class="dot"></span> TallyField</div>`;
    return;
  }
  top.innerHTML = `
    <div class="brand"><span class="dot"></span> TallyField</div>
    <div class="topbar-spacer"></div>
    <span class="meta">${esc(state.user?.name || '')}${!state.online ? ' · Offline' : ''}</span>
    <button class="icon-btn" id="sync-icon-btn" aria-label="Sync status">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6"/></svg>
    </button>
  `;
  document.getElementById('sync-icon-btn').addEventListener('click', () => nav('sync-status'));
}
function renderBottomNav() {
  const bn = document.getElementById('bottom-nav');
  if (!state.token) { bn.innerHTML = ''; return; }
  const repTabs = [
    { id: 'rep-home', label: 'Visits' },
    { id: 'sync-status', label: 'Sync' },
  ];
  const ownerTabs = [
    { id: 'owner-dashboard', label: 'Dashboard' },
  ];
  const tabs = state.user.role === 'rep' ? repTabs : ownerTabs;
  bn.innerHTML = tabs.map((t) => `<button data-nav="${t.id}" aria-current="${state.screen === t.id}">${esc(t.label)}</button>`).join('');
  bn.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => nav(b.dataset.nav)));
}

/* ---------------- shared primitives ---------------- */
function banner(text, tone = 'amber') { return `<div class="banner banner-${tone}">${text}</div>`; }
function chip(text, tone = 'neutral') { return `<span class="chip chip-${tone}">${esc(text)}</span>`; }
function emptyState(title, body, actionHtml = '') {
  return `<div class="empty-state"><h3>${esc(title)}</h3><p>${esc(body)}</p>${actionHtml}</div>`;
}
function isValidPhone(v) { return /^[6-9]\d{9}$/.test(v.trim()); }
function isValidOtp(v) { return /^\d{4,6}$/.test(v.trim()); }
function isValidAmount(v) { return v !== '' && !isNaN(v) && Number(v) > 0; }

/* ================================================================
   SCREEN 1 — LOGIN
   ================================================================ */
function screenLogin() {
  return `
  <div class="login-wrap screen">
    <div class="card login-card">
      <div class="login-logo">TF</div>
      <h1 style="text-align:center;font-size:20px;margin-bottom:4px;">Sign in to TallyField</h1>
      <p style="text-align:center;color:var(--ink-600);font-size:13px;margin-bottom:12px;">Field sales, synced to Tally</p>
      <p style="text-align:center;color:var(--blue-500);font-size:12px;margin-bottom:20px;background:var(--blue-050);border-radius:8px;padding:8px 10px;">Demo build — any 10-digit number + any code logs in. Try <strong>9000000001</strong> for the Rep view or <strong>9000000000</strong> for the Owner view.</p>
      <form id="login-form" class="stack" novalidate>
        <div class="field" id="phone-field">
          <label for="phone">Phone number</label>
          <input type="tel" id="phone" inputmode="numeric" autocomplete="tel" placeholder="10-digit mobile number" ${state.otpSent ? 'readonly' : ''} value="${esc(state.params.phone || '')}">
          <div class="field-error visually-hidden" id="phone-error" role="alert"></div>
        </div>
        ${state.otpSent ? `
        <div class="field" id="otp-field">
          <label for="otp">Enter OTP</label>
          <input type="text" id="otp" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" autofocus>
          <div class="field-error visually-hidden" id="otp-error" role="alert"></div>
          <span class="field-hint" id="resend-hint">${state.otpCountdown > 0 ? `Resend OTP (${state.otpCountdown}s)` : ''}</span>
        </div>` : ''}
        <button type="submit" class="btn btn-primary" id="login-submit">${state.otpSent ? 'Verify & Continue' : 'Send OTP'}</button>
        ${state.otpSent && state.otpCountdown === 0 ? `<button type="button" class="btn btn-ghost" id="resend-btn">Resend OTP</button>` : ''}
      </form>
    </div>
  </div>`;
}
function wireLogin() {
  const form = document.getElementById('login-form');
  const phoneInput = document.getElementById('phone');
  const submitBtn = document.getElementById('login-submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.otpSent) {
      if (!isValidPhone(phoneInput.value)) return markInvalid('phone-field', 'phone-error', 'Enter a valid 10-digit number');
      clearInvalid('phone-field', 'phone-error');
      submitBtn.disabled = true; submitBtn.textContent = 'Sending…';
      try {
        await apiJson('POST', '/auth/send-otp.php', { phone: phoneInput.value });
        state.otpSent = true; state.otpCountdown = 30; state.params = { phone: phoneInput.value };
        render(); startOtpCountdown();
      } catch (err) {
        markInvalid('phone-field', 'phone-error', err.message);
      } finally {
        submitBtn.disabled = false;
      }
    } else {
      const otpInput = document.getElementById('otp');
      if (!isValidOtp(otpInput.value)) return markInvalid('otp-field', 'otp-error', 'Wrong code, try again');
      clearInvalid('otp-field', 'otp-error');
      submitBtn.disabled = true; submitBtn.textContent = 'Verifying…';
      try {
        const data = await apiJson('POST', '/auth/verify-otp.php', { phone: state.params.phone, otp: otpInput.value });
        state.token = data.token; state.user = data.user;
        localStorage.setItem('tf_token', state.token);
        localStorage.setItem('tf_user', JSON.stringify(state.user));
        state.otpSent = false;
        window.TallyFieldQueue.flush(api);
        nav(state.user.role === 'rep' ? 'rep-home' : 'owner-dashboard');
      } catch (err) {
        markInvalid('otp-field', 'otp-error', err.message);
      } finally {
        submitBtn.disabled = false;
      }
    }
  });
  const resendBtn = document.getElementById('resend-btn');
  if (resendBtn) resendBtn.addEventListener('click', async () => {
    await apiJson('POST', '/auth/send-otp.php', { phone: state.params.phone });
    state.otpCountdown = 30; render(); startOtpCountdown(); showToast('OTP resent');
  });
}
function startOtpCountdown() {
  clearInterval(startOtpCountdown._t);
  startOtpCountdown._t = setInterval(() => {
    state.otpCountdown--;
    const hint = document.getElementById('resend-hint');
    if (hint) hint.textContent = state.otpCountdown > 0 ? `Resend OTP (${state.otpCountdown}s)` : '';
    if (state.otpCountdown <= 0) { clearInterval(startOtpCountdown._t); render(); }
  }, 1000);
}
function markInvalid(fieldId, errId, msg) {
  document.getElementById(fieldId).classList.add('invalid');
  const err = document.getElementById(errId);
  err.textContent = msg; err.classList.remove('visually-hidden');
}
function clearInvalid(fieldId, errId) {
  document.getElementById(fieldId).classList.remove('invalid');
  const err = document.getElementById(errId);
  err.textContent = ''; err.classList.add('visually-hidden');
}

/* ================================================================
   SCREEN 2 — REP HOME
   ================================================================ */
let repHomeCache = null;
function screenRepHome() {
  if (repHomeCache === null) return `<div class="screen">${skeletonCards()}</div>`;
  const visits = repHomeCache;
  const statusChip = { not_visited: chip('Not visited', 'neutral'), checked_in: chip('Checked in', 'blue'), completed: chip('Completed', 'green') };
  return `
  <div class="screen">
    <div class="screen-header row-between">
      <div><h1>Today's visits</h1><p class="sub">${new Date().toDateString()}</p></div>
    </div>
    ${!state.online ? banner('Offline — showing last loaded data.', 'amber') : ''}
    <div class="stack" style="margin-top:12px;">
      ${visits.length === 0 ? emptyState('No visits planned for today', 'Nothing scheduled — check with your office if this looks wrong.') :
        visits.map((v) => `
          <div class="card">
            <div class="row-between">
              <div><h3 style="font-size:15px;">${esc(v.customer_name)}</h3><p class="sub" style="font-size:12px;margin-top:2px;">${esc(v.address)}</p></div>
              ${statusChip[v.status] || ''}
            </div>
            <div class="row-between" style="margin-top:12px;">
              <span style="font-size:13px;color:var(--ink-600);">Outstanding: <strong style="color:var(--ink-900);">${v.balance == null ? '—' : money(v.balance)}</strong></span>
              <button class="btn btn-secondary btn-sm" data-open-customer="${esc(v.customer_id)}">${v.status === 'not_visited' ? 'Check In' : 'View'}</button>
            </div>
          </div>`).join('')}
    </div>
  </div>`;
}
async function loadRepHome() {
  repHomeCache = null;
  try {
    const data = await apiJson('GET', `/visits/list.php?date=${new Date().toISOString().slice(0, 10)}`);
    repHomeCache = data.visits;
  } catch (e) {
    repHomeCache = [];
    showToast('Could not load visits — check your connection');
  }
  if (state.screen === 'rep-home') rerenderScreenBody();
}
function wireRepHome() {
  loadRepHome();
  document.querySelectorAll('[data-open-customer]').forEach((b) =>
    b.addEventListener('click', () => nav('customer-detail', { customerId: b.dataset.openCustomer })));
}
function skeletonCards(n = 3) { return Array.from({ length: n }).map(() => `<div class="card skeleton skel-card"></div>`).join(''); }

/* ================================================================
   SCREEN 3 — CUSTOMER DETAIL
   ================================================================ */
let customerCache = null;
function screenCustomerDetail() {
  if (!customerCache) return `<div class="screen">${skeletonCards(1)}</div>`;
  const c = customerCache;
  return `
  <div class="screen">
    <div class="screen-header">
      <button class="btn btn-ghost" id="back-btn" style="padding-left:0;">&larr; Back</button>
      <h1 style="margin-top:4px;">${esc(c.name)}</h1>
      <p class="sub">${esc(c.address)}</p>
    </div>
    <div class="card">
      <p class="sub" style="font-size:12px;">Outstanding balance</p>
      <h2 style="font-size:28px;margin-top:4px;">${c.balance == null ? '—' : money(c.balance)}</h2>
      <p class="sub" style="font-size:11px;margin-top:4px;">${c.last_synced_at ? `as of ${new Date(c.last_synced_at).toLocaleString()}` : 'Balance unavailable'}</p>
    </div>
    <div style="margin-top:18px;">
      <button class="btn btn-primary" id="checkin-here-btn">Check In Here</button>
    </div>
  </div>`;
}
function wireCustomerDetail() {
  customerCache = null;
  apiJson('GET', `/customers/get.php?id=${encodeURIComponent(state.params.customerId)}`)
    .then((data) => { customerCache = data; rerenderScreenBody(); })
    .catch(() => showToast('Could not load customer'));
  document.getElementById('back-btn').addEventListener('click', () => nav('rep-home'));
  document.getElementById('checkin-here-btn')?.addEventListener('click', () => nav('checkin', state.params));
}

/* ================================================================
   SCREEN 4 — CHECK-IN
   ================================================================ */
let checkinPhoto = null;   // reset per entry — fixes QA Defect 6
let checkinGps = null;
let checkinGpsState = 'loading';
function screenCheckIn() {
  const name = customerCache?.name || '';
  return `
  <div class="screen">
    <div class="screen-header"><h1>Check in — ${esc(name)}</h1></div>
    <div class="map-box">
      ${checkinGpsState === 'loading' ? `<span style="font-size:13px;">Getting your location…</span>` : ''}
      ${checkinGpsState === 'ready' ? `<span style="font-size:13px;">Location captured</span>` : ''}
      ${checkinGpsState === 'error' ? `<span style="font-size:13px;">Couldn't get exact location</span>` : ''}
    </div>
    ${checkinGpsState === 'error' ? banner('Location needed to check in — enable it in Settings, or check in anyway.', 'amber') : ''}
    <button type="button" class="photo-slot ${checkinPhoto ? 'has-photo' : ''}" id="photo-slot">
      <span style="font-size:13px;font-weight:600;">${checkinPhoto ? 'Retake photo' : 'Take Photo (optional)'}</span>
    </button>
    <input type="file" id="photo-input" accept="image/*" capture="environment" style="display:none;">
    ${!state.online ? banner('Offline — check-in will save locally and sync later.', 'amber') : ''}
    <div class="stack" style="margin-top:18px;">
      <button class="btn btn-primary" id="confirm-checkin" ${checkinGpsState === 'loading' ? 'disabled' : ''}>Confirm Check-In</button>
      <button class="btn btn-secondary" id="cancel-checkin">Cancel</button>
    </div>
  </div>`;
}
function wireCheckIn() {
  checkinPhoto = null; checkinGps = null; checkinGpsState = 'loading'; // fixes QA Defect 6 (stale state across customers)

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => { checkinGps = { lat: pos.coords.latitude, lng: pos.coords.longitude }; checkinGpsState = 'ready'; rerenderScreenBody(); },
      () => { checkinGpsState = 'error'; rerenderScreenBody(); },
      { timeout: 15000 }
    );
  } else {
    checkinGpsState = 'error'; rerenderScreenBody();
  }

  document.getElementById('photo-slot').addEventListener('click', () => document.getElementById('photo-input').click());
  document.getElementById('photo-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { checkinPhoto = reader.result; rerenderScreenBody(); };
    reader.readAsDataURL(file);
  });
  document.getElementById('cancel-checkin').addEventListener('click', () => nav('customer-detail', state.params));
  document.getElementById('confirm-checkin').addEventListener('click', async () => {
    const body = { customer_id: state.params.customerId, gps_lat: checkinGps?.lat ?? null, gps_lng: checkinGps?.lng ?? null };
    if (checkinPhoto) body.photo_base64 = checkinPhoto;
    if (state.online) {
      try {
        await apiJson('POST', '/visits/checkin.php', body);
        showToast('Checked in');
      } catch (e) {
        await window.TallyFieldQueue.enqueue('/visits/checkin.php', body);
        showToast('Saved — will sync when back online');
      }
    } else {
      await window.TallyFieldQueue.enqueue('/visits/checkin.php', body);
      showToast('Saved — will sync when back online');
    }
    nav('log-outcome', state.params);
  });
}

/* ================================================================
   SCREEN 5 — LOG OUTCOME
   ================================================================ */
let outcomeType = 'order'; // reset per entry — fixes QA Defect 6
function screenLogOutcome() {
  const name = customerCache?.name || '';
  return `
  <div class="screen">
    <div class="screen-header"><h1>Log outcome — ${esc(name)}</h1></div>
    <div class="toggle-group" role="tablist" aria-label="Outcome type">
      <button role="tab" aria-pressed="${outcomeType === 'order'}" data-type="order">Order</button>
      <button role="tab" aria-pressed="${outcomeType === 'collection'}" data-type="collection">Collection</button>
      <button role="tab" aria-pressed="${outcomeType === 'note'}" data-type="note">Note</button>
    </div>
    <form id="outcome-form" class="stack" style="margin-top:14px;" novalidate>
      ${outcomeType === 'order' ? `
        <div class="field"><label for="order-item">Item</label>
          <select id="order-item"><option>SS Push-Fit Elbow 1/2"</option><option>QUICKAIR Aluminium Profile 40x40</option><option>Other</option></select>
        </div>
        <div class="field"><label for="order-qty">Quantity</label><input type="number" id="order-qty" min="1" placeholder="e.g. 50"></div>
        <div class="field"><label for="order-notes">Notes (optional)</label><textarea id="order-notes" rows="2"></textarea></div>` : ''}
      ${outcomeType === 'collection' ? `
        <div class="field" id="amount-field"><label for="amount">Amount received</label>
          <input type="number" id="amount" min="0" inputmode="decimal" placeholder="₹0">
          <div class="field-error visually-hidden" id="amount-error" role="alert"></div>
        </div>
        <div class="field"><label for="pay-mode">Payment mode</label><select id="pay-mode"><option>Cash</option><option>UPI</option><option>Cheque</option></select></div>
        <div class="field"><label for="ref-no">Reference number (optional)</label><input type="text" id="ref-no"></div>` : ''}
      ${outcomeType === 'note' ? `
        <div class="field"><label for="note-text">Note</label><textarea id="note-text" rows="4" placeholder="What happened at this visit?"></textarea></div>
        <div class="row" style="gap:8px;"><input type="checkbox" id="follow-up" style="width:auto;"><label for="follow-up" style="font-size:13px;font-weight:500;">Needs follow-up</label></div>` : ''}
      <button type="submit" class="btn btn-primary" style="margin-top:4px;">Save Outcome</button>
    </form>
  </div>`;
}
function wireLogOutcome() {
  outcomeType = 'order'; // fixes QA Defect 6
  document.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => { outcomeType = b.dataset.type; rerenderScreenBody(); }));
  document.getElementById('outcome-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    // Collects every field per type — fixes QA Defect 7 (fields were
    // rendered but never read into the payload).
    const payload = { visit_id: state.params.visitId || state.params.customerId, type: outcomeType };
    if (outcomeType === 'order') {
      payload.items_json = [{ item: document.getElementById('order-item').value, qty: Number(document.getElementById('order-qty').value) || 0 }];
      payload.notes = document.getElementById('order-notes').value || null;
    } else if (outcomeType === 'collection') {
      const amt = document.getElementById('amount').value;
      if (!isValidAmount(amt)) return markInvalid('amount-field', 'amount-error', 'Enter a valid amount');
      clearInvalid('amount-field', 'amount-error');
      payload.amount = Number(amt);
      payload.payment_mode = document.getElementById('pay-mode').value;
      payload.reference_no = document.getElementById('ref-no').value || null;
    } else {
      payload.notes = document.getElementById('note-text').value || null;
      payload.follow_up = document.getElementById('follow-up').checked;
    }

    if (state.online) {
      try {
        await apiJson('POST', '/field-transactions/create.php', payload);
        showToast('Outcome saved — syncing to Tally');
      } catch (e) {
        await window.TallyFieldQueue.enqueue('/field-transactions/create.php', payload);
        showToast('Saved — will sync when back online');
      }
    } else {
      await window.TallyFieldQueue.enqueue('/field-transactions/create.php', payload);
      showToast('Saved — will sync when back online');
    }
    nav('sync-status');
  });
}

/* ================================================================
   SCREEN 6 — SYNC STATUS
   ================================================================ */
let syncCache = null;
function screenSyncStatus() {
  if (syncCache === null) return `<div class="screen">${skeletonCards()}</div>`;
  const { synced = [], pending = [], failed = [], queued = [] } = syncCache;
  const allEmpty = !synced.length && !pending.length && !failed.length && !queued.length;
  const row = (t, opts = {}) => `
    <div class="sync-row">
      <div>
        <div style="font-size:13px;font-weight:600;">${esc(t.customer || 'Queued item')}</div>
        <div class="sync-meta">${esc(t.type || '')}${t.amount ? ' · ' + money(t.amount) : ''} · ${t.created_at ? new Date(t.created_at).toLocaleTimeString() : 'not yet sent'}</div>
        ${t.error_message ? `<div class="sync-meta" style="color:var(--red-500);">${esc(t.error_message)}</div>` : ''}
      </div>
      ${opts.retry ? `<button class="btn btn-secondary btn-sm" data-retry="${esc(t.id)}">Retry</button>` : chip(opts.label, opts.tone)}
    </div>`;
  return `
  <div class="screen">
    <div class="screen-header"><h1>Sync status</h1></div>
    ${!state.online ? banner("Offline — items will retry automatically once you're back online.", 'amber') : ''}
    ${allEmpty ? emptyState('All caught up', 'Nothing pending — every visit outcome has synced to Tally.') : `
      ${queued.length ? `<div class="section-title">Waiting for connection</div><div class="card">${queued.map((q) => row({ type: q.body.type, amount: q.body.amount }, { label: 'Queued', tone: 'amber' })).join('')}</div>` : ''}
      ${failed.length ? `<div class="section-title">Failed</div><div class="card">${failed.map((t) => row(t, { retry: true })).join('')}</div>` : ''}
      ${pending.length ? `<div class="section-title">Pending</div><div class="card">${pending.map((t) => row(t, { label: 'Pending', tone: 'amber' })).join('')}</div>` : ''}
      ${synced.length ? `<div class="section-title">Synced</div><div class="card">${synced.map((t) => row(t, { label: 'Synced', tone: 'green' })).join('')}</div>` : ''}
    `}
  </div>`;
}
async function loadSyncStatus() {
  syncCache = null;
  const queued = await window.TallyFieldQueue.all();
  let server = { field_transactions: [] };
  try { server = await apiJson('GET', '/field-transactions/list.php'); } catch (e) { /* offline — queue still shown */ }
  syncCache = {
    synced: server.field_transactions.filter((t) => t.sync_status === 'synced'),
    pending: server.field_transactions.filter((t) => t.sync_status === 'pending'),
    failed: server.field_transactions.filter((t) => t.sync_status === 'failed'),
    queued: queued.filter((q) => q.status === 'pending'),
  };
  if (state.screen === 'sync-status') rerenderScreenBody();
}
function wireSyncStatus() {
  loadSyncStatus();
  document.addEventListener('click', function retryHandler(e) {
    const btn = e.target.closest('[data-retry]');
    if (!btn) return;
    apiJson('POST', '/field-transactions/retry.php', { id: btn.dataset.retry })
      .then(() => { showToast('Retrying sync…'); loadSyncStatus(); })
      .catch(() => showToast('Retry failed — check your connection'));
  }, { once: true });
}

/* ================================================================
   SCREEN 7 — OWNER DASHBOARD
   ================================================================ */
let dashboardCache = null;
function screenOwnerDashboard() {
  if (!dashboardCache) return `<div class="screen-wide">${skeletonCards()}</div>`;
  const d = dashboardCache;
  return `
  <div class="screen-wide">
    <div class="screen-header"><h1>Dashboard</h1><p class="sub">${new Date().toDateString()}</p></div>
    <div class="kpi-grid">
      <div class="kpi-tile"><div class="label">Total Outstanding</div><div class="value">${money(d.total_outstanding)}</div></div>
      <div class="kpi-tile"><div class="label">Collected Today</div><div class="value">${money(d.collected_today)}</div></div>
      <div class="kpi-tile"><div class="label">Visits Today</div><div class="value">${d.visits_today}</div></div>
      <div class="kpi-tile"><div class="label">Active Reps</div><div class="value">${d.active_reps}</div></div>
    </div>
    <div class="section-title">Activity feed</div>
    <div class="card">
      ${d.activity_feed.length === 0 ? emptyState('No activity yet', 'Nothing logged in the last 7 days.') :
        d.activity_feed.map((f) => `
          <div class="feed-row">
            <div class="avatar">${esc((f.rep || '?').split(' ').map((n) => n[0]).join('').slice(0, 2))}</div>
            <div><div style="font-size:13px;"><strong>${esc(f.rep)}</strong> logged a ${esc(f.action)}${f.amount ? ' of ' + money(f.amount) : ''} at ${esc(f.customer)}</div>
            <div class="sync-meta">${new Date(f.at).toLocaleString()}</div></div>
          </div>`).join('')}
    </div>
  </div>`;
}
async function loadOwnerDashboard() {
  dashboardCache = null;
  try { dashboardCache = await apiJson('GET', '/owner/dashboard.php'); }
  catch (e) { showToast('Could not load dashboard'); dashboardCache = { total_outstanding: 0, collected_today: 0, visits_today: 0, active_reps: 0, activity_feed: [] }; }
  if (state.screen === 'owner-dashboard') rerenderScreenBody();
}
function wireOwnerDashboard() { loadOwnerDashboard(); }

/* ================================================================
   RENDER DISPATCH
   ================================================================ */
const screens = {
  'login': { html: screenLogin, wire: wireLogin },
  'rep-home': { html: screenRepHome, wire: wireRepHome },
  'customer-detail': { html: screenCustomerDetail, wire: wireCustomerDetail },
  'checkin': { html: screenCheckIn, wire: wireCheckIn },
  'log-outcome': { html: screenLogOutcome, wire: wireLogOutcome },
  'sync-status': { html: screenSyncStatus, wire: wireSyncStatus },
  'owner-dashboard': { html: screenOwnerDashboard, wire: wireOwnerDashboard },
};
function renderScreenHtml() { return screens[state.screen].html(); }
function wireScreen() { screens[state.screen].wire(); }
function rerenderScreenBody() { document.getElementById('main').innerHTML = renderScreenHtml(); wireScreen(); }

function render() {
  renderTopbar();
  renderBottomNav();
  document.getElementById('main').innerHTML = renderScreenHtml();
  wireScreen();
  paintToast();
}

/* ---------------- connectivity + queue flushing ---------------- */
window.addEventListener('offline', () => { state.online = false; renderTopbar(); });
window.addEventListener('online', () => {
  state.online = true; renderTopbar();
  window.TallyFieldQueue.flush(api).then(() => { if (state.screen === 'sync-status') loadSyncStatus(); });
});

/* ---------------- boot ---------------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
}
if (state.token) window.TallyFieldQueue.flush(api);
render();

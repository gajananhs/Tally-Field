// ============================================================
// TallyField — mock.js
// Stands in for the PHP/MySQL API so the app runs as a pure static
// site on GitHub Pages. Same call shape as the real api()/apiJson()
// in the backend-connected build (public/app.js), so app.js above
// this file doesn't need to know the difference — swap this file
// for a real fetch()-based transport when a backend is available.
// All "server" state lives in localStorage under MOCK_DB_KEY.
// ============================================================

const MOCK_DB_KEY = 'tf_mock_db';
const MOCK_LATENCY = 350; // ms — feels like a real network without being slow

function seedDb() {
  return {
    tenant: { id: 't1', name: 'Canares Automation Pvt Ltd', tally_company: 'Canares Group of Company' },
    users: {
      '9000000000': { id: 'u_owner1', name: 'Gajanan', role: 'owner' },
      '9000000001': { id: 'u_rep1', name: 'Suresh K.', role: 'rep' },
    },
    tally_parties: {
      c1: { balance: 84200, last_synced_at: new Date().toISOString() },
      c2: { balance: 0, last_synced_at: new Date().toISOString() },
      c3: { balance: 216500, last_synced_at: new Date().toISOString() },
    },
    customers: [
      { id: 'c1', name: 'Bharat Filtration Co.', address: 'Peenya Industrial Area, Bangalore', assigned_rep_id: 'u_rep1' },
      { id: 'c2', name: 'Shree Valves & Fittings', address: 'Dabaspet, Bangalore', assigned_rep_id: 'u_rep1' },
      { id: 'c3', name: 'Konkan Pneumatics', address: 'Hubli Industrial Estate', assigned_rep_id: 'u_rep1' },
    ],
    visits: [], // { id, rep_id, customer_id, scheduled_date, status, checkin_time }
    field_transactions: [], // { id, client_ref, visit_id, type, amount, items_json, sync_status, created_at }
  };
}

function loadDb() {
  try {
    const raw = localStorage.getItem(MOCK_DB_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* fall through to reseed */ }
  const fresh = seedDb();
  saveDb(fresh);
  return fresh;
}
function saveDb(db) { localStorage.setItem(MOCK_DB_KEY, JSON.stringify(db)); }
function today() { return new Date().toISOString().slice(0, 10); }
function uuidMock() {
  return crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

// Mimics a fetch() Response closely enough for app.js and queue.js to
// use unchanged: { ok, status, json() }.
function mockResponse(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}
function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

function currentSessionUser() {
  const raw = localStorage.getItem('tf_user');
  return raw ? JSON.parse(raw) : null;
}

async function mockApi(method, path, body) {
  await delay(MOCK_LATENCY);
  const db = loadDb();
  const url = new URL(path, 'https://mock.local');
  const p = url.pathname;
  const q = Object.fromEntries(url.searchParams);
  const user = currentSessionUser();

  // ---- auth ----
  if (p === '/auth/send-otp.php') {
    if (!/^[6-9]\d{9}$/.test(body.phone || '')) return mockResponse(422, { error: 'phone_invalid', message: 'Enter a valid 10-digit number' });
    return mockResponse(200, { sent: true });
  }
  if (p === '/auth/verify-otp.php') {
    if (!/^\d{4,6}$/.test(body.otp || '')) return mockResponse(422, { error: 'otp_invalid', message: 'Wrong code, try again' });
    // Demo shortcut: any correctly-formatted OTP is accepted. Known demo
    // numbers get their seeded identity; any other valid phone becomes a
    // fresh demo rep so the flow works for any number a visitor tries.
    const known = db.users[body.phone];
    const identity = known || { id: 'u_demo_' + body.phone, name: 'Demo Rep', role: 'rep' };
    if (!known) {
      db.users[body.phone] = identity;
      db.customers.filter((c) => c.assigned_rep_id === 'u_rep1').forEach((c) => {}); // demo rep shares the seeded customer list
      saveDb(db);
    }
    const token = 'mock-' + uuidMock();
    return mockResponse(200, { token, user: { id: identity.id, name: identity.name, role: identity.role }, tenant_id: db.tenant.id });
  }
  if (p === '/auth/logout.php') return mockResponse(200, { ok: true });

  // ---- visits ----
  if (p === '/visits/list.php') {
    const date = q.date || today();
    const repId = user?.id === 'u_owner1' ? 'u_rep1' : (user?.id || 'u_rep1');
    const visits = db.visits.filter((v) => v.scheduled_date === date && v.rep_id === repId);
    const seen = new Set(visits.map((v) => v.customer_id));
    const planned = db.customers
      .filter((c) => c.assigned_rep_id === 'u_rep1' && !seen.has(c.id))
      .map((c) => ({ id: 'virtual_' + c.id, status: 'not_visited', checkin_time: null, customer_id: c.id }));
    const all = [...visits, ...planned].map((v) => {
      const c = db.customers.find((cc) => cc.id === v.customer_id);
      const tp = db.tally_parties[v.customer_id];
      return { id: v.id, status: v.status, customer_id: c.id, customer_name: c.name, address: c.address, balance: tp?.balance ?? null };
    });
    return mockResponse(200, { visits: all });
  }
  if (p === '/visits/checkin.php') {
    if (!body.photo_base64 || body.photo_base64.length <= 4_000_000) {
      const existing = db.visits.find((v) => v.customer_id === body.customer_id && v.rep_id === (user?.id || 'u_rep1') && v.scheduled_date === today());
      if (existing) {
        existing.status = 'checked_in'; existing.checkin_time = new Date().toISOString();
        saveDb(db);
        return mockResponse(200, { id: existing.id, status: 'checked_in' });
      }
      const id = uuidMock();
      db.visits.push({ id, rep_id: user?.id || 'u_rep1', customer_id: body.customer_id, scheduled_date: today(), status: 'checked_in', checkin_time: new Date().toISOString() });
      saveDb(db);
      return mockResponse(201, { id, status: 'checked_in' });
    }
    return mockResponse(413, { error: 'photo_too_large', message: 'Photo is too large — try a lower-resolution shot' });
  }

  // ---- customers ----
  if (p === '/customers/get.php') {
    const c = db.customers.find((cc) => cc.id === q.id);
    if (!c) return mockResponse(404, { error: 'customer_not_found' });
    const tp = db.tally_parties[c.id];
    return mockResponse(200, { id: c.id, name: c.name, address: c.address, balance: tp?.balance ?? null, last_synced_at: tp?.last_synced_at ?? null });
  }

  // ---- field transactions ----
  if (p === '/field-transactions/create.php') {
    if (!body.client_ref) return mockResponse(422, { error: 'client_ref_required' });
    const existing = db.field_transactions.find((t) => t.client_ref === body.client_ref);
    if (existing) return mockResponse(200, { id: existing.id, sync_status: existing.sync_status });
    if (body.type === 'collection' && (!body.amount || body.amount <= 0)) return mockResponse(422, { error: 'amount_invalid', message: 'Enter a valid amount' });
    if (body.type === 'order' && (!body.items_json || !body.items_json.length)) return mockResponse(422, { error: 'items_required', message: 'Add at least one item' });

    const visit = db.visits.find((v) => v.id === body.visit_id) || db.visits.find((v) => v.customer_id === body.visit_id);
    const id = uuidMock();
    const customerName = db.customers.find((c) => c.id === (visit?.customer_id))?.name || 'Customer';
    db.field_transactions.unshift({
      id, client_ref: body.client_ref, visit_id: visit?.id || body.visit_id, customer: customerName,
      type: body.type, amount: body.amount ?? null, sync_status: 'pending', created_at: new Date().toISOString(),
    });
    if (visit) visit.status = 'completed';
    saveDb(db);

    // Simulate the Tally sync agent picking this up a couple of seconds later.
    setTimeout(() => {
      const d = loadDb();
      const t = d.field_transactions.find((x) => x.id === id);
      if (t) { t.sync_status = 'synced'; saveDb(d); }
    }, 2200);

    return mockResponse(201, { id, sync_status: 'pending', created_at: new Date().toISOString() });
  }
  if (p === '/field-transactions/list.php') {
    return mockResponse(200, { field_transactions: db.field_transactions });
  }
  if (p === '/field-transactions/retry.php') {
    const t = db.field_transactions.find((x) => x.id === body.id);
    if (!t || t.sync_status !== 'failed') return mockResponse(404, { error: 'not_found' });
    t.sync_status = 'pending'; delete t.error_message;
    saveDb(db);
    setTimeout(() => { const d = loadDb(); const tt = d.field_transactions.find((x) => x.id === body.id); if (tt) { tt.sync_status = 'synced'; saveDb(d); } }, 1800);
    return mockResponse(200, { id: t.id, sync_status: 'pending' });
  }

  // ---- owner dashboard ----
  if (p === '/owner/dashboard.php') {
    const totalOutstanding = Object.values(db.tally_parties).reduce((s, p) => s + p.balance, 0);
    const isToday = (iso) => iso && iso.slice(0, 10) === today();
    const collectedToday = db.field_transactions.filter((t) => t.type === 'collection' && isToday(t.created_at)).reduce((s, t) => s + (t.amount || 0), 0);
    const visitsToday = db.visits.filter((v) => v.scheduled_date === today()).length;
    const activeReps = new Set(db.visits.filter((v) => v.scheduled_date === today() && v.status !== 'not_visited').map((v) => v.rep_id)).size || (visitsToday ? 1 : 0);
    const feed = db.field_transactions.slice(0, 20).map((t) => ({ rep: 'Suresh K.', action: t.type, customer: t.customer, amount: t.amount, at: t.created_at }));
    return mockResponse(200, { total_outstanding: totalOutstanding, collected_today: collectedToday, visits_today: visitsToday, active_reps: activeReps, activity_feed: feed });
  }

  return mockResponse(404, { error: 'not_found' });
}

window.TallyFieldMockApi = mockApi;

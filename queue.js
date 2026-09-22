// ============================================================
// TallyField — offline queue
// Every write that must survive a dead connection (check-in, log
// outcome) goes through this queue instead of calling fetch() directly.
// Each entry carries a client-generated idempotency key so a retried
// request never creates a duplicate row server-side (see
// api/field-transactions/create.php's client_ref handling).
// ============================================================

const DB_NAME = 'tallyfield';
const DB_VERSION = 1;
const STORE = 'outbox';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'clientRef' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

const Queue = {
  // Enqueue a write. `path`/`body` are the eventual fetch target; `clientRef`
  // becomes the idempotency key so a replay is safe on the server too.
  async enqueue(path, body) {
    const clientRef = uuid();
    const entry = { clientRef, path, body: { ...body, client_ref: clientRef }, status: 'pending', createdAt: Date.now() };
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    return entry;
  },

  async all() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async remove(clientRef) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(clientRef);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  },

  async markFailed(clientRef, message) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.get(clientRef);
      req.onsuccess = () => {
        const entry = req.result;
        if (entry) {
          entry.status = 'failed';
          entry.error = message;
          store.put(entry);
        }
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  },

  // Try to send every queued entry. Call this on app start and on the
  // browser's 'online' event. A network failure leaves the entry queued
  // for the next attempt; a server-side rejection (4xx) marks it failed
  // so the Sync Status screen can show it for manual retry.
  async flush(apiCall) {
    const entries = await Queue.all();
    for (const entry of entries) {
      if (entry.status === 'failed') continue; // needs explicit user retry
      try {
        const res = await apiCall(entry.path, entry.body);
        if (res.ok) {
          await Queue.remove(entry.clientRef);
        } else if (res.status >= 400 && res.status < 500) {
          const body = await res.json().catch(() => ({}));
          await Queue.markFailed(entry.clientRef, body.message || 'Rejected by server');
        }
        // 5xx / network error: leave pending, try again next flush
      } catch (e) {
        // offline or network error — leave queued
      }
    }
  },
};

window.TallyFieldQueue = Queue;

/**
 * Per-session store for the trained WebGazer model (browser IndexedDB only,
 * never uploaded). WebGazer's own saveDataAcrossSessions persists only from
 * its built-in click listener, which GALS removes (it also trained on every
 * mouse move), and it restores data from earlier sessions — other lighting
 * and seating. Keeping the current session's model here lets a reload
 * continue with this session's calibration and nothing older.
 */
const DB = 'gals-gaze';
const STORE = 'models';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const r = fn(db.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}

export async function saveGazeModel(sessionId: string, data: unknown[]): Promise<void> {
  try {
    // Drop other sessions' models: only the current one is ever restored.
    await tx('readwrite', (s) => s.clear());
    await tx('readwrite', (s) => s.put(data, sessionId));
  } catch {
    // storage unavailable (private window, quota): calibration still works this page
  }
}

export async function loadGazeModel(sessionId: string): Promise<unknown[] | null> {
  try {
    const v = await tx<unknown>('readonly', (s) => s.get(sessionId));
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

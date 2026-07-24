// offlineCache.js — Caché local (IndexedDB) para lectura sin conexión.
// Guarda "instantáneas" (snapshots) de listas —pacientes, servicios, etc.—
// bajo una clave, y las devuelve cuando no hay red. Sin dependencias externas.
// Respaldo automático en localStorage si IndexedDB no está disponible.

const DB_NOMBRE = "urosearch-offline";
const STORE = "snapshots";
const VERSION = 1;

let _dbPromise = null;
function abrirDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB no disponible")); return; }
    const req = indexedDB.open(DB_NOMBRE, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

// Guarda una instantánea. Nunca lanza: si algo falla, cae a localStorage.
export async function guardarSnapshot(clave, datos) {
  try {
    const db = await abrirDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ datos, guardado: Date.now() }, clave);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    try {
      localStorage.setItem("uro_snap_" + clave, JSON.stringify({ datos, guardado: Date.now() }));
      return true;
    } catch { return false; }
  }
}

// Devuelve los datos guardados (o null). Nunca lanza.
export async function leerSnapshot(clave) {
  try {
    const db = await abrirDB();
    const val = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).get(clave);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    if (val && "datos" in val) return val.datos;
  } catch {
    try {
      const raw = localStorage.getItem("uro_snap_" + clave);
      if (raw) return JSON.parse(raw).datos;
    } catch {}
  }
  return null;
}

// Momento (ms epoch) en que se guardó la instantánea, o null.
export async function edadSnapshot(clave) {
  try {
    const db = await abrirDB();
    const val = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).get(clave);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    if (val && val.guardado) return val.guardado;
  } catch {
    try {
      const raw = localStorage.getItem("uro_snap_" + clave);
      if (raw) return JSON.parse(raw).guardado || null;
    } catch {}
  }
  return null;
}

// Borra toda la caché offline (útil al cerrar sesión).
export async function limpiarSnapshots() {
  try {
    const db = await abrirDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
  try {
    Object.keys(localStorage).filter(k => k.startsWith("uro_snap_")).forEach(k => localStorage.removeItem(k));
  } catch {}
}

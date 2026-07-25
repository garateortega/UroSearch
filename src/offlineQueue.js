// offlineQueue.js — Cola de escrituras hechas sin conexión, para reintentar al reconectar.
// Compacta y sin dependencias. Guarda en localStorage.
const KEY = "uro_outbox";

function leer() { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } }
function escribir(arr) { try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch {} }

export function encolar(op, args) {
  const arr = leer();
  arr.push({ id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, op, args, ts: Date.now() });
  escribir(arr);
}

export function pendientesCount() { return leer().length; }

// handlers: { [op]: async (args) => ({ ok }) }. Elimina de la cola los que se procesan OK.
export async function procesarCola(handlers) {
  let arr = leer();
  if (!arr.length) return 0;
  let ok = 0;
  for (const item of [...arr]) {
    const h = handlers[item.op];
    if (!h) continue;
    try {
      const r = await h(item.args);
      if (r && r.ok) { arr = arr.filter(x => x.id !== item.id); ok++; }
    } catch { /* sigue offline: se mantiene para el próximo intento */ }
  }
  escribir(arr);
  return ok;
}

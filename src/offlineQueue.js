// offlineQueue.js -- Cola de escrituras hechas sin conexion, para reintentar al reconectar.
// Compacta, sin dependencias, con dedupe y limite de reintentos. Guarda en localStorage.
const KEY = "uro_outbox";
const MAX_REINTENTOS = 8;

function leer() { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } }
function escribir(arr) { try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch {} }

// Clave para deduplicar: misma op + mismos argumentos relevantes.
function claveDedupe(op, args) {
  try {
    if (op === "crearEvolucion") return `ev:${args.pacienteId}:${args.tipo}:${(args.texto || "").slice(0, 120)}`;
    if (op === "crearExamen") return `ex:${args.pacienteId}:${args.datos?.nombre}:${args.datos?.fecha_examen}:${JSON.stringify(args.datos?.datos_estructurados || {}).slice(0, 120)}`;
  } catch {}
  return `${op}:${JSON.stringify(args).slice(0, 160)}`;
}

export function encolar(op, args) {
  const arr = leer();
  const clave = claveDedupe(op, args);
  if (arr.some(x => x.clave === clave)) return; // ya está en cola, no duplicar
  arr.push({ id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, op, args, clave, intentos: 0, ts: Date.now() });
  escribir(arr);
}

export function pendientesCount() { return leer().length; }

// handlers: { [op]: async (args) => ({ ok }) }. Quita los que se procesan OK
// y descarta los que superan MAX_REINTENTOS (para que la cola no crezca sin fin).
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
      else {
        arr = arr.map(x => x.id === item.id ? { ...x, intentos: (x.intentos || 0) + 1 } : x)
                 .filter(x => (x.intentos || 0) < MAX_REINTENTOS);
      }
    } catch {
      arr = arr.map(x => x.id === item.id ? { ...x, intentos: (x.intentos || 0) + 1 } : x)
               .filter(x => (x.intentos || 0) < MAX_REINTENTOS);
    }
  }
  escribir(arr);
  return ok;
}

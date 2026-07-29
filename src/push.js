// ============================================================
// UroSearch — Notificaciones push en el celular (cliente)
// Ubicación: src/push.js
//
// Registra el service worker, pide permiso y guarda la suscripción en
// Supabase. El envío lo hace la edge function "enviar-push", disparada por
// un trigger cuando se inserta una fila en `notificaciones`.
// ============================================================
import { supabase } from "./supabase";

const VAPID_PUBLICA = import.meta.env.VITE_VAPID_PUBLIC_KEY;

// ¿El dispositivo/navegador soporta push?
export function pushSoportado() {
  return typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
}

// En iOS, el push SOLO funciona si la app está instalada en la pantalla de inicio.
export function esIOS() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
export function estaInstalada() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
}

export function estadoPermiso() {
  if (!pushSoportado()) return "no-soportado";
  return Notification.permission; // "granted" | "denied" | "default"
}

const base64ToUint8 = (base64) => {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

async function registrarSW() {
  // Carpeta propia → scope /push/, para no chocar con el SW de la PWA.
  return navigator.serviceWorker.register("/push/sw.js", { scope: "/push/" });
}

// Espera a que el service worker quede ACTIVO.
// Ojo: no se puede usar navigator.serviceWorker.ready, porque esa promesa espera
// a un worker que controle la página (scope "/"), y el nuestro vive en "/push/":
// nunca controla la página y la espera no terminaría jamás.
function esperarActivo(reg, ms = 10000) {
  return new Promise((resolve, reject) => {
    if (reg.active) return resolve(reg);
    const sw = reg.installing || reg.waiting;
    if (!sw) return resolve(reg);
    const tope = setTimeout(() => reject(new Error("El service worker tardó demasiado en activarse.")), ms);
    sw.addEventListener("statechange", () => {
      if (sw.state === "activated") { clearTimeout(tope); resolve(reg); }
      if (sw.state === "redundant") { clearTimeout(tope); reject(new Error("El service worker falló al instalarse.")); }
    });
  });
}

// Activa las notificaciones para este usuario en este dispositivo
export async function activarPush(userId) {
  if (!pushSoportado()) return { ok: false, error: "Este navegador no soporta notificaciones push." };
  if (esIOS() && !estaInstalada()) {
    return { ok: false, error: "En iPhone primero debes agregar UroSearch a la pantalla de inicio (Compartir → Agregar a inicio) y abrirla desde ahí." };
  }
  if (!VAPID_PUBLICA) return { ok: false, error: "Falta configurar VITE_VAPID_PUBLIC_KEY." };

  try {
    const permiso = await Notification.requestPermission();
    if (permiso !== "granted") {
      return { ok: false, error: permiso === "denied"
        ? "Bloqueaste las notificaciones. Habilítalas en los ajustes del navegador para este sitio."
        : "No se concedió el permiso." };
    }

    const reg = await esperarActivo(await registrarSW());

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ToUint8(VAPID_PUBLICA),
      });
    }

    const json = sub.toJSON();
    const { error } = await supabase.from("push_subscriptions").upsert({
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent.slice(0, 250),
    }, { onConflict: "endpoint" });
    if (error) throw error;

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

// Desactiva las notificaciones en este dispositivo
export async function desactivarPush(userId) {
  try {
    const reg = await navigator.serviceWorker.getRegistration("/push/");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      await sub.unsubscribe();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

// ¿Este dispositivo ya está suscrito?
export async function pushActivo() {
  if (!pushSoportado() || Notification.permission !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/push/");
    return !!(await reg?.pushManager.getSubscription());
  } catch { return false; }
}

// Notificación de prueba (local, sin pasar por el servidor)
export async function probarPush() {
  const reg = await navigator.serviceWorker.getRegistration("/push/");
  if (!reg) return { ok: false, error: "Primero activa las notificaciones." };
  await reg.showNotification("UroSearch", {
    body: "Las notificaciones están funcionando en este dispositivo.",
    icon: "/uros/cabeza.webp",   // imagen grande: SOLO la cara de Uros
    badge: "/badge-uros.png",    // ícono chico monocromo junto al nombre (logo UroSearch, no la campana genérica)
    vibrate: [60, 40, 60],
  });
  return { ok: true };
}

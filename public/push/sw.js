// ============================================================
// UroSearch — Service Worker de notificaciones push
// Ubicación: public/push/sw.js  (se sirve como /push/sw.js, scope /push/)
//
// Este archivo decide CÓMO se ve la notificación en el celular. El ícono
// grande siempre es la cara de Uros y el badge (ícono chico monocromo del
// status bar) su silueta — sin importar qué mande el servidor.
// ============================================================

// Íconos fijos: la cara de Uros. Si el payload trae otro icon/badge, se ignora.
const ICONO = "/uros/cabeza-192.png";        // imagen grande de la notificación
const BADGE = "/uros/cabeza-badge-72.png";   // ícono chico (se tiñe monocromo)

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  // El payload lo manda la edge function "enviar-push". Toleramos JSON o texto plano.
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { title: "UroSearch", body: event.data ? event.data.text() : "" }; }

  const titulo = data.title || "UroSearch";
  const opciones = {
    body: data.body || "",
    icon: ICONO,           // ← siempre la cara de Uros
    badge: BADGE,          // ← siempre la silueta de Uros
    vibrate: data.vibrate || [60, 40, 60],
    tag: data.tag || undefined,          // agrupa/reemplaza notificaciones del mismo tipo
    renotify: !!data.tag,
    data: { url: data.url || "/", ...(data.data || {}) },
  };

  event.waitUntil(self.registration.showNotification(titulo, opciones));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientes) => {
      // Si ya hay una ventana de la app abierta, la enfocamos.
      for (const c of clientes) {
        if ("focus" in c) { c.navigate?.(destino); return c.focus(); }
      }
      // Si no, abrimos una nueva.
      if (self.clients.openWindow) return self.clients.openWindow(destino);
    })
  );
});

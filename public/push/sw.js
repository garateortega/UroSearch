// ============================================================
// UroSearch — Service Worker de notificaciones push
// Ubicación: public/push/sw.js   (se sirve como /push/sw.js)
//
// Va en su propia carpeta a propósito: así su "scope" es /push/ y no
// interfiere con el service worker de la PWA (si existe), que vive en /.
// ============================================================

self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Llega un push desde el servidor
self.addEventListener("push", (event) => {
  let datos = {};
  try { datos = event.data ? event.data.json() : {}; } catch { datos = { texto: event.data?.text() || "" }; }

  const icono = {
    cirugia: "🔪", paciente: "🛏️", pendiente: "✅",
    logbook: "📓", interconsulta: "📄", general: "🔔",
  }[datos.tipo] || "🔔";

  const titulo = datos.titulo || `${icono} UroSearch`;
  const cuerpo = (datos.texto || "Tienes una notificación nueva").slice(0, 300);

  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: cuerpo,
      icon: "/uros/hero.webp",
      badge: "/icons/badge-72.png",
      tag: datos.tipo || "general",   // agrupa las del mismo tipo
      renotify: true,
      data: { url: datos.url || "/" },
      vibrate: [60, 40, 60],
    })
  );
});

// Al tocar la notificación: abre la app (o enfoca la pestaña si ya está abierta)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((lista) => {
      for (const cliente of lista) {
        if ("focus" in cliente) return cliente.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(destino);
    })
  );
});

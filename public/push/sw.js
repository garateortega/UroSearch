// ============================================================
// UroSearch — Service Worker de notificaciones push
// Ubicación: public/push/sw.js  (se sirve como /push/sw.js, scope /push/)
//
// Este archivo decide CÓMO se ve la notificación en el celular. El ícono
// grande siempre es la CARA REDONDA de Uros y el badge (ícono chico
// monocromo del status bar) su silueta — sin importar qué mande el
// servidor: si el payload trae icon/badge propios, se ignoran.
// ============================================================

// Candidatos de ícono, en orden de preferencia. Se usa el primero que
// exista realmente en el sitio; así el ícono no desaparece si el archivo
// se llama distinto de lo esperado (esa era la causa de que saliera la
// campana genérica de Android en vez de la cara de Uros).
// v2.1.0b — cabeza.webp primero: es el archivo que la app YA usa con éxito
// dentro del chat (push.js), o sea el único cuya existencia está garantizada.
const CANDIDATOS_ICONO = [
  "/uros/cabeza.webp",
  "/uros/cabeza.png",
  "/uros/cabeza-192.png",
  "/uros/cabeza-192.webp",
  "/icons/icon-192.png",
];
const CANDIDATOS_BADGE = [
  "/uros/cabeza-badge-72.png",
  "/icons/badge-72.png",
  "/uros/cabeza-72.png",
  "/uros/cabeza.png",
];

// Se resuelve una sola vez por ciclo de vida del SW y se recuerda.
let iconoResuelto = null;
let badgeResuelto = null;

async function existe(url) {
  try {
    const r = await fetch(url, { method: "GET", cache: "force-cache" });
    return r && r.ok;
  } catch { return false; }
}

async function primeroQueExista(lista, cacheado) {
  if (cacheado) return cacheado;
  for (const url of lista) {
    if (await existe(url)) return url;
  }
  return lista[0]; // si ninguno responde, se intenta igual con el preferido
}

self.addEventListener("install", () => {
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

  event.waitUntil((async () => {
    iconoResuelto = await primeroQueExista(CANDIDATOS_ICONO, iconoResuelto);
    badgeResuelto = await primeroQueExista(CANDIDATOS_BADGE, badgeResuelto);

    const opciones = {
      body: data.body || "",
      icon: iconoResuelto,   // ← siempre la cara de Uros
      badge: badgeResuelto,  // ← siempre la silueta de Uros
      vibrate: data.vibrate || [60, 40, 60],
      tag: data.tag || undefined,          // agrupa/reemplaza notificaciones del mismo tipo
      renotify: !!data.tag,
      data: { url: data.url || "/", ...(data.data || {}) },
    };
    await self.registration.showNotification(titulo, opciones);
  })());
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

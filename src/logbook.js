// ============================================================
// LOGBOOK QUIRÚRGICO — helpers de Supabase
// Mismo patrón que ./cirugias, ./pacientes, etc.
// ============================================================
import { supabase } from "./supabase";

export async function listarLogbook(userId) {
  try {
    const { data, error } = await supabase
      .from("logbook_cirugias")
      .select("*")
      .eq("user_id", userId)
      .order("fecha", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) return { ok: false, error: error.message };
    return { ok: true, registros: data || [] };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Columnas agregadas después de la creación de la tabla. Si la migración
// todavía no se ha corrido en la base, el insert/update falla nombrando la
// columna; en ese caso se quita y se reintenta, para que la app siga
// funcionando (solo se pierde ese dato hasta ejecutar el SQL).
const COLUMNAS_OPCIONALES = ["momento_complicacion"];

function columnaFaltante(mensaje) {
  const m = (mensaje || "").toLowerCase();
  return COLUMNAS_OPCIONALES.find((c) => m.includes(c)) || null;
}

export async function crearRegistroLogbook(datos) {
  try {
    let payload = datos;
    for (let intento = 0; intento <= COLUMNAS_OPCIONALES.length; intento++) {
      const { data, error } = await supabase
        .from("logbook_cirugias")
        .insert(payload)
        .select()
        .single();
      if (!error) return { ok: true, registro: data };
      const falta = columnaFaltante(error.message);
      if (!falta) return { ok: false, error: error.message };
      const { [falta]: _omitida, ...resto } = payload;
      payload = resto;
    }
    return { ok: false, error: "No se pudo guardar el registro." };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function actualizarRegistroLogbook(id, datos) {
  try {
    let payload = datos;
    for (let intento = 0; intento <= COLUMNAS_OPCIONALES.length; intento++) {
      const { data, error } = await supabase
        .from("logbook_cirugias")
        .update(payload)
        .eq("id", id)
        .select()
        .single();
      if (!error) return { ok: true, registro: data };
      const falta = columnaFaltante(error.message);
      if (!falta) return { ok: false, error: error.message };
      const { [falta]: _omitida, ...resto } = payload;
      payload = resto;
    }
    return { ok: false, error: "No se pudo actualizar el registro." };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function eliminarRegistroLogbook(id) {
  try {
    const { error } = await supabase.from("logbook_cirugias").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Sube la foto comprimida (Blob JPEG) al bucket privado. Devuelve el path.
export async function subirFotoLogbook(userId, blob) {
  try {
    const path = `${userId}/${Date.now()}.jpg`;
    const { error } = await supabase.storage
      .from("logbook-fotos")
      .upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (error) return { ok: false, error: error.message };
    return { ok: true, path };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// URL firmada temporal (1 h) para ver una foto del bucket privado.
export async function obtenerUrlFoto(path) {
  try {
    const { data, error } = await supabase.storage
      .from("logbook-fotos")
      .createSignedUrl(path, 3600);
    if (error) return { ok: false, error: error.message };
    return { ok: true, url: data.signedUrl };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function eliminarFotoLogbook(path) {
  try {
    if (!path) return { ok: true };
    const { error } = await supabase.storage.from("logbook-fotos").remove([path]);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
// ============================================================
// LOGBOOK DE EQUIPO
// Al guardar una cirugía, si un compañero de equipo también participó
// (aparece como cirujano o ayudante), se agrega a SU logbook con su rol.
// ============================================================

// Compañeros (id + nombre) de todos los equipos indicados, sin duplicar y sin mí.
export async function listarCompanerosEquipo(equipoIds, miId) {
  try {
    if (!equipoIds || equipoIds.length === 0) return { ok: true, companeros: [] };
    const { data, error } = await supabase
      .from("miembros_equipo")
      .select("user_id, perfiles(id, nombre)")
      .in("equipo_id", equipoIds);
    if (error) return { ok: false, error: error.message };
    const map = new Map();
    (data || []).forEach((m) => {
      const p = m.perfiles;
      const id = p?.id || m.user_id;
      if (id && id !== miId && !map.has(id)) map.set(id, { id, nombre: p?.nombre || "" });
    });
    return { ok: true, companeros: Array.from(map.values()) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Agrega el registro al logbook de un compañero (RPC con permisos/dedup en la base).
// Devuelve { ok, id } — id null si no se agregó (duplicado o no comparten equipo).
export async function agregarLogbookACompanero(targetUserId, datos) {
  try {
    const { data, error } = await supabase.rpc("logbook_agregar_companero", {
      target_user: targetUserId,
      datos,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

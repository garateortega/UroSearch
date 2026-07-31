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

export async function crearRegistroLogbook(datos) {
  try {
    const { data, error } = await supabase
      .from("logbook_cirugias")
      .insert(datos)
      .select()
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, registro: data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function actualizarRegistroLogbook(id, datos) {
  try {
    const { data, error } = await supabase
      .from("logbook_cirugias")
      .update(datos)
      .eq("id", id)
      .select()
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, registro: data };
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

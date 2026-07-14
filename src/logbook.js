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
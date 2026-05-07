import { supabase } from './supabase';

// ============================================================
// CONOCIMIENTO
// ============================================================

export async function listarConocimiento() {
  const { data, error } = await supabase
    .from('conocimiento')
    .select('*')
    .order('fecha_creacion', { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, conocimiento: data || [] };
}

export async function crearConocimiento(autorId, datos) {
  const { data, error } = await supabase
    .from('conocimiento')
    .insert({
      autor_id: autorId,
      titulo: datos.titulo,
      categoria: datos.categoria || 'Guías clínicas',
      contenido: datos.contenido,
      tags: datos.tags || null,
    })
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, item: data };
}

export async function eliminarConocimiento(id) {
  const { error } = await supabase.from('conocimiento').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ============================================================
// VIDEOS
// ============================================================

export async function listarVideos() {
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .order('fecha_creacion', { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, videos: data || [] };
}

export async function crearVideo(autorId, datos) {
  const { data, error } = await supabase
    .from('videos')
    .insert({
      autor_id: autorId,
      titulo: datos.titulo,
      url: datos.url,
      categoria: datos.categoria || 'General',
      descripcion: datos.descripcion || null,
    })
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, video: data };
}

export async function eliminarVideo(id) {
  const { error } = await supabase.from('videos').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
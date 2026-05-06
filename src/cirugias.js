import { supabase } from './supabase';

// ============================================================
// CIRUGÍAS
// ============================================================

export async function listarCirugias(userId, contexto) {
  let query = supabase.from('cirugias').select('*').order('fecha', { ascending: true }).order('hora', { ascending: true });

  if (contexto === "personal") {
    query = query.eq('cirujano_id', userId).is('equipo_id', null);
  } else {
    query = query.eq('equipo_id', contexto);
  }

  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };
  return { ok: true, cirugias: data || [] };
}

export async function crearCirugia(datos) {
  const { data, error } = await supabase.from('cirugias').insert(datos).select().single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, cirugia: data };
}

export async function crearCirugiasBulk(filas) {
  const { data, error } = await supabase.from('cirugias').insert(filas).select();
  if (error) return { ok: false, error: error.message };
  return { ok: true, cirugias: data || [] };
}

export async function actualizarCirugia(cirugiaId, cambios) {
  const { data, error } = await supabase
    .from('cirugias')
    .update({ ...cambios, fecha_actualizacion: new Date().toISOString() })
    .eq('id', cirugiaId)
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, cirugia: data };
}

export async function eliminarCirugia(cirugiaId) {
  const { error } = await supabase.from('cirugias').delete().eq('id', cirugiaId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ============================================================
// PENDIENTES
// ============================================================

export async function listarPendientes(userId, contexto) {
  let query = supabase.from('pendientes').select('*, autor:perfiles!autor_id(nombre)').order('fecha_creacion', { ascending: false });

  if (contexto === "personal") {
    query = query.eq('autor_id', userId).is('equipo_id', null);
  } else {
    query = query.eq('equipo_id', contexto);
  }

  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };
  return { ok: true, pendientes: data || [] };
}

export async function crearPendiente(datos) {
  const { data, error } = await supabase
    .from('pendientes')
    .insert(datos)
    .select('*, autor:perfiles!autor_id(nombre)')
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, pendiente: data };
}

export async function actualizarPendiente(pendienteId, cambios) {
  const update = { ...cambios };
  if (cambios.estado === 'completado' && !cambios.fecha_completado) {
    update.fecha_completado = new Date().toISOString();
  }
  if (cambios.estado === 'pendiente') {
    update.fecha_completado = null;
  }
  const { data, error } = await supabase
    .from('pendientes')
    .update(update)
    .eq('id', pendienteId)
    .select('*, autor:perfiles!autor_id(nombre)')
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, pendiente: data };
}

export async function eliminarPendiente(pendienteId) {
  const { error } = await supabase.from('pendientes').delete().eq('id', pendienteId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
import { supabase } from './supabase';

// Listar todos mis equipos (donde soy dueño o miembro)
export async function listarMisEquipos() {
  const { data, error } = await supabase
    .from('equipos')
    .select('*, miembros_equipo(user_id, rol_equipo)')
    .order('fecha_creacion', { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, equipos: data || [] };
}

// Crear un equipo (el trigger agrega automáticamente al dueño como miembro)
export async function crearEquipo(userId, nombre, descripcion) {
  const { data, error } = await supabase
    .from('equipos')
    .insert({ dueno_id: userId, nombre, descripcion: descripcion || null })
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, equipo: data };
}

// Eliminar equipo (solo dueño)
export async function eliminarEquipo(equipoId) {
  const { error } = await supabase.from('equipos').delete().eq('id', equipoId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Listar miembros de un equipo (con datos de perfil)
export async function listarMiembros(equipoId) {
  const { data, error } = await supabase
    .from('miembros_equipo')
    .select('*, perfiles(id, nombre, correo, especialidad)')
    .eq('equipo_id', equipoId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, miembros: data || [] };
}

// Salir del equipo (uno mismo)
export async function salirDelEquipo(equipoId, userId) {
  const { error } = await supabase
    .from('miembros_equipo')
    .delete()
    .eq('equipo_id', equipoId)
    .eq('user_id', userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Expulsar miembro (solo dueño)
export async function expulsarMiembro(equipoId, userId) {
  return await salirDelEquipo(equipoId, userId);
}

// Buscar usuario por correo (para invitar)
export async function buscarUsuarioPorCorreo(correo) {
  const { data, error } = await supabase
    .from('perfiles')
    .select('id, nombre, correo, especialidad, estado')
    .eq('correo', correo.trim().toLowerCase())
    .single();
  if (error) return { ok: false, error: 'Usuario no encontrado' };
  return { ok: true, usuario: data };
}

// Crear invitación
export async function crearInvitacion(equipoId, invitadoId, invitadoPor) {
  const { data, error } = await supabase
    .from('invitaciones')
    .insert({ equipo_id: equipoId, invitado_id: invitadoId, invitado_por: invitadoPor })
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, invitacion: data };
}

// Listar invitaciones pendientes para mí
export async function listarMisInvitaciones() {
  const { data, error } = await supabase
    .from('invitaciones')
    .select('*, equipos(id, nombre, descripcion), invitador:perfiles!invitado_por(nombre)')
    .eq('estado', 'pendiente');
  if (error) return { ok: false, error: error.message };
  return { ok: true, invitaciones: data || [] };
}

// Aceptar invitación: marca aceptada + agrega miembro
export async function aceptarInvitacion(invitacionId, equipoId, userId) {
  await supabase
    .from('invitaciones')
    .update({ estado: 'aceptada', fecha_respuesta: new Date().toISOString() })
    .eq('id', invitacionId);
  const { error } = await supabase
    .from('miembros_equipo')
    .insert({ equipo_id: equipoId, user_id: userId, rol_equipo: 'miembro' });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Rechazar invitación
export async function rechazarInvitacion(invitacionId) {
  const { error } = await supabase
    .from('invitaciones')
    .update({ estado: 'rechazada', fecha_respuesta: new Date().toISOString() })
    .eq('id', invitacionId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Listar invitaciones pendientes de un equipo (para ver quién falta)
export async function listarInvitacionesEquipo(equipoId) {
  const { data, error } = await supabase
    .from('invitaciones')
    .select('*, perfiles!invitado_id(nombre, correo)')
    .eq('equipo_id', equipoId)
    .eq('estado', 'pendiente');
  if (error) return { ok: false, error: error.message };
  return { ok: true, invitaciones: data || [] };
}
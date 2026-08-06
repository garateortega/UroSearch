import { supabase } from './supabase';

// Devuelve el id del usuario autenticado (o null si no hay sesión).
async function miId() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id || null;
}

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

// ────────────────────────────────────────────────────────────────
// Buscar usuario por correo (para invitar)
//
// Antes se consultaba directamente perfiles.correo, y fallaba con
// "Usuario no encontrado" en dos escenarios muy frecuentes:
//   1. El RLS de perfiles no deja leer el perfil de OTRO usuario.
//   2. El perfil no tiene el correo copiado, o lo tiene con otra
//      capitalización/espacios respecto de lo que se escribió.
// Ahora se pregunta primero a la RPC buscar_perfil_por_correo
// (SECURITY DEFINER, compara contra auth.users.email en minúsculas),
// y solo si esa RPC no existe todavía se usa el camino antiguo.
// ────────────────────────────────────────────────────────────────
export async function buscarUsuarioPorCorreo(correo) {
  const limpio = (correo || '').trim().toLowerCase();
  if (!limpio) return { ok: false, error: 'Ingresa un correo' };

  const { data, error } = await supabase.rpc('buscar_perfil_por_correo', { p_correo: limpio });
  if (!error) {
    const u = Array.isArray(data) ? data[0] : data;
    if (u) return { ok: true, usuario: u };
    return { ok: false, error: 'No hay ningún usuario de UroSearch registrado con ese correo' };
  }

  // Camino antiguo (por si la RPC aún no está creada en la base)
  const { data: fila, error: e2 } = await supabase
    .from('perfiles')
    .select('id, nombre, correo, especialidad, estado')
    .ilike('correo', limpio)
    .maybeSingle();
  if (e2) return { ok: false, error: 'No se pudo buscar el correo: ' + e2.message };
  if (!fila) return { ok: false, error: 'No hay ningún usuario de UroSearch registrado con ese correo' };
  return { ok: true, usuario: fila };
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

// ────────────────────────────────────────────────────────────────
// Listar invitaciones pendientes PARA MÍ
//
// Bug corregido: no se filtraba por invitado_id, así que el RLS del
// dueño del equipo devolvía también las invitaciones que YO ENVIÉ.
// Resultado: al dueño le aparecía para siempre el aviso
// "Invitado por <él mismo>" hasta que el otro aceptara.
// ────────────────────────────────────────────────────────────────
export async function listarMisInvitaciones() {
  const uid = await miId();
  if (!uid) return { ok: true, invitaciones: [] };
  const { data, error } = await supabase
    .from('invitaciones')
    .select('*, equipos(id, nombre, descripcion), invitador:perfiles!invitado_por(nombre)')
    .eq('invitado_id', uid)
    .eq('estado', 'pendiente');
  if (error) return { ok: false, error: error.message };
  // Segundo filtro defensivo por si alguna política ampliara el resultado
  return { ok: true, invitaciones: (data || []).filter(i => i.invitado_id === uid) };
}

// ────────────────────────────────────────────────────────────────
// Aceptar invitación
//
// Antes se hacía UPDATE + INSERT sueltos y el error del UPDATE se
// ignoraba: si el RLS no dejaba al invitado marcar la invitación como
// aceptada, quedaba "pendiente" para siempre y el aviso reaparecía en
// cada carga. Ahora se usa una RPC SECURITY DEFINER que hace ambas
// cosas juntas, con fallback al camino antiguo.
// ────────────────────────────────────────────────────────────────
export async function aceptarInvitacion(invitacionId, equipoId, userId) {
  const { error } = await supabase.rpc('responder_invitacion', {
    p_invitacion_id: invitacionId,
    p_respuesta: 'aceptada',
  });
  if (!error) return { ok: true };

  // Fallback: camino antiguo, pero verificando el resultado del UPDATE
  const { data: upd, error: eUpd } = await supabase
    .from('invitaciones')
    .update({ estado: 'aceptada', fecha_respuesta: new Date().toISOString() })
    .eq('id', invitacionId)
    .select('id');
  if (eUpd) return { ok: false, error: eUpd.message };
  if (!upd || upd.length === 0) {
    return { ok: false, error: 'No se pudo marcar la invitación como aceptada (permisos). Falta ejecutar la migración de invitaciones.' };
  }
  const { error: eIns } = await supabase
    .from('miembros_equipo')
    .insert({ equipo_id: equipoId, user_id: userId, rol_equipo: 'miembro' });
  // 23505 = ya era miembro; no es un error real
  if (eIns && eIns.code !== '23505') return { ok: false, error: eIns.message };
  return { ok: true };
}

// Rechazar invitación
export async function rechazarInvitacion(invitacionId) {
  const { error } = await supabase.rpc('responder_invitacion', {
    p_invitacion_id: invitacionId,
    p_respuesta: 'rechazada',
  });
  if (!error) return { ok: true };

  const { data: upd, error: eUpd } = await supabase
    .from('invitaciones')
    .update({ estado: 'rechazada', fecha_respuesta: new Date().toISOString() })
    .eq('id', invitacionId)
    .select('id');
  if (eUpd) return { ok: false, error: eUpd.message };
  if (!upd || upd.length === 0) {
    return { ok: false, error: 'No se pudo rechazar la invitación (permisos). Falta ejecutar la migración de invitaciones.' };
  }
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

// Cancelar una invitación que yo envié (deja de aparecerle al invitado)
export async function cancelarInvitacion(invitacionId) {
  const { error } = await supabase.from('invitaciones').delete().eq('id', invitacionId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

import { supabase } from './supabase';

// ============================================================
// PACIENTES
// ============================================================

// Listar pacientes según contexto
// contexto: "personal" => solo míos sin equipo
// contexto: <equipoId> => pacientes de ese equipo
export async function listarPacientes(userId, contexto) {
  let query = supabase
    .from('pacientes')
    .select('*')
    .order('fecha_creacion', { ascending: false });

  if (contexto === "personal") {
    query = query.eq('medico_id', userId).is('equipo_id', null);
  } else {
    query = query.eq('equipo_id', contexto);
  }

  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };
  return { ok: true, pacientes: data || [] };
}

// Crear paciente
export async function crearPaciente(datos) {
  const { data, error } = await supabase
    .from('pacientes')
    .insert(datos)
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, paciente: data };
}

// Actualizar paciente
export async function actualizarPaciente(pacienteId, cambios) {
  const { data, error } = await supabase
    .from('pacientes')
    .update({ ...cambios, fecha_actualizacion: new Date().toISOString() })
    .eq('id', pacienteId)
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, paciente: data };
}

// Eliminar paciente
export async function eliminarPaciente(pacienteId) {
  const { error } = await supabase.from('pacientes').delete().eq('id', pacienteId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ============================================================
// EVOLUCIONES
// ============================================================

export async function listarEvoluciones(pacienteId) {
  const { data, error } = await supabase
    .from('evoluciones')
    .select('*, autor:perfiles!autor_id(nombre)')
    .eq('paciente_id', pacienteId)
    .order('fecha_evolucion', { ascending: false })
    .order('hora_evolucion', { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, evoluciones: data || [] };
}

export async function crearEvolucion(pacienteId, autorId, texto, tipo = 'libre') {
  const { data, error } = await supabase
    .from('evoluciones')
    .insert({
      paciente_id: pacienteId,
      autor_id: autorId,
      texto: texto,
      tipo: tipo,
    })
    .select('*, autor:perfiles!autor_id(nombre)')
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, evolucion: data };
}

export async function eliminarEvolucion(evolucionId) {
  const { error } = await supabase.from('evoluciones').delete().eq('id', evolucionId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ============================================================
// EXAMENES
// ============================================================

export async function listarExamenes(pacienteId) {
  const { data, error } = await supabase
    .from('examenes')
    .select('*, autor:perfiles!autor_id(nombre)')
    .eq('paciente_id', pacienteId)
    .order('fecha_examen', { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, examenes: data || [] };
}

export async function crearExamen(pacienteId, autorId, datos) {
  const { data, error } = await supabase
    .from('examenes')
    .insert({
      paciente_id: pacienteId,
      autor_id: autorId,
      tipo: datos.tipo,
      nombre: datos.nombre,
      resultado: datos.resultado || null,
      fecha_examen: datos.fecha_examen,
      datos_estructurados: datos.datos_estructurados || {},
    })
    .select('*, autor:perfiles!autor_id(nombre)')
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, examen: data };
}

export async function eliminarExamen(examenId) {
  const { error } = await supabase.from('examenes').delete().eq('id', examenId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ============================================================
// SERVICIOS DEL USUARIO
// ============================================================

export async function listarMisServicios(userId) {
  const { data, error } = await supabase
    .from('servicios_usuario')
    .select('*')
    .eq('user_id', userId)
    .order('orden', { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, servicios: data || [] };
}

export async function crearServicio(userId, nombre) {
  const { data, error } = await supabase
    .from('servicios_usuario')
    .insert({ user_id: userId, nombre: nombre.trim() })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'Ese servicio ya existe' };
    return { ok: false, error: error.message };
  }
  return { ok: true, servicio: data };
}

export async function eliminarServicio(servicioId) {
  const { error } = await supabase.from('servicios_usuario').delete().eq('id', servicioId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Crear varios servicios de una vez (configuración inicial)
export async function crearServiciosBulk(userId, nombres) {
  const filas = nombres.map((nombre, i) => ({ 
    user_id: userId, 
    nombre: nombre.trim(), 
    orden: i 
  }));
  const { data, error } = await supabase
    .from('servicios_usuario')
    .insert(filas)
    .select();
  if (error) return { ok: false, error: error.message };
  return { ok: true, servicios: data || [] };
}

// ── Servicios propios del EQUIPO (tabla servicios_equipo) ──
// Todos los miembros ven y editan la misma lista, sin depender de sus
// servicios personales. Devuelve objetos {id, nombre, orden} como los personales.
export async function listarServiciosEquipo(equipoId) {
  const { data, error } = await supabase
    .from('servicios_equipo')
    .select('*')
    .eq('equipo_id', equipoId)
    .order('orden', { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, servicios: data || [] };
}

export async function crearServicioEquipo(equipoId, userId, nombre, orden = 0) {
  const { data, error } = await supabase
    .from('servicios_equipo')
    .insert({ equipo_id: equipoId, creado_por: userId, nombre: nombre.trim(), orden })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'Ese servicio ya existe en el equipo' };
    return { ok: false, error: error.message };
  }
  return { ok: true, servicio: data };
}

export async function eliminarServicioEquipo(servicioId) {
  const { error } = await supabase.from('servicios_equipo').delete().eq('id', servicioId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Guarda el orden de TODOS los servicios del equipo (compartido para todos los miembros).
// Recibe la lista ya reordenada [{id,...}] y persiste el índice en la columna "orden".
export async function reordenarServiciosEquipo(servicios) {
  const updates = servicios.map((s, i) =>
    supabase.from('servicios_equipo').update({ orden: i }).eq('id', s.id)
  );
  const results = await Promise.all(updates);
  const err = results.find(r => r.error);
  if (err) return { ok: false, error: err.error.message };
  return { ok: true };
}

export async function crearServiciosEquipoBulk(equipoId, userId, nombres) {
  const filas = nombres.map((nombre, i) => ({
    equipo_id: equipoId, creado_por: userId, nombre: nombre.trim(), orden: i,
  }));
  const { data, error } = await supabase
    .from('servicios_equipo')
    .insert(filas)
    .select();
  if (error) return { ok: false, error: error.message };
  return { ok: true, servicios: data || [] };
}

// Migración puntual: copia al equipo los servicios personales que le pasen,
// evitando duplicar los que ya existan en el equipo.
export async function migrarServiciosAlEquipo(equipoId, userId, nombres) {
  const { data: existentes } = await supabase
    .from('servicios_equipo').select('nombre').eq('equipo_id', equipoId);
  const yaHay = new Set((existentes || []).map(s => s.nombre.toLowerCase()));
  const nuevos = nombres.filter(n => n && !yaHay.has(n.trim().toLowerCase()));
  if (nuevos.length === 0) return { ok: true, servicios: [], migrados: 0 };
  const base = existentes?.length || 0;
  const filas = nuevos.map((nombre, i) => ({
    equipo_id: equipoId, creado_por: userId, nombre: nombre.trim(), orden: base + i,
  }));
  const { data, error } = await supabase.from('servicios_equipo').insert(filas).select();
  if (error) return { ok: false, error: error.message };
  return { ok: true, servicios: data || [], migrados: (data || []).length };
}
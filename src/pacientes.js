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

// Servicios que ven todos los miembros del equipo (unión de servicios de cada miembro)
export async function listarServiciosEquipo(equipoId) {
  // Primero obtener los user_ids de los miembros
  const { data: miembros, error: errMiembros } = await supabase
    .from('miembros_equipo')
    .select('user_id')
    .eq('equipo_id', equipoId);
  if (errMiembros) return { ok: false, error: errMiembros.message };
  
  const userIds = (miembros || []).map(m => m.user_id);
  if (userIds.length === 0) return { ok: true, servicios: [] };

  const { data, error } = await supabase
    .from('servicios_usuario')
    .select('nombre')
    .in('user_id', userIds);
  if (error) return { ok: false, error: error.message };
  
  // Deduplicar nombres
  const unicos = Array.from(new Set((data || []).map(s => s.nombre)));
  return { ok: true, servicios: unicos };
}
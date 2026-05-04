import { supabase } from './supabase';

/**
 * Lista todas las conversaciones del usuario actual, ordenadas por fecha (más recientes primero).
 *
 * @returns { ok: true, conversaciones } | { ok: false, error }
 */
export async function listarConversaciones() {
  try {
    const { data, error } = await supabase
      .from('conversaciones')
      .select('id, titulo, modo_default, fecha_creacion, fecha_actualizacion')
      .order('fecha_actualizacion', { ascending: false });

    if (error) return { ok: false, error: error.message };
    return { ok: true, conversaciones: data || [] };
  } catch (err) {
    return { ok: false, error: 'Error al cargar conversaciones' };
  }
}

/**
 * Crea una conversación nueva.
 *
 * @param userId UUID del usuario actual
 * @param titulo Título inicial (puede ser actualizado después)
 * @param modoDefault "precisa" | "explicativa"
 * @returns { ok: true, conversacion } | { ok: false, error }
 */
export async function crearConversacion(userId, titulo, modoDefault = 'precisa') {
  try {
    const { data, error } = await supabase
      .from('conversaciones')
      .insert({
        user_id: userId,
        titulo: titulo || 'Nueva conversación',
        modo_default: modoDefault,
      })
      .select()
      .single();

    if (error) return { ok: false, error: error.message };
    return { ok: true, conversacion: data };
  } catch (err) {
    return { ok: false, error: 'Error al crear conversación' };
  }
}

/**
 * Carga todos los mensajes de una conversación, en orden cronológico.
 *
 * @param conversacionId UUID de la conversación
 * @returns { ok: true, mensajes } | { ok: false, error }
 */
export async function cargarMensajes(conversacionId) {
  try {
    const { data, error } = await supabase
      .from('mensajes')
      .select('*')
      .eq('conversacion_id', conversacionId)
      .order('fecha_creacion', { ascending: true });

    if (error) return { ok: false, error: error.message };
    
    // Adaptar al formato que usa el chat (role: "user" | "assistant", content: string)
    const mensajesAdaptados = (data || []).map(m => ({
      role: m.rol === 'usuario' ? 'user' : 'assistant',
      content: m.contenido,
      mode: m.modo,
    }));
    
    return { ok: true, mensajes: mensajesAdaptados };
  } catch (err) {
    return { ok: false, error: 'Error al cargar mensajes' };
  }
}

/**
 * Agrega un mensaje a una conversación.
 *
 * @param conversacionId UUID de la conversación
 * @param userId UUID del usuario (necesario por RLS, aunque sea mensaje del asistente)
 * @param rol "usuario" | "asistente"
 * @param contenido Texto del mensaje
 * @param modo "precisa" | "explicativa" | null
 * @returns { ok: true, mensaje } | { ok: false, error }
 */
export async function agregarMensaje(conversacionId, userId, rol, contenido, modo = null) {
  try {
    const { data, error } = await supabase
      .from('mensajes')
      .insert({
        conversacion_id: conversacionId,
        user_id: userId,
        rol: rol,
        contenido: contenido,
        modo: modo,
      })
      .select()
      .single();

    if (error) return { ok: false, error: error.message };

    // También actualizamos fecha_actualizacion de la conversación para que aparezca arriba en la lista
    await supabase
      .from('conversaciones')
      .update({ fecha_actualizacion: new Date().toISOString() })
      .eq('id', conversacionId);

    return { ok: true, mensaje: data };
  } catch (err) {
    return { ok: false, error: 'Error al guardar mensaje' };
  }
}

/**
 * Actualiza el título de una conversación.
 * Útil para auto-titular usando las primeras palabras del primer mensaje.
 *
 * @param conversacionId UUID
 * @param nuevoTitulo Texto del título
 */
export async function actualizarTitulo(conversacionId, nuevoTitulo) {
  try {
    const { error } = await supabase
      .from('conversaciones')
      .update({ titulo: nuevoTitulo })
      .eq('id', conversacionId);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'Error al actualizar título' };
  }
}

/**
 * Elimina una conversación completa (y por cascade, todos sus mensajes).
 *
 * @param conversacionId UUID
 */
export async function eliminarConversacion(conversacionId) {
  try {
    const { error } = await supabase
      .from('conversaciones')
      .delete()
      .eq('id', conversacionId);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'Error al eliminar conversación' };
  }
}

/**
 * Genera un título automático a partir del primer mensaje del usuario.
 * Toma las primeras 5-7 palabras y agrega "..." si fue truncado.
 *
 * @param texto Texto del mensaje
 * @returns String con el título (max ~50 caracteres)
 */
export function generarTituloDesdeMensaje(texto) {
  if (!texto || !texto.trim()) return 'Nueva conversación';
  
  const limpio = texto.trim().replace(/\s+/g, ' '); // quita espacios extras
  const palabras = limpio.split(' ');
  const primeras = palabras.slice(0, 7).join(' ');
  
  if (primeras.length > 50) {
    return primeras.substring(0, 47) + '...';
  }
  
  if (palabras.length > 7) {
    return primeras + '...';
  }
  
  return primeras;
}
import { supabase } from './supabase';

/**
 * Lista todos los mapas conceptuales del usuario actual.
 *
 * @returns { ok: true, mapas } | { ok: false, error }
 */
export async function listarMapas() {
  try {
    const { data, error } = await supabase
      .from('mapas_conceptuales')
      .select('*')
      .eq('es_precargado', false)
      .order('fecha_creacion', { ascending: false });

    if (error) return { ok: false, error: error.message };
    return { ok: true, mapas: data || [] };
  } catch (err) {
    return { ok: false, error: 'Error al cargar mapas' };
  }
}

/**
 * Guarda un mapa conceptual en Supabase.
 *
 * @param userId UUID del usuario
 * @param titulo Título del mapa
 * @param tema Tema del mapa (texto breve)
 * @param contenido Objeto JSON con la estructura del mapa
 * @returns { ok: true, mapa } | { ok: false, error }
 */
export async function guardarMapa(userId, titulo, tema, contenido) {
  try {
    const { data, error } = await supabase
      .from('mapas_conceptuales')
      .insert({
        user_id: userId,
        titulo: titulo || 'Mapa sin título',
        tema: tema || null,
        contenido: contenido,
        es_precargado: false,
      })
      .select()
      .single();

    if (error) return { ok: false, error: error.message };
    return { ok: true, mapa: data };
  } catch (err) {
    return { ok: false, error: 'Error al guardar mapa' };
  }
}

/**
 * Elimina un mapa conceptual.
 *
 * @param mapaId UUID del mapa
 */
export async function eliminarMapa(mapaId) {
  try {
    const { error } = await supabase
      .from('mapas_conceptuales')
      .delete()
      .eq('id', mapaId);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'Error al eliminar mapa' };
  }
}
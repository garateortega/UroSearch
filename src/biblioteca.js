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
      fuente: datos.fuente || '',
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
// ════════════════════════════════════════════════════════════════
// FUNCIONES PARA AGREGAR A TU ARCHIVO biblioteca.js
// ════════════════════════════════════════════════════════════════
//
// Copia y pega estas 3 funciones AL FINAL de tu archivo biblioteca.js
// (antes de cualquier "export default" si lo hubiera, o simplemente al final).
//
// IMPORTANTE: tu biblioteca.js ya debe importar el cliente "supabase"
// arriba del archivo (igual que lo usan crearConocimiento, etc.).
// Estas funciones reutilizan ese mismo "supabase".
//
// ────────────────────────────────────────────────────────────────


// Listar todas las preguntas (las más nuevas primero)
export async function listarPreguntas() {
  const { data, error } = await supabase
    .from('preguntas')
    .select('*')
    .order('fecha_creacion', { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, preguntas: data || [] };
}

// Crear una pregunta nueva
export async function crearPregunta(autorId, datos) {
  const { data, error } = await supabase
    .from('preguntas')
    .insert({
      autor_id: autorId,
      enunciado: datos.enunciado,
      alternativas: datos.alternativas,
      correcta: datos.correcta,
      feedback: datos.feedback || '',
      categoria: datos.categoria || 'General',
    })
    .select('*')
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, pregunta: data };
}

// Eliminar una pregunta
export async function eliminarPregunta(preguntaId) {
  const { error } = await supabase.from('preguntas').delete().eq('id', preguntaId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
// ════════════════════════════════════════════════════════════════
// FUNCIONES DE CHUNKS — AGREGAR AL FINAL DE biblioteca.js
// ════════════════════════════════════════════════════════════════
//
// Copia estas 2 funciones al final de tu biblioteca.js.
// Reutilizan el cliente "supabase" que ya está importado arriba.
//
// ────────────────────────────────────────────────────────────────


// Guardar varios chunks de golpe (se llama al subir un documento)
export async function crearChunks(chunks) {
  // chunks = [{ documento_id, titulo, fuente, contenido, orden }, ...]
  const { data, error } = await supabase
    .from('conocimiento_chunks')
    .insert(chunks)
    .select('*');
  if (error) return { ok: false, error: error.message };
  return { ok: true, chunks: data || [] };
}

// Listar todos los chunks (el chat los usa para buscar)
export async function listarChunks() {
  const { data, error } = await supabase
    .from('conocimiento_chunks')
    .select('*')
    .order('fecha_creacion', { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, chunks: data || [] };
}


// ════════════════════════════════════════════════════════════════
// NOTA sobre borrar documentos:
// Como la tabla conocimiento_chunks tiene ON DELETE CASCADE apuntando
// a conocimiento(id), cuando borres un documento con tu función
// eliminarConocimiento existente, sus chunks se borrarán solos
// automáticamente. No necesitas hacer nada extra.
// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
// ADEMÁS: para que la "Fuente / Libro" de los documentos se guarde,
// busca tu función crearConocimiento (ya existente en biblioteca.js)
// y dentro de su .insert({...}) agrega esta línea:
//
//     fuente: datos.fuente || '',
//
// Queda algo así:
//
//   .insert({
//     autor_id: autorId,
//     titulo: datos.titulo,
//     categoria: datos.categoria,
//     contenido: datos.contenido,
//     tags: ...,
//     fuente: datos.fuente || '',     // ← AGREGAR ESTA LÍNEA
//   })
//
// (Solo si quieres la función de agrupar por libro. Si no la agregas,
//  todo lo demás funciona igual, solo que la fuente no se guardará.)
// ════════════════════════════════════════════════════════════════
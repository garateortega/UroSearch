import { supabase } from './supabase';

// ============================================================
// CONOCIMIENTO
// ============================================================

export async function listarConocimiento() {
  // Solo metadatos: NUNCA el campo 'contenido' (puede pesar MB por documento).
  // Se pide length(contenido) como 'caracteres' para mostrar el tamaño sin
  // descargar el texto. El contenido completo se obtiene con obtenerConocimiento().
  const { data, error } = await supabase
    .from('conocimiento')
    .select('id, titulo, categoria, tags, fuente, fecha_creacion, autor_id, caracteres:contenido')
    .order('fecha_creacion', { ascending: false });
  if (error) {
    // Si el proyecto no soporta el alias de length, cae a columnas livianas
    const alt = await supabase
      .from('conocimiento')
      .select('id, titulo, categoria, tags, fuente, fecha_creacion, autor_id')
      .order('fecha_creacion', { ascending: false });
    if (alt.error) return { ok: false, error: alt.error.message };
    return { ok: true, conocimiento: alt.data || [] };
  }
  return { ok: true, conocimiento: data || [] };
}

// Trae el contenido completo de UN documento (solo al abrirlo)
export async function obtenerConocimiento(id) {
  const { data, error } = await supabase
    .from('conocimiento')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, item: data };
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
      dificultad: datos.dificultad || null,
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
    .select('id');  // no devolver el embedding recién insertado (no se usa en el front)
  if (error) return { ok: false, error: error.message };
  return { ok: true, chunks: data || [] };
}

// Listar todos los chunks (el chat los usa para buscar)
export async function listarChunks() {
  // Sin '*': jamás traer el vector de embedding (pesadísimo). Solo texto y metadatos.
  const { data, error } = await supabase
    .from('conocimiento_chunks')
    .select('id, documento_id, titulo, fuente, contenido, orden, fecha_creacion')
    .order('fecha_creacion', { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, chunks: data || [] };
}

// ════════════════════════════════════════════════════════════════
// FUNCIÓN DE BÚSQUEDA EN LA BASE — AGREGAR AL FINAL DE biblioteca.js
// ════════════════════════════════════════════════════════════════
//
// Copia esta función al final de tu biblioteca.js.
// Reutiliza el cliente "supabase" que ya está importado arriba.
//
// Llama a la función SQL buscar_chunks que creaste en Supabase.
// Devuelve solo los fragmentos más relevantes para la consulta,
// buscando entre TODOS los chunks del lado de la base de datos.
// ────────────────────────────────────────────────────────────────

export async function buscarChunks(consulta, limite = 8) {
  const { data, error } = await supabase.rpc('buscar_chunks', {
    consulta: consulta,
    limite: limite,
  });
  if (error) return { ok: false, error: error.message };
  // Solo lo que usa el chat. Si la RPC devuelve el vector de embedding, aquí no viaja.
  const chunks = (data || []).map(c => ({
    id: c.id,
    documento_id: c.documento_id,
    titulo: c.titulo,
    fuente: c.fuente,
    contenido: c.contenido,
    orden: c.orden,
  }));
  return { ok: true, chunks };
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
// ────────────────────────────────────────────────────────────
// PROTOCOLOS (documentos Word/PDF — SOLO el admin sube/edita/elimina)
// ────────────────────────────────────────────────────────────
// Requiere la tabla `protocolos` y el bucket de storage `protocolos`
// (ver protocolos.sql). Los archivos aceptados son PDF y Word; pueden
// tener varias páginas sin problema (se guardan como un solo archivo).
// ────────────────────────────────────────────────────────────

const BUCKET_PROTOCOLOS = 'protocolos';

// Listar todos los protocolos (metadatos, sin descargar el archivo)
export async function listarProtocolos() {
  const { data, error } = await supabase
    .from('protocolos')
    .select('id, titulo, categoria, archivo_nombre, archivo_path, mime, autor_id, fecha_creacion')
    .order('titulo', { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, protocolos: data || [] };
}

// Subir un protocolo (archivo = File de <input type=file>). Solo admin (lo impone la RLS).
export async function crearProtocolo(autorId, { titulo, categoria, archivo }) {
  if (!archivo) return { ok: false, error: 'Falta el archivo.' };
  const ext = (archivo.name.split('.').pop() || 'bin').toLowerCase();
  const permitidas = ['pdf', 'doc', 'docx'];
  if (!permitidas.includes(ext)) return { ok: false, error: 'Formato no permitido. Sube PDF o Word (.pdf, .doc, .docx).' };
  const safe = (titulo || 'protocolo').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 60);
  const path = `${autorId}/${Date.now()}_${safe}.${ext}`;
  const up = await supabase.storage.from(BUCKET_PROTOCOLOS).upload(path, archivo, {
    contentType: archivo.type || undefined, upsert: false,
  });
  if (up.error) return { ok: false, error: up.error.message };
  const { data, error } = await supabase
    .from('protocolos')
    .insert({
      autor_id: autorId,
      titulo: titulo,
      categoria: categoria || 'General',
      archivo_nombre: archivo.name,
      archivo_path: path,
      mime: archivo.type || null,
    })
    .select()
    .single();
  if (error) {
    // Si falla la fila, borra el archivo recién subido para no dejar huérfanos.
    try { await supabase.storage.from(BUCKET_PROTOCOLOS).remove([path]); } catch {}
    return { ok: false, error: error.message };
  }
  return { ok: true, protocolo: data };
}

// Eliminar un protocolo (fila + archivo). Solo admin (lo impone la RLS).
export async function eliminarProtocolo(id, archivoPath) {
  if (archivoPath) { try { await supabase.storage.from(BUCKET_PROTOCOLOS).remove([archivoPath]); } catch {} }
  const { error } = await supabase.from('protocolos').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// URL firmada para abrir/descargar el archivo (válida 1 hora)
export async function urlProtocolo(archivoPath) {
  const { data, error } = await supabase.storage.from(BUCKET_PROTOCOLOS).createSignedUrl(archivoPath, 3600);
  if (error) return { ok: false, error: error.message };
  return { ok: true, url: data.signedUrl };
}

// ============================================================
// FIGURAS DE CAPÍTULOS (pendientes de curar)
// Al subir un capítulo en PDF se detectan los pies de figura
// ("Figura 12-4. Algoritmo…"). Quedan aquí como lista de tareas:
// el admin las recorta desde el mismo PDF en Biblioteca › Imágenes
// y se marcan como curadas. Se borran en cascada con el capítulo.
// ============================================================

export async function crearFigurasCapitulo(figuras) {
  // figuras = [{ documento_id, capitulo, pagina, ref, caption }, ...]
  if (!figuras || figuras.length === 0) return { ok: true, figuras: [] };
  const { data, error } = await supabase
    .from('biblioteca_figuras')
    .insert(figuras)
    .select();
  if (error) return { ok: false, error: error.message };
  return { ok: true, figuras: data || [] };
}

export async function listarFigurasPendientes() {
  const { data, error } = await supabase
    .from('biblioteca_figuras')
    .select('*')
    .eq('curada', false)
    .order('capitulo', { ascending: true })
    .order('pagina', { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, figuras: data || [] };
}

export async function marcarFiguraCurada(id) {
  const { error } = await supabase
    .from('biblioteca_figuras')
    .update({ curada: true })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Descartar una figura detectada que no vale la pena curar (logo, foto, etc.)
export async function eliminarFiguraCapitulo(id) {
  const { error } = await supabase.from('biblioteca_figuras').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

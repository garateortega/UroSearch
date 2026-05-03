import { supabase } from './supabase';

/**
 * Registra un nuevo usuario en Supabase Auth.
 * El trigger automático crea su fila en la tabla `perfiles`
 * con los metadatos enviados (nombre, especialidad, documento_nombre).
 *
 * @returns { ok: true, user } | { ok: false, error: string }
 */
export async function register({ nombre, correo, password, especialidad, documentoNombre }) {
  try {
    const { data, error } = await supabase.auth.signUp({
      email: correo,
      password: password,
      options: {
        data: {
          nombre: nombre,
          especialidad: especialidad,
          documento_nombre: documentoNombre || null,
        },
      },
    });

    if (error) {
      // Errores comunes: usuario ya existe, contraseña débil, email inválido
      if (error.message.includes('already registered') || error.message.includes('already exists')) {
        return { ok: false, error: 'Ya existe una cuenta con ese correo' };
      }
      if (error.message.includes('Password')) {
        return { ok: false, error: 'La contraseña no cumple con los requisitos (mínimo 6 caracteres)' };
      }
      if (error.message.includes('Email')) {
        return { ok: false, error: 'Correo electrónico inválido' };
      }
      return { ok: false, error: error.message };
    }

    return { ok: true, user: data.user };
  } catch (err) {
    return { ok: false, error: 'Error de conexión. Intenta de nuevo.' };
  }
}

/**
 * Inicia sesión con email y contraseña.
 *
 * @returns { ok: true, user } | { ok: false, error: string }
 */
export async function login({ correo, password }) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: correo,
      password: password,
    });

    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        return { ok: false, error: 'Correo o contraseña incorrectos' };
      }
      if (error.message.includes('Email not confirmed')) {
        return { ok: false, error: 'Tu correo aún no ha sido confirmado' };
      }
      return { ok: false, error: error.message };
    }

    return { ok: true, user: data.user };
  } catch (err) {
    return { ok: false, error: 'Error de conexión. Intenta de nuevo.' };
  }
}

/**
 * Cierra la sesión actual.
 */
export async function logout() {
  try {
    await supabase.auth.signOut();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Obtiene el perfil completo del usuario desde la tabla `perfiles`.
 * Esto incluye nombre, rol, estado, especialidad, etc.
 *
 * @param userId UUID del usuario (auth.uid())
 * @returns { ok: true, perfil } | { ok: false, error: string }
 */
export async function getPerfil(userId) {
  try {
    const { data, error } = await supabase
      .from('perfiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true, perfil: data };
  } catch (err) {
    return { ok: false, error: 'Error al cargar el perfil' };
  }
}

/**
 * Obtiene la sesión actual (si el usuario ya estaba logeado).
 * Útil al cargar la app por primera vez.
 *
 * @returns { ok: true, session } | { ok: false, error: string }
 */
export async function getSession() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return { ok: false, error: error.message };
    return { ok: true, session: data.session };
  } catch (err) {
    return { ok: false, error: 'Error al obtener la sesión' };
  }
}

/**
 * Suscribe a cambios de autenticación (login/logout).
 * Devuelve una función para cancelar la suscripción.
 *
 * @param callback Función que recibe (event, session)
 * @returns Función para desuscribir
 */
export function onAuthChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
  return () => data.subscription.unsubscribe();
}
/**
 * Lista todos los perfiles de usuarios.
 * Solo deberían poder ejecutarlo los admins (las políticas RLS lo permiten).
 *
 * @returns { ok: true, perfiles } | { ok: false, error: string }
 */
export async function listarPerfiles() {
  try {
    const { data, error } = await supabase
      .from('perfiles')
      .select('*')
      .order('fecha_registro', { ascending: false });

    if (error) return { ok: false, error: error.message };
    return { ok: true, perfiles: data || [] };
  } catch (err) {
    return { ok: false, error: 'Error al cargar usuarios' };
  }
}

/**
 * Cambia el estado de un usuario (pendiente, aprobado, rechazado).
 *
 * @param userId UUID del usuario
 * @param nuevoEstado "pendiente" | "aprobado" | "rechazado"
 */
export async function cambiarEstadoUsuario(userId, nuevoEstado) {
  try {
    const { error } = await supabase
      .from('perfiles')
      .update({ estado: nuevoEstado })
      .eq('id', userId);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'Error al cambiar estado' };
  }
}

/**
 * Elimina un usuario completamente (de perfiles y auth.users).
 * NOTA: Esto requiere permisos elevados (service_role key) que NO están
 * disponibles desde el frontend por seguridad.
 * Por ahora solo borra de la tabla perfiles. El usuario seguirá existiendo
 * en auth.users pero no podrá acceder a UroSearch.
 *
 * @param userId UUID del usuario
 */
export async function eliminarUsuario(userId) {
  try {
    const { error } = await supabase
      .from('perfiles')
      .delete()
      .eq('id', userId);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'Error al eliminar usuario' };
  }
}
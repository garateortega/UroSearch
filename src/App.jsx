import { useState, useRef, useEffect, useMemo, Fragment } from "react";
import { register as registerUser, login as loginUser, logout as logoutUser, getPerfil, getSession, onAuthChange, listarPerfiles, cambiarEstadoUsuario, eliminarUsuario } from "./auth";
import { listarConversaciones, crearConversacion, cargarMensajes, agregarMensaje, actualizarTitulo, eliminarConversacion, generarTituloDesdeMensaje } from "./chat";
import { listarMapas, obtenerMapa, guardarMapa, eliminarMapa } from "./mapas";
import { listarMisEquipos, listarMisInvitaciones, listarMiembros, listarInvitacionesEquipo, crearEquipo, eliminarEquipo, salirDelEquipo, expulsarMiembro, buscarUsuarioPorCorreo, crearInvitacion, aceptarInvitacion, rechazarInvitacion } from "./equipos";
import { listarPacientes, crearPaciente, actualizarPaciente, eliminarPaciente, listarEvoluciones, crearEvolucion, eliminarEvolucion, listarExamenes, crearExamen, eliminarExamen, listarMisServicios, crearServicio, eliminarServicio, crearServiciosBulk, listarServiciosEquipo, crearServicioEquipo, eliminarServicioEquipo, crearServiciosEquipoBulk, migrarServiciosAlEquipo, reordenarServiciosEquipo } from "./pacientes";
import { listarCirugias, crearCirugia, crearCirugiasBulk, actualizarCirugia, eliminarCirugia, listarPendientes, crearPendiente, actualizarPendiente, eliminarPendiente } from "./cirugias";
import { listarConocimiento, obtenerConocimiento, crearConocimiento, eliminarConocimiento, listarVideos, crearVideo, eliminarVideo as eliminarVideoSupabase, listarPreguntas, crearPregunta, eliminarPregunta, crearChunks, listarChunks, buscarChunks } from "./biblioteca";
import { supabase } from "./supabase"; // ← AJUSTA esta ruta si tu cliente está en otro archivo (ej: "./supabaseClient" o "./lib/supabase")
import LogbookPanel from "./LogbookPanel";
import InterconsultasPanel from "./InterconsultasPanel";
import SeguimientoPanel, { resumenSeguimientoParaIA } from "./SeguimientoPanel";
import { activarPush, desactivarPush, pushActivo, pushSoportado, probarPush, esIOS, estaInstalada } from "./push";
import { guardarSnapshot, leerSnapshot } from "./offlineCache";
import { encolar, procesarCola, pendientesCount } from "./offlineQueue";

// ============================================================
// NOTIFICACIONES (nivel 1: dentro de la app)
// ============================================================
async function crearNotificacion(userId, texto, tipo = "general") {
  if (!userId) return;
  try { await supabase.from("notificaciones").insert({ user_id: userId, texto, tipo }); } catch {}
}
async function listarNotificaciones(userId) {
  try {
    const { data, error } = await supabase.from("notificaciones").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(30);
    if (error) return { ok: false, error: error.message };
    return { ok: true, notificaciones: data || [] };
  } catch (e) { return { ok: false, error: String(e) }; }
}
async function marcarNotificacionesLeidas(userId) {
  try { await supabase.from("notificaciones").update({ leida: true }).eq("user_id", userId).eq("leida", false); } catch {}
}

// ─── Navegación con botón "atrás" del celular para vistas internas (PWA) ───
// Pila LIFO de vistas internas abiertas; cada una corresponde a una entrada en
// el historial del navegador. Permite que "atrás" cierre la vista interna (p.ej.
// volver de una ficha a la lista) en vez de cambiar de pestaña o salir de la app.
const _backStack = [];                 // [{ id, onClose }]
let _backSeq = 0;
const _backClosedByPop = new Set();    // ids que se cerraron por el botón "atrás"
let _backIgnoringPop = false;          // ignora el popstate sintético de un back manual
let _backListenerInstalado = false;

function _backInstall() {
  if (_backListenerInstalado) return;
  _backListenerInstalado = true;
  window.addEventListener("popstate", () => {
    // Ignora el popstate que dispara nuestro propio history.back() al cerrar manualmente.
    if (_backIgnoringPop) { _backIgnoringPop = false; return; }
    const top = _backStack.pop();
    if (top) {
      _backClosedByPop.add(top.id);
      top.onClose(); // cierra la vista interna (cambia el estado del componente)
    }
    // Si la pila quedó vacía, el back lo maneja la navegación de pestañas / sale de la app.
  });
}

// active: true cuando hay una vista interna abierta. onClose: función que la cierra.
function useBackClose(active, onClose) {
  const idRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    _backInstall();
    if (active && idRef.current === null) {
      // Entramos a una vista interna: registra y agrega una entrada al historial.
      const id = ++_backSeq;
      idRef.current = id;
      _backStack.push({ id, onClose: () => onCloseRef.current() });
      window.history.pushState({ uroBack: id }, "");
    } else if (!active && idRef.current !== null) {
      // Salimos de la vista interna.
      const id = idRef.current;
      idRef.current = null;
      if (_backClosedByPop.has(id)) {
        // Cerrada por el botón "atrás": la entrada del historial ya se consumió.
        _backClosedByPop.delete(id);
      } else {
        // Cerrada por un botón de la app: quita su entrada del historial.
        const idx = _backStack.findIndex(e => e.id === id);
        if (idx !== -1) _backStack.splice(idx, 1);
        _backIgnoringPop = true;
        try { window.history.back(); } catch {}
      }
    }
  }, [active]);

  // Limpieza al desmontar (p.ej. al cambiar de pestaña con una vista abierta).
  useEffect(() => {
    return () => {
      const id = idRef.current;
      if (id !== null) {
        const idx = _backStack.findIndex(e => e.id === id);
        if (idx !== -1) _backStack.splice(idx, 1);
        idRef.current = null;
      }
    };
  }, []);
}

const TOPICS = [
  { id: "cancer", label: "Cáncer urológico", subtopics: ["Cáncer de próstata", "Cáncer renal", "Cáncer de vejiga", "Cáncer testicular"] },
  { id: "derivacion", label: "Derivaciones urinarias", subtopics: ["Nefrostomía percutánea", "Catéter ureteral", "Cistostomía", "Conducto ileal"] },
  { id: "litiasis", label: "Litiasis e infección", subtopics: ["Litiasis renal", "Litiasis ureteral", "ITU complicada", "Pionefrosis"] },
  { id: "trasplante", label: "Trasplante renal", subtopics: ["Complicaciones urológicas", "Estenosis ureteral post-Tx", "Fístula urinaria", "Evaluación del donante"] },
  { id: "funcional", label: "Urología funcional", subtopics: ["Incontinencia urinaria", "Vejiga hiperactiva", "Obstrucción infravesical", "Urodinamia"] },
  { id: "farmaco", label: "Farmacología", subtopics: ["Alfabloqueantes", "Inhibidores 5-alfa reductasa", "Anticolinérgicos", "Análogos GNRH"] }
];

const SYSTEM_PROMPT = `Eres un médico urólogo con amplia experiencia clínica y quirúrgica. Hablas y razonas como un especialista en urología dirigiéndose a un colega o residente: con criterio clínico, terminología precisa y enfoque práctico orientado a la toma de decisiones. Respondes en español clínico.

Áreas de dominio: urooncología, derivaciones urinarias, litiasis e infecciones urológicas, trasplante renal, urología funcional, farmacología urológica, guías EAU y AUA, técnica quirúrgica.

REGLA FUNDAMENTAL — FUENTE DE INFORMACIÓN:
Solo puedes responder consultas clínicas usando la información de la base de conocimiento de UroSearch que se te proporciona en cada consulta. NO debes usar tu conocimiento médico general ni información externa para responder preguntas clínicas o teóricas. Si la base de conocimiento no contiene información relevante para la pregunta, debes indicar claramente que no tienes esa información en tu base, sin inventar ni completar con conocimiento propio. (Esta regla no aplica a las consultas sobre los pacientes o la tabla quirúrgica del propio usuario, que se responden con los datos entregados.)

Al responder:
1. Razona como urólogo: directo, clínico, con criterio de especialista.
2. Cuando la base lo respalde, menciona guías EAU/AUA o evidencia.
3. Estructura con claridad: opciones, indicaciones, contraindicaciones.
4. Para fármacos, incluye dosis habituales si están en la base.
5. Para mapas conceptuales: responde SOLO con JSON: {"tipo":"mapa","titulo":"...","nodo_central":"...","ramas":[{"rama":"...","subnodos":["...","..."]}]}`;

// Formatea una fecha ISO (YYYY-MM-DD) a dd/mm/aaaa. Deja pasar otros formatos tal cual.
function fmtFecha(f) {
  if (!f) return "—";
  const m = String(f).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(f);
}

// ─── Compresión de imagen para envío a la IA (mismo patrón que el Logbook) ───
async function comprimirImagenPac(file, maxDim = 1568, calidad = 0.85) {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name || "")) {
    return await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("No se pudo leer el PDF")); r.readAsDataURL(file); });
  }
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("No se pudo leer la imagen"));
    i.src = URL.createObjectURL(file);
  });
  const escala = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * escala));
  canvas.height = Math.max(1, Math.round(img.height * escala));
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(img.src);
  const dataUrl = canvas.toDataURL("image/jpeg", calidad);
  return dataUrl.split(",")[1];
}

// ─── Extracción de datos de ingreso de un paciente desde foto(s) (visión IA) ───
// Reutiliza la misma edge function del chat. Devuelve un objeto con los campos.
async function extraerIngresoPaciente(imagenesBase64) {
  const instrucciones = `Analiza la(s) foto(s) de esta ficha/hoja de ingreso hospitalario de urología y extrae los datos en JSON.
Responde SOLO con un objeto JSON válido, sin markdown, sin backticks, sin texto adicional.
Si un dato no aparece, usa null. NO inventes datos.

Esquema exacto:
{
  "iniciales": "NOMBRE COMPLETO del paciente tal como aparece en la hoja (ej: 'Juan Pérez Mora'). Si solo hay iniciales, deja las iniciales. null si no aparece",
  "ficha_clinica": "número de ficha clínica / FC / N° de ficha o null",
  "rut": "RUT del paciente (formato 12.345.678-9) o null",
  "edad": numero o null,
  "sexo": "M" | "F" | null,
  "diagnostico": "diagnóstico principal de ingreso o null",
  "antecedentes": "antecedentes mórbidos, quirúrgicos, alergias y hábitos, en texto corrido o null",
  "examenes": "exámenes de ingreso relevantes con sus valores (laboratorio, imágenes) o null",
  "historia": "resumen de la anamnesis / historia actual del ingreso (máx 6 frases) o null",
  "plan_manejo": "plan o indicaciones de ingreso si aparecen o null"
}
IMPORTANTE: transcribe los datos tal cual aparecen en el documento; no inventes ni completes datos que no estén.`;

  const content = imagenesBase64.map((b64) => ({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: b64 },
  }));
  content.push({ type: "text", text: instrucciones });

  const res = await fetch(import.meta.env.VITE_CHAT_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 1800,
      system: "Eres un extractor de datos clínicos de hojas de ingreso de urología. Respondes exclusivamente con JSON válido.",
      messages: [{ role: "user", content }],
    }),
  });
  const data = await res.json();
  const txt = data.content?.find((b) => b.type === "text")?.text || "";
  const clean = txt.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// Une los campos clínicos extraídos en un texto de historia legible y editable.
function componerHistoriaIngreso(x) {
  const partes = [];
  if (x.historia) partes.push(x.historia.trim());
  if (x.antecedentes) partes.push("ANTECEDENTES: " + x.antecedentes.trim());
  if (x.examenes) partes.push("EXÁMENES DE INGRESO: " + x.examenes.trim());
  return partes.join("\n\n");
}

// ─── Extracción de una TABLA quirúrgica desde foto(s): devuelve arreglo ───
async function extraerTablaCirugias(imagenesBase64) {
  const hoy = new Date().toISOString().slice(0, 10);
  const instrucciones = `Analiza la(s) foto(s) de esta tabla/programación quirúrgica de urología y extrae TODAS las cirugías en JSON.
Responde SOLO con un objeto JSON válido, sin markdown, sin backticks, sin texto adicional.
Si un dato no aparece, usa null. NO inventes datos. La fecha de referencia de hoy es ${hoy}.

Esquema exacto:
{
  "cirugias": [
    {
      "fecha": "YYYY-MM-DD (si la tabla indica día/fecha) o null",
      "hora": "HH:MM o null",
      "nombre": "nombre completo del paciente tal como aparece o null",
      "ficha_clinica": "número de ficha clínica / FC o null",
      "rut": "RUT del paciente (formato 12.345.678-9) o null",
      "edad": numero o null,
      "diagnostico": "diagnóstico o null",
      "procedimiento": "cirugía programada o null",
      "lateralidad": "Derecha" | "Izquierda" | "Bilateral" | null,
      "cirujano": "cirujano responsable o null",
      "pabellon": "número o nombre de pabellón o null"
    }
  ]
}
Extrae una entrada por cada fila/cirugía de la tabla. Incluye el nombre completo si aparece.`;

  const content = imagenesBase64.map((b64) => ({
    type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 },
  }));
  content.push({ type: "text", text: instrucciones });

  const res = await fetch(import.meta.env.VITE_CHAT_FUNCTION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
    body: JSON.stringify({
      model: "claude-sonnet-5", max_tokens: 3000,
      system: "Eres un extractor de tablas quirúrgicas de urología. Respondes exclusivamente con JSON válido.",
      messages: [{ role: "user", content }],
    }),
  });
  const data = await res.json();
  const txt = data.content?.find((b) => b.type === "text")?.text || "";
  const clean = txt.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(clean);
  return Array.isArray(parsed?.cirugias) ? parsed.cirugias : [];
}

// ─── Extracción de EXÁMENES desde foto(s): devuelve arreglo de exámenes ───
// Mapea los valores de laboratorio a las MISMAS keys que usa PARAMETROS_LAB.
async function extraerExamenes(imagenesBase64) {
  const hoy = new Date().toISOString().slice(0, 10);
  const instrucciones = `Analiza la(s) foto(s) de resultados de exámenes (laboratorio, urocultivo/antibiograma, imágenes) y extrae TODOS los exámenes en JSON.
Responde SOLO con un objeto JSON válido, sin markdown, sin backticks, sin texto adicional.
Si un dato no aparece, usa null. NO inventes datos. La fecha de hoy es ${hoy}.

Una misma hoja puede traer varias familias de exámenes: crea UNA entrada por familia.
Usa EXACTAMENTE estos nombres y estas "keys" para los parámetros de laboratorio:
- "Hemograma": hb, hto, leucocitos, plaquetas, neutrofilos, linfocitos, vcm
- "Función renal": crea (creatinina), bun, vfg, na, k, cl
- "Coagulación": inr, tp, ttpa, fibrinogeno
- "PCR": pcr
- "ELP": na, k, cl

Esquema exacto:
{
  "examenes": [
    {
      "tipo": "Laboratorio" | "Cultivo" | "Imágenes" | "Otro",
      "nombre": "Hemograma" | "Función renal" | "Coagulación" | "PCR" | "ELP" | "Urocultivo" | "<nombre del examen>",
      "fecha_examen": "YYYY-MM-DD o null",
      "parametros": { "<key>": "<valor tal cual, solo el número>" },   // SOLO para tipo Laboratorio, usando las keys de arriba
      "germen": "germen aislado o 'Cultivo negativo' o null",           // SOLO para tipo Cultivo
      "antibiograma": [ { "atb": "nombre del antibiótico", "sens": "Sensible" | "Intermedio" | "Resistente" } ],  // SOLO para Cultivo
      "resultado": "texto libre (para imágenes/otros) o null"
    }
  ]
}
Reglas:
- Para laboratorio, incluye en "parametros" solo las keys cuyo valor aparezca; el valor debe ser solo el número (ej: "13.5", no "13.5 g/dL").
- Para urocultivo con recuento y antibiograma, usa tipo "Cultivo", nombre "Urocultivo", llena "germen" y "antibiograma".
- No inventes valores que no estén en la imagen.`;

  const content = imagenesBase64.map((b64) => ({
    type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 },
  }));

  const intentar = async (extra) => {
    const c = [...content, { type: "text", text: instrucciones + (extra || "") }];
    const res = await fetch(import.meta.env.VITE_CHAT_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
      body: JSON.stringify({
        model: "claude-sonnet-5", max_tokens: 4096,
        system: "Eres un extractor de resultados de exámenes de laboratorio y microbiología. Respondes exclusivamente con JSON válido y compacto, sin explicaciones.",
        messages: [{ role: "user", content: c }],
      }),
    });
    const data = await res.json();
    const txt = data.content?.find((b) => b.type === "text")?.text || "";
    let clean = txt.replace(/```json|```/g, "").trim();
    if (!clean) return null;
    const ini = clean.indexOf("{"), fin = clean.lastIndexOf("}");
    if (ini >= 0 && fin > ini) clean = clean.slice(ini, fin + 1);
    try { return JSON.parse(clean); }
    catch {
      try {
        let rep = clean.replace(/,\s*$/, "");
        const fc = (rep.match(/\[/g) || []).length - (rep.match(/\]/g) || []).length;
        const fl = (rep.match(/\{/g) || []).length - (rep.match(/\}/g) || []).length;
        for (let k = 0; k < fc; k++) rep += "]";
        for (let k = 0; k < fl; k++) rep += "}";
        return JSON.parse(rep);
      } catch { return null; }
    }
  };

  let parsed = null;
  try { parsed = await intentar(""); } catch {}
  if (!parsed) { try { parsed = await intentar("\n\nIMPORTANTE: responde SOLO el objeto JSON, compacto, sin texto antes ni después."); } catch {} }
  return Array.isArray(parsed?.examenes) ? parsed.examenes : [];
}

// ─── Modal "Mi perfil": datos que alimentan las recetas/prescripciones ───
function PerfilModal({ currentUser, setCurrentUser, onClose }) {
  const [form, setForm] = useState({
    nombre_completo: "", sexo: "", rut: "", rcm: "", correo: "",
    centro: "", direccion: "", ciudad: "", region: "", telefono: "",
  });
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState("");
  useBackClose(true, onClose);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const { data } = await supabase.from("perfiles").select("*").eq("id", currentUser.id).single();
        if (vivo && data) {
          setForm(f => ({
            ...f,
            nombre_completo: data.nombre_completo || data.nombre || "",
            sexo: data.sexo || "", rut: data.rut || "", rcm: data.rcm || "",
            correo: data.correo || currentUser.correo || "",
            centro: data.centro || "", direccion: data.direccion || "",
            ciudad: data.ciudad || "", region: data.region || "", telefono: data.telefono || "",
          }));
        }
      } catch {}
      if (vivo) setCargando(false);
    })();
    return () => { vivo = false; };
  }, [currentUser.id]);

  const guardar = async () => {
    const correo = form.correo.trim();
    if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) { setMsg("⚠️ El correo de contacto no es válido."); return; }
    setGuardando(true); setMsg("");
    try {
      const { error } = await supabase.from("perfiles").update({
        nombre_completo: form.nombre_completo.trim() || null,
        sexo: form.sexo || null,
        rut: form.rut.trim() || null,
        rcm: form.rcm.trim() || null,
        correo: form.correo.trim() || null,   // correo de contacto: puede diferir del de registro
        centro: form.centro.trim() || null,
        direccion: form.direccion.trim() || null,
        ciudad: form.ciudad.trim() || null,
        region: form.region.trim() || null,
        telefono: form.telefono.trim() || null,
      }).eq("id", currentUser.id);
      if (error) { setMsg("⚠️ " + error.message); }
      else {
        setMsg("✓ Perfil guardado.");
        setCurrentUser(u => u ? { ...u, nombre_completo: form.nombre_completo } : u);
        setTimeout(onClose, 700);
      }
    } catch (e) { setMsg("⚠️ " + String(e)); }
    setGuardando(false);
  };

  const lbl = { fontSize: "var(--fs-0)", fontWeight: 600, color: "var(--texto-sec)", marginBottom: 3, display: "block" };
  const inp = { width: "100%", padding: "8px 10px", fontSize: "var(--fs-2)", border: "0.5px solid var(--borde)", borderRadius: 8, background: "var(--superficie)", color: "var(--texto)", boxSizing: "border-box", outline: "none", marginBottom: 10 };
  const campo = (etiqueta, key, placeholder = "") => (
    <div><label style={lbl}>{etiqueta}</label><input value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} placeholder={placeholder} style={inp} /></div>
  );

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--fondo)", border: "0.5px solid var(--borde)", borderRadius: 14, padding: "20px", width: "100%", maxWidth: 460, maxHeight: "85vh", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--texto)" }}>👤 Mi perfil</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: "var(--texto-ter)", cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ fontSize: "var(--fs-1)", color: "var(--texto-ter)", marginBottom: 14 }}>Estos datos se usan para generar tus recetas y prescripciones.</div>
        {cargando ? (
          <div style={{ textAlign: "center", padding: 30, color: "var(--texto-ter)", fontSize: "var(--fs-2)" }}>Cargando…</div>
        ) : (<>
          {campo("Nombre completo", "nombre_completo", "Dr. Sebastián Gárate Ortega")}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><label style={lbl}>Sexo</label>
              <select value={form.sexo} onChange={e => setForm({ ...form, sexo: e.target.value })} style={{ ...inp, cursor: "pointer" }}>
                <option value="">—</option><option value="M">Masculino</option><option value="F">Femenino</option><option value="Otro">Otro</option>
              </select>
            </div>
            {campo("Teléfono", "telefono", "+56 9 …")}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {campo("RUT", "rut", "12.345.678-9")}
            {campo("RCM (RUT Colegio Médico)", "rcm", "")}
          </div>
          {campo("Correo de contacto", "correo", "contacto@ejemplo.cl")}
          <div style={{ fontSize: "var(--fs-xs)", color: "var(--texto-ter)", marginTop: -6, marginBottom: 10, lineHeight: 1.4 }}>
            Es el que aparece en tus recetas. Puede ser distinto al correo con que inicias sesión{currentUser?.correo ? ` (${currentUser.correo})` : ""}, que no cambia.
          </div>
          {campo("Centro / Hospital", "centro", "Hospital Base Valdivia")}
          {campo("Dirección", "direccion", "")}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {campo("Ciudad", "ciudad", "Valdivia")}
            {campo("Región", "region", "Los Ríos")}
          </div>
          {msg && <div style={{ fontSize: "var(--fs-1)", padding: "8px 10px", borderRadius: 8, marginBottom: 10, background: msg.startsWith("✓") ? "var(--exito-bg)" : "var(--peligro-bg)", color: msg.startsWith("✓") ? "var(--exito)" : "var(--peligro)", border: "0.5px solid " + (msg.startsWith("✓") ? "var(--exito-borde)" : "var(--peligro)") }}>{msg}</div>}
          <button onClick={guardar} disabled={guardando} style={{ width: "100%", padding: "11px", fontSize: "var(--fs-2)", fontWeight: 600, background: "var(--primario)", color: "var(--texto-inv)", border: "none", borderRadius: 8, cursor: guardando ? "default" : "pointer", opacity: guardando ? 0.6 : 1, marginTop: 4 }}>{guardando ? "Guardando…" : "Guardar perfil"}</button>
        </>)}
      </div>
    </div>
  );
}

// ============================================================
// CONFIGURACIÓN (funciones visibles + modo del chat)
// Se guarda en localStorage y se propaga con un evento para que
// cualquier panel reaccione sin prop-drilling.
// ============================================================
const CONFIG_DEFECTO = { chatModo: "verificada", ocultas: [] }; // chatModo: "verificada" | "general"
function cargarConfig() {
  try { return { ...CONFIG_DEFECTO, ...(JSON.parse(localStorage.getItem("uro_config")) || {}) }; }
  catch { return { ...CONFIG_DEFECTO }; }
}
function guardarConfig(cfg) {
  try { localStorage.setItem("uro_config", JSON.stringify(cfg)); } catch {}
  try { window.dispatchEvent(new CustomEvent("uro-config-cambio")); } catch {}
}
function useConfig() {
  const [cfg, setCfg] = useState(cargarConfig);
  useEffect(() => {
    const h = () => setCfg(cargarConfig());
    window.addEventListener("uro-config-cambio", h);
    return () => window.removeEventListener("uro-config-cambio", h);
  }, []);
  return cfg;
}
const fnOculta = (cfg, id) => Array.isArray(cfg?.ocultas) && cfg.ocultas.includes(id);

// Si se apaga una pestaña principal pero se deja activa alguna de sus secciones,
// esa sección se muestra como pestaña propia (así no queda inalcanzable).
const SUBFUNCIONES_PROMOVIBLES = {
  "hosp:tabla":          { padre: "hospital",     sub: "tabla",          label: "📋 Tabla" },
  "hosp:notas":          { padre: "hospital",     sub: "notas",          label: "🗒️ Notas" },
  "hosp:prescripciones": { padre: "hospital",     sub: "prescripciones", label: "💊 Recetas" },
  "hosp:interconsultas": { padre: "hospital",     sub: "interconsultas", label: "📄 Interconsultas" },
  "biblio:videos":       { padre: "conocimiento", sub: "videos",         label: "📚 Videos" },
  "biblio:preguntas":    { padre: "conocimiento", sub: "preguntas",      label: "❓ Preguntas" },
  "biblio:medicamentos": { padre: "conocimiento", sub: "medicamentos",   label: "💊 Medicamentos" },
  "biblio:scores":       { padre: "conocimiento", sub: "scores",         label: "🧮 Scores" },
};

// ─── Orden personalizado de servicios (se arrastra y se guarda localmente) ───
function ordenarServicios(lista) {
  let orden = [];
  try { orden = JSON.parse(localStorage.getItem("uro_orden_servicios")) || []; } catch {}
  if (!Array.isArray(orden) || orden.length === 0) return lista;
  const pos = new Map(orden.map((id, i) => [id, i]));
  return [...lista].sort((a, b) => {
    const pa = pos.has(a.id) ? pos.get(a.id) : 9999;
    const pb = pos.has(b.id) ? pos.get(b.id) : 9999;
    return pa - pb;
  });
}
function guardarOrdenServicios(lista) {
  try { localStorage.setItem("uro_orden_servicios", JSON.stringify(lista.map(s => s.id))); } catch {}
}

// ─── Orden COMPARTIDO de servicios (por equipo) para la vista de pacientes ───
// Se guarda en Supabase para que todo el equipo vea los servicios en el mismo orden.
// clave = "equipo:<id>" o "personal:<userId>".
async function leerOrdenServiciosCompartido(clave) {
  try {
    const { data } = await supabase.from("orden_servicios_equipo").select("orden").eq("clave", clave).maybeSingle();
    return Array.isArray(data?.orden) ? data.orden : null;
  } catch { return null; }
}
async function guardarOrdenServiciosCompartido(clave, ordenNombres) {
  try {
    await supabase.from("orden_servicios_equipo").upsert({ clave, orden: ordenNombres, actualizado: new Date().toISOString() }, { onConflict: "clave" });
    return true;
  } catch { return false; }
}
// Ordena nombres de servicio segun el orden compartido (los no listados van al final)
function aplicarOrdenNombres(nombres, orden) {
  if (!Array.isArray(orden) || orden.length === 0) return [...nombres].sort((a, b) => a.localeCompare(b));
  const pos = new Map(orden.map((x, i) => [x, i]));
  return [...nombres].sort((a, b) => {
    const pa = pos.has(a) ? pos.get(a) : 9999;
    const pb = pos.has(b) ? pos.get(b) : 9999;
    return pa !== pb ? pa - pb : a.localeCompare(b);
  });
}

// Catálogo de funciones/subfunciones que se pueden desactivar
const FUNCIONES_CONFIGURABLES = [
  { grupo: "Pestañas principales", items: [
    ["tab:logbook", "🔪 Logbook"],
    ["tab:hospital", "🏥 Hospital"],
    ["tab:conocimiento", "📖 Biblioteca"],
  ]},
  { grupo: "Hospital", items: [
    ["hosp:tabla", "📋 Tabla quirúrgica"],
    ["hosp:notas", "🗒️ Notas"],
    ["hosp:prescripciones", "💊 Recetas"],
    ["hosp:interconsultas", "📄 Interconsultas"],
    ["hosp:seguimiento", "🔄 Seguimiento"],
  ]},
  { grupo: "Biblioteca", items: [
    ["biblio:videos", "📚 Videos"],
    ["biblio:preguntas", "❓ Preguntas"],
    ["biblio:medicamentos", "💊 Medicamentos"],
    ["biblio:scores", "🧮 Scores"],
  ]},
];

// ─── Onboarding de notificaciones: se ofrece UNA vez al abrir la app ───
function OnboardingPushModal({ currentUser, onClose }) {
  const [cargando, setCargando] = useState(false);
  const [msg, setMsg] = useState("");
  const marcar = () => { try { localStorage.setItem("uro_push_onboarding", "1"); } catch {} };
  const activar = async () => {
    setCargando(true); setMsg("");
    const conTope = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r({ ok: false, error: "La operación tardó demasiado. Revisa la conexión." }), 15000))]);
    try {
      const r = await conTope(activarPush(currentUser.id));
      if (r.ok) { marcar(); onClose(); return; }
      setMsg("⚠️ " + r.error);
    } catch (e) { setMsg("⚠️ " + (e.message || String(e))); }
    setCargando(false);
  };
  const ahoraNo = () => { marcar(); onClose(); };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "var(--fondo)", border: "0.5px solid var(--borde)", borderRadius: 16, padding: 22, width: "100%", maxWidth: 340, textAlign: "center" }}>
        <div style={{ fontSize: 34, marginBottom: 8 }}>🔔</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--texto)", marginBottom: 6 }}>Activa las notificaciones</div>
        <div style={{ fontSize: "var(--fs-2)", color: "var(--texto-sec)", lineHeight: 1.5, marginBottom: 16 }}>
          Recibe avisos de cirugías, pendientes e interconsultas aunque tengas UroSearch cerrada.
        </div>
        {msg && <div style={{ fontSize: "var(--fs-1)", color: "var(--peligro)", marginBottom: 10 }}>{msg}</div>}
        <button onClick={activar} disabled={cargando} style={{ width: "100%", padding: 12, fontSize: "var(--fs-2)", fontWeight: 600, background: "var(--primario)", color: "var(--texto-inv)", border: "none", borderRadius: 9, cursor: cargando ? "default" : "pointer", opacity: cargando ? 0.6 : 1, marginBottom: 8 }}>{cargando ? "Activando…" : "Activar notificaciones"}</button>
        <button onClick={ahoraNo} disabled={cargando} style={{ width: "100%", padding: 10, fontSize: "var(--fs-2)", background: "none", color: "var(--texto-ter)", border: "none", cursor: "pointer" }}>Ahora no</button>
      </div>
    </div>
  );
}

// ─── Bloqueo de la app (PIN / biometría) ───
const LOCK_KEY = "uro_lock";
function leerLock() { try { return JSON.parse(localStorage.getItem(LOCK_KEY) || "null") || { enabled: false, pinHash: "", bio: false, credId: "" }; } catch { return { enabled: false, pinHash: "", bio: false, credId: "" }; } }
function guardarLock(v) { try { localStorage.setItem(LOCK_KEY, JSON.stringify(v)); } catch {} }
function hashPin(pin) { let h = 5381; for (let i = 0; i < pin.length; i++) h = ((h << 5) + h + pin.charCodeAt(i)) >>> 0; return "h" + h; }
async function registrarBiometria() {
  if (!window.PublicKeyCredential || !navigator.credentials) return null;
  try {
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "UroSearch" },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "urosearch", displayName: "UroSearch" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
      timeout: 60000,
    } });
    if (!cred) return null;
    return btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
  } catch { return null; }
}
async function verificarBiometria(credIdB64) {
  if (!window.PublicKeyCredential || !navigator.credentials) return false;
  try {
    const raw = credIdB64 ? Uint8Array.from(atob(credIdB64), c => c.charCodeAt(0)) : null;
    const assertion = await navigator.credentials.get({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: raw ? [{ type: "public-key", id: raw }] : [],
      userVerification: "required", timeout: 60000,
    } });
    return !!assertion;
  } catch { return false; }
}

function LockScreen({ onUnlock }) {
  const cfg = leerLock();
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const intentarPin = () => { if (cfg.pinHash && hashPin(pin) === cfg.pinHash) { setErr(""); onUnlock(); } else { setErr("Clave incorrecta"); setPin(""); } };
  const intentarBio = async () => { setErr(""); const ok = await verificarBiometria(cfg.credId); if (ok) onUnlock(); else setErr("No se pudo verificar la biometría"); };
  useEffect(() => { if (cfg.bio && cfg.credId) intentarBio(); }, []);
  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--fondo)", zIndex: 2000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ fontSize: 40, marginBottom: 10 }}>🔒</div>
      <div style={{ fontSize: "var(--fs-4)", fontWeight: 700, color: "var(--texto)", marginBottom: 4 }}>UroSearch bloqueada</div>
      <div style={{ fontSize: "var(--fs-2)", color: "var(--texto-ter)", marginBottom: 18 }}>Ingresa tu clave para continuar</div>
      <input type="password" inputMode="numeric" autoFocus value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} onKeyDown={e => { if (e.key === "Enter") intentarPin(); }} placeholder="••••" style={{ width: 180, textAlign: "center", letterSpacing: 6, fontSize: 20, padding: "10px 12px", border: "0.5px solid var(--borde)", borderRadius: 10, background: "var(--superficie)", color: "var(--texto)", marginBottom: 12 }} />
      {err && <div style={{ fontSize: "var(--fs-1)", color: "var(--peligro)", marginBottom: 10 }}>{err}</div>}
      <button onClick={intentarPin} style={{ width: 180, padding: 12, fontSize: "var(--fs-2)", fontWeight: 600, background: "var(--primario)", color: "var(--texto-inv)", border: "none", borderRadius: 10, cursor: "pointer" }}>Desbloquear</button>
      {cfg.bio && cfg.credId && <button onClick={intentarBio} style={{ marginTop: 12, background: "none", border: "none", color: "var(--primario)", fontSize: "var(--fs-2)", fontWeight: 600, cursor: "pointer" }}>👆 Usar biometría</button>}
    </div>
  );
}

function SeguridadLock() {
  const [cfg, setCfg] = useState(leerLock);
  const [pin1, setPin1] = useState(""); const [pin2, setPin2] = useState("");
  const [msg, setMsg] = useState("");
  const aplicar = (v) => { guardarLock(v); setCfg(v); };
  const activar = () => {
    if (pin1.length < 4) { setMsg("La clave debe tener al menos 4 dígitos."); return; }
    if (pin1 !== pin2) { setMsg("Las claves no coinciden."); return; }
    aplicar({ ...cfg, enabled: true, pinHash: hashPin(pin1) }); setPin1(""); setPin2(""); setMsg("✓ Bloqueo activado.");
  };
  const desactivar = () => { aplicar({ enabled: false, pinHash: "", bio: false, credId: "" }); setMsg(""); };
  const toggleBio = async () => {
    if (cfg.bio) { aplicar({ ...cfg, bio: false, credId: "" }); setMsg(""); return; }
    setMsg("Registrando biometría…");
    const id = await registrarBiometria();
    if (id) { aplicar({ ...cfg, bio: true, credId: id }); setMsg("✓ Biometría activada."); }
    else setMsg("Tu dispositivo no permitió registrar la biometría.");
  };
  const inp = { width: "100%", padding: "8px 10px", fontSize: "var(--fs-2)", border: "0.5px solid var(--borde)", borderRadius: 7, background: "var(--superficie)", color: "var(--texto)", boxSizing: "border-box", marginBottom: 8, textAlign: "center", letterSpacing: 4 };
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: "var(--fs-2)", fontWeight: 700, color: "var(--texto)", marginBottom: 4 }}>🔒 Bloqueo de la app</div>
      <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)", marginBottom: 8 }}>Protege los datos de pacientes guardados en este dispositivo. Pide clave al abrir y tras 2 min en segundo plano.</div>
      {!cfg.enabled ? (
        <>
          <input type="password" inputMode="numeric" value={pin1} onChange={e => setPin1(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="Nueva clave (mín. 4 dígitos)" style={inp} />
          <input type="password" inputMode="numeric" value={pin2} onChange={e => setPin2(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="Repite la clave" style={inp} />
          <button onClick={activar} style={{ width: "100%", padding: 10, fontSize: "var(--fs-2)", fontWeight: 600, background: "var(--primario)", color: "var(--texto-inv)", border: "none", borderRadius: 8, cursor: "pointer" }}>Activar bloqueo</button>
        </>
      ) : (
        <>
          <div style={{ fontSize: "var(--fs-1)", color: "var(--exito)", marginBottom: 8 }}>✓ Bloqueo activo</div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--fs-2)", color: "var(--texto)", marginBottom: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={cfg.bio} onChange={toggleBio} /> Usar biometría (huella / Face ID) si el dispositivo lo permite
          </label>
          <button onClick={desactivar} style={{ width: "100%", padding: 9, fontSize: "var(--fs-1)", fontWeight: 600, background: "var(--superficie)", color: "var(--peligro)", border: "0.5px solid var(--borde)", borderRadius: 8, cursor: "pointer" }}>Desactivar bloqueo</button>
        </>
      )}
      {msg && <div style={{ fontSize: "var(--fs-1)", color: msg.startsWith("✓") ? "var(--exito)" : "var(--peligro)", marginTop: 8 }}>{msg}</div>}
    </div>
  );
}

function ConfigModal({ onClose, currentUser }) {
  const [cfg, setCfg] = useState(cargarConfig);
  useBackClose(true, onClose);

  // ─── Notificaciones push en el celular ───
  const [push, setPush] = useState(false);
  const [pushMsg, setPushMsg] = useState("");
  const [pushCargando, setPushCargando] = useState(false);
  const soportado = pushSoportado();
  const iosSinInstalar = esIOS() && !estaInstalada();

  useEffect(() => { pushActivo().then(setPush); }, []);

  const alternarPush = async () => {
    setPushCargando(true); setPushMsg("");
    // Tope de tiempo: si algo se cuelga, el interruptor nunca queda bloqueado sin explicación
    const conTope = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r({ ok: false, error: "La operación tardó demasiado. Revisa la conexión e inténtalo de nuevo." }), 15000))]);
    try {
      if (push) {
        await conTope(desactivarPush(currentUser.id));
        setPush(false);
        setPushMsg("Notificaciones desactivadas en este dispositivo.");
      } else {
        const r = await conTope(activarPush(currentUser.id));
        if (r.ok) { setPush(true); setPushMsg("✓ Listo. Te avisaremos aunque tengas la app cerrada."); }
        else setPushMsg("⚠️ " + r.error);
      }
    } catch (e) {
      setPushMsg("⚠️ " + (e.message || String(e)));
    }
    setPushCargando(false);
  };

  const aplicar = (nueva) => { setCfg(nueva); guardarConfig(nueva); };
  const toggleFn = (id) => {
    const ocultas = fnOculta(cfg, id) ? cfg.ocultas.filter(x => x !== id) : [...(cfg.ocultas || []), id];
    aplicar({ ...cfg, ocultas });
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--fondo)", border: "0.5px solid var(--borde)", borderRadius: 14, padding: "20px", width: "100%", maxWidth: 460, maxHeight: "85vh", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--texto)" }}>⚙️ Configuración</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: "var(--texto-ter)", cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ fontSize: "var(--fs-1)", color: "var(--texto-ter)", marginBottom: 16 }}>Personaliza qué funciones ves y cómo responde el chat.</div>

        <SeguridadLock/>

        {/* Notificaciones en el celular */}
        <div style={{ fontSize: "var(--fs-2)", fontWeight: 700, color: "var(--texto)", marginBottom: 6 }}>🔔 Notificaciones en este dispositivo</div>
        <div style={{ marginBottom: 16 }}>
          {!soportado ? (
            <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)", padding: "10px 12px", background: "var(--superficie)", border: "0.5px solid var(--borde)", borderRadius: 10, lineHeight: 1.45 }}>
              Este navegador no permite notificaciones. Prueba desde Chrome en Android, o instalando UroSearch en la pantalla de inicio del iPhone.
            </div>
          ) : (
            <>
              <div onClick={pushCargando ? undefined : alternarPush} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 12px", borderRadius: 10, cursor: pushCargando ? "default" : "pointer", background: "var(--superficie)", border: "0.5px solid " + (push ? "var(--exito)" : "var(--borde)"), opacity: pushCargando ? 0.6 : 1 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "var(--fs-2)", fontWeight: 600, color: "var(--texto)" }}>Avisarme en el celular</div>
                  <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-sec)", lineHeight: 1.4, marginTop: 2 }}>
                    {pushCargando ? "Activando…" : "Las notificaciones de la campana llegan también con la app cerrada."}
                  </div>
                </div>
                <span style={{ width: 40, height: 22, borderRadius: 11, background: push ? "var(--exito)" : "var(--borde-suave)", position: "relative", transition: "background .2s", flexShrink: 0 }}>
                  <span style={{ position: "absolute", top: 2.5, left: push ? 20 : 3, width: 17, height: 17, borderRadius: "50%", background: "var(--superficie)", transition: "left .2s", boxShadow: "0 1px 2px rgba(0,0,0,0.25)" }} />
                </span>
              </div>
              {iosSinInstalar && (
                <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-sec)", marginTop: 6, lineHeight: 1.45, padding: "8px 10px", background: "var(--fondo-suave)", borderRadius: 8 }}>
                  📱 En iPhone, primero agrega UroSearch a la pantalla de inicio (Compartir → Agregar a inicio) y ábrela desde ahí; Safari no permite notificaciones desde una pestaña.
                </div>
              )}
              {push && (
                <button onClick={async () => { const r = await probarPush(); if (!r.ok) setPushMsg("⚠️ " + r.error); }} style={{ marginTop: 6, padding: "7px 12px", fontSize: "var(--fs-0)", background: "none", border: "0.5px solid var(--borde)", color: "var(--texto-sec)", borderRadius: 8, cursor: "pointer" }}>
                  Enviar una de prueba
                </button>
              )}
              {pushMsg && <div style={{ fontSize: "var(--fs-0)", marginTop: 6, lineHeight: 1.45, color: pushMsg.startsWith("✓") ? "var(--exito)" : pushMsg.startsWith("⚠️") ? "var(--peligro)" : "var(--texto-ter)" }}>{pushMsg}</div>}
            </>
          )}
        </div>

        {/* Modo del chat */}
        <div style={{ fontSize: "var(--fs-2)", fontWeight: 700, color: "var(--texto)", marginBottom: 6 }}>🤖 Fuente de respuestas del chat</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
          {[["verificada", "📚 Solo base de datos verificada", "Uros responde únicamente con documentos de UroSearch. Si no encuentra nada, te ofrece usar su conocimiento y tú decides."],
            ["general", "🧠 Base + conocimiento general de la IA", "Si no hay documentos en la base, Uros responde directo con su conocimiento clínico (marcado como fuera de la base)."]].map(([id, label, desc]) => {
            const on = (cfg.chatModo || "verificada") === id;
            return (
              <div key={id} onClick={() => aplicar({ ...cfg, chatModo: id })} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderRadius: 10, cursor: "pointer", background: on ? "var(--est-prog-bg)" : "var(--superficie)", border: on ? "1px solid var(--primario)" : "0.5px solid var(--borde)" }}>
                <span style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0, marginTop: 2, border: "2px solid " + (on ? "var(--primario)" : "var(--borde)"), background: on ? "var(--primario)" : "transparent", boxShadow: on ? "inset 0 0 0 3px var(--superficie)" : "none" }} />
                <div>
                  <div style={{ fontSize: "var(--fs-2)", fontWeight: 600, color: "var(--texto)" }}>{label}</div>
                  <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-sec)", lineHeight: 1.45, marginTop: 2 }}>{desc}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Funciones */}
        <div style={{ fontSize: "var(--fs-2)", fontWeight: 700, color: "var(--texto)", marginBottom: 6 }}>🧩 Funciones activas</div>
        <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)", marginBottom: 10, lineHeight: 1.45 }}>Desmarca lo que no uses para simplificar la interfaz. Puedes reactivarlo cuando quieras.<br/>Si apagas una pestaña principal pero dejas activa alguna de sus secciones, esa sección aparecerá como pestaña propia.</div>
        {FUNCIONES_CONFIGURABLES.map(g => (
          <div key={g.grupo} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: "var(--fs-0)", fontWeight: 700, color: "var(--texto-sec)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 }}>{g.grupo}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {g.items.map(([id, label]) => {
                const activa = !fnOculta(cfg, id);
                return (
                  <div key={id} onClick={() => toggleFn(id)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderRadius: 8, cursor: "pointer", background: "var(--superficie)", border: "0.5px solid var(--borde)", opacity: activa ? 1 : 0.65 }}>
                    <span style={{ fontSize: "var(--fs-2)", color: "var(--texto)" }}>{label}</span>
                    <span style={{ width: 40, height: 22, borderRadius: 11, background: activa ? "var(--exito)" : "var(--borde-suave)", position: "relative", transition: "background .2s", flexShrink: 0 }}>
                      <span style={{ position: "absolute", top: 2.5, left: activa ? 20 : 3, width: 17, height: 17, borderRadius: "50%", background: "var(--superficie)", transition: "left .2s", boxShadow: "0 1px 2px rgba(0,0,0,0.25)" }} />
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Marca de agua: logo UroSearch como PNG (colores fijos, las var CSS no sirven en PDF) ───
function logoWatermarkDataUrl() {
  return new Promise((resolve) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 50 50">
      <circle cx="25" cy="25" r="23.5" fill="#ffffff" stroke="#065A82" stroke-width="2"/>
      <path d="M 15 11 C 10 11, 8 14, 8 19 C 8 24, 10 27, 15 27 C 17.5 27, 19 26, 19.5 24 C 20 21, 20 16, 19.5 13.5 C 19 12, 17.5 11, 15 11 Z" fill="#065A82"/>
      <path d="M 17 27 C 19 30, 16 33, 18.5 36 C 21 39, 23 40, 25 42" stroke="#065A82" stroke-width="1.8" fill="none" stroke-linecap="round"/>
      <path d="M 35 11 C 40 11, 42 14, 42 19 C 42 24, 40 27, 35 27 C 32.5 27, 31 26, 30.5 24 C 30 21, 30 16, 30.5 13.5 C 31 12, 32.5 11, 35 11 Z" fill="#1C7293"/>
      <path d="M 33 27 C 31 30, 34 33, 31.5 36 C 29 39, 27 40, 25 42" stroke="#1C7293" stroke-width="1.8" fill="none" stroke-linecap="round"/>
      <path d="M 19 43 C 19 41.5, 21 40.5, 25 40.5 C 22 42, 28 45.5, 25 47 C 21 47, 19 45.5, 19 43 Z" fill="#065A82"/>
      <path d="M 31 43 C 31 41.5, 29 40.5, 25 40.5 C 22 42, 28 45.5, 25 47 C 29 47, 31 45.5, 31 43 Z" fill="#1C7293"/>
    </svg>`;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = 320; c.height = 320;
      c.getContext("2d").drawImage(img, 0, 0, 320, 320);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => resolve(null);
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
  });
}

// ─── Plantillas de prescripción (checklists pre-hechos, urología) ───
const RX_TEMPLATES = {
  medicamentos: {
    titulo: "RECETA MÉDICA", verbo: "Rp.",
    items: [
      "Ciprofloxacino 500 mg — 1 comprimido cada 12 h VO por 7 días",
      "Cefadroxilo 500 mg — 1 cápsula cada 12 h VO por 7 días",
      "Nitrofurantoína 100 mg — 1 cápsula cada 8 h VO por 5 días",
      "Fosfomicina 3 g — 1 sobre en dosis única VO",
      "Ceftriaxona 1 g — 1 ampolla cada 24 h EV",
      "Tamsulosina 0,4 mg — 1 comprimido cada 24 h VO (noche)",
      "Finasterida 5 mg — 1 comprimido cada 24 h VO",
      "Dutasterida/Tamsulosina 0,5/0,4 mg — 1 comprimido cada 24 h VO",
      "Solifenacina 5 mg — 1 comprimido cada 24 h VO",
      "Oxibutinina 5 mg — 1 comprimido cada 8–12 h VO",
      "Paracetamol 1 g — 1 comprimido cada 8 h VO",
      "Ketoprofeno 100 mg — 1 comprimido cada 12 h VO con alimentos",
      "Ketorolaco 10 mg — 1 comprimido cada 8 h VO SOS dolor",
      "Tramadol 50 mg — 1 comprimido cada 8 h VO SOS dolor intenso",
    ],
  },
  laboratorio: {
    titulo: "SOLICITUD DE EXÁMENES DE LABORATORIO", verbo: "Solicito:",
    items: [
      "Hemograma completo", "VHS / PCR", "Creatinina plasmática", "Nitrógeno ureico (BUN)",
      "Electrolitos plasmáticos (Na/K/Cl)", "Perfil bioquímico", "Perfil hepático", "Glicemia",
      "Pruebas de coagulación (TP/INR, TTPA)", "Grupo sanguíneo y Rh", "Orina completa", "Urocultivo",
      "PSA total", "PSA libre", "Testosterona total", "Calcio / Fósforo", "Ácido úrico",
      "Relación proteína/creatinina en orina",
    ],
  },
  imagen: {
    titulo: "SOLICITUD DE IMÁGENES", verbo: "Solicito:",
    items: [
      "Ecografía renal y vesical", "Ecografía vesicoprostática con residuo post-miccional",
      "UroTAC (TAC abdomen y pelvis, fase urográfica)", "TAC de abdomen y pelvis con contraste",
      "Resonancia multiparamétrica de próstata", "Pielo-TAC", "Cistografía",
      "Uretrocistografía retrógrada y miccional", "Radiografía renal-vesical simple (Rx RVS)",
      "Cintigrama renal DMSA", "Cintigrama renal DTPA / MAG3", "Ecografía testicular con doppler",
    ],
  },
  indicaciones: {
    titulo: "INDICACIONES MÉDICAS", verbo: "Indicaciones:",
    items: [
      "Reposo relativo", "Régimen liviano según tolerancia", "Abundante ingesta de líquidos (> 2 litros/día)",
      "Aseo genital prolijo", "Control en policlínico de Urología", "Retiro de sonda Foley según indicación",
      "Retiro de catéter doble J (JJ) por cistoscopía", "Curaciones planas según indicación",
      "Mantener catéter permeable y bolsa bajo nivel vesical",
      "Consultar en Urgencias si: fiebre > 38,5 °C, hematuria con coágulos, retención urinaria o dolor no controlado",
    ],
  },
};
const RX_CATS = [["medicamentos", "💊 Medicamentos"], ["laboratorio", "🧪 Laboratorio"], ["imagen", "🩻 Imagen"], ["indicaciones", "📋 Indicaciones"]];

// ─── Panel de Prescripciones (exclusivo urólogo): checklists → PDF tipo receta ───
function PrescripcionesPanel({ currentUser }) {
  const [cat, setCat] = useState("medicamentos");
  const [seleccionados, setSeleccionados] = useState({});   // { "medicamentos": Set(idx), ... } via objeto
  const [extra, setExtra] = useState("");                    // líneas libres adicionales
  const [sugerenciasOpen, setSugerenciasOpen] = useState(false); // checklist de sugeridos colapsado por defecto
  const [paciente, setPaciente] = useState({ nombre: "", edad: "", rut: "", ciudad: "", domicilio: "" });
  const [perfil, setPerfil] = useState(null);
  const [generando, setGenerando] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const { data } = await supabase.from("perfiles").select("*").eq("id", currentUser.id).single();
        if (vivo) setPerfil(data || {});
      } catch { if (vivo) setPerfil({}); }
    })();
    return () => { vivo = false; };
  }, [currentUser.id]);

  const marcados = seleccionados[cat] || [];
  const toggle = (idx) => {
    setSeleccionados(prev => {
      const arr = prev[cat] || [];
      return { ...prev, [cat]: arr.includes(idx) ? arr.filter(i => i !== idx) : [...arr, idx] };
    });
  };

  const lineasActuales = () => {
    const base = (seleccionados[cat] || []).slice().sort((a, b) => a - b).map(i => RX_TEMPLATES[cat].items[i]);
    const libres = extra.split("\n").map(s => s.trim()).filter(Boolean);
    return [...base, ...libres];
  };

  // Tras un despliegue nuevo, el navegador puede tener cacheada la versión
  // anterior de la app, que pide archivos con nombres que ya no existen.
  // Si eso pasa al cargar jsPDF, se recarga la página UNA vez y se reintenta.
  const cargarJsPDF = async () => {
    try {
      return (await import("jspdf")).jsPDF;
    } catch (e) {
      const esImportRoto = /dynamically imported module|Failed to fetch|Importing a module script failed|error loading dynamically/i.test(e?.message || "");
      const yaRecargo = sessionStorage.getItem("uro_recarga_import") === "1";
      if (esImportRoto && !yaRecargo) {
        sessionStorage.setItem("uro_recarga_import", "1");
        window.location.reload();
        // La página se recarga; se lanza para cortar la ejecución actual.
        throw new Error("Actualizando la aplicación…");
      }
      throw new Error("No se pudo cargar el generador de PDF. Cierra la aplicación por completo y vuelve a abrirla.");
    }
  };

  const generarPDF = async () => {
    const lineas = lineasActuales();
    if (lineas.length === 0) { setMsg("⚠️ Selecciona al menos un ítem o agrega una línea."); return; }
    if (!perfil?.nombre_completo && !perfil?.nombre) { setMsg("⚠️ Completa tu perfil (Mi perfil) antes de generar recetas."); return; }
    setGenerando(true); setMsg("");
    try {
      const jsPDF = await cargarJsPDF();
      const doc = new jsPDF({ unit: "mm", format: "a5" });
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const cx = W / 2;

      // Marca de agua (logo tenue, centrado). Solo si jspdf soporta opacidad.
      const wm = await logoWatermarkDataUrl();
      if (wm && doc.GState) {
        try {
          doc.saveGraphicsState();
          doc.setGState(new doc.GState({ opacity: 0.07 }));
          const size = 90;
          doc.addImage(wm, "PNG", cx - size / 2, H / 2 - size / 2, size, size);
          doc.restoreGraphicsState();
        } catch {}
      }

      const t = RX_TEMPLATES[cat];
      const nombreDr = perfil.nombre_completo || perfil.nombre || "";

      // Encabezado: logo UroSearch a color en la esquina superior izquierda,
      // con el texto "UroSearch" debajo, y los datos del médico alineados a la
      // izquierda, junto al logo.
      const logoPng = wm; // mismo PNG del logo (a color), ya generado arriba
      const logoX = 12, logoY = 9, logoSize = 16;
      if (logoPng) {
        try { doc.addImage(logoPng, "PNG", logoX, logoY, logoSize, logoSize); } catch {}
      }
      doc.setFont("times", "bolditalic"); doc.setFontSize(8.5); doc.setTextColor(6, 90, 130);
      doc.text("UroSearch", logoX + logoSize / 2, logoY + logoSize + 3.5, { align: "center" });

      const dx = logoX + logoSize + 6; // datos del médico a la derecha del logo, alineados a la izquierda
      let y = 13;
      doc.setFont("times", "bold"); doc.setFontSize(12.5); doc.setTextColor(20, 20, 20);
      doc.text(nombreDr.toUpperCase(), dx, y); y += 5;
      doc.setFont("times", "normal"); doc.setFontSize(8.5); doc.setTextColor(60, 60, 60);
      doc.text("MÉDICO CIRUJANO · UROLOGÍA", dx, y); y += 4;
      const idLine = ["RUT: " + (perfil.rut || "—"), "RCM: " + (perfil.rcm || "—")].join("    ");
      doc.text(idLine, dx, y); y += 4;
      if (perfil.centro) { doc.text(perfil.centro, dx, y); y += 4; }
      if (perfil.direccion) { doc.text(perfil.direccion, dx, y); y += 4; }
      const loc = [perfil.ciudad, perfil.region].filter(Boolean).join(", ");
      if (loc) { doc.text(loc, dx, y); y += 4; }
      const contacto = [perfil.telefono ? "Tel: " + perfil.telefono : "", perfil.correo || ""].filter(Boolean).join("   ");
      if (contacto) { doc.text(contacto, dx, y); y += 4; }
      y = Math.max(y + 1, logoY + logoSize + 6.5);
      doc.setDrawColor(120, 120, 120); doc.setLineWidth(0.3); doc.line(12, y, W - 12, y); y += 7;

      // Título + fecha
      doc.setFont("times", "bold"); doc.setFontSize(10.5); doc.setTextColor(6, 90, 130);
      doc.text(t.titulo, 12, y);
      doc.setFont("times", "normal"); doc.setFontSize(9); doc.setTextColor(40, 40, 40);
      doc.text("Fecha: " + fmtFecha(new Date().toISOString().slice(0, 10)), W - 12, y, { align: "right" }); y += 7;

      // Datos del paciente
      doc.setFontSize(9.5); doc.setTextColor(20, 20, 20);
      doc.text("Paciente: " + (paciente.nombre || "_______________________________"), 12, y); y += 6;
      const l2 = "Edad: " + (paciente.edad || "____") + "    RUT: " + (paciente.rut || "____________") + "    Ciudad: " + (paciente.ciudad || "__________");
      doc.text(l2, 12, y); y += 6;
      doc.text("Domicilio: " + (paciente.domicilio || "_______________________________"), 12, y); y += 8;

      // Cuerpo (Rp. / Solicito)
      doc.setFont("times", "bold"); doc.setFontSize(11); doc.text(t.verbo, 12, y); y += 6;
      doc.setFont("times", "normal"); doc.setFontSize(10);
      const maxW = W - 24;
      lineas.forEach((ln, i) => {
        const wrapped = doc.splitTextToSize((cat === "medicamentos" ? `${i + 1}. ` : "• ") + ln, maxW);
        wrapped.forEach(w => {
          if (y > H - 16) { doc.addPage(); y = 16; }
          doc.text(w, 14, y); y += 5.2;
        });
        y += 1.5;
      });

      // Pie
      y = Math.max(y, H - 22);
      doc.setDrawColor(120, 120, 120); doc.line(cx - 28, y, cx + 28, y); y += 4;
      doc.setFontSize(8); doc.setTextColor(90, 90, 90);
      doc.text("Firma y timbre", cx, y, { align: "center" });

      const nombreArch = `${t.titulo.toLowerCase().replace(/[^a-z]+/g, "-")}-${(paciente.nombre || "paciente").replace(/\s+/g, "_")}.pdf`;
      doc.save(nombreArch);
      setMsg("✓ Receta generada.");
    } catch (e) {
      setMsg("⚠️ No se pudo generar el PDF: " + String(e?.message || e));
    }
    setGenerando(false);
  };

  const inp = { width: "100%", padding: "8px 10px", fontSize: "var(--fs-2)", border: "0.5px solid var(--borde)", borderRadius: 8, background: "var(--superficie)", color: "var(--texto)", boxSizing: "border-box", outline: "none" };
  const lbl = { fontSize: "var(--fs-0)", fontWeight: 600, color: "var(--texto-sec)", marginBottom: 3, display: "block" };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "16px" }}>
      {/* Submenú de categorías */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {RX_CATS.map(([id, label]) => (
          <button key={id} onClick={() => { setCat(id); setMsg(""); }} style={{ padding: "7px 12px", fontSize: "var(--fs-1)", fontWeight: 600, borderRadius: 20, cursor: "pointer", border: cat === id ? "none" : "0.5px solid var(--borde)", background: cat === id ? "var(--primario)" : "var(--superficie)", color: cat === id ? "var(--texto-inv)" : "var(--primario)" }}>
            {label}{(seleccionados[id]?.length || 0) > 0 ? ` (${seleccionados[id].length})` : ""}
          </button>
        ))}
      </div>

      {/* Datos del paciente */}
      <div style={{ background: "var(--fondo-suave)", border: "0.5px solid var(--borde)", borderRadius: 10, padding: "12px", marginBottom: 14 }}>
        <div style={{ fontSize: "var(--fs-1)", fontWeight: 600, color: "var(--texto-sec)", marginBottom: 8 }}>Datos del paciente (opcional)</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ gridColumn: "1 / -1" }}><label style={lbl}>Nombre</label><input value={paciente.nombre} onChange={e => setPaciente({ ...paciente, nombre: e.target.value })} style={inp} /></div>
          <div><label style={lbl}>Edad</label><input value={paciente.edad} onChange={e => setPaciente({ ...paciente, edad: e.target.value })} style={inp} /></div>
          <div><label style={lbl}>RUT</label><input value={paciente.rut} onChange={e => setPaciente({ ...paciente, rut: e.target.value })} style={inp} /></div>
          <div><label style={lbl}>Ciudad</label><input value={paciente.ciudad} onChange={e => setPaciente({ ...paciente, ciudad: e.target.value })} style={inp} /></div>
          <div><label style={lbl}>Domicilio</label><input value={paciente.domicilio} onChange={e => setPaciente({ ...paciente, domicilio: e.target.value })} style={inp} /></div>
        </div>
      </div>

      {/* Botón que despliega las sugerencias (checklist colapsado por defecto) */}
      <button onClick={() => setSugerenciasOpen(o => !o)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 14px", fontSize: "var(--fs-2)", fontWeight: 600, background: sugerenciasOpen ? "var(--est-prog-bg)" : "var(--superficie)", color: "var(--primario)", border: "0.5px solid " + (sugerenciasOpen ? "var(--primario)" : "var(--borde)"), borderRadius: 10, cursor: "pointer", marginBottom: 10 }}>
        <span>💡 Sugerencias{(marcados.length > 0) ? ` (${marcados.length} seleccionadas)` : ""}</span>
        <span>{sugerenciasOpen ? "▴" : "▾"}</span>
      </button>

      {sugerenciasOpen && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 12 }}>
          {RX_TEMPLATES[cat].items.map((it, idx) => {
            const on = marcados.includes(idx);
            return (
              <div key={idx} onClick={() => toggle(idx)} style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "9px 10px", borderRadius: 8, cursor: "pointer", background: on ? "var(--exito-bg)" : "var(--superficie)", border: "0.5px solid " + (on ? "var(--exito-borde)" : "var(--borde)") }}>
                <span style={{ width: 17, height: 17, borderRadius: 4, flexShrink: 0, marginTop: 1, border: "1px solid " + (on ? "var(--exito)" : "var(--borde)"), background: on ? "var(--exito)" : "transparent", color: "var(--texto-inv)", fontSize: "var(--fs-1)", display: "flex", alignItems: "center", justifyContent: "center" }}>{on ? "✓" : ""}</span>
                <span style={{ fontSize: "var(--fs-2)", color: "var(--texto)", lineHeight: 1.4 }}>{it}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Líneas libres (siempre visibles, debajo del botón de sugerencias) */}
      <label style={lbl}>Escribir de forma libre (una línea por ítem)</label>
      <textarea value={extra} onChange={e => setExtra(e.target.value)} rows={3} placeholder={cat === "medicamentos" ? "Ej: Omeprazol 20 mg — 1 comp en ayunas por 14 días" : "Ej: control con nefrología en 15 días"} style={{ ...inp, resize: "vertical", marginBottom: 12 }} />

      {msg && <div style={{ fontSize: "var(--fs-1)", padding: "8px 10px", borderRadius: 8, marginBottom: 10, background: msg.startsWith("✓") ? "var(--exito-bg)" : "var(--peligro-bg)", color: msg.startsWith("✓") ? "var(--exito)" : "var(--peligro)", border: "0.5px solid " + (msg.startsWith("✓") ? "var(--exito-borde)" : "var(--peligro)") }}>{msg}</div>}

      <button onClick={generarPDF} disabled={generando} style={{ width: "100%", padding: "12px", fontSize: "var(--fs-2)", fontWeight: 600, background: "var(--primario)", color: "var(--texto-inv)", border: "none", borderRadius: 8, cursor: generando ? "default" : "pointer", opacity: generando ? 0.6 : 1 }}>{generando ? "Generando…" : "📄 Generar receta en PDF"}</button>
      <div style={{ fontSize: "var(--fs-xs)", color: "var(--texto-ter)", textAlign: "center", marginTop: 8, lineHeight: 1.4 }}>Los datos del médico salen de tu perfil. La receta lleva la marca de agua de UroSearch.</div>
    </div>
  );
}

// ─── Panel Medicamentos (Biblioteca): buscador + edición solo admin ───
function MedicamentosPanel({ currentUser, isAdmin }) {
  const [lista, setLista] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [agregando, setAgregando] = useState(false);
  const [abiertoId, setAbiertoId] = useState(null); // medicamento expandido (colapsados por defecto)
  const [form, setForm] = useState({ nombre: "", presentacion: "", posologia: "", indicacion: "", categoria: "", notas: "" });
  const [err, setErr] = useState("");

  const cargar = async () => {
    setCargando(true);
    try {
      const { data } = await supabase.from("medicamentos").select("*").order("nombre", { ascending: true });
      setLista(data || []);
    } catch { setLista([]); }
    setCargando(false);
  };
  useEffect(() => { cargar(); }, []);

  const guardar = async () => {
    setErr("");
    if (!form.nombre.trim()) return setErr("Ingresa el nombre del medicamento");
    try {
      const { data, error } = await supabase.from("medicamentos").insert({
        nombre: form.nombre.trim(), presentacion: form.presentacion.trim() || null,
        posologia: form.posologia.trim() || null, indicacion: form.indicacion.trim() || null,
        categoria: form.categoria.trim() || null, notas: form.notas.trim() || null, autor_id: currentUser.id,
      }).select().single();
      if (error) return setErr(error.message);
      setLista(prev => [...prev, data].sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "")));
      setForm({ nombre: "", presentacion: "", posologia: "", indicacion: "", categoria: "", notas: "" });
      setAgregando(false);
    } catch (e) { setErr(String(e)); }
  };

  const eliminar = async (id) => {
    if (!window.confirm("¿Eliminar este medicamento?")) return;
    try {
      const { error } = await supabase.from("medicamentos").delete().eq("id", id);
      if (error) return alert("Error: " + error.message);
      setLista(prev => prev.filter(m => m.id !== id));
    } catch (e) { alert(String(e)); }
  };

  const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const q = norm(busqueda);
  const filtrados = (q ? lista.filter(m => norm(m.nombre).includes(q) || norm(m.categoria).includes(q) || norm(m.indicacion).includes(q)) : lista)
    .slice()
    .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es", { sensitivity: "base" })); // orden alfabético

  const inp = { width: "100%", padding: "8px 10px", fontSize: "var(--fs-2)", border: "0.5px solid var(--borde)", borderRadius: 8, background: "var(--superficie)", color: "var(--texto)", boxSizing: "border-box", outline: "none", marginBottom: 8 };

  return (
    <div style={{ padding: "16px", flex: 1, overflowY: "auto" }}>
      <div style={{ fontSize: "var(--fs-2)", color: "var(--texto-sec)", marginBottom: 10 }}>{lista.length} medicamentos frecuentes en urología</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="🔎 Buscar por nombre, categoría o indicación…" style={{ ...inp, flex: "1 1 200px", marginBottom: 0 }} />
        {isAdmin && <button onClick={() => { setAgregando(!agregando); setErr(""); }} style={{ padding: "8px 14px", fontSize: "var(--fs-1)", fontWeight: 500, background: agregando ? "var(--superficie)" : "var(--primario)", color: agregando ? "var(--primario)" : "var(--texto-inv)", border: agregando ? "0.5px solid var(--primario)" : "none", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap" }}>{agregando ? "Cancelar" : "+ Agregar"}</button>}
      </div>

      {isAdmin && agregando && (
        <div style={{ background: "var(--fondo-suave)", border: "0.5px solid var(--borde)", borderRadius: 10, padding: 12, marginBottom: 14 }}>
          <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Nombre (ej: Ciprofloxacino)" style={inp} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input value={form.presentacion} onChange={e => setForm({ ...form, presentacion: e.target.value })} placeholder="Presentación (500 mg comp)" style={inp} />
            <input value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })} placeholder="Categoría (Antibiótico)" style={inp} />
          </div>
          <input value={form.posologia} onChange={e => setForm({ ...form, posologia: e.target.value })} placeholder="Posología (1 comp c/12 h VO por 7 días)" style={inp} />
          <input value={form.indicacion} onChange={e => setForm({ ...form, indicacion: e.target.value })} placeholder="Indicación (ITU, prostatitis)" style={inp} />
          <input value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })} placeholder="Notas (opcional)" style={inp} />
          {err && <div style={{ fontSize: "var(--fs-1)", color: "var(--peligro)", marginBottom: 8 }}>{err}</div>}
          <button onClick={guardar} style={{ padding: "9px 16px", fontSize: "var(--fs-2)", fontWeight: 600, background: "var(--primario)", color: "var(--texto-inv)", border: "none", borderRadius: 8, cursor: "pointer" }}>Guardar</button>
        </div>
      )}

      {cargando ? (
        <div style={{ textAlign: "center", padding: 30, color: "var(--texto-ter)", fontSize: "var(--fs-2)" }}>Cargando…</div>
      ) : filtrados.length === 0 ? (
        <div style={{ textAlign: "center", padding: 30, color: "var(--texto-ter)", fontSize: "var(--fs-2)" }}>{lista.length === 0 ? "No hay medicamentos cargados aún." : "Sin resultados para tu búsqueda."}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtrados.map(m => {
            const expandido = abiertoId === m.id;
            return (
              <div key={m.id} onClick={() => setAbiertoId(expandido ? null : m.id)} style={{ background: "var(--superficie)", border: "0.5px solid " + (expandido ? "var(--primario)" : "var(--borde)"), borderRadius: 10, padding: expandido ? "12px 14px" : "10px 13px", cursor: "pointer", transition: "border .15s" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: "var(--fs-2)", fontWeight: 600, color: "var(--texto)" }}>{m.nombre}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    {isAdmin && expandido && <button onClick={(e) => { e.stopPropagation(); eliminar(m.id); }} style={{ background: "none", border: "none", color: "var(--peligro)", fontSize: "var(--fs-2)", cursor: "pointer", padding: 0 }}>🗑</button>}
                    <span style={{ fontSize: "var(--fs-1)", color: "var(--texto-ter)" }}>{expandido ? "▴" : "▾"}</span>
                  </div>
                </div>
                {expandido && (
                  <div style={{ marginTop: 6 }}>
                    {m.presentacion && <div style={{ fontSize: "var(--fs-1)", color: "var(--texto-sec)" }}>Presentación: {m.presentacion}</div>}
                    {m.posologia && <div style={{ fontSize: "var(--fs-2)", color: "var(--texto)", marginTop: 3 }}>💊 {m.posologia}</div>}
                    {m.indicacion && <div style={{ fontSize: "var(--fs-1)", color: "var(--texto-sec)", marginTop: 2 }}>Indicación: {m.indicacion}</div>}
                    <div style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
                      {m.categoria && <span style={{ fontSize: "var(--fs-xs)", background: "var(--fondo-suave)", color: "var(--texto-sec)", padding: "2px 8px", borderRadius: 8, fontWeight: 600 }}>{m.categoria}</span>}
                      {m.notas && <span style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)" }}>{m.notas}</span>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Definición de scores urológicos con sus calculadoras ───
const SCORES = [
  {
    id: "ipss", nombre: "IPSS", desc: "Síntomas prostáticos (HBP)",
    tipo: "suma",
    preguntas: [
      "Vaciamiento incompleto", "Frecuencia (< 2 h)", "Intermitencia", "Urgencia",
      "Chorro débil", "Esfuerzo miccional", "Nicturia (veces por noche)",
    ],
    opciones: ["0 · Nunca", "1", "2", "3", "4", "5 · Casi siempre"],
    interpretar: (s) => s <= 7 ? "Leve (0–7)" : s <= 19 ? "Moderado (8–19)" : "Severo (20–35)",
  },
  {
    id: "imdc", nombre: "IMDC", desc: "Pronóstico CCR metastásico",
    tipo: "checks",
    factores: [
      "Karnofsky < 80 %", "< 1 año desde diagnóstico a tratamiento sistémico",
      "Hemoglobina < límite inferior normal", "Calcio corregido > límite superior normal",
      "Neutrófilos > límite superior normal", "Plaquetas > límite superior normal",
    ],
    interpretar: (s) => s === 0 ? "Favorable (0 factores)" : s <= 2 ? "Intermedio (1–2 factores)" : "Pobre (≥ 3 factores)",
  },
  {
    id: "damico", nombre: "D'Amico", desc: "Riesgo cáncer de próstata localizado",
    tipo: "custom",
  },
  {
    id: "renal", nombre: "RENAL", desc: "Complejidad de masa renal",
    tipo: "custom",
  },
  {
    id: "briganti", nombre: "Briganti", desc: "Riesgo de invasión ganglionar (cáncer de próstata)",
    tipo: "custom",
  },
];

function ScoresPanel() {
  const [abierto, setAbierto] = useState(null);
  const score = SCORES.find(s => s.id === abierto);
  useBackClose(!!abierto, () => setAbierto(null));

  if (score) {
    return (
      <div style={{ padding: "16px", flex: 1, overflowY: "auto" }}>
        <button onClick={() => setAbierto(null)} style={{ background: "none", border: "none", color: "var(--texto-sec)", fontSize: "var(--fs-2)", cursor: "pointer", marginBottom: 12, padding: 0 }}>← Volver a scores</button>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--texto)", marginBottom: 2 }}>{score.nombre}</div>
        <div style={{ fontSize: "var(--fs-2)", color: "var(--texto-sec)", marginBottom: 14 }}>{score.desc}</div>
        {score.tipo === "suma" && <ScoreSuma score={score} />}
        {score.tipo === "checks" && <ScoreChecks score={score} />}
        {score.id === "damico" && <ScoreDAmico />}
        {score.id === "renal" && <ScoreRENAL />}
        {score.id === "briganti" && <ScoreBriganti />}
      </div>
    );
  }

  return (
    <div style={{ padding: "16px", flex: 1, overflowY: "auto" }}>
      <div style={{ fontSize: "var(--fs-2)", color: "var(--texto-sec)", marginBottom: 12 }}>Calculadoras de los principales scores urológicos</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[...SCORES].sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" })).map(s => (
          <div key={s.id} onClick={() => setAbierto(s.id)} style={{ background: "var(--superficie)", border: "0.5px solid var(--borde)", borderRadius: 10, padding: "13px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: "var(--fs-3)", fontWeight: 600, color: "var(--texto)" }}>{s.nombre}</div>
              <div style={{ fontSize: "var(--fs-1)", color: "var(--texto-sec)" }}>{s.desc}</div>
            </div>
            <span style={{ color: "var(--primario)", fontSize: 18 }}>›</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)", marginTop: 14, lineHeight: 1.5 }}>Falta el nomograma de Briganti (invasión ganglionar en cáncer de próstata): requiere los coeficientes de una versión específica (2012/2019). Si me dices cuál usas, lo agrego.</div>
    </div>
  );
}

const scoreBox = { background: "var(--exito-bg)", border: "0.5px solid var(--exito-borde)", borderRadius: 10, padding: "14px", textAlign: "center", marginTop: 14 };
const selScore = { padding: "8px 10px", fontSize: "var(--fs-2)", border: "0.5px solid var(--borde)", borderRadius: 8, background: "var(--superficie)", color: "var(--texto)", outline: "none", cursor: "pointer", width: "100%" };
const lblScore = { fontSize: "var(--fs-1)", fontWeight: 600, color: "var(--texto-sec)", marginBottom: 4, display: "block" };

function ScoreSuma({ score }) {
  const [vals, setVals] = useState(score.preguntas.map(() => 0));
  const total = vals.reduce((a, b) => a + b, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {score.preguntas.map((p, i) => (
        <div key={i}>
          <label style={lblScore}>{p}</label>
          <select value={vals[i]} onChange={e => { const v = [...vals]; v[i] = parseInt(e.target.value); setVals(v); }} style={selScore}>
            {score.opciones.map((o, j) => <option key={j} value={j}>{o}</option>)}
          </select>
        </div>
      ))}
      <div style={scoreBox}>
        <div style={{ fontSize: 28, fontWeight: 700, color: "var(--exito)" }}>{total}<span style={{ fontSize: 16, color: "var(--texto-sec)" }}> / 35</span></div>
        <div style={{ fontSize: "var(--fs-2)", fontWeight: 600, color: "var(--texto)", marginTop: 2 }}>{score.interpretar(total)}</div>
      </div>
    </div>
  );
}

function ScoreChecks({ score }) {
  const [on, setOn] = useState(score.factores.map(() => false));
  const total = on.filter(Boolean).length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {score.factores.map((f, i) => (
        <div key={i} onClick={() => { const v = [...on]; v[i] = !v[i]; setOn(v); }} style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 11px", borderRadius: 8, cursor: "pointer", background: on[i] ? "var(--exito-bg)" : "var(--superficie)", border: "0.5px solid " + (on[i] ? "var(--exito-borde)" : "var(--borde)") }}>
          <span style={{ width: 17, height: 17, borderRadius: 4, flexShrink: 0, border: "1px solid " + (on[i] ? "var(--exito)" : "var(--borde)"), background: on[i] ? "var(--exito)" : "transparent", color: "var(--texto-inv)", fontSize: "var(--fs-1)", display: "flex", alignItems: "center", justifyContent: "center" }}>{on[i] ? "✓" : ""}</span>
          <span style={{ fontSize: "var(--fs-2)", color: "var(--texto)" }}>{f}</span>
        </div>
      ))}
      <div style={scoreBox}>
        <div style={{ fontSize: 28, fontWeight: 700, color: "var(--exito)" }}>{total}<span style={{ fontSize: 16, color: "var(--texto-sec)" }}> factores</span></div>
        <div style={{ fontSize: "var(--fs-2)", fontWeight: 600, color: "var(--texto)", marginTop: 2 }}>{score.interpretar(total)}</div>
      </div>
    </div>
  );
}

function ScoreDAmico() {
  const [psa, setPsa] = useState("intermedio");     // <10 / 10-20 / >20
  const [isup, setIsup] = useState("1");             // ISUP 1 / 2-3 / 4-5
  const [t, setT] = useState("t2a");                 // ≤T2a / T2b / ≥T2c
  const alto = psa === "alto" || isup === "45" || t === "t2c";
  const intermedio = !alto && (psa === "intermedio" || isup === "23" || t === "t2b");
  const grupo = alto ? "Alto riesgo" : intermedio ? "Riesgo intermedio" : "Bajo riesgo";
  const color = alto ? "var(--peligro)" : intermedio ? "var(--alerta)" : "var(--exito)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div><label style={lblScore}>PSA</label>
        <select value={psa} onChange={e => setPsa(e.target.value)} style={selScore}>
          <option value="bajo">&lt; 10 ng/mL</option><option value="intermedio">10 – 20 ng/mL</option><option value="alto">&gt; 20 ng/mL</option>
        </select></div>
      <div><label style={lblScore}>ISUP (Gleason)</label>
        <select value={isup} onChange={e => setIsup(e.target.value)} style={selScore}>
          <option value="1">ISUP 1 (Gleason ≤ 6)</option><option value="23">ISUP 2–3 (Gleason 7)</option><option value="45">ISUP 4–5 (Gleason 8–10)</option>
        </select></div>
      <div><label style={lblScore}>Estadio clínico</label>
        <select value={t} onChange={e => setT(e.target.value)} style={selScore}>
          <option value="t2a">≤ T2a</option><option value="t2b">T2b</option><option value="t2c">≥ T2c</option>
        </select></div>
      <div style={{ ...scoreBox, background: "var(--fondo-suave)", border: "0.5px solid var(--borde)" }}>
        <div style={{ fontSize: 20, fontWeight: 700, color }}>{grupo}</div>
        <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)", marginTop: 4 }}>Clasificación de D'Amico. El grupo lo determina el factor de mayor riesgo.</div>
      </div>
    </div>
  );
}

function ScoreRENAL() {
  const [r, setR] = useState(1), [e, setE] = useState(1), [n, setN] = useState(1), [l, setL] = useState(1);
  const [ap, setAp] = useState("x"); // sufijo a/p/x (no suma puntos)
  const total = r + e + n + l;
  const compl = total <= 6 ? "Baja complejidad (4–6)" : total <= 9 ? "Complejidad moderada (7–9)" : "Alta complejidad (10–12)";
  const color = total <= 6 ? "var(--exito)" : total <= 9 ? "var(--alerta)" : "var(--peligro)";
  const sel = (val, setter, opts) => (
    <select value={val} onChange={ev => setter(ev.target.value === "x" ? "x" : parseInt(ev.target.value))} style={selScore}>
      {opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
    </select>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div><label style={lblScore}>(R) Radio / tamaño máximo</label>{sel(r, setR, [[1, "≤ 4 cm (1 pt)"], [2, "> 4 y < 7 cm (2 pt)"], [3, "≥ 7 cm (3 pt)"]])}</div>
      <div><label style={lblScore}>(E) Exofítico / endofítico</label>{sel(e, setE, [[1, "≥ 50 % exofítico (1 pt)"], [2, "< 50 % exofítico (2 pt)"], [3, "Totalmente endofítico (3 pt)"]])}</div>
      <div><label style={lblScore}>(N) Cercanía al sistema colector/seno</label>{sel(n, setN, [[1, "≥ 7 mm (1 pt)"], [2, "> 4 y < 7 mm (2 pt)"], [3, "≤ 4 mm (3 pt)"]])}</div>
      <div><label style={lblScore}>(L) Ubicación respecto a líneas polares</label>{sel(l, setL, [[1, "Sobre/bajo polos (1 pt)"], [2, "Cruza línea polar (2 pt)"], [3, "> 50 % cruza línea media (3 pt)"]])}</div>
      <div><label style={lblScore}>(A) Anterior / Posterior (sufijo)</label>
        <select value={ap} onChange={ev => setAp(ev.target.value)} style={selScore}><option value="x">x (indeterminado)</option><option value="a">a (anterior)</option><option value="p">p (posterior)</option></select></div>
      <div style={{ ...scoreBox }}>
        <div style={{ fontSize: 28, fontWeight: 700, color }}>{total}{ap}<span style={{ fontSize: 16, color: "var(--texto-sec)" }}> / 12</span></div>
        <div style={{ fontSize: "var(--fs-2)", fontWeight: 600, color: "var(--texto)", marginTop: 2 }}>{compl}</div>
      </div>
    </div>
  );
}

// Coeficientes del nomograma de Briganti. VACÍOS a propósito: deben cargarse
// desde la publicación oficial (Briganti 2012, Eur Urol; Gandaglia/Briganti 2019)
// antes de calcular un % real. Mientras estén en null, la calculadora recoge los
// datos y muestra el punto de corte validado, pero no inventa una probabilidad.
const BRIGANTI_COEF = { "2012": null, "2019": null };

function ScoreBriganti() {
  const [ver, setVer] = useState("2019");
  const [psa, setPsa] = useState("");
  const [t, setT] = useState("cT1c");
  const [isup, setIsup] = useState("1");
  const [cores, setCores] = useState("");       // % cores positivos (2012) / cores positivos+negativos (2019)
  const cutoff = ver === "2012" ? "5 %" : "7 %";
  const coef = BRIGANTI_COEF[ver];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 6 }}>
        {["2012", "2019"].map(v => (
          <button key={v} onClick={() => setVer(v)} style={{ flex: 1, padding: "8px", fontSize: "var(--fs-2)", fontWeight: 600, borderRadius: 8, cursor: "pointer", border: ver === v ? "none" : "0.5px solid var(--borde)", background: ver === v ? "var(--primario)" : "var(--superficie)", color: ver === v ? "var(--texto-inv)" : "var(--primario)" }}>Briganti {v}</button>
        ))}
      </div>

      <div><label style={lblScore}>PSA (ng/mL)</label><input value={psa} onChange={e => setPsa(e.target.value)} placeholder="Ej: 8.5" style={{ ...selScore, cursor: "text" }} /></div>
      <div><label style={lblScore}>Estadio clínico (cT)</label>
        <select value={t} onChange={e => setT(e.target.value)} style={selScore}>
          <option value="cT1c">cT1c</option><option value="cT2a">cT2a</option><option value="cT2b">cT2b</option><option value="cT2c">cT2c</option><option value="cT3">cT3</option>
        </select></div>
      <div><label style={lblScore}>ISUP (grupo grado biopsia)</label>
        <select value={isup} onChange={e => setIsup(e.target.value)} style={selScore}>
          <option value="1">ISUP 1</option><option value="2">ISUP 2</option><option value="3">ISUP 3</option><option value="4">ISUP 4</option><option value="5">ISUP 5</option>
        </select></div>
      <div><label style={lblScore}>{ver === "2012" ? "% de cilindros positivos" : "% de cilindros positivos (o positivos/total)"}</label><input value={cores} onChange={e => setCores(e.target.value)} placeholder="Ej: 40" style={{ ...selScore, cursor: "text" }} /></div>

      {coef ? (
        <div style={scoreBox}>{/* Aquí iría el % calculado cuando se carguen los coeficientes */}</div>
      ) : (
        <div style={{ background: "var(--alerta-bg)", border: "0.5px solid var(--alerta)", borderRadius: 10, padding: "12px 13px" }}>
          <div style={{ fontSize: "var(--fs-2)", fontWeight: 600, color: "var(--alerta)", marginBottom: 4 }}>⚠️ Falta cargar los coeficientes de Briganti {ver}</div>
          <div style={{ fontSize: "var(--fs-1)", color: "var(--texto-sec)", lineHeight: 1.5 }}>
            Para no arriesgar un % incorrecto en una decisión de linfadenectomía, la probabilidad exacta requiere los coeficientes de la publicación oficial. Punto de corte validado sugerido para omitir ePLND: <strong>&lt; {cutoff}</strong>.
          </div>
        </div>
      )}
      <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)", lineHeight: 1.5 }}>Pásame los coeficientes de la versión que uses y activo el cálculo del % exacto aquí mismo.</div>
    </div>
  );
}

// Saludo inicial de Uros — 30 variantes que rotan al azar cada vez que se entra.
// {n} se reemplaza por el primer nombre de la persona.
const SALUDOS_UROS = [
  "👋 Hola {n}. Soy Uros, tu asistente clínico. ¿En qué te puedo ayudar?",
  "👋 ¡Qué bueno verte, {n}! Soy Uros. ¿Con qué partimos hoy?",
  "🩺 Hola {n}. Uros a la orden. ¿Qué necesitas revisar?",
  "👋 ¡Hola, {n}! ¿En qué caso andas trabajando hoy?",
  "😊 Buenas, {n}. Soy Uros. Pregúntame lo que necesites.",
  "👋 Hola {n}. ¿Vemos algún paciente o una duda clínica?",
  "🔎 Hola {n}, soy Uros. ¿Qué buscamos hoy?",
  "👋 ¡Listo para ayudarte, {n}! ¿Por dónde empezamos?",
  "🩺 Hola {n}. Cuéntame en qué te doy una mano.",
  "👋 ¡Hola de nuevo, {n}! ¿Qué tienes entre manos?",
  "😊 Hola {n}, soy Uros. Aquí estoy para lo que necesites.",
  "👋 Buenas, {n}. ¿Una consulta rápida o algo más largo?",
  "📋 Hola {n}. ¿Revisamos guías, pacientes o logbook?",
  "👋 ¡Hey, {n}! Soy Uros. Dispara tu pregunta.",
  "🩺 Hola {n}, ¿en qué anda la urología hoy?",
  "👋 ¡Hola, {n}! ¿Te ayudo con una duda clínica?",
  "😊 Qué tal, {n}. Soy Uros, tu copiloto clínico.",
  "👋 Hola {n}. Estoy listo cuando tú lo estés.",
  "🔬 Buenas, {n}. ¿Qué caso analizamos?",
  "👋 ¡Hola, {n}! Cuéntame qué necesitas resolver.",
  "🩺 Hola {n}, soy Uros. ¿Partimos con una consulta?",
  "👋 ¡Bienvenido de vuelta, {n}! ¿En qué te apoyo?",
  "😊 Hola {n}. Pregunta con confianza, para eso estoy.",
  "👋 Buenas, {n}. ¿Vemos algo de litiasis, próstata, o…?",
  "📖 Hola {n}, soy Uros. ¿Estudiamos o consultamos?",
  "👋 ¡Hola, {n}! ¿Qué duda te trajo por aquí?",
  "🩺 Qué gusto, {n}. Dime en qué te ayudo.",
  "👋 Hola {n}. Tu asistente de urología, listo.",
  "😊 ¡Hola, {n}! ¿Revisamos algún caso?",
  "👋 Buenas, {n}. Aquí Uros. ¿Qué necesitas hoy?",
  "🔬 Hola {n}. ¿Alguna duda de manejo o diagnóstico?",
  "👋 ¡Hola, {n}! ¿Te ayudo a preparar una cirugía?",
  "🩺 Qué tal, {n}. ¿Vemos una guía o un score?",
  "👋 Hola {n}. ¿Buscamos evidencia para un caso?",
  "😊 ¡Hola, {n}! ¿Repasamos algo de oncología uro?",
  "📋 Buenas, {n}. ¿Ordenamos tu logbook o vemos métricas?",
  "👋 Hola {n}, soy Uros. ¿Consultamos algo puntual?",
  "🔎 ¡Hola, {n}! ¿Qué te gustaría profundizar hoy?",
  "🩺 Hola {n}. Tu apoyo en urología, cuando lo necesites.",
];
function saludoAleatorio(nombre) {
  const primer = (nombre || "").split(" ")[0] || "";
  const base = SALUDOS_UROS[Math.floor(Math.random() * SALUDOS_UROS.length)];
  return base.replace("{n}", primer).replace(" .", ".").replace("  ", " ");
}

// Saludo inicial de Uros (texto plano para el chat)
function saludoUros(nombre) {
  return saludoAleatorio(nombre);
}
const MAX_CONVERSACIONES = 20; // máximo por usuario; al superarlo se eliminan las más antiguas

const PRESET_MAPS = {
  "Cáncer de próstata": { titulo: "Cáncer de próstata", nodo_central: "Ca. Próstata", ramas: [
    { rama: "Diagnóstico", subnodos: ["PSA", "TR", "Biopsia TRUS/Fusion", "mpRMN"] },
    { rama: "Estadificación", subnodos: ["TNM", "Gleason/ISUP", "D'Amico", "PSMA-PET"] },
    { rama: "Tx localizado", subnodos: ["Prostatectomía radical", "RT externa", "Braquiterapia", "Vigilancia activa"] },
    { rama: "Tx avanzado", subnodos: ["Privación androgénica", "Enzalutamida", "Abiraterona", "ARSI"] },
    { rama: "Seguimiento", subnodos: ["PSA post-Tx", "Recurrencia bioquímica", "Terapia de rescate"] }
  ]},
  "Nefrostomía percutánea": { titulo: "Nefrostomía percutánea", nodo_central: "NPC", ramas: [
    { rama: "Indicaciones", subnodos: ["Uropatía obstructiva", "Pionefrosis", "Acceso a procedimientos", "Fístula urinaria"] },
    { rama: "Técnica", subnodos: ["Guía ecográfica", "Guía fluoroscópica", "Acceso caliceal inferior", "Dilatación Amplatz"] },
    { rama: "Complicaciones", subnodos: ["Hematoma", "Infección", "Migración catéter", "Fístula AV"] },
    { rama: "Cuidados post", subnodos: ["Fijación catéter", "Irrigación", "Cambio programado", "Vigilancia débito"] }
  ]},
  "Litiasis renal": { titulo: "Litiasis renal", nodo_central: "Litiasis renal", ramas: [
    { rama: "Diagnóstico", subnodos: ["Urotac sin contraste", "Rx simple", "Ecografía", "Composición química"] },
    { rama: "Clasificación", subnodos: ["Tamaño", "Localización", "Composición", "STONE score"] },
    { rama: "Tratamiento", subnodos: ["LEOC", "URS flexible", "NLP", "TME"] },
    { rama: "Metafilaxis", subnodos: ["Hidratación", "Dieta", "Citrato potásico", "Según composición"] }
  ]}
};

const VERSION = "v1.10.0";
const ESPECIALIDADES = ["Urología", "Medicina General", "Cirugía", "Nefrología", "Trasplantología", "Residente Urología", "Interno", "Otro"];

// ─── Perfiles / roles y permisos ───────────────────────────────
// admin: todo · urologo/residente: clínico completo · interno: estudio+chat, Hospital SOLO LECTURA
// enfermeria: chat + Hospital (sin Biblioteca)
const ROLES_ASIGNABLES = [["urologo","Urólogo/a"],["residente","Residente"],["interno","Interno/a"],["enfermeria","Enfermería"]];
const ROL_LABEL = { admin:"Administrador", urologo:"Urólogo/a", residente:"Residente", interno:"Interno/a", enfermeria:"Enfermería" };
function tabsPorRol(rol, pendientesCount = 0) {
  const chat = ["chat","Chat"];
  const hospital = ["hospital","Hospital"];
  const biblio = ["conocimiento","Biblioteca"];
  const logbook = ["logbook","Logbook"];
  if (rol === "admin") return [["admin",`Cuentas${pendientesCount>0?` (${pendientesCount})`:""}`], chat, hospital, logbook, biblio];
  if (rol === "enfermeria") return [chat, hospital];              // sin Biblioteca ni Logbook
  return [chat, hospital, logbook, biblio];                       // urologo, residente, interno
}

const ADMIN_ACCOUNT = { nombre: "Dr. Sebastián (Admin)", correo: "admin@urosearch.cl", password: "admin2026", especialidad: "Urología", rol: "admin", estado: "aprobado" };


const CATEGORIAS_VIDEO = ["Todas", "Oncología", "Litiasis", "Derivaciones", "Trasplante", "Funcional", "Otros"];
const CATEGORIAS_KB = ["Guías clínicas", "Protocolos HBV", "Apuntes propios", "Papers", "Casos clínicos", "Otro"];

function getYouTubeId(url) {
  if (!url) return null;
  const patterns = [/youtube\.com\/watch\?v=([^&]+)/, /youtu\.be\/([^?]+)/, /youtube\.com\/embed\/([^?]+)/];
  for (const p of patterns) { const m = url.match(p); if (m) return m[1]; }
  return null;
}
function getVimeoId(url) {
  if (!url) return null;
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return m ? m[1] : null;
}
function VideoThumb({ url, style }) {
  const [thumb, setThumb] = useState(null);
  const ytId = getYouTubeId(url);
  const vimeoId = getVimeoId(url);

  useEffect(() => {
    if (ytId) {
      setThumb(`https://img.youtube.com/vi/${ytId}/mqdefault.jpg`);
    } else if (vimeoId) {
      fetch(`https://vimeo.com/api/oembed.json?url=https://vimeo.com/${vimeoId}`)
        .then(r => r.json())
        .then(d => setThumb(d.thumbnail_url))
        .catch(() => setThumb(null));
    }
  }, [url]);

  if (!thumb) return null;
  return <img src={thumb} alt="" style={style} />;
}

// Trocea un texto en chunks de ~tamano caracteres, respetando límites de párrafo/frase
// y con un pequeño solapamiento para no cortar ideas a la mitad.
function trocearTexto(texto, tamano = 1500, solape = 200) {
  if (!texto) return [];
  const limpio = texto.replace(/\r/g, "");
  if (limpio.length <= tamano) return [limpio.trim()].filter(Boolean);
  const chunks = [];
  let inicio = 0;
  while (inicio < limpio.length) {
    let fin = Math.min(inicio + tamano, limpio.length);
    if (fin < limpio.length) {
      const ventana = limpio.slice(inicio, fin);
      const ultimoParrafo = ventana.lastIndexOf("\n\n");
      const ultimoPunto = ventana.lastIndexOf(". ");
      let corte = -1;
      if (ultimoParrafo > tamano * 0.5) corte = ultimoParrafo + 2;
      else if (ultimoPunto > tamano * 0.5) corte = ultimoPunto + 2;
      if (corte > 0) fin = inicio + corte;
    }
    const pedazo = limpio.slice(inicio, fin).trim();
    if (pedazo) chunks.push(pedazo);
    if (fin >= limpio.length) break;
    inicio = fin - solape;
    if (inicio < 0) inicio = 0;
  }
  return chunks;
}

function buscarEnConocimiento(consulta, documentos, maxDocs = 3) {
  if (!documentos || documentos.length === 0) return [];
  const stopwords = new Set(["para","como","cual","cuales","cuando","donde","que","quien","con","por","del","las","los","una","uno","desde","hasta","sobre","entre","muy","mas","menos","pero","sino","aunque","porque","esto","esta","ese","esa","este","tan","tanto","todo","toda","cada","ser","estar","tener","puede","debe","entonces","luego","ademas","tambien","ahora","aqui","si","no","es","son","fue","fueron","han","ha","habia","yo","tu","el","ella","mi","su","sus"]);
  const consultaNorm = consulta.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const palabras = consultaNorm.replace(/[¿?¡!.,;:()"'`]/g,"").split(/\s+/).filter(p => p.length > 2 && !stopwords.has(p));
  if (palabras.length === 0) return [];
  const puntuados = documentos.map(doc => {
    const tituloN = doc.titulo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    const contN = (doc.contenido||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    const tagsN = (Array.isArray(doc.tags) ? doc.tags : []).join(" ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    let score = 0;
    palabras.forEach(p => {
      const raiz = p.length > 5 ? p.slice(0, p.length - 2) : p;
      const re = new RegExp(raiz, "gi");
      if (tituloN.match(re)) score += 10;
      if (tagsN.match(re)) score += 5;
      const matches = (contN.match(re) || []).length;
      score += matches;
    });
    return { ...doc, score };
  });
  const conScore = puntuados.filter(d => d.score >= 20);
  if (conScore.length === 0) return [];
  return conScore.sort((a,b) => b.score - a.score).slice(0, maxDocs);
}

// Íconos SVG coherentes para las pestañas: forma redondeada y trazo grueso,
// con relleno suave (duotono), en el mismo azul que usa la campana de notificaciones.
function IconoTab({ tipo, activo }) {
  const trazo = activo ? "var(--primario)" : "var(--texto-sec)";
  const relleno = activo ? "var(--chip-azul-bg)" : "none";
  const p = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: trazo, strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round", style: { flexShrink: 0 } };
  switch (tipo) {
    case "chat":
      return <svg {...p}>
        <path d="M4 12a8 8 0 1 1 3.5 6.6L4 20l1-3.2A8 8 0 0 1 4 12z" fill={relleno}/>
        <circle cx="9" cy="12" r="1" fill={trazo} stroke="none"/><circle cx="12" cy="12" r="1" fill={trazo} stroke="none"/><circle cx="15" cy="12" r="1" fill={trazo} stroke="none"/>
      </svg>;
    case "hospital":
      return <svg {...p}>
        <path d="M5 20V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v12" fill={relleno}/>
        <path d="M3 20h18"/>
        <path d="M12 9v4M10 11h4"/>
      </svg>;
    case "logbook":
      return <svg {...p}>
        <path d="M6 4h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1 0-4h11" fill={relleno}/>
        <path d="M10 9h5" strokeWidth={2}/>
      </svg>;
    case "conocimiento":
      return <svg {...p}>
        <path d="M5 5a2 2 0 0 1 2-2h11v16H7a2 2 0 0 0-2 2z" fill={relleno}/>
        <path d="M9 8h6" strokeWidth={2}/>
      </svg>;
    case "admin":
      return <svg {...p}>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" fill={relleno}/>
        <circle cx="12" cy="7" r="4" fill={relleno}/>
      </svg>;
    default: return null;
  }
}

function LogoUroSearch({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 50 50">
      <circle cx="25" cy="25" r="23.5" fill="#fff" stroke="var(--primario-osc)" strokeWidth="2"/>
      <path d="M 15 11 C 10 11, 8 14, 8 19 C 8 24, 10 27, 15 27 C 17.5 27, 19 26, 19.5 24 C 20 21, 20 16, 19.5 13.5 C 19 12, 17.5 11, 15 11 Z" fill="var(--primario-osc)"/>
      <path d="M 17 27 C 19 30, 16 33, 18.5 36 C 21 39, 23 40, 25 42" stroke="var(--primario-osc)" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
      <path d="M 35 11 C 40 11, 42 14, 42 19 C 42 24, 40 27, 35 27 C 32.5 27, 31 26, 30.5 24 C 30 21, 30 16, 30.5 13.5 C 31 12, 32.5 11, 35 11 Z" fill="var(--primario-claro)"/>
      <path d="M 33 27 C 31 30, 34 33, 31.5 36 C 29 39, 27 40, 25 42" stroke="var(--primario-claro)" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
      <path d="M 19 43 C 19 41.5, 21 40.5, 25 40.5 C 22 42, 28 45.5, 25 47 C 21 47, 19 45.5, 19 43 Z" fill="var(--primario-osc)"/>
      <path d="M 31 43 C 31 41.5, 29 40.5, 25 40.5 C 22 42, 28 45.5, 25 47 C 29 47, 31 45.5, 31 43 Z" fill="var(--primario-claro)"/>
    </svg>
  );
}

// ============================================================
// MASCOTA "Uros" — poses en /public/uros/{expresion}.webp
// Expresiones: hola · pensando · guinando · estudiando · bienhecho
//              explicando · hero · frente · lateral · tres-cuartos · espalda
// Solo decorativa: se usa en momentos "blandos" (bienvenida, saludo,
// carga, estados vacíos), nunca sobre datos clínicos.
// ============================================================
const UROS_VERSION = "8"; // súbelo cada vez que reemplaces imágenes, para forzar recarga
const UROS_BASE = `${import.meta.env.BASE_URL || "/"}uros/`;
const urosSrc = (name) => `${UROS_BASE}${name}.webp?v=${UROS_VERSION}`;
// Detecta pantallas angostas (celular) para adaptar layouts inline.
function useIsMobile(breakpoint = 640) {
  const [movil, setMovil] = useState(() => (typeof window !== "undefined" ? window.innerWidth <= breakpoint : false));
  useEffect(() => {
    const onResize = () => setMovil(window.innerWidth <= breakpoint);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);
  return movil;
}
function Uros({ expresion = "hola", size = 96, alt = "", style = {} }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null; // tolerante: si falta el asset, no rompe la UI
  return (
    <img
      src={urosSrc(expresion)}
      alt={alt || `Uros ${expresion}`}
      width={size}
      onError={() => setOk(false)}
      style={{ height: "auto", display: "block", userSelect: "none", pointerEvents: "none", ...style }}
      draggable={false}
    />
  );
}
// Avatar circular (cabeza) para el chat. Cae al logo SVG si falta el asset.
function UrosAvatar({ size = 30 }) {
  const [ok, setOk] = useState(true);
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: "var(--primario)", flexShrink: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {ok
        ? <img src={urosSrc("cabeza")} alt="Uros" width={size} height={size} onError={() => setOk(false)} style={{ width: size, height: size, objectFit: "cover" }} draggable={false} />
        : <LogoUroSearch size={Math.round(size * 0.72)} />}
    </div>
  );
}
// Portada del chat: figura hero + saludo. Se muestra al entrar a la pestaña Chat.
function PortadaChat({ nombre }) {
  const movil = useIsMobile();
  // Un saludo al azar, fijo mientras la portada esté montada
  const saludo = useMemo(() => saludoAleatorio(nombre), [nombre]);

  // En móvil: apilado (Uros arriba grande, mensaje abajo, colita hacia arriba).
  // En escritorio: en fila (mensaje a la izquierda, Uros a la derecha, colita al lado).
  const bubbleTail = movil
    ? { position:"absolute", left:"50%", top:-8, transform:"translateX(-50%) rotate(-45deg)",
        width:16, height:16, background:"var(--superficie)",
        borderTop:"1.5px solid var(--borde)", borderRight:"1.5px solid var(--borde)" }
    : { position:"absolute", right:-8, top:"50%", transform:"translateY(-50%) rotate(45deg)",
        width:16, height:16, background:"var(--superficie)",
        borderTop:"1.5px solid var(--borde)", borderRight:"1.5px solid var(--borde)" };

  return (
    <div style={{
      display:"flex",
      flexDirection: movil ? "column" : "row",
      alignItems:"center", justifyContent:"center",
      gap: movil ? 4 : 0,
      padding: movil ? "12px 12px 8px" : "20px 4px 8px",
      minHeight:"48vh"
    }}>
      <Uros
        expresion="hola"
        size={movil ? 220 : 260}
        style={ movil
          ? { order:1, flex:"0 0 auto", width:"auto", maxWidth:"72%", maxHeight:"34vh" }
          : { order:2, flex:"0 0 auto", width:"auto", maxWidth:"46%", maxHeight:"46vh", marginLeft:4 } }
      />

      <div style={{
        order: movil ? 2 : 1,
        position:"relative",
        padding: movil ? "18px 20px" : "26px 30px",
        borderRadius:"22px",
        background:"var(--superficie)",
        border:"1.5px solid var(--borde)",
        fontSize: movil ? 16 : 22,          // en celular el texto ya no se ve gigante
        lineHeight:1.5,
        color:"var(--texto)",
        maxWidth: movil ? "92%" : 440,
        boxShadow:"0 10px 28px rgba(37,99,235,.15)"
      }}>
        {saludo}
        <div style={bubbleTail} />
      </div>
    </div>
  );
}
// ============================================================
// TUTORIAL / ONBOARDING (modal de bienvenida + tips sobre botones reales)
// ============================================================
const TUTORIAL_VERSION = "1"; // súbelo si quieres re-mostrarlo a todos en una versión futura

// Pasos del tour. target = data-tour del elemento a resaltar (si falta, se muestra centrado).
// tab = pestaña que debe estar activa para que el elemento exista.
function pasosTutorial(rol, movil = false) {
  const base = [
    { uros: "hero", titulo: "¡Hola! Soy Uros 👋", texto: "Tu asistente clínico de urología. Te muestro las secciones principales en un par de minutos." },

    // ─── RECORDATORIO ───
    { uros: "pabellon_serio", titulo: "⚠️ Un recordatorio", texto: "Soy apoyo clínico, no reemplazo tu juicio médico ni la evaluación individual de cada paciente. Verifica siempre la información crítica." },

    // ─── CHAT ───
    { target: "tab-chat", tab: "chat", uros: "hola", titulo: "Chat clínico", texto: "Escribe tu consulta y te respondo con apoyo basado en guías clínicas." },
    { target: "modo-respuesta", tab: "chat", uros: "pensando", titulo: "Elige el tono", texto: "«Precisa» da respuestas breves y al grano; «Explicativa» las desarrolla con más detalle." },

    // ─── HOSPITAL ───
    { target: "tab-hospital", tab: "hospital", uros: "hola", titulo: "Hospital", texto: "Aquí gestionas tus pacientes, la tabla quirúrgica y las notas. Al entrar quedas en la pestaña «Pacientes»." },
    { target: "tab-hospital", tab: "hospital", subtab: "pacientes", uros: "hola", titulo: "Secciones de Hospital", texto: "Toca de nuevo la pestaña Hospital y se despliega el menú con 👥 Pacientes · 📋 Tabla · 🗒️ Notas · 💊 Recetas · 📄 Interconsultas · 🔄 Seguimiento, y el cambio entre tus pacientes y los del equipo." },
    ...(movil ? [{ tab: "hospital", subtab: "pacientes", uros: "point", titulo: "Gestos: moverte sin tocar los menús", texto: "Desliza el dedo hacia los lados para cambiar de pestaña, y hacia abajo (estando arriba del todo) para abrir el menú de la pestaña en la que estés." }] : []),
    { tab: "hospital", subtab: "pacientes", uros: "point", titulo: "El menú de servicios", texto: "El botón «Todos los servicios ▾» abre un menú: elige un servicio para ver solo esos pacientes, filtra por estado (activos, operados, sin operar, de alta) y, en equipo, mira cuántos pacientes tiene cada médico." },
    { tab: "hospital", subtab: "pacientes", uros: "pensativo", titulo: "Ordena los servicios a tu manera", texto: "En «Administrar servicios», deja presionado el ☰ de un servicio y arrástralo a su lugar. En un equipo, el orden y la lista se comparten con todos." },
    { tab: "hospital", subtab: "interconsultas", uros: "camara", titulo: "📄 Interconsultas", texto: "Fotografía las interconsultas que te llegan: Uros lee el documento y llena los campos. Después, en el menú de Hospital, «Métricas de interconsultas» te muestra de qué servicios vienen, por qué motivos y cuántas resolviste." },

    // ─── SEGUIMIENTO ───
    { tab: "hospital", subtab: "seguimiento", uros: "point", titulo: "🔄 Seguimiento de pacientes", texto: "Aquí creas tus propios criterios de control: «Vigilancia activa cáncer testicular», «Seguimiento post-RTU vesical», o el que necesites. Tú defines cada cuánto se controla." },
    { tab: "hospital", subtab: "seguimiento", uros: "sorprendido", titulo: "Te avisa antes de que se pase", texto: "Cada paciente se pinta según su próximo control: 🟢 al día, 🟡 por vencer, 🔴 atrasado. Puedes ordenarlos por urgencia o por los más antiguos, para que nadie se te quede atrás." },
    { tab: "hospital", subtab: "seguimiento", uros: "camara", titulo: "Registra con una foto", texto: "Igual que en el resto: fotografías el control o el examen y Uros extrae paciente, diagnóstico y hallazgos. Al marcar «Controlado hoy», la fecha del próximo control se calcula sola." },
    { tab: "hospital", subtab: "seguimiento", uros: "explicando", titulo: "Y puedes preguntarme", texto: "En el chat puedes pedirme «¿qué pacientes tengo con el control atrasado?» y te respondo con tus pacientes reales en seguimiento." },
    { tab: "hospital", subtab: "pacientes", demo: "pac-tools", uros: "pensando", titulo: "Herramientas de Pacientes", texto: "En el menú de Hospital, la opción 🛠️ Herramientas muestra esta barra:" },
    { tab: "hospital", subtab: "pacientes", demo: "ficha", uros: "explicando", titulo: "La ficha del paciente", texto: "Al abrir un paciente ves su ficha completa (ejemplo ficticio), más sus evoluciones SOAP y exámenes:" },
    { tab: "hospital", subtab: "pacientes", demo: "colores", uros: "guinando", titulo: "Los colores", texto: "En la lista y en la ficha, un ícono resume de un vistazo el estado clínico:" },
    { tab: "hospital", subtab: "tabla", demo: "tabla-tools", uros: "pensando", titulo: "Tabla quirúrgica", texto: "En «Tabla» programas las cirugías. Toca de nuevo la pestaña para ver su barra:" },
    { tab: "hospital", subtab: "notas", demo: "notas", uros: "explicando", titulo: "Notas", texto: "Notas rápidas del contexto actual. Ejemplo:" },
    { target: "selector-contexto", tab: "hospital", subtab: "pacientes", uros: "hola", titulo: "Personal ↔ Equipo", texto: "Este botón cambia entre 👤 «Mis Pacientes» y 👥 un equipo. Pacientes, tabla y notas se muestran según el contexto elegido aquí." },

    // ─── BIBLIOTECA ───
    { target: "tab-conocimiento", tab: "conocimiento", uros: "investigando", titulo: "Biblioteca", texto: "Material para estudiar y consultar rápido: protocolos quirúrgicos, videos y preguntas." },
    { target: "tab-conocimiento", tab: "conocimiento", subtab: "cirugias", uros: "hola", titulo: "Secciones de Biblioteca", texto: "Toca de nuevo la pestaña Biblioteca y se despliega: 🔪 Cirugías · 📚 Videos · ❓ Preguntas · 💊 Medicamentos · 🧮 Scores." },
    { tab: "conocimiento", subtab: "cirugias", demo: "protocolo", uros: "pizarra", titulo: "Protocolos quirúrgicos", texto: "Al abrir un protocolo (ej. Prostatectomía Radical) encuentras, ordenado por secciones:" },
    { tab: "conocimiento", subtab: "videos", demo: "videos", uros: "hola", titulo: "Videos", texto: "Videos quirúrgicos y de guías por categoría. Toca uno para reproducirlo dentro de la app." },
    { tab: "conocimiento", subtab: "preguntas", demo: "pregunta", uros: "guinando", titulo: "Preguntas", texto: "Autoevaluación tipo test. Al elegir una alternativa ves el feedback al instante:" },
    { tab: "conocimiento", subtab: "preguntas", uros: "point", titulo: "📊 Mi progreso", texto: "En «Mi progreso» (dentro de Preguntas) se va acumulando tu rendimiento y te muestro en qué temas estás más débil, para que sepas qué reforzar." },

    // ─── LOGBOOK ───
    { target: "tab-logbook", tab: "logbook", uros: "pabellon", titulo: "📓 Logbook quirúrgico", texto: "Tu registro personal de cirugías, aparte de la tabla del pabellón. Sirve para tu casuística: cada procedimiento con tu rol, hallazgos y complicaciones." },
    { target: "tab-logbook", tab: "logbook", uros: "point", titulo: "Secciones del Logbook", texto: "Toca de nuevo la pestaña Logbook y se despliega: 📋 Registros · 📷 Nueva · 📊 Métricas, más 🔗 Compartir con tu equipo." },
    { tab: "logbook", uros: "camara", titulo: "Registra con una foto", texto: "En «Nueva» fotografías el protocolo operatorio y Uros extrae los datos: procedimiento, rol, diagnóstico, hallazgos. Solo revisas y guardas." },
    { tab: "logbook", uros: "escribiendo", titulo: "Complementa después", texto: "Puedes volver a un registro para agregar la biopsia (con ISUP) o el control con imagen (si quedó stone free). Así tu casuística queda completa." },
    { tab: "logbook", uros: "pulgar", titulo: "Tus métricas", texto: "En «Métricas» ves, por procedimiento: cuántas hiciste como cirujano o ayudante, duración, sangrado, tamaños y stone free. Exportable a CSV para tu trabajo de congreso." },

    { uros: "pulgar", titulo: "🤝 Equipos", texto: "El trabajo en equipo se maneja desde tu menú, arriba a la derecha: ahí creas equipos, invitas gente y aceptas invitaciones. Lo que registres en un equipo lo ven todos sus miembros." },

    { uros: "hero", titulo: "¡Listo! 🎉", texto: "Puedes volver a ver este tutorial cuando quieras desde tu menú, arriba a la derecha." },
  ];
  // Enfermería no ve Biblioteca ni Logbook; internos sí. Filtramos pasos cuyo tab no aplica.
  const tabsFuera = rol === "enfermeria" ? ["conocimiento", "logbook"] : [];
  return base.filter(p => !p.tab || !tabsFuera.includes(p.tab));
}

// Puente para que el tutorial cambie la sub-pestaña dentro de Hospital / Biblioteca.
// Los paneles escuchan este evento y ajustan su estado interno de subTab.
function tourIrSubtab(subtab) {
  if (!subtab) return;
  try { window.dispatchEvent(new CustomEvent("uro-tour-subtab", { detail: { subtab } })); } catch {}
}

// Mini-ilustraciones anotadas que se muestran dentro de la burbuja del tutorial.
// Son maquetas (no datos reales) para explicar cada sección sin depender de que
// el usuario ya tenga pacientes/cirugías cargados.
function DemoTutorial({ tipo }) {
  const caja = { border: "0.5px solid var(--borde)", borderRadius: 10, padding: "10px 12px", background: "var(--fondo-suave)", marginTop: 4 };
  const btn = (label, primary) => (
    <span style={{ fontSize: "var(--fs-0)", fontWeight: 500, padding: "5px 10px", borderRadius: 6, whiteSpace: "nowrap", border: "0.5px solid var(--borde)", background: primary ? "var(--primario)" : "var(--superficie)", color: primary ? "var(--texto-inv)" : "var(--primario)" }}>{label}</span>
  );
  const sel = (label) => (
    <span style={{ fontSize: "var(--fs-0)", padding: "5px 10px", borderRadius: 6, border: "0.5px solid var(--borde)", background: "var(--superficie)", color: "var(--texto)" }}>{label} ▾</span>
  );
  const fila = (et, val, nota) => (
    <div style={{ display: "flex", gap: 8, padding: "5px 0", borderBottom: "0.5px solid var(--borde)" }}>
      <div style={{ fontSize: "var(--fs-0)", fontWeight: 600, color: "var(--texto-sec)", minWidth: 92, flexShrink: 0 }}>{et}</div>
      <div style={{ fontSize: "var(--fs-0)", color: "var(--texto)", flex: 1 }}>{val}{nota && <span style={{ color: "var(--texto-ter)" }}> — {nota}</span>}</div>
    </div>
  );

  if (tipo === "pac-tools") {
    return (
      <div style={caja}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {btn("⚙️ Servicios")}{btn("+ Nuevo", true)}{sel("Todos los servicios")}{sel("Solo activos")}
        </div>
        <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-sec)", lineHeight: 1.6 }}>
          <b>⚙️ Servicios:</b> crea y gestiona tus servicios (Uro-A, UCI, etc.).<br />
          <b>+ Nuevo:</b> agrega un paciente.<br />
          <b>Todos los servicios:</b> filtra la lista por servicio.<br />
          <b>Solo activos:</b> muestra hospitalizados / dados de alta / todos.
        </div>
      </div>
    );
  }

  if (tipo === "ficha") {
    return (
      <div style={caja}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <span style={{ fontSize: "var(--fs-3)", fontWeight: 700, color: "var(--texto)" }}>J.P.G.</span>
          <span style={{ fontSize: "var(--fs-3)", fontWeight: 700, color: "var(--primario)" }}>♂</span>
          <span title="Estable">🟢</span><span title="Operado">🔪</span>
          <span style={{ fontSize: "var(--fs-0)", color: "var(--texto-sec)", marginLeft: "auto" }}>Cama 12 · Uro-A · Hospitalizado</span>
        </div>
        {fila("Ingreso", "12-05-2026", "día 3 post-op")}
        {fila("Diagnóstico", "Litiasis ureteral izq. obstructiva")}
        {fila("Antecedentes", "HTA · DM2")}
        {fila("Alergias", "Penicilina")}
        {fila("Estado clínico", "🟢 Estable")}
        {fila("Operado", "🔪 URS + láser Holmium")}
        <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)", marginTop: 8, lineHeight: 1.5 }}>
          Más abajo en la ficha: <b>Evoluciones SOAP</b> (con Diuresis/Drenaje) y <b>Exámenes</b> (labs, imágenes) con constructores estructurados.
        </div>
      </div>
    );
  }

  if (tipo === "colores") {
    return (
      <div style={caja}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", background: "var(--superficie)", border: "0.5px solid var(--borde)", borderRadius: 8, marginBottom: 10 }}>
          <span style={{ fontWeight: 700, color: "var(--texto)", fontSize: "var(--fs-2)" }}>J.P.G.</span>
          <span style={{ color: "var(--primario)", fontWeight: 700 }}>♂</span>
          <span>🟢</span><span>🔪</span>
          <span style={{ fontSize: "var(--fs-0)", color: "var(--texto-sec)", marginLeft: "auto" }}>Cama 12</span>
        </div>
        <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-sec)", lineHeight: 1.7 }}>
          🟢 <b>Estable</b> &nbsp; 🟡 <b>Regular</b> &nbsp; 🔴 <b>De cuidado</b><br />
          🔪 <b>Operado</b> &nbsp;·&nbsp; ♂ / ♀ <b>sexo</b>
        </div>
      </div>
    );
  }

  if (tipo === "tabla-tools") {
    return (
      <div style={caja}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {btn("📊 Importar Excel")}{btn("+ Nueva", true)}{sel("🗓️ Vista")}
        </div>
        <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-sec)", lineHeight: 1.6 }}>
          <b>📊 Importar Excel:</b> carga varias cirugías de una planilla.<br />
          <b>+ Nueva:</b> agrega una cirugía (fecha, hora, paciente, procedimiento, cirujano, pabellón).<br />
          <b>🗓️ Mensual / 📅 Semanal / ☰ Lista:</b> tres modos de ver la tabla (usa ‹ › para cambiar de mes o semana).<br />
          <span style={{ color: "var(--texto-ter)" }}>Al abrir una cirugía ves fecha, pabellón, cirujano, ayudante y observaciones.</span>
        </div>
      </div>
    );
  }

  if (tipo === "notas") {
    return (
      <div style={caja}>
        <div style={{ padding: "8px 10px", background: "var(--superficie)", border: "0.5px solid var(--borde)", borderRadius: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: "var(--fs-1)", fontWeight: 600, color: "var(--texto)" }}>UROTAC de control</span>
            <span style={{ fontSize: "var(--fs-xs)", padding: "1px 8px", borderRadius: 20, background: "var(--fondo-suave)", border: "0.5px solid var(--borde)", color: "var(--exito)", marginLeft: "auto" }}>👥 Equipo</span>
          </div>
          <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-sec)", lineHeight: 1.5 }}>Solicitar UROTAC de control en 3 meses para el paciente de cama 12 tras retiro de catéter JJ.</div>
        </div>
        <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)", marginTop: 8, lineHeight: 1.5 }}>
          Cada nota puede ser <b>👥 Equipo</b> (la ve todo el equipo) o <b>👤 Personal</b> (solo tú). Título opcional.
        </div>
      </div>
    );
  }

  if (tipo === "protocolo") {
    const secs = ["Descripción", "Indicaciones", "Contraindicaciones", "Preparación", "Técnica (pasos)", "Postoperatorio", "Complicaciones", "Duración y anestesia"];
    return (
      <div style={caja}>
        <div style={{ fontSize: "var(--fs-2)", fontWeight: 700, color: "var(--texto)", marginBottom: 2 }}>🔪 Prostatectomía Radical</div>
        <div style={{ fontSize: "var(--fs-xs)", color: "var(--texto-ter)", marginBottom: 8 }}>Categoría: Oncología</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {secs.map(s => (
            <span key={s} style={{ fontSize: "var(--fs-xs)", padding: "3px 9px", borderRadius: 20, background: "var(--superficie)", border: "0.5px solid var(--borde)", color: "var(--texto-sec)" }}>{s}</span>
          ))}
        </div>
      </div>
    );
  }

  if (tipo === "videos") {
    return (
      <div style={caja}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", background: "var(--superficie)", border: "0.5px solid var(--borde)", borderRadius: 8 }}>
          <div style={{ width: 46, height: 30, borderRadius: 6, background: "var(--fondo-suave)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "var(--fs-2)" }}>▶️</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "var(--fs-1)", fontWeight: 600, color: "var(--texto)" }}>URS flexible con láser Holmium</div>
            <div style={{ fontSize: "var(--fs-xs)", color: "var(--texto-ter)" }}>Litiasis · 8 min</div>
          </div>
        </div>
      </div>
    );
  }

  if (tipo === "pregunta") {
    const alt = (letra, texto, tipo) => {
      let bg = "var(--superficie)", bd = "0.5px solid var(--borde)", col = "var(--texto)";
      if (tipo === "ok") { bg = "var(--exito-bg)"; bd = "1px solid var(--exito)"; col = "var(--exito)"; }
      if (tipo === "bad") { bg = "var(--peligro-bg)"; bd = "1px solid var(--peligro)"; col = "var(--peligro)"; }
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: bg, border: bd, color: col, fontSize: "var(--fs-0)", fontWeight: tipo === "ok" ? 600 : 400 }}>
          <b>{letra}.</b><span style={{ flex: 1 }}>{texto}</span>{tipo === "ok" && <span>✓</span>}{tipo === "bad" && <span>✗</span>}
        </div>
      );
    };
    return (
      <div style={caja}>
        <div style={{ fontSize: "var(--fs-1)", fontWeight: 600, color: "var(--texto)", marginBottom: 8, lineHeight: 1.4 }}>¿Tratamiento de elección en litiasis renal &gt; 2 cm?</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {alt("A", "LEOC", "bad")}
          {alt("B", "NLP (nefrolitotomía percutánea)", "ok")}
          {alt("C", "Manejo expectante")}
        </div>
        <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "var(--fondo-suave)", borderLeft: "3px solid var(--primario)" }}>
          <div style={{ fontSize: "var(--fs-xs)", fontWeight: 600, color: "var(--primario)", marginBottom: 2 }}>💡 Explicación</div>
          <div style={{ fontSize: "var(--fs-0)", color: "var(--texto)", lineHeight: 1.4 }}>Verde = correcta · Rojo = tu elección si fue incorrecta, con la explicación debajo.</div>
        </div>
      </div>
    );
  }

  return null;
}

function TutorialTour({ rol, onGoToTab, onClose }) {
  const movil = useIsMobile();
  const pasos = pasosTutorial(rol, movil);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const [cardH, setCardH] = useState(0);   // altura real de la tarjeta, para no cortarla
  const cardRef = useRef(null);
  const paso = pasos[i];

  // Mide la tarjeta cada vez que cambia el paso
  useEffect(() => {
    const medir = () => { if (cardRef.current) setCardH(cardRef.current.offsetHeight); };
    medir();
    const t = setTimeout(medir, 120);       // tras cargar la imagen de Uros
    window.addEventListener("resize", medir);
    return () => { clearTimeout(t); window.removeEventListener("resize", medir); };
  }, [i]);

  // Asegura que la pestaña correcta esté activa antes de resaltar su botón,
  // y navega a la sub-pestaña si el paso lo requiere (con reintento por si el
  // panel aún no montó su listener).
  useEffect(() => {
    if (paso?.tab && onGoToTab) onGoToTab(paso.tab);
    if (paso?.subtab) {
      const t1 = setTimeout(() => tourIrSubtab(paso.subtab), 120);
      const t2 = setTimeout(() => tourIrSubtab(paso.subtab), 320);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [i]);

  // Calcula la posición del elemento a resaltar (reintenta un instante por si recién se montó).
  useEffect(() => {
    let raf;
    const medir = () => {
      if (!paso?.target) { setRect(null); return; }
      const el = document.querySelector(`[data-tour="${paso.target}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({ x: r.left, y: r.top, w: r.width, h: r.height });
      } else {
        setRect(null);
      }
    };
    raf = requestAnimationFrame(() => setTimeout(medir, 60));
    window.addEventListener("resize", medir);
    window.addEventListener("scroll", medir, true);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", medir); window.removeEventListener("scroll", medir, true); };
  }, [i, paso, movil]);

  const esUltimo = i === pasos.length - 1;
  const siguiente = () => { if (esUltimo) onClose(); else setI(i + 1); };
  const anterior = () => setI(Math.max(0, i - 1));

  // Posición de la burbuja de texto.
  const vh = typeof window !== "undefined" ? (window.visualViewport?.height || window.innerHeight) : 800;
  const vw = typeof window !== "undefined" ? window.innerWidth : 400;
  const tieneDemo = !!paso.demo;
  const cardW = movil ? Math.min(vw - 24, tieneDemo ? 360 : 340) : (tieneDemo ? 380 : 340);
  // Altura REAL de la tarjeta (las que llevan a Uros son bastante más altas que
  // la estimación fija que se usaba antes, y por eso se cortaban).
  const alturaCard = cardH || (paso.uros ? 330 : 190);
  let cardStyle;
  if (rect && !movil && !tieneDemo) {
    const abajo = rect.y + rect.h + 14;
    const left = Math.min(Math.max(12, rect.x + rect.w / 2 - cardW / 2), vw - cardW - 12);
    if (abajo + alturaCard + 12 <= vh) {
      cardStyle = { top: abajo, left };                       // cabe debajo
    } else if (rect.y - alturaCard - 14 >= 12) {
      cardStyle = { top: rect.y - alturaCard - 14, left };    // cabe arriba
    } else {
      // No cabe ni arriba ni abajo: se centra verticalmente y se deja scrollear
      cardStyle = { top: Math.max(12, (vh - alturaCard) / 2), left };
    }
  } else if (tieneDemo) {
    // Pasos con demostración: siempre centrado (las maquetas pueden ser altas).
    cardStyle = { top: "50%", left: "50%", transform: "translate(-50%,-50%)" };
  } else if (movil && rect) {
    // En móvil: si el elemento resaltado está en la mitad inferior, la tarjeta va
    // ARRIBA (si no, taparía el elemento y quedaría bajo la barra del navegador).
    const enMitadInferior = rect.y + rect.h / 2 > vh / 2;
    // Si la tarjeta es más alta que el espacio disponible, se centra y scrollea
    const cabe = alturaCard + 24 <= vh;
    cardStyle = !cabe
      ? { top: 12, left: "50%", transform: "translateX(-50%)" }
      : enMitadInferior
        ? { top: 12, left: "50%", transform: "translateX(-50%)" }
        : { bottom: 12, left: "50%", transform: "translateX(-50%)" };
  } else {
    cardStyle = movil
      ? { bottom: 12, left: "50%", transform: "translateX(-50%)" }
      : { top: "50%", left: "50%", transform: "translate(-50%,-50%)" };
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9998, paddingBottom: "env(safe-area-inset-bottom)" }}>
      {/* Fondo que bloquea la interacción */}
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: rect ? "transparent" : "rgba(15,23,42,0.62)" }} />

      {/* Spotlight sobre el elemento real */}
      {rect && (
        <div style={{
          position: "absolute",
          left: rect.x - 8, top: rect.y - 8, width: rect.w + 16, height: rect.h + 16,
          borderRadius: 12, border: "2px solid var(--primario)",
          boxShadow: "0 0 0 9999px rgba(15,23,42,0.62)",
          pointerEvents: "none", transition: "all .25s ease"
        }} />
      )}

      {/* Tarjeta del paso. Estilo "hero": banner oscuro con Uros grande arriba
          (como una tarjeta de presentación), y debajo el texto y el botón. */}
      <div ref={cardRef} style={{
        position: "absolute", width: cardW, maxWidth: "calc(100vw - 24px)", maxHeight: "calc(100dvh - 32px)", overflowY: "auto", WebkitOverflowScrolling: "touch",
        background: "var(--superficie)", border: "1px solid var(--borde)",
        borderRadius: 18, boxShadow: "0 12px 32px rgba(15,23,42,0.28)",
        ...cardStyle
      }}>
        {/* Banner con la imagen de Uros a cuerpo completo */}
        {paso.uros && (
          <div style={{ position: "relative", background: "linear-gradient(180deg, #052A40 0%, #0A3D57 55%, #0E4E6E 100%)", borderRadius: "17px 17px 0 0", padding: rect || paso.demo ? "14px 12px 10px" : "22px 12px 14px", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
            <button onClick={onClose} aria-label="Cerrar tutorial" style={{ position: "absolute", top: 10, right: 10, width: 30, height: 30, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.22)", color: "#fff", fontSize: "var(--fs-3)", fontWeight: 700, cursor: "pointer", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
            <Uros expresion={paso.uros} size={rect || paso.demo ? 110 : 180} style={{ maxHeight: rect || paso.demo ? 120 : 200, width: "auto", filter: "drop-shadow(0 6px 14px rgba(0,0,0,0.35))" }} />
          </div>
        )}

        <div style={{ padding: "16px 18px 14px" }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: "var(--texto)", marginBottom: 6, lineHeight: 1.25 }}>{paso.titulo}</div>
          <div style={{ fontSize: "var(--fs-2)", lineHeight: 1.55, color: "var(--texto-sec)" }}>{paso.texto}</div>
          {paso.demo && <DemoTutorial tipo={paso.demo} />}

          {/* Puntos de progreso */}
          <div style={{ display: "flex", gap: 5, margin: "14px 0 12px" }}>
            {pasos.map((_, k) => (
              <span key={k} style={{ width: k === i ? 20 : 7, height: 7, borderRadius: 4, background: k === i ? "var(--primario)" : "var(--borde)", transition: "all .2s" }} />
            ))}
          </div>

          <button onClick={siguiente} style={{ width: "100%", padding: "12px", fontSize: "var(--fs-3)", fontWeight: 700, borderRadius: 12, border: "none", background: "var(--primario)", color: "var(--texto-inv)", cursor: "pointer" }}>
            {esUltimo ? "Entendido" : "Siguiente"}
          </button>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
            <button onClick={onClose} style={{ padding: "7px 4px", fontSize: "var(--fs-1)", background: "none", border: "none", color: "var(--texto-ter)", cursor: "pointer" }}>Saltar tutorial</button>
            {i > 0 && <button onClick={anterior} style={{ padding: "7px 4px", fontSize: "var(--fs-1)", background: "none", border: "none", color: "var(--texto-sec)", cursor: "pointer", fontWeight: 600 }}>← Atrás</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function MapaConceptual({ data }) {
  const colors = ["#2D7DD2","#3BB273","#E84855","#F18F01","#8338EC","#06D6A0"];
  const cx = 340, cy = 220, R = 150;
  const n = data.ramas.length;
  return (
    <svg width="100%" viewBox="0 0 680 440" style={{display:"block"}}>
      {data.ramas.map((r, i) => {
        const angle = (2 * Math.PI * i / n) - Math.PI/2;
        const bx = cx + R * Math.cos(angle);
        const by = cy + R * Math.sin(angle);
        const color = colors[i % colors.length];
        const sR = 68;
        return (
          <g key={i}>
            <line x1={cx} y1={cy} x2={bx} y2={by} stroke={color} strokeWidth="1.5" strokeOpacity="0.5"/>
            <rect x={bx-52} y={by-17} width="104" height="34" rx="8" fill={color} fillOpacity="0.15" stroke={color} strokeWidth="1.2"/>
            <text x={bx} y={by+1} textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="500" fill={color}>{r.rama}</text>
            {r.subnodos.map((s, j) => {
              const sa = angle + (j - (r.subnodos.length-1)/2) * 0.38;
              const sx = bx + sR * Math.cos(sa);
              const sy = by + sR * Math.sin(sa);
              return (
                <g key={j}>
                  <line x1={bx} y1={by} x2={sx} y2={sy} stroke={color} strokeWidth="0.8" strokeOpacity="0.35" strokeDasharray="3,2"/>
                  <rect x={sx-44} y={sy-13} width="88" height="26" rx="6" fill="var(--superficie)" stroke={color} strokeWidth="0.8" strokeOpacity="0.6"/>
                  <text x={sx} y={sy+1} textAnchor="middle" dominantBaseline="central" fontSize="10" fill="var(--neutro)">{s}</text>
                </g>
              );
            })}
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r="46" fill="var(--superficie)" stroke="var(--primario)" strokeWidth="1.5"/>
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize="13" fontWeight="500" fill="var(--texto)">{data.nodo_central}</text>
    </svg>
  );
}
function PanelConversaciones({ conversaciones, conversacionActual, onSeleccionar, onNueva, onEliminar, onCerrar }) {
  const formatearFecha = (fechaStr) => {
    if (!fechaStr) return '';
    const fecha = new Date(fechaStr);
    const ahora = new Date();
    const diffMs = ahora - fecha;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHoras = Math.floor(diffMs / 3600000);
    const diffDias = Math.floor(diffMs / 86400000);
    
    if (diffMin < 1) return 'Hace un momento';
    if (diffMin < 60) return `Hace ${diffMin}m`;
    if (diffHoras < 24) return `Hace ${diffHoras}h`;
    if (diffDias < 7) return `Hace ${diffDias}d`;
    return fecha.toLocaleDateString("es-CL");
  };

  const handleEliminar = (e, conv) => {
    e.stopPropagation(); // evita que se abra la conversación al hacer click en eliminar
    if (!confirm(`¿Eliminar la conversación "${conv.titulo}"?\n\nEsto borrará todos sus mensajes y no se puede deshacer.`)) return;
    onEliminar(conv.id);
  };

  return (
    <div style={{
      position: "absolute",
      top: 0,
      left: 0,
      bottom: 0,
      width: "280px",
      background:"var(--superficie)",
      borderRight: "0.5px solid var(--borde)",
      display: "flex",
      flexDirection: "column",
      zIndex: 20,
      boxShadow: "2px 0 8px rgba(0,0,0,0.05)",
      borderRadius: "var(--border-radius-lg) 0 0 var(--border-radius-lg)",
    }}>
      {/* Header */}
      <div style={{
        padding: "14px 16px",
        borderBottom: "0.5px solid var(--borde)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        background: "var(--fondo-suave)",
      }}>
        <div style={{fontSize:"var(--fs-2)", fontWeight:600, color:"var(--texto)"}}>Mis conversaciones</div>
        <button onClick={onCerrar} style={{
          background: "none",
          border: "none",
          fontSize: 18,
          color: "var(--texto-ter)",
          cursor: "pointer",
          padding: 0,
          lineHeight: 1,
        }}>✕</button>
      </div>

      {/* Botón nueva conversación */}
      <div style={{padding: "10px 12px", borderBottom: "0.5px solid var(--fondo)"}}>
        <button onClick={onNueva} style={{
          width: "100%",
          padding: "9px",
          fontSize: "var(--fs-2)",
          fontWeight: 500,
          background: "var(--primario)",
          color:"var(--texto-inv)",
          border: "none",
          borderRadius: 8,
          cursor: "pointer",
        }}>+ Nueva conversación</button>
      </div>

      {/* Lista de conversaciones */}
      <div style={{flex: 1, overflowY: "auto", padding: "8px 6px"}}>
        {conversaciones.length === 0 ? (
          <div style={{textAlign:"center", padding:"24px 16px", color:"var(--texto-ter)", fontSize:"var(--fs-1)", lineHeight:1.5}}>
            <Uros expresion="guinando" size={84} style={{margin:"0 auto 10px"}}/>
            No tienes conversaciones aún.<br/>Empieza una con el botón de arriba.
          </div>
        ) : (
          conversaciones.map(conv => {
            const esActual = conv.id === conversacionActual;
            return (
              <div
                key={conv.id}
                onClick={() => onSeleccionar(conv.id)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  cursor: "pointer",
                  background: esActual ? "var(--fondo-suave)" : "transparent",
                  border: esActual ? "0.5px solid var(--primario)" : "0.5px solid transparent",
                  marginBottom: 4,
                  position: "relative",
          
                }}
                onMouseEnter={e => {
                  if (!esActual) e.currentTarget.style.background = "var(--fondo-suave)";
                  const btn = e.currentTarget.querySelector('.btn-eliminar');
                  if (btn) btn.style.opacity = '1';
                }}
                onMouseLeave={e => {
                  if (!esActual) e.currentTarget.style.background = "transparent";
                  const btn = e.currentTarget.querySelector('.btn-eliminar');
                  if (btn) btn.style.opacity = '0';
                }}
              >
                <div style={{
                  fontSize: "var(--fs-1)",
                  fontWeight: esActual ? 500 : 400,
                  color: "var(--texto)",
                  marginBottom: 3,
                  lineHeight: 1.3,
                  paddingRight: 24,
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}>{conv.titulo || "Sin título"}</div>
                <div style={{fontSize: "var(--fs-xs)", color: "var(--texto-ter)"}}>
                  {formatearFecha(conv.fecha_actualizacion)}
                </div>
                <button
                  className="btn-eliminar"
                  onClick={(e) => handleEliminar(e, conv)}
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    background: "none",
                    border: "none",
                    color: "var(--peligro)",
                    fontSize: "var(--fs-2)",
                    cursor: "pointer",
                    padding: 2,
                    opacity: 0,
                    transition: "opacity 0.15s",
                  }}
                  title="Eliminar conversación"
                >🗑</button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
// Convierte Markdown básico (negrita, cursiva, listas, títulos) a HTML seguro
function renderMarkdown(texto) {
  if (!texto) return "";
  // Escapar HTML para seguridad
  let html = texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Negrita **texto** o __texto__
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");
  // Cursiva *texto* (evitando los ya convertidos)
  html = html.replace(/(^|[^*])\*([^*\n]+?)\*([^*]|$)/g, "$1<em>$2</em>$3");
  // Títulos ### / ## / #
  html = html.replace(/^### (.+)$/gm, '<div style="font-weight:600;font-size:15px;margin:6px 0 2px;">$1</div>');
  html = html.replace(/^## (.+)$/gm, '<div style="font-weight:700;font-size:16px;margin:8px 0 3px;">$1</div>');
  html = html.replace(/^# (.+)$/gm, '<div style="font-weight:700;font-size:17px;margin:8px 0 3px;">$1</div>');
  // Viñetas: líneas que empiezan con - o *
  html = html.replace(/^[\-\*] (.+)$/gm, '<div style="padding-left:14px;text-indent:-10px;">• $1</div>');
  // Saltos de línea restantes
  html = html.replace(/\n/g, "<br/>");
  // Limpiar <br/> justo antes/después de los divs de viñetas y títulos
  html = html.replace(/<br\/>(<div)/g, "$1").replace(/(<\/div>)<br\/>/g, "$1");
  return html;
}

function ChatBubble({ msg, userInitials, onPlayVideo }) {
  const isUser = msg.role === "user";
  const [fuentesExpandidas, setFuentesExpandidas] = useState(false);
  const bubbleStyle = { padding:"10px 14px", borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px", background: isUser ? "var(--primario)" : "var(--superficie)", color: isUser ?"var(--texto-inv)":"var(--texto)", fontSize:"var(--fs-2)", lineHeight:1.6, border: isUser ? "none" : "0.5px solid var(--borde)", whiteSpace:"pre-wrap" };
  return (
    <div style={{display:"flex", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom:"12px"}}>
      {!isUser && <div style={{marginRight:8,marginTop:2}}><UrosAvatar size={30}/></div>}
      <div style={{maxWidth:"82%"}}>
        {isUser
          ? <div style={bubbleStyle}>{msg.content}</div>
          : <div style={{...bubbleStyle, whiteSpace:"normal"}} dangerouslySetInnerHTML={{__html: renderMarkdown(msg.content)}} />
        }
        {msg.cirugiasConsulta && (
          <div style={{marginTop:6,padding:"7px 10px",background:"var(--fondo-suave)",border:"0.5px solid var(--borde)",borderRadius:8}}>
            <div style={{fontSize:"var(--fs-xs)",fontWeight:500,color:"var(--primario-osc)"}}>📅 Información de tu tabla quirúrgica · {msg.cirugiasConsulta.cantidad} {msg.cirugiasConsulta.cantidad === 1 ? "cirugía" : "cirugías"} en {msg.cirugiasConsulta.rango}</div>
          </div>
        )}
        {msg.pacientesConsulta && (
          <div style={{marginTop:6,padding:"7px 10px",background:"var(--chip-rosa-bg)",border:"0.5px solid var(--chip-rosa-borde)",borderRadius:8}}>
            <div style={{fontSize:"var(--fs-xs)",fontWeight:500,color:"var(--chip-rosa)"}}>🏥 Información de tus pacientes · {msg.pacientesConsulta.cantidad} {msg.pacientesConsulta.cantidad === 1 ? "paciente" : "pacientes"}</div>
          </div>
        )}
        {msg.fuentes && msg.fuentes.length > 0 && (
          <div style={{marginTop:6,padding:"7px 10px",background:"var(--exito-bg)",border:"0.5px solid var(--exito-borde)",borderRadius:8}}>
            <div style={{fontSize:"var(--fs-xs)",fontWeight:500,color:"var(--exito)",marginBottom:4}}>📚 Basado en tu base de conocimiento:</div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              {(fuentesExpandidas ? msg.fuentes : msg.fuentes.slice(0,2)).map(f => <div key={f.id} style={{fontSize:"var(--fs-0)",color:"var(--exito)",lineHeight:1.4}}>• <strong>{f.titulo}</strong>{f.fuente ? <span style={{color:"var(--texto-ter)"}}> — {f.fuente}</span> : (f.categoria ? <span style={{color:"var(--texto-ter)"}}> ({f.categoria})</span> : null)}</div>)}
            </div>
            {msg.fuentes.length > 2 && (
              <button onClick={()=>setFuentesExpandidas(v=>!v)} style={{marginTop:5,padding:0,background:"none",border:"none",color:"var(--exito)",fontSize:"var(--fs-0)",fontWeight:600,cursor:"pointer"}}>
                {fuentesExpandidas ? "▴ Ver menos" : `▾ Ver ${msg.fuentes.length - 2} fuente${msg.fuentes.length - 2 === 1 ? "" : "s"} más`}
              </button>
            )}
          </div>
        )}
        {msg.videos && msg.videos.length > 0 && (
          <div style={{marginTop:8,padding:"10px 12px",background:"var(--fondo-suave)",border:"0.5px solid var(--borde)",borderRadius:10}}>
            <div style={{fontSize:"var(--fs-0)",fontWeight:500,color:"var(--texto-sec)",marginBottom:8}}>🎬 Videos sugeridos de la biblioteca</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {msg.videos.map(v => {
                const ytId = getYouTubeId(v.url);
                const thumb = ytId ? `https://img.youtube.com/vi/${ytId}/default.jpg` : null;
                return (
                  <div key={v.id} onClick={()=>onPlayVideo(v)} style={{display:"flex",alignItems:"center",gap:10,padding:"6px",background:"var(--superficie)",borderRadius:8,cursor:"pointer",border:"0.5px solid var(--header-bg)"}}>
                    {thumb && <img src={thumb} alt="" style={{width:60,height:45,objectFit:"cover",borderRadius:4,flexShrink:0}}/>}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:"var(--fs-1)",fontWeight:500,color:"var(--texto)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v.titulo}</div>
                      <div style={{fontSize:"var(--fs-xs)",color:"var(--texto-ter)"}}>{v.categoria} · {v.autor}</div>
                    </div>
                    <div style={{fontSize:"var(--fs-2)",color:"var(--primario)"}}>▶</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {isUser && <div style={{width:30,height:30,borderRadius:"50%",background:"var(--primario-claro)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"var(--fs-1)",fontWeight:500,color:"var(--texto-inv)",marginLeft:8,flexShrink:0,marginTop:2}}>{userInitials}</div>}
    </div>
  );
}

const inputStyle = { width:"100%", padding:"10px 12px", fontSize:"var(--fs-2)", borderRadius:8, border:"1px solid var(--borde)", background:"var(--superficie)", color:"var(--texto)", outline:"none", boxSizing:"border-box", marginBottom:10, fontFamily:"inherit" };
const labelStyle = { fontSize:"var(--fs-1)", fontWeight:500, color:"var(--texto-sec)", marginBottom:4, display:"block" };
const btnPrimary = { width:"100%", padding:"11px", fontSize:"var(--fs-2)", fontWeight:500, background:"var(--primario)", color:"var(--texto-inv)", border:"none", borderRadius:8, cursor:"pointer", marginTop:6 };

// ============================================================
// TEMAS (modo claro / oscuro) — variables CSS
// ============================================================
const THEME_CSS = `
:root, [data-theme="light"] {
  color-scheme: light;
  /* Tamaños unificados (tipografía e íconos) — usar var(--fs-*) / var(--icon-*) */
  --fs-xs: 10.5px;  /* etiquetas diminutas */
  --fs-0: 11.5px;   /* metadatos, chips */
  --fs-1: 12.5px;   /* texto secundario */
  --fs-2: 13.5px;   /* cuerpo base */
  --fs-3: 15px;     /* título de sección */
  --fs-4: 17px;     /* título grande */
  --icon-sm: 28px;  /* botón de ícono chico (lado) */
  --icon-fs: 15px;  /* ícono dentro del botón */
  --fondo: #e8f3fb;
  --header-bg: #d0e9f8;
  --fondo-suave: #f0f8fd;
  --superficie: #ffffff;
  --borde: #b8d8ef;
  --borde-suave: #d4e6f5;
  --primario: #1a6fb5;
  --primario-osc: #1a4a7c;
  --primario-claro: #7ec0e8;
  --texto: #1a3a5c;
  --texto-sec: #4a7eab;
  --texto-ter: #7aa3c4;
  --texto-inv: #ffffff;
  --navy-fijo: #1a3a5c;
  --hoy-bg: #eaf4ff;
  --peligro: #c0392b;
  --peligro-bg: #fde8e6;
  --peligro-borde: #f0c5c0;
  --exito: #1a6f5c;
  --exito-bg: #e0f5ec;
  --exito-borde: #a8d4be;
  --alerta: #a06b1a;
  --alerta-bg: #fff8e1;
  --alerta-borde: #f0d896;
  --neutro: #8a99a8;
  --neutro-bg: #eeeeee;
  --ccv: #7a4fb5;
  --ccv-borde: #c9b6e6;
  --ccv-bg: #f3e8ff;
  --est-prog-bg: #eaf3fb;
  --chip-azul: #1e40af;   --chip-azul-bg: #dbeafe;
  --chip-indigo: #3730a3; --chip-indigo-bg: #e0e7ff;
  --chip-rosa: #7a3a6b;   --chip-rosa-bg: #f5e0f0; --chip-rosa-borde: #e0b8d0;
}
[data-theme="dark"] {
  color-scheme: dark;
  --fondo: #0e1a26;
  --header-bg: #142434;
  --fondo-suave: #16232f;
  --superficie: #1b2c3d;
  --borde: #2e4a63;
  --borde-suave: #263c50;
  --primario: #4da3e0;
  --primario-osc: #7ec0e8;
  --primario-claro: #3a7cad;
  --texto: #dcebf7;
  --texto-sec: #9cc0dd;
  --texto-ter: #6f93b3;
  --texto-inv: #ffffff;
  --navy-fijo: #12253b;
  --hoy-bg: #1d3a55;
  --peligro: #e0796d;
  --peligro-bg: #3a2320;
  --peligro-borde: #5c352f;
  --exito: #52c2a0;
  --exito-bg: #16302a;
  --exito-borde: #2a5a4a;
  --alerta: #dcaa54;
  --alerta-bg: #332a12;
  --alerta-borde: #5a4a20;
  --neutro: #8a99a8;
  --neutro-bg: #26303a;
  --ccv: #b18ae0;
  --ccv-borde: #5a4380;
  --ccv-bg: #2a2140;
  --est-prog-bg: #1c3550;
  --chip-azul: #a8c4f5;   --chip-azul-bg: #1e2f52;
  --chip-indigo: #b8bdf5; --chip-indigo-bg: #262b52;
  --chip-rosa: #e0aed0;   --chip-rosa-bg: #3a2233; --chip-rosa-borde: #5a3850;
}
`;

// Inyectar el CSS de temas una sola vez al cargar el módulo (cubre también la
// pantalla de login, que se renderiza fuera del root autenticado) y aplicar
// de inmediato el tema guardado para evitar destello claro al recargar.
if (typeof document !== "undefined" && !document.getElementById("uro-theme-css")) {
  const st = document.createElement("style");
  st.id = "uro-theme-css";
  st.textContent = THEME_CSS;
  document.head.appendChild(st);
  try { document.documentElement.setAttribute("data-theme", localStorage.getItem("uro_tema") || "light"); } catch {}
}
const btnSecondary = { width:"100%", padding:"11px", fontSize:"var(--fs-2)", fontWeight:500, background:"var(--superficie)", color:"var(--primario)", border:"1px solid var(--primario)", borderRadius:8, cursor:"pointer", marginTop:8 };

function AuthScreen({ onLogin }) {
  const [view, setView] = useState("welcome");
  const [form, setForm] = useState({ nombre:"", correo:"", especialidad:"Urología", password:"", password2:"", documento:null, documentoNombre:"" });
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const fileRef = useRef(null);

  const handleFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 5*1024*1024) { setError("El archivo no debe superar 5 MB"); return; }
    setForm({...form, documento:f, documentoNombre:f.name});
    setError("");
  };

  const handleRegister = async () => {
    setError(""); setInfo("");
    if (!form.nombre.trim()) return setError("Ingresa tu nombre completo");
    if (!form.correo.trim() || !form.correo.includes("@")) return setError("Correo electrónico inválido");
    if (form.password.length < 6) return setError("La contraseña debe tener al menos 6 caracteres");
    if (form.password !== form.password2) return setError("Las contraseñas no coinciden");
    if (!form.documento) return setError("Debes adjuntar tu título o carta de aceptación");

    setLoading(true);
    const result = await registerUser({
      nombre: form.nombre,
      correo: form.correo,
      password: form.password,
      especialidad: form.especialidad,
      documentoNombre: form.documentoNombre,
    });
    setLoading(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setInfo("Tu solicitud fue enviada. Recibirás acceso una vez sea aprobada por el administrador.");
    setForm({ nombre:"", correo:"", especialidad:"Urología", password:"", password2:"", documento:null, documentoNombre:"" });
  };

  const handleLogin = async () => {
    setError(""); setInfo("");
    const id = form.correo.trim();
    if (!id) return setError("Ingresa tu correo o RUT");
    if (!form.password) return setError("Ingresa tu contraseña");

    setLoading(true);
    const result = await loginUser({
      identificador: id,
      password: form.password,
    });
    setLoading(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    // El componente App detecta el cambio de sesión y carga el perfil automáticamente.
    // No necesitamos llamar a onLogin aquí, lo hace el listener de onAuthChange.
  };

  if (view === "welcome") {
    return (
      <div style={{padding:"40px 32px", textAlign:"center"}}>
        <div style={{display:"flex",justifyContent:"center",marginBottom:18}}><LogoUroSearch size={78}/></div>
        <div style={{fontSize:32, fontWeight:600, fontStyle:"italic", fontFamily:"Georgia, 'Times New Roman', serif", color:"var(--texto)", letterSpacing:"-0.5px", marginBottom:8}}>UroSearch</div>
        <div style={{fontSize:"var(--fs-3)", color:"var(--texto-sec)", marginBottom:34, lineHeight:1.5}}>Asistente Clínico de Urología</div>
        <div style={{maxWidth:340, margin:"0 auto"}}>
          <button onClick={()=>{setView("login"); setError(""); setInfo("");}} style={{...btnPrimary, padding:"14px", fontSize:16}}>Iniciar sesión</button>
          <button onClick={()=>{setView("register"); setError(""); setInfo("");}} style={{...btnSecondary, padding:"14px", fontSize:16}}>Solicitar cuenta</button>
        </div>
        <div style={{fontSize:"var(--fs-1)", color:"var(--texto-ter)", marginTop:36, padding:"0 20px", lineHeight:1.5}}>Acceso restringido a equipo clínico<br/>urológico autorizado</div>
        <div style={{fontSize:"var(--fs-1)", fontStyle:"italic", color:"var(--texto-sec)", marginTop:24, paddingTop:16, borderTop:"0.5px solid var(--borde)"}}>Creado por Dr. Sebastián Gárate Ortega - Residente de Urología UACh</div>
        <div style={{fontSize:9, fontFamily:"monospace", color:"var(--texto-ter)", marginTop:4, letterSpacing:"0.3px"}}>{VERSION}</div>
      </div>
    );
  }

  if (view === "login") {
    return (
      <div style={{padding:"24px 24px 32px"}}>
        <button onClick={()=>setView("welcome")} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:"var(--fs-2)",cursor:"pointer",marginBottom:14,padding:0}}>← Volver</button>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:24}}>
          <LogoUroSearch size={36}/>
          <div style={{fontSize:22,fontWeight:600,fontStyle:"italic",fontFamily:"Georgia, 'Times New Roman', serif",color:"var(--texto)"}}>Iniciar sesión</div>
        </div>
        <label style={labelStyle}>Correo o RUT</label>
        <input type="text" autoCapitalize="none" autoCorrect="off" value={form.correo} onChange={e=>setForm({...form,correo:e.target.value})} placeholder="tu.correo@hbv.cl  o  12.345.678-9" style={inputStyle} disabled={loading}/>
        <label style={labelStyle}>Contraseña</label>
        <input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} onKeyDown={e=>{if(e.key==="Enter")handleLogin();}} placeholder="••••••••" style={inputStyle} disabled={loading}/>
        {error && <div style={{fontSize:"var(--fs-1)",color:"var(--peligro)",background:"var(--peligro-bg)",padding:"8px 10px",borderRadius:6,marginBottom:6}}>{error}</div>}
        <button onClick={handleLogin} disabled={loading} style={{...btnPrimary, opacity: loading ? 0.6 : 1, cursor: loading ? "default" : "pointer"}}>
          {loading ? "Ingresando..." : "Ingresar"}
        </button>
        <div style={{textAlign:"center",fontSize:"var(--fs-1)",color:"var(--texto-sec)",marginTop:14}}>¿No tienes cuenta? <button onClick={()=>{setView("register");setError("");setInfo("");}} style={{background:"none",border:"none",color:"var(--primario)",fontWeight:500,cursor:"pointer",padding:0,fontSize:"var(--fs-1)"}}>Solicítala aquí</button></div>
      </div>
    );
  }

  return (
    <div style={{padding:"24px 24px 32px"}}>
      <button onClick={()=>setView("welcome")} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:"var(--fs-2)",cursor:"pointer",marginBottom:14,padding:0}}>← Volver</button>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
        <LogoUroSearch size={36}/>
        <div style={{fontSize:22,fontWeight:600,fontStyle:"italic",fontFamily:"Georgia, 'Times New Roman', serif",color:"var(--texto)"}}>Solicitar cuenta</div>
      </div>
      <div style={{fontSize:"var(--fs-1)",color:"var(--texto-sec)",marginBottom:18,lineHeight:1.5}}>Tu cuenta será revisada por el administrador antes de ser activada.</div>
      <label style={labelStyle}>Nombre completo</label>
      <input value={form.nombre} onChange={e=>setForm({...form,nombre:e.target.value})} placeholder="Dr. Juan Pérez" style={inputStyle} disabled={loading}/>
      <label style={labelStyle}>Correo electrónico</label>
      <input type="email" value={form.correo} onChange={e=>setForm({...form,correo:e.target.value})} placeholder="tu.correo@hbv.cl" style={inputStyle} disabled={loading}/>
      <label style={labelStyle}>Especialidad / cargo</label>
      <select value={form.especialidad} onChange={e=>setForm({...form,especialidad:e.target.value})} style={inputStyle} disabled={loading}>
        {ESPECIALIDADES.map(e=><option key={e}>{e}</option>)}
      </select>
      <label style={labelStyle}>Documento de respaldo</label>
      <div style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)",marginBottom:6}}>Adjunta título de especialidad o carta de residencia (PDF/JPG/PNG, máx. 5 MB)</div>
      <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleFile} style={{display:"none"}} disabled={loading}/>
      <button onClick={()=>fileRef.current?.click()} disabled={loading} style={{width:"100%",padding:"10px",fontSize:"var(--fs-2)",background:"var(--superficie)",color:"var(--primario)",border:"1px dashed var(--primario)",borderRadius:8,cursor:loading?"default":"pointer",marginBottom:10,textAlign:"left",opacity:loading?0.6:1}}>📎 {form.documentoNombre || "Seleccionar archivo..."}</button>
      <label style={labelStyle}>Contraseña</label>
      <input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Mínimo 6 caracteres" style={inputStyle} disabled={loading}/>
      <label style={labelStyle}>Confirmar contraseña</label>
      <input type="password" value={form.password2} onChange={e=>setForm({...form,password2:e.target.value})} onKeyDown={e=>{if(e.key==="Enter")handleRegister();}} placeholder="Repite tu contraseña" style={inputStyle} disabled={loading}/>
      {error && <div style={{fontSize:"var(--fs-1)",color:"var(--peligro)",background:"var(--peligro-bg)",padding:"8px 10px",borderRadius:6,marginBottom:6}}>{error}</div>}
      {info && <div style={{fontSize:"var(--fs-1)",color:"var(--exito)",background:"var(--exito-bg)",padding:"10px 12px",borderRadius:6,marginBottom:6,lineHeight:1.5}}>✓ {info}</div>}
      <button onClick={handleRegister} disabled={loading} style={{...btnPrimary, opacity: loading ? 0.6 : 1, cursor: loading ? "default" : "pointer"}}>
        {loading ? "Enviando solicitud..." : "Enviar solicitud"}
      </button>
      <div style={{textAlign:"center",fontSize:"var(--fs-1)",color:"var(--texto-sec)",marginTop:14}}>¿Ya tienes cuenta? <button onClick={()=>{setView("login");setError("");setInfo("");}} style={{background:"none",border:"none",color:"var(--primario)",fontWeight:500,cursor:"pointer",padding:0,fontSize:"var(--fs-1)"}}>Inicia sesión</button></div>
    </div>
  );
}

function AdminPanel() {
  const [perfiles, setPerfiles] = useState([]);
  const [filtro, setFiltro] = useState("pendiente");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Cargar perfiles al montar el componente
  useEffect(() => {
    cargarPerfiles();
  }, []);

  const cargarPerfiles = async () => {
    setLoading(true);
    setError("");
    const result = await listarPerfiles();
    if (!result.ok) {
      setError("Error al cargar usuarios: " + result.error);
      setLoading(false);
      return;
    }
    setPerfiles(result.perfiles);
    setLoading(false);
  };

  const filtrados = perfiles.filter(u => filtro === "todos" || u.estado === filtro);
  const counts = {
    pendiente: perfiles.filter(u=>u.estado==="pendiente").length,
    aprobado: perfiles.filter(u=>u.estado==="aprobado").length,
    rechazado: perfiles.filter(u=>u.estado==="rechazado").length,
  };

  const cambiar = async (userId, nuevoEstado) => {
    const result = await cambiarEstadoUsuario(userId, nuevoEstado);
    if (!result.ok) {
      alert("Error al cambiar estado: " + result.error);
      return;
    }
    // Actualizar localmente sin recargar todo
    setPerfiles(perfiles.map(u => u.id === userId ? {...u, estado: nuevoEstado} : u));
  };

  const cambiarRol = async (userId, nuevoRol) => {
    const { error } = await supabase.from("perfiles").update({ rol: nuevoRol }).eq("id", userId);
    if (error) { alert("Error al cambiar el perfil: " + error.message); return; }
    setPerfiles(perfiles.map(u => u.id === userId ? {...u, rol: nuevoRol} : u));
  };

  const eliminar = async (userId) => {
    if (!confirm("¿Eliminar definitivamente esta cuenta?\n\nNota: el usuario seguirá registrado en el sistema de autenticación pero no podrá acceder a UroSearch hasta que un admin lo vuelva a aprobar.")) return;
    const result = await eliminarUsuario(userId);
    if (!result.ok) {
      alert("Error al eliminar: " + result.error);
      return;
    }
    setPerfiles(perfiles.filter(u => u.id !== userId));
  };

  const badge = (e) => ({
    fontSize:"var(--fs-xs)", fontWeight:500, padding:"2px 8px", borderRadius:10,
    background: e==="aprobado"?"var(--exito-bg)":e==="rechazado"?"var(--peligro-bg)":"var(--alerta-bg)",
    color: e==="aprobado"?"var(--exito)":e==="rechazado"?"var(--peligro)":"var(--alerta)"
  });

  if (loading) {
    return (
      <div style={{padding:"40px 16px", textAlign:"center", color:"var(--texto-ter)", fontSize:"var(--fs-2)"}}>
        Cargando usuarios...
      </div>
    );
  }

  return (
    <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
      <div style={{marginBottom:16, display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10}}>
        <div>
          <div style={{fontSize:"var(--fs-3)",fontWeight:600,color:"var(--texto)",marginBottom:4}}>Panel de administración</div>
          <div style={{fontSize:"var(--fs-1)",color:"var(--texto-sec)"}}>Gestión de cuentas del equipo clínico</div>
        </div>
        <button onClick={cargarPerfiles} style={{padding:"6px 12px",fontSize:"var(--fs-0)",background:"var(--superficie)",color:"var(--primario)",border:"0.5px solid var(--primario)",borderRadius:6,cursor:"pointer"}}>↻ Actualizar</button>
      </div>

      {error && <div style={{fontSize:"var(--fs-1)",color:"var(--peligro)",background:"var(--peligro-bg)",padding:"8px 10px",borderRadius:6,marginBottom:10}}>{error}</div>}

      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        {[["pendiente",`Pendientes (${counts.pendiente})`],["aprobado",`Aprobados (${counts.aprobado})`],["rechazado",`Rechazados (${counts.rechazado})`],["todos","Todos"]].map(([id,label]) => (
          <button key={id} onClick={()=>setFiltro(id)} style={{padding:"6px 12px",fontSize:"var(--fs-1)",fontWeight:filtro===id?500:400,borderRadius:6,cursor:"pointer",border:filtro===id?"none":"0.5px solid var(--borde)",background:filtro===id?"var(--primario)":"var(--superficie)",color:filtro===id?"var(--texto-inv)":"var(--texto-sec)"}}>{label}</button>
        ))}
      </div>

      {filtrados.length === 0 ? (
        <div style={{textAlign:"center",padding:"40px 0",color:"var(--texto-ter)",fontSize:"var(--fs-2)"}}>
          {perfiles.length === 0 ? "No hay usuarios registrados" : "No hay usuarios en esta categoría"}
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {filtrados.map(u => (
            <div key={u.id} style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"12px 14px"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
                <div style={{fontSize:"var(--fs-2)",fontWeight:500,color:"var(--texto)"}}>{u.nombre || "Sin nombre"}</div>
                <span style={badge(u.estado)}>{u.estado}</span>
                {u.rol === "admin" && <span style={{fontSize:9,padding:"1px 6px",background:"var(--navy-fijo)",color:"var(--texto-inv)",borderRadius:4,fontWeight:500}}>ADMIN</span>}
              </div>
              <div style={{fontSize:"var(--fs-1)",color:"var(--texto-sec)"}}>{u.correo} · {u.especialidad || "Sin especialidad"}</div>
              {u.fecha_registro && <div style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)",marginTop:2}}>Solicitud: {new Date(u.fecha_registro).toLocaleDateString("es-CL")}</div>}
              {u.documento_nombre && (
                <div style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",background:"var(--fondo-suave)",borderRadius:6,fontSize:"var(--fs-0)",color:"var(--texto-sec)",marginTop:8}}>📎 <span style={{flex:1}}>{u.documento_nombre}</span></div>
              )}
              {u.rol !== "admin" && (
                <div style={{display:"flex",alignItems:"center",gap:6,marginTop:8}}>
                  <span style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)"}}>Perfil:</span>
                  <select value={ROLES_ASIGNABLES.some(([v])=>v===u.rol) ? u.rol : ""} onChange={e=>{ if(e.target.value) cambiarRol(u.id, e.target.value); }} style={{padding:"4px 8px",fontSize:"var(--fs-1)",borderRadius:6,border:"0.5px solid var(--borde)",background:"var(--superficie)",color:"var(--texto)",cursor:"pointer"}}>
                    <option value="" disabled>— Asignar rol —</option>
                    {ROLES_ASIGNABLES.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                  </select>
                  {!ROLES_ASIGNABLES.some(([v])=>v===u.rol) && u.rol!=="admin" && <span style={{fontSize:"var(--fs-xs)",color:"var(--alerta)",fontWeight:600}}>sin asignar</span>}
                </div>
              )}
              <div style={{display:"flex",gap:6,marginTop:8}}>
                {u.estado === "pendiente" && (<>
                  <button onClick={()=>cambiar(u.id,"aprobado")} style={{flex:1,padding:"7px",fontSize:"var(--fs-1)",background:"var(--exito)",color:"var(--texto-inv)",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>✓ Aprobar</button>
                  <button onClick={()=>cambiar(u.id,"rechazado")} style={{flex:1,padding:"7px",fontSize:"var(--fs-1)",background:"var(--peligro)",color:"var(--texto-inv)",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>✗ Rechazar</button>
                </>)}
                {u.estado === "aprobado" && u.rol !== "admin" && <button onClick={()=>cambiar(u.id,"rechazado")} style={{flex:1,padding:"7px",fontSize:"var(--fs-1)",background:"var(--superficie)",color:"var(--peligro)",border:"0.5px solid var(--peligro)",borderRadius:6,cursor:"pointer",fontWeight:500}}>Suspender</button>}
                {u.estado === "rechazado" && <button onClick={()=>cambiar(u.id,"aprobado")} style={{flex:1,padding:"7px",fontSize:"var(--fs-1)",background:"var(--superficie)",color:"var(--exito)",border:"0.5px solid var(--exito)",borderRadius:6,cursor:"pointer",fontWeight:500}}>Reactivar</button>}
                {u.rol !== "admin" && <button onClick={()=>eliminar(u.id)} style={{padding:"7px 10px",fontSize:"var(--fs-1)",background:"var(--superficie)",color:"var(--texto-ter)",border:"0.5px solid var(--borde)",borderRadius:6,cursor:"pointer"}}>Eliminar</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Historial de respuestas del quiz (por usuario, guardado en este dispositivo) ───
function leerHistorialQuiz(userId) {
  try { return JSON.parse(localStorage.getItem(`uro_quiz_${userId}`)) || []; } catch { return []; }
}
function registrarRespuestaQuiz(userId, { preguntaId, categoria, acierto }) {
  try {
    const prev = leerHistorialQuiz(userId);
    prev.push({ id: preguntaId, cat: categoria || "General", ok: !!acierto, t: Date.now() });
    localStorage.setItem(`uro_quiz_${userId}`, JSON.stringify(prev.slice(-1000)));
  } catch {}
}
function borrarHistorialQuiz(userId) {
  try { localStorage.removeItem(`uro_quiz_${userId}`); } catch {}
}

function PreguntasPanel({ currentUser, isAdmin }) {
  const [preguntas, setPreguntas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [vista, setVista] = useState("quiz"); // "quiz" | "nueva" | "lista"
  const [idx, setIdx] = useState(0);          // índice de la pregunta actual en quiz
  const [seleccion, setSeleccion] = useState(null); // alternativa elegida
  const [mostrarResp, setMostrarResp] = useState(false);
  const [filtroCat, setFiltroCat] = useState("Todas");
  const [form, setForm] = useState({ enunciado: "", alternativas: ["","","",""], correcta: 0, feedback: "", categoria: "General" });
  const [errorForm, setErrorForm] = useState("");
  const [historial, setHistorial] = useState(() => leerHistorialQuiz(currentUser.id)); // respuestas previas
  const metricasQuiz = useMemo(() => {
    const total = historial.length;
    const aciertos = historial.filter(h => h.ok).length;
    const porCat = {};
    historial.forEach(h => {
      const c = h.cat || "General";
      if (!porCat[c]) porCat[c] = { n: 0, ok: 0 };
      porCat[c].n++; if (h.ok) porCat[c].ok++;
    });
    const cats = Object.entries(porCat)
      .map(([cat, v]) => ({ cat, n: v.n, ok: v.ok, pct: Math.round((v.ok / v.n) * 100) }))
      .sort((a, b) => a.pct - b.pct); // las más débiles primero
    const ult = historial.slice(-20);
    const pctUlt = ult.length ? Math.round((ult.filter(h => h.ok).length / ult.length) * 100) : null;
    return { total, aciertos, pct: total ? Math.round((aciertos / total) * 100) : null, cats, pctUlt, debiles: cats.filter(c => c.n >= 3 && c.pct < 70) };
  }, [historial]);

  const cargar = async () => {
    setLoading(true);
    const result = await listarPreguntas();
    setLoading(false);
    if (result.ok) setPreguntas(result.preguntas);
  };
  useEffect(() => { cargar(); }, []);

  const categorias = ["Todas", ...Array.from(new Set(preguntas.map(p => p.categoria || "General")))];
  // Preguntas en orden ALEATORIO: se barajan al cargar o al cambiar de categoría,
  // pero se mantienen estables mientras el usuario navega (no se re-barajan en cada render).
  const filtradas = useMemo(() => {
    const base = filtroCat === "Todas" ? preguntas : preguntas.filter(p => (p.categoria||"General") === filtroCat);
    const arr = [...base];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, [preguntas, filtroCat]);
  // Al re-barajar (cambio de categoría o recarga) volver a la primera pregunta.
  useEffect(() => { setIdx(0); setSeleccion(null); setMostrarResp(false); }, [filtradas]);
  const actual = filtradas[idx] || null;

  const responder = (i) => {
    if (mostrarResp) return;
    setSeleccion(i);
    setMostrarResp(true);
    const p = filtradas[idx];
    if (p) {
      registrarRespuestaQuiz(currentUser.id, { preguntaId: p.id, categoria: p.categoria, acierto: i === p.correcta });
      setHistorial(leerHistorialQuiz(currentUser.id));
    }
  };
  const siguiente = () => {
    setSeleccion(null); setMostrarResp(false);
    setIdx(prev => (prev + 1) % filtradas.length);
  };
  const anterior = () => {
    setSeleccion(null); setMostrarResp(false);
    setIdx(prev => (prev - 1 + filtradas.length) % filtradas.length);
  };

  const guardar = async () => {
    if (!form.enunciado.trim()) return setErrorForm("Escribe el enunciado");
    const alts = form.alternativas.map(a => a.trim());
    if (alts.some(a => !a)) return setErrorForm("Completa las 4 alternativas");
    const result = await crearPregunta(currentUser.id, {
      enunciado: form.enunciado.trim(),
      alternativas: alts,
      correcta: form.correcta,
      feedback: form.feedback.trim(),
      categoria: form.categoria.trim() || "General",
    });
    if (!result.ok) return setErrorForm("Error al guardar: " + result.error);
    setPreguntas([result.pregunta, ...preguntas]);
    setForm({ enunciado: "", alternativas: ["","","",""], correcta: 0, feedback: "", categoria: "General" });
    setErrorForm("");
    setVista("quiz");
  };

  const eliminar = async (id) => {
    if (!confirm("¿Eliminar esta pregunta?")) return;
    const result = await eliminarPregunta(id);
    if (!result.ok) return alert("Error: " + result.error);
    setPreguntas(preguntas.filter(p => p.id !== id));
  };

  // VISTA: crear pregunta (admin)
  if (vista === "nueva" && isAdmin) {
    return (
      <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
        <button onClick={()=>{setVista("quiz");setErrorForm("");}} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:"var(--fs-2)",cursor:"pointer",marginBottom:12,padding:0}}>← Volver</button>
        <div style={{fontSize:"var(--fs-3)",fontWeight:600,color:"var(--texto)",marginBottom:14}}>Nueva pregunta</div>
        <label style={labelStyle}>Enunciado</label>
        <textarea value={form.enunciado} onChange={e=>setForm({...form,enunciado:e.target.value})} placeholder="Escribe la pregunta..." rows={3} style={{...inputStyle,resize:"vertical"}}/>
        <label style={labelStyle}>Alternativas (marca la correcta)</label>
        {form.alternativas.map((alt, i) => (
          <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
            <button onClick={()=>setForm({...form,correcta:i})} style={{width:24,height:24,borderRadius:"50%",border:form.correcta===i?"none":"1px solid var(--borde)",background:form.correcta===i?"var(--exito)":"var(--superficie)",color:"var(--texto-inv)",cursor:"pointer",fontSize:"var(--fs-1)",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>{form.correcta===i?"✓":""}</button>
            <input value={alt} onChange={e=>{const nuevas=[...form.alternativas];nuevas[i]=e.target.value;setForm({...form,alternativas:nuevas});}} placeholder={`Alternativa ${String.fromCharCode(65+i)}`} style={{...inputStyle,marginBottom:0,flex:1}}/>
          </div>
        ))}
        <label style={{...labelStyle,marginTop:8}}>Feedback / explicación</label>
        <textarea value={form.feedback} onChange={e=>setForm({...form,feedback:e.target.value})} placeholder="Explicación que se muestra al responder..." rows={3} style={{...inputStyle,resize:"vertical"}}/>
        <label style={labelStyle}>Categoría</label>
        <input value={form.categoria} onChange={e=>setForm({...form,categoria:e.target.value})} placeholder="Ej: Litiasis, Oncología, NMIBC..." style={inputStyle}/>
        {errorForm && <div style={{fontSize:"var(--fs-1)",color:"var(--peligro)",background:"var(--peligro-bg)",padding:"8px 10px",borderRadius:6,marginBottom:8}}>{errorForm}</div>}
        <button onClick={guardar} style={{...btnPrimary,marginTop:0}}>Guardar pregunta</button>
      </div>
    );
  }

  // VISTA: lista de preguntas (admin, para gestionar/eliminar)
  if (vista === "lista") {
    return (
      <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <button onClick={()=>setVista("quiz")} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:"var(--fs-2)",cursor:"pointer",padding:0}}>← Volver al quiz</button>
          <span style={{fontSize:"var(--fs-1)",color:"var(--texto-ter)"}}>{preguntas.length} preguntas</span>
        </div>
        {preguntas.length === 0 ? (
          <div style={{textAlign:"center",padding:"30px",color:"var(--texto-ter)",fontSize:"var(--fs-2)"}}>No hay preguntas aún.</div>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {preguntas.map(p => (
              <div key={p.id} style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:8,padding:"10px 12px"}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
                  <span style={{fontSize:"var(--fs-xs)",color:"var(--primario)",fontWeight:600}}>{p.categoria||"General"}</span>
                  {isAdmin && <button onClick={()=>eliminar(p.id)} style={{background:"none",border:"none",color:"var(--peligro)",cursor:"pointer",fontSize:"var(--fs-1)",padding:0}}>🗑</button>}
                </div>
                <div style={{fontSize:"var(--fs-2)",color:"var(--texto)",marginTop:3}}>{p.enunciado}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // VISTA: métricas de estudio (todos)
  if (vista === "metricas") {
    const m = metricasQuiz;
    const colorPct = (p) => p >= 80 ? "var(--exito)" : p >= 60 ? "var(--alerta)" : "var(--peligro)";
    return (
      <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
        <button onClick={()=>setVista("quiz")} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:"var(--fs-2)",cursor:"pointer",marginBottom:12,padding:0}}>← Volver al quiz</button>
        <div style={{fontSize:16,fontWeight:700,color:"var(--texto)",marginBottom:2}}>📊 Mi progreso</div>
        <div style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)",marginBottom:14}}>Se calcula con tus respuestas en este dispositivo.</div>

        {m.total === 0 ? (
          <div style={{textAlign:"center",padding:"30px 16px",color:"var(--texto-ter)",fontSize:"var(--fs-2)",lineHeight:1.6}}>
            Todavía no has respondido preguntas.<br/>Responde algunas y aquí verás en qué temas estás más débil.
          </div>
        ) : (
          <>
            <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:14}}>
              <div style={{flex:"1 1 110px",background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"12px"}}>
                <div style={{fontSize:24,fontWeight:700,color:colorPct(m.pct)}}>{m.pct}%</div>
                <div style={{fontSize:"var(--fs-0)",color:"var(--texto-sec)"}}>Correctas ({m.aciertos}/{m.total})</div>
              </div>
              <div style={{flex:"1 1 110px",background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"12px"}}>
                <div style={{fontSize:24,fontWeight:700,color:m.pctUlt!=null?colorPct(m.pctUlt):"var(--texto-ter)"}}>{m.pctUlt!=null?`${m.pctUlt}%`:"—"}</div>
                <div style={{fontSize:"var(--fs-0)",color:"var(--texto-sec)"}}>Últimas 20</div>
              </div>
              <div style={{flex:"1 1 110px",background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"12px"}}>
                <div style={{fontSize:24,fontWeight:700,color:"var(--primario)"}}>{m.cats.length}</div>
                <div style={{fontSize:"var(--fs-0)",color:"var(--texto-sec)"}}>Temas practicados</div>
              </div>
            </div>

            {m.debiles.length > 0 && (
              <div style={{background:"var(--peligro-bg)",border:"0.5px solid var(--peligro)",borderRadius:10,padding:"11px 13px",marginBottom:14}}>
                <div style={{fontSize:"var(--fs-2)",fontWeight:700,color:"var(--peligro)",marginBottom:4}}>🎯 Dónde estás más débil</div>
                <div style={{fontSize:"var(--fs-1)",color:"var(--texto)",lineHeight:1.5}}>
                  {m.debiles.map(c => `${c.cat} (${c.pct}%)`).join(" · ")}
                </div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>
                  {m.debiles.slice(0,3).map(c => (
                    <button key={c.cat} onClick={()=>{ setFiltroCat(c.cat); setVista("quiz"); }} style={{padding:"6px 10px",fontSize:"var(--fs-0)",fontWeight:600,background:"var(--superficie)",color:"var(--peligro)",border:"0.5px solid var(--peligro)",borderRadius:14,cursor:"pointer"}}>
                      Practicar {c.cat}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{fontSize:"var(--fs-2)",fontWeight:600,color:"var(--texto)",marginBottom:8}}>Rendimiento por tema</div>
            <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
              {m.cats.map(c => (
                <div key={c.cat} onClick={()=>{ setFiltroCat(c.cat); setVista("quiz"); }} style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:8,padding:"10px 12px",cursor:"pointer"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:5,gap:8}}>
                    <span style={{fontSize:"var(--fs-2)",fontWeight:600,color:"var(--texto)"}}>{c.cat}</span>
                    <span style={{fontSize:"var(--fs-1)",fontWeight:700,color:colorPct(c.pct),flexShrink:0}}>{c.pct}% <span style={{fontWeight:400,color:"var(--texto-ter)"}}>({c.ok}/{c.n})</span></span>
                  </div>
                  <div style={{height:6,background:"var(--fondo-suave)",borderRadius:3,overflow:"hidden"}}>
                    <div style={{width:`${c.pct}%`,height:"100%",background:colorPct(c.pct),borderRadius:3,transition:"width .3s"}}/>
                  </div>
                </div>
              ))}
            </div>

            <button onClick={()=>{ if(confirm("¿Borrar tu historial de respuestas? Las métricas volverán a cero.")){ borrarHistorialQuiz(currentUser.id); setHistorial([]); } }} style={{padding:"8px 12px",fontSize:"var(--fs-1)",background:"none",border:"0.5px solid var(--borde)",color:"var(--texto-ter)",borderRadius:8,cursor:"pointer"}}>
              Reiniciar mi progreso
            </button>
          </>
        )}
      </div>
    );
  }

  // VISTA: quiz (todos)
  return (
    <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,gap:10}}>
        <div><div style={{fontSize:"var(--fs-2)",color:"var(--texto-sec)"}}>{preguntas.length} preguntas para estudiar</div>
          {metricasQuiz.total > 0 && <div style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)",marginTop:2}}>Llevas {metricasQuiz.total} respondidas · {metricasQuiz.pct}% correctas</div>}
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          <button onClick={()=>setVista("metricas")} style={{padding:"7px 12px",fontSize:"var(--fs-1)",background:"var(--superficie)",color:"var(--primario)",border:"0.5px solid var(--borde)",borderRadius:6,cursor:"pointer",fontWeight:500}}>📊 Mi progreso</button>
          {isAdmin && (<>
            <button onClick={()=>setVista("nueva")} style={{padding:"7px 12px",fontSize:"var(--fs-1)",background:"var(--primario)",color:"var(--texto-inv)",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>+ Nueva</button>
            <button onClick={()=>setVista("lista")} style={{padding:"7px 12px",fontSize:"var(--fs-1)",background:"var(--superficie)",color:"var(--primario)",border:"0.5px solid var(--borde)",borderRadius:6,cursor:"pointer"}}>Gestionar</button>
          </>)}
        </div>
      </div>

      {categorias.length > 1 && (
        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:14}}>
          {categorias.map(c => (
            <button key={c} onClick={()=>{setFiltroCat(c);setIdx(0);setSeleccion(null);setMostrarResp(false);}} style={{padding:"4px 11px",fontSize:"var(--fs-0)",borderRadius:14,cursor:"pointer",border:filtroCat===c?"none":"0.5px solid var(--borde)",background:filtroCat===c?"var(--primario)":"var(--superficie)",color:filtroCat===c?"var(--texto-inv)":"var(--texto-sec)",fontWeight:filtroCat===c?600:400}}>{c}</button>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{textAlign:"center",padding:"40px",color:"var(--texto-ter)",fontSize:"var(--fs-2)"}}>Cargando...</div>
      ) : !actual ? (
        <div style={{textAlign:"center",padding:"40px 20px",color:"var(--texto-ter)",fontSize:"var(--fs-2)",lineHeight:1.6}}>
          {preguntas.length === 0 ? (isAdmin ? "Aún no has creado preguntas. Usa el botón \"+ Nueva\"." : "El administrador aún no ha creado preguntas.") : "No hay preguntas en esta categoría."}
        </div>
      ) : (
        <div>
          <div style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)",marginBottom:8,textAlign:"center"}}>Pregunta {idx+1} de {filtradas.length}</div>
          <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"16px",marginBottom:12}}>
            <div style={{fontSize:"var(--fs-3)",fontWeight:600,color:"var(--texto)",lineHeight:1.5,marginBottom:14}}>{actual.enunciado}</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {(actual.alternativas||[]).map((alt, i) => {
                let bg = "var(--superficie)", border = "0.5px solid var(--borde)", color = "var(--texto)";
                if (mostrarResp) {
                  if (i === actual.correcta) { bg = "var(--exito-bg)"; border = "1px solid var(--exito)"; color = "var(--exito)"; }
                  else if (i === seleccion) { bg = "var(--peligro-bg)"; border = "1px solid var(--peligro)"; color = "var(--peligro)"; }
                }
                return (
                  <button key={i} onClick={()=>responder(i)} disabled={mostrarResp} style={{textAlign:"left",padding:"11px 14px",fontSize:"var(--fs-2)",background:bg,border,borderRadius:8,cursor:mostrarResp?"default":"pointer",color,display:"flex",alignItems:"center",gap:10,fontWeight:mostrarResp&&i===actual.correcta?600:400}}>
                    <span style={{fontWeight:600,flexShrink:0}}>{String.fromCharCode(65+i)}.</span>
                    <span style={{flex:1}}>{alt}</span>
                    {mostrarResp && i === actual.correcta && <span>✓</span>}
                    {mostrarResp && i === seleccion && i !== actual.correcta && <span>✗</span>}
                  </button>
                );
              })}
            </div>
            {mostrarResp && (
              <div style={{marginTop:14,display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderRadius:8,background:seleccion===actual.correcta?"var(--exito-bg)":"var(--fondo-suave)"}}>
                <Uros expresion={seleccion===actual.correcta?"bienhecho":"explicando"} size={44}/>
                <div style={{fontSize:"var(--fs-2)",fontWeight:600,color:seleccion===actual.correcta?"var(--exito)":"var(--texto-sec)"}}>
                  {seleccion===actual.correcta ? "¡Bien hecho!" : "Revisa la explicación 👇"}
                </div>
              </div>
            )}
            {mostrarResp && actual.feedback && (
              <div style={{marginTop:10,padding:"12px",background:"var(--fondo-suave)",borderRadius:8,borderLeft:"3px solid var(--primario)"}}>
                <div style={{fontSize:"var(--fs-0)",fontWeight:600,color:"var(--primario)",marginBottom:4}}>💡 Explicación</div>
                <div style={{fontSize:"var(--fs-2)",color:"var(--texto)",lineHeight:1.5,whiteSpace:"pre-wrap"}}>{actual.feedback}</div>
              </div>
            )}
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"space-between"}}>
            <button onClick={anterior} disabled={filtradas.length<=1} style={{padding:"10px 16px",fontSize:"var(--fs-2)",background:"var(--superficie)",color:"var(--texto-sec)",border:"0.5px solid var(--borde)",borderRadius:8,cursor:filtradas.length<=1?"default":"pointer",opacity:filtradas.length<=1?0.5:1}}>← Anterior</button>
            <button onClick={siguiente} disabled={filtradas.length<=1} style={{padding:"10px 16px",fontSize:"var(--fs-2)",background:"var(--primario)",color:"var(--texto-inv)",border:"none",borderRadius:8,cursor:filtradas.length<=1?"default":"pointer",opacity:filtradas.length<=1?0.5:1,fontWeight:500}}>Siguiente →</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ConocimientoPanel({ conocimiento, setConocimiento, isAdmin }) {
  const [vista, setVista] = useState("lista");
  const [seleccionado, setSeleccionado] = useState(null);
  useBackClose(vista !== "lista", () => { setVista("lista"); setSeleccionado(null); });
  const [busqueda, setBusqueda] = useState("");
  const [filtroCat, setFiltroCat] = useState("Todas");
  const [nuevoForm, setNuevoForm] = useState({ titulo:"", categoria:"Guías clínicas", contenido:"", tags:"", fuente:"" });
  const [errorForm, setErrorForm] = useState("");
  const [cargandoLista, setCargandoLista] = useState(false);
  const [cargandoDoc, setCargandoDoc] = useState(false);
  const fileRef = useRef(null);

  // La lista de documentos se carga aquí (bajo demanda), no en cada login.
  useEffect(() => {
    if (conocimiento.length > 0) return; // ya cargada
    setCargandoLista(true);
    listarConocimiento().then(r => { if (r.ok) setConocimiento(r.conocimiento); setCargandoLista(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Abrir un documento: trae su contenido completo solo en ese momento
  const abrirDoc = async (d) => {
    setSeleccionado(d); setVista("ver");
    if (d.contenido == null) {
      setCargandoDoc(true);
      const r = await obtenerConocimiento(d.id);
      setCargandoDoc(false);
      if (r.ok) {
        setSeleccionado(r.item);
        setConocimiento(prev => prev.map(x => x.id === d.id ? { ...x, contenido: r.item.contenido } : x));
      }
    }
  };

  const eliminar = async (id) => {
    if (!confirm("¿Eliminar este documento de la base de conocimiento?")) return;
    const result = await eliminarConocimiento(id);
    if (!result.ok) return alert("Error al eliminar: " + result.error);
    setConocimiento(conocimiento.filter(d => d.id !== id));
    setVista("lista");
    setSeleccionado(null);
  };

  const filtrados = conocimiento.filter(d => {
    const matchCat = filtroCat === "Todas" || d.categoria === filtroCat;
    const q = busqueda.toLowerCase().trim();
    const matchQ = !q || (d.titulo||"").toLowerCase().includes(q) || (d.tags||"").toLowerCase().includes(q) || (d.fuente||"").toLowerCase().includes(q);
    return matchCat && matchQ;
  });

  const handleFile = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 50*1024*1024) { setErrorForm("El archivo no debe superar 50 MB"); return; }
    setErrorForm("");
    const tituloSugerido = f.name.replace(/\.[^.]+$/,"");
    try {
      if (f.type === "text/plain" || f.name.endsWith(".txt") || f.name.endsWith(".md")) {
        const texto = await f.text();
        setNuevoForm({...nuevoForm, contenido: texto, titulo: nuevoForm.titulo || tituloSugerido});
        return;
      }
      if (f.name.endsWith(".docx")) {
        setErrorForm("Procesando documento Word...");
        if (!window.mammoth) {
          await new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";
            script.onload = resolve; script.onerror = reject;
            document.head.appendChild(script);
          });
        }
        const arrayBuffer = await f.arrayBuffer();
        const result = await window.mammoth.extractRawText({ arrayBuffer });
        const texto = result.value || "";
        if (!texto.trim()) { setErrorForm("No se pudo extraer texto del archivo Word"); return; }
        setNuevoForm({...nuevoForm, contenido: texto, titulo: nuevoForm.titulo || tituloSugerido});
        setErrorForm("");
        return;
      }
      if (f.name.endsWith(".doc")) { setErrorForm("El formato .doc no es compatible. Guarda como .docx"); return; }
      if (f.name.endsWith(".pdf")) {
        setErrorForm("Procesando PDF...");
        if (!window.pdfjsLib) {
          await new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
            script.onload = resolve; script.onerror = reject;
            document.head.appendChild(script);
          });
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        }
        const arrayBuffer = await f.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let texto = "";
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          texto += `\n--- Página ${i} ---\n${content.items.map(it => it.str).join(" ")}\n`;
        }
        if (!texto.trim() || texto.replace(/--- Página \d+ ---/g,"").trim().length < 100) { setErrorForm("⚠ Este PDF no contiene texto extraíble (probablemente está escaneado como imágenes). Necesitas un PDF con texto digital, o pega el texto manualmente abajo."); return; }
        setNuevoForm({...nuevoForm, contenido: texto, titulo: nuevoForm.titulo || tituloSugerido});
        setErrorForm("");
        return;
      }
      setErrorForm("Formato no soportado. Usa .txt, .md, .docx o .pdf");
    } catch (err) {
      setErrorForm("Error al procesar: " + (err.message || "desconocido"));
    }
  };

 const guardar = async () => {
  setErrorForm("");
  if (!nuevoForm.titulo.trim()) return setErrorForm("Ingresa un título");
  if (!nuevoForm.contenido.trim()) return setErrorForm("Ingresa o sube el contenido");
  if (nuevoForm.contenido.length < 50) return setErrorForm("Contenido muy corto (mínimo 50 caracteres)");
  
  const sesionResult = await getSession();
  if (!sesionResult.ok || !sesionResult.session) return setErrorForm("Error de sesión");
  
  const result = await crearConocimiento(sesionResult.session.user.id, {
    titulo: nuevoForm.titulo,
    categoria: nuevoForm.categoria,
    contenido: nuevoForm.contenido,
    tags: nuevoForm.tags,
    fuente: nuevoForm.fuente || "",
  });
  
  if (!result.ok) return setErrorForm("Error al guardar: " + result.error);
  
  // Trocear el contenido en chunks y guardarlos
  const pedazos = trocearTexto(nuevoForm.contenido, 1500, 200);
  if (pedazos.length > 0) {
    setErrorForm(`Guardando ${pedazos.length} fragmentos...`);
    const chunksData = pedazos.map((texto, i) => ({
      documento_id: result.item.id,
      titulo: nuevoForm.titulo,
      fuente: nuevoForm.fuente || "",
      contenido: texto,
      orden: i,
    }));
    await crearChunks(chunksData);
  }
  
  setConocimiento([result.item, ...conocimiento]);
  setNuevoForm({ titulo:"", categoria:"Guías clínicas", contenido:"", tags:"", fuente:"" });
  setErrorForm("");
  setVista("lista");
};

  if (vista === "nuevo") {
    return (
      <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
        <button onClick={()=>{setVista("lista");setErrorForm("");}} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:"var(--fs-2)",cursor:"pointer",marginBottom:12,padding:0}}>← Volver</button>
        <div style={{fontSize:"var(--fs-3)",fontWeight:600,color:"var(--texto)",marginBottom:14}}>Agregar a base de conocimiento</div>
        <div style={{background:"var(--exito-bg)",border:"0.5px solid var(--exito-borde)",borderRadius:8,padding:"10px 12px",marginBottom:14,fontSize:"var(--fs-0)",color:"var(--exito)",lineHeight:1.5}}>📚 Lo que subas será la fuente prioritaria que UroSearch use para responder.</div>
        <label style={labelStyle}>Título del documento</label>
        <input value={nuevoForm.titulo} onChange={e=>setNuevoForm({...nuevoForm,titulo:e.target.value})} placeholder="Ej: Guía EAU 2024 - Litiasis ureteral" style={inputStyle}/>
        <label style={labelStyle}>Categoría</label>
        <select value={nuevoForm.categoria} onChange={e=>setNuevoForm({...nuevoForm,categoria:e.target.value})} style={inputStyle}>
          {CATEGORIAS_KB.map(c=><option key={c}>{c}</option>)}
        </select>
        <label style={labelStyle}>Libro / Fuente (opcional)</label>
        <input value={nuevoForm.fuente||""} onChange={e=>setNuevoForm({...nuevoForm,fuente:e.target.value})} placeholder="Ej: Campbell-Walsh Urology — para agrupar capítulos" style={inputStyle}/>
        <label style={labelStyle}>Contenido del documento</label>
        <div style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)",marginBottom:6}}>Sube un archivo (PDF, Word .docx, .txt, .md, máx 10 MB) o pega el texto</div>
        <input ref={fileRef} type="file" accept=".txt,.md,.pdf,.docx" onChange={handleFile} style={{display:"none"}}/>
        <button onClick={()=>fileRef.current?.click()} style={{width:"100%",padding:"10px",fontSize:"var(--fs-2)",background:"var(--superficie)",color:"var(--primario)",border:"1px dashed var(--primario)",borderRadius:8,cursor:"pointer",marginBottom:8,textAlign:"left"}}>📎 Subir archivo (PDF · Word · TXT)</button>
        <textarea value={nuevoForm.contenido} onChange={e=>setNuevoForm({...nuevoForm,contenido:e.target.value})} placeholder="Pega aquí el contenido..." rows={10} style={{...inputStyle,resize:"vertical"}}/>
        <div style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)",marginTop:-6,marginBottom:10,textAlign:"right"}}>{nuevoForm.contenido.length.toLocaleString()} caracteres</div>
        <label style={labelStyle}>Palabras clave / tags (opcional)</label>
        <input value={nuevoForm.tags} onChange={e=>setNuevoForm({...nuevoForm,tags:e.target.value})} placeholder="Separadas por coma" style={inputStyle}/>
        {errorForm && <div style={{fontSize:"var(--fs-1)",color: errorForm.includes("Procesando")?"var(--exito)":"var(--peligro)",background: errorForm.includes("Procesando")?"var(--exito-bg)":"var(--peligro-bg)",padding:"8px 10px",borderRadius:6,marginBottom:8}}>{errorForm}</div>}
        <button onClick={guardar} style={{...btnPrimary, marginTop:0}}>Guardar documento</button>
      </div>
    );
  }

  if (vista === "ver" && seleccionado) {
    return (
      <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
        <button onClick={()=>{setVista("lista");setSeleccionado(null);}} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:"var(--fs-2)",cursor:"pointer",marginBottom:12,padding:0}}>← Volver</button>
        <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"14px",marginBottom:14}}>
          <div style={{fontSize:"var(--fs-0)",fontWeight:500,color:"var(--primario)",marginBottom:4}}>{seleccionado.categoria}</div>
          <div style={{fontSize:16,fontWeight:600,color:"var(--texto)",marginBottom:6}}>{seleccionado.titulo}</div>
          <div style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)",marginBottom:8}}>Agregado: {seleccionado.fecha_creacion} · {(seleccionado.caracteres ?? seleccionado.contenido?.length ?? 0).toLocaleString()} caracteres</div>
          {isAdmin && <button onClick={()=>eliminar(seleccionado.id)} style={{padding:"5px 10px",fontSize:"var(--fs-0)",background:"var(--superficie)",color:"var(--peligro)",border:"0.5px solid var(--peligro-borde)",borderRadius:6,cursor:"pointer"}}>Eliminar</button>}
        </div>
        <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"14px",fontSize:"var(--fs-2)",color:"var(--texto)",lineHeight:1.6,whiteSpace:"pre-wrap"}}>{cargandoDoc ? "Cargando contenido…" : (seleccionado.contenido || "(Sin contenido)").slice(0,20000)}{!cargandoDoc && (seleccionado.contenido||"").length>20000 ? `\n\n[...] Mostrando los primeros 20.000 de ${(seleccionado.contenido||"").length.toLocaleString()} caracteres. El texto completo está guardado y disponible para el chat.` : ""}</div>
      </div>
    );
  }

  return (
    <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,gap:10}}>
        <div>
          <div style={{fontSize:"var(--fs-3)",fontWeight:600,color:"var(--texto)",marginBottom:2}}>📚 Base de conocimiento</div>
          <div style={{fontSize:"var(--fs-0)",color:"var(--texto-sec)"}}>{cargandoLista ? "Cargando…" : `${conocimiento.length} documentos`}</div>
        </div>
        {isAdmin && <button onClick={()=>setVista("nuevo")} style={{padding:"7px 12px",fontSize:"var(--fs-1)",fontWeight:500,background:"var(--primario)",color:"var(--texto-inv)",border:"none",borderRadius:8,cursor:"pointer",whiteSpace:"nowrap"}}>+ Agregar</button>}
      </div>
      <input value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="Buscar..." style={{...inputStyle, marginBottom:8}}/>
      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:14}}>
        {["Todas",...CATEGORIAS_KB].map(c => (
          <button key={c} onClick={()=>setFiltroCat(c)} style={{padding:"4px 10px",fontSize:"var(--fs-0)",fontWeight:filtroCat===c?500:400,borderRadius:14,cursor:"pointer",border:filtroCat===c?"none":"0.5px solid var(--borde)",background:filtroCat===c?"var(--primario)":"var(--superficie)",color:filtroCat===c?"var(--texto-inv)":"var(--texto-sec)"}}>{c}</button>
        ))}
      </div>
      {filtrados.length === 0 ? (
        <div style={{textAlign:"center",padding:"40px 20px",color:"var(--texto-ter)",fontSize:"var(--fs-2)",lineHeight:1.6}}>{conocimiento.length === 0 ? (isAdmin ? "Aún no has agregado documentos." : "El administrador aún no ha cargado documentos.") : "Ningún documento coincide"}</div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {filtrados.map(d => (
            <div key={d.id} onClick={()=>abrirDoc(d)} style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"12px 14px",cursor:"pointer"}}>
              <div style={{fontSize:"var(--fs-0)",fontWeight:500,color:"var(--primario)",marginBottom:3}}>{d.categoria}{d.fuente ? <span style={{marginLeft:6,fontSize:"var(--fs-xs)",background:"var(--ccv-bg)",color:"var(--ccv)",padding:"1px 7px",borderRadius:8,fontWeight:600}}>📖 {d.fuente}</span> : null}</div>
              <div style={{fontSize:"var(--fs-2)",fontWeight:500,color:"var(--texto)",marginBottom:4}}>{d.titulo}</div>
              <div style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)"}}>{new Date(d.fecha_creacion).toLocaleDateString("es-CL")}{(d.caracteres ?? d.contenido?.length) ? ` · ${Number(d.caracteres ?? d.contenido.length).toLocaleString()} caracteres` : ""}</div>
              {d.tags ? <div style={{fontSize:"var(--fs-0)",color:"var(--texto-sec)",marginTop:5}}>{d.tags}</div> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PROTOCOLOS_CIRUGIAS = [
  {
    id: "pc1", titulo: "Prostatectomía Radical", categoria: "Oncología",
    descripcion: "Resección completa de la próstata con vesículas seminales por adenocarcinoma prostático localizado.",
    indicaciones: ["Cáncer de próstata localizado (T1-T2)", "Expectativa de vida >10 años", "Pacientes con buen estado funcional", "Tumores Gleason 7+ o alto riesgo seleccionados"],
    contraindicaciones: ["Enfermedad metastásica", "Comorbilidad severa", "Expectativa de vida <10 años"],
    preparacion: ["Suspender anticoagulantes 7 días antes", "Profilaxis ATB: cefazolina 2g IV", "TVP: HBPM + medias compresivas", "Régimen cero 8h", "Enema evacuante la noche previa"],
    tecnica: ["Posición Trendelenburg ~25°", "Acceso transperitoneal o extraperitoneal (laparoscópico/robótico)", "Disección espacio Retzius", "Control complejo venoso dorsal", "Sección cuello vesical", "Disección vesículas seminales y conductos deferentes", "Preservación de bandeletas neurovasculares (cuando indicado)", "Anastomosis vesicouretral con sutura continua (Van Velthoven)", "Drenaje y revisión hemostasia"],
    postoperatorio: ["Foley 7-14 días", "Drenaje retirar al débito <50cc/24h", "Deambulación precoz 24h", "Cistografía pre-retiro Foley si dudas", "Control PSA 6 sem post-Tx (objetivo <0.1 ng/ml)"],
    complicaciones: ["Sangrado intraoperatorio", "Lesión rectal (raro)", "Incontinencia urinaria de esfuerzo", "Disfunción eréctil", "Estenosis anastomosis vesicouretral", "Fuga urinaria", "TVP/TEP"],
    duracion: "3-5 horas", anestesia: "General"
  },
  {
    id: "pc2", titulo: "Nefrectomía Parcial", categoria: "Oncología",
    descripcion: "Resección de tumor renal con preservación del parénquima sano. Estándar para masas renales pequeñas (<7 cm).",
    indicaciones: ["Masa renal T1a (<4 cm) - imperativa", "T1b (4-7 cm) - electiva si factible", "Riñón único o función renal comprometida", "Tumores bilaterales"],
    contraindicaciones: ["Tumores centrales con compromiso hiliar extenso", "Trombo en VCI", "Múltiples tumores difusos"],
    preparacion: ["UroTAC con fase nefrográfica y excretora", "Score RENAL/PADUA", "Función renal basal", "Profilaxis ATB"],
    tecnica: ["Posición lumbotomía", "Acceso laparoscópico/robótico (preferido) o abierto", "Movilización colon y exposición renal", "Identificación pedículo renal", "Clampaje arterial selectivo (objetivo isquemia <25 min)", "Resección tumor con margen de seguridad", "Renorrafia en 2 planos (medular y cortical)", "Desclampaje y verificación hemostasia", "Drenaje perirrenal"],
    postoperatorio: ["Foley 24-48h", "Drenaje 2-5 días", "Control función renal", "TC contraste 3 meses", "Seguimiento oncológico cada 6 meses"],
    complicaciones: ["Sangrado", "Fístula urinaria", "Disfunción renal aguda", "Pseudoaneurisma arterial", "Recurrencia local"],
    duracion: "2-4 horas", anestesia: "General"
  },
  {
    id: "pc3", titulo: "NLP - Nefrolitotomía Percutánea", categoria: "Litiasis",
    descripcion: "Extracción endoscópica de cálculos renales mediante acceso percutáneo. Estándar para cálculos >2 cm.",
    indicaciones: ["Litiasis renal >2 cm", "Cálculo coraliforme parcial o completo", "Cálculo cáliz inferior >1.5 cm", "Falla de LEOC o URS", "Anomalías anatómicas (riñón herradura, divertículo)"],
    contraindicaciones: ["Coagulopatía no corregida", "ITU activa no tratada", "Embarazo", "Tumor renal en trayecto"],
    preparacion: ["Urocultivo negativo o ATB dirigido", "UroTAC sin contraste", "Profilaxis ATB de amplio espectro", "Catéter ureteral retrógrado previo"],
    tecnica: ["Posición prona o supina (Valdivia)", "Punción caliceal guía ecográfica/fluoroscópica", "Dilatación tracto Amplatz hasta 24-30 Fr", "Nefroscopia rígida o flexible", "Fragmentación: balística, ultrasónica o láser holmium", "Extracción fragmentos", "Revisión de cavidades", "Nefrostomía o tubeless según caso"],
    postoperatorio: ["Nefrostomía 24-48h (si se deja)", "Doble J 2-4 semanas", "Control imagen (Rx/Eco) al 1er día", "Profilaxis ATB 5-7 días", "Hidratación abundante"],
    complicaciones: ["Sangrado (1-3% requiere embolización)", "Sepsis urinaria", "Lesión pleural (acceso supracostal)", "Lesión visceral (colon, hígado, bazo)", "Fístula urinaria persistente", "Stenosis del tracto"],
    duracion: "90-180 min", anestesia: "General"
  },
  {
    id: "pc4", titulo: "URS Flexible con Láser Holmium", categoria: "Litiasis",
    descripcion: "Ureteroscopía retrógrada con láser para fragmentación de cálculos uretrales y/o renales.",
    indicaciones: ["Litiasis ureteral cualquier localización", "Litiasis renal <2 cm", "Falla de LEOC", "Cálculo cáliz inferior con factores desfavorables para LEOC", "Diagnóstico/tratamiento de tumor uretral"],
    contraindicaciones: ["ITU activa", "Estenosis ureteral severa no franqueable", "Coagulopatía"],
    preparacion: ["Urocultivo negativo", "UroTAC", "Profilaxis ATB monodosis", "Doble J previo (opcional para predilatar)"],
    tecnica: ["Posición litotomía", "Cistoscopia + acceso ureteral", "Guía hidrofílica", "Vaina de acceso ureteral 12-14 Fr (opcional)", "URS flexible digital", "Identificación cálculo", "Fragmentación con láser holmium (energía 0.5-1J, frecuencia 5-15 Hz)", "Extracción fragmentos con basket Nitinol", "Doble J final"],
    postoperatorio: ["Doble J 1-4 semanas según caso", "ATB 3-5 días", "Analgesia oral", "Control con imagen al retiro del catéter"],
    complicaciones: ["Lesión ureteral (avulsión rara)", "Hematuria transitoria", "Sepsis", "Estenosis ureteral", "Migración de cálculos"],
    duracion: "45-120 min", anestesia: "General o Espinal"
  },
  {
    id: "pc5", titulo: "Trasplante Renal - Receptor", categoria: "Trasplante",
    descripcion: "Implante de injerto renal de donante vivo o cadavérico en fosa iliaca del receptor.",
    indicaciones: ["Enfermedad renal crónica terminal en diálisis", "ERC pre-diálisis con TFG <20 ml/min", "Idealmente trasplante anticipado"],
    contraindicaciones: ["Infección activa no controlada", "Cáncer activo", "Patología psiquiátrica severa no estabilizada", "Adicción activa"],
    preparacion: ["Estudio inmunológico (HLA, PRA, cross-match)", "Evaluación cardiovascular completa", "Catéter doble J en injerto durante extracción", "Inmunosupresión inducción (basiliximab/timoglobulina)", "Profilaxis ATB"],
    tecnica: ["Acceso fosa iliaca (preferentemente derecha)", "Disección extraperitoneal de vasos iliacos", "Anastomosis venosa: vena renal del injerto a vena iliaca externa", "Anastomosis arterial: arteria renal a iliaca externa o interna", "Reperfusión y verificación de hemostasia", "Anastomosis ureterovesical (técnica Lich-Gregoir extravesical)", "Stent doble J intraureteral", "Drenaje perirrenal"],
    postoperatorio: ["Foley 5-7 días", "Drenaje 5-10 días", "Doble J 4-6 semanas", "Inmunosupresión triple (tacrolimus + MMF + corticoides)", "Profilaxis CMV y PCP", "Control función renal diario primera semana"],
    complicaciones: ["Rechazo agudo", "Trombosis vascular del injerto", "Estenosis arterial tardía", "Fístula urinaria", "Estenosis ureterovesical", "Linfocele", "Infecciones oportunistas"],
    duracion: "3-5 horas", anestesia: "General"
  },
  {
    id: "pc6", titulo: "Cistectomía Radical con Derivación", categoria: "Oncología",
    descripcion: "Resección completa de la vejiga con derivación urinaria por cáncer vesical infiltrante.",
    indicaciones: ["Cáncer vesical músculo-infiltrante (T2-T4a)", "T1G3 de alto riesgo refractario a BCG", "Carcinoma in situ persistente refractario", "Tumores vesicales no urotelial agresivos"],
    contraindicaciones: ["Enfermedad metastásica diseminada", "Comorbilidad severa que impida cirugía mayor"],
    preparacion: ["Quimioterapia neoadyuvante (cisplatino-based)", "Preparación intestinal", "Marcaje sitio estoma por enterostomista", "Profilaxis ATB amplio espectro", "Evaluación cardiopulmonar"],
    tecnica: ["Acceso laparotomía media o laparoscópico/robótico", "Linfadenectomía pelviana extendida", "Cistectomía radical (con próstata en hombre, útero/anexos en mujer)", "Selección derivación: Bricker (conducto ileal) vs neovejiga ortotópica vs ureterostomía", "Construcción derivación con 15-20 cm íleon terminal (Bricker)", "Anastomosis ureteroentérica", "Maduración estoma", "Cierre"],
    postoperatorio: ["SNG 2-3 días", "Doble J ureteral 2-3 semanas", "Inicio dieta progresiva", "Cuidados estoma con enfermera especializada", "Adyuvancia oncológica según patología"],
    complicaciones: ["Fuga anastomosis intestinal", "Estenosis ureteroentérica", "ITU recurrente", "Hernia paraestomal", "Acidosis metabólica hiperclorémica", "Sepsis"],
    duracion: "5-8 horas", anestesia: "General"
  },
  {
    id: "pc7", titulo: "Nefrostomía Percutánea", categoria: "Derivaciones",
    descripcion: "Derivación urinaria temporal mediante catéter percutáneo en sistema colector renal.",
    indicaciones: ["Uropatía obstructiva con dilatación", "Pionefrosis", "Acceso para procedimientos endourológicos", "Fístula urinaria post-quirúrgica", "Trasplante renal con obstrucción"],
    contraindicaciones: ["Coagulopatía no corregida (relativa)", "Falta de dilatación del sistema colector"],
    preparacion: ["Coagulación normal (INR <1.5, plaquetas >50.000)", "Profilaxis ATB monodosis", "Anestesia local + sedación o general"],
    tecnica: ["Posición prona o decúbito lateral", "Identificación cáliz inferior por ecografía/fluoroscopia", "Anestesia local infiltrativa", "Punción con aguja Chiba 22 Ga", "Verificación de orina y opacificación", "Paso de guía", "Dilatación tracto", "Inserción catéter pigtail 8-12 Fr", "Verificación posición fluoroscópica", "Fijación catéter a piel"],
    postoperatorio: ["Mantener fijación", "Vigilar débito y características de orina", "Cambio programado cada 2-3 meses", "Profilaxis ATB en caso de manipulación"],
    complicaciones: ["Sangrado/hematoma perirrenal", "Infección/sepsis", "Migración o salida del catéter", "Fístula AV (1%)", "Lesión pleural si acceso supracostal", "Lesión visceral (raro)"],
    duracion: "20-40 min", anestesia: "Local + sedación"
  },
  {
    id: "pc8", titulo: "RTU-Vejiga", categoria: "Oncología",
    descripcion: "Resección transuretral de tumor vesical con fines diagnósticos y terapéuticos.",
    indicaciones: ["Lesión vesical sospechosa de tumor", "Estadificación de cáncer vesical", "Tratamiento de tumores no músculo-infiltrantes (Ta, T1)"],
    contraindicaciones: ["ITU activa no tratada", "Coagulopatía severa"],
    preparacion: ["Urocultivo previo", "Profilaxis ATB monodosis", "Suspender anticoagulantes según riesgo"],
    tecnica: ["Posición litotomía", "Cistoscopia diagnóstica completa", "Mapeo lesional", "Resección con asa monopolar/bipolar incluyendo músculo detrusor", "Resección lecho tumoral", "Coagulación bordes", "Toma biopsias mapeo si carcinoma in situ sospechado", "Instilación intravesical de quimioterapia precoz (mitomicina/epirrubicina) si NMI"],
    postoperatorio: ["Foley con irrigación continua 24h", "Retiro Foley 24-48h", "ATB profilaxis 3 días", "Estudio anatomopatológico"],
    complicaciones: ["Perforación vesical (intraperitoneal o extraperitoneal)", "Sangrado postoperatorio", "ITU", "Estenosis uretral", "Síndrome de RTU (raro con bipolar)"],
    duracion: "30-90 min", anestesia: "Espinal o General"
  }
];

const CATEGORIAS_CIRUGIAS = ["Todas", "Oncología", "Litiasis", "Derivaciones", "Trasplante", "Funcional", "Otras"];

function CirugiasBiblioteca() {
  const [seleccionado, setSeleccionado] = useState(null);
  useBackClose(!!seleccionado, () => setSeleccionado(null));
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState("Todas");

  const filtrados = PROTOCOLOS_CIRUGIAS.filter(p => {
    const matchCat = filtro === "Todas" || p.categoria === filtro;
    const q = busqueda.toLowerCase().trim();
    const matchQ = !q || p.titulo.toLowerCase().includes(q) || p.descripcion.toLowerCase().includes(q);
    return matchCat && matchQ;
  });

  if (seleccionado) {
    const Section = ({ titulo, items, color = "var(--primario)" }) => (
      <div style={{marginBottom:14}}>
        <div style={{fontSize:"var(--fs-1)",fontWeight:600,color,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.3px"}}>{titulo}</div>
        <ul style={{margin:0,paddingLeft:18,fontSize:"var(--fs-2)",color:"var(--texto)",lineHeight:1.6}}>
          {items.map((it,i) => <li key={i} style={{marginBottom:3}}>{it}</li>)}
        </ul>
      </div>
    );
    return (
      <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
        <button onClick={()=>setSeleccionado(null)} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:"var(--fs-2)",cursor:"pointer",marginBottom:12,padding:0}}>← Volver a cirugías</button>
        <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"16px",marginBottom:14}}>
          <div style={{fontSize:"var(--fs-0)",fontWeight:500,color:"var(--primario)",marginBottom:4}}>{seleccionado.categoria}</div>
          <div style={{fontSize:18,fontWeight:600,color:"var(--texto)",marginBottom:8}}>{seleccionado.titulo}</div>
          <div style={{fontSize:"var(--fs-2)",color:"var(--texto-sec)",lineHeight:1.5,marginBottom:10}}>{seleccionado.descripcion}</div>
          <div style={{display:"flex",gap:14,fontSize:"var(--fs-0)",color:"var(--texto-ter)",paddingTop:8,borderTop:"0.5px solid var(--fondo)"}}>
            <span>⏱ Duración: <strong style={{color:"var(--texto)"}}>{seleccionado.duracion}</strong></span>
            <span>💉 Anestesia: <strong style={{color:"var(--texto)"}}>{seleccionado.anestesia}</strong></span>
          </div>
        </div>
        <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"16px",marginBottom:14}}>
          <Section titulo="✓ Indicaciones" items={seleccionado.indicaciones} color="var(--exito)"/>
          <Section titulo="✗ Contraindicaciones" items={seleccionado.contraindicaciones} color="var(--peligro)"/>
        </div>
        <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"16px",marginBottom:14}}>
          <Section titulo="📋 Preparación pre-operatoria" items={seleccionado.preparacion}/>
          <Section titulo="🔪 Técnica quirúrgica" items={seleccionado.tecnica}/>
          <Section titulo="🛌 Manejo postoperatorio" items={seleccionado.postoperatorio}/>
        </div>
        <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"16px"}}>
          <Section titulo="⚠️ Complicaciones potenciales" items={seleccionado.complicaciones} color="var(--alerta)"/>
        </div>
      </div>
    );
  }

  return (
    <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
      <div style={{marginBottom:14}}>        <div style={{fontSize:"var(--fs-2)",color:"var(--texto-sec)"}}>{PROTOCOLOS_CIRUGIAS.length} procedimientos urológicos estándar</div>
      </div>
      <input value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="Buscar cirugía..." style={{...inputStyle, marginBottom:8}}/>
      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:14}}>
        {CATEGORIAS_CIRUGIAS.map(c => (
          <button key={c} onClick={()=>setFiltro(c)} style={{padding:"4px 10px",fontSize:"var(--fs-0)",fontWeight:filtro===c?500:400,borderRadius:14,cursor:"pointer",border:filtro===c?"none":"0.5px solid var(--borde)",background:filtro===c?"var(--primario)":"var(--superficie)",color:filtro===c?"var(--texto-inv)":"var(--texto-sec)"}}>{c}</button>
        ))}
      </div>
      {filtrados.length === 0 ? (
        <div style={{textAlign:"center",padding:"40px 20px",color:"var(--texto-ter)",fontSize:"var(--fs-2)"}}>Ningún procedimiento coincide</div>
      ) : (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:10}}>
          {filtrados.map(p => (
            <div key={p.id} onClick={()=>setSeleccionado(p)} style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"12px 14px",cursor:"pointer",borderLeft:"3px solid var(--primario)"}}>
              <div style={{fontSize:"var(--fs-xs)",fontWeight:500,color:"var(--primario)",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.3px"}}>{p.categoria}</div>
              <div style={{fontSize:"var(--fs-2)",fontWeight:500,color:"var(--texto)",marginBottom:6}}>{p.titulo}</div>
              <div style={{fontSize:"var(--fs-0)",color:"var(--texto-sec)",lineHeight:1.4,marginBottom:8,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{p.descripcion}</div>
              <div style={{display:"flex",gap:8,fontSize:"var(--fs-xs)",color:"var(--texto-ter)"}}>
                <span>⏱ {p.duracion}</span>
                <span>💉 {p.anestesia}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConocimientoHub({ conocimiento, setConocimiento, isAdmin, currentUser, videos, setVideos, setPlayingVideo, mapaTema, setMapaTema, mapaActual, setMapaActual, mapaLoading, generarMapa, topicOpen, setTopicOpen, mapasGuardados, onGuardarMapa, onEliminarMapa, onCargarMapaGuardado, guardandoMapa, subTab, setSubTab }) {
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0}}>

      {subTab === "mapas" && (
  <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
    {/* MAPAS PRECARGADOS */}
    <div style={{marginBottom:16}}>
      <div style={{fontSize:"var(--fs-2)",fontWeight:500,color:"var(--texto-sec)",marginBottom:10}}>Mapas precargados</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8}}>
        {TOPICS.map(t => (
          <div key={t.id}>
            <button onClick={() => setTopicOpen(topicOpen===t.id ? null : t.id)} style={{width:"100%",padding:"8px 10px",fontSize:"var(--fs-1)",fontWeight:500,textAlign:"left",background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:8,color:"var(--texto)",cursor:"pointer",borderBottomLeftRadius:topicOpen===t.id ? 0 : 8,borderBottomRightRadius:topicOpen===t.id ? 0 : 8}}>{t.label} {topicOpen===t.id ? "▲" : "▼"}</button>
            {topicOpen===t.id && (
              <div style={{border:"0.5px solid var(--borde)",borderTop:"none",borderRadius:"0 0 8px 8px",overflow:"hidden",background:"var(--superficie)"}}>
                {t.subtopics.map(s => <button key={s} onClick={() => { generarMapa(s); setTopicOpen(null); }} style={{display:"block",width:"100%",padding:"7px 12px",fontSize:"var(--fs-1)",textAlign:"left",background:"var(--superficie)",border:"none",borderTop:"0.5px solid var(--fondo)",color:"var(--texto-sec)",cursor:"pointer"}}>{s}</button>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>

    {/* GENERAR MAPA CON IA */}
    <div style={{marginBottom:16}}>
      <div style={{fontSize:"var(--fs-2)",fontWeight:500,color:"var(--texto-sec)",marginBottom:8}}>Generar mapa con IA</div>
      <div style={{display:"flex",gap:8}}>
        <input value={mapaTema} onChange={e=>setMapaTema(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")generarMapa(mapaTema);}} placeholder="Ej: Hematuria macroscópica..." style={{flex:1,padding:"9px 12px",fontSize:"var(--fs-2)",borderRadius:8,border:"0.5px solid var(--borde)",background:"var(--superficie)",color:"var(--texto)",outline:"none"}}/>
        <button onClick={()=>generarMapa(mapaTema)} disabled={mapaLoading||!mapaTema.trim()} style={{padding:"9px 14px",borderRadius:8,border:"none",background:mapaLoading||!mapaTema.trim()?"var(--borde)":"var(--primario)",color:"var(--texto-inv)",fontSize:"var(--fs-2)",cursor:mapaLoading||!mapaTema.trim()?"default":"pointer",fontWeight:500}}>{mapaLoading ? "Generando..." : "Generar ↗"}</button>
      </div>
    </div>

    {mapaLoading && <div style={{textAlign:"center",padding:"40px 0",color:"var(--texto-ter)",fontSize:"var(--fs-2)"}}>Generando mapa...</div>}

    {/* MAPA ACTUAL CON BOTÓN DE GUARDAR */}
    {mapaActual && !mapaLoading && (
      <div style={{border:"0.5px solid var(--borde)",borderRadius:12,overflow:"hidden",background:"var(--superficie)",marginBottom:16}}>
        <div style={{padding:"10px 14px",borderBottom:"0.5px solid var(--borde)",display:"flex",justifyContent:"space-between",alignItems:"center",background:"var(--fondo-suave)",gap:10}}>
          <div style={{fontSize:"var(--fs-2)",fontWeight:500,color:"var(--texto)"}}>{mapaActual.titulo}</div>
          <button 
            onClick={onGuardarMapa} 
            disabled={guardandoMapa}
            style={{
              padding:"5px 12px",
              fontSize:"var(--fs-0)",
              fontWeight:500,
              background: guardandoMapa ? "var(--borde)" : "var(--primario)",
              color:"var(--texto-inv)",
              border:"none",
              borderRadius:6,
              cursor: guardandoMapa ? "default" : "pointer",
              whiteSpace:"nowrap"
            }}
          >
            {guardandoMapa ? "Guardando..." : "💾 Guardar mapa"}
          </button>
        </div>
        <MapaConceptual data={mapaActual}/>
      </div>
    )}

    {!mapaActual && !mapaLoading && <div style={{textAlign:"center",padding:"32px 0",color:"var(--texto-ter)",fontSize:"var(--fs-2)"}}>Selecciona un tema o escribe uno</div>}

    {/* MIS MAPAS GUARDADOS */}
    {mapasGuardados && mapasGuardados.length > 0 && (
      <div style={{marginTop:24, paddingTop:16, borderTop:"0.5px solid var(--borde)"}}>
        <div style={{fontSize:"var(--fs-2)",fontWeight:500,color:"var(--texto-sec)",marginBottom:10}}>
          Mis mapas guardados ({mapasGuardados.length})
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:8}}>
          {mapasGuardados.map(mapa => (
            <div 
              key={mapa.id}
              style={{
                background:"var(--superficie)",
                border:"0.5px solid var(--borde)",
                borderRadius:8,
                padding:"10px 12px",
                position:"relative",
              }}
            >
              <button
                onClick={() => onCargarMapaGuardado(mapa)}
                style={{
                  width:"100%",
                  background:"none",
                  border:"none",
                  padding:0,
                  textAlign:"left",
                  cursor:"pointer",
                  paddingRight:24,
                }}
              >
                <div style={{fontSize:"var(--fs-1)",fontWeight:500,color:"var(--texto)",marginBottom:3, lineHeight:1.3}}>
                  {mapa.titulo}
                </div>
                <div style={{fontSize:"var(--fs-xs)",color:"var(--texto-ter)"}}>
                  {new Date(mapa.fecha_creacion).toLocaleDateString("es-CL")}
                </div>
              </button>
              <button
                onClick={() => onEliminarMapa(mapa.id)}
                style={{
                  position:"absolute",
                  top:6,
                  right:6,
                  background:"none",
                  border:"none",
                  color:"var(--peligro)",
                  fontSize:"var(--fs-2)",
                  cursor:"pointer",
                  padding:2,
                }}
                title="Eliminar mapa"
              >🗑</button>
            </div>
          ))}
        </div>
      </div>
    )}
  </div>
)}

      {subTab === "videos" && <VideoLibrary videos={videos} setVideos={setVideos} isAdmin={isAdmin} setPlayingVideo={setPlayingVideo}/>}

      {subTab === "cirugias" && <CirugiasBiblioteca/>}
      {subTab === "preguntas" && <PreguntasPanel currentUser={currentUser} isAdmin={isAdmin}/>}
      {subTab === "medicamentos" && <MedicamentosPanel currentUser={currentUser} isAdmin={isAdmin}/>}
      {subTab === "scores" && <ScoresPanel/>}

      {subTab === "documentos" && isAdmin && <ConocimientoPanel conocimiento={conocimiento} setConocimiento={setConocimiento} isAdmin={isAdmin}/>}
    </div>
  );
}

function CampoAlt({ label, opciones, value, onChange }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
        {opciones.map(op => {
          const sel = value === op;
          return <button key={op} onClick={()=>onChange(sel ? "" : op)} style={{padding:"5px 10px",fontSize:"var(--fs-0)",fontWeight:sel?500:400,borderRadius:14,cursor:"pointer",border:sel?"none":"0.5px solid var(--borde)",background:sel?"var(--primario)":"var(--superficie)",color:sel?"var(--texto-inv)":"var(--texto-sec)"}}>{op}</button>;
        })}
      </div>
    </div>
  );
}

const SERVICIOS_SUGERIDOS = ["Medicina", "Urología", "Cirugía", "UTI", "UCI", "1er piso", "2do piso", "3er piso"];
const PENDIENTES_SUGERIDOS = ["Pasar visita", "Revisar exámenes", "Llamar a familia", "Solicitar interconsulta", "Programar pabellón", "Indicar alta", "Revisar imágenes", "Curación de catéter", "Cambio de Foley", "Retirar drenaje", "Control de signos vitales", "Solicitar urocultivo"];

// ---------- EQUIPOS ----------
function EquiposPanel({ equipos, setEquipos, invitacionesPendientes, setInvitacionesPendientes, currentUser, onCerrar }) {
  const [vista, setVista] = useState("lista");
  const [seleccionado, setSeleccionado] = useState(null);
  useBackClose(vista !== "lista", () => { setVista("lista"); setSeleccionado(null); });
  const [miembros, setMiembros] = useState([]);
  const [invitacionesEquipo, setInvitacionesEquipo] = useState([]);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoDescripcion, setNuevoDescripcion] = useState("");
  const [invitarCorreo, setInvitarCorreo] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const recargarEquipos = async () => {
    const result = await listarMisEquipos();
    if (result.ok) setEquipos(result.equipos);
  };

  const recargarMiembros = async (equipoId) => {
    const result = await listarMiembros(equipoId);
    if (result.ok) setMiembros(result.miembros);
    const invResult = await listarInvitacionesEquipo(equipoId);
    if (invResult.ok) setInvitacionesEquipo(invResult.invitaciones);
  };

  const abrirDetalle = async (equipo) => {
    setSeleccionado(equipo);
    setVista("detalle");
    await recargarMiembros(equipo.id);
  };

  const crearEquipoHandler = async () => {
    setError("");
    if (!nuevoNombre.trim()) return setError("Ingresa un nombre");
    setLoading(true);
    const sesionResult = await getSession();
    if (!sesionResult.ok || !sesionResult.session) {
      setError("Error de sesión");
      setLoading(false);
      return;
    }
    const result = await crearEquipo(sesionResult.session.user.id, nuevoNombre, nuevoDescripcion);
    setLoading(false);
    if (!result.ok) return setError(result.error);
    await recargarEquipos();
    setNuevoNombre("");
    setNuevoDescripcion("");
    setVista("lista");
  };

  const invitar = async () => {
    setError("");
    const correo = invitarCorreo.trim().toLowerCase();
    if (!correo) return setError("Ingresa un correo");
    setLoading(true);
    const userResult = await buscarUsuarioPorCorreo(correo);
    if (!userResult.ok) {
      setLoading(false);
      return setError(userResult.error);
    }
    if (userResult.usuario.estado !== "aprobado") {
      setLoading(false);
      return setError("Ese usuario aún no está aprobado en UroSearch");
    }
    if (miembros.some(m => m.user_id === userResult.usuario.id)) {
      setLoading(false);
      return setError("Ese usuario ya es miembro");
    }
    if (invitacionesEquipo.some(i => i.invitado_id === userResult.usuario.id)) {
      setLoading(false);
      return setError("Ya hay una invitación pendiente para ese usuario");
    }
    const sesionResult = await getSession();
    const result = await crearInvitacion(seleccionado.id, userResult.usuario.id, sesionResult.session.user.id);
    setLoading(false);
    if (!result.ok) return setError(result.error);
    setInvitarCorreo("");
    await recargarMiembros(seleccionado.id);
  };

  const expulsar = async (userId) => {
    if (!confirm("¿Expulsar a este miembro del equipo?")) return;
    const result = await expulsarMiembro(seleccionado.id, userId);
    if (!result.ok) return alert("Error: " + result.error);
    await recargarMiembros(seleccionado.id);
  };

  const aceptar = async (inv) => {
    const sesionResult = await getSession();
    const result = await aceptarInvitacion(inv.id, inv.equipo_id, sesionResult.session.user.id);
    if (!result.ok) return alert("Error: " + result.error);
    setInvitacionesPendientes(prev => prev.filter(i => i.id !== inv.id));
    await recargarEquipos();
  };

  const rechazar = async (inv) => {
    const result = await rechazarInvitacion(inv.id);
    if (!result.ok) return alert("Error: " + result.error);
    setInvitacionesPendientes(prev => prev.filter(i => i.id !== inv.id));
  };

  const salir = async (equipo) => {
    if (equipo.dueno_id === currentUser.id) return alert("Como dueño no puedes salir, debes eliminar el equipo");
    if (!confirm("¿Salir del equipo?")) return;
    const result = await salirDelEquipo(equipo.id, currentUser.id);
    if (!result.ok) return alert("Error: " + result.error);
    await recargarEquipos();
    setSeleccionado(null);
    setVista("lista");
  };

  const eliminarEquipoHandler = async (equipo) => {
    if (!confirm(`¿Eliminar definitivamente "${equipo.nombre}"?\n\nEsto borrará el equipo, sus miembros y sus invitaciones.`)) return;
    const result = await eliminarEquipo(equipo.id);
    if (!result.ok) return alert("Error: " + result.error);
    await recargarEquipos();
    setSeleccionado(null);
    setVista("lista");
  };

  // VISTA: NUEVO EQUIPO
  if (vista === "nuevo") {
    return (
      <div style={{padding:"20px"}}>
        <button onClick={()=>{setVista("lista");setError("");}} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:"var(--fs-2)",cursor:"pointer",marginBottom:12,padding:0}}>← Volver</button>
        <div style={{fontSize:16,fontWeight:600,color:"var(--texto)",marginBottom:14}}>Crear nuevo equipo</div>
        <label style={labelStyle}>Nombre del equipo</label>
        <input value={nuevoNombre} onChange={e=>setNuevoNombre(e.target.value)} placeholder="Ej: Equipo Urología HBV" style={inputStyle} disabled={loading}/>
        <label style={labelStyle}>Descripción (opcional)</label>
        <textarea value={nuevoDescripcion} onChange={e=>setNuevoDescripcion(e.target.value)} placeholder="Para qué se usará este equipo" rows={3} style={{...inputStyle,resize:"none"}} disabled={loading}/>
        {error && <div style={{fontSize:"var(--fs-1)",color:"var(--peligro)",background:"var(--peligro-bg)",padding:"8px 10px",borderRadius:6,marginBottom:8}}>{error}</div>}
        <button onClick={crearEquipoHandler} disabled={loading} style={{...btnPrimary, marginTop:0, opacity: loading ? 0.6 : 1}}>{loading ? "Creando..." : "Crear equipo"}</button>
      </div>
    );
  }

  // VISTA: DETALLE
  if (vista === "detalle" && seleccionado) {
    const esDueño = seleccionado.dueno_id === currentUser.id;
    return (
      <div style={{padding:"20px",overflowY:"auto"}}>
        <button onClick={()=>{setVista("lista");setSeleccionado(null);setError("");}} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:"var(--fs-2)",cursor:"pointer",marginBottom:12,padding:0}}>← Volver a equipos</button>
        <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"14px",marginBottom:14}}>
          <div style={{fontSize:16,fontWeight:600,color:"var(--texto)",marginBottom:4}}>{seleccionado.nombre}</div>
          {seleccionado.descripcion && <div style={{fontSize:"var(--fs-1)",color:"var(--texto-sec)",marginBottom:6}}>{seleccionado.descripcion}</div>}
          <div style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)"}}>{miembros.length} miembros</div>
        </div>

        <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"14px",marginBottom:14}}>
          <div style={{fontSize:"var(--fs-2)",fontWeight:600,color:"var(--texto)",marginBottom:10}}>👥 Miembros</div>
          {miembros.map(m => {
            const perfil = m.perfiles;
            return (
              <div key={m.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 10px",background:"var(--fondo-suave)",borderRadius:6,marginBottom:5}}>
                <div>
                  <div style={{fontSize:"var(--fs-1)",fontWeight:500,color:"var(--texto)"}}>
                    {perfil?.nombre || "Sin nombre"}
                    {m.user_id === seleccionado.dueno_id && <span style={{fontSize:9,marginLeft:6,padding:"1px 6px",background:"var(--primario)",color:"var(--texto-inv)",borderRadius:4}}>DUEÑO</span>}
                    {m.user_id === currentUser.id && <span style={{fontSize:9,marginLeft:6,padding:"1px 6px",background:"var(--exito)",color:"var(--texto-inv)",borderRadius:4}}>TÚ</span>}
                  </div>
                  <div style={{fontSize:"var(--fs-xs)",color:"var(--texto-ter)"}}>{perfil?.correo}</div>
                </div>
                {esDueño && m.user_id !== currentUser.id && (
                  <button onClick={()=>expulsar(m.user_id)} style={{padding:"4px 10px",fontSize:"var(--fs-0)",background:"var(--superficie)",color:"var(--peligro)",border:"0.5px solid var(--peligro-borde)",borderRadius:6,cursor:"pointer"}}>Expulsar</button>
                )}
              </div>
            );
          })}
        </div>

        {esDueño && (
          <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"14px",marginBottom:14}}>
            <div style={{fontSize:"var(--fs-2)",fontWeight:600,color:"var(--texto)",marginBottom:10}}>+ Invitar miembro</div>
            <div style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)",marginBottom:6}}>Solo puedes invitar usuarios ya aprobados en UroSearch</div>
            <div style={{display:"flex",gap:6}}>
              <input value={invitarCorreo} onChange={e=>setInvitarCorreo(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")invitar();}} placeholder="correo del usuario" style={{flex:1,padding:"9px 12px",fontSize:"var(--fs-2)",borderRadius:8,border:"0.5px solid var(--borde)",outline:"none"}} disabled={loading}/>
              <button onClick={invitar} disabled={!invitarCorreo.trim() || loading} style={{padding:"9px 14px",fontSize:"var(--fs-2)",fontWeight:500,background:invitarCorreo.trim() && !loading ?"var(--primario)":"var(--borde)",color:"var(--texto-inv)",border:"none",borderRadius:8,cursor:"pointer"}}>{loading ? "..." : "Invitar"}</button>
            </div>
            {error && <div style={{fontSize:"var(--fs-1)",color:"var(--peligro)",background:"var(--peligro-bg)",padding:"8px 10px",borderRadius:6,marginTop:8}}>{error}</div>}

            {invitacionesEquipo.length > 0 && (
              <div style={{marginTop:12}}>
                <div style={{fontSize:"var(--fs-0)",fontWeight:500,color:"var(--texto-ter)",marginBottom:4}}>Invitaciones pendientes</div>
                {invitacionesEquipo.map(i => (
                  <div key={i.id} style={{padding:"6px 10px",background:"var(--alerta-bg)",borderRadius:6,fontSize:"var(--fs-0)",color:"var(--alerta)",marginBottom:4}}>
                    📨 {i.perfiles?.nombre} ({i.perfiles?.correo})
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{display:"flex",gap:6}}>
          {esDueño ? (
            <button onClick={()=>eliminarEquipoHandler(seleccionado)} style={{flex:1,padding:"10px",fontSize:"var(--fs-2)",background:"var(--superficie)",color:"var(--peligro)",border:"1px solid var(--peligro)",borderRadius:8,cursor:"pointer",fontWeight:500}}>🗑 Eliminar equipo</button>
          ) : (
            <button onClick={()=>salir(seleccionado)} style={{flex:1,padding:"10px",fontSize:"var(--fs-2)",background:"var(--superficie)",color:"var(--peligro)",border:"1px solid var(--peligro)",borderRadius:8,cursor:"pointer",fontWeight:500}}>Salir del equipo</button>
          )}
        </div>
      </div>
    );
  }

  // VISTA: LISTA
  return (
    <div style={{padding:"20px",overflowY:"auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{fontSize:16,fontWeight:600,color:"var(--texto)"}}>👥 Mis equipos</div>
        <button onClick={onCerrar} style={{background:"none",border:"none",fontSize:18,color:"var(--texto-ter)",cursor:"pointer"}}>✕</button>
      </div>

      {invitacionesPendientes.length > 0 && (
        <div style={{marginBottom:16}}>
          <div style={{fontSize:"var(--fs-1)",fontWeight:500,color:"var(--alerta)",marginBottom:6}}>📨 Invitaciones pendientes ({invitacionesPendientes.length})</div>
          {invitacionesPendientes.map(inv => (
            <div key={inv.id} style={{background:"var(--alerta-bg)",border:"0.5px solid var(--alerta-borde)",borderRadius:8,padding:"10px 12px",marginBottom:6}}>
              <div style={{fontSize:"var(--fs-2)",fontWeight:500,color:"var(--alerta)",marginBottom:2}}>{inv.equipos?.nombre}</div>
              <div style={{fontSize:"var(--fs-0)",color:"var(--alerta)",marginBottom:8}}>Invitado por {inv.invitador?.nombre}</div>
              <div style={{display:"flex",gap:6}}>
                <button onClick={()=>aceptar(inv)} style={{flex:1,padding:"6px",fontSize:"var(--fs-1)",background:"var(--exito)",color:"var(--texto-inv)",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>✓ Aceptar</button>
                <button onClick={()=>rechazar(inv)} style={{flex:1,padding:"6px",fontSize:"var(--fs-1)",background:"var(--superficie)",color:"var(--peligro)",border:"0.5px solid var(--peligro)",borderRadius:6,cursor:"pointer",fontWeight:500}}>Rechazar</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <button onClick={()=>setVista("nuevo")} style={{...btnPrimary, marginTop:0, marginBottom:14}}>+ Crear nuevo equipo</button>

      {equipos.length === 0 ? (
        <div style={{textAlign:"center",padding:"30px 20px",color:"var(--texto-ter)",fontSize:"var(--fs-2)",lineHeight:1.6}}>No perteneces a ningún equipo.<br/>Crea uno o espera invitación.</div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {equipos.map(eq => (
            <div key={eq.id} onClick={()=>abrirDetalle(eq)} style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"12px 14px",cursor:"pointer"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4,gap:10}}>
                <div style={{fontSize:"var(--fs-2)",fontWeight:500,color:"var(--texto)"}}>{eq.nombre}</div>
                {eq.dueno_id === currentUser.id && <span style={{fontSize:9,padding:"1px 6px",background:"var(--primario)",color:"var(--texto-inv)",borderRadius:4,fontWeight:500}}>DUEÑO</span>}
              </div>
              {eq.descripcion && <div style={{fontSize:"var(--fs-0)",color:"var(--texto-sec)",marginBottom:4}}>{eq.descripcion}</div>}
              <div style={{fontSize:"var(--fs-xs)",color:"var(--texto-ter)"}}>{eq.miembros_equipo?.length || 0} miembros</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Componente selector de contexto (mío vs equipo) - menú desplegable
function SelectorContexto({ contexto, setContexto, equipos, currentUser, onAbrirEquipos }) {
  const [abierto, setAbierto] = useState(false);
  const misEquipos = equipos.filter(e => 
    e.dueno_id === currentUser.id || 
    e.miembros_equipo?.some(m => m.user_id === currentUser.id)
  );

  const actual = contexto === "personal"
    ? { icono: "👤", nombre: "Mis Pacientes", color: "var(--primario)" }
    : (() => {
        const eq = equipos.find(e => e.id === contexto);
        return eq ? { icono: "👥", nombre: eq.nombre, color: "var(--exito)" } : { icono: "👤", nombre: "Mis Pacientes", color: "var(--primario)" };
      })();

  const elegir = (valor) => { setContexto(valor); setAbierto(false); };

  return (
    <div style={{position:"relative",flexShrink:0,alignSelf:"center",marginLeft:8}}>
      <button data-tour="selector-contexto" onClick={()=>setAbierto(!abierto)} title={`Contexto: ${actual.nombre} · cambiar equipo / mis pacientes`} style={{width:34,height:34,fontSize:16,borderRadius:"50%",cursor:"pointer",border:"1px solid var(--borde)",background:"var(--superficie)",color:actual.color,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
        <span>{actual.icono}</span>
      </button>
      {abierto && (
        <>
          <div onClick={()=>setAbierto(false)} style={{position:"fixed",inset:0,zIndex:20}}/>
          <div style={{position:"absolute",top:"115%",right:0,background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:8,padding:"4px",minWidth:210,zIndex:30,boxShadow:"0 2px 8px rgba(0,0,0,0.12)"}}>
            <div onClick={()=>elegir("personal")} style={{padding:"8px 10px",fontSize:"var(--fs-2)",cursor:"pointer",borderRadius:6,background:contexto==="personal"?"var(--fondo-suave)":"transparent",color:"var(--texto)",display:"flex",alignItems:"center",gap:8}}>
              <span>👤</span> Mis Pacientes {contexto==="personal" && <span style={{marginLeft:"auto",color:"var(--primario)"}}>✓</span>}
            </div>
            {misEquipos.map(eq => (
              <div key={eq.id} onClick={()=>elegir(eq.id)} style={{padding:"8px 10px",fontSize:"var(--fs-2)",cursor:"pointer",borderRadius:6,background:contexto===eq.id?"var(--fondo-suave)":"transparent",color:"var(--texto)",display:"flex",alignItems:"center",gap:8}}>
                <span>👥</span> {eq.nombre} {contexto===eq.id && <span style={{marginLeft:"auto",color:"var(--exito)"}}>✓</span>}
              </div>
            ))}
            <div onClick={()=>{ setAbierto(false); onAbrirEquipos(); }} style={{padding:"8px 10px",fontSize:"var(--fs-2)",cursor:"pointer",borderRadius:6,color:"var(--primario)",borderTop:"0.5px solid var(--fondo)",marginTop:4,display:"flex",alignItems:"center",gap:8}}>
              <span>⚙️</span> Gestionar / crear equipo
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function HospitalPanel({ pacientes, setPacientes, currentUser, tablaCirugias, setTablaCirugias, misServiciosLista, setMisServiciosLista, loadingPacientes, setLoadingPacientes, loadingCirugias, setLoadingCirugias, loadingPendientes, setLoadingPendientes, pendientes, setPendientes, equipos, setEquipos, invitacionesPendientes, setInvitacionesPendientes, users, subTab, setSubTab, contexto, setContexto }) {
  const [mostrarEquipos, setMostrarEquipos] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false); // herramientas de la sección (desde el submenú)
  const config = useConfig();

  // Acciones enviadas desde el submenú de la pestaña Hospital
  useEffect(() => {
    const h = (e) => {
      if (e.detail?.tab !== "hospital") return;
      if (e.detail.accion === "equipos") setMostrarEquipos(true);
      if (e.detail.accion === "tools") setToolsOpen(o => !o);
    };
    window.addEventListener("uro-submenu-accion", h);
    return () => window.removeEventListener("uro-submenu-accion", h);
  }, []);

  useEffect(() => { setToolsOpen(false); }, [subTab]);

  const equipoActual = contexto !== "personal" ? equipos.find(e => e.id === contexto) : null;
  const esEquipo = !!equipoActual;

  // Si el contexto guardado apunta a un equipo que ya no existe, volver a personal
  useEffect(() => {
    if (contexto !== "personal" && equipos.length > 0 && !equipos.find(e => e.id === contexto)) {
      setContexto("personal");
    }
  }, [contexto, equipos]);

  if (mostrarEquipos) {
    return (
      <EquiposPanel equipos={equipos} setEquipos={setEquipos} invitacionesPendientes={invitacionesPendientes} setInvitacionesPendientes={setInvitacionesPendientes} currentUser={currentUser} onCerrar={()=>setMostrarEquipos(false)}/>
    );
  }

  const soloLectura = currentUser?.rol === "interno"; // Interno: solo observa en Hospital
  const esUrologo = currentUser?.rol === "urologo" || currentUser?.rol === "residente"; // Recetas: urólogos y residentes

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0}}>
      {subTab === "pacientes" && <PacientesPanel pacientes={pacientes} setPacientes={setPacientes} currentUser={currentUser} contexto={contexto} equipos={equipos} misServiciosLista={misServiciosLista} setMisServiciosLista={setMisServiciosLista} loadingPacientes={loadingPacientes} setLoadingPacientes={setLoadingPacientes} pendientes={pendientes} setPendientes={setPendientes} toolsOpen={toolsOpen} soloLectura={soloLectura}/>}
      {subTab === "tabla" && <TablaQuirurgicaPanel tablaCirugias={tablaCirugias} setTablaCirugias={setTablaCirugias} currentUser={currentUser} contexto={contexto} equipos={equipos} loadingCirugias={loadingCirugias} setLoadingCirugias={setLoadingCirugias} setPacientes={setPacientes} toolsOpen={toolsOpen} soloLectura={soloLectura}/>}
      {subTab === "notas" && <NotasPanel currentUser={currentUser} contexto={contexto} equipos={equipos}/>}
      {subTab === "prescripciones" && esUrologo && <PrescripcionesPanel currentUser={currentUser}/>}
      {subTab === "interconsultas" && <InterconsultasPanel currentUser={currentUser} contexto={contexto}/>}
      {subTab === "ingresos" && <IngresosPanel currentUser={currentUser} contexto={contexto}/>}
      {subTab === "seguimiento" && <SeguimientoPanel currentUser={currentUser} contexto={contexto}/>}
    </div>
  );
}

// ---------- PENDIENTES DEL DÍA ----------
function EncargadosPendiente({ pendiente, miembros, onToggle, nombreMiembro }) {
  const [abierto, setAbierto] = useState(false);
  const encargados = Array.isArray(pendiente.encargados) ? pendiente.encargados : [];
  return (
    <div style={{marginTop:6}}>
      <div style={{display:"flex",flexWrap:"wrap",gap:5,alignItems:"center"}}>
        {encargados.map(id => (
          nombreMiembro(id) && (
            <span key={id} style={{fontSize:"var(--fs-0)",background:"var(--exito-bg)",color:"var(--exito)",padding:"3px 9px",borderRadius:10,fontWeight:600}}>👤 {nombreMiembro(id)}</span>
          )
        ))}
        <button onClick={()=>setAbierto(!abierto)} style={{fontSize:"var(--fs-2)",background:"var(--fondo-suave)",color:"var(--primario)",border:"0.5px solid var(--borde)",borderRadius:"50%",width:24,height:24,cursor:"pointer",fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1,padding:0}}>
          {abierto ? "×" : "+"}
        </button>
      </div>
      {abierto && (
        <div style={{marginTop:4,background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:6,padding:"4px",maxHeight:140,overflowY:"auto"}}>
          {miembros.map(m => {
            const id = m.perfiles?.id;
            const asignado = encargados.includes(id);
            return (
              <div key={id} onClick={()=>onToggle(pendiente, id)} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 5px",cursor:"pointer",fontSize:"var(--fs-1)",color:"var(--texto)"}}>
                <span style={{width:15,height:15,borderRadius:3,border:"1px solid var(--borde)",background:asignado?"var(--exito)":"var(--superficie)",color:"var(--texto-inv)",fontSize:"var(--fs-0)",display:"flex",alignItems:"center",justifyContent:"center"}}>{asignado?"✓":""}</span>
                {m.perfiles?.nombre}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// NOTAS LIBRES (personal / equipo)
// ============================================================
function NotasPanel({ currentUser, contexto, equipos }) {
  const esEquipo = contexto !== "personal";
  const equipoActual = esEquipo ? equipos.find(e => e.id === contexto) : null;
  const [notas, setNotas] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [formAbierto, setFormAbierto] = useState(false); // el formulario aparece solo con el botón "+ Agregar nota"
  const [nueva, setNueva] = useState({ titulo: "", texto: "", visibilidad: esEquipo ? "equipo" : "personal" });
  const [editId, setEditId] = useState(null); const [editT, setEditT] = useState("");
  const abrirEdit = (n) => { setEditId(n.id); setEditT(n.texto || ""); };
  const guardarEdit = async (n) => {
    const t = editT.trim(); if (!t || t === n.texto) { setEditId(null); return; }
    const { error } = await supabase.from("notas").update({ texto: t }).eq("id", n.id);
    if (error) return alert("No se pudo editar: " + error.message);
    setNotas(prev => prev.map(x => x.id === n.id ? { ...x, texto: t } : x)); setEditId(null);
  };
  const imprimirNotaPDF = async (n) => {
    let jsPDF; try { jsPDF = (await import("jspdf")).jsPDF; } catch { return; }
    const doc = new jsPDF({ unit: "mm", format: "a4" }); const W = doc.internal.pageSize.getWidth(), M = 20; let y = 22;
    try { const wm = await logoWatermarkDataUrl(); if (wm) { doc.addImage(wm, "PNG", W - M - 20, 14, 18, 18); if (doc.GState) { doc.saveGraphicsState(); doc.setGState(new doc.GState({ opacity: 0.06 })); doc.addImage(wm, "PNG", W / 2 - 45, 120, 90, 90); doc.restoreGraphicsState(); } } } catch {}
    doc.setFont("times", "bold"); doc.setFontSize(15); doc.setTextColor(20, 20, 20);
    doc.text(n.titulo || "Nota", M, y); y += 8;
    doc.setFont("times", "normal"); doc.setFontSize(9); doc.setTextColor(110, 110, 110);
    doc.text(`${n.autor?.nombre || ""} · ${new Date(n.created_at).toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" })}`, M, y);
    doc.setDrawColor(150); doc.line(M, y + 3, W - M, y + 3); y += 12;
    doc.setFontSize(11.5); doc.setTextColor(20, 20, 20);
    doc.splitTextToSize(n.texto || "", W - 2 * M).forEach(l => { if (y > 285) { doc.addPage(); y = 22; } doc.text(l, M, y); y += 6; });
    doc.save(`nota_${(n.titulo || "nota").replace(/\s+/g, "_").slice(0, 40)}.pdf`);
  };

  const cargar = async () => {
    setCargando(true);
    try {
      let query = supabase.from("notas").select("*, autor:perfiles(nombre)").order("created_at", { ascending: false });
      if (esEquipo) {
        // Notas del equipo (visibles a todos) + mis notas personales dentro de este contexto
        query = query.eq("equipo_id", contexto);
      } else {
        query = query.is("equipo_id", null).eq("autor_id", currentUser.id);
      }
      const { data, error } = await query;
      if (error) throw error;
      // En contexto de equipo, filtrar: las de visibilidad "equipo" las ven todos; las "personal" solo su autor
      const visibles = (data || []).filter(n => n.visibilidad === "equipo" || n.autor_id === currentUser.id);
      setNotas(visibles);
    } catch (e) { alert("Error cargando notas: " + (e.message || e)); }
    setCargando(false);
  };
  useEffect(() => { cargar(); setNueva(n => ({ ...n, visibilidad: esEquipo ? "equipo" : "personal" })); }, [contexto]);

  const guardar = async () => {
    if (!nueva.texto.trim()) return alert("Escribe la nota");
    try {
      const { data, error } = await supabase.from("notas").insert({
        autor_id: currentUser.id,
        equipo_id: esEquipo ? contexto : null,
        titulo: nueva.titulo.trim() || null,
        texto: nueva.texto.trim(),
        visibilidad: esEquipo ? nueva.visibilidad : "personal",
      }).select("*, autor:perfiles(nombre)").single();
      if (error) throw error;
      setNotas(prev => [data, ...prev]);
      // Notificar al equipo si la nota es visible para todos
      if (esEquipo && nueva.visibilidad === "equipo") {
        try {
          const rm = await listarMiembros(contexto);
          if (rm.ok) {
            rm.miembros.forEach(m => {
              const uid = m.perfiles?.id;
              if (uid && uid !== currentUser.id) {
                crearNotificacion(uid, `Nueva nota del equipo${nueva.titulo.trim() ? `: "${nueva.titulo.trim()}"` : ""} — por ${currentUser.nombre}`, "general");
              }
            });
          }
        } catch {}
      }
      setNueva({ titulo: "", texto: "", visibilidad: esEquipo ? "equipo" : "personal" });
      setFormAbierto(false);
    } catch (e) { alert("Error: " + (e.message || e)); }
  };

  const eliminar = async (nota) => {
    if (!confirm("¿Eliminar esta nota?")) return;
    try {
      const { error } = await supabase.from("notas").delete().eq("id", nota.id);
      if (error) throw error;
      setNotas(prev => prev.filter(n => n.id !== nota.id));
    } catch (e) { alert("Error: " + (e.message || e)); }
  };

  return (
    <div style={{padding:"16px",overflowY:"auto"}}>
      {/* El formulario aparece solo al tocar "+ Agregar nota" (submenú de la pestaña) */}
      {!formAbierto ? (
        <button onClick={()=>setFormAbierto(true)} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 16px",fontSize:"var(--fs-2)",fontWeight:600,background:"var(--primario)",color:"var(--texto-inv)",border:"none",borderRadius:8,cursor:"pointer",marginBottom:14}}>+ Agregar nota</button>
      ) : (
        <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"12px",marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{fontSize:"var(--fs-2)",fontWeight:600,color:"var(--texto)"}}>Nueva nota</div>
            <button onClick={()=>setFormAbierto(false)} style={{background:"none",border:"none",fontSize:16,color:"var(--texto-ter)",cursor:"pointer",lineHeight:1,padding:0}}>✕</button>
          </div>
          <input value={nueva.titulo} onChange={e=>setNueva({...nueva,titulo:e.target.value})} placeholder="Título (opcional)" style={{...inputStyle,marginBottom:6}}/>
          <textarea value={nueva.texto} onChange={e=>setNueva({...nueva,texto:e.target.value})} placeholder="Escribe una nota libre..." rows={3} style={{...inputStyle,resize:"vertical",marginBottom:6}}/>
          {esEquipo && (
            <div style={{display:"flex",gap:6,marginBottom:8}}>
              <button onClick={()=>setNueva({...nueva,visibilidad:"equipo"})} style={{flex:1,padding:"7px",fontSize:"var(--fs-1)",borderRadius:8,cursor:"pointer",fontWeight:nueva.visibilidad==="equipo"?600:400,background:nueva.visibilidad==="equipo"?"var(--primario)":"var(--superficie)",color:nueva.visibilidad==="equipo"?"var(--texto-inv)":"var(--texto-sec)",border:nueva.visibilidad==="equipo"?"none":"0.5px solid var(--borde)"}}>👥 La ve el equipo</button>
              <button onClick={()=>setNueva({...nueva,visibilidad:"personal"})} style={{flex:1,padding:"7px",fontSize:"var(--fs-1)",borderRadius:8,cursor:"pointer",fontWeight:nueva.visibilidad==="personal"?600:400,background:nueva.visibilidad==="personal"?"var(--primario)":"var(--superficie)",color:nueva.visibilidad==="personal"?"var(--texto-inv)":"var(--texto-sec)",border:nueva.visibilidad==="personal"?"none":"0.5px solid var(--borde)"}}>🔒 Solo yo</button>
            </div>
          )}
          <button onClick={guardar} disabled={!nueva.texto.trim()} style={{...btnPrimary,marginTop:0,opacity:nueva.texto.trim()?1:0.6}}>+ Guardar nota</button>
        </div>
      )}

      {cargando && <div style={{fontSize:"var(--fs-1)",color:"var(--texto-ter)",fontStyle:"italic"}}>Cargando...</div>}
      {!cargando && notas.length === 0 && <div style={{fontSize:"var(--fs-1)",color:"var(--texto-ter)",fontStyle:"italic",padding:"14px 0"}}>No hay notas aún.</div>}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {notas.map(n => (
          <div key={n.id} style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:8,padding:"11px 13px",borderLeft:n.visibilidad==="personal"?"3px solid var(--alerta)":"3px solid var(--primario)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
              <div style={{flex:1,minWidth:0}}>
                {n.titulo && <div style={{fontSize:"var(--fs-2)",fontWeight:600,color:"var(--texto)",marginBottom:3}}>{n.titulo}</div>}
                {editId===n.id ? (
                  <div>
                    <textarea value={editT} onChange={e=>setEditT(e.target.value)} rows={4} style={{width:"100%",fontSize:"var(--fs-2)",padding:"8px 10px",border:"0.5px solid var(--primario)",borderRadius:7,background:"var(--superficie)",color:"var(--texto)",boxSizing:"border-box",fontFamily:"inherit",lineHeight:1.4,resize:"vertical"}}/>
                    <div style={{display:"flex",gap:8,marginTop:6}}>
                      <button onClick={()=>guardarEdit(n)} style={{padding:"6px 14px",fontSize:"var(--fs-1)",fontWeight:600,background:"var(--primario)",color:"var(--texto-inv)",border:"none",borderRadius:6,cursor:"pointer"}}>Guardar</button>
                      <button onClick={()=>setEditId(null)} style={{padding:"6px 14px",fontSize:"var(--fs-1)",background:"var(--superficie)",color:"var(--texto-sec)",border:"0.5px solid var(--borde)",borderRadius:6,cursor:"pointer"}}>Cancelar</button>
                    </div>
                  </div>
                ) : (
                <div style={{fontSize:"var(--fs-1)",color:"var(--texto)",whiteSpace:"pre-wrap",lineHeight:1.45}}>{n.texto}</div>
                )}
                <div style={{fontSize:"var(--fs-xs)",color:"var(--texto-ter)",marginTop:5}}>
                  {n.visibilidad==="personal"?"🔒 Solo yo":"👥 Equipo"} · {n.autor?.nombre || "—"} · {new Date(n.created_at).toLocaleDateString("es-CL",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}
                </div>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
                <button onClick={()=>imprimirNotaPDF(n)} title="Imprimir / PDF" style={{background:"none",border:"none",color:"var(--primario)",cursor:"pointer",fontSize:"var(--fs-1)",padding:0}}>🖨️</button>
                {n.autor_id === currentUser.id && (<>
                  <button onClick={()=>abrirEdit(n)} title="Editar" style={{background:"none",border:"none",color:"var(--primario)",cursor:"pointer",fontSize:"var(--fs-1)",padding:0}}>✏️</button>
                  <button onClick={()=>eliminar(n)} style={{background:"none",border:"none",color:"var(--peligro)",cursor:"pointer",fontSize:"var(--fs-1)",padding:0}}>🗑</button>
                </>)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PendientesPanel({ pendientes, setPendientes, currentUser, contexto, equipos, loadingPendientes, setLoadingPendientes }) {
  const [nuevo, setNuevo] = useState({ texto: "", prioridad: "normal", fecha_objetivo: "" });
  const [filtroEstado, setFiltroEstado] = useState("pendiente");
  const [filtroPrioridad, setFiltroPrioridad] = useState("todas");
  const [miembrosEquipo, setMiembrosEquipo] = useState([]);

  const esEquipo = contexto !== "personal";
  const equipoActual = esEquipo ? equipos.find(e => e.id === contexto) : null;

  const cargar = async () => {
    setLoadingPendientes(true);
    const result = await listarPendientes(currentUser.id, contexto);
    setLoadingPendientes(false);
    if (result.ok) setPendientes(result.pendientes);
  };

  const cargarMiembros = async () => {
    if (esEquipo) {
      const result = await listarMiembros(contexto);
      if (result.ok) setMiembrosEquipo(result.miembros);
    }
  };

  useEffect(() => { cargar(); cargarMiembros(); }, [contexto]);

  const nombreMiembro = (id) => {
    const m = miembrosEquipo.find(x => x.perfiles?.id === id);
    return m?.perfiles?.nombre || null;
  };

  const toggleEncargadoPendiente = async (pendiente, userId) => {
    const actuales = Array.isArray(pendiente.encargados) ? pendiente.encargados : [];
    const agregando = !actuales.includes(userId);
    const nuevos = agregando ? [...actuales, userId] : actuales.filter(id => id !== userId);
    const result = await actualizarPendiente(pendiente.id, { encargados: nuevos });
    if (!result.ok) return alert("Error: " + result.error);
    setPendientes(prev => prev.map(x => x.id === pendiente.id ? result.pendiente : x));
    if (agregando && userId !== currentUser.id) {
      crearNotificacion(userId, `Te asignaron un pendiente: "${pendiente.texto.slice(0,80)}"${pendiente.fecha_objetivo ? ` (para el ${pendiente.fecha_objetivo})` : ""} — por ${currentUser.nombre}`, "pendiente");
    }
  };

  // Sugerencias rápidas
  const sugerencias = [
    "Revisar exámenes de laboratorio",
    "Llamar a familia",
    "Solicitar interconsulta",
    "Actualizar plan de manejo",
    "Coordinar alta",
    "Programar control",
  ];

  const filtrados = pendientes.filter(p => {
    if (filtroEstado !== "todos" && p.estado !== filtroEstado) return false;
    if (filtroPrioridad !== "todas" && p.prioridad !== filtroPrioridad) return false;
    return true;
  });

  // ============================================================
  // CRUD
  // ============================================================

  const guardar = async () => {
    if (!nuevo.texto.trim()) return alert("Escribe algo");
    const datos = {
      autor_id: currentUser.id,
      equipo_id: esEquipo ? contexto : null,
      texto: nuevo.texto.trim(),
      prioridad: nuevo.prioridad,
      fecha_objetivo: nuevo.fecha_objetivo || null,
    };
    const result = await crearPendiente(datos);
    if (!result.ok) return alert("Error: " + result.error);
    setPendientes(prev => [result.pendiente, ...prev]);
    setNuevo({ texto: "", prioridad: "normal", fecha_objetivo: "" });
  };

  const toggleCompletar = async (p) => {
    const nuevoEstado = p.estado === "completado" ? "pendiente" : "completado";
    const result = await actualizarPendiente(p.id, { estado: nuevoEstado });
    if (!result.ok) return alert("Error: " + result.error);
    setPendientes(prev => prev.map(x => x.id === p.id ? result.pendiente : x));
  };

  const eliminar = async (p) => {
    if (!confirm("¿Eliminar este pendiente?")) return;
    const result = await eliminarPendiente(p.id);
    if (!result.ok) return alert("Error: " + result.error);
    setPendientes(prev => prev.filter(x => x.id !== p.id));
  };

  const usarSugerencia = (texto) => {
    setNuevo({...nuevo, texto});
  };

  return (
    <div style={{padding:"16px",overflowY:"auto"}}>
      <div style={{fontSize:16,fontWeight:600,color:"var(--texto)",marginBottom:14}}>
        {esEquipo ? `📋 Pendientes - ${equipoActual?.nombre}` : "📋 Mis pendientes"}
      </div>

      {/* Form */}
      <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"12px",marginBottom:14}}>
        <textarea value={nuevo.texto} onChange={e=>setNuevo({...nuevo,texto:e.target.value})} placeholder="¿Qué hay que hacer?" rows={2} style={{...inputStyle,resize:"vertical",marginBottom:6}}/>
        
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:6}}>
          <select value={nuevo.prioridad} onChange={e=>setNuevo({...nuevo,prioridad:e.target.value})} style={{...inputStyle,marginBottom:0}}>
            <option value="alta">🔴 Alta</option>
            <option value="normal">🟡 Normal</option>
            <option value="baja">🟢 Baja</option>
          </select>
          <input type="date" value={nuevo.fecha_objetivo} onChange={e=>setNuevo({...nuevo,fecha_objetivo:e.target.value})} placeholder="Fecha objetivo" style={{...inputStyle,marginBottom:0}}/>
        </div>

        <button onClick={guardar} disabled={!nuevo.texto.trim()} style={{...btnPrimary, marginTop:0, opacity: nuevo.texto.trim() ? 1 : 0.6}}>+ Agregar pendiente</button>

        {/* Sugerencias */}
        <div style={{marginTop:10}}>
          <div style={{fontSize:"var(--fs-xs)",color:"var(--texto-ter)",marginBottom:4}}>Sugerencias rápidas:</div>
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            {sugerencias.map(s => (
              <button key={s} onClick={()=>usarSugerencia(s)} style={{padding:"3px 8px",fontSize:"var(--fs-xs)",background:"var(--fondo-suave)",border:"0.5px solid var(--borde)",color:"var(--texto-sec)",borderRadius:12,cursor:"pointer"}}>{s}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
        <span style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)"}}>Filtrar:</span>
        <select value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)} style={{padding:"5px 10px",fontSize:"var(--fs-0)",borderRadius:6,border:"0.5px solid var(--borde)",background:"var(--superficie)",color:"var(--texto)",cursor:"pointer"}}>
          <option value="pendiente">Pendientes</option>
          <option value="completado">Completados</option>
          <option value="todos">Todos</option>
        </select>
        <select value={filtroPrioridad} onChange={e=>setFiltroPrioridad(e.target.value)} style={{padding:"5px 10px",fontSize:"var(--fs-0)",borderRadius:6,border:"0.5px solid var(--borde)",background:"var(--superficie)",color:"var(--texto)",cursor:"pointer"}}>
          <option value="todas">Todas las prioridades</option>
          <option value="alta">🔴 Alta</option>
          <option value="normal">🟡 Normal</option>
          <option value="baja">🟢 Baja</option>
        </select>
        <span style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)",marginLeft:"auto"}}>{filtrados.length}</span>
      </div>

      {loadingPendientes && (
        <div style={{textAlign:"center",padding:"20px",color:"var(--texto-ter)",fontSize:"var(--fs-2)"}}>Cargando...</div>
      )}

      {!loadingPendientes && filtrados.length === 0 && (
        <div style={{textAlign:"center",padding:"40px 20px",color:"var(--texto-ter)",fontSize:"var(--fs-2)"}}>
          No hay pendientes en este filtro
        </div>
      )}

      {!loadingPendientes && filtrados.length > 0 && (
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {filtrados.map(p => {
            const colorPrioridad = p.prioridad === "alta" ? "var(--peligro)" : p.prioridad === "normal" ? "var(--alerta)" : "var(--exito)";
            const completado = p.estado === "completado";
            const esAutor = p.autor_id === currentUser.id;
            return (
              <div key={p.id} style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:8,padding:"10px 12px",borderLeft:`3px solid ${colorPrioridad}`,opacity:completado?0.6:1}}>
                <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
                  <input type="checkbox" checked={completado} onChange={()=>toggleCompletar(p)} style={{marginTop:2,cursor:"pointer"}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:"var(--fs-2)",color:"var(--texto)",textDecoration:completado?"line-through":"none",lineHeight:1.4,whiteSpace:"pre-wrap"}}>{p.texto}</div>
                    <div style={{fontSize:"var(--fs-xs)",color:"var(--texto-ter)",marginTop:4,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                      <span>{p.autor?.nombre || "Anónimo"}</span>
                      {p.fecha_objetivo && <span>📅 {p.fecha_objetivo}</span>}
                      <span style={{color:colorPrioridad,fontWeight:500}}>● {p.prioridad}</span>
                    </div>
                    {esEquipo && (
                      <EncargadosPendiente pendiente={p} miembros={miembrosEquipo} onToggle={toggleEncargadoPendiente} nombreMiembro={nombreMiembro} />
                    )}
                  </div>
                  {esAutor && (
                    <button onClick={()=>eliminar(p)} style={{background:"none",border:"none",color:"var(--peligro)",cursor:"pointer",fontSize:"var(--fs-2)",padding:0}}>🗑</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConfiguracionServiciosModal({ onConfigurar, currentUser }) {
  const [seleccionados, setSeleccionados] = useState(["Urología", "1er piso"]);
  const [personalizado, setPersonalizado] = useState("");
  const [todos, setTodos] = useState(SERVICIOS_SUGERIDOS);

  const toggle = (s) => {
    setSeleccionados(seleccionados.includes(s) ? seleccionados.filter(x => x !== s) : [...seleccionados, s]);
  };

  const agregarPersonalizado = () => {
    const p = personalizado.trim();
    if (!p) return;
    if (!todos.includes(p)) setTodos([...todos, p]);
    if (!seleccionados.includes(p)) setSeleccionados([...seleccionados, p]);
    setPersonalizado("");
  };

  const guardar = () => {
    if (seleccionados.length === 0) return;
    onConfigurar(seleccionados);
  };

  return (
    <div style={{padding:"24px 20px",overflowY:"auto"}}>
      <div style={{fontSize:18,fontWeight:600,color:"var(--texto)",marginBottom:6}}>Configura tus servicios</div>
      <div style={{fontSize:"var(--fs-1)",color:"var(--texto-sec)",marginBottom:16,lineHeight:1.5}}>Antes de empezar, dime qué servicios o pisos del hospital quieres tener disponibles para asignar a tus pacientes. Puedes modificar esto después.</div>

      <div style={{fontSize:"var(--fs-1)",fontWeight:500,color:"var(--texto-sec)",marginBottom:8}}>Sugerencias (toca para seleccionar):</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:18}}>
        {todos.map(s => {
          const sel = seleccionados.includes(s);
          return (
            <button key={s} onClick={()=>toggle(s)} style={{padding:"6px 12px",fontSize:"var(--fs-1)",fontWeight:sel?500:400,borderRadius:14,cursor:"pointer",border:sel?"none":"0.5px solid var(--borde)",background:sel?"var(--primario)":"var(--superficie)",color:sel?"var(--texto-inv)":"var(--texto-sec)"}}>
              {sel ? "✓ " : ""}{s}
            </button>
          );
        })}
      </div>

      <div style={{fontSize:"var(--fs-1)",fontWeight:500,color:"var(--texto-sec)",marginBottom:6}}>O agrega uno personalizado:</div>
      <div style={{display:"flex",gap:6,marginBottom:18}}>
        <input value={personalizado} onChange={e=>setPersonalizado(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")agregarPersonalizado();}} placeholder="Ej: Pediatría, 4to piso ala B..." style={{flex:1,padding:"9px 12px",fontSize:"var(--fs-2)",borderRadius:8,border:"0.5px solid var(--borde)",outline:"none"}}/>
        <button onClick={agregarPersonalizado} disabled={!personalizado.trim()} style={{padding:"9px 14px",fontSize:"var(--fs-2)",fontWeight:500,background:personalizado.trim()?"var(--primario)":"var(--borde)",color:"var(--texto-inv)",border:"none",borderRadius:8,cursor:personalizado.trim()?"pointer":"default"}}>+ Agregar</button>
      </div>

      <div style={{padding:"10px 12px",background:"var(--fondo-suave)",borderRadius:8,marginBottom:16,fontSize:"var(--fs-1)",color:"var(--primario-osc)",lineHeight:1.5}}>
        <strong>{seleccionados.length}</strong> servicio{seleccionados.length === 1 ? "" : "s"} seleccionado{seleccionados.length === 1 ? "" : "s"}{seleccionados.length > 0 ? `: ${seleccionados.join(", ")}` : ""}
      </div>

      <button onClick={guardar} disabled={seleccionados.length === 0} style={{...btnPrimary, marginTop:0, opacity: seleccionados.length === 0 ? 0.5 : 1}}>Empezar a usar UroSearch</button>
    </div>
  );
}

function TablaQuirurgicaPanel({ tablaCirugias, setTablaCirugias, currentUser, contexto, equipos, loadingCirugias, setLoadingCirugias, setPacientes, toolsOpen, soloLectura }) {
  const [vista, setVista] = useState("tabla");
  const [seleccionado, setSeleccionado] = useState(null);
  useBackClose(vista !== "tabla", () => { setVista("tabla"); setSeleccionado(null); });
  const [error, setError] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [modoVista, setModoVista] = useState("planner"); // "mensual" | "planner" (semanal) | "lista"
  const [vistaMenuOpen, setVistaMenuOpen] = useState(false); // submenú del botón "Vista ▾"
  const [mesActual, setMesActual] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; }); // primer día del mes (vista mensual)
  const inputFotoTablaRef = useRef(null);
  const [extrayendoTabla, setExtrayendoTabla] = useState(false);
  const [lunesSemana, setLunesSemana] = useState(() => {
    const d = new Date();
    const dow = (d.getDay() + 6) % 7; // 0 = lunes
    d.setDate(d.getDate() - dow);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const [nuevo, setNuevo] = useState({
    fecha: new Date().toISOString().slice(0,10), hora: "08:00",
    iniciales: "", ficha_clinica: "", rut: "", edad: "", procedimiento: "", lateralidad: "",
    cirujano: currentUser.nombre, primer_ayudante: "", pabellon: "5", estado: "programada", observaciones: ""
  });
  const [editId, setEditId] = useState(null); // id de la cirugía en edición (null = crear)
  const [miembrosEquipo, setMiembrosEquipo] = useState([]);

  const esEquipo = contexto !== "personal";
  const equipoActual = esEquipo ? equipos.find(e => e.id === contexto) : null;

  const cargar = async () => {
    setLoadingCirugias(true);
    const result = await listarCirugias(currentUser.id, contexto);
    setLoadingCirugias(false);
    if (result.ok) setTablaCirugias(result.cirugias);
  };

  const cargarMiembros = async () => {
    if (esEquipo) {
      const result = await listarMiembros(contexto);
      if (result.ok) setMiembrosEquipo(result.miembros);
    } else {
      setMiembrosEquipo([]);
    }
  };

  useEffect(() => { cargar(); cargarMiembros(); }, [contexto]);

  // ====================================================================
  // SEMANA MOSTRADA (planner)
  // ====================================================================
  const lunesDe = (fecha) => {
    const d = new Date(fecha);
    const dow = (d.getDay() + 6) % 7; // 0 = lunes
    d.setDate(d.getDate() - dow);
    d.setHours(0, 0, 0, 0);
    return d;
  };
  const hoyISO = new Date().toISOString().slice(0, 10);

  const finSemana = new Date(lunesSemana);
  finSemana.setDate(finSemana.getDate() + 6);
  finSemana.setHours(23, 59, 59, 999);

  // Días de la semana (lunes a domingo) en formato ISO
  const diasSemana = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lunesSemana);
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });

  const cirugiasSemana = tablaCirugias.filter(c => {
    if (filtroEstado !== "todos" && c.estado !== filtroEstado) return false;
    const f = new Date(c.fecha + "T00:00:00");
    return f >= lunesSemana && f <= finSemana;
  });

  // Agrupar por fecha
  const porFecha = {};
  cirugiasSemana.forEach(c => {
    if (!porFecha[c.fecha]) porFecha[c.fecha] = [];
    porFecha[c.fecha].push(c);
  });

  // Lunes a viernes siempre; sábado (índice 5) y domingo (6) solo si tienen cirugías
  const diasVisibles = diasSemana.filter((fecha, i) => i < 5 || (porFecha[fecha] && porFecha[fecha].length > 0));

  // ====================================================================
  // MES MOSTRADO (vista mensual)
  // ====================================================================
  const mesISO = `${mesActual.getFullYear()}-${String(mesActual.getMonth() + 1).padStart(2, "0")}`;
  const cirugiasMes = tablaCirugias.filter(c => {
    if (filtroEstado !== "todos" && c.estado !== filtroEstado) return false;
    return (c.fecha || "").startsWith(mesISO);
  });
  const porFechaMes = {};
  cirugiasMes.forEach(c => { (porFechaMes[c.fecha] = porFechaMes[c.fecha] || []).push(c); });
  // Celdas del calendario: relleno inicial según día de semana del día 1 (lunes = 0)
  const primerDow = (mesActual.getDay() + 6) % 7;
  const diasEnMes = new Date(mesActual.getFullYear(), mesActual.getMonth() + 1, 0).getDate();
  const celdasMes = [
    ...Array.from({ length: primerDow }, () => null),
    ...Array.from({ length: diasEnMes }, (_, i) => `${mesISO}-${String(i + 1).padStart(2, "0")}`),
  ];

  const coloresEstado = {
    programada: "var(--primario)", en_curso: "var(--alerta)", completada: "var(--exito)",
    suspendida: "var(--neutro)", cancelada: "var(--peligro)"
  };
  // Relleno claro del recuadro completo según estado
  const fondoEstado = {
    programada: "var(--est-prog-bg)", en_curso: "var(--alerta-bg)", completada: "var(--exito-bg)",
    suspendida: "var(--neutro-bg)", cancelada: "var(--peligro-bg)"
  };
  // Texto que se muestra dentro del recuadro
  const textoEstado = {
    programada: "Programada", en_curso: "En curso", completada: "Completada",
    suspendida: "Suspendida", cancelada: "Cancelada"
  };
  // Separa cirugías de un día en pabellones de hospital y CCV (Costanera)
  const separarHospitalCCV = (lista) => {
    const orden = (a,b) => (a.hora||"").localeCompare(b.hora||"");
    return {
      hospital: lista.filter(c => c.pabellon !== "CCV").slice().sort(orden),
      ccv: lista.filter(c => c.pabellon === "CCV").slice().sort(orden),
    };
  };
  const navBtn = { width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "var(--fs-3)", background:"var(--superficie)", color: "var(--primario)", border: "0.5px solid var(--borde)", borderRadius: 6, cursor: "pointer", fontWeight: 600 };

  // ============================================================
  // CRUD
  // ============================================================

  const guardar = async () => {
    setError("");
    if (!nuevo.iniciales.trim()) return setError("Ingresa el nombre o las iniciales");
    if (!nuevo.procedimiento.trim()) return setError("Ingresa el procedimiento");

    const datos = {
      cirujano_id: currentUser.id,
      equipo_id: esEquipo ? contexto : null,
      fecha: nuevo.fecha,
      hora: nuevo.hora,
      iniciales: nuevo.iniciales.trim().toUpperCase(),
      ficha_clinica: nuevo.ficha_clinica.trim() || null,
      rut: nuevo.rut.trim() || null,
      edad: nuevo.edad ? parseInt(nuevo.edad) : null,
      procedimiento: nuevo.procedimiento.trim(),
      lateralidad: nuevo.lateralidad || null,
      cirujano: nuevo.cirujano.trim() || null,
      primer_ayudante: nuevo.primer_ayudante.trim() || null,
      pabellon: nuevo.pabellon.trim() || null,
      estado: nuevo.estado,
      observaciones: nuevo.observaciones.trim() || null,
    };

    const result = await crearCirugia(datos);
    if (!result.ok) return setError(result.error);

    setTablaCirugias(prev => [...prev, result.cirugia].sort((a,b) => (a.fecha+a.hora).localeCompare(b.fecha+b.hora)));
    resetForm();
    setVista("tabla");
  };

  const resetForm = () => {
    setEditId(null);
    setNuevo({ fecha: new Date().toISOString().slice(0,10), hora: "08:00", iniciales: "", ficha_clinica: "", rut: "", edad: "", procedimiento: "", lateralidad: "", cirujano: currentUser.nombre, primer_ayudante: "", pabellon: "5", estado: "programada", observaciones: "" });
  };

  // Cargar una cirugía existente en el formulario para editarla
  const empezarEdicion = (c) => {
    setEditId(c.id);
    setNuevo({
      fecha: c.fecha || new Date().toISOString().slice(0,10),
      hora: (c.hora || "08:00").slice(0,5),
      iniciales: c.iniciales || "",
      ficha_clinica: c.ficha_clinica || "",
      rut: c.rut || "",
      edad: c.edad != null ? String(c.edad) : "",
      procedimiento: c.procedimiento || "",
      lateralidad: c.lateralidad || "",
      cirujano: c.cirujano || "",
      primer_ayudante: c.primer_ayudante || "",
      pabellon: c.pabellon || "5",
      estado: c.estado || "programada",
      observaciones: c.observaciones || "",
    });
    setError("");
    setVista("nuevo");
  };

  // Guardar cambios de una cirugía existente
  const guardarEdicion = async () => {
    setError("");
    if (!nuevo.iniciales.trim()) return setError("Ingresa el nombre o las iniciales");
    if (!nuevo.procedimiento.trim()) return setError("Ingresa el procedimiento");

    const cambios = {
      fecha: nuevo.fecha,
      hora: nuevo.hora,
      iniciales: nuevo.iniciales.trim().toUpperCase(),
      ficha_clinica: nuevo.ficha_clinica.trim() || null,
      rut: nuevo.rut.trim() || null,
      edad: nuevo.edad ? parseInt(nuevo.edad) : null,
      procedimiento: nuevo.procedimiento.trim(),
      lateralidad: nuevo.lateralidad || null,
      cirujano: nuevo.cirujano.trim() || null,
      primer_ayudante: nuevo.primer_ayudante.trim() || null,
      pabellon: nuevo.pabellon.trim() || null,
      estado: nuevo.estado,
      observaciones: nuevo.observaciones.trim() || null,
    };

    const result = await actualizarCirugia(editId, cambios);
    if (!result.ok) return setError(result.error);

    setTablaCirugias(prev => prev.map(c => c.id === editId ? result.cirugia : c).sort((a,b) => (a.fecha+a.hora).localeCompare(b.fecha+b.hora)));
    setSeleccionado(result.cirugia);
    resetForm();
    setVista("tabla");
  };

  const cambiarEstado = async (cirugia, nuevoEstado) => {
    const result = await actualizarCirugia(cirugia.id, { estado: nuevoEstado });
    if (!result.ok) return alert("Error: " + result.error);
    setTablaCirugias(prev => prev.map(c => c.id === cirugia.id ? result.cirugia : c));
    if (seleccionado?.id === cirugia.id) setSeleccionado(result.cirugia);

    // Al completar una cirugía → crear automáticamente el paciente hospitalizado.
    // Solo en la transición REAL a "completada": si ya estaba completada y se
    // vuelve a pulsar "completar", no se recrea el paciente (evita duplicados).
    if (nuevoEstado === "completada" && cirugia.estado !== "completada") {
      // Avisar al equipo
      if (esEquipo) {
        try {
          const rm = await listarMiembros(contexto);
          if (rm.ok) rm.miembros.forEach(m => {
            const uid = m.perfiles?.id;
            if (uid && uid !== currentUser.id) crearNotificacion(uid, `Cirugía completada: ${cirugia.procedimiento} — ${cirugia.iniciales} (${cirugia.fecha}) — por ${currentUser.nombre}`, "cirugia");
          });
        } catch {}
      }
      if (!confirm(`¿Crear a ${cirugia.iniciales} como paciente hospitalizado en la pestaña Pacientes?`)) return;
      const datosPaciente = {
        medico_id: currentUser.id,
        equipo_id: esEquipo ? contexto : null,
        iniciales: (cirugia.iniciales || "").toUpperCase(),
        edad: cirugia.edad || null,
        sexo: "M", // editable después en la ficha
        cama: "",
        servicio: "Urología",
        diagnostico: `Post-operado: ${cirugia.procedimiento}${cirugia.lateralidad ? ` (${cirugia.lateralidad})` : ""}`,
        plan_manejo: null,
        fecha_ingreso: cirugia.fecha || new Date().toISOString().slice(0, 10),
        estado: "activo",
        operado: true,
        cirugias_realizadas: [{ fecha: cirugia.fecha || new Date().toISOString().slice(0, 10), nombre: cirugia.procedimiento }],
      };
      const rp = await crearPaciente(datosPaciente);
      if (!rp.ok) return alert("Cirugía completada, pero no se pudo crear el paciente: " + rp.error);
      if (setPacientes) setPacientes(prev => [rp.paciente, ...prev]);
      alert(`✓ ${cirugia.iniciales} creado como paciente hospitalizado. Edítalo en Pacientes para asignar cama y encargados.`);
    }
  };

  const asignarPrimerAyudante = async (cirugia, nombre) => {
    const result = await actualizarCirugia(cirugia.id, { primer_ayudante: nombre || null });
    if (!result.ok) return alert("Error: " + result.error);
    setTablaCirugias(prev => prev.map(c => c.id === cirugia.id ? result.cirugia : c));
    if (seleccionado?.id === cirugia.id) setSeleccionado(result.cirugia);
    // Notificar al asignado (si es otro miembro)
    if (nombre) {
      const miembro = miembrosEquipo.find(m => m.perfiles?.nombre === nombre);
      const uid = miembro?.perfiles?.id;
      if (uid && uid !== currentUser.id) {
        crearNotificacion(uid, `Te asignaron como primer ayudante: ${cirugia.procedimiento} — ${cirugia.iniciales} (${cirugia.fecha} ${cirugia.hora?.slice(0,5)}) — por ${currentUser.nombre}`, "cirugia");
      }
    }
  };

  const eliminar = async (cirugia) => {
    if (!confirm(`¿Eliminar cirugía de ${cirugia.iniciales}?`)) return;
    const result = await eliminarCirugia(cirugia.id);
    if (!result.ok) return alert("Error: " + result.error);
    setTablaCirugias(prev => prev.filter(c => c.id !== cirugia.id));
    setSeleccionado(null);
    setVista("tabla");
  };

  // ============================================================
  // IMPORTAR EXCEL
  // ============================================================

  const onFotoTabla = async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 3);
    e.target.value = "";
    if (!files.length) return;
    setExtrayendoTabla(true);
    try {
      const b64s = [];
      for (const f of files) b64s.push(await comprimirImagenPac(f));
      const cxs = await extraerTablaCirugias(b64s);
      const esEquipoCtx = contexto !== "personal";
      const filas = cxs
        .filter(c => c && (c.procedimiento || c.diagnostico || c.nombre))
        .map(c => ({
          cirujano_id: currentUser.id,
          equipo_id: esEquipoCtx ? contexto : null,
          fecha: (c.fecha && /^\d{4}-\d{2}-\d{2}$/.test(c.fecha)) ? c.fecha : new Date().toISOString().slice(0, 10),
          hora: (c.hora && /^\d{1,2}:\d{2}/.test(c.hora)) ? c.hora.slice(0, 5) : "08:00",
          iniciales: (c.nombre || "").slice(0, 100),
          ficha_clinica: c.ficha_clinica ? String(c.ficha_clinica).slice(0, 30) : null,
          rut: c.rut ? String(c.rut).slice(0, 15) : null,
          edad: c.edad ? parseInt(c.edad) : null,
          procedimiento: (c.procedimiento || c.diagnostico || "Cirugía").slice(0, 200),
          lateralidad: ["Derecha", "Izquierda", "Bilateral"].includes(c.lateralidad) ? c.lateralidad : null,
          cirujano: c.cirujano ? String(c.cirujano).slice(0, 100) : null,
          pabellon: c.pabellon ? String(c.pabellon).slice(0, 20) : "5",
          estado: "programada",
          observaciones: c.diagnostico ? ("Dg: " + c.diagnostico).slice(0, 500) : null,
        }));
      if (filas.length === 0) { alert("No se pudo extraer ninguna cirugía de la foto. Intenta con mejor luz o encuadre."); return; }
      // Evita duplicar si se re-sube la misma tabla: descarta las que ya existen
      // (misma fecha + nombre + procedimiento, ignorando tildes y mayúsculas).
      const _norm = (s) => (s || "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
      const _clave = (c) => `${c.fecha}|${_norm(c.iniciales)}|${_norm(c.procedimiento)}`;
      const _existentes = new Set(tablaCirugias.map(_clave));
      const nuevas = filas.filter(f => !_existentes.has(_clave(f)));
      const dup = filas.length - nuevas.length;
      if (nuevas.length === 0) { alert(`Las ${filas.length} cirugías detectadas ya estaban en la tabla. No se importó ninguna (se evitaron duplicados).`); return; }
      const msgConf = dup > 0
        ? `Se detectaron ${filas.length} cirugías (${dup} ya existían y se omitirán). ¿Importar las ${nuevas.length} nuevas?`
        : `Se detectaron ${nuevas.length} cirugías en la foto. ¿Importarlas?`;
      if (!window.confirm(msgConf)) return;
      const result = await crearCirugiasBulk(nuevas);
      if (!result.ok) { alert("Error al importar: " + result.error); return; }
      setTablaCirugias(prev => [...prev, ...result.cirugias].sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora)));
      alert(`✓ ${result.cirugias.length} cirugías importadas${dup > 0 ? ` · ${dup} omitidas por duplicado` : ""}`);
    } catch (err) {
      alert("No se pudo leer la foto de la tabla: " + (err?.message || err));
    } finally {
      setExtrayendoTabla(false);
    }
  };

  const importarExcel = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const XLSX = await import('xlsx');
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      
      // Leer como matriz de filas (sin asumir headers)
      const matriz = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
      
      if (matriz.length === 0) {
        alert("El archivo está vacío");
        return;
      }

      // ====================================================================
      // BUSCAR FILA DE ENCABEZADOS
      // ====================================================================
      // Buscar la fila que contenga "FECHA" en la columna A o "DIAGNOSTICO"
      let filaHeaders = -1;
      let mapaColumnas = {};
      
      for (let i = 0; i < Math.min(matriz.length, 15); i++) {
        const fila = matriz[i].map(c => String(c || "").toUpperCase().trim());
        const idxFecha = fila.findIndex(c => c === "FECHA");
        const idxDiagnostico = fila.findIndex(c => c.includes("DIAGNOSTICO") || c.includes("DIAGNÓSTICO"));
        
        if (idxFecha !== -1 && idxDiagnostico !== -1) {
          filaHeaders = i;
          // Mapear cada columna a su índice
          fila.forEach((nombre, idx) => {
            const limpio = nombre.replace(/[^A-Z]/g, "");
            if (limpio === "FECHA") mapaColumnas.fecha = idx;
            if (limpio === "HORARIO" || limpio === "HORA") mapaColumnas.horario = idx;
            if (limpio === "NOMBRE" || limpio === "PACIENTE" || limpio === "NOMBRES") mapaColumnas.nombre = idx;
            if (limpio === "EDAD") mapaColumnas.edad = idx;
            if (limpio === "DIAGNOSTICO" || nombre.includes("DIAGN")) mapaColumnas.diagnostico = idx;
            if (limpio === "CIRUGIA" || nombre.includes("CIRUG")) mapaColumnas.cirugia = idx;
            if (limpio === "ABORDAJE") mapaColumnas.abordaje = idx;
            if (limpio === "LADO" || limpio === "LATERALIDAD") mapaColumnas.lado = idx;
            if (limpio === "TOP" || limpio === "DURACION" || nombre.includes("DURAC")) mapaColumnas.duracion = idx;
            if (limpio === "OBSESPECIALES" || limpio === "OBSERVACIONES" || nombre.includes("OBS")) mapaColumnas.obs = idx;
            if (limpio === "CIRUJANO" || limpio === "MEDICO" || nombre.includes("MÉDIC")) mapaColumnas.cirujano = idx;
          });
          break;
        }
      }

      if (filaHeaders === -1) {
        alert("No se encontraron encabezados válidos. El Excel debe tener una fila con FECHA y DIAGNOSTICO.");
        return;
      }

      // ====================================================================
      // DETECTAR MES Y AÑO (desde el título de la semana, ej: "...DE JULIO" + "2026")
      // ====================================================================
      const MESES = { ENERO:"01", FEBRERO:"02", MARZO:"03", ABRIL:"04", MAYO:"05", JUNIO:"06", JULIO:"07", AGOSTO:"08", SEPTIEMBRE:"09", SETIEMBRE:"09", OCTUBRE:"10", NOVIEMBRE:"11", DICIEMBRE:"12" };
      let mesDetectado = null, anioDetectado = null;
      for (let i = 0; i < Math.min(matriz.length, 12); i++) {
        const texto = matriz[i].map(c => String(c || "").toUpperCase()).join(" ");
        if (!mesDetectado) {
          for (const [nombreMes, num] of Object.entries(MESES)) {
            if (texto.includes(nombreMes)) { mesDetectado = num; break; }
          }
        }
        if (!anioDetectado) {
          const mAnio = texto.match(/\b(20\d{2})\b/);
          if (mAnio) anioDetectado = mAnio[1];
        }
      }
      const ahoraFallback = new Date();
      const mesFinal = mesDetectado || String(ahoraFallback.getMonth() + 1).padStart(2, "0");
      const anioFinal = anioDetectado || String(ahoraFallback.getFullYear());

      // ====================================================================
      // PROCESAR FILAS DE DATOS (soporta 2 tablas: HBV principal + CCV lunes)
      // ====================================================================
      const filas = [];
      let fechaActual = null;
      let fechaLunes = null;     // fecha del lunes de la semana (para la tabla CCV)
      let horarioActual = "AM";  // AM o PM
      let modoCCV = false;       // true al entrar a "PABELLON / UROLOGIA - CCV"

      const normalizarAbordaje = (raw) => {
        const a = String(raw || "").toUpperCase().trim();
        if (!a) return "";
        if (a.startsWith("ABIER")) return "Abierto";
        if (a === "LAP" || a.includes("LAPAR")) return "Laparoscópico";
        if (a === "END" || a.includes("ENDO")) return "Endoscópico";
        if (a.includes("ROB")) return "Robótico";
        return String(raw).trim();
      };

      for (let i = filaHeaders + 1; i < matriz.length; i++) {
        const fila = matriz[i];
        if (!fila || fila.every(c => !c || String(c).trim() === "")) continue;

        // ¿Empieza la tabla CCV? (cualquier celda menciona "CCV")
        const filaTextoUpper = fila.map(c => String(c || "").toUpperCase()).join(" ");
        if (filaTextoUpper.includes("CCV")) {
          modoCCV = true;
          fechaActual = fechaLunes; // la tabla CCV es siempre el lunes de la semana
          continue;
        }

        // Detectar fila de día (ej: "LUNES 06" en columna A).
        // OJO: en esta planilla la etiqueta del día va en la MISMA fila que el
        // primer paciente de ese día, así que NO se hace 'continue': se fija la
        // fecha y se sigue procesando la fila como paciente.
        const colA = String(fila[0] || "").toUpperCase().trim();
        const matchDia = colA.match(/(LUNES|MARTES|MIERCOLES|MIÉRCOLES|JUEVES|VIERNES|SABADO|SÁBADO|DOMINGO)\s*(\d{1,2})/);
        if (matchDia) {
          const diaNum = matchDia[2].padStart(2, "0");
          fechaActual = `${anioFinal}-${mesFinal}-${diaNum}`;
          if (matchDia[1].startsWith("LUNES") && !fechaLunes) fechaLunes = fechaActual;
        }

        // Detectar horario (AM/PM/PC en col B)
        const colB = String(fila[1] || "").toUpperCase().trim();
        if (colB === "AM" || colB === "PM" || colB === "PC") horarioActual = colB;

        if (!fechaActual) continue;

        // Extraer datos de la fila
        const nombreCompleto = String(fila[mapaColumnas.nombre] || "").trim();
        const diagnostico = String(fila[mapaColumnas.diagnostico] || "").trim();
        const cirugia = String(fila[mapaColumnas.cirugia] || "").trim();

        // Solo importar si hay diagnóstico Y cirugía (salta filas "CORR:", vacías, etc.)
        if (!diagnostico || !cirugia) continue;
        if (nombreCompleto === "" || nombreCompleto.toUpperCase().startsWith("CORR")) continue;
        if (["NOMBRE","NOMBRES","PACIENTE"].includes(nombreCompleto.toUpperCase())) continue;

        // Nombre COMPLETO (ya no se convierte a iniciales)
        const nombrePaciente = nombreCompleto.replace(/\s+/g, " ").slice(0, 120);

        // Edad
        const edadStr = String(fila[mapaColumnas.edad] || "").trim();
        const edad = edadStr && !isNaN(parseInt(edadStr)) ? parseInt(edadStr) : null;

        // Lateralidad (LADO: "D°", "I°", "BIL")
        const ladoRaw = String(fila[mapaColumnas.lado] || "").trim().toUpperCase();
        let lateralidad = null;
        if (ladoRaw.includes("BIL")) lateralidad = "Bilateral";
        else if (ladoRaw.includes("D")) lateralidad = "Derecha";
        else if (ladoRaw.includes("I")) lateralidad = "Izquierda";

        // Abordaje (ABIERTO / LAP / END)
        const abordaje = mapaColumnas.abordaje != null ? normalizarAbordaje(fila[mapaColumnas.abordaje]) : "";

        // Duración (columna TOP, ej "120 MIN")
        const duracion = mapaColumnas.duracion != null ? String(fila[mapaColumnas.duracion] || "").trim() : "";

        // Obs especiales
        const obsEspeciales = mapaColumnas.obs != null ? String(fila[mapaColumnas.obs] || "").trim() : "";

        // Cirujano: en CCV la columna se corre; si viene vacío, buscar "DR" en la fila
        let cirujano = String(fila[mapaColumnas.cirujano] || "").trim();
        if (!cirujano) {
          const celdaDr = fila.map(c => String(c || "").trim()).find(c => /^DR/i.test(c));
          if (celdaDr) cirujano = celdaDr;
        }

        // Construir observaciones combinando abordaje, duración, diagnóstico y obs especiales
        const partesObs = [];
        if (modoCCV) partesObs.push("🏥 CCV (Clínica Costanera)");
        if (abordaje) partesObs.push(`Abordaje: ${abordaje}`);
        if (duracion) partesObs.push(`Duración: ${duracion}`);
        if (diagnostico) partesObs.push(`Dg: ${diagnostico}`);
        if (obsEspeciales) partesObs.push(`Obs: ${obsEspeciales}`);
        const observaciones = partesObs.join(" | ").slice(0, 500);

        const hora = horarioActual === "AM" ? "08:00" : "14:00";

        filas.push({
          cirujano_id: currentUser.id,
          equipo_id: esEquipo ? contexto : null,
          fecha: fechaActual,
          hora: hora,
          iniciales: nombrePaciente,        // ahora guarda el NOMBRE COMPLETO
          edad: edad,
          procedimiento: cirugia.slice(0, 200),
          lateralidad: lateralidad,
          cirujano: cirujano ? cirujano.slice(0, 100) : null,
          pabellon: modoCCV ? "CCV" : "5",
          estado: 'programada',
          observaciones: observaciones || `Dg: ${diagnostico}`,
        });
      }

      if (filas.length === 0) {
        alert("No se pudo extraer ninguna cirugía válida del Excel.");
        return;
      }

      // Confirmar antes de insertar
      const nCCV = filas.filter(f => f.pabellon === "CCV").length;
      const resumenCCV = nCCV > 0 ? ` (${nCCV} de ellas en CCV, lunes)` : "";
      // Evita duplicar si se re-importa el mismo Excel (misma fecha + nombre + procedimiento).
      const _normX = (s) => (s || "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
      const _claveX = (c) => `${c.fecha}|${_normX(c.iniciales)}|${_normX(c.procedimiento)}`;
      const _existX = new Set(tablaCirugias.map(_claveX));
      const nuevasX = filas.filter(f => !_existX.has(_claveX(f)));
      const dupX = filas.length - nuevasX.length;
      if (nuevasX.length === 0) { alert(`Las ${filas.length} cirugías del Excel ya estaban en la tabla. No se importó ninguna (se evitaron duplicados).`); e.target.value = ""; return; }
      if (!confirm(`Se importarán ${nuevasX.length} cirugías${dupX > 0 ? ` (${dupX} ya existían y se omiten)` : ""}${resumenCCV}. ¿Continuar?`)) {
        e.target.value = "";
        return;
      }

      const result = await crearCirugiasBulk(nuevasX);
      if (!result.ok) {
        alert("Error al importar: " + result.error);
        return;
      }

      setTablaCirugias(prev => [...prev, ...result.cirugias].sort((a,b) => (a.fecha+a.hora).localeCompare(b.fecha+b.hora)));
      alert(`✓ ${result.cirugias.length} cirugías importadas${dupX > 0 ? ` · ${dupX} omitidas por duplicado` : ""}`);
      e.target.value = "";
    };
    reader.readAsArrayBuffer(file);
  } catch (err) {
    alert("Error al leer Excel: " + err.message);
    console.error(err);
  }
};

  // ============================================================
  // RENDER: NUEVO
  // ============================================================

  if (vista === "nuevo") {
    return (
      <div style={{padding:"20px",overflowY:"auto"}}>
        <button onClick={()=>{resetForm();setVista(editId?"detalle":"tabla");}} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:"var(--fs-2)",cursor:"pointer",marginBottom:12,padding:0}}>← Volver</button>
        <div style={{fontSize:16,fontWeight:600,color:"var(--texto)",marginBottom:14}}>{editId ? "Editar cirugía" : "Nueva cirugía"} {esEquipo && !editId && `en equipo "${equipoActual?.nombre}"`}</div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <div>
            <label style={labelStyle}>Fecha</label>
            <input type="date" value={nuevo.fecha} onChange={e=>setNuevo({...nuevo,fecha:e.target.value})} style={inputStyle}/>
          </div>
          <div>
            <label style={labelStyle}>Hora</label>
            <input type="time" value={nuevo.hora} onChange={e=>setNuevo({...nuevo,hora:e.target.value})} style={inputStyle}/>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <div>
            <label style={labelStyle}>Nombre o iniciales</label>
            <input value={nuevo.iniciales} onChange={e=>setNuevo({...nuevo,iniciales:e.target.value.slice(0,100)})} placeholder="Juan Pérez Mora o JPM" style={inputStyle} maxLength={100}/>
          </div>
          <div>
            <label style={labelStyle}>Edad</label>
            <input type="number" value={nuevo.edad} onChange={e=>setNuevo({...nuevo,edad:e.target.value})} placeholder="65" style={inputStyle}/>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <div>
            <label style={labelStyle}>Ficha clínica (FC)</label>
            <input value={nuevo.ficha_clinica} onChange={e=>setNuevo({...nuevo,ficha_clinica:e.target.value.slice(0,30)})} placeholder="123456" style={inputStyle}/>
          </div>
          <div>
            <label style={labelStyle}>RUT</label>
            <input value={nuevo.rut} onChange={e=>setNuevo({...nuevo,rut:e.target.value.slice(0,15)})} placeholder="12.345.678-9" style={inputStyle}/>
          </div>
        </div>

        <label style={labelStyle}>Procedimiento</label>
        <input value={nuevo.procedimiento} onChange={e=>setNuevo({...nuevo,procedimiento:e.target.value})} placeholder="RTU-V, Nefrectomía..." style={inputStyle}/>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <div>
            <label style={labelStyle}>Lateralidad</label>
            <select value={nuevo.lateralidad} onChange={e=>setNuevo({...nuevo,lateralidad:e.target.value})} style={inputStyle}>
              <option value="">N/A</option>
              <option value="Derecha">Derecha</option>
              <option value="Izquierda">Izquierda</option>
              <option value="Bilateral">Bilateral</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Pabellón</label>
            <input value={nuevo.pabellon} onChange={e=>setNuevo({...nuevo,pabellon:e.target.value})} placeholder="5" style={inputStyle}/>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <div>
            <label style={labelStyle}>Cirujano principal</label>
            <input value={nuevo.cirujano} onChange={e=>setNuevo({...nuevo,cirujano:e.target.value})} style={inputStyle}/>
          </div>
          <div>
            <label style={labelStyle}>Primer ayudante (opcional)</label>
            {esEquipo && miembrosEquipo.length > 0 ? (
              <select value={nuevo.primer_ayudante} onChange={e=>setNuevo({...nuevo,primer_ayudante:e.target.value})} style={inputStyle}>
                <option value="">— Sin primer ayudante —</option>
                {miembrosEquipo.map(m => {
                  const nombre = m.perfiles?.nombre;
                  return nombre ? <option key={m.perfiles?.id} value={nombre}>{nombre}</option> : null;
                })}
              </select>
            ) : (
              <input value={nuevo.primer_ayudante} onChange={e=>setNuevo({...nuevo,primer_ayudante:e.target.value})} placeholder="Nombre del ayudante" style={inputStyle}/>
            )}
          </div>
        </div>

        <label style={labelStyle}>Observaciones (opcional)</label>
        <textarea value={nuevo.observaciones} onChange={e=>setNuevo({...nuevo,observaciones:e.target.value})} rows={2} style={{...inputStyle,resize:"vertical"}}/>

        {error && <div style={{fontSize:"var(--fs-1)",color:"var(--peligro)",background:"var(--peligro-bg)",padding:"8px 10px",borderRadius:6,marginBottom:8}}>{error}</div>}

        <button onClick={editId ? guardarEdicion : guardar} style={{...btnPrimary, marginTop:0}}>{editId ? "Guardar cambios" : "Guardar cirugía"}</button>
      </div>
    );
  }

  // ============================================================
  // RENDER: DETALLE
  // ============================================================

  if (vista === "detalle" && seleccionado) {
    const esCirujano = seleccionado.cirujano_id === currentUser.id;
    return (
      <div style={{padding:"16px",overflowY:"auto"}}>
        <button onClick={()=>{setVista("tabla");setSeleccionado(null);}} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:"var(--fs-2)",cursor:"pointer",marginBottom:10,padding:0}}>← Volver a la tabla</button>

        <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"14px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
            <div>
              <div style={{fontSize:18,fontWeight:600,color:"var(--texto)"}}>{seleccionado.iniciales}{seleccionado.edad && ` (${seleccionado.edad}a)`}</div>
              {(seleccionado.ficha_clinica || seleccionado.rut) && (
                <div style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)",marginTop:2}}>
                  {seleccionado.ficha_clinica ? `FC: ${seleccionado.ficha_clinica}` : ""}{seleccionado.ficha_clinica && seleccionado.rut ? " · " : ""}{seleccionado.rut ? `RUT: ${seleccionado.rut}` : ""}
                </div>
              )}
              <div style={{fontSize:"var(--fs-2)",color:"var(--texto-sec)",marginTop:4}}>{seleccionado.procedimiento}{seleccionado.lateralidad && ` • ${seleccionado.lateralidad}`}</div>
              <div style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)",marginTop:4}}>📅 {seleccionado.fecha} {seleccionado.hora?.slice(0,5)} | {seleccionado.pabellon==="CCV" ? "CCV (Costanera)" : `Pabellón ${seleccionado.pabellon}`}</div>
              {seleccionado.cirujano && <div style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)",marginTop:2}}>👨‍⚕️ Cirujano: {seleccionado.cirujano}</div>}
              {seleccionado.primer_ayudante && <div style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)",marginTop:2}}>🧑‍⚕️ Primer ayudante: {seleccionado.primer_ayudante}</div>}
            </div>
            <button onClick={()=>empezarEdicion(seleccionado)} style={{padding:"5px 12px",fontSize:"var(--fs-1)",background:"var(--superficie)",color:"var(--primario)",border:"0.5px solid var(--borde)",borderRadius:6,cursor:"pointer",fontWeight:500,whiteSpace:"nowrap"}}>✏️ Editar</button>
          </div>

          <div style={{fontSize:"var(--fs-1)",color:"var(--texto)",marginBottom:10,padding:"6px 10px",background:"var(--fondo-suave)",borderRadius:6}}>
            <strong>Estado actual:</strong> {seleccionado.estado}
          </div>

          <div style={{marginBottom:10,padding:"8px 10px",background:"var(--fondo-suave)",borderRadius:6}}>
            <div style={{fontSize:"var(--fs-0)",fontWeight:600,color:"var(--texto)",marginBottom:5}}>🧑‍⚕️ Primer ayudante</div>
            {esEquipo && miembrosEquipo.length > 0 ? (
              <select value={seleccionado.primer_ayudante || ""} onChange={e=>asignarPrimerAyudante(seleccionado, e.target.value)} style={{...inputStyle, marginBottom:0}}>
                <option value="">— Sin primer ayudante —</option>
                {miembrosEquipo.map(m => {
                  const nombre = m.perfiles?.nombre;
                  return nombre ? <option key={m.perfiles?.id} value={nombre}>{nombre}</option> : null;
                })}
              </select>
            ) : (
              <input value={seleccionado.primer_ayudante || ""} onChange={e=>setSeleccionado({...seleccionado, primer_ayudante:e.target.value})} onBlur={e=>asignarPrimerAyudante(seleccionado, e.target.value)} placeholder="Nombre del ayudante (se guarda al salir del campo)" style={{...inputStyle, marginBottom:0}}/>
            )}
          </div>

          {seleccionado.observaciones && (
            <div style={{fontSize:"var(--fs-1)",color:"var(--texto)",marginBottom:10,padding:"8px 10px",background:"var(--alerta-bg)",borderRadius:6}}>
              <strong>Observaciones:</strong> {seleccionado.observaciones}
            </div>
          )}

          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:14}}>
            {["programada","en_curso","completada","suspendida","cancelada"].map(estado => (
              <button 
                key={estado} 
                onClick={()=>cambiarEstado(seleccionado, estado)}
                disabled={seleccionado.estado === estado}
                style={{padding:"5px 10px",fontSize:"var(--fs-0)",background:seleccionado.estado === estado ? "var(--primario)" : "var(--superficie)",color:seleccionado.estado === estado ?"var(--texto-inv)":"var(--texto-sec)",border:"0.5px solid var(--borde)",borderRadius:6,cursor:seleccionado.estado === estado ? "default" : "pointer",fontWeight:500}}
              >{estado.replace("_"," ")}</button>
            ))}
          </div>

          {esCirujano && (
            <button onClick={()=>eliminar(seleccionado)} style={{marginTop:14,width:"100%",padding:"10px",fontSize:"var(--fs-1)",background:"var(--superficie)",color:"var(--peligro)",border:"1px solid var(--peligro)",borderRadius:8,cursor:"pointer",fontWeight:500}}>🗑 Eliminar cirugía</button>
          )}
        </div>
      </div>
    );
  }

  // ============================================================
  // RENDER: TABLA
  // ============================================================

  return (
    <div style={{padding:"16px",overflowY:"auto"}}>
      {/* Submenú de herramientas (aparece al tocar de nuevo la pestaña "Tabla") */}
      {toolsOpen && !soloLectura && (
        <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap",alignItems:"center",padding:"10px 12px",background:"var(--fondo-suave)",border:"0.5px solid var(--borde)",borderRadius:10}}>
          <button onClick={()=>setVista("nuevo")} style={{padding:"6px 12px",fontSize:"var(--fs-1)",background:"var(--primario)",color:"var(--texto-inv)",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>+ Nueva</button>
          <label style={{padding:"6px 12px",fontSize:"var(--fs-1)",background:"var(--superficie)",color:"var(--primario)",border:"0.5px solid var(--borde)",borderRadius:6,cursor:"pointer",fontWeight:500}}>
            📊 Importar Excel
            <input type="file" accept=".xlsx,.xls" onChange={importarExcel} style={{display:"none"}}/>
          </label>
          <button onClick={()=>inputFotoTablaRef.current?.click()} disabled={extrayendoTabla} style={{padding:"6px 12px",fontSize:"var(--fs-1)",background:"var(--superficie)",color:"var(--primario)",border:"0.5px solid var(--borde)",borderRadius:6,cursor:extrayendoTabla?"default":"pointer",fontWeight:500,opacity:extrayendoTabla?0.6:1}}>{extrayendoTabla?"🔍 Leyendo…":"📷 Foto tabla"}</button>
          <input ref={inputFotoTablaRef} type="file" accept="image/*,application/pdf" multiple style={{display:"none"}} onChange={onFotoTabla}/>
          <div style={{position:"relative",marginLeft:"auto"}}>
            <button onClick={()=>setVistaMenuOpen(v=>!v)} style={{padding:"6px 12px",fontSize:"var(--fs-1)",background:vistaMenuOpen?"var(--primario)":"var(--superficie)",color:vistaMenuOpen?"var(--texto-inv)":"var(--primario)",border:vistaMenuOpen?"none":"0.5px solid var(--borde)",borderRadius:6,cursor:"pointer",fontWeight:500}}>{modoVista==="mensual"?"🗓️":modoVista==="planner"?"📅":"☰"} Vista {vistaMenuOpen?"▴":"▾"}</button>
            {vistaMenuOpen && (
              <div style={{position:"absolute",top:"calc(100% + 4px)",right:0,background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:8,padding:4,zIndex:20,boxShadow:"0 4px 12px rgba(0,0,0,0.12)",display:"flex",flexDirection:"column",gap:2,minWidth:130}}>
                <button onClick={()=>{setModoVista("mensual");setVistaMenuOpen(false);}} style={{padding:"7px 10px",fontSize:"var(--fs-1)",textAlign:"left",background:modoVista==="mensual"?"var(--fondo-suave)":"none",border:"none",color:"var(--texto)",borderRadius:6,cursor:"pointer",fontWeight:modoVista==="mensual"?600:400}}>🗓️ Mensual</button>
                <button onClick={()=>{setModoVista("planner");setVistaMenuOpen(false);}} style={{padding:"7px 10px",fontSize:"var(--fs-1)",textAlign:"left",background:modoVista==="planner"?"var(--fondo-suave)":"none",border:"none",color:"var(--texto)",borderRadius:6,cursor:"pointer",fontWeight:modoVista==="planner"?600:400}}>📅 Semanal</button>
                <button onClick={()=>{setModoVista("lista");setVistaMenuOpen(false);}} style={{padding:"7px 10px",fontSize:"var(--fs-1)",textAlign:"left",background:modoVista==="lista"?"var(--fondo-suave)":"none",border:"none",color:"var(--texto)",borderRadius:6,cursor:"pointer",fontWeight:modoVista==="lista"?600:400}}>☰ Lista</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Navegación de semana o mes + filtro de estado (siempre visible) */}
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
        {modoVista === "mensual" ? (
          <div style={{display:"flex",alignItems:"center",gap:4}}>
            <button onClick={()=>{const d=new Date(mesActual);d.setMonth(d.getMonth()-1);setMesActual(d);}} style={navBtn}>‹</button>
            <span style={{fontSize:"var(--fs-1)",fontWeight:600,color:"var(--texto)",minWidth:120,textAlign:"center",textTransform:"capitalize"}}>
              {mesActual.toLocaleDateString("es-CL",{month:"long",year:"numeric"})}
            </span>
            <button onClick={()=>{const d=new Date(mesActual);d.setMonth(d.getMonth()+1);setMesActual(d);}} style={navBtn}>›</button>
            <button onClick={()=>{const d=new Date();d.setDate(1);d.setHours(0,0,0,0);setMesActual(d);}} style={{...navBtn,width:"auto",padding:"0 10px",fontSize:"var(--fs-0)"}}>Hoy</button>
          </div>
        ) : (
          <div style={{display:"flex",alignItems:"center",gap:4}}>
            <button onClick={()=>{const d=new Date(lunesSemana);d.setDate(d.getDate()-7);setLunesSemana(d);}} style={navBtn}>‹</button>
            <span style={{fontSize:"var(--fs-1)",fontWeight:600,color:"var(--texto)",minWidth:120,textAlign:"center"}}>
              {new Date(diasSemana[0]+"T00:00:00").toLocaleDateString("es-CL",{day:"numeric",month:"short"})} – {new Date(diasSemana[6]+"T00:00:00").toLocaleDateString("es-CL",{day:"numeric",month:"short"})}
            </span>
            <button onClick={()=>{const d=new Date(lunesSemana);d.setDate(d.getDate()+7);setLunesSemana(d);}} style={navBtn}>›</button>
            <button onClick={()=>setLunesSemana(lunesDe(new Date()))} style={{...navBtn,width:"auto",padding:"0 10px",fontSize:"var(--fs-0)"}}>Hoy</button>
          </div>
        )}
        <select value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)} style={{padding:"5px 10px",fontSize:"var(--fs-0)",borderRadius:6,border:"0.5px solid var(--borde)",background:"var(--superficie)",color:"var(--texto)",cursor:"pointer"}}>
          <option value="todos">Todos los estados</option>
          <option value="programada">Programadas</option>
          <option value="en_curso">En curso</option>
          <option value="completada">Completadas</option>
          <option value="suspendida">Suspendidas</option>
          <option value="cancelada">Canceladas</option>
        </select>
        <span style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)",marginLeft:"auto"}}>{modoVista==="mensual" ? cirugiasMes.length : cirugiasSemana.length} cx</span>
      </div>

      {loadingCirugias && (
        <div style={{textAlign:"center",padding:"30px",color:"var(--texto-ter)",fontSize:"var(--fs-2)"}}>Cargando tabla...</div>
      )}

      {!loadingCirugias && modoVista !== "mensual" && cirugiasSemana.length === 0 && (
        <div style={{textAlign:"center",padding:"30px 20px",color:"var(--texto-ter)",fontSize:"var(--fs-2)",lineHeight:1.6}}>
          No hay cirugías esta semana.<br/>
          Usa ‹ › para cambiar de semana, o agrega con + Nueva / Importar Excel.
        </div>
      )}

      {!loadingCirugias && modoVista === "mensual" && cirugiasMes.length === 0 && (
        <div style={{textAlign:"center",padding:"30px 20px",color:"var(--texto-ter)",fontSize:"var(--fs-2)",lineHeight:1.6}}>
          No hay cirugías este mes.<br/>
          Usa ‹ › para cambiar de mes, o agrega con + Nueva / Importar Excel.
        </div>
      )}

      {/* ====================== VISTA MENSUAL ====================== */}
      {!loadingCirugias && modoVista === "mensual" && cirugiasMes.length > 0 && (
        <div style={{overflowX:"auto",paddingBottom:8}}>
          <div style={{minWidth:560}}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7, 1fr)",gap:4,marginBottom:4}}>
              {["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"].map(d => (
                <div key={d} style={{textAlign:"center",fontSize:"var(--fs-xs)",fontWeight:700,color:"var(--texto-sec)",textTransform:"uppercase",letterSpacing:0.3,padding:"2px 0"}}>{d}</div>
              ))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7, 1fr)",gap:4}}>
              {celdasMes.map((fecha, idx) => {
                if (!fecha) return <div key={"v"+idx}/>;
                const lista = (porFechaMes[fecha] || []).slice().sort((a,b)=>(a.hora||"").localeCompare(b.hora||""));
                const esHoy = fecha === hoyISO;
                const diaNum = parseInt(fecha.slice(8), 10);
                return (
                  <div key={fecha} style={{background:esHoy?"var(--hoy-bg)":"var(--fondo-suave)",border:esHoy?"1.5px solid var(--primario)":"0.5px solid var(--borde-suave)",borderRadius:8,padding:4,minHeight:64}}>
                    <div style={{fontSize:"var(--fs-xs)",fontWeight:700,color:esHoy?"var(--primario)":"var(--texto-sec)",textAlign:"right",padding:"0 3px 3px"}}>{diaNum}</div>
                    <div style={{display:"flex",flexDirection:"column",gap:3}}>
                      {lista.map(c => (
                        <div key={c.id} onClick={()=>{setSeleccionado(c);setVista("detalle");}} title={`${c.hora?.slice(0,5)} ${c.iniciales} — ${c.procedimiento}`} style={{background:fondoEstado[c.estado],borderLeft:`3px solid ${coloresEstado[c.estado]}`,borderRadius:4,padding:"2px 4px",cursor:"pointer",overflow:"hidden"}}>
                          <div style={{fontSize:8.5,fontWeight:700,color:coloresEstado[c.estado],whiteSpace:"nowrap"}}>{c.hora?.slice(0,5)}{c.pabellon==="CCV"?" · CCV":""}</div>
                          <div style={{fontSize:9,color:"var(--texto)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.procedimiento}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ====================== VISTA PLANNER ====================== */}
      {!loadingCirugias && modoVista === "planner" && cirugiasSemana.length > 0 && (
        <div style={{overflowX:"auto",paddingBottom:8}}>
          <div style={{display:"grid",gridTemplateColumns:`repeat(${diasVisibles.length}, minmax(155px, 1fr))`,gap:8,minWidth:diasVisibles.length*160}}>
            {diasVisibles.map(fecha => {
              const dObj = new Date(fecha+"T00:00:00");
              const esHoy = fecha === hoyISO;
              const { hospital, ccv } = separarHospitalCCV(porFecha[fecha]||[]);
              const total = hospital.length + ccv.length;

              // Tarjeta de una cirugía: recuadro completo pintado según estado
              const Tarjeta = (c) => (
                <div key={c.id} onClick={()=>{setSeleccionado(c);setVista("detalle");}} style={{background:fondoEstado[c.estado],border:`0.5px solid ${coloresEstado[c.estado]}`,borderLeft:`4px solid ${coloresEstado[c.estado]}`,borderRadius:6,padding:"6px 7px",cursor:"pointer"}}>
                  <div style={{display:"flex",alignItems:"center",gap:4,flexWrap:"wrap"}}>
                    <span style={{fontSize:"var(--fs-xs)",fontWeight:700,color:coloresEstado[c.estado]}}>{c.hora?.slice(0,5)}</span>
                    {c.pabellon==="CCV"
                      ? <span style={{fontSize:8,fontWeight:600,background:"var(--ccv)",color:"var(--texto-inv)",padding:"0 4px",borderRadius:6}}>CCV</span>
                      : c.pabellon && <span style={{fontSize:8,color:"var(--texto-ter)"}}>Pab {c.pabellon}</span>}
                  </div>
                  <div style={{fontSize:"var(--fs-xs)",color:"var(--texto)",fontWeight:600,marginTop:2,lineHeight:1.25}}>{c.iniciales}{c.edad?` (${c.edad}a)`:""}</div>
                  {(c.ficha_clinica || c.rut) && <div style={{fontSize:8.5,color:"var(--texto-ter)",marginTop:1}}>{c.ficha_clinica?`FC ${c.ficha_clinica}`:""}{c.ficha_clinica&&c.rut?" · ":""}{c.rut||""}</div>}
                  <div style={{fontSize:"var(--fs-xs)",color:"var(--texto-sec)",marginTop:1,lineHeight:1.25}}>{c.procedimiento}{c.lateralidad?` · ${c.lateralidad}`:""}</div>
                  {c.cirujano && <div style={{fontSize:9,color:"var(--texto-ter)",marginTop:1}}>👨‍⚕️ {c.cirujano}</div>}
                  {c.primer_ayudante && <div style={{fontSize:9,color:"var(--texto-ter)"}}>🧑‍⚕️ {c.primer_ayudante}</div>}
                  <div style={{marginTop:3,display:"inline-block",fontSize:8,fontWeight:700,textTransform:"uppercase",letterSpacing:.3,color:"var(--texto-inv)",background:coloresEstado[c.estado],padding:"1px 6px",borderRadius:8}}>{textoEstado[c.estado]}</div>
                </div>
              );

              return (
                <div key={fecha} style={{background:esHoy?"var(--hoy-bg)":"var(--fondo-suave)",borderRadius:8,border:esHoy?"1.5px solid var(--primario)":"0.5px solid var(--borde-suave)",padding:6,minHeight:130}}>
                  <div style={{textAlign:"center",fontSize:"var(--fs-0)",fontWeight:700,color:esHoy?"var(--primario)":"var(--texto-sec)",padding:"3px 0 6px",borderBottom:"0.5px solid var(--borde-suave)",marginBottom:6,textTransform:"capitalize"}}>
                    {dObj.toLocaleDateString("es-CL",{weekday:"short"})} {dObj.getDate()}
                    {total>0 && <span style={{fontSize:9,fontWeight:500,color:"var(--texto-ter)"}}> · {total}</span>}
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:5}}>
                    {total===0 && <div style={{textAlign:"center",fontSize:"var(--fs-xs)",color:"var(--borde-suave)",padding:"14px 0"}}>—</div>}
                    {/* Pabellones del hospital primero */}
                    {hospital.map(Tarjeta)}
                    {/* CCV (Costanera) separado y siempre abajo */}
                    {ccv.length>0 && (
                      <div style={{fontSize:9,fontWeight:700,color:"var(--ccv)",textAlign:"center",margin:"4px 0 1px",padding:"2px 0",borderTop:"1px dashed var(--ccv-borde)",borderBottom:"1px dashed var(--ccv-borde)"}}>CCV · COSTANERA</div>
                    )}
                    {ccv.map(Tarjeta)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ====================== VISTA LISTA ====================== */}
      {!loadingCirugias && modoVista === "lista" && Object.keys(porFecha).sort().map(fecha => {
        const { hospital, ccv } = separarHospitalCCV(porFecha[fecha]||[]);
        const ordenadas = [...hospital, ...ccv]; // hospital primero, CCV abajo
        return (
        <div key={fecha} style={{marginBottom:14}}>
          <div style={{fontSize:"var(--fs-1)",fontWeight:600,color:"var(--texto)",marginBottom:8,padding:"4px 10px",background:"var(--fondo-suave)",borderRadius:6}}>
            📅 {new Date(fecha + "T00:00:00").toLocaleDateString("es-CL",{weekday:"long",day:"numeric",month:"long"})} ({porFecha[fecha].length})
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:5}}>
            {ordenadas.map((c,idx) => (
              <Fragment key={c.id}>
                {idx===hospital.length && ccv.length>0 && (
                  <div style={{fontSize:"var(--fs-xs)",fontWeight:700,color:"var(--ccv)",textAlign:"center",margin:"2px 0",padding:"2px 0",borderTop:"1px dashed var(--ccv-borde)",borderBottom:"1px dashed var(--ccv-borde)"}}>CCV · COSTANERA</div>
                )}
                <div onClick={()=>{setSeleccionado(c);setVista("detalle");}} style={{background:fondoEstado[c.estado],border:`0.5px solid ${coloresEstado[c.estado]}`,borderRadius:8,padding:"10px 12px",cursor:"pointer",borderLeft:`4px solid ${coloresEstado[c.estado]}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:"var(--fs-1)",color:"var(--texto)",fontWeight:500}}>
                        {c.hora?.slice(0,5)} | {c.iniciales}{c.edad ? ` (${c.edad}a)` : ""} | {c.procedimiento}{c.lateralidad ? ` (${c.lateralidad})` : ""}
                      </div>
                      <div style={{fontSize:"var(--fs-xs)",color:"var(--texto-ter)",marginTop:2}}>
                        {c.ficha_clinica && `FC ${c.ficha_clinica} | `}{c.rut && `RUT ${c.rut} | `}{c.pabellon==="CCV" ? "CCV" : `Pabellón ${c.pabellon}`}{c.cirujano && ` | 👨‍⚕️ ${c.cirujano}`}{c.primer_ayudante && ` | 🧑‍⚕️ ${c.primer_ayudante}`}
                      </div>
                    </div>
                    <span style={{fontSize:9,padding:"2px 8px",background:coloresEstado[c.estado],color:"var(--texto-inv)",borderRadius:10,whiteSpace:"nowrap"}}>{textoEstado[c.estado]}</span>
                  </div>
                </div>
              </Fragment>
            ))}
          </div>
        </div>
      );})}
    </div>
  );
  }

 

// ─── Plantillas de exámenes: guarda sets frecuentes y los aplica de un toque ───
const EXAMENES_PLANTILLA = ["Hemograma", "Función renal", "Coagulación", "PCR", "ELP", "Pruebas hepáticas", "Orina completa", "Antígeno prostático (PSA)", "Urocultivo"];
function leerPlantillasEx() {
  try { const raw = localStorage.getItem("uro_plantillas_examenes"); return raw ? JSON.parse(raw) : []; } catch { return []; }
}
function guardarPlantillasEx(lista) {
  try { localStorage.setItem("uro_plantillas_examenes", JSON.stringify(lista)); } catch {}
}
function PlantillasExamenesModal({ paciente, currentUser, onGuardado, onClose }) {
  const [plantillas, setPlantillas] = useState(leerPlantillasEx);
  const [modo, setModo] = useState("aplicar"); // aplicar | crear
  const [sel, setSel] = useState([]);          // items marcados al crear
  const [nombre, setNombre] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState("");

  const toggle = (it) => setSel(s => s.includes(it) ? s.filter(x => x !== it) : [...s, it]);

  const crearPlantilla = () => {
    if (!nombre.trim() || sel.length === 0) { setMsg("Ponle nombre y marca al menos un examen."); return; }
    const nueva = [...plantillas.filter(p => p.nombre !== nombre.trim()), { nombre: nombre.trim(), items: sel }];
    setPlantillas(nueva); guardarPlantillasEx(nueva);
    setNombre(""); setSel([]); setModo("aplicar"); setMsg("✓ Plantilla guardada.");
  };
  const borrarPlantilla = (nom) => {
    const nueva = plantillas.filter(p => p.nombre !== nom);
    setPlantillas(nueva); guardarPlantillasEx(nueva);
  };

  const aplicar = async (plantilla) => {
    setGuardando(true); setMsg("");
    let ok = 0;
    for (const item of plantilla.items) {
      const esUro = /urocultivo/i.test(item);
      const datos = {
        tipo: esUro ? "Cultivo" : "Laboratorio",
        nombre: item,
        resultado: null,
        fecha_examen: fecha,
        datos_estructurados: esUro ? { tipoCultivo: "Urocultivo" } : {},
      };
      const r = await crearExamen(paciente.id, currentUser.id, datos);
      if (r.ok) ok++;
    }
    setGuardando(false);
    if (ok > 0) { await onGuardado?.(); onClose(); }
    else setMsg("No se pudo aplicar la plantilla.");
  };

  const chip = (activo) => ({ padding: "7px 11px", fontSize: "var(--fs-1)", borderRadius: 8, cursor: "pointer", border: "0.5px solid var(--borde)", background: activo ? "var(--primario)" : "var(--fondo-suave)", color: activo ? "var(--texto-inv)" : "var(--texto)", fontWeight: activo ? 700 : 500 });

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--fondo)", border: "0.5px solid var(--borde)", borderRadius: 14, padding: 18, width: "100%", maxWidth: 400, maxHeight: "86vh", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: "var(--fs-3)", fontWeight: 700, color: "var(--texto)" }}>📋 Plantillas de exámenes</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--texto-ter)", lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <button onClick={() => setModo("aplicar")} style={{ ...chip(modo === "aplicar"), flex: 1 }}>Aplicar</button>
          <button onClick={() => setModo("crear")} style={{ ...chip(modo === "crear"), flex: 1 }}>Crear nueva</button>
        </div>

        {modo === "aplicar" && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: "var(--fs-1)", color: "var(--texto-sec)" }}>Fecha:</span>
              <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={{ fontSize: "var(--fs-1)", padding: "5px 8px", border: "0.5px solid var(--borde)", borderRadius: 6, background: "var(--superficie)", color: "var(--texto)" }} />
            </div>
            {plantillas.length === 0 ? (
              <div style={{ fontSize: "var(--fs-1)", color: "var(--texto-ter)", fontStyle: "italic", padding: "6px 0" }}>Aún no tienes plantillas. Crea una en "Crear nueva".</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {plantillas.map(p => (
                  <div key={p.nombre} style={{ background: "var(--fondo-suave)", borderRadius: 9, padding: "10px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: "var(--fs-2)", fontWeight: 700, color: "var(--texto)" }}>{p.nombre}</span>
                      <button onClick={() => borrarPlantilla(p.nombre)} style={{ background: "none", border: "none", color: "var(--peligro)", cursor: "pointer", fontSize: "var(--fs-2)" }}>🗑</button>
                    </div>
                    <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)", marginBottom: 8 }}>{p.items.join(" · ")}</div>
                    <button onClick={() => aplicar(p)} disabled={guardando} style={{ width: "100%", padding: 9, fontSize: "var(--fs-2)", fontWeight: 600, background: "var(--primario)", color: "var(--texto-inv)", border: "none", borderRadius: 7, cursor: guardando ? "default" : "pointer", opacity: guardando ? 0.6 : 1 }}>{guardando ? "Agregando…" : `Agregar ${p.items.length} examen(es)`}</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {modo === "crear" && (
          <>
            <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre de la plantilla (ej: Control post-op)" style={{ width: "100%", padding: "9px 11px", fontSize: "var(--fs-2)", border: "0.5px solid var(--borde)", borderRadius: 8, background: "var(--superficie)", color: "var(--texto)", boxSizing: "border-box", marginBottom: 10 }} />
            <div style={{ fontSize: "var(--fs-1)", color: "var(--texto-sec)", marginBottom: 6 }}>Exámenes incluidos:</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {EXAMENES_PLANTILLA.map(it => <button key={it} onClick={() => toggle(it)} style={chip(sel.includes(it))}>{it}</button>)}
            </div>
            <button onClick={crearPlantilla} style={{ width: "100%", padding: 11, fontSize: "var(--fs-2)", fontWeight: 600, background: "var(--primario)", color: "var(--texto-inv)", border: "none", borderRadius: 8, cursor: "pointer" }}>Guardar plantilla</button>
          </>
        )}

        {msg && <div style={{ fontSize: "var(--fs-1)", color: msg.startsWith("✓") ? "var(--exito)" : "var(--peligro)", marginTop: 10 }}>{msg}</div>}
      </div>
    </div>
  );
}

// ─── Foto → exámenes: captura múltiple, confirma, extrae con IA y guarda ───
function FotoExamenesModal({ paciente, currentUser, onGuardado, onClose }) {
  const [fotos, setFotos] = useState([]);       // dataUrls comprimidos
  const [fase, setFase] = useState("capturar"); // capturar | extrayendo | revisar
  const [extraidos, setExtraidos] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  const onFiles = async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 5 - fotos.length);
    if (!files.length) return;
    const nuevas = [];
    for (const f of files) { try { nuevas.push(await comprimirImagenPac(f)); } catch {} }
    setFotos(prev => [...prev, ...nuevas].slice(0, 5));
    if (inputRef.current) inputRef.current.value = "";
  };

  const extraer = async () => {
    if (!fotos.length) return;
    setFase("extrayendo"); setError("");
    try {
      const b64s = fotos.map(d => d.split(",")[1]);
      const arr = await extraerExamenes(b64s);
      if (!arr.length) { setError("No se detectaron exámenes. Prueba con una foto más nítida."); setFase("capturar"); return; }
      const hoy = new Date().toISOString().slice(0, 10);
      setExtraidos(arr.map(ex => ({ ...ex, fecha_examen: ex.fecha_examen || hoy, incluir: true })));
      setFase("revisar");
    } catch (e) {
      setError("No se pudo leer los exámenes. " + (e?.message || e)); setFase("capturar");
    }
  };

  const resumenParams = (ex) => {
    if (ex.tipo === "Cultivo") {
      const abg = Array.isArray(ex.antibiograma) ? ex.antibiograma.filter(a => a?.atb).map(a => `${a.atb} (${a.sens?.[0] || "?"})`).join(", ") : "";
      return [ex.germen ? `Germen: ${ex.germen}` : "", abg ? `Antibiograma: ${abg}` : ""].filter(Boolean).join(" · ");
    }
    if (ex.parametros && typeof ex.parametros === "object") {
      return Object.entries(ex.parametros).filter(([, v]) => v !== null && v !== "").map(([k, v]) => `${k}: ${v}`).join(" · ");
    }
    return ex.resultado || "";
  };

  const guardarTodos = async () => {
    const aGuardar = extraidos.filter(e => e.incluir);
    if (!aGuardar.length) { setError("Marca al menos un examen para guardar."); return; }
    setGuardando(true); setError("");
    let ok = 0;
    for (const ex of aGuardar) {
      const estructurados = {};
      if (ex.parametros && typeof ex.parametros === "object") {
        const params = {};
        Object.entries(ex.parametros).forEach(([k, v]) => { if (v !== null && v !== "" && v !== undefined) params[k] = String(v); });
        if (Object.keys(params).length) estructurados.parametros = params;
      }
      if (ex.germen) estructurados.germen = ex.germen;
      if (Array.isArray(ex.antibiograma) && ex.antibiograma.length) estructurados.antibiograma = ex.antibiograma.filter(a => a && a.atb);
      if (ex.tipo === "Cultivo" && ex.nombre) estructurados.tipoCultivo = ex.nombre;
      const datos = {
        tipo: ex.tipo || "Laboratorio",
        nombre: ex.nombre || "Examen",
        resultado: ex.resultado || null,
        fecha_examen: ex.fecha_examen,
        datos_estructurados: estructurados,
      };
      const r = await crearExamen(paciente.id, currentUser.id, datos);
      if (r.ok) ok++;
    }
    setGuardando(false);
    if (ok > 0) { await onGuardado?.(); onClose(); }
    else setError("No se pudo guardar. Revisa tu conexión.");
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--fondo)", border: "0.5px solid var(--borde)", borderRadius: 14, padding: 18, width: "100%", maxWidth: 440, maxHeight: "88vh", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: "var(--fs-3)", fontWeight: 700, color: "var(--texto)" }}>📷 Exámenes desde foto</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--texto-ter)", lineHeight: 1 }}>✕</button>
        </div>

        <input ref={inputRef} type="file" accept="image/*,application/pdf" multiple style={{ display: "none" }} onChange={onFiles} />

        {fase === "capturar" && (
          <>
            <div style={{ fontSize: "var(--fs-1)", color: "var(--texto-ter)", marginBottom: 10 }}>Toma o sube hasta 5 fotos de los resultados. Revisa antes de extraer.</div>
            {fotos.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                {fotos.map((d, i) => (
                  <div key={i} style={{ position: "relative" }}>
                    <img src={d} alt={`foto ${i + 1}`} style={{ height: 76, borderRadius: 6, border: "0.5px solid var(--borde)" }} />
                    <button onClick={() => setFotos(fotos.filter((_, j) => j !== i))} style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: 9, background: "var(--peligro)", color: "#fff", border: "none", fontSize: "var(--fs-0)", cursor: "pointer", lineHeight: 1 }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            {fotos.length < 5 && (
              <button onClick={() => inputRef.current?.click()} style={{ width: "100%", padding: "10px", fontSize: "var(--fs-2)", fontWeight: 600, background: "var(--superficie)", color: "var(--primario)", border: "0.5px dashed var(--primario)", borderRadius: 8, cursor: "pointer", marginBottom: 10 }}>{fotos.length ? "+ Agregar otra foto" : "📸 Tomar / subir foto"}</button>
            )}
            {error && <div style={{ fontSize: "var(--fs-1)", color: "var(--peligro)", marginBottom: 8 }}>{error}</div>}
            <button onClick={extraer} disabled={!fotos.length} style={{ width: "100%", padding: 12, fontSize: "var(--fs-2)", fontWeight: 600, background: fotos.length ? "var(--primario)" : "var(--borde)", color: "var(--texto-inv)", border: "none", borderRadius: 8, cursor: fotos.length ? "pointer" : "default" }}>Extraer datos de {fotos.length} foto{fotos.length === 1 ? "" : "s"}</button>
          </>
        )}

        {fase === "extrayendo" && (
          <div style={{ textAlign: "center", padding: "24px 0", color: "var(--texto-sec)" }}>
            <div style={{ fontSize: 26, marginBottom: 8 }}>🔍</div>
            Leyendo los exámenes…
          </div>
        )}

        {fase === "revisar" && (
          <>
            <div style={{ fontSize: "var(--fs-1)", color: "var(--texto-ter)", marginBottom: 10 }}>Revisa y confirma. Puedes ajustar la fecha o desmarcar los que no quieras guardar.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              {extraidos.map((ex, i) => (
                <div key={i} style={{ background: "var(--fondo-suave)", borderRadius: 8, padding: "10px 12px", opacity: ex.incluir ? 1 : 0.5 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <input type="checkbox" checked={ex.incluir} onChange={() => setExtraidos(prev => prev.map((e, j) => j === i ? { ...e, incluir: !e.incluir } : e))} />
                    <span style={{ fontSize: "var(--fs-2)", fontWeight: 700, color: "var(--texto)", flex: 1 }}>{ex.nombre || ex.tipo}</span>
                    <input type="date" value={ex.fecha_examen} onChange={e => setExtraidos(prev => prev.map((x, j) => j === i ? { ...x, fecha_examen: e.target.value } : x))} style={{ fontSize: "var(--fs-0)", padding: "3px 6px", border: "0.5px solid var(--borde)", borderRadius: 6, background: "var(--superficie)", color: "var(--texto)" }} />
                  </div>
                  <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-sec)", lineHeight: 1.4, paddingLeft: 24 }}>{resumenParams(ex) || <em style={{ color: "var(--texto-ter)" }}>sin valores detectados</em>}</div>
                </div>
              ))}
            </div>
            {error && <div style={{ fontSize: "var(--fs-1)", color: "var(--peligro)", marginBottom: 8 }}>{error}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { setFase("capturar"); setExtraidos([]); }} style={{ padding: "10px 14px", fontSize: "var(--fs-2)", background: "var(--superficie)", color: "var(--texto-sec)", border: "0.5px solid var(--borde)", borderRadius: 8, cursor: "pointer" }}>Atrás</button>
              <button onClick={guardarTodos} disabled={guardando} style={{ flex: 1, padding: 12, fontSize: "var(--fs-2)", fontWeight: 600, background: "var(--primario)", color: "var(--texto-inv)", border: "none", borderRadius: 8, cursor: guardando ? "default" : "pointer", opacity: guardando ? 0.6 : 1 }}>{guardando ? "Guardando…" : `Guardar ${extraidos.filter(e => e.incluir).length} examen(es)`}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Módulo Ingresos (HBV Urología): formulario → PDF + agregar a hospitalizados ───
const INDICACIONES_HBV = `Reposo relativo
Régimen liviano, cero desde 22:00
Preparar para pabellón (rasurar vello genital y abdominal)
Cefazolina o Amikacina preoperatoria
Mantener fármacos crónicos (excepto AAS, TACO, Metformina)
Fleet enema a las 21:00 en caso de radical
Enoxaparina/Heparina 5000 U c/12 SC, suspender 12 h previo a pabellón
Omeprazol 20 mg/día VO
Pruebas de compatibilidad y Rh · Reserva de 2 U de GR
CSV + MAT · Kinesioterapia motora/ventilatoria
Pabellón el día ____ en horario ____`;

function IngresoModal({ currentUser, contexto, onCreado, onClose, ingresoExistente, carpetas = [], onGuardarIngreso }) {
  const HOY = new Date().toISOString().slice(0, 10);
  const DEFAULTS = {
    nombre: "", ficha: "", rut: "", fnac: "", edad: "", sexo: "", domicilio: "", telefono: "", fingreso: HOY,
    anamnesis: "", plan: "", morbidos: "", farmacos: "", quirurgicos: "", alergias: "NO", tabaco: "", oh: "", familiares: "",
    transfusiones: "", urocultivo: "", peso: "", talla: "", pa: "",
    cabeza: "Normocráneo, sin lesiones, no palpo adenopatías", torax: "Normoexpansible, RR2TSS, MP(+) SRA",
    abdomen: "RHA(+), BDI, sin signos de irritación peritoneal", fosas: "Sin alteraciones",
    eeii: "Sin edema, pulsos distales presentes, simétricos y conservados", genitales: "NR", rectal: "NR",
    hipotesis: "", indicaciones: INDICACIONES_HBV,
  };
  const [f, setF] = useState(() => ingresoExistente?.datos ? { ...DEFAULTS, ...ingresoExistente.datos } : DEFAULTS);
  const [carpeta, setCarpeta] = useState(ingresoExistente?.carpeta || "");
  const [anexosAbierto, setAnexosAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState("");
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const imc = (f.peso && f.talla) ? (parseFloat(f.peso) / Math.pow(parseFloat(f.talla) / 100, 2)).toFixed(1) : "";
  const tieneAnticoag = /taco|warfarin|acenocumarol|sintrom|neosintrom|enoxaparin|clexane|heparin|rivaroxaban|xarelto|apixaban|eliquis|dabigatran|pradaxa|clopidogrel|plavix|aspirin|\baas\b|ticagrelor|prasugrel/i.test((f.farmacos || "") + " " + (f.morbidos || ""));

  const inp = { width: "100%", padding: "8px 10px", fontSize: "var(--fs-2)", border: "0.5px solid var(--borde)", borderRadius: 7, background: "var(--superficie)", color: "var(--texto)", boxSizing: "border-box", marginBottom: 8 };
  const lbl = { fontSize: "var(--fs-0)", fontWeight: 600, color: "var(--texto-sec)", display: "block", marginBottom: 3 };
  const campo = (l, k, ml = false) => (<div><label style={lbl}>{l}</label>{ml ? <textarea rows={2} value={f[k]} onChange={e => set(k, e.target.value)} style={{ ...inp, resize: "vertical" }} /> : <input value={f[k]} onChange={e => set(k, e.target.value)} style={inp} />}</div>);

  const historiaTexto = () => {
    const L = [];
    L.push(`INGRESO AL SERVICIO DE UROLOGÍA — ${f.fingreso}`);
    if (f.anamnesis) L.push("ANAMNESIS PRÓXIMA: " + f.anamnesis);
    if (f.plan) L.push("Ingresa para " + f.plan);
    const ar = [];
    if (f.morbidos) ar.push("Mórbidos: " + f.morbidos);
    if (f.farmacos) ar.push("Fármacos: " + f.farmacos);
    if (f.quirurgicos) ar.push("Quirúrgicos: " + f.quirurgicos);
    ar.push("Alergias: " + (f.alergias || "NO"));
    if (ar.length) L.push("ANAMNESIS REMOTA: " + ar.join(" · "));
    const ot = [];
    if (f.tabaco) ot.push("Tabaco: " + f.tabaco);
    if (f.oh) ot.push("OH: " + f.oh);
    if (f.familiares) ot.push("Familiares: " + f.familiares);
    if (f.transfusiones) ot.push("Acepta transfusiones: " + f.transfusiones);
    if (f.urocultivo) ot.push("Urocultivo: " + f.urocultivo);
    if (ot.length) L.push("OTROS: " + ot.join(" · "));
    const ef = [`Peso ${f.peso || "—"} kg`, `Talla ${f.talla || "—"} cm`, imc ? `IMC ${imc}` : "", `PA ${f.pa || "—"}`].filter(Boolean).join(" · ");
    L.push("EXAMEN FÍSICO: " + ef);
    L.push(`  Cabeza y cuello: ${f.cabeza}\n  Tórax: ${f.torax}\n  Abdomen: ${f.abdomen}\n  Fosas renales: ${f.fosas}\n  EEII: ${f.eeii}\n  Genitales: ${f.genitales}\n  T. rectal: ${f.rectal}`);
    return L.join("\n\n");
  };

  const generarPDF = async () => {
    setMsg("");
    let jsPDF;
    try { jsPDF = (await import("jspdf")).jsPDF; } catch { setMsg("No se pudo cargar el PDF."); return; }
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth(), M = 20; let y = 18;
    try { const wm = await logoWatermarkDataUrl(); if (wm) doc.addImage(wm, "PNG", W - M - 22, 13, 20, 20); } catch {}
    doc.setTextColor(0, 0, 0);
    doc.setFont("times", "bold"); doc.setFontSize(10);
    ["MINISTERIO DE SALUD", "SERVICIO DE SALUD VALDIVIA", "HOSPITAL BASE VALDIVIA", "SERVICIO UROLOGIA."].forEach(t => { doc.text(t, M, y); y += 4.3; });
    y += 3; doc.setFontSize(12); doc.text("INGRESO AL SERVICIO DE UROLOGIA", W / 2, y, { align: "center" });
    const tw = doc.getTextWidth("INGRESO AL SERVICIO DE UROLOGIA"); doc.setLineWidth(0.3); doc.line(W / 2 - tw / 2, y + 1, W / 2 + tw / 2, y + 1);
    y += 9; doc.setFontSize(10.5);
    const nl = () => { if (y > 285) { doc.addPage(); y = 18; } };
    const lab = (label, value, indent = 0) => {
      nl(); doc.setFont("times", "bold"); doc.text(label, M + indent, y);
      const lw = doc.getTextWidth(label + " "); doc.setFont("times", "normal");
      if (value) { const parts = doc.splitTextToSize(String(value), W - 2 * M - indent - lw); doc.text(parts[0] || "", M + indent + lw, y); for (let i = 1; i < parts.length; i++) { y += 5; nl(); doc.text(parts[i], M + indent, y); } }
      y += 5.4;
    };
    const par = (text, indent = 0) => { doc.setFont("times", "normal"); doc.splitTextToSize(String(text || "—"), W - 2 * M - indent).forEach(p => { nl(); doc.text(p, M + indent, y); y += 5; }); };
    const sec = (title) => { y += 2.5; nl(); doc.setFont("times", "bold"); doc.text(title, M, y); const w = doc.getTextWidth(title); doc.setLineWidth(0.25); doc.line(M, y + 1, M + w, y + 1); y += 6; };

    lab("NOMBRE:", f.nombre); lab("N° FICHA:", f.ficha); lab("RUT:", f.rut);
    lab("FECHA DE NACIMIENTO:", f.fnac); lab("EDAD:", f.edad ? f.edad + " años" : ""); lab("SEXO:", f.sexo);
    lab("DOMICILIO:", f.domicilio); lab("TELEFONO:", f.telefono); lab("FECHA DE INGRESO:", f.fingreso);
    sec("ANAMNESIS PROXIMA:"); par(f.anamnesis); if (f.plan) par("Ingresa para " + f.plan);
    sec("ANAMNESIS REMOTA:");
    lab("- ANTECEDENTES MÓRBIDOS PERSONALES:", f.morbidos);
    lab("- FÁRMACOS:", f.farmacos);
    lab("- ANTECEDENTES QUIRÚRGICOS:", f.quirurgicos);
    lab("- AL:", f.alergias || "NO");
    sec("OTROS:");
    lab("HÁBITOS — TABACO:", f.tabaco || "()"); lab("OH:", f.oh || "()");
    lab("ANTECEDENTES FAMILIARES:", f.familiares);
    lab("ACEPTA TRANSFUSIONES DE SANGRE:", f.transfusiones);
    lab("UROCULTIVO:", f.urocultivo);
    sec("EXAMENES FISICO SEGMENTARIO");
    lab("PESO:", (f.peso || "") + " KG    TALLA: " + (f.talla || "") + " CM    IMC: " + (imc || ""));
    lab("PA:", f.pa);
    lab("CABEZA Y CUELLO:", f.cabeza); lab("TÓRAX:", f.torax); lab("ABDOMEN:", f.abdomen);
    lab("FOSAS RENALES:", f.fosas); lab("EEII:", f.eeii); lab("GENITALES:", f.genitales); lab("T. RECTAL:", f.rectal);
    sec("HIP. DIAGNÓSTICA:"); par(f.hipotesis);
    sec("INDICACIONES:"); (f.indicaciones || "").split("\n").forEach(l => par(l));
    y += 4; doc.setFont("times", "italic"); doc.setFontSize(9); nl(); doc.text(`Becado que realiza ingreso: ${currentUser?.nombre || ""}`, M, y);
    doc.save(`ingreso_${(f.nombre || "paciente").replace(/\s+/g, "_")}.pdf`);
  };

  const agregarAHospitalizados = async () => {
    if (!f.nombre.trim()) { setMsg("⚠️ Ingresa el nombre del paciente."); return; }
    setGuardando(true); setMsg("");
    const datos = {
      medico_id: currentUser.id,
      equipo_id: contexto !== "personal" ? contexto : null,
      iniciales: f.nombre.trim().toUpperCase(),
      ficha_clinica: f.ficha.trim() || null,
      rut: f.rut.trim() || null,
      edad: f.edad ? parseInt(f.edad) : null,
      sexo: f.sexo || null,
      cama: "",
      servicio: "Urología",
      diagnostico: f.hipotesis.trim() || null,
      historia: historiaTexto(),
      plan_manejo: f.indicaciones.trim() || null,
      fecha_ingreso: f.fingreso,
      estado: "activo",
    };
    const r = await crearPaciente(datos);
    setGuardando(false);
    if (r.ok) { onCreado?.(r.paciente); onClose(); }
    else setMsg("⚠️ No se pudo crear el paciente: " + r.error);
  };

  const generarConsentimientoPDF = async () => {
    let jsPDF;
    try { jsPDF = (await import("jspdf")).jsPDF; } catch { setMsg("No se pudo cargar el PDF."); return; }
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth(), M = 14, R = W - M;
    doc.setTextColor(0, 0, 0); doc.setLineWidth(0.3); doc.setDrawColor(0, 0, 0);
    const wrap = (t, x, yy, w, lh = 4.4, font = "normal", size = 8.5) => { doc.setFont("helvetica", font); doc.setFontSize(size); doc.splitTextToSize(t, w).forEach(l => { doc.text(l, x, yy); yy += lh; }); return yy; };

    // ── Encabezado (caja con 3 columnas) ──
    let y = 12; const hT = 17; const c1 = M + 22, c2 = R - 42;
    doc.rect(M, y, R - M, hT);
    doc.line(c1, y, c1, y + hT); doc.line(c2, y, c2, y + hT);
    try { const wm = await logoWatermarkDataUrl(); if (wm) doc.addImage(wm, "PNG", M + 3, y + 3, 15, 11); } catch {}
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5);
    doc.text("DIRECCION HOSPITAL BASE VALDIVIA", (c1 + c2) / 2, y + 4, { align: "center" });
    doc.setFont("helvetica", "italic"); doc.setFontSize(7);
    doc.text("CONSENTIMIENTO INFORMADO DE PACIENTE PARA LA EJECUCIÓN", (c1 + c2) / 2, y + 9, { align: "center" });
    doc.text("DE PROCEDIMIENTOS DE MAYOR RIESGO.", (c1 + c2) / 2, y + 12.5, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.8);
    doc.text("DP 2.1 Ed 3", c2 + 2, y + 4); doc.text("FECHA:    MAYO 2016", c2 + 2, y + 8);
    doc.text("PÁGINA:   12 DE 13", c2 + 2, y + 11.5); doc.text("VIGENCIA: MAYO 2021", c2 + 2, y + 15);
    y += hT + 6;

    // ── Título ──
    doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    doc.text("ANEXO 1", W / 2, y, { align: "center" }); y += 5;
    doc.text("DOCUMENTO CONSENTIMIENTO INFORMADO PARA INTERVENCIONES CLINICAS INVASIVAS", W / 2, y, { align: "center", maxWidth: R - M }); y += 7;

    // ── Caja identificación ──
    const box1 = y; doc.rect(M, y, R - M, 30); const px = M + 3; let yy = y + 5;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    doc.text("Yo", px, yy); doc.line(px + 5, yy + 0.5, R - 42, yy + 0.5); if (f.nombre) doc.text(f.nombre, px + 7, yy - 0.3);
    doc.text("RUN:", R - 40, yy); doc.line(R - 31, yy + 0.5, R - 3, yy + 0.5); if (f.rut) doc.text(f.rut, R - 30, yy - 0.3); yy += 4.5;
    doc.setFont("helvetica", "italic"); doc.setFontSize(7);
    doc.text("(1 nombre y 2 apellidos del paciente) Si hay incapacidad, identifique el sustituto que se responsabiliza de este documento", px, yy); yy += 5.5;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    doc.text("Sustituto:", px, yy); doc.line(px + 15, yy + 0.5, R - 42, yy + 0.5);
    doc.text("RUN:", R - 40, yy); doc.line(R - 31, yy + 0.5, R - 3, yy + 0.5); yy += 6;
    doc.text("Relación del sustituto con el paciente:", px, yy); doc.line(px + 60, yy + 0.5, R - 3, yy + 0.5);
    y = box1 + 30 + 6;

    // ── Cuerpo ──
    doc.setFontSize(8.5);
    doc.text("He sido informado por el médico Dr. (a):", M, y); doc.line(M + 62, y + 0.5, R - 12, y + 0.5); if (currentUser?.nombre) doc.text(currentUser.nombre, M + 64, y - 0.3); doc.text("que:", R - 10, y); y += 7;
    y = wrap("1) Padezco de la condición o enfermedad llamada:", M, y, R - M); doc.line(M, y - 1, R, y - 1); if (f.hipotesis) { doc.setFont("helvetica", "normal"); doc.text(f.hipotesis, M, y - 2); } y += 4;
    y = wrap("2) Para el estudio o manejo de esta condición, se requiere realizar la intervención o procedimiento de:", M, y, R - M); doc.line(M, y - 1, R, y - 1); if (f.plan) doc.text(f.plan, M, y - 2); y += 4;
    y = wrap("3) El médico me ha explicado el objetivo de la intervención o procedimiento, en qué consiste y sus características, así como los eventuales riesgos en el lapso inmediato y mediato, como los beneficios de someterme a la intervención/procedimiento mencionado anteriormente.", M, y, R - M) + 1;
    y = wrap("4) El médico me ha explicado que durante la cirugía y/o procedimiento, pueden ser necesarias otras acciones médicas no contempladas inicialmente, las cuales deberán ser resueltas en el mismo acto o bien resultaría razonable resolverla a fin de evitar una nueva hospitalización.", M, y, R - M) + 1;
    doc.text("5) ¿Existen alternativas a esta intervención?", M, y);
    doc.rect(M + 62, y - 3.2, 3.5, 3.5); doc.text("NO", M + 67, y); doc.rect(M + 78, y - 3.2, 3.5, 3.5); doc.text("SI", M + 83, y);
    doc.text("Especifique cual.", M + 92, y); y += 4; doc.line(M, y - 1, R, y - 1); y += 5;

    // ── Caja declaración ──
    const b2 = y; doc.rect(M, y, R - M, 44); yy = y + 5;
    yy = wrap("Habiendo tomado conocimiento de esta información, aclaradas mis dudas con el médico y sin mediar presión alguna, declaro que:", px, yy, R - M - 6) + 1;
    doc.rect(px, yy - 3.2, 3.6, 3.6); doc.setFont("helvetica", "bold"); doc.text("CONSIENTO", px + 6, yy); doc.setFont("helvetica", "normal"); doc.text("la realización de la intervención ofrecida por el médico", px + 27, yy); yy += 6;
    doc.rect(px, yy - 3.2, 3.6, 3.6); doc.setFont("helvetica", "bold"); doc.text("NO CONSIENTO", px + 6, yy); doc.setFont("helvetica", "normal"); yy = wrap("la realización de la intervención, declaro que estoy en conocimiento de los riesgos que esto significa, y asumo la responsabilidad.", px + 33, yy, R - M - px - 33) + 1;
    doc.rect(px + 40, yy - 3.2, 3.6, 3.6); doc.text("Decido la realización del tratamiento alternativo existente", px + 46, yy); yy += 6;
    yy = wrap("Conozco mi derecho a cambiar de opinión, y por lo tanto anular este consentimiento, dando aviso en forma oportuna al médico. La firma de este documento no implica la renuncia a mis derechos legales.", px, yy, R - M - 6) + 4;
    doc.line(R - 78, yy, R - 6, yy); doc.setFontSize(7.5); doc.text("Firma del paciente o sustituto", R - 60, yy + 3.5); doc.setFontSize(8.5);
    y = b2 + 44 + 3;
    y = wrap("El médico que suscribe declara haber informado y explicado al paciente o su sustituto lo pertinente a su condición de salud, intervención y/o procedimiento a realizar y haber respondido a las consultas surgidas.", M, y, R - M) + 6;
    doc.line(M, y, M + 62, y); doc.line(R - 78, y, R - 6, y);
    doc.setFontSize(7.5); doc.text("Fecha de aplicación de Consentimiento", M, y + 3.5); doc.text("Firma del profesional", R - 55, y + 3.5);
    doc.setFontSize(8.5); if (f.fingreso) doc.text(f.fingreso, M + 4, y - 1); y += 9;

    // ── Caja revocación ──
    const b3 = y; doc.rect(M, y, R - M, 26); yy = y + 5;
    yy = wrap("Después de haber consentido, declaro haber cambiado de opinión, y actualmente deseo dejar constancia de este cambio, rechazando el procedimiento antes descrito, estando en conocimiento de los riesgos que esto significa.", px, yy, R - M - 6) + 7;
    doc.line(px, yy, px + 78, yy); doc.line(R - 84, yy, R - 6, yy);
    doc.setFontSize(7.5); doc.text("Nombre y Firma del paciente o sustituto", px, yy + 3.5); doc.text("Nombre y Firma del profesional", R - 72, yy + 3.5); yy += 8;
    doc.setFontSize(8.5); doc.text("Fecha:", px, yy); doc.line(px + 12, yy + 0.5, px + 70, yy + 0.5);
    y = b3 + 26 + 6;

    doc.setFont("helvetica", "bold"); doc.setFontSize(8);
    doc.text("Este documento se debe firmar por paciente y por el médico responsable, luego dejar inserto en ficha clínica del paciente.", M, y, { maxWidth: R - M });
    doc.save(`consentimiento_${(f.nombre || "paciente").replace(/\s+/g, "_")}.pdf`);
  };

  const generarPreanestesiaPDF = async () => {
    let jsPDF;
    try { jsPDF = (await import("jspdf")).jsPDF; } catch { setMsg("No se pudo cargar el PDF."); return; }
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth(), M = 8, R = W - M;
    doc.setLineWidth(0.2); doc.setDrawColor(0, 0, 0); doc.setTextColor(0, 0, 0);
    const T = (t, x, yy, b = false, s = 6.8) => { doc.setFont("helvetica", b ? "bold" : "normal"); doc.setFontSize(s); doc.text(t, x, yy); };
    const chk = (x, yy) => doc.rect(x, yy - 2.6, 3, 3);
    // Encabezado
    let y = 8; doc.rect(M, y, R - M, 15); doc.line(R - 70, y, R - 70, y + 15);
    try { const wm = await logoWatermarkDataUrl(); if (wm) doc.addImage(wm, "PNG", M + 2, y + 2.5, 11, 9); } catch {}
    T("MINISTERIO DE SALUD", M + 16, y + 3.5, true, 7); T("REGION DE LOS RIOS", M + 16, y + 6.5, true, 7);
    T("SERVICIO SALUD VALDIVIA", M + 16, y + 9.5, true, 7); T("HOSPITAL BASE VALDIVIA", M + 16, y + 12.5, true, 7);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.text("EVALUACION PREANESTESIA ANEXO II", R - 35, y + 8.5, { align: "center", maxWidth: 66 });
    y += 15;
    // Fila NOMBRE / RUT
    const row = (h) => { doc.rect(M, y, R - M, h); };
    row(6); doc.line(R - 55, y, R - 55, y + 6); T("NOMBRE", M + 1, y + 2.5, true); if (f.nombre) T(f.nombre, M + 18, y + 4, false, 8); T("RUT:", R - 54, y + 2.5, true); if (f.rut) T(f.rut, R - 45, y + 4, false, 8); y += 6;
    // Edad/Peso/Talla | Ex Fisico
    const colD = R - 68; row(30); doc.line(colD, y, colD, y + 30);
    doc.line(M, y + 5, colD, y + 5); doc.line(M, y + 10, colD, y + 10);
    T("Edad", M + 1, y + 3.5); if (f.edad) T(f.edad, M + 12, y + 3.5); doc.line(M + 22, y, M + 22, y + 5); T("Peso", M + 23, y + 3.5); if (f.peso) T(f.peso, M + 33, y + 3.5); doc.line(M + 44, y, M + 44, y + 5); T("Talla", M + 45, y + 3.5); if (f.talla) T(f.talla, M + 56, y + 3.5);
    T("P.Art", M + 1, y + 8.5); doc.line(M + 22, y + 5, M + 22, y + 10); T("FC", M + 23, y + 8.5); doc.line(M + 44, y + 5, M + 44, y + 10); T("FR", M + 45, y + 8.5); doc.line(M + 62, y + 5, M + 62, y + 10); T("Tº", M + 63, y + 8.5);
    T("Diagnósticos", M + 1, y + 14); if (f.hipotesis) T(f.hipotesis.slice(0, 60), M + 1, y + 18, false, 7);
    T("Procedimiento y/o Intervención Propuesta", M + 1, y + 23, true); if (f.plan) T(f.plan.slice(0, 55), M + 1, y + 27, false, 7);
    T("Ex. Fisico", colD + 1, y + 3.5, true);
    ["Cardíaco", "Pulmonar", "Neurológico", "Sitios de Punción", "Otros", "Dolor        Sí       No"].forEach((t, i) => T(t + " ...............", colD + 1, y + 8 + i * 4));
    y += 30;
    // RIESGO
    row(5); T("RIESGO:", M + 1, y + 3.3, true); chk(M + 22, y + 3.3); T("BAJO", M + 26, y + 3.3); chk(M + 42, y + 3.3); T("MEDIANO", M + 46, y + 3.3); chk(M + 68, y + 3.3); T("ALTO", M + 72, y + 3.3);
    T("CIRUJANO - DR. (A)", colD + 1, y + 3.3, true); y += 5;
    // 3 columnas: antecedentes | estado/medic | via aerea/lab
    const gY = y, gH = 118, cA = M, cB = M + 62, cC = M + 130;
    doc.rect(M, y, R - M, gH); doc.line(cB, y, cB, y + gH); doc.line(cC, y, cC, y + gH);
    // Col A: antecedentes por sistema con *Negativo
    let ya = y + 4; T("ANTECEDENTES MORBIDOS", cA + 1, ya, true, 6.5); ya += 4;
    const sis = [["Cardiovascular", "HTA · Angor · C.Coronaria · IAM · Valvulopatías"], ["Respiratorio", "Asma · EPOC · SAHOS · TBC · Tos"], ["Neurológico", "Convulsiones · AVC/TIA · Cefalea · Glasgow"], ["Hepático", "Hepatitis · Cirrosis · Ictericia"], ["Renal", "IRC etapa · Falla renal · HD/PD"], ["Gastrointestinal", "RGE · úlcera · gastritis · vómitos"], ["Hematología", "Anemia · coagulopatía · trombocitopenia"], ["Endocrino", "Hipo/Hipertiroidismo · DM"], ["Musculoesquelético", "Dolor lumbar · artritis"]];
    sis.forEach(([n, d]) => { chk(cA + 1, ya); T(n, cA + 5, ya, true); T("*Neg", cB - 10, ya); ya += 3.6; T(d, cA + 5, ya, false, 5.8); ya += 5; });
    // Col B: estado actual / medicamentos / alergias / ASA
    let yb = y + 4; T("ESTADO ACTUAL", cB + 1, yb, true, 6.5); yb += 4;
    T("Embarazo:  Sí / No    Edad gest: ___ sem", cB + 1, yb); yb += 4; T("Hábitos: OH ___ / Tabaco ___ /día / Drogas ___", cB + 1, yb, false, 6); yb += 6;
    T("MEDICAMENTOS ACTUALES", cB + 1, yb, true, 6.5); yb += 4; (f.farmacos || "").split(/[,\n]/).slice(0, 5).forEach(m => { if (m.trim()) { T("• " + m.trim().slice(0, 42), cB + 1, yb, false, 6); yb += 3.6; } }); yb += 3;
    T("ALERGIAS - REACCIONES", cB + 1, yb, true, 6.5); yb += 4; T(f.alergias || "NO", cB + 1, yb, false, 6.5); yb += 6;
    T("OTROS ESTUDIOS", cB + 1, yb, true, 6.5); yb += 5;
    T("CLASIFICACION ASA", cB + 1, yb, true, 6.5); yb += 4;
    ["ASA I", "ASA II", "ASA III", "ASA IV"].forEach((a, i) => { chk(cB + 1 + i * 16, yb); T(a, cB + 5 + i * 16, yb, false, 6); }); yb += 6;
    T("Accesos venosos (tipo, ubicación):", cB + 1, yb, false, 6); yb += 4;
    T("VVP ___  VVC ___  Arterial ___", cB + 1, yb, false, 6);
    // Col C: via aerea / laboratorio
    let yc = y + 4; T("EVALUACION VIA AEREA", cC + 1, yc, true, 6.5); yc += 4;
    T("Intubación difícil:  Sí / No", cC + 1, yc, false, 6); yc += 4; T("Mallampati:  I   II   III   IV", cC + 1, yc, false, 6); yc += 4; T("Dist. TM ___ cm    Mov. cervical ___", cC + 1, yc, false, 6); yc += 4; T("Dentición / estado ___", cC + 1, yc, false, 6); yc += 7;
    T("EXAMENES DE LABORATORIO", cC + 1, yc, true, 6.5); yc += 5;
    [["Hcto:", "Protrom:"], ["Hb:", "TTPK:"], ["Leuc:", "ECG:"], ["Plaq:", "Otro:"], ["Glicemia:", ""], ["Creatininemia:", ""], ["N.U.:", ""]].forEach(([a, b]) => { T(a, cC + 1, yc); if (b) T(b, cC + 34, yc); yc += 5; });
    yc += 2; T("Necesidad post-op UCI/UTI:  SI / NO", cC + 1, yc, false, 6); yc += 5;
    T("Plan anestésico / observaciones:", cC + 1, yc, true, 6); 
    y += gH;
    // Firmas + nota
    row(10); doc.line(W / 2, y, W / 2, y + 10);
    T("Nombre y Firma Médico Equipo Tratante", M + 2, y + 4, true); if (currentUser?.nombre) T(currentUser.nombre, M + 2, y + 8, false, 7); T("Fecha: " + f.fingreso, M + 2, y + 8.5 + 0, false, 6);
    T("Firma Médico Anestesiologo", W / 2 + 2, y + 4, true); y += 10;
    doc.setFont("helvetica", "bold"); doc.setFontSize(5.8);
    doc.text("NOTA: LA RESPONSABILIDAD DEL REGISTRO DE LOS ANTECEDENTES ES DEL MEDICO DEL EQUIPO TRATANTE, EXCEPTO LOS CAMPOS QUE CORRESPONDEN AL MEDICO ANESTESIOLOGO. LOS PACIENTES ASA III O MÁS DEBEN SER VISTOS POR ANESTESIOLOGO ANTES DE PROGRAMAR EN TABLA QUIRURGICA.", M, y + 3, { maxWidth: R - M });
    doc.save(`preanestesia_${(f.nombre || "paciente").replace(/\s+/g, "_")}.pdf`);
  };

  const generarETEPDF = async () => {
    let jsPDF;
    try { jsPDF = (await import("jspdf")).jsPDF; } catch { setMsg("No se pudo cargar el PDF."); return; }
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth(), M = 14, R = W - M;
    doc.setLineWidth(0.2); doc.setTextColor(0, 0, 0);
    const T = (t, x, yy, b = false, s = 8.5) => { doc.setFont("helvetica", b ? "bold" : "normal"); doc.setFontSize(s); doc.text(t, x, yy); };
    const chk = (x, yy) => { doc.setDrawColor(0, 0, 0); doc.rect(x, yy - 2.8, 3.2, 3.2); };
    let y = 12;
    try { const wm = await logoWatermarkDataUrl(); if (wm) doc.addImage(wm, "PNG", M, y, 13, 10); } catch {}
    T("HOSPITAL BASE VALDIVIA", M + 16, y + 6, true, 9); y += 14;
    T("ANEXO N° 1: CATEGORIZACION DE RIESGO DE ENFERMEDAD TROMBOEMBOLICA (ETE)", W / 2, y, true, 9.5); doc.setFontSize(9.5); 
    { const t = "ANEXO N° 1: CATEGORIZACION DE RIESGO DE ENFERMEDAD TROMBOEMBOLICA (ETE)"; doc.text(t, W / 2, y, { align: "center", maxWidth: R - M }); } y += 8;
    const line = (x, yy, w) => { doc.setDrawColor(0, 0, 0); doc.line(x, yy, x + w, yy); };
    T("Nombre del paciente:", M, y, true); line(M + 33, y + 0.5, R - 40 - M - 33); T("RUN:", R - 40, y, true); line(R - 30, y + 0.5, 28); if (f.nombre) T(f.nombre, M + 35, y - 0.5); if (f.rut) T(f.rut, R - 29, y - 0.5); y += 6;
    T("Edad:", M, y, true); if (f.edad) T(f.edad, M + 11, y); T("Sexo:", M + 40, y, true); T("Masculino", M + 52, y); chk(M + 71, y); T("Femenino", M + 78, y); chk(M + 96, y);
    if (f.sexo === "M") T("X", M + 71.7, y); if (f.sexo === "F") T("X", M + 96.7, y); y += 6;
    T("Peso:", M, y, true); if (f.peso) T(f.peso, M + 11, y); T("Kg.  Talla:", M + 30, y, true); if (f.talla) T(f.talla, M + 52, y); T("cm.  IMC:", M + 62, y, true); if (imc) T(imc, M + 84, y); y += 6;
    T("Diagnóstico:", M, y, true); if (f.hipotesis) T(f.hipotesis.slice(0, 40), M + 22, y); T("Intervención:", M + 105, y, true); if (f.plan) T(f.plan.slice(0, 22), M + 130, y); y += 8;
    // Alto riesgo box
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.text("ALTO RIESGO DE ETE:", M, y); doc.setFont("helvetica", "normal"); doc.text(" si el paciente presenta alguna de estas condiciones (marque con una x)", M + 34, y); y += 3;
    const altoY = y; const alto = ["Antecedente de ETE previa ó sospecha de trombofilia", "Cáncer activo", "Será sometido a cirugía oncológica (cualquier especialidad)", "Ingreso para cirugía bariátrica", "Obesidad mórbida", "Politraumatizado", "Tiene fractura pelvis, fémur, pierna.", "Se realizará artroplastia de cadera o rodilla", "Tiene AVE reciente o lesión medular aguda"];
    doc.rect(M, altoY, R - M, alto.length * 5 + 3); let ay = altoY + 5;
    alto.forEach(t => { chk(M + 2, ay); T(t, M + 7, ay, false, 8); ay += 5; }); y = altoY + alto.length * 5 + 3 + 5;
    T("De no ser así, debe CALCULAR EL NIVEL DE RIESGO según ESCALA DE CAPRINI MODIFICADA:", M, y, true, 8.5); y += 4;
    T("Presenta una o más de las siguientes condiciones. (marque con una x)", M, y, false, 8); y += 3;
    // Tabla Caprini 3 columnas (encabezado verde)
    const cw = (R - M) / 3, tY = y;
    doc.setFillColor(220, 235, 215); doc.rect(M, y, R - M, 6, "F"); doc.rect(M, y, cw, 6); doc.rect(M + cw, y, cw, 6); doc.rect(M + 2 * cw, y, cw, 6);
    T("1 punto c/u", M + cw / 2, y + 4, true, 8); T("2 Puntos c/u", M + cw + cw / 2, y + 4, true, 8); T("3 Puntos", M + 2 * cw + cw / 2, y + 4, true, 8);
    ["1 punto c/u", "2 Puntos c/u", "3 Puntos"].forEach((t, i) => doc.text(t, M + i * cw + cw / 2, y + 4, { align: "center" }));
    y += 6; const bodyH = 34; doc.rect(M, y, cw, bodyH); doc.rect(M + cw, y, cw, bodyH); doc.rect(M + 2 * cw, y, cw, bodyH);
    const c1i = ["Edad de 41 a 60 años", "Varices", "Embarazo ó puerperio", "IMC > 25", "Uso de ACO o TRH", "Postrado"];
    const c2i = ["Edad de 61 a 74 años", "Cirugía mayor a 60 min.", "Reposo absoluto >72 hrs.", "Artroscopia"];
    const c3i = ["Edad >74 años"];
    let cy = y + 5; c1i.forEach(t => { chk(M + 2, cy); T(t, M + 6, cy, false, 7.5); cy += 5; });
    cy = y + 5; c2i.forEach(t => { chk(M + cw + 2, cy); T(t, M + cw + 6, cy, false, 7.5); cy += 5; });
    cy = y + 5; c3i.forEach(t => { chk(M + 2 * cw + 2, cy); T(t, M + 2 * cw + 6, cy, false, 7.5); cy += 5; });
    y += bodyH + 4;
    // Nivel de riesgo
    doc.setFillColor(220, 235, 215); doc.rect(M, y, R - M, 5, "F"); doc.rect(M, y, R - M, 5); doc.line((M + R) / 2, y, (M + R) / 2, y + 25);
    T("NIVEL DE RIESGO", M + (R - M) / 4 - 15, y + 3.5, true); T("Puntos", (M + R) / 2 + (R - M) / 4 - 8, y + 3.5, true);
    doc.text("NIVEL DE RIESGO", M + (R - M) / 4, y + 3.5, { align: "center" }); doc.text("Puntos", (M + R) / 2 + (R - M) / 4, y + 3.5, { align: "center" }); y += 5;
    [["MUY BAJO", "0"], ["BAJO", "1-2"], ["MODERADO", "3-4"], ["ALTO", ">4"]].forEach(([n, p]) => { doc.rect(M, y, R - M, 5); doc.line((M + R) / 2, y, (M + R) / 2, y + 5); doc.text(n, M + (R - M) / 4, y + 3.5, { align: "center" }); doc.text(p, (M + R) / 2 + (R - M) / 4, y + 3.5, { align: "center" }); y += 5; });
    y += 5;
    T("TOTAL PUNTAJE OBTENIDO:", M, y, false, 9); line(M + 45, y + 0.5, 20); T("pts.   RIESGO ETE:", M + 68, y, false, 9); doc.rect(M + 100, y - 4, 40, 6); y += 8;
    T("*Indicaciones:", M, y, false); line(M + 24, y + 0.5, R - M - 24); y += 6; line(M, y + 0.5, R - M); y += 6;
    T("Justificar excepciones:", M, y, false); line(M + 38, y + 0.5, R - M - 38); y += 9;
    T("NOMBRE MEDICO:", M, y, true); line(M + 32, y + 0.5, 55); if (currentUser?.nombre) T(currentUser.nombre, M + 34, y - 0.5); T("FIRMA:", R - 55, y, true); line(R - 42, y + 0.5, 40); y += 6;
    T("Fecha:", M, y, true); line(M + 13, y + 0.5, 40); if (f.fingreso) T(f.fingreso, M + 15, y - 0.5);
    doc.save(`ete_caprini_${(f.nombre || "paciente").replace(/\s+/g, "_")}.pdf`);
  };

  const generarAnexos = async () => {
    let jsPDF;
    try { jsPDF = (await import("jspdf")).jsPDF; } catch { setMsg("No se pudo cargar el PDF."); return; }
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth(), M = 16;
    const box = (x, yy) => { doc.setDrawColor(90, 90, 90); doc.rect(x, yy - 3, 3.5, 3.5); };
    try { const wm = await logoWatermarkDataUrl(); if (wm) doc.addImage(wm, "PNG", W - M - 18, 12, 16, 16); } catch {}
    let y = 18; doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text("HOSPITAL BASE VALDIVIA", M, y); y += 5;
    doc.text("ANEXO N°1: RIESGO DE ENFERMEDAD TROMBOEMBÓLICA (ETE)", M, y, { maxWidth: W - 2 * M }); y += 8;
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.text(`Paciente: ${f.nombre || ""}`, M, y); doc.text(`RUN: ${f.rut || ""}`, W - M - 55, y); y += 5;
    doc.text(`Edad: ${f.edad || ""}   Sexo: ${f.sexo || ""}   Peso: ${f.peso || ""} kg   Talla: ${f.talla || ""} cm   IMC: ${imc || ""}`, M, y); y += 5;
    doc.text(`Diagnóstico: ${f.hipotesis || ""}`, M, y, { maxWidth: W - 2 * M }); y += 7;
    doc.setFont("helvetica", "bold"); doc.text("ALTO RIESGO DE ETE (marque X):", M, y); y += 5; doc.setFont("helvetica", "normal");
    ["Antecedente de ETE previa o trombofilia", "Cáncer activo", "Cirugía oncológica", "Cirugía bariátrica", "Obesidad mórbida", "Politraumatizado", "Fractura pelvis/fémur/pierna", "Artroplastia cadera/rodilla", "AVE reciente o lesión medular aguda"].forEach(t => { box(M, y); doc.text(t, M + 6, y); y += 5.2; });
    y += 2; doc.setFont("helvetica", "bold"); doc.text("Si no, ESCALA DE CAPRINI:", M, y); y += 5; doc.setFont("helvetica", "normal");
    doc.text("1 pto: [ ] Edad 41-60  [ ] Várices  [ ] Embarazo/puerperio  [ ] IMC>25  [ ] ACO/TRH  [ ] Postrado", M, y, { maxWidth: W - 2 * M }); y += 5;
    doc.text("2 ptos: [ ] Edad 61-74  [ ] Cirugía >60 min  [ ] Reposo >72 h  [ ] Artroscopia", M, y); y += 5;
    doc.text("3 ptos: [ ] Edad >74     Muy bajo=0 · Bajo=1-2 · Moderado=3-4 · Alto>4", M, y); y += 7;
    doc.text("TOTAL: ______ pts     RIESGO ETE: ______________", M, y); y += 8;
    doc.text("Indicaciones: __________________________________________________________", M, y, { maxWidth: W - 2 * M }); y += 8;
    doc.text(`Médico: ${currentUser?.nombre || "__________"}   Firma: __________   Fecha: ${f.fingreso}`, M, y);
    doc.addPage(); y = 18; doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text("HOSPITAL BASE VALDIVIA — CONSENTIMIENTO INFORMADO", M, y, { maxWidth: W - 2 * M }); y += 8;
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.text(`Yo, ${f.nombre || "____________________"}   RUN: ${f.rut || "____________"}`, M, y); y += 7;
    doc.text("He sido informado por el médico Dr(a): ____________________ que:", M, y, { maxWidth: W - 2 * M }); y += 7;
    ["1) Padezco la condición: " + (f.hipotesis || "____________________"), "2) Se requiere el procedimiento de: ____________________", "3) Se me explicaron objetivo, riesgos y beneficios.", "4) Pueden requerirse acciones no contempladas durante el procedimiento.", "5) ¿Alternativas?  [ ] No   [ ] Sí: ____________________"].forEach(t => { doc.text(t, M, y, { maxWidth: W - 2 * M }); y += 7; });
    y += 3; box(M, y); doc.text("CONSIENTO la realización de la intervención", M + 6, y); y += 6;
    box(M, y); doc.text("NO CONSIENTO (asumo la responsabilidad)", M + 6, y); y += 10;
    doc.text("Firma paciente o sustituto: ____________________", M, y); y += 8;
    doc.text(`Firma profesional: ${currentUser?.nombre || "__________"}   Fecha: ${f.fingreso}`, M, y);
    // ── Anexo 3: Evaluación preanestésica ──
    doc.addPage(); y = 18; doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text("HOSPITAL BASE VALDIVIA — EVALUACIÓN PREANESTÉSICA (ANEXO II)", M, y, { maxWidth: W - 2 * M }); y += 8;
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.text(`Nombre: ${f.nombre || ""}`, M, y); doc.text(`RUT: ${f.rut || ""}`, W - M - 55, y); y += 5;
    doc.text(`Edad: ${f.edad || ""}   Peso: ${f.peso || ""} kg   Talla: ${f.talla || ""} cm   PA: ${f.pa || ""}   FC: ____   FR: ____   T°: ____`, M, y); y += 5;
    doc.text(`Diagnóstico: ${f.hipotesis || ""}`, M, y, { maxWidth: W - 2 * M }); y += 5;
    doc.text("Procedimiento propuesto: ____________________________   Cirujano: ____________________", M, y); y += 7;
    doc.setFont("helvetica", "bold"); doc.text("ANTECEDENTES MÓRBIDOS (marque; * = negativo si asintomático):", M, y); y += 5; doc.setFont("helvetica", "normal");
    ["Cardiovascular: HTA / IC / coronario / IAM / otro", "Respiratorio: asma / EPOC / SAHOS / TBC / otro", "Neurológico: convulsiones / AVC-TIA / otro", "Hepático / Renal (IRC etapa ___, HD/PD)", "Gastrointestinal / Hematología (anemia, coagulopatía)", "Endocrino (DM, tiroides) / Musculoesquelético"].forEach(t => { box(M, y); doc.text(t, M + 6, y); y += 5.2; });
    y += 1; doc.text("Alergias: ____________________   Medicamentos actuales: ____________________________", M, y, { maxWidth: W - 2 * M }); y += 5;
    doc.text("Hábitos: Tabaco ____  OH ____   Cirugías/anestesias previas: ____________________", M, y, { maxWidth: W - 2 * M }); y += 7;
    doc.setFont("helvetica", "bold"); doc.text("CLASIFICACIÓN ASA:", M, y); doc.setFont("helvetica", "normal");
    doc.text("[ ] I    [ ] II    [ ] III    [ ] IV", M + 40, y); y += 6;
    doc.text("Vía aérea: Mallampati ____   Intubación difícil: [ ] Sí  [ ] No   Dentición: ____________", M, y, { maxWidth: W - 2 * M }); y += 6;
    doc.text("Exámenes: Hto ____  Hb ____  Plaq ____  TP/INR ____  TTPA ____  Crea ____  Glicemia ____", M, y, { maxWidth: W - 2 * M }); y += 6;
    doc.text("Necesidad de UCI/UTI post-op: [ ] Sí  [ ] No", M, y); y += 6;
    doc.text("Plan anestésico / observaciones: ____________________________________________________", M, y, { maxWidth: W - 2 * M }); y += 10;
    doc.text(`Médico tratante: ${currentUser?.nombre || "__________"}   Fecha: ${f.fingreso}      Firma anestesiólogo: ______________`, M, y, { maxWidth: W - 2 * M });
    doc.save(`anexos_${(f.nombre || "paciente").replace(/\s+/g, "_")}.pdf`);
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70, padding: 12 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--fondo)", border: "0.5px solid var(--borde)", borderRadius: 14, padding: 18, width: "100%", maxWidth: 720, maxHeight: "90vh", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: "var(--fs-3)", fontWeight: 700, color: "var(--texto)" }}>📋 Ingreso a Urología</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--texto-ter)", lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8 }}>
          <div style={{ gridColumn: "1 / -1" }}>{campo("Nombre completo", "nombre")}</div>
          {campo("N° Ficha", "ficha")}{campo("RUT", "rut")}
          <div><label style={lbl}>Fecha nac.</label><input type="date" value={f.fnac} onChange={e => { const v = e.target.value; let ed = f.edad; if (v) { const d = new Date(v); const h = new Date(); let a = h.getFullYear() - d.getFullYear(); const m = h.getMonth() - d.getMonth(); if (m < 0 || (m === 0 && h.getDate() < d.getDate())) a--; if (a >= 0 && a < 130) ed = String(a); } setF(p => ({ ...p, fnac: v, edad: ed })); }} style={inp} /></div>{campo("Edad", "edad")}
          <div><label style={lbl}>Sexo</label><select value={f.sexo} onChange={e => set("sexo", e.target.value)} style={inp}><option value="">—</option><option value="M">M</option><option value="F">F</option></select></div>
          {campo("Teléfono", "telefono")}
          <div style={{ gridColumn: "1 / -1" }}>{campo("Domicilio", "domicilio")}</div>
          {campo("Fecha ingreso", "fingreso")}
        </div>
        <div style={{ gridColumn: "1 / -1" }}>{campo("Anamnesis próxima", "anamnesis", true)}</div>
        <div style={{ gridColumn: "1 / -1" }}><label style={lbl}>Plan (ingresa para…)</label><input value={f.plan} onChange={e => set("plan", e.target.value)} placeholder="Ej: resección transuretral de próstata" style={inp} /></div>
        <div style={{ fontSize: "var(--fs-1)", fontWeight: 700, color: "var(--primario)", margin: "4px 0 6px" }}>Anamnesis remota</div>
        {campo("Antecedentes mórbidos", "morbidos", true)}
        {campo("Fármacos", "farmacos", true)}
        {tieneAnticoag && <div style={{ background: "var(--peligro-bg,#fdecec)", border: "0.5px solid var(--peligro)", color: "var(--peligro)", borderRadius: 8, padding: "8px 10px", fontSize: "var(--fs-1)", marginBottom: 8, lineHeight: 1.4 }}>⚠️ Anticoagulante/antiagregante detectado. Define y registra la <b>fecha y hora de suspensión</b> antes de pabellón (p. ej. HBPM 12 h antes; TACO según INR; AAS/clopidogrel según riesgo).</div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>{campo("Quirúrgicos", "quirurgicos")}{campo("Alergias", "alergias")}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>{campo("Tabaco", "tabaco")}{campo("OH", "oh")}{campo("Familiares", "familiares")}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>{campo("Acepta transfusiones", "transfusiones")}{campo("Urocultivo", "urocultivo")}</div>
        <div style={{ fontSize: "var(--fs-1)", fontWeight: 700, color: "var(--primario)", margin: "4px 0 6px" }}>Examen físico {imc && <span style={{ fontWeight: 500, color: "var(--texto-ter)" }}>· IMC {imc}</span>}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>{campo("Peso (kg)", "peso")}{campo("Talla (cm)", "talla")}{campo("PA", "pa")}</div>
        {campo("Cabeza y cuello", "cabeza")}{campo("Tórax", "torax")}{campo("Abdomen", "abdomen")}{campo("Fosas renales", "fosas")}{campo("EEII", "eeii")}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>{campo("Genitales", "genitales")}{campo("T. rectal", "rectal")}</div>
        {campo("Hipótesis diagnóstica", "hipotesis", true)}
        <div><label style={lbl}>Indicaciones</label><textarea rows={11} value={f.indicaciones} onChange={e => set("indicaciones", e.target.value)} style={{ ...inp, resize: "vertical", minHeight: 210, fontFamily: "inherit", lineHeight: 1.5 }} /></div>
        {msg && <div style={{ fontSize: "var(--fs-1)", color: msg.startsWith("✓") ? "var(--exito)" : "var(--peligro)", margin: "4px 0 8px" }}>{msg}</div>}
        {onGuardarIngreso && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Carpeta</label>
              <input list="carpetas-list" value={carpeta} onChange={e => setCarpeta(e.target.value)} placeholder="(sin carpeta)" style={inp} />
              <datalist id="carpetas-list">{carpetas.map(c => <option key={c} value={c} />)}</datalist>
            </div>
            <button onClick={async () => { setGuardando(true); await onGuardarIngreso(f, carpeta.trim(), ingresoExistente?.id); setGuardando(false); onClose(); }} disabled={guardando} style={{ padding: "11px 16px", fontSize: "var(--fs-2)", fontWeight: 700, background: "var(--exito)", color: "#fff", border: "none", borderRadius: 8, cursor: guardando ? "default" : "pointer", opacity: guardando ? 0.6 : 1, marginBottom: 8, whiteSpace: "nowrap" }}>💾 Guardar</button>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <button onClick={generarPDF} style={{ flex: 1, padding: 11, fontSize: "var(--fs-2)", fontWeight: 600, background: "var(--superficie)", color: "var(--primario)", border: "0.5px solid var(--borde)", borderRadius: 8, cursor: "pointer" }}>📄 Ingreso</button>
          <button onClick={() => setAnexosAbierto(v => !v)} style={{ flex: 1, padding: 11, fontSize: "var(--fs-2)", fontWeight: 600, background: anexosAbierto ? "var(--primario)" : "var(--superficie)", color: anexosAbierto ? "var(--texto-inv)" : "var(--primario)", border: "0.5px solid var(--borde)", borderRadius: 8, cursor: "pointer" }}>📎 Anexos {anexosAbierto ? "−" : "+"}</button>
          <button onClick={agregarAHospitalizados} disabled={guardando} style={{ flex: 1.2, padding: 11, fontSize: "var(--fs-2)", fontWeight: 600, background: "var(--primario)", color: "var(--texto-inv)", border: "none", borderRadius: 8, cursor: guardando ? "default" : "pointer", opacity: guardando ? 0.6 : 1 }}>{guardando ? "…" : "➕ Hospitalizar"}</button>
        </div>
        {anexosAbierto && (
          <div style={{ marginTop: 12, background: "var(--fondo-suave)", borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: "var(--fs-1)", fontWeight: 700, color: "var(--primario)", marginBottom: 8 }}>Anexos prellenados (revisa antes de imprimir)</div>
            <div style={{ fontSize: "var(--fs-1)", color: "var(--texto-sec)", lineHeight: 1.6 }}>
              <div><b>ETE / Caprini:</b> {f.nombre || "—"} · {f.edad || "—"} años · {f.sexo || "—"} · IMC {imc || "—"} · Dx: {f.hipotesis || "—"}</div>
              <div><b>Consentimiento:</b> {f.nombre || "—"} · RUN {f.rut || "—"} · condición: {f.hipotesis || "—"}</div>
              <div><b>Preanestesia:</b> {f.nombre || "—"} · Peso {f.peso || "—"} kg · Talla {f.talla || "—"} cm · PA {f.pa || "—"} · Alergias: {f.alergias || "—"}</div>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              <button onClick={generarConsentimientoPDF} style={{ flex: "1 1 30%", padding: 10, fontSize: "var(--fs-1)", fontWeight: 600, background: "var(--primario)", color: "var(--texto-inv)", border: "none", borderRadius: 8, cursor: "pointer" }}>📄 Consentimiento</button>
              <button onClick={generarPreanestesiaPDF} style={{ flex: "1 1 30%", padding: 10, fontSize: "var(--fs-1)", fontWeight: 600, background: "var(--primario)", color: "var(--texto-inv)", border: "none", borderRadius: 8, cursor: "pointer" }}>📄 Preanestesia</button>
              <button onClick={generarETEPDF} style={{ flex: "1 1 30%", padding: 10, fontSize: "var(--fs-1)", fontWeight: 600, background: "var(--primario)", color: "var(--texto-inv)", border: "none", borderRadius: 8, cursor: "pointer" }}>📄 ETE / Caprini</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Panel Ingresos: lista guardada, carpetas y gestión ───
function IngresosPanel({ currentUser, contexto }) {
  const [ingresos, setIngresos] = useState([]);
  const [carpetas, setCarpetas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [editando, setEditando] = useState(null);
  const [colapsadas, setColapsadas] = useState(() => { try { return JSON.parse(localStorage.getItem("uro_ing_colapsadas")||"{}"); } catch { return {}; } });
  useEffect(() => { try { localStorage.setItem("uro_ing_colapsadas", JSON.stringify(colapsadas)); } catch {} }, [colapsadas]);
  const equipoId = contexto !== "personal" ? contexto : null;

  const cargar = async () => {
    setCargando(true);
    const scope = (q) => equipoId ? q.eq("equipo_id", equipoId) : q.eq("user_id", currentUser.id).is("equipo_id", null);
    const [ri, rc] = await Promise.all([
      scope(supabase.from("ingresos").select("*").order("updated_at", { ascending: false })),
      scope(supabase.from("carpetas_ingresos").select("*").order("orden", { ascending: true })),
    ]);
    setIngresos(ri.data || []); setCarpetas(rc.data || []);
    setCargando(false);
  };
  useEffect(() => { cargar(); }, [contexto]);

  // Todas las rutas conocidas: de la tabla + derivadas de ingresos + ancestros.
  const rutasSet = new Set();
  carpetas.forEach(c => c.ruta && rutasSet.add(c.ruta));
  ingresos.forEach(i => { if (i.carpeta) rutasSet.add(i.carpeta); });
  Array.from(rutasSet).forEach(r => { const parts = r.split("/"); for (let k = 1; k < parts.length; k++) rutasSet.add(parts.slice(0, k).join("/")); });
  const todasRutas = Array.from(rutasSet).sort();
  const ordenDe = {}; carpetas.forEach(c => { ordenDe[c.ruta] = c.orden ?? 0; });

  // Árbol de carpetas.
  const raiz = { children: {}, ingresos: [] };
  const nodoDe = (ruta) => {
    if (!ruta) return raiz;
    const parts = ruta.split("/"); let n = raiz;
    parts.forEach((seg, i) => { const path = parts.slice(0, i + 1).join("/"); if (!n.children[seg]) n.children[seg] = { name: seg, path, children: {}, ingresos: [] }; n = n.children[seg]; });
    return n;
  };
  todasRutas.forEach(r => nodoDe(r));
  ingresos.forEach(i => nodoDe(i.carpeta).ingresos.push(i));
  const contar = (node) => node.ingresos.length + Object.values(node.children).reduce((s, c) => s + contar(c), 0);

  const crearCarpeta = async (padre) => {
    const n = window.prompt(padre ? `Nueva subcarpeta dentro de "${padre}":` : "Nueva carpeta (ej: 2026):");
    if (!n || !n.trim()) return;
    const ruta = (padre ? padre + "/" : "") + n.trim().replace(/\//g, "-");
    const hermanos = carpetas.filter(c => c.ruta.split("/").slice(0, -1).join("/") === (padre || ""));
    const orden = hermanos.length ? Math.max(...hermanos.map(h => h.orden || 0)) + 1 : 0;
    const { error } = await supabase.from("carpetas_ingresos").insert({ user_id: currentUser.id, equipo_id: equipoId, ruta, orden });
    if (error) { alert("No se pudo crear la carpeta.\n\nProbablemente falta ejecutar la migración 'migracion_carpetas_ingresos.sql' en Supabase → SQL Editor.\n\nDetalle: " + error.message); return; }
    await cargar();
  };
  const eliminarCarpeta = async (ruta) => {
    if (!confirm(`¿Eliminar la carpeta "${ruta}" y sus subcarpetas? Los ingresos dentro quedarán sin carpeta.`)) return;
    const ids = carpetas.filter(c => c.ruta === ruta || c.ruta.startsWith(ruta + "/")).map(c => c.id);
    if (ids.length) await supabase.from("carpetas_ingresos").delete().in("id", ids);
    const ing = ingresos.filter(i => i.carpeta === ruta || (i.carpeta || "").startsWith(ruta + "/")).map(i => i.id);
    if (ing.length) await supabase.from("ingresos").update({ carpeta: null }).in("id", ing);
    await cargar();
  };
  const moverIngreso = async (ing) => {
    const c = window.prompt("Mover a carpeta (ruta con / para subcarpeta; vacío = sin carpeta).\nExistentes:\n" + (todasRutas.join("\n") || "—"), ing.carpeta || "");
    if (c === null) return;
    await supabase.from("ingresos").update({ carpeta: c.trim() || null }).eq("id", ing.id); await cargar();
  };
  const guardarIngreso = async (datos, carpeta, id) => {
    const fila = { user_id: currentUser.id, equipo_id: equipoId, carpeta: carpeta || null, nombre: datos.nombre || null, ficha: datos.ficha || null, datos, updated_at: new Date().toISOString() };
    if (id) await supabase.from("ingresos").update(fila).eq("id", id); else await supabase.from("ingresos").insert(fila);
    await cargar();
  };
  const eliminar = async (id) => { if (!confirm("¿Eliminar este ingreso?")) return; await supabase.from("ingresos").delete().eq("id", id); await cargar(); };

  const filaIngreso = (ing) => (
    <div key={ing.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--fondo-suave)", borderRadius: 8, padding: "9px 12px", marginBottom: 5 }}>
      <div onClick={() => { setEditando(ing); setModalAbierto(true); }} style={{ flex: 1, cursor: "pointer", minWidth: 0 }}>
        <div style={{ fontSize: "var(--fs-2)", fontWeight: 600, color: "var(--texto)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ing.nombre || "(sin nombre)"}</div>
        <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)" }}>{ing.ficha ? "Ficha " + ing.ficha + " · " : ""}{(ing.updated_at || "").slice(0, 10)}</div>
      </div>
      <button onClick={() => moverIngreso(ing)} title="Mover a carpeta" style={{ background: "none", border: "none", cursor: "pointer", fontSize: "var(--fs-2)" }}>📁</button>
      <button onClick={() => eliminar(ing.id)} title="Eliminar" style={{ background: "none", border: "none", cursor: "pointer", fontSize: "var(--fs-2)", color: "var(--peligro)" }}>🗑</button>
    </div>
  );

  const renderNodo = (node, depth) => {
    const hijos = Object.values(node.children).sort((a, b) => (ordenDe[a.path] ?? 0) - (ordenDe[b.path] ?? 0) || a.name.localeCompare(b.name));
    return hijos.map(h => {
      const col = colapsadas[h.path];
      return (
        <div key={h.path} style={{ marginLeft: depth ? 12 : 0, marginBottom: 3, borderLeft: depth ? "1px solid var(--borde)" : "none", paddingLeft: depth ? 6 : 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 2px" }}>
            <span onClick={() => setColapsadas(p => ({ ...p, [h.path]: !p[h.path] }))} style={{ cursor: "pointer", fontWeight: 700, fontSize: "var(--fs-1)", color: "var(--texto-sec)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{col ? "▸" : "▾"} 📁 {h.name} <span style={{ color: "var(--texto-ter)", fontWeight: 500 }}>({contar(h)})</span></span>
            <button onClick={() => crearCarpeta(h.path)} title="Nueva subcarpeta" style={{ background: "var(--superficie)", border: "0.5px solid var(--borde)", borderRadius: 5, color: "var(--primario)", cursor: "pointer", fontSize: "var(--fs-2)", width: 22, height: 20, lineHeight: 1, padding: 0 }}>＋</button>
            <button onClick={() => eliminarCarpeta(h.path)} title="Eliminar carpeta" style={{ background: "none", border: "none", color: "var(--peligro)", cursor: "pointer", fontSize: "var(--fs-1)" }}>🗑</button>
          </div>
          {!col && <div>{renderNodo(h, depth + 1)}{h.ingresos.map(filaIngreso)}</div>}
        </div>
      );
    });
  };

  return (
    <div style={{ padding: 16 }}>
      {modalAbierto && <IngresoModal currentUser={currentUser} contexto={contexto} ingresoExistente={editando} carpetas={todasRutas} onGuardarIngreso={guardarIngreso} onCreado={() => {}} onClose={() => { setModalAbierto(false); setEditando(null); }} />}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button onClick={() => { setEditando(null); setModalAbierto(true); }} style={{ flex: 1, padding: 11, fontSize: "var(--fs-2)", fontWeight: 700, background: "var(--primario)", color: "var(--texto-inv)", border: "none", borderRadius: 9, cursor: "pointer" }}>➕ Nuevo ingreso</button>
        <button onClick={() => crearCarpeta("")} style={{ padding: "11px 14px", fontSize: "var(--fs-2)", fontWeight: 600, background: "var(--superficie)", color: "var(--primario)", border: "0.5px solid var(--borde)", borderRadius: 9, cursor: "pointer" }}>📁 Nueva carpeta</button>
      </div>
      {cargando ? <div style={{ color: "var(--texto-ter)", fontSize: "var(--fs-2)" }}>Cargando…</div> :
        (ingresos.length === 0 && todasRutas.length === 0) ? <div style={{ color: "var(--texto-ter)", fontSize: "var(--fs-2)", textAlign: "center", padding: "20px 0" }}>Aún no hay ingresos guardados.</div> :
        <>
          {renderNodo(raiz, 0)}
          {raiz.ingresos.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: "var(--fs-1)", fontWeight: 700, color: "var(--texto-sec)", padding: "4px 2px" }}>Sin carpeta ({raiz.ingresos.length})</div>
              {raiz.ingresos.map(filaIngreso)}
            </div>
          )}
        </>
      }
    </div>
  );
}

// ─── Orden de transfusión (HBV): pre-llena desde la ficha y genera PDF ───
const PRODUCTOS_TX = ["Sangre total", "Glóbulos rojos", "Plasma", "Plaquetas", "Crioprecipitado", "Autotransfusión", "Otros"];
const CARACTER_TX = ["Inmediata (sin pruebas de compatibilidad)", "Urgente (entre 1 y 4 horas)", "Dentro del día", "Otros"];
const PREVISIONES_TX = ["FONASA A", "FONASA B", "FONASA C", "FONASA D", "ISAPRE", "PRAIS", "Otra"];

function OrdenTransfusionModal({ paciente, currentUser, examenes, onClose }) {
  // Últimos valores de Hb y plaquetas desde los exámenes (ya vienen ordenados desc).
  const ultimoParam = (key) => {
    for (const ex of (examenes || [])) {
      const v = ex?.datos_estructurados?.parametros?.[key];
      if (v !== undefined && v !== "") return String(v);
    }
    return "";
  };
  const [prevision, setPrevision] = useState("");
  const [establecimiento, setEstablecimiento] = useState("HOSPITAL CLÍNICO REGIONAL VALDIVIA");
  const [peso, setPeso] = useState("");
  const [motivo, setMotivo] = useState("");
  const [diagnostico, setDiagnostico] = useState(paciente.diagnostico || "");
  const [hb, setHb] = useState(ultimoParam("hb"));
  const [plaquetas, setPlaquetas] = useState(ultimoParam("plaquetas"));
  const [productos, setProductos] = useState({}); // { nombre: { on, cant } }
  const [caracter, setCaracter] = useState("");
  const [caracterOtro, setCaracterOtro] = useState("");
  const [txPrevias, setTxPrevias] = useState("");
  const [reacciones, setReacciones] = useState("");
  const [reaccionTipo, setReaccionTipo] = useState("");
  const [generando, setGenerando] = useState(false);
  const [msg, setMsg] = useState("");

  const toggleProd = (nom) => setProductos(p => ({ ...p, [nom]: { on: !p[nom]?.on, cant: p[nom]?.cant || "" } }));
  const setCantProd = (nom, cant) => setProductos(p => ({ ...p, [nom]: { on: true, cant } }));

  const inp = { width: "100%", padding: "8px 10px", fontSize: "var(--fs-2)", border: "0.5px solid var(--borde)", borderRadius: 7, background: "var(--superficie)", color: "var(--texto)", boxSizing: "border-box", marginBottom: 8 };
  const lbl = { fontSize: "var(--fs-0)", fontWeight: 600, color: "var(--texto-sec)", display: "block", marginBottom: 3 };

  const generarPDF = async () => {
    const algunProd = Object.values(productos).some(p => p?.on);
    if (!algunProd) { setMsg("⚠️ Marca al menos un producto a transfundir."); return; }
    if (!caracter) { setMsg("⚠️ Indica el carácter de la transfusión."); return; }
    setGenerando(true); setMsg("");
    try {
      let jsPDF;
      try { jsPDF = (await import("jspdf")).jsPDF; }
      catch { setMsg("No se pudo cargar el generador de PDF. Cierra y reabre la app."); setGenerando(false); return; }
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const W = doc.internal.pageSize.getWidth();
      const M = 14;
      let y = 14;

      // Encabezado institucional
      doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(30, 30, 30);
      doc.text("MINISTERIO DE SALUD", M, y); y += 3.6;
      doc.text("SERVICIO DE SALUD VALDIVIA", M, y); y += 3.6;
      doc.text(establecimiento.toUpperCase().slice(0, 48), M, y); y += 3.6;
      doc.text("UNIDAD DE BANCO DE SANGRE", M, y);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(90, 90, 90);
      doc.text("USO BANCO DE SANGRE", W - M, 14, { align: "right" });
      doc.rect(W - M - 34, 15.5, 34, 8);
      y += 6;

      // Barra roja de título
      doc.setFillColor(200, 30, 30); doc.rect(M, y, W - 2 * M, 8, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(255, 255, 255);
      doc.text("ORDEN DE TRANSFUSIÓN", W / 2, y + 5.6, { align: "center" });
      y += 11;
      doc.setFillColor(200, 30, 30); doc.rect(M, y, 62, 6, "F");
      doc.setFontSize(9); doc.setTextColor(255, 255, 255);
      doc.text("USO MÉDICO EXCLUSIVO", M + 2, y + 4.2);
      y += 10;

      doc.setTextColor(20, 20, 20);
      const campo = (label, valor, x, ancho, yy) => {
        doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(90, 90, 90);
        doc.text(label, x, yy);
        doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.2);
        doc.roundedRect(x, yy + 1.5, ancho, 7, 1, 1);
        doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(20, 20, 20);
        if (valor) doc.text(String(valor).slice(0, Math.floor(ancho / 1.6)), x + 2, yy + 6.3);
      };
      const full = W - 2 * M;
      // Nombre
      campo("NOMBRE", paciente.iniciales || "", M, full, y); y += 11;
      // Servicio / Sala-Pabellón / Cama / Hora / Fecha
      const w5 = (full - 4 * 3) / 5;
      const hoy = new Date();
      campo("SERVICIO", paciente.servicio || "", M, w5, y);
      campo("SALA/PABELLÓN", "", M + (w5 + 3), w5, y);
      campo("CAMA/N° PAB.", paciente.cama || "", M + 2 * (w5 + 3), w5, y);
      campo("HORA", `${String(hoy.getHours()).padStart(2, "0")}:${String(hoy.getMinutes()).padStart(2, "0")}`, M + 3 * (w5 + 3), w5, y);
      campo("FECHA", hoy.toLocaleDateString("es-CL"), M + 4 * (w5 + 3), w5, y); y += 11;
      // Diagnóstico / N° Ficha o RUT
      campo("DIAGNÓSTICO", diagnostico, M, full * 0.62, y);
      campo("N° FICHA O RUT", paciente.ficha_clinica || paciente.rut || "", M + full * 0.62 + 3, full * 0.38 - 3, y); y += 11;
      // Motivo / Previsión
      campo("MOTIVO DE LA TRANSFUSIÓN", motivo, M, full * 0.72, y);
      campo("PREVISIÓN", prevision, M + full * 0.72 + 3, full * 0.28 - 3, y); y += 11;
      // Sexo / Edad / Plaquetas / Hb / Peso
      campo("SEXO", paciente.sexo || "", M, w5, y);
      campo("EDAD", paciente.edad ? `${paciente.edad} años` : "", M + (w5 + 3), w5, y);
      campo("RCTO. PLAQUETAS", plaquetas, M + 2 * (w5 + 3), w5, y);
      campo("Hb", hb, M + 3 * (w5 + 3), w5, y);
      campo("PESO", peso ? `${peso} kg` : "", M + 4 * (w5 + 3), w5, y); y += 12;

      // Producto y cantidad (izq) · Carácter (der), con divisoria vertical
      const colY = y; const midX = W / 2;
      doc.setDrawColor(160, 160, 160); doc.setLineWidth(0.2); doc.line(midX, colY - 3, midX, colY + 46);
      doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(40, 40, 40);
      doc.text("PRODUCTO  Y  CANTIDAD", M, y);
      doc.text("CARÁCTER DE LA TRANSFUSIÓN", midX + 5, y);
      let yl = y + 6; doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
      const check = (x, yy, on) => { doc.setDrawColor(80, 80, 80); doc.rect(x, yy - 3, 3.5, 3.5); if (on) { doc.setFont("helvetica", "bold"); doc.text("X", x + 0.55, yy - 0.3); doc.setFont("helvetica", "normal"); } };
      PRODUCTOS_TX.forEach(nom => {
        const p = productos[nom];
        check(M, yl, p?.on); doc.setTextColor(20, 20, 20); doc.text(nom, M + 5.5, yl);
        if (nom !== "Autotransfusión") { doc.setDrawColor(180, 180, 180); doc.line(M + 42, yl + 0.5, M + 56, yl + 0.5); if (p?.on && p.cant) doc.text(String(p.cant), M + 45, yl - 0.3); doc.text("U", M + 57.5, yl); }
        yl += 6.4;
      });
      let yr = colY + 6;
      CARACTER_TX.forEach(c => {
        const on = caracter === c;
        check(midX + 5, yr, on);
        doc.text(c === "Otros" && caracterOtro ? `Otros: ${caracterOtro}` : c, midX + 10.5, yr, { maxWidth: (W / 2) - M - 12 });
        yr += 8;
      });
      doc.setFont("helvetica", "bold"); doc.setFontSize(6.6); doc.setTextColor(120, 120, 120);
      doc.text("*EL CARÁCTER INMEDIATA ES DE EXCLUSIVA RESPONSABILIDAD DEL MÉDICO QUE INDICA", midX + 5, yr + 1, { maxWidth: (W / 2) - M - 8 });
      y = Math.max(yl, yr + 6) + 3;

      // Aporto donantes
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(20, 20, 20);
      doc.text("APORTO DONANTES", M, y); check(M + 34, y, false); doc.text("SÍ", M + 39, y); check(M + 48, y, false); doc.text("NO", M + 53, y);
      y += 8;

      // Médico solicitante + Código
      doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.2);
      doc.roundedRect(M, y, full * 0.66, 12, 1, 1); doc.roundedRect(M + full * 0.66 + 3, y, full * 0.34 - 3, 12, 1, 1);
      doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(90, 90, 90);
      doc.text("NOMBRE Y FIRMA MÉDICO SOLICITANTE", M + 1.5, y - 1.5);
      doc.text("CÓDIGO", M + full * 0.66 + 5, y - 1.5);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(20, 20, 20);
      doc.text(currentUser?.nombre || "", M + 2, y + 5);
      y += 17;

      // Transfusiones previas / reacciones adversas
      doc.setFontSize(8);
      check(M, y, txPrevias === "si"); doc.text("TRANSFUSIONES PREVIAS  SÍ", M + 5.5, y);
      check(M + 52, y, txPrevias === "no"); doc.text("NO", M + 57.5, y);
      check(M + 70, y, reacciones === "si"); doc.text("REACCIONES ADVERSAS  SÍ", M + 75.5, y);
      check(M + 120, y, reacciones === "no"); doc.text("NO", M + 125.5, y);
      doc.text("TIPO:", M + 135, y); doc.setDrawColor(180, 180, 180); doc.line(M + 143, y + 0.5, W - M, y + 0.5);
      if (reacciones === "si" && reaccionTipo) doc.text(reaccionTipo.slice(0, 20), M + 145, y - 0.3);
      y += 8;

      // Nombre legible del responsable de la toma de muestra + Código
      doc.setDrawColor(150, 150, 150);
      doc.roundedRect(M, y, full * 0.66, 11, 1, 1); doc.roundedRect(M + full * 0.66 + 3, y, full * 0.34 - 3, 11, 1, 1);
      doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(90, 90, 90);
      doc.text("NOMBRE LEGIBLE DEL RESPONSABLE DE LA TOMA DE MUESTRA", M + 1.5, y - 1.5);
      doc.text("CÓDIGO", M + full * 0.66 + 5, y - 1.5);
      y += 16;

      // NOTA final (en negrita, como la plantilla)
      doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(20, 20, 20);
      doc.text("NOTA: CUALQUIER SOLICITUD INCOMPLETA O ILEGIBLE SERÁ RECHAZADA POR EL BANCO DE SANGRE", M, Math.max(y, 285), { maxWidth: full });

      const nombreArch = `orden_transfusion_${(paciente.iniciales || "paciente").replace(/\s+/g, "_")}.pdf`;
      doc.save(nombreArch);
      setMsg("✓ PDF generado.");
    } catch (e) {
      setMsg("Error al generar el PDF: " + (e?.message || e));
    }
    setGenerando(false);
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--fondo)", border: "0.5px solid var(--borde)", borderRadius: 14, padding: 18, width: "100%", maxWidth: 640, maxHeight: "88vh", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: "var(--fs-3)", fontWeight: 700, color: "var(--texto)" }}>🩸 Orden de transfusión</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--texto-ter)", lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)", marginBottom: 12, background: "var(--fondo-suave)", padding: "8px 10px", borderRadius: 7 }}>
          {paciente.iniciales} · {paciente.edad} años · {paciente.sexo} · Cama {paciente.cama || "—"} · {paciente.servicio}
        </div>

        <label style={lbl}>Hospital / establecimiento</label>
        <input value={establecimiento} onChange={e => setEstablecimiento(e.target.value)} style={inp} />
        <label style={lbl}>Diagnóstico</label>
        <input value={diagnostico} onChange={e => setDiagnostico(e.target.value)} style={inp} />
        <label style={lbl}>Motivo de la transfusión</label>
        <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ej: anemia sintomática, sangrado…" style={inp} />
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}><label style={lbl}>Hb (g/dL)</label><input value={hb} onChange={e => setHb(e.target.value)} inputMode="decimal" style={inp} /></div>
          <div style={{ flex: 1 }}><label style={lbl}>Plaquetas</label><input value={plaquetas} onChange={e => setPlaquetas(e.target.value)} inputMode="numeric" style={inp} /></div>
          <div style={{ flex: 1 }}><label style={lbl}>Peso (kg)</label><input value={peso} onChange={e => setPeso(e.target.value)} inputMode="decimal" style={inp} /></div>
        </div>
        <label style={lbl}>Previsión</label>
        <select value={prevision} onChange={e => setPrevision(e.target.value)} style={inp}>
          <option value="">—</option>
          {PREVISIONES_TX.map(o => <option key={o} value={o}>{o}</option>)}
        </select>

        <div style={{ fontSize: "var(--fs-1)", fontWeight: 700, color: "var(--primario)", margin: "6px 0 6px" }}>Producto y cantidad</div>
        {PRODUCTOS_TX.map(nom => (
          <div key={nom} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, fontSize: "var(--fs-2)", color: "var(--texto)", cursor: "pointer" }}>
              <input type="checkbox" checked={!!productos[nom]?.on} onChange={() => toggleProd(nom)} />
              {nom}
            </label>
            {productos[nom]?.on && nom !== "Autotransfusión" && (
              <input value={productos[nom]?.cant || ""} onChange={e => setCantProd(nom, e.target.value)} placeholder="U" inputMode="numeric" style={{ width: 60, padding: "6px 8px", fontSize: "var(--fs-2)", border: "0.5px solid var(--borde)", borderRadius: 6, background: "var(--superficie)", color: "var(--texto)" }} />
            )}
          </div>
        ))}

        <div style={{ fontSize: "var(--fs-1)", fontWeight: 700, color: "var(--primario)", margin: "10px 0 6px" }}>Carácter</div>
        {CARACTER_TX.map(c => (
          <label key={c} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5, fontSize: "var(--fs-2)", color: "var(--texto)", cursor: "pointer" }}>
            <input type="radio" name="caracterTx" checked={caracter === c} onChange={() => setCaracter(c)} />
            {c}
          </label>
        ))}
        {caracter === "Otros" && (
          <input value={caracterOtro} onChange={e => setCaracterOtro(e.target.value)} placeholder="Especificar carácter" style={{ ...inp, marginTop: 6 }} />
        )}

        <div style={{ display: "flex", gap: 16, margin: "10px 0" }}>
          <div style={{ fontSize: "var(--fs-1)", color: "var(--texto)" }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Transf. previas</div>
            <label style={{ marginRight: 10 }}><input type="radio" name="txp" checked={txPrevias === "si"} onChange={() => setTxPrevias("si")} /> Sí</label>
            <label><input type="radio" name="txp" checked={txPrevias === "no"} onChange={() => setTxPrevias("no")} /> No</label>
          </div>
          <div style={{ fontSize: "var(--fs-1)", color: "var(--texto)" }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Reacciones adversas</div>
            <label style={{ marginRight: 10 }}><input type="radio" name="rxa" checked={reacciones === "si"} onChange={() => setReacciones("si")} /> Sí</label>
            <label><input type="radio" name="rxa" checked={reacciones === "no"} onChange={() => setReacciones("no")} /> No</label>
          </div>
        </div>
        {reacciones === "si" && (
          <input value={reaccionTipo} onChange={e => setReaccionTipo(e.target.value)} placeholder="Tipo de reacción" style={inp} />
        )}

        {msg && <div style={{ fontSize: "var(--fs-1)", color: msg.startsWith("✓") ? "var(--exito)" : "var(--peligro)", margin: "4px 0 8px" }}>{msg}</div>}
        <button onClick={generarPDF} disabled={generando} style={{ width: "100%", padding: 12, fontSize: "var(--fs-2)", fontWeight: 600, background: "var(--primario)", color: "var(--texto-inv)", border: "none", borderRadius: 8, cursor: generando ? "default" : "pointer", opacity: generando ? 0.6 : 1, marginTop: 4 }}>{generando ? "Generando…" : "📄 Generar orden en PDF"}</button>
      </div>
    </div>
  );
}

// Ordena camas "de arriba hacia abajo": numérico natural (2 antes que 10) con
// respaldo alfabético; las camas vacías/sin asignar quedan al final.
function compararCama(a, b) {
  const ca = (a?.cama ?? "").toString().trim();
  const cb = (b?.cama ?? "").toString().trim();
  if (!ca && !cb) return 0;
  if (!ca) return 1;
  if (!cb) return -1;
  return ca.localeCompare(cb, "es", { numeric: true, sensitivity: "base" });
}

function PacientesPanel({ pacientes, setPacientes, currentUser, contexto, equipos, misServiciosLista, setMisServiciosLista, loadingPacientes, setLoadingPacientes, toolsOpen, soloLectura }) {
  // Plantillas SOAP completas
// Garantiza que datos_estructurados sea siempre un objeto (Supabase a veces lo entrega como texto)
function normalizarExamen(ex) {
  if (!ex) return ex;
  let de = ex.datos_estructurados;
  if (typeof de === "string") {
    try { de = JSON.parse(de); } catch { de = {}; }
  }
  if (!de || typeof de !== "object") de = {};
  return { ...ex, datos_estructurados: de };
}

const PARAMETROS_LAB = {
  "Hemograma": [
    { key: "hb", label: "Hb", unidad: "g/dL" },
    { key: "hto", label: "Hto", unidad: "%" },
    { key: "leucocitos", label: "Leucocitos", unidad: "/mm³" },
    { key: "plaquetas", label: "Plaquetas", unidad: "/mm³" },
    { key: "neutrofilos", label: "Neutrófilos", unidad: "%" },
    { key: "linfocitos", label: "Linfocitos", unidad: "%" },
    { key: "vcm", label: "VCM", unidad: "fL" },
  ],
  "Función renal": [
    { key: "crea", label: "Creatinina", unidad: "mg/dL" },
    { key: "bun", label: "BUN", unidad: "mg/dL" },
    { key: "vfg", label: "VFG", unidad: "mL/min" },
    { key: "na", label: "Na", unidad: "mEq/L" },
    { key: "k", label: "K", unidad: "mEq/L" },
    { key: "cl", label: "Cl", unidad: "mEq/L" },
  ],
  "Coagulación": [
    { key: "inr", label: "INR", unidad: "" },
    { key: "tp", label: "TP", unidad: "%" },
    { key: "ttpa", label: "TTPA", unidad: "seg" },
    { key: "fibrinogeno", label: "Fibrinógeno", unidad: "mg/dL" },
  ],
  "PCR": [
    { key: "pcr", label: "PCR", unidad: "mg/L" },
  ],
  "ELP": [
    { key: "na", label: "Na", unidad: "mEq/L" },
    { key: "k", label: "K", unidad: "mEq/L" },
    { key: "cl", label: "Cl", unidad: "mEq/L" },
  ],
};

// Uropatógenos frecuentes (urocultivo / cultivo de orina o litiasis) para sugerencias.
const UROPATOGENOS = [
  "Escherichia coli", "Klebsiella pneumoniae", "Proteus mirabilis", "Enterococcus faecalis",
  "Pseudomonas aeruginosa", "Staphylococcus saprophyticus", "Enterobacter cloacae",
  "Streptococcus agalactiae", "Staphylococcus aureus", "Candida albicans", "Cultivo negativo",
];
// Antibióticos frecuentes para el antibiograma.
const ANTIBIOTICOS = [
  "Ampicilina", "Amoxicilina/clavulánico", "Cefazolina", "Ceftriaxona", "Ceftazidima", "Cefepime",
  "Ciprofloxacino", "Levofloxacino", "Nitrofurantoína", "Fosfomicina", "Gentamicina", "Amikacina",
  "Cotrimoxazol (TMP/SMX)", "Piperacilina/tazobactam", "Ertapenem", "Meropenem", "Vancomicina", "Linezolid",
];
const SENSIBILIDAD = ["Sensible", "Intermedio", "Resistente"];

// Dirección clínicamente desfavorable de cada parámetro, para las flechas de tendencia:
//   "altoMalo" → subir es malo (rojo ▲, verde ▼) · "bajoMalo" → bajar es malo (rojo ▼, verde ▲)
// Los que no figuran aquí se muestran en gris (neutro), sin juzgar dirección.
const SEMANTICA_LAB = {
  pcr: "altoMalo", crea: "altoMalo", bun: "altoMalo", leucocitos: "altoMalo", neutrofilos: "altoMalo",
  hb: "bajoMalo", hto: "bajoMalo", plaquetas: "bajoMalo", vfg: "bajoMalo", linfocitos: "bajoMalo",
};
function _numLab(v) {
  if (v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace(",", ".").replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? null : n;
}

const PLANTILLAS_SOAP = {
  "Post-operatorio sin complicaciones": {
    subjetivo: "Paciente refiere dolor controlado con analgesia habitual. Sin náuseas ni vómitos. Tolera vía oral. Diuresis espontánea conservada.",
    objetivo: "Hemodinámicamente estable. Afebril. Signos vitales: PA __/__, FC __, FR __, SatO2 __%. Diuresis __ ml en últimas 24h.",
    examen: "Conciente, orientado, cooperador. Mucosas húmedas y rosadas. Cardiopulmonar sin alteraciones. Abdomen blando, depresible, indoloro. Herida operatoria limpia, sin signos de infección. Catéter urinario permeable con orina clara.",
    indicaciones: "1. Continuar régimen liviano.\n2. Analgesia con paracetamol 1g c/8h + ketoprofeno SOS.\n3. Hidratación oral según tolerancia.\n4. Movilización precoz.\n5. Curación diaria de herida operatoria.\n6. Control de evolución mañana."
  },
  "Sepsis urinaria en evolución": {
    subjetivo: "Paciente refiere mejoría sintomática parcial. Disminución de fiebre. Sin disuria ni poliaquiuria actualmente.",
    objetivo: "Tendencia a mejoría. Tº máxima en últimas 24h: __°C. PCR/leucocitos en descenso. Diuresis adecuada.",
    examen: "Conciente, orientado. Mucosas húmedas. Cardiopulmonar sin alteraciones. Abdomen blando, sin signos peritoneales. Puño percusión renal negativa bilateral.",
    indicaciones: "1. Continuar antibioticoterapia EV según pauta.\n2. Hidratación parenteral.\n3. Control de signos vitales c/4h.\n4. Solicitar control de exámenes en 24h.\n5. Reevaluar continuación EV vs paso a oral."
  },
  "Litiasis ureteral con catéter doble J": {
    subjetivo: "Paciente refiere mejoría del dolor lumbar. Disuria leve persistente. Sin fiebre. Diuresis conservada.",
    objetivo: "Hemodinámicamente estable. Afebril. Sin alteraciones electrolíticas. Función renal conservada.",
    examen: "Conciente, cooperador. Cardiopulmonar sin alteraciones. Abdomen blando, depresible. Puño percusión renal levemente sensible en lado afectado.",
    indicaciones: "1. Tamsulosina 0,4 mg/día.\n2. Analgesia con AINEs SOS.\n3. Hidratación oral abundante.\n4. Control en consultorio en 4 semanas para retiro de doble J.\n5. Imagen de control."
  },
  "Hematuria en estudio": {
    subjetivo: "Paciente refiere persistencia de hematuria macroscópica. Sin dolor lumbar ni cólico. Diuresis conservada.",
    objetivo: "Hemodinámicamente estable. Hb estable. Función renal conservada.",
    examen: "Conciente, orientado. Mucosas algo pálidas. Cardiopulmonar normal. Abdomen blando, indoloro. Sin globo vesical.",
    indicaciones: "1. Mantener hidratación abundante.\n2. Solicitar cistoscopia.\n3. Solicitar UroTAC con contraste.\n4. Citología urinaria seriada x3.\n5. Control con urocultivo."
  }
};

// Sugerencias breves por sección
const SUGERENCIAS_SOAP = {
  subjetivo: [
    "Paciente refiere dolor lumbar moderado",
    "Asintomático, sin molestias",
    "Refiere disuria y poliaquiuria",
    "Náuseas, sin vómitos",
    "Tolera vía oral, diuresis conservada",
    "Refiere fiebre nocturna",
  ],
  objetivo: [
    "Hemodinámicamente estable, afebril",
    "PA __/__, FC __, FR __, T° __, SatO2 __%",
    "Diuresis __ ml en últimas 24h",
    "Hb estable, función renal conservada",
    "PCR en descenso, leucocitos normales",
  ],
  examen: [
    "Conciente, orientado, cooperador",
    "Mucosas húmedas y rosadas",
    "Cardiopulmonar sin alteraciones",
    "Abdomen blando, depresible, indoloro",
    "Puño percusión renal negativa bilateral",
    "Herida operatoria limpia, sin signos de infección",
    "Catéter urinario permeable con orina clara",
  ],
  indicaciones: [
    "Continuar tratamiento actual",
    "Analgesia con paracetamol 1g c/8h",
    "Hidratación abundante (>2L/día)",
    "Régimen liviano",
    "Movilización precoz",
    "Curación diaria de herida",
    "Control en 24h",
    "Solicitar exámenes de control",
  ]
};
  const [vista, setVista] = useState("lista");
  const [seleccionado, setSeleccionado] = useState(null);
  useBackClose(vista !== "lista", () => { setVista("lista"); setSeleccionado(null); });
  const [evoluciones, setEvoluciones] = useState([]);
  const [examenes, setExamenes] = useState([]);
  const [filtroServicio, setFiltroServicio] = useState("todos");
  const [filtroEstado, setFiltroEstado] = useState("activo");
  const [error, setError] = useState("");
  const [editandoFicha, setEditandoFicha] = useState(false);
  const [otroAntecedente, setOtroAntecedente] = useState("");
  const [editandoHistoria, setEditandoHistoria] = useState(false);
  const [historiaDraft, setHistoriaDraft] = useState("");
  const [mostrarEvosAntiguas, setMostrarEvosAntiguas] = useState(false);
  const [mostrarExAntiguos, setMostrarExAntiguos] = useState(false);
  const [pendientesPaciente, setPendientesPaciente] = useState([]);
  const [nuevoPendientePac, setNuevoPendientePac] = useState({ texto: "", prioridad: "normal", fecha_objetivo: "", encargados: [] });
  const [abrirFormPendiente, setAbrirFormPendiente] = useState(false);
  const [abrirFormEvo, setAbrirFormEvo] = useState(false);
  const [abrirFormExamen, setAbrirFormExamen] = useState(false);
  const inputFotoIngresoRef = useRef(null);          // input de foto para "nuevo por foto"
  const inputFotoFichaRef = useRef(null);            // input de foto para "agregar ingreso" en la ficha
  const inputFotoMenuRef = useRef(null);             // input de foto para "agregar ingreso" desde el menú (mantener presionado)
  const fotoMenuTargetRef = useRef(null);            // paciente destino cuando el ingreso se agrega desde el menú
  const [fotoMenuCargando, setFotoMenuCargando] = useState(false);
  const [extrayendoIngreso, setExtrayendoIngreso] = useState(false);
  const [extraccionMsg, setExtraccionMsg] = useState("");
const [editForm, setEditForm] = useState({});
const [formCirugia, setFormCirugia] = useState(null); // {fecha, nombre} cuando se está agregando una cirugía

  // Form de nuevo paciente
  const [nuevo, setNuevo] = useState({
    iniciales: "", ficha_clinica: "", rut: "", edad: "", sexo: "M", cama: "", servicio: "",
    diagnostico: "", plan_manejo: "", historia: "", fecha_ingreso: new Date().toISOString().slice(0, 10)
  });

  // Form de evoluciones
  const [evoLibre, setEvoLibre] = useState("");
  const [evoEstructurada, setEvoEstructurada] = useState({ subjetivo: "", objetivo: "", examen: "", indicaciones: "" });
  const [diuresis, setDiuresis] = useState({ cantidad: "", via: "", caracteristicas: "" });
  const [drenaje, setDrenaje] = useState({ activo: false, tipo: "", aspiracion: "", localizacion: "", cantidad: "", caracteristicas: "" });
  const [seccionAbierta, setSeccionAbierta] = useState(null); // qué bloque de sugerencias está desplegado
  const [tipoEvo, setTipoEvo] = useState("estructurada");

  // Form de exámenes
  const [nuevoEx, setNuevoEx] = useState({ tipo: "Laboratorio", nombre: "", resultado: "", fecha_examen: new Date().toISOString().slice(0, 10), pirads: "", pesoProstatico: "", lugar: "", tipoCultivo: "", germen: "", germenOtro: "" });
  const [paramsLab, setParamsLab] = useState({}); // valores de los parámetros numéricos del lab seleccionado
  const [litiasis, setLitiasis] = useState([]); // lista de litiasis agregadas
  const [formLitiasis, setFormLitiasis] = useState({ ubicacion: "", tercio: "", lateralidad: "", tamano: "", uh: "" });
  const [tumores, setTumores] = useState([]); // lista de tumores agregados
  const [formTumor, setFormTumor] = useState({ organo: "", sublocalizacion: "", tamano: "" });
  const [antibiograma, setAntibiograma] = useState([]); // filas {atb, sens} del antibiograma
  const [formAtb, setFormAtb] = useState({ atb: "", sens: "" });
  const [ordenTxAbierta, setOrdenTxAbierta] = useState(false); // modal orden de transfusión
  const [fotoExamenesAbierto, setFotoExamenesAbierto] = useState(false); // modal exámenes desde foto
  const [plantillasAbierto, setPlantillasAbierto] = useState(false); // modal plantillas de exámenes
  const [serviciosMenuOpen, setServiciosMenuOpen] = useState(false); // submenú desplegable del botón "Servicios ▾"
  const servBtnRef = useRef(null); // posición real del botón, para que el menú (position:fixed) no se recorte
  const [verCargaMedicos, setVerCargaMedicos] = useState(false); // resumen de pacientes por médico
  // Nombre de un miembro del equipo a partir de su user_id
  const nombreMiembroPac = (id) => {
    if (id === currentUser.id) return currentUser.nombre + " (tú)";
    const m = miembrosEquipo.find(x => x.perfiles?.id === id || x.user_id === id);
    return m?.perfiles?.nombre || m?.nombre || "Miembro";
  };

  // Servicios
  const [nuevoServicio, setNuevoServicio] = useState("");
  const [serviciosEquipo, setServiciosEquipo] = useState([]);
  // Crear servicio directamente desde el formulario de paciente
  const [creandoServicioInline, setCreandoServicioInline] = useState(false);
  const [nuevoServicioInline, setNuevoServicioInline] = useState("");
  const [guardandoServicioInline, setGuardandoServicioInline] = useState(false);
  // ─── Reordenar servicios arrastrándolos (mouse y táctil) ───
  const serviciosListRef = useRef(null);
  const [dragServicio, setDragServicio] = useState(null); // { id, dy } → el ítem "flota" siguiendo el dedo
  const dragInfo = useRef(null);
  const iniciarDragServicio = (e, servicio, idx) => {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    const cont = serviciosListRef.current;
    const filas = cont ? Array.from(cont.children) : [];
    const alto = filas[0] ? filas[0].getBoundingClientRect().height + 6 : 48; // alto de fila + gap
    dragInfo.current = { id: servicio.id, desdeIdx: idx, aIdx: idx, y0: e.clientY, alto };
    setDragServicio({ id: servicio.id, dy: 0 });

    const largoLista = (esEquipo ? serviciosEquipo : misServiciosLista).length;
    const onMove = (ev) => {
      const d = dragInfo.current;
      if (!d) return;
      const dy = ev.clientY - d.y0;
      // ¿Sobre qué índice está flotando ahora?
      let destino = d.desdeIdx + Math.round(dy / d.alto);
      destino = Math.max(0, Math.min(largoLista - 1, destino));
      d.aIdx = destino;
      setDragServicio({ id: d.id, dy });
    };
    const onUp = async () => {
      const d = dragInfo.current;
      dragInfo.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDragServicio(null);
      if (!d || d.aIdx === d.desdeIdx) return;
      if (esEquipo) {
        // Orden COMPARTIDO: se reordena y se persiste en el servidor para todos.
        let nuevaLista;
        setServiciosEquipo(prev => {
          const nueva = [...prev];
          const [item] = nueva.splice(d.desdeIdx, 1);
          nueva.splice(d.aIdx, 0, item);
          nuevaLista = nueva;
          return nueva;
        });
        if (nuevaLista) {
          const r = await reordenarServiciosEquipo(nuevaLista);
          if (!r.ok) alert("No se pudo guardar el orden: " + r.error);
        }
      } else {
        setMisServiciosLista(prev => {
          const nueva = [...prev];
          const [item] = nueva.splice(d.desdeIdx, 1);
          nueva.splice(d.aIdx, 0, item);
          guardarOrdenServicios(nueva);
          return nueva;
        });
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };
const [miembrosEquipo, setMiembrosEquipo] = useState([]);
  const esEquipo = contexto !== "personal";
  const equipoActual = esEquipo ? equipos.find(e => e.id === contexto) : null;

  // Cargar pacientes según contexto
  const cargarPacientes = async () => {
    setLoadingPacientes(true);
    const cacheKey = `pacientes:${currentUser.id}:${contexto}`;
    // 1) Pinta al instante lo último guardado (clave para rondas sin señal);
    //    la red, si hay, refresca en segundo plano.
    let pinto = false;
    try {
      const cache = await leerSnapshot(cacheKey);
      if (Array.isArray(cache) && cache.length) { setPacientes(cache); pinto = true; }
    } catch {}
    // Si ya pintamos desde caché, quitamos el spinner de inmediato (no esperamos la red).
    if (pinto) setLoadingPacientes(false);
    try {
      if (contexto === "personal") {
        // "Mis Pacientes": personales + donde soy encargado en cualquier equipo
        const personales = await listarPacientes(currentUser.id, "personal");
        let combinados = personales.ok ? [...personales.pacientes] : [];
        // Mis equipos
        const misEquipos = equipos.filter(e =>
          e.dueno_id === currentUser.id ||
          e.miembros_equipo?.some(m => m.user_id === currentUser.id)
        );
        for (const eq of misEquipos) {
          const res = await listarPacientes(currentUser.id, eq.id);
          if (res.ok) {
            const asignados = res.pacientes.filter(p =>
              Array.isArray(p.encargados) && p.encargados.includes(currentUser.id)
            );
            // Evitar duplicados por id
            asignados.forEach(p => {
              if (!combinados.some(x => x.id === p.id)) combinados.push(p);
            });
          }
        }
        // Solo sobrescribimos (y cacheamos) si la red respondió; si no, queda lo de caché.
        if (personales.ok) { setPacientes(combinados); guardarSnapshot(cacheKey, combinados); }
      } else {
        const result = await listarPacientes(currentUser.id, contexto);
        if (result.ok) { setPacientes(result.pacientes); guardarSnapshot(cacheKey, result.pacientes); }
      }
    } catch {
      // Sin red: nos quedamos con lo hidratado desde caché.
    }
    if (!pinto) setLoadingPacientes(false);
  };

  // Cargar servicios del equipo si estoy en contexto equipo
  const cargarServiciosEquipo = async () => {
    if (esEquipo) {
      const kServ = `servicios:${contexto}`;
      try { const c = await leerSnapshot(kServ); if (Array.isArray(c) && c.length) setServiciosEquipo(c); } catch {}
      try {
        const result = await listarServiciosEquipo(contexto);
        if (result.ok) { setServiciosEquipo(result.servicios); guardarSnapshot(kServ, result.servicios); }
      } catch {}
    }
  };
// Cargar miembros del equipo (para asignar encargados)
const cargarMiembrosEquipo = async () => {
  if (esEquipo) {
    const result = await listarMiembros(contexto);
    if (result.ok) setMiembrosEquipo(result.miembros);
  }
};
  useEffect(() => {
    cargarPacientes();
    cargarServiciosEquipo();
    cargarMiembrosEquipo();
  }, [contexto, equipos]);

  // Lista de servicios del contexto actual (objetos {id, nombre, orden})
  const serviciosActivos = esEquipo ? serviciosEquipo : misServiciosLista;
  // Nombres para el desplegable del formulario.
  // Se combina la tabla servicios_equipo con los servicios que YA existen escritos
  // en pacientes reales (histórico, texto libre) — así el desplegable no aparece
  // vacío solo porque nadie migró/creó los servicios formalmente todavía.
  const serviciosDeUso = useMemo(() => {
    const set = new Set();
    pacientes.forEach(p => { if (p.servicio && p.servicio.trim()) set.add(p.servicio.trim()); });
    return Array.from(set);
  }, [pacientes]);
  const serviciosDisponibles = useMemo(() => {
    const set = new Set(serviciosActivos.map(s => s.nombre));
    serviciosDeUso.forEach(s => set.add(s));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [serviciosActivos, serviciosDeUso]);
  // Servicios que están en uso por pacientes pero aún no formalizados en la tabla del equipo
  const serviciosSinFormalizar = esEquipo
    ? serviciosDeUso.filter(s => !serviciosActivos.some(x => x.nombre === s))
    : [];

  // Filtrar pacientes según el estado elegido
  const pacientesFiltrados = pacientes.filter(p => {
    if (filtroServicio !== "todos" && p.servicio !== filtroServicio) return false;
    switch (filtroEstado) {
      case "todos":     break;
      case "activo":    if (p.estado !== "activo") return false; break;
      case "alta":      if (p.estado !== "alta") return false; break;
      case "operado":   if (!p.operado) return false; break;
      case "sin_operar":if (p.operado || p.estado === "alta") return false; break;
      default: break;
    }
    return true;
  });

  // Estados disponibles en el menú (valor, etiqueta)
  const ESTADOS_PACIENTE = [
    ["activo", "Activos"],
    ["todos", "Todos"],
    ["alta", "Dados de alta"],
    ["operado", "Operados"],
    ["sin_operar", "Sin operar"],
  ];
  const ETIQUETA_ESTADO = Object.fromEntries(ESTADOS_PACIENTE.map(([v,l])=>[v,l]));

  // Cuántos pacientes activos tiene asignado cada médico del equipo
  const cargaPorMedico = useMemo(() => {
    const conteo = new Map();
    pacientes.forEach(p => {
      if (p.estado === "alta") return;
      const ids = Array.isArray(p.encargados) ? p.encargados : [];
      ids.forEach(id => conteo.set(id, (conteo.get(id)||0) + 1));
    });
    return Array.from(conteo.entries())
      .map(([id,n]) => ({ id, nombre: nombreMiembroPac(id), n }))
      .sort((a,b) => b.n - a.n);
  }, [pacientes, miembrosEquipo]);

  // Estilo de cada ítem del menú desplegable
  const itemMenu = (activo) => ({
    display:"block", width:"100%", textAlign:"left",
    padding:"8px 10px", fontSize:"var(--fs-1)", borderRadius:7, cursor:"pointer",
    background: activo ? "var(--primario-suave, #E8F3FB)" : "none",
    color: activo ? "var(--primario)" : "var(--texto)",
    fontWeight: activo ? 700 : 500, border:"none",
  });

  // Agrupar por servicio para vista kanban
  const porServicio = {};
  pacientesFiltrados.forEach(p => {
    if (!porServicio[p.servicio]) porServicio[p.servicio] = [];
    porServicio[p.servicio].push(p);
  });
  // Orden manual dentro de cada columna (campo "orden"); los sin orden van al final.
  Object.keys(porServicio).forEach(s => porServicio[s].sort((a, b) => (a.orden ?? 1e9) - (b.orden ?? 1e9)));

  // ─── Orden COMPARTIDO de los servicios del kanban (se guarda por equipo) ───
  const claveOrden = contexto && contexto !== "personal" ? `equipo:${contexto}` : `personal:${currentUser.id}`;
  const [ordenServiciosKanban, setOrdenServiciosKanban] = useState([]);
  const [dragCol, setDragCol] = useState(null); // { nombre, dx } → la columna flota siguiendo el dedo
  const dragColInfo = useRef(null);
  const kanbanRef = useRef(null);
  const listaScrollElRef = useRef(null);   // contenedor scrolleable de la vista lista
  const listaScrollPosRef = useRef(0);      // última posición de scroll de la lista
  const formEvoRef = useRef(null);          // tarjeta del formulario "Nueva evolución"
  const formExamenRef = useRef(null);       // tarjeta del formulario "Nuevo examen"
  const [showDistribucion, setShowDistribucion] = useState(false);
  // Vista de servicios: "vertical" (por defecto, apilada/grilla) u "horizontal" (fila deslizable).
  const [orientacionPac, setOrientacionPac] = useState(() => {
    try { return localStorage.getItem("uro_orient_pac") === "horizontal" ? "horizontal" : "vertical"; } catch { return "vertical"; }
  });
  const toggleOrientacionPac = () => setOrientacionPac(o => {
    const nv = o === "horizontal" ? "vertical" : "horizontal";
    try { localStorage.setItem("uro_orient_pac", nv); } catch {}
    return nv;
  });
  const [distDoctor, setDistDoctor] = useState(null);
  const [ingresoAbierto, setIngresoAbierto] = useState(false); // modal de ingreso
  useEffect(() => {
    const h = (e) => { if (e.detail?.accion === "ingreso") setIngresoAbierto(true); };
    window.addEventListener("uro-submenu-accion", h);
    return () => window.removeEventListener("uro-submenu-accion", h);
  }, []);
  const [moverPaciente, setMoverPaciente] = useState(null); // paciente que se está moviendo de servicio
  const [opcionesPaciente, setOpcionesPaciente] = useState(null); // hoja de opciones (mantener presionado)
  const [txPacienteMenu, setTxPacienteMenu] = useState(null);     // Transfusión desde el menú
  const [ingresoPacienteMenu, setIngresoPacienteMenu] = useState(null); // Adjuntar ingreso desde el menú
  const [autoEditId, setAutoEditId] = useState(null);
  const eliminarPacienteDirecto = async (p) => {
    if (!confirm(`¿Eliminar a ${p.iniciales}? Esta acción no se puede deshacer.`)) return;
    const r = await eliminarPaciente(p.id);
    if (r.ok) setPacientes(prev => prev.filter(x => x.id !== p.id));
    else alert("No se pudo eliminar: " + (r.error || ""));
  };
  const [moverInfo, setMoverInfo] = useState(null); // { pacienteId, iniciales, servicio, prevServicio, prevCama } tras un movimiento
  const [camaInput, setCamaInput] = useState("");
  const guardarCamaMovido = async () => {
    const nc = camaInput.trim(); const info = moverInfo; setMoverInfo(null); setCamaInput("");
    if (!info || !nc) return;
    await actualizarPaciente(info.pacienteId, { cama: nc });
    setPacientes(prev => prev.map(x => x.id === info.pacienteId ? { ...x, cama: nc } : x));
    if (info.servicio) resortCamasServicio(info.servicio);
  };
  const deshacerMovimiento = async () => {
    const info = moverInfo; setMoverInfo(null); setCamaInput("");
    if (!info) return;
    await actualizarPaciente(info.pacienteId, { servicio: info.prevServicio, cama: info.prevCama });
    setPacientes(prev => prev.map(x => x.id === info.pacienteId ? { ...x, servicio: info.prevServicio, cama: info.prevCama } : x));
  };
  const longPressPacRef = useRef(false);
  const pressTimerPac = useRef(null);
  const pressPosPac = useRef(null);
  // Reordena las camas de un servicio de arriba hacia abajo (numérico/alfabético) y persiste el orden.
  const resortCamasServicio = async (servicio) => {
    let ordenados = [];
    setPacientes(prev => {
      const enServicio = prev.filter(x => x.servicio === servicio).slice().sort(compararCama);
      const ordenMap = {}; enServicio.forEach((x, idx) => { ordenMap[x.id] = idx; });
      ordenados = enServicio;
      return prev.map(x => ordenMap[x.id] !== undefined ? { ...x, orden: ordenMap[x.id] } : x);
    });
    for (let idx = 0; idx < ordenados.length; idx++) {
      try { await actualizarPaciente(ordenados[idx].id, { orden: idx }); } catch {}
    }
  };
  const moverAServicio = async (nuevoServicio) => {
    const pac = moverPaciente;
    setMoverPaciente(null);
    if (!pac || !nuevoServicio || nuevoServicio === pac.servicio) return;
    const r = await actualizarPaciente(pac.id, { servicio: nuevoServicio });
    if (r.ok) {
      setPacientes(prev => prev.map(x => x.id === pac.id ? { ...x, servicio: nuevoServicio } : x));
      setCamaInput(""); setMoverInfo({ pacienteId: pac.id, iniciales: pac.iniciales, servicio: nuevoServicio, prevServicio: pac.servicio, prevCama: pac.cama });
      resortCamasServicio(nuevoServicio);
    }
    else alert("No se pudo mover el paciente: " + r.error);
  };
  const reordenarPaciente = async (p, dir) => {
    const col = [...(porServicio[p.servicio] || [])];
    const i = col.findIndex(x => x.id === p.id);
    const j = dir < 0 ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= col.length) return;
    [col[i], col[j]] = [col[j], col[i]];
    const nuevo = {}; col.forEach((x, idx) => { nuevo[x.id] = idx; });
    setPacientes(prev => prev.map(x => nuevo[x.id] !== undefined ? { ...x, orden: nuevo[x.id] } : x));
    await Promise.all(col.map((x, idx) => actualizarPaciente(x.id, { orden: idx })));
  };
  const dragPacRef = useRef(null);
  const overRef = useRef(null);
  const arrastreRecienteRef = useRef(0);
  const [dragPos, setDragPos] = useState(null); // clon flotante {x,y}
  const [gapId, setGapId] = useState(null);      // tarjeta ante la que se insertará
  const iniciarDragPac = (e, p) => {
    if (soloLectura) return;
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    let activo = false, autoDir = 0, scEl = null, rafId = 0;
    let lastX = startX, lastY = startY, lastGap = null;
    // Calcula sobre qué tarjeta/servicio se soltaría, con la posición actual del dedo.
    // Solo actualiza el estado de React cuando el objetivo cambia (evita re-render por frame → tirones).
    const evalObjetivo = (cx, cy) => {
      const el = document.elementFromPoint(cx, cy)?.closest("[data-serv]");
      let g = null, o = null;
      if (el) {
        const serv = el.getAttribute("data-serv");
        const id = el.getAttribute("data-pac-id");
        if (id && id !== p.id) { o = { id, serv }; g = id; }
        else if (!id && serv) { o = { id: null, serv }; g = "__" + serv; }
      }
      overRef.current = o;
      if (g !== lastGap) { lastGap = g; setGapId(g); }
    };
    const move = (ev) => {
      if (ev.cancelable) ev.preventDefault();
      lastX = ev.clientX; lastY = ev.clientY;
      setDragPos({ x: ev.clientX, y: ev.clientY });
      const vh = window.innerHeight;
      autoDir = ev.clientY < 95 ? -1 : ev.clientY > vh - 95 ? 1 : 0;
      evalObjetivo(ev.clientX, ev.clientY);
    };
    // Auto-scroll alineado al frame (rAF): velocidad proporcional a la cercanía al borde,
    // sin el "temblor" que producía el setInterval de 16 ms desincronizado con el repintado.
    const autoScroll = () => {
      if (autoDir !== 0 && scEl) {
        const vh = window.innerHeight;
        const dist = autoDir < 0 ? Math.max(0, 95 - lastY) : Math.max(0, lastY - (vh - 95));
        const speed = Math.min(16, 4 + dist * 0.16);
        scEl.scrollBy(0, autoDir * speed);
        evalObjetivo(lastX, lastY); // el hueco de destino sigue a la lista mientras se desplaza
      }
      rafId = requestAnimationFrame(autoScroll);
    };
    const up = async () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      if (rafId) cancelAnimationFrame(rafId);
      const over = overRef.current, dp = dragPacRef.current;
      dragPacRef.current = null; overRef.current = null; setDragPos(null); setGapId(null);
      arrastreRecienteRef.current = Date.now();
      if (!over || !dp) return;
      const destServ = over.serv || dp.servicio;
      const col = (porServicio[destServ] || []).map(x => x.id).filter(id => id !== dp.id);
      let idx = col.indexOf(over.id); if (idx < 0) idx = col.length;
      col.splice(idx, 0, dp.id);
      const ord = {}; col.forEach((id, i) => { ord[id] = i; });
      setPacientes(prev => prev.map(x => x.id === dp.id ? { ...x, servicio: destServ, orden: ord[x.id] } : (ord[x.id] !== undefined ? { ...x, orden: ord[x.id] } : x)));
      await Promise.all(col.map((id, i) => actualizarPaciente(id, id === dp.id ? { servicio: destServ, orden: i } : { orden: i })));
      // Al cambiar de servicio: hoja para ajustar cama o deshacer (sin prompt nativo).
      if (destServ !== dp.servicio) { setCamaInput(""); setMoverInfo({ pacienteId: dp.id, iniciales: dp.iniciales, servicio: destServ, prevServicio: dp.servicio, prevCama: dp.cama }); }
    };
    // Hay que MANTENER presionado el asa un instante antes de arrastrar,
    // para no activar el drag al hacer scroll con el dedo encima del ⠿.
    const arrancar = () => {
      activo = true;
      window.removeEventListener("pointermove", preMove); window.removeEventListener("pointerup", preUp);
      dragPacRef.current = p; overRef.current = null; setGapId(null); setDragPos({ x: startX, y: startY });
      try { navigator.vibrate?.(15); } catch {}
      scEl = scrollParent(kanbanRef.current || document.body);
      rafId = requestAnimationFrame(autoScroll);
      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", up);
    };
    const holdTimer = setTimeout(arrancar, 200);
    const preMove = (ev) => {
      if (activo) return;
      if (Math.abs(ev.clientX - startX) > 8 || Math.abs(ev.clientY - startY) > 8) {
        clearTimeout(holdTimer);
        window.removeEventListener("pointermove", preMove); window.removeEventListener("pointerup", preUp);
      }
    };
    const preUp = () => { clearTimeout(holdTimer); window.removeEventListener("pointermove", preMove); window.removeEventListener("pointerup", preUp); };
    window.addEventListener("pointermove", preMove, { passive: true });
    window.addEventListener("pointerup", preUp);
  };
  // Al volver a la lista (desde una ficha), restaura la posición de scroll previa.
  useEffect(() => {
    if (vista === "lista" && listaScrollElRef.current) {
      listaScrollElRef.current.scrollTop = listaScrollPosRef.current;
    }
  }, [vista]);
  const pressTimer = useRef(null);
  const pressPos = useRef(null);

  useEffect(() => {
    let vivo = true;
    leerOrdenServiciosCompartido(claveOrden).then(orden => { if (vivo && orden) setOrdenServiciosKanban(orden); });
    return () => { vivo = false; };
  }, [claveOrden]);

  const nombresServicioOrdenados = aplicarOrdenNombres(Object.keys(porServicio), ordenServiciosKanban);
  const serviciosConfig = Array.from(new Set([...(esEquipo ? serviciosEquipo : misServiciosLista).map(s => s.nombre), ...Object.keys(porServicio)])).filter(Boolean);
  const serviciosVacios = serviciosConfig.filter(s => !porServicio[s] || porServicio[s].length === 0);

  const iniciarDragColumna = (e, nombre, idx) => {
    if (soloLectura) return;
    const cont = kanbanRef.current;
    const cols = cont ? Array.from(cont.children) : [];
    const r0 = cols[idx]?.getBoundingClientRect();
    // ¿Las columnas están una al lado de la otra o apiladas? (en el celular hay una sola
    // columna, así que el arrastre debe ser vertical, no horizontal).
    let vertical = true;
    if (cols.length > 1 && r0) {
      const r1 = cols[idx === 0 ? 1 : 0].getBoundingClientRect();
      vertical = Math.abs(r1.top - r0.top) > Math.abs(r1.left - r0.left);
    }
    const paso = vertical
      ? (r0 ? r0.height + 12 : 120)
      : (r0 ? r0.width + 12 : 292);

    dragColInfo.current = { nombre, desdeIdx: idx, aIdx: idx, x0: e.clientX, y0: e.clientY, paso, vertical };
    setDragCol({ nombre, d: 0, desdeIdx: idx, aIdx: idx, vertical });
    // Bloquea el scroll de la página mientras se arrastra
    const bloquear = (ev) => ev.preventDefault();
    document.addEventListener("touchmove", bloquear, { passive: false });

    const onMove = (ev) => {
      const d = dragColInfo.current; if (!d) return;
      const delta = d.vertical ? ev.clientY - d.y0 : ev.clientX - d.x0;
      let destino = d.desdeIdx + Math.round(delta / d.paso);
      destino = Math.max(0, Math.min(nombresServicioOrdenados.length - 1, destino));
      d.aIdx = destino;
      setDragCol({ nombre: d.nombre, d: delta, desdeIdx: d.desdeIdx, aIdx: destino, vertical: d.vertical });
    };
    const onUp = async () => {
      const d = dragColInfo.current; dragColInfo.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.removeEventListener("touchmove", bloquear);
      setDragCol(null);
      if (!d || d.aIdx === d.desdeIdx) return;
      const nueva = [...nombresServicioOrdenados];
      const [item] = nueva.splice(d.desdeIdx, 1);
      nueva.splice(d.aIdx, 0, item);
      setOrdenServiciosKanban(nueva);
      await guardarOrdenServiciosCompartido(claveOrden, nueva); // se comparte con el equipo
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  // Desplazamiento que debe aplicarse a cada columna para abrir el hueco de destino
  const desplazamientoColumna = (k) => {
    const d = dragCol;
    if (!d || k === d.desdeIdx) return 0;
    if (d.desdeIdx < d.aIdx && k > d.desdeIdx && k <= d.aIdx) return -1; // se corren hacia atrás
    if (d.desdeIdx > d.aIdx && k >= d.aIdx && k < d.desdeIdx) return 1;  // se corren hacia adelante
    return 0;
  };

  // ─── Dejar presionado el servicio y arrastrarlo ───
  const iniciarLongPress = (e, nombre, idx) => {
    if (soloLectura) return;
    const { clientX, clientY, pointerId, currentTarget } = e;
    pressPos.current = { x: clientX, y: clientY };
    clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => {
      try { navigator.vibrate?.(25); } catch {}
      iniciarDragColumna({ clientX, clientY, pointerId, currentTarget }, nombre, idx);
    }, 260);
  };
  const moverLongPress = (e) => {
    const p = pressPos.current; if (!p) return;
    if (Math.abs(e.clientX - p.x) > 10 || Math.abs(e.clientY - p.y) > 10) clearTimeout(pressTimer.current);
  };
  const cancelarLongPress = () => { clearTimeout(pressTimer.current); pressPos.current = null; };

  // ============================================================
  // CRUD PACIENTES
  // ============================================================

  // ── Extracción por foto: NUEVO paciente ──────────────────────────
  const onFotoNuevoIngreso = async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 3);
    e.target.value = "";
    if (!files.length) return;
    setError(""); setExtraccionMsg(""); setExtrayendoIngreso(true);
    try {
      const b64s = [];
      for (const f of files) b64s.push(await comprimirImagenPac(f));
      const x = await extraerIngresoPaciente(b64s);
      setNuevo(prev => ({
        ...prev,
        iniciales: x.iniciales ? String(x.iniciales).slice(0, 100) : prev.iniciales,
        ficha_clinica: x.ficha_clinica ? String(x.ficha_clinica).slice(0, 30) : prev.ficha_clinica,
        rut: x.rut ? String(x.rut).slice(0, 15) : prev.rut,
        edad: (x.edad ?? "") !== "" ? String(x.edad) : prev.edad,
        sexo: x.sexo === "F" ? "F" : (x.sexo === "M" ? "M" : prev.sexo),
        diagnostico: x.diagnostico || prev.diagnostico,
        plan_manejo: x.plan_manejo || prev.plan_manejo,
        historia: componerHistoriaIngreso(x) || prev.historia,
      }));
      setExtraccionMsg("✓ Datos extraídos. Revísalos y completa cama/servicio antes de guardar.");
    } catch (err) {
      setError("No se pudo leer la foto. Intenta con mejor luz o ingresa los datos a mano.");
    } finally {
      setExtrayendoIngreso(false);
    }
  };

  // ── Extracción por foto: AGREGAR ingreso a un paciente existente ──
  // Procesa 1-3 fotos/PDF de un ingreso y lo agrega a la historia del paciente `target`.
  // Sirve tanto para la ficha abierta como para el menú de "mantener presionado".
  const aplicarFotoIngreso = async (files, target) => {
    if (!files.length || !target) return;
    const enFicha = seleccionado?.id === target.id;
    if (enFicha) { setExtraccionMsg(""); setExtrayendoIngreso(true); }
    else setFotoMenuCargando(target.iniciales || true);
    try {
      const b64s = [];
      for (const f of files) b64s.push(await comprimirImagenPac(f));
      const x = await extraerIngresoPaciente(b64s);
      const textoNuevo = componerHistoriaIngreso(x);
      const historiaFinal = [target.historia, textoNuevo].filter(Boolean).join("\n\n");
      const patch = { historia: historiaFinal };
      if (x.diagnostico && !target.diagnostico) patch.diagnostico = x.diagnostico;
      // Completa ficha clínica y RUT si el paciente aún no los tiene
      if (x.ficha_clinica && !target.ficha_clinica) patch.ficha_clinica = String(x.ficha_clinica).slice(0, 30);
      if (x.rut && !target.rut) patch.rut = String(x.rut).slice(0, 15);
      const result = await actualizarPaciente(target.id, patch);
      if (!result.ok) {
        if (enFicha) setExtraccionMsg("⚠️ Error al guardar: " + result.error);
        else alert("⚠️ Error al guardar el ingreso: " + result.error);
        return;
      }
      if (seleccionado?.id === result.paciente.id) setSeleccionado(result.paciente);
      setPacientes(prev => prev.map(p => p.id === result.paciente.id ? result.paciente : p));
      if (enFicha) setExtraccionMsg("✓ Ingreso agregado a la historia desde la foto.");
      else alert("✓ Ingreso agregado a la historia de " + (result.paciente.iniciales || "el paciente") + ".");
    } catch (err) {
      if (enFicha) setExtraccionMsg("⚠️ No se pudo leer la foto. Intenta con mejor luz.");
      else alert("⚠️ No se pudo leer la foto. Intenta con mejor luz.");
    } finally {
      if (enFicha) setExtrayendoIngreso(false);
      else setFotoMenuCargando(false);
    }
  };
  const onFotoFichaIngreso = (e) => {
    const files = Array.from(e.target.files || []).slice(0, 3);
    e.target.value = "";
    if (seleccionado) aplicarFotoIngreso(files, seleccionado);
  };
  const onFotoMenuIngreso = (e) => {
    const files = Array.from(e.target.files || []).slice(0, 3);
    e.target.value = "";
    const target = fotoMenuTargetRef.current;
    if (target) aplicarFotoIngreso(files, target);
  };

  const guardarNuevo = async () => {
    setError("");
    if (!nuevo.iniciales.trim()) return setError("Ingresa las iniciales");
    if (nuevo.iniciales.length > 100) return setError("Máximo 100 caracteres");
    if (!nuevo.cama.trim()) return setError("Ingresa la cama");
    if (!nuevo.servicio.trim() || nuevo.servicio === "__nuevo__") return setError("Ingresa el servicio");
    if (!nuevo.diagnostico.trim()) return setError("Ingresa el diagnóstico");

    const datos = {
      medico_id: currentUser.id,
      equipo_id: esEquipo ? contexto : null,
      iniciales: nuevo.iniciales.trim().toUpperCase(),
      ficha_clinica: nuevo.ficha_clinica.trim() || null,
      rut: nuevo.rut.trim() || null,
      edad: nuevo.edad ? parseInt(nuevo.edad) : null,
      sexo: nuevo.sexo,
      cama: nuevo.cama.trim(),
      servicio: nuevo.servicio.trim(),
      diagnostico: nuevo.diagnostico.trim(),
      plan_manejo: nuevo.plan_manejo.trim() || null,
      historia: nuevo.historia.trim() || null,
      fecha_ingreso: nuevo.fecha_ingreso,
      estado: 'activo'
    };

    const result = await crearPaciente(datos);
    if (!result.ok) return setError(result.error);

    setPacientes(prev => [result.paciente, ...prev]);
    setNuevo({ iniciales: "", ficha_clinica: "", rut: "", edad: "", sexo: "M", cama: "", servicio: "", diagnostico: "", plan_manejo: "", historia: "", fecha_ingreso: new Date().toISOString().slice(0, 10) });
    setExtraccionMsg("");
    setVista("lista");
  };

  const cambiarEstado = async (paciente, nuevoEstado) => {
    const result = await actualizarPaciente(paciente.id, { estado: nuevoEstado });
    if (!result.ok) return alert("Error: " + result.error);
    setPacientes(prev => prev.map(p => p.id === paciente.id ? result.paciente : p));
    if (seleccionado?.id === paciente.id) setSeleccionado(result.paciente);
    // Avisar a los encargados cuando se da de alta
    if (nuevoEstado === "alta" && Array.isArray(paciente.encargados)) {
      paciente.encargados.filter(id => id !== currentUser.id).forEach(id => {
        crearNotificacion(id, `Paciente dado de alta: ${paciente.iniciales} (cama ${paciente.cama}) — por ${currentUser.nombre}`, "paciente");
      });
    }
  };
  const iniciarEdicion = () => {
  setEditForm({
    iniciales: seleccionado.iniciales || "",
    ficha_clinica: seleccionado.ficha_clinica || "",
    rut: seleccionado.rut || "",
    edad: seleccionado.edad || "",
    sexo: seleccionado.sexo || "M",
    cama: seleccionado.cama || "",
    servicio: seleccionado.servicio || "",
    diagnostico: seleccionado.diagnostico || "",
    plan_manejo: seleccionado.plan_manejo || "",
    antecedentes: Array.isArray(seleccionado.antecedentes) ? seleccionado.antecedentes : [],
    alergias: seleccionado.alergias || "",
  });
  setEditandoFicha(true);
};
  useEffect(() => { if (autoEditId && vista === "ficha" && seleccionado?.id === autoEditId) { iniciarEdicion(); setAutoEditId(null); } }, [autoEditId, vista, seleccionado]);

const guardarEdicion = async () => {
  const datos = {
    iniciales: editForm.iniciales.trim().toUpperCase(),
    ficha_clinica: (editForm.ficha_clinica || "").trim() || null,
    rut: (editForm.rut || "").trim() || null,
    edad: editForm.edad ? parseInt(editForm.edad) : null,
    sexo: editForm.sexo,
    cama: editForm.cama.trim(),
    servicio: editForm.servicio.trim(),
    diagnostico: editForm.diagnostico.trim(),
    plan_manejo: editForm.plan_manejo.trim() || null,
    antecedentes: Array.isArray(editForm.antecedentes) ? editForm.antecedentes : [],
    alergias: (editForm.alergias || "").trim(),
  };
  const result = await actualizarPaciente(seleccionado.id, datos);
  if (!result.ok) return alert("Error: " + result.error);
  setPacientes(prev => prev.map(p => p.id === seleccionado.id ? result.paciente : p));
  setSeleccionado(result.paciente);
  setEditandoFicha(false);
};
const asignarEncargados = async (pacienteId, nuevosEncargados) => {
  const paciente = pacientes.find(p => p.id === pacienteId);
  const previos = Array.isArray(paciente?.encargados) ? paciente.encargados : [];
  const result = await actualizarPaciente(pacienteId, { encargados: nuevosEncargados });
  if (!result.ok) return alert("Error: " + result.error);
  setPacientes(prev => prev.map(p => p.id === pacienteId ? result.paciente : p));
  // Notificar a los recién agregados (no a quien se auto-asigna)
  nuevosEncargados.filter(id => !previos.includes(id) && id !== currentUser.id).forEach(id => {
    crearNotificacion(id, `Te asignaron como encargado del paciente ${paciente?.iniciales || ""} (cama ${paciente?.cama || "?"}) — por ${currentUser.nombre}`, "paciente");
  });
};
  const toggleOperado = async () => {
    const result = await actualizarPaciente(seleccionado.id, { operado: !seleccionado.operado });
    if (!result.ok) return alert("Error: " + result.error);
    setPacientes(prev => prev.map(p => p.id === seleccionado.id ? result.paciente : p));
    setSeleccionado(result.paciente);
  };
  const cambiarEstadoClinico = async (nuevoEstado) => {
    const result = await actualizarPaciente(seleccionado.id, { estado_clinico: nuevoEstado });
    if (!result.ok) return alert("Error: " + result.error);
    setPacientes(prev => prev.map(p => p.id === seleccionado.id ? result.paciente : p));
    setSeleccionado(result.paciente);
  };
  const abrirFormCirugia = () => {
    setFormCirugia({ fecha: new Date().toISOString().slice(0,10), nombre: "" });
  };
  const guardarCirugia = async () => {
    if (!formCirugia || !formCirugia.nombre.trim() || !formCirugia.fecha) return;
    const actuales = Array.isArray(seleccionado.cirugias_realizadas) ? seleccionado.cirugias_realizadas : [];
    const nuevas = [...actuales, { fecha: formCirugia.fecha, nombre: formCirugia.nombre.trim() }];
    const result = await actualizarPaciente(seleccionado.id, { cirugias_realizadas: nuevas });
    if (!result.ok) return alert("Error: " + result.error);
    setPacientes(prev => prev.map(p => p.id === seleccionado.id ? result.paciente : p));
    setSeleccionado(result.paciente);
    setFormCirugia(null);
  };
  const eliminarCirugia = async (idx) => {
    const actuales = Array.isArray(seleccionado.cirugias_realizadas) ? seleccionado.cirugias_realizadas : [];
    const nuevas = actuales.filter((_, i) => i !== idx);
    const result = await actualizarPaciente(seleccionado.id, { cirugias_realizadas: nuevas });
    if (!result.ok) return alert("Error: " + result.error);
    setPacientes(prev => prev.map(p => p.id === seleccionado.id ? result.paciente : p));
    setSeleccionado(result.paciente);
  };
  // Calcula el día post-operatorio desde una fecha hasta hoy (Día 0 = día de la cirugía)
  const diaPostOp = (fechaStr) => {
    if (!fechaStr) return null;
    const f = new Date(fechaStr + "T00:00:00");
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const diff = Math.floor((hoy - f) / (1000*60*60*24));
    return diff;
  };
  const eliminarPacienteHandler = async (paciente) => {
    if (!confirm(`¿Eliminar paciente ${paciente.iniciales}?\n\nEsto borra evoluciones y exámenes asociados.`)) return;
    const result = await eliminarPaciente(paciente.id);
    if (!result.ok) return alert("Error: " + result.error);
    setPacientes(prev => prev.filter(p => p.id !== paciente.id));
    setSeleccionado(null);
    setVista("lista");
  };
  

  // ============================================================
  // ABRIR FICHA
  // ============================================================

  const abrirFicha = async (paciente) => {
    setSeleccionado(paciente);
    setVista("ficha");
    setEvoluciones([]); setExamenes([]); setPendientesPaciente([]); // evita mostrar el curso del paciente anterior
    setExtraccionMsg("");
    setMostrarEvosAntiguas(false);
    setMostrarExAntiguos(false);
    setEditandoHistoria(false);
    setAbrirFormPendiente(false);
    setAbrirFormEvo(false);
    setAbrirFormExamen(false);
    // Hidrata el curso del paciente desde caché (visible sin señal); la red refresca.
    const kEvo = `evoluciones:${paciente.id}`;
    const kEx = `examenes:${paciente.id}`;
    try { const c = await leerSnapshot(kEvo); setEvoluciones(Array.isArray(c) ? c : []); } catch { setEvoluciones([]); }
    try { const c = await leerSnapshot(kEx); setExamenes(Array.isArray(c) ? c : []); } catch { setExamenes([]); }
    try {
      const evoResult = await listarEvoluciones(paciente.id);
      if (evoResult.ok) { setEvoluciones(evoResult.evoluciones); guardarSnapshot(kEvo, evoResult.evoluciones); }
    } catch {}
    try {
      const exResult = await listarExamenes(paciente.id);
      if (exResult.ok) { const norm = exResult.examenes.map(normalizarExamen); setExamenes(norm); guardarSnapshot(kEx, norm); }
    } catch {}
    cargarPendientesPaciente(paciente.id);
  };

  const imprimirNota = async (ev) => {
    let jsPDF; try { jsPDF = (await import("jspdf")).jsPDF; } catch { return; }
    const doc = new jsPDF({ unit: "mm", format: "a4" }); const W = doc.internal.pageSize.getWidth(), M = 18; let y = 18;
    try { const wm = await logoWatermarkDataUrl(); if (wm) doc.addImage(wm, "PNG", W - M - 18, y - 4, 16, 16); } catch {}
    doc.setFont("times", "bold"); doc.setFontSize(11); doc.text("HISTORIA Y EVOLUCIÓN CLÍNICA", W / 2, y, { align: "center" }); y += 8;
    doc.setFont("times", "normal"); doc.setFontSize(10);
    doc.text(`Nombre: ${seleccionado.iniciales || ""}`, M, y); doc.text(`Edad: ${seleccionado.edad || ""}`, W - M - 38, y); y += 5;
    doc.text(`Ficha: ${seleccionado.ficha_clinica || seleccionado.rut || ""}    Servicio: ${seleccionado.servicio || ""}    Cama: ${seleccionado.cama || "—"}`, M, y); y += 5;
    doc.setDrawColor(150); doc.line(M, y, W - M, y); y += 7;
    doc.setFont("times", "bold"); doc.setFontSize(9.5);
    doc.text(`${ev.fecha_evolucion || ""} ${ev.hora_evolucion || ""}   ·   ${ev.autor?.nombre || ""}${ev.tipo && ev.tipo !== "libre" ? "   [" + ev.tipo + "]" : ""}`, M, y); y += 6;
    doc.setFont("times", "normal"); doc.setFontSize(10.5);
    doc.splitTextToSize(ev.texto || "", W - 2 * M).forEach(l => { if (y > 285) { doc.addPage(); y = 18; } doc.text(l, M, y); y += 5.2; });
    doc.save(`nota_${(seleccionado.iniciales || "paciente").replace(/\s+/g, "_")}_${(ev.fecha_evolucion || "").replace(/-/g, "")}.pdf`);
  };
  const descargarEvolucionesPDF = async () => {
    if (!evoluciones || evoluciones.length === 0) { alert("Este paciente aún no tiene evoluciones para exportar."); return; }
    let jsPDF; try { jsPDF = (await import("jspdf")).jsPDF; } catch { return; }
    const doc = new jsPDF({ unit: "mm", format: "a4" }); const W = doc.internal.pageSize.getWidth(), M = 16; let y = 16;
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.text("HISTORIA Y EVOLUCIÓN CLÍNICA", W / 2, y, { align: "center" }); y += 8;
    doc.setFontSize(9); doc.setFont("helvetica", "normal");
    doc.text(`Nombre: ${seleccionado.iniciales || ""}`, M, y); doc.text(`Edad: ${seleccionado.edad || ""}`, W - M - 38, y); y += 5;
    doc.text(`Ficha: ${seleccionado.ficha_clinica || seleccionado.rut || ""}    Servicio: ${seleccionado.servicio || ""}    Cama: ${seleccionado.cama || "—"}`, M, y); y += 5;
    doc.setDrawColor(150); doc.line(M, y, W - M, y); y += 5;
    const evos = [...evoluciones].sort((a, b) => ((a.fecha_evolucion || "") + (a.hora_evolucion || "")).localeCompare((b.fecha_evolucion || "") + (b.hora_evolucion || "")));
    evos.forEach(e => {
      if (y > 280) { doc.addPage(); y = 18; }
      doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
      doc.text(`${e.fecha_evolucion || ""} ${e.hora_evolucion || ""}  ·  ${e.autor?.nombre || ""}${e.tipo && e.tipo !== "libre" ? "  [" + e.tipo + "]" : ""}`, M, y); y += 4.6;
      doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      doc.splitTextToSize(e.texto || "", W - 2 * M).forEach(p => { if (y > 286) { doc.addPage(); y = 18; } doc.text(p, M, y); y += 4.6; });
      y += 3;
    });
    doc.save(`evoluciones_${(seleccionado.iniciales || "paciente").replace(/\s+/g, "_")}.pdf`);
  };
  // Imprime SOLO las evoluciones de hoy, ordenadas cronológicamente, con el logo de UroSearch en la esquina.
  const imprimirEvolucionesDelDiaPDF = async () => {
    const hoy = new Date().toISOString().slice(0, 10);
    const delDia = (evoluciones || [])
      .filter(e => (e.fecha_evolucion || "") === hoy)
      .sort((a, b) => (a.hora_evolucion || "").localeCompare(b.hora_evolucion || ""));
    if (delDia.length === 0) { alert("No hay evoluciones registradas hoy para este paciente."); return; }
    let jsPDF; try { jsPDF = (await import("jspdf")).jsPDF; } catch { alert("No se pudo cargar el generador de PDF."); return; }
    const doc = new jsPDF({ unit: "mm", format: "a4" }); const W = doc.internal.pageSize.getWidth(), M = 16; let y = 18;
    try { const wm = await logoWatermarkDataUrl(); if (wm) doc.addImage(wm, "PNG", W - M - 18, 12, 16, 16); } catch {}
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(20, 20, 20);
    doc.text("EVOLUCIONES DEL DÍA", M, y); y += 6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(90, 90, 90);
    const fechaLarga = new Date().toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    doc.text(fechaLarga.charAt(0).toUpperCase() + fechaLarga.slice(1), M, y); y += 6;
    doc.setTextColor(20, 20, 20);
    doc.text(`Paciente: ${seleccionado.iniciales || ""}    Edad: ${seleccionado.edad || "—"}`, M, y); y += 4.8;
    doc.text(`Ficha: ${seleccionado.ficha_clinica || seleccionado.rut || "—"}    Servicio: ${seleccionado.servicio || "—"}    Cama: ${seleccionado.cama || "—"}`, M, y); y += 5;
    doc.setDrawColor(150); doc.line(M, y, W - M, y); y += 7;
    delDia.forEach(e => {
      if (y > 280) { doc.addPage(); y = 18; }
      doc.setFont("helvetica", "bold"); doc.setFontSize(9);
      doc.text(`${e.hora_evolucion?.slice(0, 5) || ""}  ·  ${e.autor?.nombre || ""}${e.tipo && e.tipo !== "libre" ? "  [" + e.tipo + "]" : ""}`, M, y); y += 5;
      doc.setFont("helvetica", "normal"); doc.setFontSize(10);
      doc.splitTextToSize(e.texto || "", W - 2 * M).forEach(p => { if (y > 286) { doc.addPage(); y = 18; } doc.text(p, M, y); y += 5; });
      y += 4;
    });
    doc.save(`evoluciones_${(seleccionado.iniciales || "paciente").replace(/\s+/g, "_")}_${hoy.replace(/-/g, "")}.pdf`);
  };

  // ============================================================
  // HISTORIA DEL PACIENTE
  // ============================================================
  const guardarHistoria = async () => {
    const result = await actualizarPaciente(seleccionado.id, { historia: historiaDraft.trim() || null });
    if (!result.ok) return alert("Error: " + result.error);
    setPacientes(prev => prev.map(p => p.id === seleccionado.id ? result.paciente : p));
    setSeleccionado(result.paciente);
    setEditandoHistoria(false);
  };

  // ============================================================
  // PENDIENTES DEL PACIENTE (desde la ficha)
  // ============================================================
  const cargarPendientesPaciente = async (pacienteId) => {
    const r = await listarPendientes(currentUser.id, contexto);
    if (r.ok) setPendientesPaciente((r.pendientes || []).filter(p => p.paciente_id === pacienteId));
  };

  const guardarPendientePaciente = async () => {
    if (!nuevoPendientePac.texto.trim()) return alert("Escribe el pendiente");
    const datos = {
      autor_id: currentUser.id,
      equipo_id: esEquipo ? contexto : null,
      paciente_id: seleccionado.id,
      texto: `[${seleccionado.iniciales} · cama ${seleccionado.cama}] ${nuevoPendientePac.texto.trim()}`,
      prioridad: nuevoPendientePac.prioridad,
      fecha_objetivo: nuevoPendientePac.fecha_objetivo || null,
      encargados: nuevoPendientePac.encargados,
    };
    const result = await crearPendiente(datos);
    if (!result.ok) return alert("Error: " + result.error);
    setPendientesPaciente(prev => [result.pendiente, ...prev]);
    // Notificar encargados asignados
    nuevoPendientePac.encargados.filter(id => id !== currentUser.id).forEach(id => {
      crearNotificacion(id, `Te asignaron un pendiente del paciente ${seleccionado.iniciales}: "${nuevoPendientePac.texto.trim().slice(0,70)}" — por ${currentUser.nombre}`, "pendiente");
    });
    setNuevoPendientePac({ texto: "", prioridad: "normal", fecha_objetivo: "", encargados: [] });
  };

  const togglePendientePacCompletado = async (p) => {
    const nuevoEstado = p.estado === "completado" ? "pendiente" : "completado";
    const result = await actualizarPendiente(p.id, { estado: nuevoEstado });
    if (!result.ok) return alert("Error: " + result.error);
    setPendientesPaciente(prev => prev.map(x => x.id === p.id ? result.pendiente : x));
    // Avisar a los encargados cuando se completa
    if (nuevoEstado === "completado" && Array.isArray(p.encargados)) {
      p.encargados.filter(id => id !== currentUser.id).forEach(id => {
        crearNotificacion(id, `Pendiente completado: "${p.texto.replace(/^\[[^\]]*\]\s*/,"").slice(0,70)}"`, "pendiente");
      });
    }
  };

  // ============================================================
  // CRUD EVOLUCIONES
  // ============================================================

  const guardarEvolucion = async () => {
    let texto = "";
    if (tipoEvo === "libre") {
      if (!evoLibre.trim()) return alert("Escribe la evolución");
      texto = evoLibre.trim();
    } else {
      const partes = [];
      if (evoEstructurada.subjetivo.trim()) partes.push(`SUBJETIVO:\n${evoEstructurada.subjetivo.trim()}`);
      if (evoEstructurada.objetivo.trim()) partes.push(`OBJETIVO:\n${evoEstructurada.objetivo.trim()}`);
      // Diuresis estructurada
      if (diuresis.cantidad || diuresis.via || diuresis.caracteristicas) {
        const d = [];
        if (diuresis.cantidad) d.push(`${diuresis.cantidad} ml`);
        if (diuresis.via) d.push(diuresis.via);
        if (diuresis.caracteristicas) d.push(diuresis.caracteristicas);
        partes.push(`DIURESIS:\n${d.join(" · ")}`);
      }
      // Drenaje estructurado
      if (drenaje.activo) {
        const dr = [];
        if (drenaje.tipo) {
          let t = drenaje.tipo;
          if ((drenaje.tipo === "Hemosuc" || drenaje.tipo === "Jackson Pratt") && drenaje.aspiracion) {
            t += ` (${drenaje.aspiracion})`;
          }
          dr.push(t);
        }
        if (drenaje.localizacion) dr.push(drenaje.localizacion);
        if (drenaje.cantidad) dr.push(`${drenaje.cantidad} ml`);
        if (drenaje.caracteristicas) dr.push(drenaje.caracteristicas);
        if (dr.length > 0) partes.push(`DRENAJE:\n${dr.join(" · ")}`);
      }
      if (evoEstructurada.examen.trim()) partes.push(`EXAMEN FÍSICO:\n${evoEstructurada.examen.trim()}`);
      if (evoEstructurada.indicaciones.trim()) partes.push(`INDICACIONES:\n${evoEstructurada.indicaciones.trim()}`);
      if (partes.length === 0) return alert("Completa al menos una sección");
      texto = partes.join("\n\n");
    }

    const result = await crearEvolucion(seleccionado.id, currentUser.id, texto, tipoEvo);
    if (!result.ok) {
      // Sin conexión: guarda localmente y encola para sincronizar al reconectar.
      encolar("crearEvolucion", { pacienteId: seleccionado.id, autorId: currentUser.id, texto, tipo: tipoEvo });
      const temp = { id: `tmp_${Date.now()}`, paciente_id: seleccionado.id, autor_id: currentUser.id, texto, tipo: tipoEvo, fecha_evolucion: new Date().toISOString().slice(0,10), hora_evolucion: new Date().toTimeString().slice(0,5), autor: { nombre: currentUser.nombre }, _pendiente: true };
      setEvoluciones(prev => [temp, ...prev]);
    } else {
      setEvoluciones(prev => [result.evolucion, ...prev]);
    }
    setEvoLibre("");
    setEvoEstructurada({ subjetivo: "", objetivo: "", examen: "", indicaciones: "" });
    setDiuresis({ cantidad: "", via: "", caracteristicas: "" });
    setDrenaje({ activo: false, tipo: "", aspiracion: "", localizacion: "", cantidad: "", caracteristicas: "" });
  };

  const eliminarEvo = async (evoId) => {
    if (!confirm("¿Eliminar esta evolución?")) return;
    const result = await eliminarEvolucion(evoId);
    if (!result.ok) return alert("Error: " + result.error);
    setEvoluciones(prev => prev.filter(e => e.id !== evoId));
  };
  const [editandoEvoId, setEditandoEvoId] = useState(null);
  const [editTexto, setEditTexto] = useState("");
  const abrirEdicionEvo = (ev) => { setEditandoEvoId(ev.id); setEditTexto(ev.texto || ""); };
  const guardarEdicionEvo = async (ev) => {
    const t = editTexto.trim();
    if (!t || t === ev.texto) { setEditandoEvoId(null); return; }
    const { error } = await supabase.from("evoluciones").update({ texto: t }).eq("id", ev.id);
    if (error) return alert("No se pudo editar: " + error.message);
    setEvoluciones(prev => prev.map(e => e.id === ev.id ? { ...e, texto: t } : e));
    setEditandoEvoId(null);
  };

  // ============================================================
  // CRUD EXAMENES
  // ============================================================

  const guardarExamen = async () => {
    // El "nombre" puede venir del desplegable según el tipo
    let nombreExamen = nuevoEx.nombre.trim();
    if (nuevoEx.tipo === "Anatomía patológica" && nuevoEx.lugar) nombreExamen = nombreExamen || `Biopsia ${nuevoEx.lugar}`;
    if (nuevoEx.tipo === "Cultivo" && nuevoEx.tipoCultivo) nombreExamen = nombreExamen || nuevoEx.tipoCultivo;
    if (!nombreExamen) return alert("Selecciona o ingresa el examen");
    if (!nuevoEx.fecha_examen) return alert("Ingresa la fecha");

    // Datos estructurados según el tipo
    const estructurados = {};
    if (nuevoEx.pirads) estructurados.pirads = nuevoEx.pirads;
    if (nuevoEx.pesoProstatico) estructurados.pesoProstatico = nuevoEx.pesoProstatico;
    if (nuevoEx.tipo === "Anatomía patológica" && nuevoEx.lugar) estructurados.lugar = nuevoEx.lugar;
    if (nuevoEx.tipo === "Cultivo" && nuevoEx.tipoCultivo) estructurados.tipoCultivo = nuevoEx.tipoCultivo;
    // Germen y antibiograma del cultivo
    if (nuevoEx.tipo === "Cultivo") {
      const germenFinal = nuevoEx.germen === "Otro" ? (nuevoEx.germenOtro || "").trim() : nuevoEx.germen;
      if (germenFinal) estructurados.germen = germenFinal;
      if (antibiograma.length > 0) estructurados.antibiograma = antibiograma;
    }
    // Parámetros de laboratorio (solo los que se llenaron)
    if (PARAMETROS_LAB[nuevoEx.nombre]) {
      const params = {};
      PARAMETROS_LAB[nuevoEx.nombre].forEach(p => {
        if (paramsLab[p.key] !== undefined && paramsLab[p.key] !== "") {
          params[p.key] = paramsLab[p.key];
        }
      });
      if (Object.keys(params).length > 0) estructurados.parametros = params;
    }
    // Litiasis y tumores
    if (litiasis.length > 0) estructurados.litiasis = litiasis;
    if (tumores.length > 0) estructurados.tumores = tumores;

    const datos = {
      tipo: nuevoEx.tipo,
      nombre: nombreExamen,
      resultado: nuevoEx.resultado.trim() || null,
      fecha_examen: nuevoEx.fecha_examen,
      datos_estructurados: estructurados,
    };

    const result = await crearExamen(seleccionado.id, currentUser.id, datos);
    if (!result.ok) {
      // Sin conexión: guarda local y encola para sincronizar al reconectar.
      encolar("crearExamen", { pacienteId: seleccionado.id, autorId: currentUser.id, datos });
      const temp = normalizarExamen({ id: `tmp_${Date.now()}`, paciente_id: seleccionado.id, autor_id: currentUser.id, tipo: datos.tipo, nombre: datos.nombre, resultado: datos.resultado || null, fecha_examen: datos.fecha_examen, datos_estructurados: datos.datos_estructurados || {}, autor: { nombre: currentUser.nombre }, _pendiente: true });
      setExamenes(prev => [temp, ...prev]);
    } else {
      // Recargar desde la base para asegurar que los datos estructurados se lean correctamente
      const recarga = await listarExamenes(seleccionado.id);
      if (recarga.ok) setExamenes(recarga.examenes.map(normalizarExamen));
      else setExamenes(prev => [normalizarExamen(result.examen), ...prev]);
    }

    // Copiar automáticamente el examen a la evolución del día
    const partesEx = [];
    partesEx.push(`${nuevoEx.tipo}: ${nombreExamen}`);
    if (estructurados.pirads) partesEx.push(`PI-RADS ${estructurados.pirads}`);
    if (estructurados.pesoProstatico) partesEx.push(`Próstata ${estructurados.pesoProstatico} g`);
    if (estructurados.lugar) partesEx.push(`Lugar: ${estructurados.lugar}`);
    if (estructurados.tipoCultivo) partesEx.push(estructurados.tipoCultivo);
    if (estructurados.germen) partesEx.push("Germen: " + estructurados.germen);
    if (estructurados.antibiograma) {
      const abg = estructurados.antibiograma.map(a => `${a.atb} (${a.sens?.[0] || "?"})`).join(", ");
      if (abg) partesEx.push("Antibiograma: " + abg);
    }
    if (estructurados.parametros) {
      const ps = Object.entries(estructurados.parametros).map(([k,v]) => {
        const def = (PARAMETROS_LAB[nuevoEx.nombre] || []).find(p => p.key === k);
        return `${def?.label || k}: ${v}${def?.unidad ? " "+def.unidad : ""}`;
      });
      if (ps.length) partesEx.push(ps.join(", "));
    }
    if (estructurados.litiasis) {
      estructurados.litiasis.forEach(l => {
        partesEx.push("Litiasis: " + [l.ubicacion,l.tercio,l.lateralidad,l.tamano?`${l.tamano} mm`:"",l.uh?`${l.uh} UH`:""].filter(Boolean).join(" · "));
      });
    }
    if (estructurados.tumores) {
      estructurados.tumores.forEach(t => {
        partesEx.push("Tumor: " + [t.organo,t.sublocalizacion,t.tamano?`${t.tamano} cm`:""].filter(Boolean).join(" · "));
      });
    }
    if (nuevoEx.resultado.trim()) partesEx.push(nuevoEx.resultado.trim());
    const textoEvo = `🧪 EXAMEN (${nuevoEx.fecha_examen}):\n${partesEx.join("\n")}`;
    const evoResult = await crearEvolucion(seleccionado.id, currentUser.id, textoEvo, "examen");
    if (evoResult.ok) setEvoluciones(prev => [evoResult.evolucion, ...prev]);
    else encolar("crearEvolucion", { pacienteId: seleccionado.id, autorId: currentUser.id, texto: textoEvo, tipo: "examen" });

    setNuevoEx({ tipo: "Laboratorio", nombre: "", resultado: "", fecha_examen: new Date().toISOString().slice(0, 10), pirads: "", pesoProstatico: "", lugar: "", tipoCultivo: "", germen: "", germenOtro: "" });
    setParamsLab({});
    setLitiasis([]);
    setFormLitiasis({ ubicacion: "", tercio: "", lateralidad: "", tamano: "", uh: "" });
    setTumores([]);
    setFormTumor({ organo: "", sublocalizacion: "", tamano: "" });
    setAntibiograma([]);
    setFormAtb({ atb: "", sens: "" });
  };

  const eliminarEx = async (exId) => {
    if (!confirm("¿Eliminar este examen?")) return;
    const result = await eliminarExamen(exId);
    if (!result.ok) return alert("Error: " + result.error);
    setExamenes(prev => prev.filter(e => e.id !== exId));
  };

  // ============================================================
  // CRUD SERVICIOS
  // ============================================================

  const agregarServicio = async () => {
    if (!nuevoServicio.trim()) return;
    if (esEquipo) {
      const result = await crearServicioEquipo(contexto, currentUser.id, nuevoServicio.trim(), serviciosEquipo.length);
      if (!result.ok) return alert(result.error);
      setServiciosEquipo(prev => [...prev, result.servicio]);
    } else {
      const result = await crearServicio(currentUser.id, nuevoServicio.trim());
      if (!result.ok) return alert(result.error);
      setMisServiciosLista(prev => [...prev, result.servicio]);
    }
    setNuevoServicio("");
  };

  const quitarServicio = async (servicio) => {
    // Acepta el objeto servicio (o un id suelto por compatibilidad).
    const servicioId = typeof servicio === "object" && servicio ? servicio.id : servicio;
    const nombre = typeof servicio === "object" && servicio ? servicio.nombre : null;

    // Pacientes que "cuelgan" de este servicio (por nombre). Se eliminan junto
    // con el servicio para que no reaparezca luego como "servicio sin formalizar".
    const pacientesDelServicio = nombre ? pacientes.filter(p => p.servicio === nombre) : [];
    if (pacientesDelServicio.length > 0) {
      if (!confirm(`El servicio "${nombre}" tiene ${pacientesDelServicio.length} paciente(s) asignado(s).\n\nAl eliminar el servicio se ELIMINARÁN también esos pacientes con sus evoluciones y exámenes. Esta acción no se puede deshacer.\n\n¿Continuar?`)) return;
    } else {
      if (!confirm(`¿Eliminar el servicio "${nombre || ""}"?`)) return;
    }

    // 1) Eliminar los pacientes del servicio
    const idsEliminados = [];
    for (const p of pacientesDelServicio) {
      const rp = await eliminarPaciente(p.id);
      if (rp.ok) idsEliminados.push(p.id);
    }
    if (idsEliminados.length > 0 && setPacientes) {
      setPacientes(prev => prev.filter(p => !idsEliminados.includes(p.id)));
    }

    // 2) Eliminar el servicio propiamente tal
    if (esEquipo) {
      const result = await eliminarServicioEquipo(servicioId);
      if (!result.ok) return alert("Error: " + result.error);
      setServiciosEquipo(prev => prev.filter(s => s.id !== servicioId));
    } else {
      const result = await eliminarServicio(servicioId);
      if (!result.ok) return alert("Error: " + result.error);
      setMisServiciosLista(prev => prev.filter(s => s.id !== servicioId));
    }
  };

  // Crear un servicio desde el formulario de paciente y dejarlo seleccionado.
  // En equipo queda disponible para todos; en personal, para mí.
  const crearServicioInline = async () => {
    const nombre = nuevoServicioInline.trim();
    if (!nombre) return;
    setGuardandoServicioInline(true);
    try {
      if (esEquipo) {
        const r = await crearServicioEquipo(contexto, currentUser.id, nombre, serviciosEquipo.length);
        if (!r.ok) { alert(r.error); return; }
        setServiciosEquipo(prev => [...prev, r.servicio]);
      } else {
        const r = await crearServicio(currentUser.id, nombre);
        if (!r.ok) { alert(r.error); return; }
        setMisServiciosLista(prev => [...prev, r.servicio]);
      }
      setNuevo(n => ({ ...n, servicio: nombre }));   // queda elegido
      setNuevoServicioInline("");
      setCreandoServicioInline(false);
    } finally {
      setGuardandoServicioInline(false);
    }
  };

  // Migrar mis servicios personales a este equipo (botón en el panel)
  const migrarServicios = async () => {
    if (!esEquipo) return;
    const nombres = misServiciosLista.map(s => s.nombre);
    if (nombres.length === 0) return alert("No tienes servicios personales para copiar.");
    const result = await migrarServiciosAlEquipo(contexto, currentUser.id, nombres);
    if (!result.ok) return alert("Error: " + result.error);
    if (result.migrados === 0) return alert("El equipo ya tenía todos tus servicios.");
    setServiciosEquipo(prev => [...prev, ...result.servicios]);
    alert(`Se copiaron ${result.migrados} servicio(s) al equipo.`);
  };

  // ============================================================
  // RENDER: VISTA NUEVO PACIENTE
  // ============================================================

  if (vista === "nuevo") {
    return (
      <div style={{padding:"20px",overflowY:"auto"}}>
        <button onClick={()=>{setVista("lista");setError("");}} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:"var(--fs-2)",cursor:"pointer",marginBottom:12,padding:0}}>← Volver</button>
        <div style={{fontSize:16,fontWeight:600,color:"var(--texto)",marginBottom:14}}>Nuevo paciente {esEquipo && `en equipo "${equipoActual?.nombre}"`}</div>

        {/* Captura por foto: autocompleta desde la hoja de ingreso */}
        <div style={{textAlign:"center",border:"1.5px dashed var(--borde)",borderRadius:12,padding:"14px",marginBottom:14,background:"var(--fondo-suave)"}}>
          <input ref={inputFotoIngresoRef} type="file" accept="image/*,application/pdf" multiple style={{display:"none"}} onChange={onFotoNuevoIngreso}/>
          {extrayendoIngreso ? (
            <div style={{fontSize:"var(--fs-2)",color:"var(--texto-sec)"}}>🔍 Leyendo la hoja de ingreso…</div>
          ) : (
            <>
              <div style={{fontSize:24,marginBottom:4}}>📷</div>
              <div style={{fontSize:"var(--fs-2)",fontWeight:600,color:"var(--texto)",marginBottom:2}}>Crear desde foto del ingreso</div>
              <div style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)",marginBottom:10}}>La IA extrae diagnóstico, antecedentes, exámenes e historia. Hasta 3 fotos.</div>
              <button onClick={()=>inputFotoIngresoRef.current?.click()} style={{padding:"8px 16px",fontSize:"var(--fs-2)",fontWeight:600,background:"var(--primario)",color:"var(--texto-inv)",border:"none",borderRadius:8,cursor:"pointer"}}>Tomar / subir foto</button>
            </>
          )}
        </div>
        {extraccionMsg && <div style={{fontSize:"var(--fs-1)",padding:"8px 10px",marginBottom:12,borderRadius:8,background:"var(--exito-bg)",border:"0.5px solid var(--exito-borde)",color:"var(--exito)"}}>{extraccionMsg}</div>}

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <div>
            <label style={labelStyle}>Nombre o iniciales</label>
            <input value={nuevo.iniciales} onChange={e=>setNuevo({...nuevo,iniciales:e.target.value.slice(0,100)})} placeholder="Juan Pérez Mora o JPM" style={inputStyle} maxLength={100}/>
          </div>
          <div>
            <label style={labelStyle}>Edad</label>
            <input type="number" value={nuevo.edad} onChange={e=>setNuevo({...nuevo,edad:e.target.value})} placeholder="65" style={inputStyle}/>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <div>
            <label style={labelStyle}>Ficha clínica (FC)</label>
            <input value={nuevo.ficha_clinica} onChange={e=>setNuevo({...nuevo,ficha_clinica:e.target.value.slice(0,30)})} placeholder="123456" style={inputStyle}/>
          </div>
          <div>
            <label style={labelStyle}>RUT</label>
            <input value={nuevo.rut} onChange={e=>setNuevo({...nuevo,rut:e.target.value.slice(0,15)})} placeholder="12.345.678-9" style={inputStyle}/>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <div>
            <label style={labelStyle}>Sexo</label>
            <select value={nuevo.sexo} onChange={e=>setNuevo({...nuevo,sexo:e.target.value})} style={inputStyle}>
              <option value="M">Masculino</option>
              <option value="F">Femenino</option>
              <option value="Otro">Otro</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Cama</label>
            <input value={nuevo.cama} onFocus={e=>e.target.select()} onChange={e=>setNuevo({...nuevo,cama:e.target.value})} placeholder="3-12" style={inputStyle}/>
          </div>
        </div>

        <label style={labelStyle}>Servicio / Piso</label>
        {serviciosDisponibles.length > 0 ? (
          <select
            value={creandoServicioInline ? "__nuevo__" : nuevo.servicio}
            onChange={e => {
              if (e.target.value === "__nuevo__") { setCreandoServicioInline(true); setNuevo({...nuevo, servicio: ""}); }
              else { setCreandoServicioInline(false); setNuevo({...nuevo, servicio: e.target.value}); }
            }}
            style={inputStyle}
          >
            <option value="">Selecciona...</option>
            {serviciosDisponibles.map(s => <option key={s} value={s}>{s}{serviciosSinFormalizar.includes(s) ? " (no formalizado)" : ""}</option>)}
            <option value="__nuevo__">➕ Crear nuevo servicio…</option>
          </select>
        ) : (
          // Sin servicios aún: entra directo al modo "crear nuevo"
          <div style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)",marginBottom:6,lineHeight:1.4}}>
            {esEquipo ? "Este equipo aún no tiene servicios. Crea el primero:" : "Aún no tienes servicios. Crea el primero:"}
          </div>
        )}
        {esEquipo && nuevo.servicio && serviciosSinFormalizar.includes(nuevo.servicio) && (
          <div style={{fontSize:"var(--fs-xs)",color:"var(--texto-ter)",marginTop:4,lineHeight:1.4}}>
            «{nuevo.servicio}» ya lo usan otros pacientes pero no está en la lista formal del equipo.{" "}
            <button type="button" onClick={async()=>{const r=await crearServicioEquipo(contexto,currentUser.id,nuevo.servicio,serviciosEquipo.length); if(r.ok) setServiciosEquipo(p=>[...p,r.servicio]); else alert(r.error);}} style={{background:"none",border:"none",color:"var(--primario)",textDecoration:"underline",cursor:"pointer",fontSize:"var(--fs-xs)",padding:0}}>Formalizarlo ahora</button>
          </div>
        )}

        {(creandoServicioInline || serviciosDisponibles.length === 0) && (
          <div style={{display:"flex",gap:6,marginTop:6}}>
            <input
              autoFocus
              value={nuevoServicioInline}
              onChange={e => setNuevoServicioInline(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); crearServicioInline(); } }}
              placeholder="Ej: MQ 1, Urología 3er piso"
              style={{flex:1, ...inputStyle}}
            />
            <button
              type="button"
              onClick={crearServicioInline}
              disabled={!nuevoServicioInline.trim() || guardandoServicioInline}
              style={{padding:"9px 14px",fontSize:"var(--fs-2)",fontWeight:600,background:nuevoServicioInline.trim()?"var(--primario)":"var(--borde)",color:"var(--texto-inv)",border:"none",borderRadius:8,cursor:"pointer",whiteSpace:"nowrap"}}
            >{guardandoServicioInline ? "…" : "Crear"}</button>
            {serviciosDisponibles.length > 0 && (
              <button type="button" onClick={()=>{setCreandoServicioInline(false); setNuevoServicioInline("");}} style={{padding:"9px 10px",fontSize:"var(--fs-2)",background:"none",border:"none",color:"var(--texto-ter)",cursor:"pointer"}}>✕</button>
            )}
          </div>
        )}
        {esEquipo && (creandoServicioInline || serviciosDisponibles.length === 0) && (
          <div style={{fontSize:"var(--fs-xs)",color:"var(--texto-ter)",marginTop:4}}>
            Al crearlo, lo verán todos los miembros del equipo.
          </div>
        )}

        <label style={labelStyle}>Fecha ingreso</label>
        <input type="date" value={nuevo.fecha_ingreso} onChange={e=>setNuevo({...nuevo,fecha_ingreso:e.target.value})} style={inputStyle}/>

        <label style={labelStyle}>Diagnóstico</label>
        <textarea value={nuevo.diagnostico} onChange={e=>setNuevo({...nuevo,diagnostico:e.target.value})} placeholder="Diagnóstico principal" rows={2} style={{...inputStyle,resize:"vertical"}}/>

        <label style={labelStyle}>Plan de manejo (opcional)</label>
        <textarea value={nuevo.plan_manejo} onChange={e=>setNuevo({...nuevo,plan_manejo:e.target.value})} placeholder="Plan inicial" rows={3} style={{...inputStyle,resize:"vertical"}}/>

        <label style={labelStyle}>Historia / ingreso (opcional)</label>
        <textarea value={nuevo.historia} onChange={e=>setNuevo({...nuevo,historia:e.target.value})} placeholder="Se autocompleta desde la foto del ingreso. Puedes editarla." rows={4} style={{...inputStyle,resize:"vertical"}}/>

        {error && <div style={{fontSize:"var(--fs-1)",color:"var(--peligro)",background:"var(--peligro-bg)",padding:"8px 10px",borderRadius:6,marginBottom:8}}>{error}</div>}

        <button onClick={guardarNuevo} style={{...btnPrimary, marginTop:0}}>Guardar paciente</button>
      </div>
    );
  }

  // ============================================================
  // RENDER: VISTA SERVICIOS
  // ============================================================

  if (vista === "servicios") {
    const permiteDrag = true; // el orden se comparte: en equipo se guarda en el servidor
    return (
      <div style={{padding:"20px",overflowY:"auto"}}>
        <button onClick={()=>setVista("lista")} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:"var(--fs-2)",cursor:"pointer",marginBottom:12,padding:0}}>← Volver</button>
        <div style={{fontSize:16,fontWeight:600,color:"var(--texto)",marginBottom:6}}>
          ⚙️ {esEquipo ? `Servicios de ${equipoActual?.nombre || "equipo"}` : "Mis servicios"}
        </div>
        <div style={{fontSize:"var(--fs-1)",color:"var(--texto-ter)",marginBottom:14}}>
          {esEquipo
            ? "Estos servicios los ven, crean y eliminan todos los miembros del equipo. Mantén presionado ☰ y arrastra para reordenar: el orden se comparte con todos."
            : "Configura los servicios/pisos del hospital donde atiendes. Mantén presionado ☰ y arrastra para reordenarlos."}
        </div>

        {esEquipo && misServiciosLista.length > 0 && (
          <button onClick={migrarServicios} style={{width:"100%",marginBottom:12,padding:"9px 12px",fontSize:"var(--fs-1)",fontWeight:500,background:"var(--fondo-suave)",color:"var(--primario)",border:"0.5px dashed var(--primario)",borderRadius:8,cursor:"pointer"}}>
            ⬆️ Copiar mis {misServiciosLista.length} servicio(s) personales a este equipo
          </button>
        )}
        {esEquipo && serviciosSinFormalizar.length > 0 && (
          <button onClick={async()=>{
            const r = await crearServiciosEquipoBulk(contexto, currentUser.id, serviciosSinFormalizar);
            if (!r.ok) return alert(r.error);
            setServiciosEquipo(prev => [...prev, ...r.servicios]);
          }} style={{width:"100%",marginBottom:12,padding:"9px 12px",fontSize:"var(--fs-1)",fontWeight:500,background:"var(--fondo-suave)",color:"var(--primario)",border:"0.5px dashed var(--primario)",borderRadius:8,cursor:"pointer"}}>
            📋 Formalizar {serviciosSinFormalizar.length} servicio(s) ya usados en pacientes ({serviciosSinFormalizar.join(", ")})
          </button>
        )}

        <div style={{display:"flex",gap:6,marginBottom:14}}>
          <input value={nuevoServicio} onChange={e=>setNuevoServicio(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")agregarServicio();}} placeholder="Ej: Cirugía 3er piso" style={{flex:1,padding:"9px 12px",fontSize:"var(--fs-2)",borderRadius:8,border:"0.5px solid var(--borde)",outline:"none"}}/>
          <button onClick={agregarServicio} disabled={!nuevoServicio.trim()} style={{padding:"9px 14px",fontSize:"var(--fs-2)",fontWeight:500,background:nuevoServicio.trim()?"var(--primario)":"var(--borde)",color:"var(--texto-inv)",border:"none",borderRadius:8,cursor:"pointer"}}>Agregar</button>
        </div>

        {serviciosActivos.length === 0 ? (
          <div style={{textAlign:"center",padding:"30px 16px",color:"var(--texto-ter)",fontSize:"var(--fs-2)"}}>
            {esEquipo
              ? (serviciosSinFormalizar.length > 0
                  ? "Ya hay servicios en uso arriba ↑ — formalízalos con el botón, o agrega uno nuevo."
                  : "Este equipo aún no tiene servicios. Agrégalos aquí o copia los tuyos.")
              : "No tienes servicios configurados."}
          </div>
        ) : (
          <div ref={serviciosListRef} style={{display:"flex",flexDirection:"column",gap:6,position:"relative"}}>
            {serviciosActivos.map((s, idx) => {
              const arrastrando = permiteDrag && dragServicio?.id === s.id;
              return (
                <div key={s.id}
                  style={{
                    display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,
                    background:"var(--superficie)",borderRadius:8,padding:"10px 12px",
                    border: arrastrando ? "1px solid var(--primario)" : "0.5px solid var(--borde)",
                    boxShadow: arrastrando ? "0 10px 24px rgba(15,23,42,0.28)" : "none",
                    transform: arrastrando ? `translateY(${dragServicio.dy}px) scale(1.02)` : "none",
                    zIndex: arrastrando ? 5 : 1,
                    position:"relative",
                    transition: arrastrando ? "none" : "transform .15s",
                    opacity: 1,
                  }}>
                  <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
                    {permiteDrag && (
                      <span
                        onPointerDown={(e)=>iniciarDragServicio(e, s, idx)}
                        style={{cursor:"grab",touchAction:"none",fontSize:16,color:"var(--texto-ter)",padding:"4px 6px",userSelect:"none",flexShrink:0}}
                        title="Arrastra para reordenar"
                      >☰</span>
                    )}
                    <div style={{fontSize:"var(--fs-2)",color:"var(--texto)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.nombre}</div>
                  </div>
                  <button onClick={()=>quitarServicio(s)} style={{background:"none",border:"none",color:"var(--peligro)",cursor:"pointer",fontSize:"var(--fs-2)",flexShrink:0}}>🗑</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ============================================================
  // RENDER: VISTA FICHA PACIENTE
  // ============================================================

  if (vista === "ficha" && seleccionado) {
    const esCreador = seleccionado.medico_id === currentUser.id;
    return (
      <div style={{padding:"16px",overflowY:"auto",display:"flex",flexDirection:"column"}}>
        {ordenTxAbierta && <OrdenTransfusionModal paciente={seleccionado} currentUser={currentUser} examenes={examenes} onClose={()=>setOrdenTxAbierta(false)} />}
        {fotoExamenesAbierto && <FotoExamenesModal paciente={seleccionado} currentUser={currentUser} onGuardado={async()=>{ const r = await listarExamenes(seleccionado.id); if (r.ok) setExamenes(r.examenes.map(normalizarExamen)); }} onClose={()=>setFotoExamenesAbierto(false)} />}
        {plantillasAbierto && <PlantillasExamenesModal paciente={seleccionado} currentUser={currentUser} onGuardado={async()=>{ const r = await listarExamenes(seleccionado.id); if (r.ok) setExamenes(r.examenes.map(normalizarExamen)); }} onClose={()=>setPlantillasAbierto(false)} />}
        <button onClick={()=>{setVista("lista");setSeleccionado(null);}} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:"var(--fs-2)",cursor:"pointer",marginBottom:10,padding:0}}>← Volver a la lista</button>

       {/* Cabecera */}
<div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"14px",marginBottom:12}}>
  {editandoFicha ? (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      <div style={{display:"flex",gap:8}}>
        <div style={{flex:2}}>
          <label style={labelStyle}>Iniciales / Nombre</label>
          <input value={editForm.iniciales} onChange={e=>setEditForm({...editForm,iniciales:e.target.value})} style={inputStyle}/>
        </div>
        <div style={{flex:1}}>
          <label style={labelStyle}>Edad</label>
          <input type="number" value={editForm.edad} onChange={e=>setEditForm({...editForm,edad:e.target.value})} style={inputStyle}/>
        </div>
        <div style={{flex:1}}>
          <label style={labelStyle}>Sexo</label>
          <select value={editForm.sexo} onChange={e=>setEditForm({...editForm,sexo:e.target.value})} style={inputStyle}>
            <option value="M">M</option>
            <option value="F">F</option>
          </select>
        </div>
      </div>
      <div style={{display:"flex",gap:8}}>
        <div style={{flex:1}}>
          <label style={labelStyle}>Ficha clínica (FC)</label>
          <input value={editForm.ficha_clinica || ""} onChange={e=>setEditForm({...editForm,ficha_clinica:e.target.value.slice(0,30)})} style={inputStyle}/>
        </div>
        <div style={{flex:1}}>
          <label style={labelStyle}>RUT</label>
          <input value={editForm.rut || ""} onChange={e=>setEditForm({...editForm,rut:e.target.value.slice(0,15)})} style={inputStyle}/>
        </div>
      </div>
      <div style={{display:"flex",gap:8}}>
        <div style={{flex:1}}>
          <label style={labelStyle}>Cama</label>
          <input value={editForm.cama} onFocus={e=>e.target.select()} onChange={e=>setEditForm({...editForm,cama:e.target.value})} placeholder="3-12" style={inputStyle}/>
        </div>
        <div style={{flex:2}}>
          <label style={labelStyle}>Servicio / Piso</label>
          {serviciosDisponibles.length > 0 ? (
            <select value={editForm.servicio} onChange={e=>setEditForm({...editForm,servicio:e.target.value})} style={inputStyle}>
              <option value="">Selecciona...</option>
              {serviciosDisponibles.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <input value={editForm.servicio} onChange={e=>setEditForm({...editForm,servicio:e.target.value})} style={inputStyle}/>
          )}
        </div>
      </div>
      <div>
        <label style={labelStyle}>Diagnóstico</label>
        <textarea value={editForm.diagnostico} onChange={e=>setEditForm({...editForm,diagnostico:e.target.value})} rows={2} style={{...inputStyle,resize:"vertical"}}/>
      </div>
      <div>
        <label style={labelStyle}>Antecedentes</label>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {(() => {
            const PRESET = ["HTA","DM 2","Hipotiroidismo","Cardiópata","IAM","ACV","Obesidad"];
            const lista = Array.isArray(editForm.antecedentes) ? editForm.antecedentes : [];
            const personalizados = lista.filter(a => !PRESET.includes(a));
            return (
              <>
                {PRESET.map(ant => {
                  const activo = lista.includes(ant);
                  return (
                    <button key={ant} type="button" onClick={()=>{
                      const nueva = activo ? lista.filter(x=>x!==ant) : [...lista, ant];
                      setEditForm({...editForm, antecedentes: nueva});
                    }} style={{padding:"5px 11px",fontSize:"var(--fs-2)",borderRadius:14,cursor:"pointer",border:activo?"none":"0.5px solid var(--borde)",background:activo?"#f2a03f":"var(--superficie)",color:activo?"var(--texto-inv)":"var(--texto-ter)",fontWeight:activo?600:400}}>
                      {ant}
                    </button>
                  );
                })}
                {personalizados.map(ant => (
                  <button key={ant} type="button" title="Clic para quitar" onClick={()=>setEditForm({...editForm, antecedentes: lista.filter(x=>x!==ant)})} style={{padding:"5px 11px",fontSize:"var(--fs-2)",borderRadius:14,cursor:"pointer",border:"none",background:"#f2a03f",color:"var(--texto-inv)",fontWeight:600}}>
                    {ant} ✕
                  </button>
                ))}
              </>
            );
          })()}
        </div>
        <div style={{display:"flex",gap:6,marginTop:8}}>
          <input value={otroAntecedente} onChange={e=>setOtroAntecedente(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&otroAntecedente.trim()){const lista=Array.isArray(editForm.antecedentes)?editForm.antecedentes:[];if(!lista.includes(otroAntecedente.trim()))setEditForm({...editForm,antecedentes:[...lista,otroAntecedente.trim()]});setOtroAntecedente("");}}} placeholder="Otro antecedente (ej: EPOC, ERC etapa 3...)" style={{...inputStyle,marginBottom:0,flex:1}}/>
          <button type="button" disabled={!otroAntecedente.trim()} onClick={()=>{const lista=Array.isArray(editForm.antecedentes)?editForm.antecedentes:[];if(!lista.includes(otroAntecedente.trim()))setEditForm({...editForm,antecedentes:[...lista,otroAntecedente.trim()]});setOtroAntecedente("");}} style={{padding:"0 16px",fontSize:"var(--fs-2)",background:"var(--primario)",color:"var(--texto-inv)",border:"none",borderRadius:8,cursor:"pointer",fontWeight:600,opacity:otroAntecedente.trim()?1:0.5}}>+ Agregar</button>
        </div>
      </div>
      <div>
        <label style={labelStyle}>Alergias</label>
        <input value={editForm.alergias || ""} onChange={e=>setEditForm({...editForm,alergias:e.target.value})} placeholder="Ej: Penicilina, AINEs, medio de contraste..." style={inputStyle}/>
      </div>
      <div>
        <label style={labelStyle}>Plan de manejo (opcional)</label>
        <textarea value={editForm.plan_manejo} onChange={e=>setEditForm({...editForm,plan_manejo:e.target.value})} rows={2} style={{...inputStyle,resize:"vertical"}}/>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={guardarEdicion} style={{...btnPrimary,marginTop:0,flex:1}}>Guardar cambios</button>
        <button onClick={()=>setEditandoFicha(false)} style={{padding:"9px 14px",fontSize:"var(--fs-2)",background:"var(--superficie)",color:"var(--texto-ter)",border:"0.5px solid var(--borde)",borderRadius:8,cursor:"pointer"}}>Cancelar</button>
      </div>
    </div>
  ) : (
    <>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,marginBottom:8}}>
        <div>
          <div style={{fontSize:18,fontWeight:700,color:"var(--texto)"}}>{seleccionado.iniciales} <span style={{fontSize:20,fontWeight:700,color:seleccionado.sexo==="F"?"var(--chip-rosa)":"var(--primario)"}}>{seleccionado.sexo==="F"?"♀":"♂"}</span></div>
          <div style={{fontSize:16,fontWeight:600,color:"var(--texto-sec)",marginTop:4}}>
            {seleccionado.edad} años · Cama {seleccionado.cama || "por asignar"} · {seleccionado.servicio}
          </div>
          {(seleccionado.ficha_clinica || seleccionado.rut) && (
            <div style={{fontSize:"var(--fs-2)",color:"var(--texto-ter)",marginTop:3}}>
              {seleccionado.ficha_clinica ? `FC: ${seleccionado.ficha_clinica}` : ""}{seleccionado.ficha_clinica && seleccionado.rut ? " · " : ""}{seleccionado.rut ? `RUT: ${seleccionado.rut}` : ""}
            </div>
          )}
          <div style={{fontSize:"var(--fs-2)",color:"var(--texto-ter)",marginTop:4}}>Ingreso: {fmtFecha(seleccionado.fecha_ingreso)}</div>
        </div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          <button onClick={iniciarEdicion} title="Editar paciente" aria-label="Editar paciente" style={{padding:"5px 9px",fontSize:"var(--fs-2)",lineHeight:1,background:"var(--superficie)",color:"var(--primario)",border:"0.5px solid var(--borde)",borderRadius:6,cursor:"pointer",fontWeight:500,display:"none"}}>✏️</button>
          {!soloLectura && <button onClick={()=>setOrdenTxAbierta(true)} title="Orden de transfusión" aria-label="Orden de transfusión" style={{padding:"5px 10px",fontSize:"var(--fs-0)",background:"var(--superficie)",color:"var(--peligro)",border:"0.5px solid var(--borde)",borderRadius:6,cursor:"pointer",fontWeight:500,display:"none"}}>🩸 Transfusión</button>}
          {esCreador && (
            <button onClick={()=>eliminarPacienteHandler(seleccionado)} style={{padding:"5px 10px",fontSize:"var(--fs-0)",background:"var(--superficie)",color:"var(--peligro)",border:"0.5px solid var(--peligro-borde)",borderRadius:6,cursor:"pointer"}}>🗑</button>
          )}
        </div>
      </div>
      {extraccionMsg && <div style={{fontSize:"var(--fs-1)",padding:"8px 10px",marginTop:8,borderRadius:8,background:"var(--exito-bg)",border:"0.5px solid var(--exito-borde)",color:"var(--exito)"}}>{extraccionMsg}</div>}
      <div style={{fontSize:"var(--fs-2)",color:"var(--texto)",marginTop:8,padding:"10px 12px",background:"var(--fondo-suave)",borderRadius:6}}>
        <strong>Diagnóstico:</strong> {seleccionado.diagnostico}
      </div>
      {/* Estado clínico */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:6,padding:"10px 12px",background:"var(--fondo-suave)",borderRadius:6}}>
        <span style={{fontSize:"var(--fs-2)",color:"var(--texto)",fontWeight:600}}>Estado del paciente</span>
        <select value={seleccionado.estado_clinico || ""} onChange={e=>cambiarEstadoClinico(e.target.value)} style={{fontSize:"var(--fs-2)",padding:"5px 10px",borderRadius:6,border:"0.5px solid var(--borde)",background:"var(--superficie)",color:"var(--texto)",cursor:"pointer"}}>
          <option value="">Sin definir</option>
          <option value="estable">🟢 Estable</option>
          <option value="regular">🟡 Regular</option>
          <option value="cuidado">🔴 De cuidado</option>
        </select>
      </div>
      {/* Operado + agregar cirugía */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:6,padding:"10px 12px",background:seleccionado.operado?"var(--exito-bg)":"var(--fondo-suave)",borderRadius:6,gap:10,flexWrap:"wrap"}}>
        <span style={{fontSize:"var(--fs-2)",color:"var(--texto)",fontWeight:600}}>🔪 Operado</span>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {seleccionado.operado && (
            <button onClick={abrirFormCirugia} style={{fontSize:"var(--fs-1)",background:"var(--exito)",color:"var(--texto-inv)",border:"none",borderRadius:6,padding:"5px 10px",cursor:"pointer",fontWeight:500}}>+ Agregar cirugía</button>
          )}
          <button onClick={toggleOperado} style={{width:46,height:26,borderRadius:13,border:"none",cursor:"pointer",background:seleccionado.operado?"var(--exito)":"var(--borde-suave)",position:"relative",transition:"background 0.2s",padding:0}}>
            <span style={{position:"absolute",top:3,left:seleccionado.operado?23:3,width:20,height:20,borderRadius:"50%",background:"var(--superficie)",transition:"left 0.2s",boxShadow:"0 1px 2px rgba(0,0,0,0.2)"}}/>
          </button>
        </div>
      </div>
      {/* Formulario para agregar cirugía */}
      {seleccionado.operado && formCirugia && (
        <div style={{marginTop:6,padding:"12px",background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:6}}>
          <div style={{fontSize:"var(--fs-2)",fontWeight:600,color:"var(--texto)",marginBottom:8}}>Nueva cirugía</div>
          <label style={labelStyle}>Fecha de la cirugía</label>
          <input type="date" value={formCirugia.fecha} onChange={e=>setFormCirugia({...formCirugia, fecha:e.target.value})} style={inputStyle}/>
          <label style={labelStyle}>Cirugía realizada</label>
          <input value={formCirugia.nombre} onChange={e=>setFormCirugia({...formCirugia, nombre:e.target.value})} placeholder="Ej: RTU vesical, Nefrectomía..." style={inputStyle}/>
          <div style={{display:"flex",gap:8,marginTop:4}}>
            <button onClick={guardarCirugia} style={{...btnPrimary,marginTop:0,flex:1}}>Guardar cirugía</button>
            <button onClick={()=>setFormCirugia(null)} style={{padding:"9px 14px",fontSize:"var(--fs-2)",background:"var(--superficie)",color:"var(--texto-ter)",border:"0.5px solid var(--borde)",borderRadius:8,cursor:"pointer"}}>Cancelar</button>
          </div>
        </div>
      )}
      {/* Lista de cirugías con día post-op */}
      {seleccionado.operado && Array.isArray(seleccionado.cirugias_realizadas) && seleccionado.cirugias_realizadas.length > 0 && (
        <div style={{marginTop:6,padding:"10px 12px",background:"var(--exito-bg)",borderRadius:6}}>
          {seleccionado.cirugias_realizadas.map((cx, idx) => {
            const dia = diaPostOp(cx.fecha);
            return (
              <div key={idx} style={{display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:"var(--fs-2)",color:"var(--texto)",padding:"3px 0"}}>
                <span><strong>Día {dia}:</strong> {cx.nombre}</span>
                <button onClick={()=>eliminarCirugia(idx)} style={{background:"none",border:"none",color:"var(--peligro)",cursor:"pointer",fontSize:"var(--fs-2)",padding:0}}>✕</button>
              </div>
            );
          })}
        </div>
      )}
      {Array.isArray(seleccionado.antecedentes) && seleccionado.antecedentes.length > 0 && (
        <div style={{fontSize:"var(--fs-2)",color:"var(--texto)",marginTop:6,padding:"10px 12px",background:"var(--fondo-suave)",borderRadius:6}}>
          <strong>Antecedentes:</strong>{" "}
          <span style={{display:"inline-flex",flexWrap:"wrap",gap:5,verticalAlign:"middle"}}>
            {seleccionado.antecedentes.map(a => (
              <span key={a} style={{fontSize:"var(--fs-1)",background:"var(--alerta-bg)",color:"var(--alerta)",padding:"2px 8px",borderRadius:8,fontWeight:600}}>{a}</span>
            ))}
          </span>
        </div>
      )}
      {seleccionado.alergias && seleccionado.alergias.trim() && (
        <div style={{fontSize:"var(--fs-2)",color:"var(--texto)",marginTop:6,padding:"10px 12px",background:"var(--peligro-bg)",borderRadius:6}}>
          <strong style={{color:"var(--peligro)"}}>⚠ Alergias:</strong> {seleccionado.alergias}
        </div>
      )}
      {seleccionado.plan_manejo && (
        <div style={{fontSize:"var(--fs-2)",color:"var(--texto)",marginTop:6,padding:"10px 12px",background:"var(--fondo-suave)",borderRadius:6,whiteSpace:"pre-wrap"}}>
          <strong>Plan:</strong> {seleccionado.plan_manejo}
        </div>
      )}
    </>
  )}
</div>

        {/* HISTORIA DEL PACIENTE */}
        <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"14px",marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:seleccionado.historia||editandoHistoria?8:0}}>
            <div style={{fontSize:"var(--fs-2)",fontWeight:600,color:"var(--texto)"}}>📖 Historia</div>
            {!editandoHistoria && (
              <button onClick={()=>{setHistoriaDraft(seleccionado.historia||"");setEditandoHistoria(true);}} style={{padding:"4px 11px",fontSize:"var(--fs-0)",background:seleccionado.historia?"var(--superficie)":"var(--primario)",color:seleccionado.historia?"var(--primario)":"var(--texto-inv)",border:seleccionado.historia?"0.5px solid var(--borde)":"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>
                {seleccionado.historia ? "✏ Editar" : "+ Agregar Historia"}
              </button>
            )}
          </div>
          {editandoHistoria ? (
            <>
              <textarea value={historiaDraft} onChange={e=>setHistoriaDraft(e.target.value)} placeholder="Breve historia del paciente: motivo de ingreso, contexto clínico, evolución previa..." rows={4} style={{...inputStyle,resize:"vertical",marginBottom:6}}/>
              <div style={{display:"flex",gap:8}}>
                <button onClick={guardarHistoria} style={{...btnPrimary,marginTop:0,flex:1}}>Guardar historia</button>
                <button onClick={()=>setEditandoHistoria(false)} style={{padding:"9px 14px",fontSize:"var(--fs-2)",background:"var(--superficie)",color:"var(--texto-ter)",border:"0.5px solid var(--borde)",borderRadius:8,cursor:"pointer"}}>Cancelar</button>
              </div>
            </>
          ) : seleccionado.historia ? (
            <div style={{fontSize:"var(--fs-2)",color:"var(--texto)",whiteSpace:"pre-wrap",lineHeight:1.5,background:"var(--fondo-suave)",borderRadius:6,padding:"10px 12px"}}>{seleccionado.historia}</div>
          ) : null}
        </div>

        {/* ÚLTIMA EVOLUCIÓN + anteriores colapsadas */}
        <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"14px",marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={ST_TITULO_SEC}>📝 Evoluciones</div>
            <div style={{display:"flex",gap:6}}>
              <button onClick={descargarEvolucionesPDF} title="Descargar evoluciones en PDF" aria-label="Descargar evoluciones en PDF" style={ST_BTN_ICO}>📄</button>
              <button onClick={imprimirEvolucionesDelDiaPDF} title="Imprimir evoluciones de hoy" aria-label="Imprimir evoluciones de hoy" style={ST_BTN_ICO}>🖨️</button>
              {!soloLectura && <button onClick={()=>{setAbrirFormEvo(true); setTimeout(()=>formEvoRef.current?.scrollIntoView({behavior:"smooth",block:"start"}),60);}} title="Agregar evolución" aria-label="Agregar evolución" style={ST_BTN_MAS}>+</button>}
            </div>
          </div>
          {evoluciones.length === 0 ? (
            <div style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)",fontStyle:"italic",padding:"6px 0"}}>No hay evoluciones registradas</div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {(mostrarEvosAntiguas ? evoluciones : evoluciones.slice(0,1)).map((e, idx) => (
                <div key={e.id} style={{background:"var(--fondo-suave)",borderRadius:6,padding:"10px 12px",borderLeft:idx===0?"3px solid var(--primario)":"3px solid var(--borde)",border:idx===0?"0.5px solid var(--primario)":"none"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4,gap:8}}>
                    <div style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                      {idx===0 && <span style={{fontSize:9,background:"var(--primario)",color:"var(--texto-inv)",padding:"1px 7px",borderRadius:8,fontWeight:600}}>MÁS RECIENTE</span>}
                      {e.fecha_evolucion} {e.hora_evolucion?.slice(0,5)} | {e.autor?.nombre || "Anónimo"} | <span style={{color:e.tipo==="estructurada"?"var(--exito)":e.tipo==="examen"?"var(--alerta)":"var(--texto-sec)",fontWeight:e.tipo==="examen"?600:400}}>{e.tipo==="examen"?"🧪 examen":e.tipo}</span>
                    </div>
                    <div style={{display:"flex",gap:8,flexShrink:0,alignItems:"center"}}>
                      <button onClick={()=>imprimirNota(e)} title="Imprimir / PDF" style={{background:"none",border:"none",color:"var(--primario)",cursor:"pointer",fontSize:"var(--fs-1)",padding:0}}>🖨️</button>
                      {e.autor_id === currentUser.id && (<>
                        <button onClick={()=>abrirEdicionEvo(e)} title="Editar" style={{background:"none",border:"none",color:"var(--primario)",cursor:"pointer",fontSize:"var(--fs-1)",padding:0}}>✏️</button>
                        <button onClick={()=>eliminarEvo(e.id)} style={{background:"none",border:"none",color:"var(--peligro)",cursor:"pointer",fontSize:"var(--fs-1)",padding:0}}>🗑</button>
                      </>)}
                    </div>
                  </div>
                  {editandoEvoId===e.id ? (
                    <div>
                      <textarea value={editTexto} onChange={ev=>setEditTexto(ev.target.value)} rows={4} style={{width:"100%",fontSize:"var(--fs-2)",padding:"8px 10px",border:"0.5px solid var(--primario)",borderRadius:7,background:"var(--superficie)",color:"var(--texto)",boxSizing:"border-box",fontFamily:"inherit",lineHeight:1.4,resize:"vertical"}} />
                      <div style={{display:"flex",gap:8,marginTop:6}}>
                        <button onClick={()=>guardarEdicionEvo(e)} style={{padding:"6px 14px",fontSize:"var(--fs-1)",fontWeight:600,background:"var(--primario)",color:"var(--texto-inv)",border:"none",borderRadius:6,cursor:"pointer"}}>Guardar</button>
                        <button onClick={()=>setEditandoEvoId(null)} style={{padding:"6px 14px",fontSize:"var(--fs-1)",background:"var(--superficie)",color:"var(--texto-sec)",border:"0.5px solid var(--borde)",borderRadius:6,cursor:"pointer"}}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                  <div style={{fontSize:idx===0?13:12,color:"var(--texto)",whiteSpace:"pre-wrap",lineHeight:1.4}}>{e.texto}</div>
                  )}
                </div>
              ))}
              {evoluciones.length > 1 && (
                <button onClick={()=>setMostrarEvosAntiguas(!mostrarEvosAntiguas)} style={{padding:"8px",fontSize:"var(--fs-1)",background:"var(--fondo-suave)",border:"0.5px dashed var(--borde)",color:"var(--primario)",borderRadius:8,cursor:"pointer",fontWeight:500}}>
                  {mostrarEvosAntiguas ? "▴ Ver menos evoluciones" : "▾ Ver más evoluciones"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* EXÁMENES agrupados por día + anteriores colapsados */}
        <div style={{order:2,background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"14px",marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={ST_TITULO_SEC}>🧪 Exámenes</div>
            {!soloLectura && <div style={{display:"flex",gap:6}}>
              <button onClick={()=>setPlantillasAbierto(true)} title="Plantillas de exámenes" aria-label="Plantillas de exámenes" style={ST_BTN_ICO}>📋</button>
              <button onClick={()=>setFotoExamenesAbierto(true)} title="Exámenes desde foto" aria-label="Exámenes desde foto" style={ST_BTN_ICO}>📷</button>
              <button onClick={()=>{setAbrirFormExamen(true); setTimeout(()=>formExamenRef.current?.scrollIntoView({behavior:"smooth",block:"start"}),60);}} title="Agregar examen" aria-label="Agregar examen" style={ST_BTN_MAS}>+</button>
            </div>}
          </div>
          {examenes.length === 0 ? (
            <div style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)",fontStyle:"italic",padding:"6px 0"}}>No hay exámenes registrados</div>
          ) : (() => {
            // Agrupar por fecha_examen (desc)
            const porDia = {};
            examenes.forEach(ex => { const f = ex.fecha_examen || "s/f"; if (!porDia[f]) porDia[f] = []; porDia[f].push(ex); });
            const fechas = Object.keys(porDia).sort((a,b)=>b.localeCompare(a));
            const fechasVisibles = mostrarExAntiguos ? fechas : fechas.slice(0,1);
            const cardExamen = (ex) => (
                <div key={ex.id} style={{background:"var(--fondo-suave)",borderRadius:6,padding:"10px 12px",borderLeft:"3px solid var(--exito)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4,gap:8}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:"var(--fs-1)",fontWeight:500,color:"var(--texto)"}}>
                        <span style={{fontSize:9,padding:"1px 6px",background:"var(--exito)",color:"var(--texto-inv)",borderRadius:3,marginRight:6}}>{ex.tipo}</span>
                        {ex.nombre}
                      </div>
                      <div style={{fontSize:"var(--fs-xs)",color:"var(--texto-ter)",marginTop:2}}>{ex.autor?.nombre || "Anónimo"}</div>
                    </div>
                    {ex.autor_id === currentUser.id && (
                      <button onClick={()=>eliminarEx(ex.id)} style={{background:"none",border:"none",color:"var(--peligro)",cursor:"pointer",fontSize:"var(--fs-1)",padding:0}}>🗑</button>
                    )}
                  </div>
                  {ex.datos_estructurados && (ex.datos_estructurados.pirads || ex.datos_estructurados.pesoProstatico || ex.datos_estructurados.lugar || ex.datos_estructurados.tipoCultivo) && (
                    <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:4}}>
                      {ex.datos_estructurados.pirads && <span style={{fontSize:"var(--fs-0)",background:"var(--alerta-bg)",color:"var(--alerta)",padding:"2px 8px",borderRadius:8,fontWeight:600}}>PI-RADS {ex.datos_estructurados.pirads}</span>}
                      {ex.datos_estructurados.pesoProstatico && <span style={{fontSize:"var(--fs-0)",background:"var(--chip-azul-bg)",color:"var(--chip-azul)",padding:"2px 8px",borderRadius:8,fontWeight:600}}>Próstata {ex.datos_estructurados.pesoProstatico} g</span>}
                      {ex.datos_estructurados.lugar && <span style={{fontSize:"var(--fs-0)",background:"var(--ccv-bg)",color:"var(--ccv)",padding:"2px 8px",borderRadius:8,fontWeight:600}}>📍 {ex.datos_estructurados.lugar}</span>}
                      {ex.datos_estructurados.tipoCultivo && <span style={{fontSize:"var(--fs-0)",background:"var(--exito-bg)",color:"var(--exito)",padding:"2px 8px",borderRadius:8,fontWeight:600}}>{ex.datos_estructurados.tipoCultivo}</span>}
                    </div>
                  )}
                  {ex.datos_estructurados && ex.datos_estructurados.germen && (
                    <div style={{marginTop:5}}>
                      <span style={{fontSize:"var(--fs-0)",background:"var(--fondo-suave)",border:"0.5px solid var(--borde)",color:"var(--texto)",padding:"2px 8px",borderRadius:8,fontWeight:600,fontStyle:"italic"}}>🦠 {ex.datos_estructurados.germen}</span>
                    </div>
                  )}
                  {ex.datos_estructurados && Array.isArray(ex.datos_estructurados.antibiograma) && ex.datos_estructurados.antibiograma.length > 0 && (
                    <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:5}}>
                      {ex.datos_estructurados.antibiograma.map((a,i) => {
                        const col = a.sens === "Sensible" ? "var(--exito)" : a.sens === "Resistente" ? "var(--peligro)" : "var(--texto-ter)";
                        const bg = a.sens === "Sensible" ? "var(--exito-bg)" : a.sens === "Resistente" ? "var(--peligro-bg, #FEE2E2)" : "var(--fondo-suave)";
                        return <span key={i} style={{fontSize:"var(--fs-xs)",background:bg,color:col,padding:"2px 7px",borderRadius:8,fontWeight:600}}>{a.atb} · {a.sens?.[0] || "?"}</span>;
                      })}
                    </div>
                  )}
                  {ex.datos_estructurados && ex.datos_estructurados.parametros && Object.keys(ex.datos_estructurados.parametros).length > 0 && (
                    <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:6}}>
                      {Object.entries(ex.datos_estructurados.parametros).map(([k,v]) => {
                        const def = (PARAMETROS_LAB[ex.nombre] || []).find(p => p.key === k);
                        // Flecha de tendencia: compara con el mismo parámetro del examen
                        // previo (misma "nombre", fecha anterior) y colorea según utilidad clínica.
                        let flecha = null;
                        const actual = _numLab(v);
                        if (actual !== null && ex.fecha_examen) {
                          const previo = examenes
                            .filter(o => o.id !== ex.id && o.nombre === ex.nombre && o.fecha_examen && o.fecha_examen < ex.fecha_examen
                              && o.datos_estructurados?.parametros && o.datos_estructurados.parametros[k] !== undefined && o.datos_estructurados.parametros[k] !== "")
                            .sort((a,b) => String(b.fecha_examen).localeCompare(String(a.fecha_examen)))[0];
                          const prev = previo ? _numLab(previo.datos_estructurados.parametros[k]) : null;
                          if (prev !== null && actual !== prev) {
                            const sube = actual > prev;
                            const sem = SEMANTICA_LAB[k];
                            let color = "var(--texto-ter)";
                            if (sem === "altoMalo") color = sube ? "var(--peligro)" : "var(--exito)";
                            else if (sem === "bajoMalo") color = sube ? "var(--exito)" : "var(--peligro)";
                            flecha = <span title={`Previo: ${previo.datos_estructurados.parametros[k]}${def?.unidad?` ${def.unidad}`:""} · ${previo.fecha_examen}`} style={{color,fontWeight:700,marginLeft:4}}>{sube?"▲":"▼"}</span>;
                          }
                        }
                        return (
                          <span key={k} style={{fontSize:"var(--fs-0)",background:"var(--superficie)",border:"0.5px solid var(--borde)",color:"var(--texto)",padding:"2px 8px",borderRadius:8}}>
                            <strong>{def?.label || k}:</strong> {v}{def?.unidad ? ` ${def.unidad}` : ""}{flecha}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {ex.datos_estructurados && Array.isArray(ex.datos_estructurados.litiasis) && ex.datos_estructurados.litiasis.length > 0 && (
                    <div style={{marginTop:6}}>
                      <div style={{fontSize:"var(--fs-0)",fontWeight:600,color:"var(--primario)",marginBottom:3}}>🪨 Litiasis</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                        {ex.datos_estructurados.litiasis.map((l,i) => (
                          <span key={i} style={{fontSize:"var(--fs-0)",background:"var(--alerta-bg)",color:"var(--alerta)",padding:"2px 8px",borderRadius:8,fontWeight:500}}>
                            {[l.ubicacion,l.tercio,l.lateralidad,l.tamano?`${l.tamano} mm`:"",l.uh?`${l.uh} UH`:""].filter(Boolean).join(" · ")}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {ex.datos_estructurados && Array.isArray(ex.datos_estructurados.tumores) && ex.datos_estructurados.tumores.length > 0 && (
                    <div style={{marginTop:6}}>
                      <div style={{fontSize:"var(--fs-0)",fontWeight:600,color:"var(--primario)",marginBottom:3}}>🎯 Tumor</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                        {ex.datos_estructurados.tumores.map((t,i) => (
                          <span key={i} style={{fontSize:"var(--fs-0)",background:"var(--peligro-bg)",color:"var(--peligro)",padding:"2px 8px",borderRadius:8,fontWeight:500}}>
                            {[t.organo,t.sublocalizacion,t.tamano?`${t.tamano} cm`:""].filter(Boolean).join(" · ")}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {ex.resultado && <div style={{fontSize:"var(--fs-1)",color:"var(--texto)",marginTop:6,whiteSpace:"pre-wrap"}}>{ex.resultado}</div>}
                </div>
            );
            return (
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {fechasVisibles.map(fecha => (
                  <div key={fecha}>
                    <div style={{fontSize:"var(--fs-0)",fontWeight:700,color:"var(--texto-sec)",marginBottom:5,padding:"3px 10px",background:"var(--fondo-suave)",borderRadius:6,display:"inline-block"}}>
                      📅 {fecha === "s/f" ? "Sin fecha" : fecha} · {porDia[fecha].length} examen{porDia[fecha].length===1?"":"es"}
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {porDia[fecha].map(cardExamen)}
                    </div>
                  </div>
                ))}
                {fechas.length > 1 && (
                  <button onClick={()=>setMostrarExAntiguos(!mostrarExAntiguos)} style={{padding:"8px",fontSize:"var(--fs-1)",background:"var(--fondo-suave)",border:"0.5px dashed var(--borde)",color:"var(--primario)",borderRadius:8,cursor:"pointer",fontWeight:500}}>
                    {mostrarExAntiguos ? "▴ Ver menos exámenes" : "▾ Ver más exámenes"}
                  </button>
                )}
              </div>
            );
          })()}
        </div>

        {/* PENDIENTES DEL PACIENTE */}
        <div style={{order:6,background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"14px",marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:abrirFormPendiente||pendientesPaciente.length>0?10:0}}>
            <div style={ST_TITULO_SEC}>✅ Pendientes del paciente</div>
            <button onClick={()=>setAbrirFormPendiente(!abrirFormPendiente)} style={{padding:"5px 12px",fontSize:"var(--fs-1)",background:abrirFormPendiente?"var(--superficie)":"var(--primario)",color:abrirFormPendiente?"var(--texto-sec)":"var(--texto-inv)",border:abrirFormPendiente?"0.5px solid var(--borde)":"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>{abrirFormPendiente?"Cancelar":"+ Agregar pendiente"}</button>
          </div>
          {abrirFormPendiente && (
          <div style={{marginBottom:pendientesPaciente.length>0?10:0}}>
          <textarea value={nuevoPendientePac.texto} onChange={e=>setNuevoPendientePac({...nuevoPendientePac,texto:e.target.value})} placeholder="¿Qué hay que hacer con este paciente?" rows={2} style={{...inputStyle,resize:"vertical",marginBottom:6}}/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:6}}>
            <select value={nuevoPendientePac.prioridad} onChange={e=>setNuevoPendientePac({...nuevoPendientePac,prioridad:e.target.value})} style={{...inputStyle,marginBottom:0}}>
              <option value="alta">🔴 Alta</option>
              <option value="normal">🟡 Normal</option>
              <option value="baja">🟢 Baja</option>
            </select>
            <input type="date" value={nuevoPendientePac.fecha_objetivo} onChange={e=>setNuevoPendientePac({...nuevoPendientePac,fecha_objetivo:e.target.value})} style={{...inputStyle,marginBottom:0}}/>
          </div>
          {esEquipo && miembrosEquipo.length > 0 && (
            <div style={{marginBottom:8}}>
              <div style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)",marginBottom:4}}>Agregar encargado:</div>
              <select value="" onChange={e=>{const uid=e.target.value; if(uid && !nuevoPendientePac.encargados.includes(uid)) setNuevoPendientePac({...nuevoPendientePac,encargados:[...nuevoPendientePac.encargados,uid]});}} style={{...inputStyle,marginBottom:6}}>
                <option value="">Seleccionar miembro…</option>
                {miembrosEquipo.filter(m=>m.perfiles?.id && !nuevoPendientePac.encargados.includes(m.perfiles.id)).map(m => (
                  <option key={m.perfiles.id} value={m.perfiles.id}>{m.perfiles.nombre}</option>
                ))}
              </select>
              {nuevoPendientePac.encargados.length > 0 && (
                <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                  {nuevoPendientePac.encargados.map(uid => {
                    const m = miembrosEquipo.find(x=>x.perfiles?.id===uid);
                    return (
                      <span key={uid} onClick={()=>setNuevoPendientePac({...nuevoPendientePac,encargados:nuevoPendientePac.encargados.filter(x=>x!==uid)})} style={{padding:"4px 11px",fontSize:"var(--fs-0)",borderRadius:14,cursor:"pointer",background:"var(--primario)",color:"var(--texto-inv)",fontWeight:600}}>{m?.perfiles?.nombre||"?"} ✕</span>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <button onClick={()=>{guardarPendientePaciente();setAbrirFormPendiente(false);}} disabled={!nuevoPendientePac.texto.trim()} style={{...btnPrimary,marginTop:0,opacity:nuevoPendientePac.texto.trim()?1:0.6}}>+ Guardar pendiente</button>
          </div>
          )}
          {pendientesPaciente.map(p => (
            <div key={p.id} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",background:"var(--fondo-suave)",borderRadius:6,marginBottom:4,opacity:p.estado==="completado"?0.55:1}}>
              <button onClick={()=>togglePendientePacCompletado(p)} style={{width:17,height:17,borderRadius:4,border:"1px solid var(--borde)",background:p.estado==="completado"?"var(--exito)":"var(--superficie)",color:"var(--texto-inv)",cursor:"pointer",fontSize:"var(--fs-0)",padding:0,flexShrink:0}}>{p.estado==="completado"?"✓":""}</button>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:"var(--fs-1)",color:"var(--texto)",textDecoration:p.estado==="completado"?"line-through":"none"}}>{p.texto.replace(/^\[[^\]]*\]\s*/,"")}</div>
                <div style={{fontSize:"var(--fs-xs)",color:"var(--texto-ter)"}}>{p.prioridad==="alta"?"🔴":p.prioridad==="baja"?"🟢":"🟡"}{p.fecha_objetivo?` · para el ${p.fecha_objetivo}`:""}</div>
              </div>
            </div>
          ))}
        </div>

        {/* NUEVA EVOLUCIÓN (formulario) */}
        <div ref={formEvoRef} style={abrirFormEvo?{order:1,background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"14px",marginBottom:12}:{order:1}}>
          {abrirFormEvo && <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontSize:"var(--fs-2)",fontWeight:600,color:"var(--texto)"}}>➕ Nueva evolución</div>
            <button onClick={()=>setAbrirFormEvo(false)} style={{padding:"5px 12px",fontSize:"var(--fs-1)",background:"var(--superficie)",color:"var(--texto-sec)",border:"0.5px solid var(--borde)",borderRadius:6,cursor:"pointer",fontWeight:500}}>Cerrar</button>
          </div>}
          {abrirFormEvo && (<>
          {/* Selector tipo */}
          <div style={{display:"flex",gap:8,marginBottom:10}}>
            <button onClick={()=>setTipoEvo("estructurada")} style={{flex:1,padding:"11px 14px",fontSize:"var(--fs-2)",background:tipoEvo==="estructurada"?"var(--primario)":"var(--superficie)",color:tipoEvo==="estructurada"?"var(--texto-inv)":"var(--texto-sec)",border:tipoEvo==="estructurada"?"none":"0.5px solid var(--borde)",borderRadius:8,cursor:"pointer",fontWeight:600}}>Estructurada (SOAP)</button>
            <button onClick={()=>setTipoEvo("libre")} style={{flex:1,padding:"11px 14px",fontSize:"var(--fs-2)",background:tipoEvo==="libre"?"var(--primario)":"var(--superficie)",color:tipoEvo==="libre"?"var(--texto-inv)":"var(--texto-sec)",border:tipoEvo==="libre"?"none":"0.5px solid var(--borde)",borderRadius:8,cursor:"pointer",fontWeight:600}}>Libre</button>
          </div>

          {tipoEvo === "libre" ? (
            <textarea value={evoLibre} onChange={e=>setEvoLibre(e.target.value)} placeholder="Escribe la evolución..." rows={4} style={{...inputStyle,resize:"vertical",marginBottom:6}}/>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:6}}>
  
  {/* PLANTILLAS COMPLETAS - desplegable */}
  <div style={{border:"0.5px solid var(--borde)",borderRadius:6,overflow:"hidden"}}>
    <button onClick={()=>setSeccionAbierta(seccionAbierta==="plantillas"?null:"plantillas")} style={{width:"100%",padding:"9px 12px",background:"var(--fondo-suave)",border:"none",cursor:"pointer",fontSize:"var(--fs-1)",fontWeight:600,color:"var(--primario)",textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      📋 Plantillas completas <span>{seccionAbierta==="plantillas"?"▴":"▾"}</span>
    </button>
    {seccionAbierta==="plantillas" && (
      <div style={{display:"flex",flexWrap:"wrap",gap:5,padding:"8px 12px"}}>
        {Object.keys(PLANTILLAS_SOAP).map(nombre => (
          <button key={nombre} onClick={()=>setEvoEstructurada(PLANTILLAS_SOAP[nombre])} style={{padding:"5px 11px",fontSize:"var(--fs-0)",background:"var(--superficie)",border:"0.5px solid var(--borde)",color:"var(--primario)",borderRadius:10,cursor:"pointer"}}>{nombre}</button>
        ))}
      </div>
    )}
  </div>

  {/* SUBJETIVO */}
  <div>
    <textarea value={evoEstructurada.subjetivo} onChange={e=>setEvoEstructurada({...evoEstructurada,subjetivo:e.target.value})} placeholder="S - Subjetivo (lo que refiere el paciente)" rows={2} style={{...inputStyle,resize:"vertical",marginBottom:3}}/>
    <button onClick={()=>setSeccionAbierta(seccionAbierta==="subjetivo"?null:"subjetivo")} style={{padding:"4px 10px",fontSize:"var(--fs-0)",background:"var(--fondo-suave)",border:"0.5px solid var(--borde)",color:"var(--texto-ter)",borderRadius:8,cursor:"pointer"}}>+ Sugerencias {seccionAbierta==="subjetivo"?"▴":"▾"}</button>
    {seccionAbierta==="subjetivo" && (
      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
        {SUGERENCIAS_SOAP.subjetivo.map(s => (
          <button key={s} onClick={()=>setEvoEstructurada({...evoEstructurada,subjetivo: evoEstructurada.subjetivo ? evoEstructurada.subjetivo + " " + s : s})} style={{padding:"3px 8px",fontSize:"var(--fs-0)",background:"var(--superficie)",border:"0.5px solid var(--borde)",color:"var(--texto-sec)",borderRadius:8,cursor:"pointer"}}>{s}</button>
        ))}
      </div>
    )}
  </div>

  {/* OBJETIVO */}
  <div>
    <textarea value={evoEstructurada.objetivo} onChange={e=>setEvoEstructurada({...evoEstructurada,objetivo:e.target.value})} placeholder="O - Objetivo (signos vitales, laboratorio)" rows={2} style={{...inputStyle,resize:"vertical",marginBottom:3}}/>
    <button onClick={()=>setSeccionAbierta(seccionAbierta==="objetivo"?null:"objetivo")} style={{padding:"4px 10px",fontSize:"var(--fs-0)",background:"var(--fondo-suave)",border:"0.5px solid var(--borde)",color:"var(--texto-ter)",borderRadius:8,cursor:"pointer"}}>+ Sugerencias {seccionAbierta==="objetivo"?"▴":"▾"}</button>
    {seccionAbierta==="objetivo" && (
      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
        {SUGERENCIAS_SOAP.objetivo.map(s => (
          <button key={s} onClick={()=>setEvoEstructurada({...evoEstructurada,objetivo: evoEstructurada.objetivo ? evoEstructurada.objetivo + " " + s : s})} style={{padding:"3px 8px",fontSize:"var(--fs-0)",background:"var(--superficie)",border:"0.5px solid var(--borde)",color:"var(--texto-sec)",borderRadius:8,cursor:"pointer"}}>{s}</button>
        ))}
      </div>
    )}
  </div>

  {/* DIURESIS */}
  <div style={{padding:"10px 12px",background:"var(--fondo-suave)",borderRadius:6,border:"0.5px solid var(--borde)"}}>
    <div style={{fontSize:"var(--fs-1)",fontWeight:600,color:"var(--primario)",marginBottom:6}}>💧 Diuresis</div>
    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
      <input type="number" value={diuresis.cantidad} onChange={e=>setDiuresis({...diuresis,cantidad:e.target.value})} placeholder="Cantidad" style={{...inputStyle,marginBottom:0,width:100,flex:"0 0 auto"}}/>
      <span style={{alignSelf:"center",fontSize:"var(--fs-1)",color:"var(--texto-ter)"}}>ml</span>
      <select value={diuresis.via} onChange={e=>setDiuresis({...diuresis,via:e.target.value})} style={{...inputStyle,marginBottom:0,flex:1,minWidth:120}}>
        <option value="">Vía...</option>
        <option value="Diuresis espontánea">Espontánea</option>
        <option value="Sonda Foley">Sonda Foley</option>
        <option value="Nefrostomía">Nefrostomía</option>
        <option value="Cistostomía">Cistostomía</option>
      </select>
      <select value={diuresis.caracteristicas} onChange={e=>setDiuresis({...diuresis,caracteristicas:e.target.value})} style={{...inputStyle,marginBottom:0,flex:1,minWidth:140}}>
        <option value="">Características...</option>
        <option value="Clara">Clara</option>
        <option value="Tinte hemático">Tinte hemático</option>
        <option value="Hematúrica">Hematúrica</option>
        <option value="Clara con irrigación">Clara con irrigación</option>
        <option value="Coágulos">Coágulos</option>
        <option value="Turbia">Turbia</option>
      </select>
    </div>
  </div>

  {/* DRENAJE */}
  <div style={{padding:"10px 12px",background:"var(--fondo-suave)",borderRadius:6,border:"0.5px solid var(--borde)"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div style={{fontSize:"var(--fs-1)",fontWeight:600,color:"var(--primario)"}}>🩸 Drenaje</div>
      <button onClick={()=>setDrenaje({...drenaje, activo: !drenaje.activo})} style={{width:46,height:26,borderRadius:13,border:"none",cursor:"pointer",background:drenaje.activo?"var(--exito)":"var(--borde-suave)",position:"relative",transition:"background 0.2s",padding:0}}>
        <span style={{position:"absolute",top:3,left:drenaje.activo?23:3,width:20,height:20,borderRadius:"50%",background:"var(--superficie)",transition:"left 0.2s",boxShadow:"0 1px 2px rgba(0,0,0,0.2)"}}/>
      </button>
    </div>
    {drenaje.activo && (
      <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:8}}>
        <select value={drenaje.tipo} onChange={e=>setDrenaje({...drenaje,tipo:e.target.value, aspiracion: (e.target.value==="Hemosuc"||e.target.value==="Jackson Pratt")?drenaje.aspiracion:""})} style={{...inputStyle,marginBottom:0}}>
          <option value="">Tipo de drenaje...</option>
          <option value="Tubular">Tubular</option>
          <option value="Hemosuc">Hemosuc</option>
          <option value="Jackson Pratt">Jackson Pratt</option>
        </select>
        {(drenaje.tipo==="Hemosuc" || drenaje.tipo==="Jackson Pratt") && (
          <select value={drenaje.aspiracion} onChange={e=>setDrenaje({...drenaje,aspiracion:e.target.value})} style={{...inputStyle,marginBottom:0}}>
            <option value="">Aspiración...</option>
            <option value="Aspirativo">Aspirativo</option>
            <option value="No aspirativo">No aspirativo</option>
          </select>
        )}
        <select value={drenaje.localizacion} onChange={e=>setDrenaje({...drenaje,localizacion:e.target.value})} style={{...inputStyle,marginBottom:0}}>
          <option value="">Localización...</option>
          <option value="Hipocondrio derecho">Hipocondrio derecho</option>
          <option value="Epigastrio">Epigastrio</option>
          <option value="Hipocondrio izquierdo">Hipocondrio izquierdo</option>
          <option value="Flanco derecho">Flanco derecho</option>
          <option value="Mesogastrio">Mesogastrio</option>
          <option value="Flanco izquierdo">Flanco izquierdo</option>
          <option value="Fosa iliaca derecha">Fosa iliaca derecha</option>
          <option value="Hipogastrio">Hipogastrio</option>
          <option value="Fosa iliaca izquierda">Fosa iliaca izquierda</option>
        </select>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <input type="number" value={drenaje.cantidad} onChange={e=>setDrenaje({...drenaje,cantidad:e.target.value})} placeholder="Cantidad" style={{...inputStyle,marginBottom:0,width:100,flex:"0 0 auto"}}/>
          <span style={{fontSize:"var(--fs-1)",color:"var(--texto-ter)"}}>ml</span>
          <select value={drenaje.caracteristicas} onChange={e=>setDrenaje({...drenaje,caracteristicas:e.target.value})} style={{...inputStyle,marginBottom:0,flex:1}}>
            <option value="">Características...</option>
            <option value="Hemático">Hemático</option>
            <option value="Serohemático">Serohemático</option>
            <option value="Seroso">Seroso</option>
            <option value="Purulento">Purulento</option>
            <option value="Orina">Orina</option>
          </select>
        </div>
      </div>
    )}
  </div>

  {/* EXAMEN FÍSICO */}
  <div>
    <textarea value={evoEstructurada.examen} onChange={e=>setEvoEstructurada({...evoEstructurada,examen:e.target.value})} placeholder="A - Examen físico/análisis" rows={2} style={{...inputStyle,resize:"vertical",marginBottom:3}}/>
    <button onClick={()=>setSeccionAbierta(seccionAbierta==="examen"?null:"examen")} style={{padding:"4px 10px",fontSize:"var(--fs-0)",background:"var(--fondo-suave)",border:"0.5px solid var(--borde)",color:"var(--texto-ter)",borderRadius:8,cursor:"pointer"}}>+ Sugerencias {seccionAbierta==="examen"?"▴":"▾"}</button>
    {seccionAbierta==="examen" && (
      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
        {SUGERENCIAS_SOAP.examen.map(s => (
          <button key={s} onClick={()=>setEvoEstructurada({...evoEstructurada,examen: evoEstructurada.examen ? evoEstructurada.examen + " " + s : s})} style={{padding:"3px 8px",fontSize:"var(--fs-0)",background:"var(--superficie)",border:"0.5px solid var(--borde)",color:"var(--texto-sec)",borderRadius:8,cursor:"pointer"}}>{s}</button>
        ))}
      </div>
    )}
  </div>

  {/* INDICACIONES */}
  <div>
    <textarea value={evoEstructurada.indicaciones} onChange={e=>setEvoEstructurada({...evoEstructurada,indicaciones:e.target.value})} placeholder="P - Plan/indicaciones" rows={2} style={{...inputStyle,resize:"vertical",marginBottom:3}}/>
    <button onClick={()=>setSeccionAbierta(seccionAbierta==="indicaciones"?null:"indicaciones")} style={{padding:"4px 10px",fontSize:"var(--fs-0)",background:"var(--fondo-suave)",border:"0.5px solid var(--borde)",color:"var(--texto-ter)",borderRadius:8,cursor:"pointer"}}>+ Sugerencias {seccionAbierta==="indicaciones"?"▴":"▾"}</button>
    {seccionAbierta==="indicaciones" && (
      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
        {SUGERENCIAS_SOAP.indicaciones.map(s => (
          <button key={s} onClick={()=>setEvoEstructurada({...evoEstructurada,indicaciones: evoEstructurada.indicaciones ? evoEstructurada.indicaciones + "\n" + s : s})} style={{padding:"3px 8px",fontSize:"var(--fs-0)",background:"var(--superficie)",border:"0.5px solid var(--borde)",color:"var(--texto-sec)",borderRadius:8,cursor:"pointer"}}>{s}</button>
        ))}
      </div>
    )}
  </div>

</div>
          )}

          <button onClick={guardarEvolucion} style={{...btnPrimary, marginTop:0}}>+ Guardar evolución</button>
          </>)}
        </div>

        {/* NUEVO EXAMEN (formulario) */}
        <div ref={formExamenRef} style={abrirFormExamen?{order:3,background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"14px"}:{order:3}}>
          {abrirFormExamen && <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontSize:"var(--fs-2)",fontWeight:600,color:"var(--texto)"}}>➕ Nuevo examen</div>
            <button onClick={()=>setAbrirFormExamen(false)} style={{padding:"5px 12px",fontSize:"var(--fs-1)",background:"var(--superficie)",color:"var(--texto-sec)",border:"0.5px solid var(--borde)",borderRadius:6,cursor:"pointer",fontWeight:500}}>Cerrar</button>
          </div>}
          {abrirFormExamen && (<>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:6}}>
            <select value={nuevoEx.tipo} onChange={e=>setNuevoEx({...nuevoEx,tipo:e.target.value,nombre:"",pirads:"",pesoProstatico:"",lugar:"",tipoCultivo:""})} style={{...inputStyle,marginBottom:0}}>
              <option>Laboratorio</option>
              <option>Imagen</option>
              <option>Cultivo</option>
              <option>Anatomía patológica</option>
              <option>Cistoscopia</option>
              <option>Otro</option>
            </select>
            <input type="date" value={nuevoEx.fecha_examen} onChange={e=>setNuevoEx({...nuevoEx,fecha_examen:e.target.value})} style={{...inputStyle,marginBottom:0}}/>
          </div>

          {/* Campo nombre según el tipo */}
          {nuevoEx.tipo === "Laboratorio" && (
            <select value={nuevoEx.nombre} onChange={e=>{setNuevoEx({...nuevoEx,nombre:e.target.value}); setParamsLab({});}} style={inputStyle}>
              <option value="">Selecciona examen...</option>
              {["Función renal","Hemograma","Coagulación","PCR","ELP","Pruebas hepáticas","Glicemia","Orina completa","Antígeno prostático (PSA)","Testosterona","Gases venosos","Lactato","Otro"].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
          {/* Panel de parámetros numéricos para exámenes con set definido */}
          {nuevoEx.tipo === "Laboratorio" && PARAMETROS_LAB[nuevoEx.nombre] && (
            <div style={{padding:"10px 12px",background:"var(--fondo-suave)",borderRadius:6,border:"0.5px solid var(--borde)",marginBottom:6}}>
              <div style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)",marginBottom:8}}>Completa solo los parámetros que tengas (los vacíos se omiten):</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {PARAMETROS_LAB[nuevoEx.nombre].map(param => (
                  <div key={param.key} style={{display:"flex",alignItems:"center",gap:4}}>
                    <span style={{fontSize:"var(--fs-0)",color:"var(--texto)",fontWeight:500,minWidth:74}}>{param.label}</span>
                    <input type="number" value={paramsLab[param.key] || ""} onChange={e=>setParamsLab({...paramsLab,[param.key]:e.target.value})} style={{...inputStyle,marginBottom:0,padding:"6px 8px",fontSize:"var(--fs-1)"}}/>
                    {param.unidad && <span style={{fontSize:"var(--fs-xs)",color:"var(--texto-ter)",minWidth:38}}>{param.unidad}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {nuevoEx.tipo === "Imagen" && (
            <select value={nuevoEx.nombre} onChange={e=>setNuevoEx({...nuevoEx,nombre:e.target.value,pirads:"",pesoProstatico:""})} style={inputStyle}>
              <option value="">Selecciona imagen...</option>
              {["UROTAC","TAC","Pielotac","RM próstata","Eco VP","Eco testicular","Eco renal","Eco abdominal","Cintigrama óseo","PET PSMA","Otro"].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
          {nuevoEx.tipo === "Anatomía patológica" && (
            <select value={nuevoEx.lugar} onChange={e=>setNuevoEx({...nuevoEx,lugar:e.target.value})} style={inputStyle}>
              <option value="">Lugar de la muestra...</option>
              {["Próstata","Riñón","Vejiga","Testículo","Otro"].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
          {nuevoEx.tipo === "Cultivo" && (
            <select value={nuevoEx.tipoCultivo} onChange={e=>setNuevoEx({...nuevoEx,tipoCultivo:e.target.value})} style={inputStyle}>
              <option value="">Tipo de cultivo...</option>
              {["Urocultivo","Cultivo herida operatoria","Hemocultivo","Otro"].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
          {/* GERMEN + ANTIBIOGRAMA (cultivo) */}
          {nuevoEx.tipo === "Cultivo" && nuevoEx.tipoCultivo && (
            <div style={{padding:"10px 12px",background:"var(--fondo-suave)",borderRadius:6,border:"0.5px solid var(--borde)",marginBottom:6}}>
              <div style={{fontSize:"var(--fs-1)",fontWeight:600,color:"var(--primario)",marginBottom:8}}>🦠 Germen y antibiograma</div>
              <select value={nuevoEx.germen} onChange={e=>setNuevoEx({...nuevoEx,germen:e.target.value,germenOtro:""})} style={{...inputStyle,marginBottom:6}}>
                <option value="">Germen aislado...</option>
                {UROPATOGENOS.map(o => <option key={o} value={o}>{o}</option>)}
                <option value="Otro">Otro (especificar)</option>
              </select>
              {nuevoEx.germen === "Otro" && (
                <input value={nuevoEx.germenOtro} onChange={e=>setNuevoEx({...nuevoEx,germenOtro:e.target.value})} placeholder="Nombre del germen" style={{...inputStyle,marginBottom:6}}/>
              )}
              {/* Antibiograma: solo si hay germen y no es cultivo negativo */}
              {nuevoEx.germen && nuevoEx.germen !== "Cultivo negativo" && (
                <>
                  {antibiograma.length > 0 && (
                    <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:8}}>
                      {antibiograma.map((a, idx) => {
                        const col = a.sens === "Sensible" ? "var(--exito)" : a.sens === "Resistente" ? "var(--peligro)" : "var(--texto-ter)";
                        return (
                          <div key={idx} style={{display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:"var(--fs-1)",color:"var(--texto)",background:"var(--superficie)",padding:"5px 9px",borderRadius:6}}>
                            <span>{a.atb} · <strong style={{color:col}}>{a.sens}</strong></span>
                            <button onClick={()=>setAntibiograma(antibiograma.filter((_,i)=>i!==idx))} style={{background:"none",border:"none",color:"var(--peligro)",cursor:"pointer",fontSize:"var(--fs-2)",padding:0}}>✕</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    <select value={formAtb.atb} onChange={e=>setFormAtb({...formAtb,atb:e.target.value})} style={{...inputStyle,marginBottom:0,flex:1.4}}>
                      <option value="">Antibiótico...</option>
                      {ANTIBIOTICOS.map(o => <option key={o} value={o}>{o}</option>)}
                      <option value="__otro">Otro…</option>
                    </select>
                    <select value={formAtb.sens} onChange={e=>setFormAtb({...formAtb,sens:e.target.value})} style={{...inputStyle,marginBottom:0,flex:1}}>
                      <option value="">S/I/R</option>
                      {SENSIBILIDAD.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <button onClick={()=>{
                      const atb = formAtb.atb === "__otro" ? (formAtb.atbOtro || "") : formAtb.atb;
                      if (!atb || !formAtb.sens) return;
                      setAntibiograma([...antibiograma, { atb, sens: formAtb.sens }]);
                      setFormAtb({ atb: "", sens: "" });
                    }} style={{padding:"7px 12px",fontSize:"var(--fs-1)",fontWeight:600,background:"var(--primario)",color:"var(--texto-inv)",border:"none",borderRadius:6,cursor:"pointer",flexShrink:0}}>+</button>
                  </div>
                  {formAtb.atb === "__otro" && (
                    <input value={formAtb.atbOtro || ""} onChange={e=>setFormAtb({...formAtb,atbOtro:e.target.value})} placeholder="Nombre del antibiótico" style={{...inputStyle,marginTop:6,marginBottom:0}}/>
                  )}
                </>
              )}
            </div>
          )}
          {(nuevoEx.tipo === "Cistoscopia" || nuevoEx.tipo === "Otro") && (
            <input value={nuevoEx.nombre} onChange={e=>setNuevoEx({...nuevoEx,nombre:e.target.value})} placeholder={nuevoEx.tipo==="Cistoscopia"?"Detalle (opcional)":"Nombre del examen"} style={inputStyle}/>
          )}

          {/* Campos condicionales: peso prostático y PI-RADS */}
          {(nuevoEx.nombre === "RM próstata" || nuevoEx.nombre === "Eco VP") && (
            <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:6}}>
              <input type="number" value={nuevoEx.pesoProstatico} onChange={e=>setNuevoEx({...nuevoEx,pesoProstatico:e.target.value})} placeholder="Peso prostático" style={{...inputStyle,marginBottom:0,flex:1}}/>
              <span style={{fontSize:"var(--fs-1)",color:"var(--texto-ter)"}}>g</span>
            </div>
          )}
          {nuevoEx.nombre === "RM próstata" && (
            <select value={nuevoEx.pirads} onChange={e=>setNuevoEx({...nuevoEx,pirads:e.target.value})} style={inputStyle}>
              <option value="">PI-RADS...</option>
              {["1","2","3","4","5"].map(o => <option key={o} value={o}>PI-RADS {o}</option>)}
            </select>
          )}

          {/* CONSTRUCTOR DE LITIASIS (Pielotac) */}
          {nuevoEx.nombre === "Pielotac" && (
            <div style={{padding:"10px 12px",background:"var(--fondo-suave)",borderRadius:6,border:"0.5px solid var(--borde)",marginBottom:6}}>
              <div style={{fontSize:"var(--fs-1)",fontWeight:600,color:"var(--primario)",marginBottom:8}}>🪨 Litiasis</div>
              {litiasis.length > 0 && (
                <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:8}}>
                  {litiasis.map((l, idx) => (
                    <div key={idx} style={{display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:"var(--fs-1)",color:"var(--texto)",background:"var(--superficie)",padding:"5px 9px",borderRadius:6}}>
                      <span>{[l.ubicacion, l.tercio, l.lateralidad, l.tamano?`${l.tamano} mm`:"", l.uh?`${l.uh} UH`:""].filter(Boolean).join(" · ")}</span>
                      <button onClick={()=>setLitiasis(litiasis.filter((_,i)=>i!==idx))} style={{background:"none",border:"none",color:"var(--peligro)",cursor:"pointer",fontSize:"var(--fs-2)",padding:0}}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                <select value={formLitiasis.ubicacion} onChange={e=>setFormLitiasis({...formLitiasis,ubicacion:e.target.value,tercio:""})} style={{...inputStyle,marginBottom:0}}>
                  <option value="">Ubicación...</option>
                  {["Renal","Pieloureteral","Ureteral","Ureterovesical","Vesical"].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                {formLitiasis.ubicacion === "Ureteral" && (
                  <select value={formLitiasis.tercio} onChange={e=>setFormLitiasis({...formLitiasis,tercio:e.target.value})} style={{...inputStyle,marginBottom:0}}>
                    <option value="">Tercio...</option>
                    {["Proximal","Medio","Distal"].map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                )}
                <select value={formLitiasis.lateralidad} onChange={e=>setFormLitiasis({...formLitiasis,lateralidad:e.target.value})} style={{...inputStyle,marginBottom:0}}>
                  <option value="">Lateralidad...</option>
                  {["Derecha","Izquierda"].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                <div style={{display:"flex",gap:6}}>
                  <div style={{display:"flex",alignItems:"center",gap:4,flex:1}}>
                    <input type="number" value={formLitiasis.tamano} onChange={e=>setFormLitiasis({...formLitiasis,tamano:e.target.value})} placeholder="Tamaño" style={{...inputStyle,marginBottom:0}}/>
                    <span style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)"}}>mm</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:4,flex:1}}>
                    <input type="number" value={formLitiasis.uh} onChange={e=>setFormLitiasis({...formLitiasis,uh:e.target.value})} placeholder="Densidad" style={{...inputStyle,marginBottom:0}}/>
                    <span style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)"}}>UH</span>
                  </div>
                </div>
                <button onClick={()=>{
                  if (!formLitiasis.ubicacion) return alert("Selecciona la ubicación");
                  setLitiasis([...litiasis, formLitiasis]);
                  setFormLitiasis({ ubicacion: "", tercio: "", lateralidad: "", tamano: "", uh: "" });
                }} style={{padding:"7px 12px",fontSize:"var(--fs-1)",background:"var(--exito)",color:"var(--texto-inv)",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>+ Agregar litiasis</button>
              </div>
            </div>
          )}

          {/* CONSTRUCTOR DE TUMOR (UROTAC, TAC TAP, Eco renal) */}
          {(nuevoEx.nombre === "UROTAC" || nuevoEx.nombre === "TAC" || nuevoEx.nombre === "Eco renal") && (
            <div style={{padding:"10px 12px",background:"var(--fondo-suave)",borderRadius:6,border:"0.5px solid var(--borde)",marginBottom:6}}>
              <div style={{fontSize:"var(--fs-1)",fontWeight:600,color:"var(--primario)",marginBottom:8}}>🎯 Tumor</div>
              {tumores.length > 0 && (
                <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:8}}>
                  {tumores.map((t, idx) => (
                    <div key={idx} style={{display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:"var(--fs-1)",color:"var(--texto)",background:"var(--superficie)",padding:"5px 9px",borderRadius:6}}>
                      <span>{[t.organo, t.sublocalizacion, t.tamano?`${t.tamano} cm`:""].filter(Boolean).join(" · ")}</span>
                      <button onClick={()=>setTumores(tumores.filter((_,i)=>i!==idx))} style={{background:"none",border:"none",color:"var(--peligro)",cursor:"pointer",fontSize:"var(--fs-2)",padding:0}}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                <select value={formTumor.organo} onChange={e=>setFormTumor({...formTumor,organo:e.target.value,sublocalizacion:""})} style={{...inputStyle,marginBottom:0}}>
                  <option value="">Órgano...</option>
                  {["Renal","Uréter","Vejiga"].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                {formTumor.organo === "Renal" && (
                  <select value={formTumor.sublocalizacion} onChange={e=>setFormTumor({...formTumor,sublocalizacion:e.target.value})} style={{...inputStyle,marginBottom:0}}>
                    <option value="">Localización...</option>
                    {["Polo superior","Polo medio","Polo inferior"].map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                )}
                {formTumor.organo === "Uréter" && (
                  <select value={formTumor.sublocalizacion} onChange={e=>setFormTumor({...formTumor,sublocalizacion:e.target.value})} style={{...inputStyle,marginBottom:0}}>
                    <option value="">Localización...</option>
                    {["Proximal","Medio","Distal"].map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                )}
                {formTumor.organo === "Vejiga" && (
                  <select value={formTumor.sublocalizacion} onChange={e=>setFormTumor({...formTumor,sublocalizacion:e.target.value})} style={{...inputStyle,marginBottom:0}}>
                    <option value="">Localización...</option>
                    {["Cúpula","Fondo","Pared lateral derecha","Pared lateral izquierda","Piso vesical","Pared anterior"].map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                )}
                <div style={{display:"flex",alignItems:"center",gap:4}}>
                  <input type="number" value={formTumor.tamano} onChange={e=>setFormTumor({...formTumor,tamano:e.target.value})} placeholder="Tamaño" style={{...inputStyle,marginBottom:0}}/>
                  <span style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)"}}>cm</span>
                </div>
                <button onClick={()=>{
                  if (!formTumor.organo) return alert("Selecciona el órgano");
                  setTumores([...tumores, formTumor]);
                  setFormTumor({ organo: "", sublocalizacion: "", tamano: "" });
                }} style={{padding:"7px 12px",fontSize:"var(--fs-1)",background:"var(--exito)",color:"var(--texto-inv)",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>+ Agregar tumor</button>
              </div>
            </div>
          )}

          <textarea value={nuevoEx.resultado} onChange={e=>setNuevoEx({...nuevoEx,resultado:e.target.value})} placeholder="Resultado (opcional)" rows={2} style={{...inputStyle,resize:"vertical"}}/>
          <button onClick={guardarExamen} style={{...btnPrimary, marginTop:0}}>+ Guardar examen</button>
          </>)}
        </div>
      </div>
    );
  }

  // ============================================================
  // RENDER: VISTA LISTA (KANBAN)
  // ============================================================

  return (
    <div ref={listaScrollElRef} onScroll={e=>{listaScrollPosRef.current = e.currentTarget.scrollTop;}} style={{padding:"16px",overflowY:"auto"}}>

      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:10}}>
        <button onClick={toggleOrientacionPac} title="Cambiar entre vista vertical y horizontal" aria-label="Cambiar orientación de la vista" style={{padding:"6px 10px",fontSize:"var(--fs-1)",fontWeight:600,background:"var(--superficie)",color:"var(--primario)",border:"0.5px solid var(--borde)",borderRadius:7,cursor:"pointer",whiteSpace:"nowrap"}}>{orientacionPac==="horizontal"?"↔ Horizontal":"↕ Vertical"}</button>
        {!soloLectura && (
          <div style={{display:"flex",gap:6,flexWrap:"wrap",position:"relative"}}>
            <button ref={servBtnRef} onClick={()=>setServiciosMenuOpen(v=>!v)} style={{padding:"6px 12px",fontSize:"var(--fs-1)",fontWeight:600,background:serviciosMenuOpen?"var(--primario)":"var(--superficie)",color:serviciosMenuOpen?"var(--texto-inv)":"var(--primario)",border:serviciosMenuOpen?"none":"0.5px solid var(--borde)",borderRadius:7,cursor:"pointer",whiteSpace:"nowrap"}}>
              {filtroServicio==="todos" ? "Todos los servicios" : filtroServicio}{filtroEstado!=="activo" ? ` · ${ETIQUETA_ESTADO[filtroEstado]||filtroEstado}` : ""} {serviciosMenuOpen?"▴":"▾"}
            </button>
            <button onClick={()=>setVista("nuevo")} style={{padding:"6px 12px",fontSize:"var(--fs-1)",fontWeight:600,background:"var(--primario)",color:"var(--texto-inv)",border:"none",borderRadius:7,cursor:"pointer",whiteSpace:"nowrap"}}>+ Nuevo</button>
            <button onClick={()=>setShowDistribucion(true)} style={{padding:"6px 12px",fontSize:"var(--fs-1)",fontWeight:600,background:"var(--superficie)",color:"var(--primario)",border:"0.5px solid var(--borde)",borderRadius:7,cursor:"pointer",whiteSpace:"nowrap"}}>Distribución</button>

            {/* Menú desplegable de servicios + estado (estilo Hospital) */}
            {serviciosMenuOpen && (
              <>
                <div onClick={()=>setServiciosMenuOpen(false)} style={{position:"fixed",inset:0,zIndex:40}}/>
                <div style={{
                  position:"fixed",
                  top: (servBtnRef.current?.getBoundingClientRect().bottom || 100) + 6,
                  left: servBtnRef.current?.getBoundingClientRect().left || 16,
                  zIndex:41,minWidth:240,maxWidth:300,
                  maxHeight: `calc(100dvh - ${(servBtnRef.current?.getBoundingClientRect().bottom || 100) + 16}px)`,
                  overflowY:"auto",background:"var(--fondo)",border:"0.5px solid var(--borde)",borderRadius:12,boxShadow:"0 12px 32px rgba(15,23,42,0.22)",padding:"6px"}}>
                  <div style={{fontSize:"var(--fs-xs)",fontWeight:700,color:"var(--texto-ter)",letterSpacing:0.5,padding:"6px 10px 4px"}}>SERVICIOS</div>
                  <button onClick={()=>{ setFiltroServicio("todos"); setServiciosMenuOpen(false); }} style={itemMenu(filtroServicio==="todos")}>
                    Todos los servicios {filtroServicio==="todos" ? "✓" : ""}
                  </button>
                  {serviciosDisponibles.map(s => (
                    <button key={s} onClick={()=>{ setFiltroServicio(s); setServiciosMenuOpen(false); }} style={itemMenu(filtroServicio===s)}>
                      {s} {filtroServicio===s ? "✓" : ""}
                    </button>
                  ))}

                  <div style={{height:"0.5px",background:"var(--borde)",margin:"6px 8px"}}/>
                  <div style={{fontSize:"var(--fs-xs)",fontWeight:700,color:"var(--texto-ter)",letterSpacing:0.5,padding:"4px 10px"}}>ESTADO</div>
                  {ESTADOS_PACIENTE.map(([val,lbl]) => (
                    <button key={val} onClick={()=>{ setFiltroEstado(val); setServiciosMenuOpen(false); }} style={itemMenu(filtroEstado===val)}>
                      {lbl} {filtroEstado===val ? "✓" : ""}
                    </button>
                  ))}

                  <div style={{height:"0.5px",background:"var(--borde)",margin:"6px 8px"}}/>
                  <div style={{fontSize:"var(--fs-xs)",fontWeight:700,color:"var(--texto-ter)",letterSpacing:0.5,padding:"4px 10px"}}>
                    VIENDO: {(esEquipo ? (equipoActual?.nombre||"EQUIPO") : "MIS PACIENTES").toUpperCase()}
                  </div>
                  <button onClick={()=>{ setServiciosMenuOpen(false); setVista("servicios"); }} style={{...itemMenu(false),color:"var(--primario)"}}>
                    🗂️ {esEquipo ? "Administrar servicios del equipo" : "Administrar mis servicios"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        <div style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)",marginLeft:soloLectura?0:"auto"}}>
          {pacientesFiltrados.length} pacientes
        </div>
      </div>

      {/* MODAL: distribución de pacientes por encargado */}
      {/* HOJA: mover paciente de servicio (mantén presionado una tarjeta) */}
      {moverPaciente && (() => {
        const destinos = Array.from(new Set([
          ...misServiciosLista.map(s => s.nombre),
          ...serviciosEquipo.map(s => s.nombre),
          ...Object.keys(porServicio),
        ])).filter(Boolean).sort((a, b) => a.localeCompare(b, "es", { numeric: true, sensitivity: "base" }));
        return (
          <div onClick={()=>setMoverPaciente(null)} style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.45)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:65}}>
            <div onClick={e=>e.stopPropagation()} style={{background:"var(--fondo)",borderTopLeftRadius:16,borderTopRightRadius:16,padding:"16px 16px 24px",width:"100%",maxWidth:480,maxHeight:"70vh",overflowY:"auto",WebkitOverflowScrolling:"touch"}}>
              <div style={{width:36,height:4,background:"var(--borde)",borderRadius:2,margin:"0 auto 12px"}}/>
              <div style={{fontSize:"var(--fs-2)",fontWeight:700,color:"var(--texto)",marginBottom:2}}>Mover a otro servicio</div>
              <div style={{fontSize:"var(--fs-1)",color:"var(--texto-ter)",marginBottom:12}}>{moverPaciente.iniciales} · actualmente en <b>{moverPaciente.servicio}</b></div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {destinos.filter(s => s !== moverPaciente.servicio).map(s => (
                  <button key={s} onClick={()=>moverAServicio(s)} style={{textAlign:"left",padding:"11px 13px",fontSize:"var(--fs-2)",fontWeight:600,background:"var(--fondo-suave)",color:"var(--texto)",border:"0.5px solid var(--borde)",borderRadius:9,cursor:"pointer"}}>{s}</button>
                ))}
                {destinos.filter(s => s !== moverPaciente.servicio).length === 0 && (
                  <div style={{fontSize:"var(--fs-1)",color:"var(--texto-ter)",fontStyle:"italic",padding:"6px 0"}}>No hay otros servicios configurados.</div>
                )}
              </div>
              <button onClick={()=>setMoverPaciente(null)} style={{width:"100%",marginTop:12,padding:11,fontSize:"var(--fs-2)",background:"none",color:"var(--texto-ter)",border:"none",cursor:"pointer"}}>Cancelar</button>
            </div>
          </div>
        );
      })()}

      {ingresoAbierto && <IngresoModal currentUser={currentUser} contexto={contexto} onCreado={(p)=>setPacientes(prev=>[p,...prev])} onClose={()=>setIngresoAbierto(false)} />}
      {dragPos && dragPacRef.current && <div style={{position:"fixed",left:dragPos.x+12,top:dragPos.y-14,zIndex:200,pointerEvents:"none",background:"var(--superficie)",border:"1px solid var(--primario)",borderRadius:8,padding:"6px 10px",fontSize:"var(--fs-1)",fontWeight:700,color:"var(--texto)",boxShadow:"0 8px 20px rgba(0,0,0,0.3)"}}>{dragPacRef.current.iniciales}</div>}
      <input ref={inputFotoMenuRef} type="file" accept="image/*,application/pdf" multiple style={{display:"none"}} onChange={onFotoMenuIngreso}/>
      {fotoMenuCargando && (
        <div style={{position:"fixed",left:0,right:0,bottom:16,zIndex:210,display:"flex",justifyContent:"center",pointerEvents:"none"}}>
          <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"9px 14px",fontSize:"var(--fs-1)",fontWeight:600,color:"var(--texto)",boxShadow:"0 8px 20px rgba(0,0,0,0.28)"}}>🔍 Leyendo ingreso{typeof fotoMenuCargando === "string" ? ` de ${fotoMenuCargando}` : ""}…</div>
        </div>
      )}
      {opcionesPaciente && (() => {
        const p = opcionesPaciente; const cerrar = () => setOpcionesPaciente(null);
        const item = (label, fn, color) => (<button onClick={()=>{ cerrar(); fn(); }} style={{textAlign:"left",padding:"12px 14px",fontSize:"var(--fs-2)",fontWeight:600,background:"var(--fondo-suave)",color:color||"var(--texto)",border:"0.5px solid var(--borde)",borderRadius:9,cursor:"pointer"}}>{label}</button>);
        return (
          <div onClick={cerrar} style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.45)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:66}}>
            <div onClick={e=>e.stopPropagation()} style={{background:"var(--fondo)",borderTopLeftRadius:16,borderTopRightRadius:16,padding:"16px 16px 24px",width:"100%",maxWidth:480}}>
              <div style={{width:36,height:4,background:"var(--borde)",borderRadius:2,margin:"0 auto 12px"}}/>
              <div style={{fontSize:"var(--fs-2)",fontWeight:700,color:"var(--texto)"}}>{p.iniciales}</div>
              <div style={{fontSize:"var(--fs-1)",color:"var(--texto-ter)",marginBottom:12}}>Cama {p.cama||"—"} · {p.servicio}</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {item(p.estado==="alta"?"↩️ Reactivar (marcar activo)":"✅ Dar de alta", ()=>cambiarEstado(p, p.estado==="alta"?"activo":"alta"), p.estado==="alta"?"var(--primario)":"var(--exito)")}
                {item("📄 Adjuntar ingreso", ()=>setIngresoPacienteMenu(p))}
                {item("📷 Ingreso desde foto", ()=>{ fotoMenuTargetRef.current = p; inputFotoMenuRef.current?.click(); })}
                {item("🔀 Cambiar de servicio", ()=>setMoverPaciente(p))}
                {item("🛏️ Cambiar cama", ()=>{ setCamaInput(p.cama||""); setMoverInfo({ pacienteId:p.id, iniciales:p.iniciales, servicio:p.servicio, prevServicio:p.servicio, prevCama:p.cama, soloCama:true }); })}
                {item("🩸 Transfusión", ()=>setTxPacienteMenu(p), "var(--peligro)")}
                {item("✏️ Editar", ()=>{ abrirFicha(p); setAutoEditId(p.id); })}
                {item("🗑 Eliminar", ()=>eliminarPacienteDirecto(p), "var(--peligro)")}
              </div>
              <button onClick={cerrar} style={{width:"100%",marginTop:12,padding:11,fontSize:"var(--fs-2)",background:"none",color:"var(--texto-ter)",border:"none",cursor:"pointer"}}>Cancelar</button>
            </div>
          </div>
        );
      })()}
      {txPacienteMenu && <OrdenTransfusionModal paciente={txPacienteMenu} currentUser={currentUser} examenes={[]} onClose={()=>setTxPacienteMenu(null)} />}
      {ingresoPacienteMenu && <IngresoModal currentUser={currentUser} contexto={contexto} ingresoExistente={{ datos: { nombre: ingresoPacienteMenu.iniciales, ficha: ingresoPacienteMenu.ficha_clinica || "", rut: ingresoPacienteMenu.rut || "", edad: String(ingresoPacienteMenu.edad || ""), sexo: ingresoPacienteMenu.sexo || "", hipotesis: ingresoPacienteMenu.diagnostico || "" } }} onCreado={()=>{}} onClose={()=>setIngresoPacienteMenu(null)} />}
      {moverInfo && (
        <div style={{position:"fixed",left:0,right:0,bottom:0,zIndex:66,display:"flex",justifyContent:"center",padding:12,pointerEvents:"none"}}>
          <div style={{pointerEvents:"auto",background:"var(--fondo)",border:"0.5px solid var(--borde)",borderRadius:12,boxShadow:"0 8px 28px rgba(0,0,0,0.28)",padding:"12px 14px",width:"100%",maxWidth:440}}>
            <div style={{fontSize:"var(--fs-1)",color:"var(--texto-sec)",marginBottom:8}}>{moverInfo.soloCama ? <>Cambiar cama de <b>{moverInfo.iniciales}</b></> : <><b>{moverInfo.iniciales}</b> pasó a <b>{moverInfo.servicio}</b>. ¿Nueva cama?</>}</div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <input value={camaInput} onChange={e=>setCamaInput(e.target.value)} placeholder="Cama" style={{flex:1,minWidth:0,padding:"9px 11px",fontSize:"var(--fs-2)",border:"0.5px solid var(--borde)",borderRadius:7,background:"var(--superficie)",color:"var(--texto)",boxSizing:"border-box"}} onKeyDown={e=>{if(e.key==="Enter")guardarCamaMovido();}} />
              <button onClick={guardarCamaMovido} style={{flexShrink:0,padding:"9px 12px",fontSize:"var(--fs-2)",fontWeight:600,background:"var(--primario)",color:"var(--texto-inv)",border:"none",borderRadius:7,cursor:"pointer",whiteSpace:"nowrap"}}>Guardar</button>
              <button onClick={()=>{setMoverInfo(null);setCamaInput("");}} style={{flexShrink:0,padding:"9px 12px",fontSize:"var(--fs-2)",background:"var(--superficie)",color:"var(--texto-sec)",border:"0.5px solid var(--borde)",borderRadius:7,cursor:"pointer",whiteSpace:"nowrap"}}>Omitir</button>
            </div>
            {!moverInfo.soloCama && <button onClick={deshacerMovimiento} style={{marginTop:8,background:"none",border:"none",color:"var(--peligro)",fontSize:"var(--fs-1)",cursor:"pointer",padding:0,fontWeight:600}}>↩️ Deshacer movimiento</button>}
          </div>
        </div>
      )}

      {showDistribucion && (
        <div onClick={()=>setShowDistribucion(false)} style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:60,padding:16}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"var(--fondo)",border:"0.5px solid var(--borde)",borderRadius:14,padding:"18px",width:"100%",maxWidth:360,maxHeight:"80vh",overflowY:"auto",WebkitOverflowScrolling:"touch"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{fontSize:"var(--fs-3)",fontWeight:700,color:"var(--texto)"}}>👥 Distribución de pacientes</div>
              <button onClick={()=>setShowDistribucion(false)} style={{background:"none",border:"none",fontSize:18,cursor:"pointer",color:"var(--texto-ter)",lineHeight:1}}>✕</button>
            </div>
            {cargaPorMedico.length === 0 ? (
              <div style={{fontSize:"var(--fs-1)",color:"var(--texto-ter)",fontStyle:"italic",padding:"6px 0"}}>Aún no hay pacientes activos con encargados asignados.</div>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {cargaPorMedico.map((c,i)=>{
                  const abierto = distDoctor===c.id;
                  const suyos = abierto ? pacientes.filter(p=>p.estado==="activo" && (p.encargados||[]).includes(c.id)) : [];
                  return (
                  <div key={c.id||i} style={{background:"var(--fondo-suave)",borderRadius:8,borderLeft:`4px solid ${colorMedico(c.id)}`,overflow:"hidden"}}>
                    <div onClick={()=>setDistDoctor(abierto?null:c.id)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 12px",cursor:"pointer"}}>
                      <span style={{fontSize:"var(--fs-2)",color:"var(--texto)",display:"flex",alignItems:"center",gap:8}}><span style={{width:11,height:11,borderRadius:"50%",background:colorMedico(c.id),flexShrink:0}}/>{abierto?"▾":"▸"} {c.nombre}</span>
                      <span style={{fontSize:"var(--fs-2)",fontWeight:700,color:"#fff",background:colorMedico(c.id),padding:"2px 10px",borderRadius:10}}>{c.n}</span>
                    </div>
                    {abierto && <div style={{padding:"0 12px 10px 30px",display:"flex",flexDirection:"column",gap:4}}>
                      {suyos.length===0 ? <div style={{fontSize:"var(--fs-1)",color:"var(--texto-ter)",fontStyle:"italic"}}>Sin pacientes activos.</div> :
                       suyos.map(p=>(
                        <div key={p.id} onClick={()=>{setShowDistribucion(false);setDistDoctor(null);abrirFicha(p);}} style={{fontSize:"var(--fs-1)",color:"var(--texto)",cursor:"pointer",display:"flex",justifyContent:"space-between",gap:8,padding:"2px 0"}}>
                          <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.iniciales}</span>
                          <span style={{color:"var(--texto-ter)",flexShrink:0}}>Cama {p.cama||"—"} · {p.servicio}</span>
                        </div>
                      ))}
                    </div>}
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {loadingPacientes && (
        <div style={{textAlign:"center",padding:"30px",color:"var(--texto-ter)",fontSize:"var(--fs-2)"}}>Cargando pacientes...</div>
      )}

      {!loadingPacientes && pacientesFiltrados.length === 0 && (
        <div style={{textAlign:"center",padding:"40px 20px",color:"var(--texto-ter)",fontSize:"var(--fs-2)",lineHeight:1.6}}>
          No hay pacientes en este contexto.<br/>
          {soloLectura ? "" : (esEquipo ? "Toca de nuevo la pestaña para agregar con + Nuevo" : "Toca de nuevo la pestaña y crea tu primer paciente con + Nuevo")}
        </div>
      )}

      {/* Vista kanban por servicio: se reordena dejando presionado el título y arrastrando */}
      {!loadingPacientes && pacientesFiltrados.length > 0 && (
        <>
          <div ref={kanbanRef} style={orientacionPac==="horizontal"
            ? {display:"flex",flexDirection:"row",flexWrap:"nowrap",gap:12,overflowX:"auto",WebkitOverflowScrolling:"touch",paddingBottom:8,position:"relative",touchAction:dragCol?"none":"auto"}
            : {display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:12,position:"relative",touchAction:dragCol?"none":"auto"}}>
            {nombresServicioOrdenados.map((servicio, idx) => {
              const arrastrando = dragCol?.nombre === servicio;
              // Las columnas vecinas se corren para abrir el hueco donde caerá la que se arrastra
              const corr = desplazamientoColumna(idx);
              let transform = "none";
              if (arrastrando) {
                transform = dragCol.vertical
                  ? `translateY(${dragCol.d}px) scale(1.03)`
                  : `translateX(${dragCol.d}px) scale(1.03)`;
              } else if (corr !== 0 && dragCol) {
                const el = kanbanRef.current?.children?.[idx];
                const r = el?.getBoundingClientRect();
                const paso = dragCol.vertical ? (r ? r.height + 12 : 120) : (r ? r.width + 12 : 292);
                transform = dragCol.vertical ? `translateY(${corr * paso}px)` : `translateX(${corr * paso}px)`;
              }
              return (
                <div key={servicio} data-serv={servicio} style={{
                  ...(orientacionPac==="horizontal" ? {flex:"0 0 300px",width:300,minWidth:300} : {}),
                  background:"var(--superficie)",
                  border: arrastrando ? "1px solid var(--primario)" : "0.5px solid var(--borde)",
                  borderRadius:10, padding:"12px",
                  boxShadow: arrastrando ? "0 14px 30px rgba(15,23,42,0.35)" : "none",
                  opacity: arrastrando ? 0.95 : 1,
                  transform,
                  zIndex: arrastrando ? 5 : 1, position:"relative",
                  transition: arrastrando ? "none" : "transform .18s cubic-bezier(.2,.8,.3,1)",
                }}>
                  <div
                    onPointerDown={(e)=>iniciarLongPress(e, servicio, idx)}
                    onPointerMove={moverLongPress}
                    onPointerUp={cancelarLongPress}
                    onPointerCancel={cancelarLongPress}
                    onPointerLeave={cancelarLongPress}
                    title={soloLectura ? undefined : "Deja presionado y arrastra para reordenar"}
                    style={{fontSize:"var(--fs-2)",fontWeight:700,color:"var(--texto)",marginBottom:8,paddingBottom:6,borderBottom:"0.5px solid var(--fondo)",display:"flex",alignItems:"center",gap:8,cursor:soloLectura?(undefined):(arrastrando?"grabbing":"grab"),touchAction:"pan-y",userSelect:"none",WebkitUserSelect:"none",WebkitTouchCallout:"none"}}>
                    {!soloLectura && <span style={{fontSize:"var(--fs-2)",color:"var(--texto-ter)",flexShrink:0}}>☰</span>}
                    <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{servicio}</span>
                    <span style={{color:"var(--texto-ter)",fontWeight:400,fontSize:"var(--fs-0)",flexShrink:0}}>({porServicio[servicio].length})</span>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {porServicio[servicio].map(p => (
                      <Fragment key={p.id}>
                      {gapId===p.id && <div style={{height:2,background:"var(--primario)",borderRadius:2,margin:"3px 0"}}/>}
                      <div data-pac-id={p.id} data-serv={servicio}
                        onClick={()=>{ if (Date.now()-arrastreRecienteRef.current < 400) return; if (longPressPacRef.current) { longPressPacRef.current = false; return; } abrirFicha(p); }}
                        onPointerDown={(e)=>{ if (soloLectura) return; pressPosPac.current={x:e.clientX,y:e.clientY}; longPressPacRef.current=false; clearTimeout(pressTimerPac.current); pressTimerPac.current=setTimeout(()=>{ longPressPacRef.current=true; try{navigator.vibrate?.(20);}catch{} setOpcionesPaciente(p); }, 500); }}
                        onPointerMove={(e)=>{ if (pressPosPac.current && (Math.abs(e.clientX-pressPosPac.current.x)>10||Math.abs(e.clientY-pressPosPac.current.y)>10)) clearTimeout(pressTimerPac.current); }}
                        onPointerUp={()=>clearTimeout(pressTimerPac.current)}
                        onPointerLeave={()=>clearTimeout(pressTimerPac.current)}
                        style={{background:p.estado==="activo"?"var(--fondo-suave)":"var(--neutro-bg)",borderRadius:6,padding:"10px 12px",cursor:"pointer",borderLeft:`3px solid ${p.estado==="activo"?"var(--primario)":"var(--neutro)"}`,touchAction:"pan-y",userSelect:"none",WebkitUserSelect:"none",WebkitTouchCallout:"none",opacity:dragPos&&dragPacRef.current?.id===p.id?0.4:1}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                          <div style={{fontSize:"var(--fs-2)",fontWeight:600,color:"var(--texto)"}}>
                            {p.iniciales} <span style={{fontSize:"var(--fs-3)",fontWeight:700,color:p.sexo==="F"?"var(--chip-rosa)":"var(--primario)"}}>{p.sexo==="F"?"♀":"♂"}</span>{p.estado_clinico && <span style={{marginLeft:5,fontSize:"var(--fs-2)"}} title={p.estado_clinico}>{p.estado_clinico==="estable"?"🟢":p.estado_clinico==="regular"?"🟡":p.estado_clinico==="cuidado"?"🔴":""}</span>}{p.operado && <span style={{marginLeft:4}} title="Operado">🔪</span>}
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            {!soloLectura && <div
                              onClick={(e)=>e.stopPropagation()}
                              onPointerDown={(e)=>iniciarDragPac(e,p)}
                              title="Arrastra para reordenar o cambiar de servicio" style={{cursor:"grab",fontSize:16,color:"var(--texto-ter)",padding:"0 3px",touchAction:"none",lineHeight:1,userSelect:"none"}}>⠿</div>}
                            <div style={{fontSize:"var(--fs-0)",fontWeight:600,color:"var(--primario)",background:"var(--chip-azul-bg)",padding:"2px 8px",borderRadius:8,whiteSpace:"nowrap"}}>Cama {p.cama || "—"}</div>
                          </div>
                        </div>
                        <div style={{fontSize:"var(--fs-1)",fontWeight:500,color:"var(--texto-sec)",marginBottom:3}}>{p.edad} años</div>
                        {(p.ficha_clinica || p.rut) && (
                          <div style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)",marginBottom:3}}>
                            {p.ficha_clinica ? `FC ${p.ficha_clinica}` : ""}{p.ficha_clinica && p.rut ? " · " : ""}{p.rut || ""}
                          </div>
                        )}
                        <div style={{fontSize:"var(--fs-0)",color:"var(--texto)",lineHeight:1.3,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{p.diagnostico}</div>
                        {p.estado === "alta" && <div style={{fontSize:9,color:"var(--neutro)",marginTop:4,fontStyle:"italic"}}>DADO DE ALTA</div>}
                        {esEquipo && <EncargadosPaciente paciente={p} miembros={miembrosEquipo} currentUser={currentUser} onActualizar={asignarEncargados} />}
                      </div>
                      </Fragment>
                    ))}
                    {dragPos && gapId===("__"+servicio) && <div style={{height:2,background:"var(--primario)",borderRadius:2,margin:"3px 0"}}/>}
                  </div>
                </div>
              );
            })}
            {dragPos && serviciosVacios.map(servicio => (
              <div key={"vacio-"+servicio} data-serv={servicio} data-empty="1" style={{border:"1.5px dashed var(--primario)",borderRadius:10,padding:"20px 12px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"var(--fs-2)",fontWeight:600,color:"var(--primario)",minHeight:64,opacity:gapId===("__"+servicio)?1:0.5,background:gapId===("__"+servicio)?"var(--chip-azul-bg)":"transparent",transition:"opacity .1s"}}>Soltar en {servicio}</div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Estilos unificados (tokens) para encabezados de sección y botones de ícono.
const ST_TITULO_SEC = { fontSize: "var(--fs-3)", fontWeight: 600, color: "var(--texto)" };
const ST_BTN_ICO = { width: "var(--icon-sm)", height: "var(--icon-sm)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "var(--icon-fs)", lineHeight: 1, background: "var(--superficie)", color: "var(--primario)", border: "0.5px solid var(--borde)", borderRadius: 7, cursor: "pointer", padding: 0 };
const ST_BTN_MAS = { ...ST_BTN_ICO, background: "var(--primario)", color: "var(--texto-inv)", border: "none", fontWeight: 600 };

function scrollParent(el) {
  while (el && el !== document.body) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 4) return el;
    el = el.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

// Color estable por médico desde paleta fija (usado en Distribución y en la ficha).
const PALETA_MEDICOS = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#ea580c", "#4f46e5", "#0d9488", "#b45309"];
function colorMedico(id) {
  const s = String(id || "");
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100000;
  return PALETA_MEDICOS[h % PALETA_MEDICOS.length];
}

function EncargadosPaciente({ paciente, miembros, currentUser, onActualizar }) {
  const [abierto, setAbierto] = useState(false);
  const encargados = Array.isArray(paciente.encargados) ? paciente.encargados : [];

 const toggle = async (userId) => {
  const nueva = encargados.includes(userId)
    ? encargados.filter(id => id !== userId)
    : [...encargados, userId];
  await onActualizar(paciente.id, nueva);
};

  const nombreDe = (id) => {
    const m = miembros.find(x => x.perfiles?.id === id);
    return m?.perfiles?.nombre || "?";
  };
  const colorDeEncargado = (id) => { const c = colorMedico(id); return { bg: c + "22", text: c }; };

  return (
    <div onClick={(e)=>e.stopPropagation()} style={{marginTop:6}}>
      <div style={{display:"flex",flexWrap:"wrap",gap:4,alignItems:"center"}}>
        {encargados.map(id => {
  const c = colorDeEncargado(id);
  return (
    <span key={id} style={{fontSize:"var(--fs-1)",background:c.bg,color:c.text,padding:"3px 9px",borderRadius:10,fontWeight:600}}>
      {nombreDe(id)}
    </span>
  );
})}
        <button onClick={()=>setAbierto(!abierto)} style={{fontSize:"var(--fs-3)",background:"var(--fondo-suave)",color:"var(--primario)",border:"0.5px solid var(--borde)",borderRadius:"50%",width:24,height:24,cursor:"pointer",fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1,padding:0}}>
          {abierto ? "×" : "+"}
        </button>
      </div>
      {abierto && (
        <div style={{marginTop:4,background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:6,padding:"4px",maxHeight:140,overflowY:"auto"}}>
          {miembros.map(m => {
            const id = m.perfiles?.id;
            const asignado = encargados.includes(id);
            return (
              <div key={id} onClick={()=>toggle(id)} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 4px",cursor:"pointer",fontSize:"var(--fs-0)",color:"var(--texto)"}}>
                <span style={{width:14,height:14,borderRadius:3,border:"1px solid var(--borde)",background:asignado?"var(--primario)":"var(--superficie)",color:"var(--texto-inv)",fontSize:"var(--fs-xs)",display:"flex",alignItems:"center",justifyContent:"center"}}>{asignado?"✓":""}</span>
                {m.perfiles?.nombre}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function VideoPlayer({ video, onClose }) {
  const ytId = getYouTubeId(video.url);
  const vimeoId = getVimeoId(video.url);
  useBackClose(true, onClose);
  return (
    <div onClick={onClose} style={{position:"absolute",inset:0,background:"rgba(26,58,92,0.85)",zIndex:50,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px",borderRadius:"var(--border-radius-lg)"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"var(--superficie)",borderRadius:12,maxWidth:720,width:"100%",overflow:"hidden"}}>
        <div style={{padding:"10px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"0.5px solid var(--borde)"}}>
          <div style={{fontSize:"var(--fs-2)",fontWeight:500,color:"var(--texto)"}}>{video.titulo}</div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:18,color:"var(--texto-ter)",cursor:"pointer",padding:0}}>✕</button>
        </div>
        <div style={{aspectRatio:"16/9",background:"#000"}}>
          {vimeoId ? <iframe src={`https://player.vimeo.com/video/${vimeoId}?autoplay=1`} style={{width:"100%",height:"100%",border:"none"}} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen title={video.titulo}/> : ytId ? <iframe src={`https://www.youtube.com/embed/${ytId}?autoplay=1`} style={{width:"100%",height:"100%",border:"none"}} allow="autoplay; encrypted-media" allowFullScreen title={video.titulo}/> : <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",color:"var(--texto-inv)"}}>Video no disponible</div>}
        </div>
      </div>
    </div>
  );
}

function VideoLibrary({ videos, setVideos, isAdmin, setPlayingVideo }) {
  const [filtro, setFiltro] = useState("Todas");
  const [busqueda, setBusqueda] = useState("");
  const [agregando, setAgregando] = useState(false);
  const [nuevo, setNuevo] = useState({ titulo:"", categoria:"Oncología", url:"", autor:"", descripcion:"", keywords:"" });
  const [errorAdd, setErrorAdd] = useState("");
  const filtrados = videos.filter(v => {
    const matchCat = filtro === "Todas" || v.categoria === filtro;
    const q = busqueda.toLowerCase().trim();
   const matchQ = !q || v.titulo.toLowerCase().includes(q) || (v.descripcion || "").toLowerCase().includes(q);
    return matchCat && matchQ;
  });
  const agregarVideo = async () => {
  setErrorAdd("");
  if (!nuevo.titulo.trim()) return setErrorAdd("Ingresa un título");
  if (!nuevo.url.trim()) return setErrorAdd("Ingresa la URL");
 if (!getYouTubeId(nuevo.url) && !getVimeoId(nuevo.url)) return setErrorAdd("URL de YouTube o Vimeo inválida");
  
  const sesionResult = await getSession();
  if (!sesionResult.ok || !sesionResult.session) return setErrorAdd("Error de sesión");
  
  const result = await crearVideo(sesionResult.session.user.id, {
    titulo: nuevo.titulo,
    url: nuevo.url,
    categoria: nuevo.categoria,
    descripcion: nuevo.descripcion || null,
  });
  
  if (!result.ok) return setErrorAdd("Error al guardar: " + result.error);
  
  setVideos([result.video, ...videos]);
  setNuevo({ titulo:"", categoria:"Oncología", url:"", autor:"", descripcion:"", keywords:"" });
  setAgregando(false);
};
 const eliminarVideo = async (id) => {
  if (confirm("¿Eliminar?")) {
    const result = await eliminarVideoSupabase(id);
    if (!result.ok) return alert("Error: " + result.error);
    setVideos(videos.filter(v => v.id !== id));
  }
};

  return (
    <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,gap:10}}>
        <div>          <div style={{fontSize:"var(--fs-2)",color:"var(--texto-sec)"}}>{videos.length} videos</div>
        </div>
        {isAdmin && <button onClick={()=>setAgregando(!agregando)} style={{padding:"7px 12px",fontSize:"var(--fs-1)",fontWeight:500,background: agregando?"var(--superficie)":"var(--primario)",color: agregando?"var(--primario)":"var(--texto-inv)",border: agregando?"1px solid var(--primario)":"none",borderRadius:8,cursor:"pointer"}}>{agregando ? "Cancelar" : "+ Agregar"}</button>}
      </div>
      {agregando && isAdmin && (
        <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"14px",marginBottom:14}}>
          <input value={nuevo.titulo} onChange={e=>setNuevo({...nuevo,titulo:e.target.value})} placeholder="Título" style={inputStyle}/>
          <select value={nuevo.categoria} onChange={e=>setNuevo({...nuevo,categoria:e.target.value})} style={inputStyle}>{CATEGORIAS_VIDEO.filter(c=>c!=="Todas").map(c=><option key={c}>{c}</option>)}</select>
          <input value={nuevo.url} onChange={e=>setNuevo({...nuevo,url:e.target.value})} placeholder="URL YouTube" style={inputStyle}/>
          <input value={nuevo.autor} onChange={e=>setNuevo({...nuevo,autor:e.target.value})} placeholder="Autor (opcional)" style={inputStyle}/>
          <textarea value={nuevo.descripcion} onChange={e=>setNuevo({...nuevo,descripcion:e.target.value})} placeholder="Descripción" rows={2} style={{...inputStyle,resize:"none"}}/>
          {errorAdd && <div style={{fontSize:"var(--fs-1)",color:"var(--peligro)",background:"var(--peligro-bg)",padding:"8px 10px",borderRadius:6,marginBottom:8}}>{errorAdd}</div>}
          <button onClick={agregarVideo} style={{...btnPrimary, marginTop:0}}>Guardar video</button>
        </div>
      )}
      <input value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="Buscar..." style={{...inputStyle, marginBottom:8}}/>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
        {CATEGORIAS_VIDEO.map(c => <button key={c} onClick={()=>setFiltro(c)} style={{padding:"5px 10px",fontSize:"var(--fs-0)",fontWeight:filtro===c?500:400,borderRadius:14,cursor:"pointer",border:filtro===c?"none":"0.5px solid var(--borde)",background:filtro===c?"var(--primario)":"var(--superficie)",color:filtro===c?"var(--texto-inv)":"var(--texto-sec)"}}>{c}</button>)}
      </div>
      {filtrados.length === 0 ? (
        <div style={{textAlign:"center",padding:"40px 0",color:"var(--texto-ter)",fontSize:"var(--fs-2)"}}>No hay videos</div>
      ) : (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12}}>
          {filtrados.map(v => {
            return (
              <div key={v.id} style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,overflow:"hidden",display:"flex",flexDirection:"column"}}>
                <div onClick={()=>setPlayingVideo(v)} style={{position:"relative",cursor:"pointer",background:"var(--navy-fijo)",aspectRatio:"16/9",overflow:"hidden"}}>
                  <VideoThumb url={v.url} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
                  <div style={{position:"absolute",inset:0,background:"rgba(26,58,92,0.25)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <div style={{width:44,height:44,borderRadius:"50%",background:"rgba(255,255,255,0.9)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,color:"var(--primario)"}}>▶</div>
                  </div>
                </div>
                <div style={{padding:"10px 12px",flex:1,display:"flex",flexDirection:"column"}}>
                  <div style={{fontSize:"var(--fs-2)",fontWeight:500,color:"var(--texto)",marginBottom:3,lineHeight:1.3}}>{v.titulo}</div>
                  <div style={{fontSize:"var(--fs-0)",color:"var(--texto-sec)",marginBottom:6}}>{v.categoria} · {v.autor}</div>
                  <div style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)",lineHeight:1.4,flex:1}}>{v.descripcion}</div>
                  {isAdmin && <button onClick={()=>eliminarVideo(v.id)} style={{marginTop:8,padding:"5px 8px",fontSize:"var(--fs-0)",background:"var(--superficie)",color:"var(--peligro)",border:"0.5px solid var(--peligro-borde)",borderRadius:6,cursor:"pointer",alignSelf:"flex-start"}}>Eliminar</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NotificationBell({ currentUser }) {
  const [abierto, setAbierto] = useState(false);
  const [notifs, setNotifs] = useState([]);
  const btnRef = useRef(null);
  const noLeidas = notifs.filter(n => !n.leida).length;

  const cargar = async () => {
    const r = await listarNotificaciones(currentUser.id);
    if (r.ok) setNotifs(r.notificaciones);
  };
  useEffect(() => { cargar(); const t = setInterval(cargar, 90000); return () => clearInterval(t); }, []);

  const abrir = async () => {
    setAbierto(!abierto);
    if (!abierto && noLeidas > 0) {
      await marcarNotificacionesLeidas(currentUser.id);
      setNotifs(prev => prev.map(n => ({ ...n, leida: true })));
    }
  };

  const iconoTipo = { cirugia: "🔪", paciente: "🛏️", pendiente: "✅", general: "🔔" };
  // El panel va en position:fixed para que no lo recorte el contenedor de la app en el celular
  const top = (btnRef.current?.getBoundingClientRect().bottom || 60) + 6;

  return (
    <div style={{position:"relative"}}>
      <button ref={btnRef} onClick={abrir} title="Notificaciones" style={{width:38,height:38,borderRadius:"50%",background:"var(--superficie)",border:"0.5px solid var(--borde)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0,position:"relative"}}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="var(--primario)" stroke="var(--primario)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0" fill="none"/>
        </svg>
        {noLeidas > 0 && <span style={{position:"absolute",top:-3,right:-3,minWidth:17,height:17,borderRadius:9,background:"var(--peligro)",color:"var(--texto-inv)",fontSize:"var(--fs-xs)",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 4px"}}>{noLeidas}</span>}
      </button>
      {abierto && (
        <>
          <div onClick={()=>setAbierto(false)} style={{position:"fixed",inset:0,zIndex:70}}/>
          <div style={{position:"fixed",top,right:8,left:"auto",zIndex:71,width:"min(340px, calc(100vw - 16px))",maxHeight:"calc(100dvh - 120px)",overflowY:"auto",WebkitOverflowScrolling:"touch",background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:12,boxShadow:"0 10px 28px rgba(0,0,0,0.28)"}}>
            <div style={{position:"sticky",top:0,background:"var(--superficie)",padding:"10px 14px",borderBottom:"0.5px solid var(--borde-suave)",fontSize:"var(--fs-2)",fontWeight:600,color:"var(--texto)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span>Notificaciones</span>
              <button onClick={()=>setAbierto(false)} style={{background:"none",border:"none",fontSize:16,color:"var(--texto-ter)",cursor:"pointer",lineHeight:1,padding:0}}>✕</button>
            </div>
            {notifs.length === 0 && <div style={{padding:"18px 14px",fontSize:"var(--fs-1)",color:"var(--texto-ter)",fontStyle:"italic"}}>Sin notificaciones</div>}
            {notifs.map(n => (
              <div key={n.id} style={{padding:"10px 14px",borderBottom:"0.5px solid var(--borde-suave)",background:n.leida?"transparent":"var(--fondo-suave)"}}>
                <div style={{fontSize:"var(--fs-1)",color:"var(--texto)",lineHeight:1.45,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{iconoTipo[n.tipo]||"🔔"} {n.texto}</div>
                <div style={{fontSize:"var(--fs-xs)",color:"var(--texto-ter)",marginTop:3}}>{new Date(n.created_at).toLocaleString("es-CL",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Lee la sesión que Supabase persiste en localStorage (clave "sb-<ref>-auth-token").
// Sirve para restaurar el login sin red, aunque supabase-js no logre refrescar el
// token offline. Devuelve un objeto con al menos { user: { id } }, o null.
function leerSesionPersistida() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("sb-") || !/auth-token/.test(k)) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      let val;
      try { val = JSON.parse(raw); } catch { continue; }
      const sesion = val?.currentSession || val?.session || val;
      if (sesion?.user?.id) return sesion;
    }
  } catch {}
  return null;
}

// ─── Estado de conexión: true si el navegador cree tener red ───
function useOnline() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const subir = () => setOnline(true);
    const bajar = () => setOnline(false);
    window.addEventListener("online", subir);
    window.addEventListener("offline", bajar);
    return () => { window.removeEventListener("online", subir); window.removeEventListener("offline", bajar); };
  }, []);
  return online;
}

// Banda superior discreta que avisa cuando no hay conexión (datos desde caché).
function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div style={{
      background: "var(--alerta-bg, #FEF3C7)", color: "var(--alerta, #92400E)",
      fontSize: "var(--fs-1)", fontWeight: 600, textAlign: "center", padding: "5px 12px",
      borderBottom: "0.5px solid var(--alerta-borde, #FCD34D)", flexShrink: 0,
    }}>
      Sin conexión · mostrando datos guardados
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [users, setUsers] = useState([]); // TEMPORAL: hasta migrar AdminPanel/EquiposPanel
  const [loadingSession, setLoadingSession] = useState(true);
  const [pacientes, setPacientes] = useState([]);
  const [tablaCirugias, setTablaCirugias] = useState([]);
const [pendientes, setPendientes] = useState([]);
const [loadingCirugias, setLoadingCirugias] = useState(false);
const [loadingPendientes, setLoadingPendientes] = useState(false);
  const [conocimiento, setConocimiento] = useState([]);
  const [chunks, setChunks] = useState([]);
  const [videos, setVideos] = useState([]);
  const [misServiciosLista, setMisServiciosLista] = useState([]); // array de {id, nombre, ...}
const [loadingPacientes, setLoadingPacientes] = useState(false);
  const [equipos, setEquipos] = useState([]);
  const [invitacionesPendientes, setInvitacionesPendientes] = useState([]);
  const [invitaciones, setInvitaciones] = useState([]);
  const [playingVideo, setPlayingVideo] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [mostrarOnboardingPush, setMostrarOnboardingPush] = useState(false);
  const [bloqueado, setBloqueado] = useState(() => leerLock().enabled);
  useEffect(() => {
    let ocultoEn = 0;
    const onVis = () => {
      if (document.visibilityState === "hidden") ocultoEn = Date.now();
      else if (leerLock().enabled && ocultoEn && Date.now() - ocultoEn > 120000) setBloqueado(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  const [tab, setTab] = useState(() => {
  try { return localStorage.getItem("uro_tab") || "chat"; }
  catch { return "chat"; }
});
  const [tema, setTema] = useState(() => {
    try { return localStorage.getItem("uro_tema") || "light"; }
    catch { return "light"; }
  });
  // Si la app cargó bien, se limpia la marca de "ya recargué por caché vieja"
  useEffect(() => { try { sessionStorage.removeItem("uro_recarga_import"); } catch {} }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", tema);
    try { localStorage.setItem("uro_tema", tema); } catch {}
    // Pinta <html>, <body> y la barra del sistema con el fondo de la app,
    // para que no asome una franja blanca bajo el contenido en el celular.
    try {
      const fondo = getComputedStyle(document.documentElement).getPropertyValue("--fondo").trim() || "#ffffff";
      document.documentElement.style.background = fondo;
      document.body.style.background = fondo;
      document.body.style.margin = "0";
      // Sin rebote elástico: evita la franja blanca al final del scroll y que
      // el navegador recargue la página al deslizar hacia abajo (pull-to-refresh),
      // que es el gesto que usamos para abrir el submenú.
      document.documentElement.style.overscrollBehaviorY = "none";
      document.body.style.overscrollBehaviorY = "none";
      document.documentElement.style.height = "100%";
      document.body.style.height = "100%";
      let meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) { meta = document.createElement("meta"); meta.name = "theme-color"; document.head.appendChild(meta); }
      meta.setAttribute("content", fondo);
    } catch {}
  }, [tema]);
  const config = useConfig();               // configuración del usuario (funciones + modo del chat)
  const [configOpen, setConfigOpen] = useState(false); // modal "Configuración"
  const [equiposOpen, setEquiposOpen] = useState(false); // modal "Equipos" (menú de perfil)

  // ─── Sub-secciones de cada pestaña (viven aquí para que el submenú se
  // despliegue desde la pestaña principal, sin barras extra en los paneles) ───
  const [subTabHospital, setSubTabHospital] = useState(() => {
    try { return localStorage.getItem("uro_subtab_hospital") || "pacientes"; } catch { return "pacientes"; }
  });
  const [subTabLogbook, setSubTabLogbook] = useState(() => { try { return localStorage.getItem("uro_subtab_logbook") || "lista"; } catch { return "lista"; } });
  useEffect(() => { try { localStorage.setItem("uro_subtab_logbook", subTabLogbook); } catch {} }, [subTabLogbook]);
  const [subTabBiblio, setSubTabBiblio] = useState("cirugias");
  const [contexto, setContexto] = useState(() => {
    try { return localStorage.getItem("uro_contexto") || "personal"; } catch { return "personal"; }
  });
  const [submenuOpen, setSubmenuOpen] = useState(false); // desplegable bajo la pestaña activa
  const tabBarRef = useRef(null);
  const swipeRef = useRef(null);   // gesto de deslizamiento lateral entre pestañas
  const cierreRef = useRef(null);  // gesto para cerrar el submenú deslizando hacia arriba
  const [dirTab, setDirTab] = useState(0); // -1 = venimos de la derecha, 1 = de la izquierda
  const tabPrevio = useRef(tab);

  useEffect(() => { try { localStorage.setItem("uro_subtab_hospital", subTabHospital); } catch {} }, [subTabHospital]);
  useEffect(() => { try { localStorage.setItem("uro_contexto", contexto); } catch {} }, [contexto]);
  useEffect(() => { setSubmenuOpen(false); }, [tab]); // al cambiar de pestaña, cerrar el submenú

  // Dirección de la transición lateral: compara la posición de la pestaña nueva
  // con la anterior para decidir si entra desde la derecha o desde la izquierda.
  useEffect(() => {
    const orden = tabsPorRol(currentUser?.rol, 0).map(([id]) => id);
    const iAnt = orden.indexOf(tabPrevio.current);
    const iNue = orden.indexOf(tab);
    if (iAnt !== -1 && iNue !== -1 && iAnt !== iNue) setDirTab(iNue > iAnt ? -1 : 1);
    tabPrevio.current = tab;
  }, [tab, currentUser]);

  // El tutorial puede pedir cambiar de sub-sección
  useEffect(() => {
    const h = (e) => {
      const s = e.detail?.subtab;
      if (["pacientes", "tabla", "notas", "prescripciones", "interconsultas", "seguimiento", "ingresos"].includes(s)) setSubTabHospital(s);
      if (["cirugias", "videos", "preguntas", "medicamentos", "scores", "documentos", "mapas"].includes(s)) setSubTabBiblio(s);
    };
    window.addEventListener("uro-tour-subtab", h);
    return () => window.removeEventListener("uro-tour-subtab", h);
  }, []);

  // Si la configuración oculta la sección activa, volver a la primera
  useEffect(() => {
    if ((subTabHospital === "tabla" && fnOculta(config, "hosp:tabla")) ||
        (subTabHospital === "notas" && fnOculta(config, "hosp:notas")) ||
        (subTabHospital === "prescripciones" && fnOculta(config, "hosp:prescripciones")) ||
        (subTabHospital === "interconsultas" && fnOculta(config, "hosp:interconsultas")) ||
        (subTabHospital === "seguimiento" && fnOculta(config, "hosp:seguimiento"))) setSubTabHospital("pacientes");
    if ((subTabBiblio === "videos" && fnOculta(config, "biblio:videos")) ||
        (subTabBiblio === "preguntas" && fnOculta(config, "biblio:preguntas")) ||
        (subTabBiblio === "medicamentos" && fnOculta(config, "biblio:medicamentos")) ||
        (subTabBiblio === "scores" && fnOculta(config, "biblio:scores"))) setSubTabBiblio("cirugias");
  }, [config, subTabHospital, subTabBiblio]);

  // Si la pestaña activa quedó oculta por configuración, volver al chat
  useEffect(() => {
    if (SUBFUNCIONES_PROMOVIBLES[tab]) {
      // Pestaña promovida: solo se cierra si se apaga la sección en sí
      if (fnOculta(config, tab)) setTab("chat");
      return;
    }
    if (fnOculta(config, "tab:" + tab)) setTab("chat");
  }, [config, tab]);
  const [messages, setMessages] = useState([]);
  const [conversaciones, setConversaciones] = useState([]); // lista de conversaciones del usuario
const [conversacionActual, setConversacionActual] = useState(null); // ID de la conversación abierta
const [panelConversacionesAbierto, setPanelConversacionesAbierto] = useState(false); // mostrar/ocultar lista
const [loadingConversaciones, setLoadingConversaciones] = useState(false); // cuando se carga una conversación
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [modo, setModo] = useState("precisa");
  const [mapaTema, setMapaTema] = useState("");
  const [mapaActual, setMapaActual] = useState(null);
  const [mapaLoading, setMapaLoading] = useState(false);
  const [mapasGuardados, setMapasGuardados] = useState([]);
const [guardandoMapa, setGuardandoMapa] = useState(false);
  const [topicOpen, setTopicOpen] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const appMovil = useIsMobile();  // ocultar el header solo tiene sentido en celular
  const [headerOculto, setHeaderOculto] = useState(false); // se oculta al hacer scroll hacia abajo
  const scrollRef = useRef({ ultimo: 0, acum: 0, bloqueoHasta: 0 });
  // Detección estable: hay que acumular movimiento sostenido en una dirección para
  // cambiar de estado (evita el parpadeo por el "salto" del contenido al colapsar).
  const onScrollContenido = (e) => {
    if (!appMovil) return;  // en escritorio la barra siempre visible (hay espacio de sobra)
    const y = e.target.scrollTop;
    if (typeof y !== "number" || y < 0) return;
    const s = scrollRef.current;
    const ahora = Date.now();

    // Tras cambiar de estado, ignorar el rebote que produce el reflow del contenido
    if (ahora < s.bloqueoHasta) { s.ultimo = y; return; }

    // Zona muerta: cerca del tope, el header siempre visible
    if (y < 40) {
      s.acum = 0; s.ultimo = y;
      if (headerOculto) setHeaderOculto(false);
      return;
    }

    const delta = y - s.ultimo;
    s.ultimo = y;
    // Reiniciar el acumulador si se cambia de dirección
    if ((delta > 0 && s.acum < 0) || (delta < 0 && s.acum > 0)) s.acum = 0;
    s.acum += delta;

    const UMBRAL_OCULTAR = 56;  // bajar ~56px sostenidos para esconder
    const UMBRAL_MOSTRAR = 44;  // subir ~44px sostenidos para reaparecer
    if (!headerOculto && s.acum > UMBRAL_OCULTAR) {
      setHeaderOculto(true); s.acum = 0; s.bloqueoHasta = ahora + 350;
    } else if (headerOculto && s.acum < -UMBRAL_MOSTRAR) {
      setHeaderOculto(false); s.acum = 0; s.bloqueoHasta = ahora + 350;
    }
  };
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [perfilOpen, setPerfilOpen] = useState(false); // modal "Mi perfil"
  const bottomRef = useRef(null);

  useEffect(() => {
  try { localStorage.setItem("uro_tab", tab); }
  catch {}
}, [tab]);

  // ─── Tutorial: se muestra automáticamente la 1ª vez por usuario ───
  useEffect(() => {
    if (!currentUser) return;
    try {
      const clave = `uro_tutorial_visto_${currentUser.id}_v${TUTORIAL_VERSION}`;
      if (!localStorage.getItem(clave)) {
        setTutorialOpen(true);
      }
    } catch {}
  }, [currentUser]);

  const cerrarTutorial = () => {
    setTutorialOpen(false);
    try { if (currentUser) localStorage.setItem(`uro_tutorial_visto_${currentUser.id}_v${TUTORIAL_VERSION}`, "1"); } catch {}
  };

  // ─── Navegación con botón "atrás" del celular (PWA) ───
  // Engancha el cambio de pestaña y los overlays de nivel superior con la
  // History API, para que "atrás" vuelva a la vista anterior dentro de la app
  // en lugar de cerrarla. Solo sale cuando ya estás en la pestaña inicial.
  const tabRef = useRef(tab);
  const menuOpenRef = useRef(menuOpen);
  const panelConvRef = useRef(panelConversacionesAbierto);
  useEffect(() => { tabRef.current = tab; }, [tab]);
  useEffect(() => { menuOpenRef.current = menuOpen; }, [menuOpen]);
  useEffect(() => { panelConvRef.current = panelConversacionesAbierto; }, [panelConversacionesAbierto]);

  // Cada cambio de pestaña agrega una entrada al historial (la primera vez solo
  // reemplaza la entrada base, sin duplicar).
  const saltarPush = useRef(true);
  useEffect(() => {
    if (saltarPush.current) {
      saltarPush.current = false;
      window.history.replaceState({ uroNav: "tab", tab }, "");
      return;
    }
    window.history.pushState({ uroNav: "tab", tab }, "");
  }, [tab]);

  // Escucha el "atrás": cierra overlays si hay alguno abierto; si no, vuelve a
  // la pestaña anterior según el estado guardado en el historial.
  useEffect(() => {
    const onPop = (e) => {
      // 1) Si hay un overlay abierto, "atrás" lo cierra y no navega de pestaña.
      if (menuOpenRef.current || panelConvRef.current) {
        setMenuOpen(false);
        setPanelConversacionesAbierto(false);
        // Repone la entrada consumida para no perder profundidad de pila.
        window.history.pushState({ uroNav: "tab", tab: tabRef.current }, "");
        return;
      }
      // 2) Navegación normal entre pestañas.
      const destino = e.state && e.state.uroNav === "tab" ? e.state.tab : null;
      if (destino && destino !== tabRef.current) {
        saltarPush.current = true; // evita re-empujar al setear la pestaña
        setTab(destino);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

// Verificar si hay sesión al cargar la app, y suscribirse a cambios
useEffect(() => {
  // Verificar sesión inicial
  const arrancar = async () => {
    // ── Camino rápido OFFLINE: entrar YA con el perfil cacheado (IndexedDB, ms),
    //    sin esperar a que las llamadas de red expiren. La red, si vuelve, refresca.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const persistida = leerSesionPersistida();
      if (persistida?.user?.id) setSession(persistida);
      const restaurado = await restaurarPerfilOffline();
      if (restaurado) return; // ya estamos dentro; no tocamos la red
      // Sin caché aún: seguimos al flujo normal (mostrará login).
    }
    let result = { ok: false };
    try { result = await getSession(); } catch { result = { ok: false }; }
    if (result.ok && result.session) {
      setSession(result.session);
      await cargarPerfil(result.session);
      return;
    }
    // Sin sesión desde getSession (típico sin red): intentamos la sesión
    // persistida cruda de Supabase para entrar offline con el perfil cacheado.
    const persistida = leerSesionPersistida();
    if (persistida?.user?.id) {
      setSession(persistida);
      await cargarPerfil(persistida);
      return;
    }
    // Ni sesión de red ni persistida: si estamos offline, último recurso = perfil en caché.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await restaurarPerfilOffline();
    }
  };
  arrancar().finally(() => setLoadingSession(false));

  // Suscribirse a cambios futuros (login, logout)
  const unsubscribe = onAuthChange((event, newSession) => {
    if (newSession) {
      setSession(newSession);
      cargarPerfil(newSession);
      return;
    }
    // Sin sesión nueva. Offline esto suele ser un "soft sign-out" de supabase-js
    // por no poder refrescar el token: NO botamos al usuario al login.
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    setSession(null);
    setCurrentUser(null);
  });

  return () => unsubscribe();
}, []);

// Reintenta las escrituras pendientes (offline) al reconectar y al iniciar.
useEffect(() => {
  const handlers = { crearEvolucion: (a) => crearEvolucion(a.pacienteId, a.autorId, a.texto, a.tipo), crearExamen: (a) => crearExamen(a.pacienteId, a.autorId, a.datos) };
  const flush = () => { procesarCola(handlers); };
  if (typeof navigator === "undefined" || navigator.onLine) flush();
  window.addEventListener("online", flush);
  return () => window.removeEventListener("online", flush);
}, []);
useEffect(() => {
  if (!currentUser) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;      // solo online
  if (!pushSoportado()) return;
  if (esIOS() && !estaInstalada()) return;                                // iOS: primero instalar
  if (typeof Notification !== "undefined" && Notification.permission !== "default") return; // ya decidió
  let yaPreguntado = false;
  try { yaPreguntado = localStorage.getItem("uro_push_onboarding") === "1"; } catch {}
  if (yaPreguntado) return;
  let cancelado = false;
  pushActivo().then((activo) => { if (!activo && !cancelado) setMostrarOnboardingPush(true); });
  return () => { cancelado = true; };
}, [currentUser]);
  useEffect(() => { bottomRef.current?.scrollIntoView({behavior:"smooth"}); }, [messages, loading]);

  const isAdmin = currentUser?.rol === "admin";
  const pendientesCount = 0; // TODO: cargar desde Supabase con un useEffect propio

 const handleLogout = async () => {
  // Abrir una conversación existente (cargar sus mensajes)
const abrirConversacion = async (conversacionId) => {
  setLoadingConversaciones(true);
  setPanelConversacionesAbierto(false);
  
  const result = await cargarMensajes(conversacionId);
  if (result.ok) {
    setMessages(result.mensajes);
    setConversacionActual(conversacionId);
  } else {
    alert("Error al cargar la conversación: " + result.error);
  }
  setLoadingConversaciones(false);
};

// Empezar una nueva conversación (limpia el chat)
const nuevaConversacion = () => {
  setConversacionActual(null);
  setPanelConversacionesAbierto(false);
  if (currentUser) {
    setMessages([{ 
      role: "assistant", 
      content: saludoUros(currentUser.nombre) 
    }]);
  } else {
    setMessages([]);
  }
};

// Eliminar una conversación
const eliminarConv = async (conversacionId) => {
  const result = await eliminarConversacion(conversacionId);
  if (!result.ok) {
    alert("Error al eliminar: " + result.error);
    return;
  }
  
  // Quitar de la lista local
  setConversaciones(prev => prev.filter(c => c.id !== conversacionId));
  
  // Si era la conversación abierta, limpiar el chat
  if (conversacionId === conversacionActual) {
    nuevaConversacion();
  }
};
  await logoutUser();
  setCurrentUser(null);
  setSession(null);
  setMessages([]);
  setConversaciones([]);
  setConversacionActual(null);
  setPanelConversacionesAbierto(false);
  setTab("chat");
  setMenuOpen(false);
  setMapaActual(null);
  setMapaTema("");
  setMapasGuardados([]);
  setInvitacionesPendientes([]);
  setMisServiciosLista([]);
  setPacientes([]);
};
// Abrir una conversación existente (cargar sus mensajes)
const abrirConversacion = async (conversacionId) => {
  setLoadingConversaciones(true);
  setPanelConversacionesAbierto(false);
  
  const result = await cargarMensajes(conversacionId);
  if (result.ok) {
    setMessages(result.mensajes);
    setConversacionActual(conversacionId);
  } else {
    alert("Error al cargar la conversación: " + result.error);
  }
  setLoadingConversaciones(false);
};

// Empezar una nueva conversación (limpia el chat)
const nuevaConversacion = () => {
  setConversacionActual(null);
  setPanelConversacionesAbierto(false);
  if (currentUser) {
    setMessages([{ 
      role: "assistant", 
      content: saludoUros(currentUser.nombre) 
    }]);
  } else {
    setMessages([]);
  }
};

// Eliminar una conversación
const eliminarConv = async (conversacionId) => {
  const result = await eliminarConversacion(conversacionId);
  if (!result.ok) {
    alert("Error al eliminar: " + result.error);
    return;
  }
  
  setConversaciones(prev => prev.filter(c => c.id !== conversacionId));
  
  if (conversacionId === conversacionActual) {
    nuevaConversacion();
  }
};

// Cargar el perfil del usuario cuando hay una sesión activa
// Restaura el perfil desde la caché para entrar sin conexión (sin pasar por login).
const restaurarPerfilOffline = async () => {
  try {
    const cacheado = await leerSnapshot("perfil:ultimo");
    if (cacheado && cacheado.id) {
      setCurrentUser(cacheado);
      let tabGuardado = null;
      try { tabGuardado = localStorage.getItem("uro_tab"); } catch {}
      const tabsValidos = tabsPorRol(cacheado.rol).map(t => t[0]);
      setTab(tabGuardado && tabsValidos.includes(tabGuardado) ? tabGuardado : (cacheado.rol === "admin" ? "admin" : "chat"));
      if (cacheado.rol !== "admin") {
        setConversacionActual(null);
        setMessages([{ role: "assistant", content: saludoUros(cacheado.nombre) }]);
      }
      return true;
    }
  } catch {}
  return false;
};

const cargarPerfil = async (sessionData) => {
  if (!sessionData?.user) {
    setCurrentUser(null);
    return;
  }
  
  let result;
  try {
    result = await getPerfil(sessionData.user.id);
  } catch (e) {
    // Sin red, la consulta a Supabase LANZA (no devuelve {ok:false}). Lo tratamos igual.
    result = { ok: false, error: e?.message || "network" };
  }
  
  if (!result.ok) {
    // Falló la carga del perfil por red. NO cerramos sesión a la ligera:
    // si tenemos el perfil en caché, entramos en modo offline con él.
    console.warn("No se pudo cargar el perfil desde la red:", result.error);
    let cacheado = null;
    try { cacheado = await leerSnapshot(`perfil:${sessionData.user.id}`); } catch {}
    if (!cacheado || !cacheado.id) { try { cacheado = await leerSnapshot("perfil:ultimo"); } catch {} }
    if (cacheado && cacheado.id) {
      setCurrentUser(cacheado);
      let tabGuardado = null;
      try { tabGuardado = localStorage.getItem("uro_tab"); } catch {}
      const tabsValidos = tabsPorRol(cacheado.rol).map(t => t[0]);
      setTab(tabGuardado && tabsValidos.includes(tabGuardado) ? tabGuardado : (cacheado.rol === "admin" ? "admin" : "chat"));
      if (cacheado.rol !== "admin") {
        setConversacionActual(null);
        setMessages([{ role: "assistant", content: saludoUros(cacheado.nombre) }]);
      }
      return; // modo offline: no seguimos con las cargas de red
    }
    // Sin caché: solo cerramos sesión si de verdad hay conexión (error real de auth).
    // Offline y sin caché → dejamos la sesión intacta para reintentar al volver la red.
    if (typeof navigator !== "undefined" && navigator.onLine) {
      console.error("Error al cargar perfil:", result.error);
      await logoutUser();
      setCurrentUser(null);
    }
    return;
  }
  
  const perfil = result.perfil;
  
  // Si el usuario no está aprobado, no dejarlo entrar
  if (perfil.estado !== "aprobado") {
    let mensaje = "";
    if (perfil.estado === "pendiente") mensaje = "Tu cuenta aún está pendiente de aprobación por el administrador.";
    else if (perfil.estado === "rechazado") mensaje = "Tu cuenta fue rechazada. Contacta al administrador.";
    else mensaje = "Tu cuenta no está activa.";
    
    alert(mensaje);
    await logoutUser();
    setCurrentUser(null);
    setSession(null);
    return;
  }
  
  // Adaptar el perfil al formato que espera el resto del código
  const userAdaptado = {
  id: perfil.id,
  nombre: perfil.nombre,
  correo: perfil.correo,
  especialidad: perfil.especialidad,
  rol: perfil.rol,
  estado: perfil.estado,
};
  
  setCurrentUser(userAdaptado);
  try { guardarSnapshot(`perfil:${perfil.id}`, userAdaptado); } catch {}
  try { guardarSnapshot("perfil:ultimo", userAdaptado); } catch {}
  let tabGuardado = null;
  try { tabGuardado = localStorage.getItem("uro_tab"); } catch {}
  const tabsValidos = tabsPorRol(perfil.rol).map(t => t[0]);
  if (tabGuardado && tabsValidos.includes(tabGuardado)) {
    setTab(tabGuardado);
  } else {
    setTab(perfil.rol === "admin" ? "admin" : "chat");
  }

  // Mostrar el saludo de Uros DE INMEDIATO (antes de las cargas pesadas de
  // Supabase). Así aparece al instante y no queda un hueco en el que el usuario
  // pueda escribir sobre un chat vacío que luego se sobrescribe.
  if (perfil.rol !== "admin") {
    setConversacionActual(null);
    setMessages([{ role:"assistant", content:saludoUros(perfil.nombre) }]);
  }

// Cargar conversaciones del usuario
const convResult = await listarConversaciones();
if (convResult.ok) {
  setConversaciones(convResult.conversaciones);
}
// Cargar mapas guardados del usuario
const mapasResult = await listarMapas();
if (mapasResult.ok) {
  setMapasGuardados(mapasResult.mapas);
}
// Cargar equipos del usuario
const equiposResult = await listarMisEquipos();
if (equiposResult.ok) {
  setEquipos(equiposResult.equipos);
}

// Cargar invitaciones pendientes
const invitResult = await listarMisInvitaciones();
if (invitResult.ok) {
  setInvitacionesPendientes(invitResult.invitaciones);
}
// Cargar mis servicios (pisos/áreas del hospital), respetando el orden guardado
const serviciosResult = await listarMisServicios(perfil.id);
if (serviciosResult.ok) {
  setMisServiciosLista(ordenarServicios(serviciosResult.servicios));
}
// NOTA: la lista de documentos de la base de conocimiento NO se carga aquí.
// El chat NO la necesita (usa buscarChunks, búsqueda vectorial). Cargarla en cada
// login descargaba todos los metadatos para todos los usuarios sin razón.
// Ahora se carga bajo demanda, solo al entrar a Biblioteca → Documentos.

// Cargar videos
const videosResult = await listarVideos();
if (videosResult.ok) {
  setVideos(videosResult.videos);
}
// (El saludo de Uros ya se fijó al inicio de esta función, antes de las cargas
// pesadas, para que aparezca de inmediato y no se sobrescriba lo que el usuario
// haya empezado a escribir.)
};

 const userInitials = currentUser ? currentUser.nombre.split(" ").map(p=>p[0]||"").filter(c=>c && c.match(/[A-Z]/i)).slice(0,2).join("").toUpperCase() : "";

  const buscarVideosRelevantes = (consulta) => {
    const q = consulta.toLowerCase();
    const palabras = ["técnica","tecnica","cómo se hace","como se hace","procedimiento","cirugía","cirugia","operación","video","quirúrgico"];
    const esTec = palabras.some(p => q.includes(p));
    if (!esTec) return [];
    return videos.filter(v => v.keywords.some(k => q.includes(k.toLowerCase())) || q.includes(v.titulo.toLowerCase().split(" ")[0])).slice(0,3);
  };

  // Detecta si la consulta es sobre programación quirúrgica y devuelve cirugías relevantes
  const buscarCirugiasRelevantes = (consulta) => {
    const q = consulta.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    // Palabras clave que indican consulta sobre programación
    const palabrasProgramacion = ["operar","opera","cirugia","cirugía","quirurgic","quirúrgic","programad","tabla","pabellon","pabellón","pabellones","intervenc","procedimient","planificacion","planificación","planning","planner","agenda","semana","mañana","manana","hoy","proxim","próxim","viernes","lunes","martes","miercoles","miércoles","jueves","sabado","sábado","domingo","cuando","cuándo","cuanto","cuánto","cuantas","cuántas"];
    const esConsulta = palabrasProgramacion.some(p => q.includes(p));
    if (!esConsulta || tablaCirugias.length === 0) return null;

    // Determinar rango de fechas según la consulta
    const hoy = new Date();
    hoy.setHours(0,0,0,0);
    const hoyStr = hoy.toISOString().split("T")[0];
    const dosSemanas = new Date(hoy); dosSemanas.setDate(hoy.getDate() + 14);
    const finDosSem = dosSemanas.toISOString().split("T")[0];
    const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
    const ayerStr = ayer.toISOString().split("T")[0];

    let fechaInicio = ayerStr;
    let fechaFin = finDosSem;
    let descripcionRango = "próximas 2 semanas";

    // "hoy"
    if (q.includes("hoy")) {
      fechaInicio = hoyStr; fechaFin = hoyStr;
      descripcionRango = "hoy";
    }
    // "mañana"
    else if (q.includes("manana") && !q.includes("la manana")) {
      const m = new Date(hoy); m.setDate(hoy.getDate() + 1);
      const mStr = m.toISOString().split("T")[0];
      fechaInicio = mStr; fechaFin = mStr;
      descripcionRango = "mañana";
    }
    // "esta semana"
    else if (q.includes("esta semana") || q.includes("semana actual")) {
      const diaSem = hoy.getDay() === 0 ? 6 : hoy.getDay() - 1;
      const lun = new Date(hoy); lun.setDate(hoy.getDate() - diaSem);
      const dom = new Date(lun); dom.setDate(lun.getDate() + 6);
      fechaInicio = lun.toISOString().split("T")[0];
      fechaFin = dom.toISOString().split("T")[0];
      descripcionRango = "esta semana";
    }
    // "próxima semana" / "semana que viene"
    else if (q.includes("proxima semana") || q.includes("semana que viene") || q.includes("siguiente semana")) {
      const diaSem = hoy.getDay() === 0 ? 6 : hoy.getDay() - 1;
      const lunProx = new Date(hoy); lunProx.setDate(hoy.getDate() - diaSem + 7);
      const domProx = new Date(lunProx); domProx.setDate(lunProx.getDate() + 6);
      fechaInicio = lunProx.toISOString().split("T")[0];
      fechaFin = domProx.toISOString().split("T")[0];
      descripcionRango = "la próxima semana";
    }
    // "mes" / "este mes"
    else if (q.includes("este mes") || q.includes("mes actual")) {
      const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      const fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
      fechaInicio = inicio.toISOString().split("T")[0];
      fechaFin = fin.toISOString().split("T")[0];
      descripcionRango = "este mes";
    }

    // Filtrar cirugías por rango de fecha
    const enRango = tablaCirugias.filter(c => c.fecha >= fechaInicio && c.fecha <= fechaFin);

    return {
      cirugias: enRango,
      rango: descripcionRango,
      fechaInicio,
      fechaFin,
      totalEnTabla: tablaCirugias.length
    };
  };

  // Detecta si la consulta es sobre los pacientes del médico
  const buscarPacientesRelevantes = (consulta) => {
    const q = consulta.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    const palabrasPacientes = ["paciente","pacientes","hospitalizad","hospitalizado","cama","camas","servicio","ingres","alta","altas","mis","tengo","cuanto","cuanta","quien","resumen","ficha","evolucion","examen","diagnostic","operad","post op","postop"];
    const esConsulta = palabrasPacientes.some(p => q.includes(p));
    if (!esConsulta) return null;
    // Los pacientes ya vienen filtrados por contexto (personales o del equipo activo)
    const misPacientes = pacientes || [];
    if (misPacientes.length === 0) return { ningun: true, total: 0 };

    // Filtrar por estado si se menciona
    let filtrados = misPacientes;
    if (q.includes("hospitalizad") || q.includes("activo") || q.includes("internad")) {
      filtrados = filtrados.filter(p => p.estado === "activo");
    } else if (q.includes("dado de alta") || q.includes("dados de alta") || q.includes("de alta")) {
      filtrados = filtrados.filter(p => p.estado === "alta");
    }

    // Filtrar por iniciales si se mencionan
    const inicialesEnQuery = consulta.match(/[A-Z]\.[A-Z]\.[A-Z]\.?/g) || consulta.match(/[A-Z]{2,}/g) || [];
    if (inicialesEnQuery.length > 0) {
      const matched = filtrados.filter(p => inicialesEnQuery.some(ini => (p.iniciales || "").toUpperCase().includes(ini.replace(/\./g,"")) ));
      if (matched.length > 0) filtrados = matched;
    }

    return { pacientes: filtrados, totalMisPacientes: misPacientes.length, ningun: false };
  };

 const sendMsg = async () => {
  const txt = input.trim();
  if (!txt || loading) return;
  
  const newMsgs = [...messages, {role:"user", content:txt}];
  setMessages(newMsgs); 
  setInput(""); 
  setLoading(true);
  
  // ============================================
  // PERSISTENCIA: obtener sesión actual de Supabase
  // ============================================
  let conversacionId = conversacionActual;
  const sesionResult = await getSession();
  const sesionActiva = sesionResult.ok ? sesionResult.session : null;
  
  if (!conversacionId && currentUser && sesionActiva) {
    // Es el primer mensaje de una nueva conversación
    const titulo = generarTituloDesdeMensaje(txt);
    const crearResult = await crearConversacion(sesionActiva.user.id, titulo, modo);
    
    if (crearResult.ok) {
      conversacionId = crearResult.conversacion.id;
      setConversacionActual(conversacionId);
      // Agregar la nueva conversación al inicio; limitar a MAX_CONVERSACIONES
      setConversaciones(prev => {
        const nueva = [crearResult.conversacion, ...prev];
        if (nueva.length > MAX_CONVERSACIONES) {
          const sobrantes = nueva.slice(MAX_CONVERSACIONES); // las más antiguas
          sobrantes.forEach(c => { eliminarConversacion(c.id).catch(()=>{}); });
          return nueva.slice(0, MAX_CONVERSACIONES);
        }
        return nueva;
      });
    } else {
      console.error("Error al crear conversación:", crearResult.error);
    }
  }
  
  // Guardar mensaje del usuario en Supabase
  if (conversacionId && sesionActiva) {
    await agregarMensaje(conversacionId, sesionActiva.user.id, "usuario", txt, modo);
  }
  
  // ============================================
  // LÓGICA ORIGINAL DEL CHAT
  // ============================================
  const videosRelevantes = buscarVideosRelevantes(txt);
  // Buscar fragmentos relevantes DEL LADO DE LA BASE (entre todos los chunks)
  let docsRelevantes = [];
  const busqueda = await buscarChunks(txt, 8);
  if (busqueda.ok) docsRelevantes = busqueda.chunks;
  const tieneFuentes = docsRelevantes.length > 0;
  const consultaCirugias = buscarCirugiasRelevantes(txt);
  const consultaPacientes = buscarPacientesRelevantes(txt);
  // Si la pregunta va sobre pacientes en seguimiento, se le entrega ese contexto real
  let ctxSeguimiento = "";
  if (/seguimiento|vigilancia|control(es)?\b|atrasad|pendiente.*control|proximo.*control|pr[oó]ximos?\s*control/i.test(txt)) {
    try { ctxSeguimiento = await resumenSeguimientoParaIA(currentUser.id, contexto); } catch { ctxSeguimiento = ""; }
  }

  // ── Flujo "responder con conocimiento propio" ──────────────────
  // Detecta si el mensaje anterior de Uros fue una OFERTA de responder con
  // conocimiento propio (porque no encontró nada en la base) y si el usuario
  // acaba de aceptar/rechazar esa oferta.
  const FRASE_OFERTA = "¿Quieres que te responda con mi propio conocimiento";
  const ultimoAsistente = [...messages].reverse().find(m => m.role === "assistant");
  const ofrecioConocimiento = !!(ultimoAsistente && (ultimoAsistente.ofrecioConocimiento || (ultimoAsistente.content || "").includes(FRASE_OFERTA)));
  const esAfirmacion = /^\s*(s[ií]\b|si\b|dale\b|ok(ay)?\b|ya\b|claro\b|bueno\b|obvio\b|correcto\b|afirmativo\b|por\s*favor\b|de\s*una\b|hazlo\b|adelante\b|responde|resp[oó]ndeme|cont[eé]stame|yes\b)/i;
  const esNegacion = /^\s*(no\b|nel\b|negativo\b|mejor\s*no\b|d[eé]jalo\b|as[ií]\s*no\b)/i;
  const usarConocimientoPropio = ofrecioConocimiento && esAfirmacion.test(txt) && !esNegacion.test(txt);
  const declinoConocimiento = ofrecioConocimiento && !usarConocimientoPropio && esNegacion.test(txt);
  // Recupera la consulta original (el mensaje del usuario justo antes de la oferta)
  let preguntaOriginal = "";
  if (usarConocimientoPropio) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant" && (messages[i].ofrecioConocimiento || (messages[i].content || "").includes(FRASE_OFERTA))) {
        for (let j = i - 1; j >= 0; j--) {
          if (messages[j].role === "user") { preguntaOriginal = messages[j].content; break; }
        }
        break;
      }
    }
  }

  try {
    const modoIns = modo === "precisa"
      ? "\n\nMODO PRECISA: Responde en máximo 3-4 líneas (aproximadamente 50 palabras). Sé estricto con esta extensión: solo lo esencial, directo al grano, sin introducción ni rodeos. NO te extiendas."
      : "\n\nMODO EXPLICATIVA: respuesta completa con contexto y evidencia.";
    let ctx = "";
    if (usarConocimientoPropio) {
      // El usuario autorizó explícitamente responder con conocimiento propio
      ctx += "\n\n=== RESPUESTA CON CONOCIMIENTO PROPIO (AUTORIZADA POR EL USUARIO) ===\n"
        + "El usuario NO encontró la información en la base de conocimiento de UroSearch y te ha autorizado explícitamente a responder con tu propio conocimiento clínico. "
        + "Esta autorización tiene PRIORIDAD sobre la regla de fuente de información SOLO para esta respuesta.\n"
        + "Responde ahora la consulta original usando tu conocimiento médico como urólogo especialista (guías EAU/AUA, criterio clínico, terminología precisa).\n"
        + "IMPORTANTE: comienza tu respuesta EXACTAMENTE con esta línea y luego responde:\n"
        + "\"ℹ️ Respuesta basada en conocimiento clínico general, no en la base de UroSearch.\"\n\n"
        + `CONSULTA ORIGINAL DEL USUARIO: "${preguntaOriginal || txt}"`;
    } else if (declinoConocimiento) {
      // El usuario rechazó la oferta de conocimiento propio
      ctx += "\n\n=== EL USUARIO DECLINÓ ===\nEl usuario NO quiere que uses conocimiento fuera de la base. Responde EXACTAMENTE y SOLO con este mensaje, sin agregar información clínica: \"De acuerdo, me limito a la base de conocimiento de UroSearch. ¿Puedo ayudarte con otra consulta?\"";
    } else if (tieneFuentes) {
      ctx += "\n\n=== BASE DE CONOCIMIENTO ===\nResponde ÚNICA Y EXCLUSIVAMENTE con la información contenida en estos documentos. NO uses conocimiento externo ni general. Si los documentos no contienen lo suficiente para responder, dilo explícitamente. NO menciones la fuente ni el título dentro de tu respuesta (se muestra aparte automáticamente).\n\n" + docsRelevantes.map((d,i) => `--- DOC ${i+1}: ${d.titulo}${d.fuente ? " ("+d.fuente+")" : ""} ---\n${(d.contenido||"").slice(0,8000)}`).join("\n\n");
    } else if (!consultaCirugias && !consultaPacientes) {
      if ((config.chatModo || "verificada") === "general") {
        // Configuración "conocimiento general": responde directo con conocimiento
        // propio, marcado como fuera de la base, sin pedir permiso cada vez.
        ctx += "\n\n=== SIN INFORMACIÓN EN LA BASE (MODO CONOCIMIENTO GENERAL ACTIVADO) ===\n"
          + "No se encontraron documentos relevantes en la base de UroSearch, pero el usuario tiene activada en su configuración la opción de responder con conocimiento general de la IA. "
          + "Responde la consulta usando tu conocimiento médico como urólogo especialista (guías EAU/AUA, criterio clínico, terminología precisa).\n"
          + "IMPORTANTE: comienza tu respuesta EXACTAMENTE con esta línea y luego responde:\n"
          + "\"ℹ️ Respuesta basada en conocimiento clínico general, no en la base de UroSearch.\"";
      } else {
        // Pregunta clínica/teórica pero SIN documentos relevantes en la base:
        // en vez de rechazar, ofrece responder con conocimiento propio (como pregunta).
        ctx += "\n\n=== SIN INFORMACIÓN EN LA BASE ===\nNo se encontraron documentos relevantes en la base de conocimiento de UroSearch para esta consulta. NO respondas la pregunta con conocimiento propio todavía. Responde EXACTAMENTE y SOLO con este mensaje, sin agregar ninguna información clínica: \"No encontré información sobre esto en la base de conocimiento de UroSearch. ¿Quieres que te responda con mi propio conocimiento clínico como urólogo? (fuera de la base de UroSearch)\"";
      }
    }
    if (consultaCirugias) {
      ctx += `\n\n=== TABLA QUIRÚRGICA DEL USUARIO ===\nEl usuario está preguntando sobre programación quirúrgica. Cirugías programadas en el rango "${consultaCirugias.rango}":\n`;
      if (consultaCirugias.cirugias.length === 0) {
        ctx += `No hay cirugías programadas en este rango.`;
      } else {
        ctx += consultaCirugias.cirugias.map(c => `- ${c.fecha} ${c.hora} | ${c.iniciales}${c.edad?` (${c.edad}a)`:""} | ${c.procedimiento}${c.lateralidad?` (${c.lateralidad})`:""} | Cirujano: ${c.cirujano} | Pabellón ${c.pabellon} | Estado: ${c.estado}`).join("\n");
      }
    }
    if (consultaPacientes) {
      ctx += "\n\n=== PACIENTES DEL USUARIO ===\nEl usuario está preguntando sobre sus pacientes. Responde con detalle. ";
      if (consultaPacientes.ningun) {
        ctx += "El usuario no tiene pacientes registrados aún.";
      } else if (consultaPacientes.pacientes.length === 0) {
        ctx += `El usuario tiene ${consultaPacientes.totalMisPacientes} pacientes en total, pero ninguno coincide con los filtros aplicados a la consulta.`;
      } else {
        ctx += `Total de pacientes del usuario: ${consultaPacientes.totalMisPacientes}. Coinciden con la consulta: ${consultaPacientes.pacientes.length}.\n\nDETALLE DE PACIENTES:\n`;
        ctx += consultaPacientes.pacientes.map(p => {
          let detalle = `- ${p.iniciales} (${p.edad || "?"}a ${p.sexo || ""}) | Cama ${p.cama} | Servicio: ${p.servicio} | Estado: ${p.estado === "activo" ? "Hospitalizado" : "Alta"} | Ingreso: ${p.fecha_ingreso}\n  Diagnóstico: ${p.diagnostico}`;
          if (p.operado) detalle += `\n  Operado: sí${Array.isArray(p.cirugias_realizadas) && p.cirugias_realizadas.length ? ` (${p.cirugias_realizadas.map(cx => cx.nombre).join(", ")})` : ""}`;
          if (Array.isArray(p.antecedentes) && p.antecedentes.length) detalle += `\n  Antecedentes: ${p.antecedentes.join(", ")}`;
          if (p.alergias) detalle += `\n  Alergias: ${p.alergias}`;
          if (p.estado_clinico) detalle += `\n  Estado clínico: ${p.estado_clinico}`;
          if (p.historia) detalle += `\n  Historia: ${p.historia.slice(0,300)}${p.historia.length > 300 ? "..." : ""}`;
          if (p.plan_manejo) detalle += `\n  Plan: ${p.plan_manejo}`;
          return detalle;
        }).join("\n\n");
      }
    }
    // Contexto de pacientes en seguimiento (si la pregunta lo amerita)
    if (ctxSeguimiento) ctx += `\n\n${ctxSeguimiento}`;
    const sysPrompt = SYSTEM_PROMPT + modoIns + ctx;
    const apiMsgs = newMsgs.map(m => ({role:m.role, content:m.content}));
    const res = await fetch(import.meta.env.VITE_CHAT_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 2000,
        system: sysPrompt,
        messages: apiMsgs,
      }),
    });
    const data = await res.json();
    const reply = data.content?.find(b => b.type==="text")?.text || "Sin respuesta.";
    const respuesta = { role:"assistant", content:reply };
    // Marca esta respuesta como "oferta de conocimiento propio" para reconocer
    // el "sí" del usuario en el siguiente turno (dentro de la misma sesión).
    if (!usarConocimientoPropio && !declinoConocimiento && !tieneFuentes && !consultaCirugias && !consultaPacientes && (config.chatModo || "verificada") !== "general") {
      respuesta.ofrecioConocimiento = true;
    }
    if (videosRelevantes.length > 0 && !usarConocimientoPropio && !declinoConocimiento) respuesta.videos = videosRelevantes;
    if (tieneFuentes && !usarConocimientoPropio && !declinoConocimiento) {
      const vistas = new Set();
      respuesta.fuentes = docsRelevantes
        .filter(d => { if (vistas.has(d.titulo)) return false; vistas.add(d.titulo); return true; })
        .map(d => ({id:d.id, titulo:d.titulo, fuente:d.fuente||"", categoria:d.categoria||""}));
    }
    if (consultaCirugias && consultaCirugias.cirugias.length > 0) respuesta.cirugiasConsulta = { rango: consultaCirugias.rango, cantidad: consultaCirugias.cirugias.length };
    if (consultaPacientes && !consultaPacientes.ningun && consultaPacientes.pacientes.length > 0) respuesta.pacientesConsulta = { cantidad: consultaPacientes.pacientes.length };
    
    setMessages(prev => [...prev, respuesta]);
    
    // ============================================
    // PERSISTENCIA: guardar respuesta de Claude
    // ============================================
    if (conversacionId && sesionActiva) {
      await agregarMensaje(conversacionId, sesionActiva.user.id, "asistente", reply, modo);
      setConversaciones(prev => {
        const actualizada = prev.map(c => 
          c.id === conversacionId 
            ? {...c, fecha_actualizacion: new Date().toISOString()} 
            : c
        );
        return actualizada.sort((a, b) => 
          new Date(b.fecha_actualizacion) - new Date(a.fecha_actualizacion)
        );
      });
    }
  } catch(e) {
    setMessages(prev => [...prev, {role:"assistant", content:"Error al conectar."}]);
  }
  setLoading(false);
};

  const generarMapa = async (tema) => {
    if (!tema) return;
    if (PRESET_MAPS[tema]) { setMapaActual(PRESET_MAPS[tema]); return; }
    setMapaLoading(true); setMapaActual(null);
    try {
     const res = await fetch(import.meta.env.VITE_CHAT_FUNCTION_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
  },
  body: JSON.stringify({
    model: "claude-sonnet-5",
    max_tokens: 1300,
    system: SYSTEM_PROMPT,
    messages: [{role: "user", content: `Mapa conceptual sobre: "${tema}". SOLO JSON.`}],
  }),
});
      const data = await res.json();
      const txt = data.content?.find(b => b.type==="text")?.text || "";
      const clean = txt.replace(/```json|```/g,"").trim();
      setMapaActual(JSON.parse(clean));
    } catch(e) {
      setMapaActual({titulo:tema, nodo_central:tema, ramas:[{rama:"Error",subnodos:["No se pudo generar"]}]});
    }
    setMapaLoading(false);
  };
// Guardar el mapa actual en Supabase
const handleGuardarMapa = async () => {
  if (!mapaActual) return;
  
  setGuardandoMapa(true);
  
  // Obtener sesión actual
  const sesionResult = await getSession();
  if (!sesionResult.ok || !sesionResult.session) {
    alert("Error: no se pudo obtener tu sesión");
    setGuardandoMapa(false);
    return;
  }
  
  const result = await guardarMapa(
    sesionResult.session.user.id,
    mapaActual.titulo,
    mapaTema || mapaActual.titulo,
    mapaActual
  );
  
  if (result.ok) {
    // Agregar al inicio de la lista local
    setMapasGuardados(prev => [result.mapa, ...prev]);
    alert("✓ Mapa guardado correctamente");
  } else {
    alert("Error al guardar el mapa: " + result.error);
  }
  
  setGuardandoMapa(false);
};

// Eliminar un mapa guardado
const handleEliminarMapa = async (mapaId) => {
  if (!confirm("¿Eliminar este mapa?\n\nNo podrás recuperarlo después.")) return;
  
  const result = await eliminarMapa(mapaId);
  if (!result.ok) {
    alert("Error al eliminar: " + result.error);
    return;
  }
  
  setMapasGuardados(prev => prev.filter(m => m.id !== mapaId));
};

// Cargar un mapa guardado en la vista
const cargarMapaGuardado = async (mapa) => {
  // La lista de mapas ya no trae el 'contenido' (ahorro de datos): se pide al abrir.
  if (mapa.contenido) {
    setMapaActual(mapa.contenido);
    setMapaTema(mapa.tema || mapa.titulo);
    return;
  }
  const r = await obtenerMapa(mapa.id);
  if (r.ok) {
    setMapaActual(r.mapa.contenido);
    setMapaTema(r.mapa.tema || r.mapa.titulo);
  } else {
    alert("No se pudo cargar el mapa: " + r.error);
  }
};
  // Pantalla de carga mientras se verifica la sesión inicial
if (loadingSession) {
  return (
    <div style={{fontFamily:"var(--font-sans)",minHeight:"100vh",background:"var(--fondo)",borderRadius:"var(--border-radius-lg)",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center",color:"var(--texto-sec)",fontSize:"var(--fs-2)"}}>
        <LogoUroSearch size={60}/>
        <div style={{marginTop:16}}>Cargando UroSearch...</div>
      </div>
    </div>
  );
}

if (!currentUser) {
  return (
    <div style={{fontFamily:"var(--font-sans)",minHeight:"100vh",background:"var(--fondo)",borderRadius:"var(--border-radius-lg)",display:"flex",alignItems:"center",justifyContent:"center",padding:"24px"}}>
      <div style={{width:"100%",maxWidth:480,background:"var(--superficie)",borderRadius:16,boxShadow:"0 4px 24px rgba(26,58,92,0.10)",padding:"8px"}}>
        <AuthScreen/>
      </div>
    </div>
  );
}

  const tabsRol = tabsPorRol(currentUser.rol, pendientesCount);
  const idsRol = tabsRol.map(([id]) => id);
  const tabsBase = tabsRol.filter(([id]) => !fnOculta(config, "tab:" + id));
  // Secciones huérfanas (su pestaña está apagada pero ellas siguen activas) → pestaña propia
  const tabsPromovidas = Object.entries(SUBFUNCIONES_PROMOVIBLES)
    .filter(([id, d]) => idsRol.includes(d.padre) && fnOculta(config, "tab:" + d.padre) && !fnOculta(config, id))
    .filter(([id]) => !(id === "hosp:prescripciones" && !(currentUser.rol === "urologo" || currentUser.rol === "residente")))
    .map(([id, d]) => [id, d.label]);
  const tabs = [...tabsBase, ...tabsPromovidas];
  const promovida = SUBFUNCIONES_PROMOVIBLES[tab] && tabsPromovidas.some(([id]) => id === tab) ? SUBFUNCIONES_PROMOVIBLES[tab] : null;

  // ─── Deslizar lateralmente entre pestañas principales (móvil) ───
  // (swipeRef se declara arriba, junto al resto de los hooks: no puede ir
  //  después de los early return de loadingSession / !currentUser)
  const onTouchStart = (e) => {
    if (e.touches.length !== 1) { swipeRef.current = null; return; }
    const t = e.touches[0];
    swipeRef.current = { x: t.clientX, y: t.clientY, t: Date.now(), target: e.target };
  };
  const onTouchEnd = (e) => {
    const s0 = swipeRef.current; swipeRef.current = null;
    if (!s0) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s0.x, dy = t.clientY - s0.y;
    if (Date.now() - s0.t > 600) return;

    // ── Deslizar hacia ABAJO estando arriba del todo: abre el submenú de la pestaña ──
    // Menos sensible que antes (Safari dispara con el rebote elástico): pide más
    // recorrido, que sea claramente vertical y que no sea un "flick" instantáneo.
    // La condición de "estar arriba del todo" (scrollTop <= 1) se valida más abajo.
    const durGesto = Date.now() - s0.t;
    if (dy > 130 && Math.abs(dy) > Math.abs(dx) * 2.8 && durGesto > 120) {
      let el = s0.target, arriba = true;
      while (el && el !== document.body) {
        const oy = getComputedStyle(el).overflowY;
        if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 4) { arriba = el.scrollTop <= 1; break; }
        el = el.parentElement;
      }
      if (arriba && submenu) { setSubmenuOpen(true); try { navigator.vibrate?.(15); } catch {} }
      return;
    }
    // Deslizar hacia arriba estando el menú abierto: lo cierra
    if (dy < -100 && Math.abs(dy) > Math.abs(dx) * 2.4 && submenuOpen) {
      setSubmenuOpen(false);
      return;
    }

    // ── Deslizar lateral: cambia de pestaña ──
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2) return;
    // Ignora si nació dentro de algo que scrollea en horizontal (tabla, carruseles)
    let el = s0.target;
    while (el && el !== document.body) {
      const ox = getComputedStyle(el).overflowX;
      if ((ox === "auto" || ox === "scroll") && el.scrollWidth > el.clientWidth + 4) return;
      el = el.parentElement;
    }
    const i0 = tabs.findIndex(([id]) => id === tab);
    const destino = i0 + (dx < 0 ? 1 : -1);
    if (i0 < 0 || destino < 0 || destino >= tabs.length) return;
    setTab(tabs[destino][0]);
    setSubmenuOpen(false);
  };

  // Deslizar hacia arriba sobre el submenú (o sobre su fondo) para cerrarlo.
  // Va aparte porque, con el menú abierto, el fondo invisible cubre la pantalla
  // y los gestos no llegan al detector del contenido.
  const cerrarInicio = (e) => { const t = e.touches[0]; cierreRef.current = { y: t.clientY, x: t.clientX }; };
  const cerrarFin = (e) => {
    const p = cierreRef.current; cierreRef.current = null;
    if (!p) return;
    const t = e.changedTouches[0];
    const dy = t.clientY - p.y, dx = t.clientX - p.x;
    if (dy < -30 && Math.abs(dy) > Math.abs(dx)) setSubmenuOpen(false);
  };

  // ─── Contenido del submenú que se despliega al volver a tocar la pestaña activa ───
  const esUrologo = currentUser.rol === "urologo" || currentUser.rol === "residente";
  const accion = (nombre) => { try { window.dispatchEvent(new CustomEvent("uro-submenu-accion", { detail: { tab, accion: nombre } })); } catch {} };
  const equipoActualNombre = contexto !== "personal" ? (equipos.find(e => e.id === contexto)?.nombre || "Equipo") : "Mis pacientes";

  let submenu = null;
  if (tab === "hospital") {
    submenu = {
      titulo: "Hospital",
      secciones: [
        ["pacientes", "👥 Pacientes"],
        ...(!fnOculta(config, "hosp:tabla") ? [["tabla", "📋 Tabla"]] : []),
        ["ingresos", "📋 Ingresos"],
        ...(!fnOculta(config, "hosp:interconsultas") ? [["interconsultas", "📄 Interconsultas"]] : []),
        ...(!fnOculta(config, "hosp:seguimiento") ? [["seguimiento", "🔄 Seguimiento"]] : []),
        ...(esUrologo && !fnOculta(config, "hosp:prescripciones") ? [["prescripciones", "💊 Recetas"]] : []),
        ...(!fnOculta(config, "hosp:notas") ? [["notas", "🗒️ Notas"]] : []),
      ],
      activo: subTabHospital,
      elegir: setSubTabHospital,
      extras: [
        ...(subTabHospital === "tabla" ? [["🛠️ Herramientas de la sección", () => accion("tools")]] : []),
        ...(subTabHospital === "interconsultas" ? [["📊 Métricas de interconsultas", () => accion("ic-metricas")], ["📷 Archivar interconsulta", () => accion("ic-nueva")]] : []),
        ...(subTabHospital === "seguimiento" ? [["➕ Nuevo criterio de seguimiento", () => accion("seg-protocolo")]] : []),
      ],
      contexto: { actual: contexto, elegir: setContexto, opciones: [["personal", "👤 Mis pacientes"], ...equipos.map(e => [e.id, `👥 ${e.nombre}`])] },
    };
  } else if (tab === "logbook") {
    submenu = {
      titulo: "Logbook",
      secciones: [["lista", "📋 Registros"], ["nueva", "📷 Nueva"], ["metricas", "📊 Métricas"]],
      activo: subTabLogbook,
      elegir: setSubTabLogbook,
      extras: [["🔗 Compartir con el equipo", () => accion("compartir")]],
    };
  } else if (tab === "conocimiento") {
    submenu = {
      titulo: "Biblioteca",
      secciones: [
        ["cirugias", "🔪 Cirugías"],
        ...(!fnOculta(config, "biblio:videos") ? [["videos", "📚 Videos"]] : []),
        ...(!fnOculta(config, "biblio:preguntas") ? [["preguntas", "❓ Preguntas"]] : []),
        ...(!fnOculta(config, "biblio:medicamentos") ? [["medicamentos", "💊 Medicamentos"]] : []),
        ...(!fnOculta(config, "biblio:scores") ? [["scores", "🧮 Scores"]] : []),
        ...(isAdmin ? [["documentos", "📄 Documentos"]] : []),
      ],
      activo: subTabBiblio,
      elegir: setSubTabBiblio,
      extras: [],
    };
  }

  return (
    <div style={{fontFamily:"var(--font-sans)",height:"100dvh",minHeight:"100dvh",display:"flex",flexDirection:"column",overflow:"hidden",background:"var(--fondo)",borderRadius:"var(--border-radius-lg)",paddingBottom:"env(safe-area-inset-bottom)",boxSizing:"border-box",overscrollBehavior:"none"}}>
      <OfflineBanner/>
      {bloqueado && <LockScreen onUnlock={()=>setBloqueado(false)} />}
      {mostrarOnboardingPush && <OnboardingPushModal currentUser={currentUser} onClose={()=>setMostrarOnboardingPush(false)} />}
      <style>{`
        html, body, #root { background: var(--fondo); overscroll-behavior: none; }
        /* Todo contenedor con scroll propio: sin rebote ni franja blanca al final */
        div[style*="overflow-y"], div[style*="overflowY"] { overscroll-behavior: contain; }
        @keyframes uro-slide-izq { from { transform: translateX(14%); opacity: .35; } to { transform: translateX(0); opacity: 1; } }
        @keyframes uro-slide-der { from { transform: translateX(-14%); opacity: .35; } to { transform: translateX(0); opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          @keyframes uro-slide-izq { from { opacity: .5; } to { opacity: 1; } }
          @keyframes uro-slide-der { from { opacity: .5; } to { opacity: 1; } }
        }
      `}</style>
      <div style={{
        padding: headerOculto ? "0 20px" : "16px 20px 0",
        maxHeight: headerOculto ? 0 : 200,
        opacity: headerOculto ? 0 : 1,
        overflow:"hidden",
        transition:"max-height .28s ease, opacity .2s ease, padding .28s ease",
        borderBottom: headerOculto ? "none" : "0.5px solid var(--borde)",
        background:"var(--header-bg)",borderRadius:"var(--border-radius-lg) var(--border-radius-lg) 0 0",position:"relative",
      }}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:appMovil?8:12}}>
          <div style={{display:"flex",alignItems:"center",gap:appMovil?10:14,minWidth:0}}>
            <LogoUroSearch size={appMovil?40:44}/>
            {appMovil ? (
              // En celular: título y subtítulo apilados, cada uno en una línea, compactos
              <div style={{minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontWeight:600,fontStyle:"italic",fontFamily:"Georgia, 'Times New Roman', serif",fontSize:18,color:"var(--texto)",letterSpacing:"-0.3px"}}>UroSearch</span>
                  {isAdmin && <span style={{fontSize:9,fontWeight:600,padding:"1px 5px",background:"var(--primario)",color:"var(--texto-inv)",borderRadius:4,flexShrink:0}}>ADMIN</span>}
                </div>
                <div style={{fontSize:"var(--fs-0)",color:"var(--texto-sec)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginTop:1}}>Asistente Clínico de Urología</div>
              </div>
            ) : (
              <div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{fontWeight:600,fontStyle:"italic",fontFamily:"Georgia, 'Times New Roman', serif",fontSize:21,color:"var(--texto)",letterSpacing:"-0.3px"}}>UroSearch</div>
                  {isAdmin && <span style={{fontSize:"var(--fs-xs)",fontWeight:600,padding:"2px 6px",background:"var(--primario)",color:"var(--texto-inv)",borderRadius:4}}>ADMIN</span>}
                </div>
                <div style={{fontSize:"var(--fs-2)",color:"var(--texto-sec)"}}>Asistente Clínico de Urología</div>
              </div>
            )}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
            <NotificationBell currentUser={currentUser}/>
            <button onClick={()=>setMenuOpen(!menuOpen)} style={{display:"flex",alignItems:"center",gap:8,background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:24,padding:appMovil?"4px 10px 4px 4px":"5px 14px 5px 5px",cursor:"pointer"}}>
              <div style={{width:appMovil?34:38,height:appMovil?34:38,borderRadius:"50%",background:isAdmin?"var(--navy-fijo)":"var(--primario)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:appMovil?13:15,fontWeight:600,color:"var(--texto-inv)"}}>{userInitials}</div>
              <span style={{fontSize:"var(--fs-2)",color:"var(--texto)",fontWeight:500}}>▾</span>
            </button>
          </div>
        </div>
        {menuOpen && (
          <>
          <div onClick={()=>setMenuOpen(false)} style={{position:"fixed",inset:0,zIndex:70}}/>
          <div style={{position:"fixed",top:72,right:8,zIndex:71,background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:12,padding:"8px 0",width:"min(260px, calc(100vw - 16px))",maxHeight:"calc(100dvh - 96px)",overflowY:"auto",WebkitOverflowScrolling:"touch",boxShadow:"0 10px 28px rgba(0,0,0,0.28)"}}>
            <div style={{padding:"8px 14px",borderBottom:"0.5px solid var(--fondo)"}}>
              <div style={{fontSize:"var(--fs-2)",fontWeight:500,color:"var(--texto)"}}>{currentUser.nombre}</div>
              <div style={{fontSize:"var(--fs-0)",color:"var(--texto-sec)"}}>{currentUser.correo}</div>
              <div style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)",marginTop:2}}>{currentUser.especialidad}{isAdmin?" · Administrador":""}</div>
            </div>
            <button onClick={()=>setTema(tema==="light"?"dark":"light")} style={{width:"100%",padding:"8px 14px",fontSize:"var(--fs-2)",textAlign:"left",background:"none",border:"none",color:"var(--texto)",cursor:"pointer",display:"flex",alignItems:"center",gap:8}}>
              {tema==="light" ? "🌙 Modo oscuro" : "☀️ Modo claro"}
            </button>
            <button onClick={()=>{ setMenuOpen(false); setConfigOpen(true); }} style={{width:"100%",padding:"8px 14px",fontSize:"var(--fs-2)",textAlign:"left",background:"none",border:"none",color:"var(--texto)",cursor:"pointer",display:"flex",alignItems:"center",gap:8}}>
              ⚙️ Configuración
            </button>
            <button onClick={()=>{ setMenuOpen(false); setPerfilOpen(true); }} style={{width:"100%",padding:"8px 14px",fontSize:"var(--fs-2)",textAlign:"left",background:"none",border:"none",color:"var(--texto)",cursor:"pointer",display:"flex",alignItems:"center",gap:8}}>
              👤 Mi perfil
            </button>
            <button onClick={()=>{ setMenuOpen(false); setEquiposOpen(true); }} style={{width:"100%",padding:"8px 14px",fontSize:"var(--fs-2)",textAlign:"left",background:"none",border:"none",color:"var(--texto)",cursor:"pointer",display:"flex",alignItems:"center",gap:8}}>
              🤝 Equipos{invitacionesPendientes.length > 0 ? ` (${invitacionesPendientes.length})` : ""}
            </button>
            <button onClick={()=>{ setMenuOpen(false); setTutorialOpen(true); }} style={{width:"100%",padding:"8px 14px",fontSize:"var(--fs-2)",textAlign:"left",background:"none",border:"none",color:"var(--texto)",cursor:"pointer",display:"flex",alignItems:"center",gap:8}}>
              🧭 Ver tutorial
            </button>
            <button onClick={handleLogout} style={{width:"100%",padding:"8px 14px",fontSize:"var(--fs-2)",textAlign:"left",background:"none",border:"none",color:"var(--peligro)",cursor:"pointer"}}>Cerrar sesión</button>
          </div>
          </>
        )}
        <div ref={tabBarRef} style={{display:"flex",gap:0,overflowX:"auto"}}>
          {tabs.map(([id,label]) => (
            <button key={id} data-tour={"tab-"+id} onClick={() => {
              if (tab === id) setSubmenuOpen(o => !o); // 2º toque: despliega las secciones
              else { setTab(id); setSubmenuOpen(false); }
            }} style={{flex:"1 1 0",minWidth:0,padding:"12px 4px",fontSize:"var(--fs-1)",fontWeight:tab===id?600:500,background:"transparent",border:"none",borderBottom:tab===id?"3px solid var(--primario)":"3px solid transparent",color:tab===id?"var(--primario)":"var(--texto-sec)",cursor:"pointer",whiteSpace:"nowrap",letterSpacing:"-0.2px",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
              <IconoTab tipo={id} activo={tab===id}/>
              {label}{tab===id && submenu ? (submenuOpen ? " ▴" : " ▾") : ""}
            </button>
          ))}
        </div>
      </div>

      {/* Submenú desplegable de la pestaña activa (fijo, para que no lo recorte el contenedor) */}
      {submenuOpen && submenu && (
        <>
          <div onClick={()=>setSubmenuOpen(false)} onTouchStart={cerrarInicio} onTouchEnd={cerrarFin} style={{position:"fixed",inset:0,zIndex:60}}/>
          <div onTouchStart={cerrarInicio} onTouchEnd={cerrarFin} style={{
            position:"fixed", zIndex:61,
            top: (tabBarRef.current?.getBoundingClientRect().bottom || 100) + 4,
            left: 8, right: 8, margin:"0 auto", maxWidth: 340,
            maxHeight: "calc(100dvh - 160px)", overflowY:"auto",
            background:"var(--superficie)", border:"0.5px solid var(--borde)", borderRadius:12,
            padding:5, boxShadow:"0 10px 28px rgba(0,0,0,0.28)",
            display:"flex", flexDirection:"column", gap:2,
          }}>
            <div style={{fontSize:"var(--fs-xs)",fontWeight:700,color:"var(--texto-ter)",textTransform:"uppercase",letterSpacing:0.4,padding:"6px 10px 4px"}}>{submenu.titulo}</div>
            {submenu.secciones.map(([id,label]) => {
              const activo = submenu.activo === id;
              return (
                <button key={id} onClick={()=>{ submenu.elegir(id); setSubmenuOpen(false); }} style={{padding:"11px 12px",fontSize:"var(--fs-2)",textAlign:"left",background:activo?"var(--fondo-suave)":"none",border:"none",color:activo?"var(--primario)":"var(--texto)",borderRadius:8,cursor:"pointer",fontWeight:activo?700:500}}>
                  {label}{activo ? "  ✓" : ""}
                </button>
              );
            })}
            {submenu.extras.length > 0 && <div style={{height:1,background:"var(--borde)",margin:"4px 6px"}}/>}
            {submenu.extras.map(([label,fn]) => (
              <button key={label} onClick={()=>{ fn(); setSubmenuOpen(false); }} style={{padding:"11px 12px",fontSize:"var(--fs-2)",textAlign:"left",background:"none",border:"none",color:"var(--texto)",borderRadius:8,cursor:"pointer",fontWeight:500}}>
                {label}
              </button>
            ))}
            {submenu.contexto && (
              <>
                <div style={{height:1,background:"var(--borde)",margin:"4px 6px"}}/>
                <div style={{fontSize:"var(--fs-xs)",fontWeight:700,color:"var(--texto-ter)",textTransform:"uppercase",letterSpacing:0.4,padding:"6px 10px 4px"}}>Viendo: {equipoActualNombre}</div>
                {submenu.contexto.opciones.map(([id,label]) => {
                  const activo = submenu.contexto.actual === id;
                  return (
                    <button key={id} onClick={()=>{ submenu.contexto.elegir(id); setSubmenuOpen(false); }} style={{padding:"10px 12px",fontSize:"var(--fs-2)",textAlign:"left",background:activo?"var(--fondo-suave)":"none",border:"none",color:activo?"var(--primario)":"var(--texto-sec)",borderRadius:8,cursor:"pointer",fontWeight:activo?700:500}}>
                      {label}{activo ? "  ✓" : ""}
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </>
      )}

      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onScrollCapture={onScrollContenido} style={{flex:1,display:"flex",flexDirection:"column",minHeight:0,overflow:"hidden"}}>
      <div key={tab} style={{flex:1,display:"flex",flexDirection:"column",minHeight:0,animation:`uro-slide-${dirTab < 0 ? "izq" : "der"} .24s cubic-bezier(.22,.8,.3,1)`}}>
      {tab==="admin" && isAdmin && <AdminPanel/>}
      {tab==="logbook" && <LogbookPanel currentUser={currentUser} equipos={equipos} vista={subTabLogbook} setVista={setSubTabLogbook}/>}
      {(tab==="hospital" || promovida?.padre==="hospital") && <HospitalPanel pacientes={pacientes} setPacientes={setPacientes} currentUser={currentUser} tablaCirugias={tablaCirugias} setTablaCirugias={setTablaCirugias} misServiciosLista={misServiciosLista} setMisServiciosLista={setMisServiciosLista} loadingPacientes={loadingPacientes} setLoadingPacientes={setLoadingPacientes} loadingCirugias={loadingCirugias} setLoadingCirugias={setLoadingCirugias} loadingPendientes={loadingPendientes} setLoadingPendientes={setLoadingPendientes} pendientes={pendientes} setPendientes={setPendientes} equipos={equipos} setEquipos={setEquipos} invitacionesPendientes={invitacionesPendientes} setInvitacionesPendientes={setInvitacionesPendientes} users={users} subTab={promovida?.padre==="hospital" ? promovida.sub : subTabHospital} setSubTab={promovida?.padre==="hospital" ? (()=>{}) : setSubTabHospital} contexto={contexto} setContexto={setContexto}/>}
      {(tab==="conocimiento" || promovida?.padre==="conocimiento") && <ConocimientoHub conocimiento={conocimiento} setConocimiento={setConocimiento} isAdmin={isAdmin} currentUser={currentUser} videos={videos} setVideos={setVideos} setPlayingVideo={setPlayingVideo} mapaTema={mapaTema} setMapaTema={setMapaTema} mapaActual={mapaActual} setMapaActual={setMapaActual} mapaLoading={mapaLoading} generarMapa={generarMapa} topicOpen={topicOpen} setTopicOpen={setTopicOpen} mapasGuardados={mapasGuardados} onGuardarMapa={handleGuardarMapa} onEliminarMapa={handleEliminarMapa} onCargarMapaGuardado={cargarMapaGuardado} guardandoMapa={guardandoMapa} subTab={promovida?.padre==="conocimiento" ? promovida.sub : subTabBiblio} setSubTab={promovida?.padre==="conocimiento" ? (()=>{}) : setSubTabBiblio}/>}
      {tab==="videos" && <VideoLibrary videos={videos} setVideos={setVideos} isAdmin={isAdmin} setPlayingVideo={setPlayingVideo}/>}

      {tab==="chat" && (
  <div style={{display:"flex",flexDirection:"column",flex:1,minHeight:0, position:"relative"}}>
    {panelConversacionesAbierto && currentUser?.rol !== "admin" && (
      <PanelConversaciones
        conversaciones={conversaciones}
        conversacionActual={conversacionActual}
        onSeleccionar={abrirConversacion}
        onNueva={nuevaConversacion}
        onEliminar={eliminarConv}
        onCerrar={() => setPanelConversacionesAbierto(false)}
      />
    )}
          {/* Barra superior con botón de conversaciones */}
{!isAdmin && (
  <div style={{padding:"8px 12px", borderBottom:"0.5px solid var(--fondo)", display:"flex", alignItems:"center", justifyContent:"space-between", background:"var(--fondo-suave)"}}>
    <button 
      onClick={() => setPanelConversacionesAbierto(!panelConversacionesAbierto)}
      style={{
        background:"var(--superficie)",
        border:"0.5px solid var(--borde)",
        color:"var(--primario)",
        fontSize:"var(--fs-1)",
        padding:"5px 12px",
        borderRadius:6,
        cursor:"pointer",
        display:"flex",
        alignItems:"center",
        gap:6,
        fontWeight:500,
      }}
      title="Mis conversaciones"
    >
      ☰ Conversaciones {conversaciones.length > 0 && `(${conversaciones.length})`}
    </button>
    {conversacionActual && (
      <button
        onClick={nuevaConversacion}
        style={{
          background:"var(--superficie)",
          border:"0.5px solid var(--borde)",
          color:"var(--primario)",
          fontSize:"var(--fs-0)",
          padding:"5px 10px",
          borderRadius:6,
          cursor:"pointer",
          fontWeight:500,
        }}
      >+ Nueva</button>
    )}
  </div>
)}
<div style={{flex:1,overflowY:"auto",padding:"16px 16px 8px",minHeight:0}}>
  {loadingConversaciones && (
    <div style={{textAlign:"center",padding:"40px 16px",color:"var(--texto-ter)",fontSize:"var(--fs-2)"}}>
      Cargando conversación...
    </div>
  )}
{!loadingConversaciones && messages.length === 0 && isAdmin && <div style={{textAlign:"center",padding:"32px 16px",color:"var(--texto-ter)",fontSize:"var(--fs-2)",lineHeight:1.6}}><Uros expresion="hola" size={96} style={{margin:"0 auto 12px"}}/>Como admin puedes usar el chat. Escribe una consulta.</div>}

{!loadingConversaciones && messages.length === 1 && messages[0].role === "assistant" && !isAdmin && (
  <PortadaChat nombre={currentUser?.nombre} />
)}

{!loadingConversaciones && messages.map((m,i) => {
  // En la portada el saludo va dentro de PortadaChat, no como burbuja duplicada
  const esPortada = messages.length === 1 && messages[0].role === "assistant" && !isAdmin;
  if (esPortada && i === 0) return null;
  return <ChatBubble key={i} msg={m} userInitials={userInitials} onPlayVideo={setPlayingVideo}/>;
})}
            {loading && (
              <div style={{display:"flex",gap:8,alignItems:"center",padding:"8px 0"}}>
                <UrosAvatar size={30}/>
                <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",borderRadius:"16px 16px 16px 4px",background:"var(--superficie)",fontSize:"var(--fs-2)",color:"var(--texto-ter)",border:"0.5px solid var(--borde)"}}>
                  <Uros expresion="pensando" size={26}/> Consultando...
                </div>
              </div>
            )}
            <div ref={bottomRef}/>
          </div>
          <div style={{padding:"8px 12px 12px",borderTop:"0.5px solid var(--borde)"}}>
            <div data-tour="modo-respuesta" style={{display:"flex",gap:6,marginBottom:8,alignItems:"center"}}>
              {[["precisa","⚡ Precisa"],["explicativa","📖 Explicativa"]].map(([id,label])=><button key={id} onClick={()=>setModo(id)} style={{padding:"5px 12px",fontSize:"var(--fs-1)",fontWeight:modo===id?500:400,borderRadius:8,cursor:"pointer",border:modo===id?"none":"0.5px solid var(--borde)",background:modo===id?"var(--primario)":"var(--superficie)",color:modo===id?"var(--texto-inv)":"var(--texto-sec)"}}>{label}</button>)}
              <span style={{fontSize:"var(--fs-0)",color:"var(--texto-ter)",marginLeft:4}}>{modo==="precisa" ? "Definición breve" : "Explicación completa"}</span>
            </div>
            <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
              <textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMsg();}}} placeholder="Escribe tu consulta..." rows={2} style={{flex:1,resize:"none",padding:"10px 12px",fontSize:"var(--fs-2)",borderRadius:8,border:"0.5px solid var(--borde)",background:"var(--superficie)",color:"var(--texto)",lineHeight:1.5,outline:"none",fontFamily:"inherit"}}/>
              <button onClick={sendMsg} disabled={loading||!input.trim()} style={{padding:"10px 16px",borderRadius:8,border:"none",background:loading||!input.trim()?"var(--borde)":"var(--primario)",color:"var(--texto-inv)",fontSize:"var(--fs-2)",cursor:loading||!input.trim()?"default":"pointer",fontWeight:500,whiteSpace:"nowrap"}}>Enviar</button>
            </div>
            <div style={{fontSize:"var(--fs-xs)",color:"var(--texto-ter)",lineHeight:1.4,marginTop:8,textAlign:"center"}}>
              ⚠️ Información de apoyo clínico. No reemplaza el juicio médico.
            </div>
          </div>
        </div>
      )}

      </div>
      </div>

      {playingVideo && <VideoPlayer video={playingVideo} onClose={()=>setPlayingVideo(null)}/>}

      {tutorialOpen && <TutorialTour rol={currentUser?.rol} onGoToTab={setTab} onClose={cerrarTutorial}/>}
      {perfilOpen && <PerfilModal currentUser={currentUser} setCurrentUser={setCurrentUser} onClose={()=>setPerfilOpen(false)}/>}
      {configOpen && <ConfigModal onClose={()=>setConfigOpen(false)} currentUser={currentUser}/>}
      {equiposOpen && (
        <div onClick={()=>setEquiposOpen(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:12}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"var(--fondo)",border:"0.5px solid var(--borde)",borderRadius:14,width:"100%",maxWidth:620,maxHeight:"88dvh",overflowY:"auto",WebkitOverflowScrolling:"touch",display:"flex",flexDirection:"column"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 18px 6px",flexShrink:0}}>
              <div style={{fontSize:18,fontWeight:700,color:"var(--texto)"}}>🤝 Equipos</div>
              <button onClick={()=>setEquiposOpen(false)} style={{background:"none",border:"none",fontSize:20,color:"var(--texto-ter)",cursor:"pointer",lineHeight:1}}>✕</button>
            </div>
            <EquiposPanel equipos={equipos} setEquipos={setEquipos} invitacionesPendientes={invitacionesPendientes} setInvitacionesPendientes={setInvitacionesPendientes} currentUser={currentUser} onCerrar={()=>setEquiposOpen(false)}/>
          </div>
        </div>
      )}
    </div>
  );
}

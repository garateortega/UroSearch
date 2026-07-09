import { useState, useRef, useEffect, Fragment } from "react";
import { register as registerUser, login as loginUser, logout as logoutUser, getPerfil, getSession, onAuthChange, listarPerfiles, cambiarEstadoUsuario, eliminarUsuario } from "./auth";
import { listarConversaciones, crearConversacion, cargarMensajes, agregarMensaje, actualizarTitulo, eliminarConversacion, generarTituloDesdeMensaje } from "./chat";
import { listarMapas, guardarMapa, eliminarMapa } from "./mapas";
import { listarMisEquipos, listarMisInvitaciones, listarMiembros, listarInvitacionesEquipo, crearEquipo, eliminarEquipo, salirDelEquipo, expulsarMiembro, buscarUsuarioPorCorreo, crearInvitacion, aceptarInvitacion, rechazarInvitacion } from "./equipos";
import { listarPacientes, crearPaciente, actualizarPaciente, eliminarPaciente, listarEvoluciones, crearEvolucion, eliminarEvolucion, listarExamenes, crearExamen, eliminarExamen, listarMisServicios, crearServicio, eliminarServicio, crearServiciosBulk, listarServiciosEquipo } from "./pacientes";
import { listarCirugias, crearCirugia, crearCirugiasBulk, actualizarCirugia, eliminarCirugia, listarPendientes, crearPendiente, actualizarPendiente, eliminarPendiente } from "./cirugias";
import { listarConocimiento, crearConocimiento, eliminarConocimiento, listarVideos, crearVideo, eliminarVideo as eliminarVideoSupabase, listarPreguntas, crearPregunta, eliminarPregunta, crearChunks, listarChunks, buscarChunks } from "./biblioteca";
import { supabase } from "./supabase"; // ← AJUSTA esta ruta si tu cliente está en otro archivo (ej: "./supabaseClient" o "./lib/supabase")

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

// Saludo inicial de Uros (incluye el aviso de apoyo clínico una sola vez, al abrir)
function saludoUros(nombre) {
  const primer = (nombre || "").split(" ")[0] || "";
  return `👋 Hola ${primer}. Soy **Uros**, tu asistente clínico de UroSearch.\n\n¿En qué te puedo ayudar?`;
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

const VERSION = "v0.12.0 (beta)";
const ESPECIALIDADES = ["Urología", "Medicina General", "Cirugía", "Nefrología", "Trasplantología", "Residente Urología", "Interno", "Otro"];

// ─── Perfiles / roles y permisos ───────────────────────────────
// admin: todo · urologo/residente: clínico completo · interno: estudio+chat, Hospital SOLO LECTURA
// enfermeria: chat + Hospital (sin Biblioteca)
const ROLES_ASIGNABLES = [["urologo","Urólogo/a"],["residente","Residente"],["interno","Interno/a"],["enfermeria","Enfermería"]];
const ROL_LABEL = { admin:"Administrador", urologo:"Urólogo/a", residente:"Residente", interno:"Interno/a", enfermeria:"Enfermería" };
function tabsPorRol(rol, pendientesCount = 0) {
  const chat = ["chat","💬 Chat"];
  const hospital = ["hospital","🏥 Hospital"];
  const biblio = ["conocimiento","📖 Biblioteca"];
  if (rol === "admin") return [["admin",`👤 Cuentas${pendientesCount>0?` (${pendientesCount})`:""}`], chat, hospital, biblio];
  if (rol === "enfermeria") return [chat, hospital];   // sin Biblioteca
  return [chat, hospital, biblio];                      // urologo, residente, interno
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
const UROS_VERSION = "4"; // súbelo cada vez que reemplaces imágenes, para forzar recarga
const UROS_BASE = `${import.meta.env.BASE_URL || "/"}uros/`;
const urosSrc = (name) => `${UROS_BASE}${name}.webp?v=${UROS_VERSION}`;
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
  const primer = (nombre || "").split(" ")[0] || "";
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:10, padding:"20px 4px 8px" }}>
      <div style={{
        flex:"1 1 0",
        padding:"14px 16px",
        borderRadius:"16px 16px 16px 4px",
        background:"var(--superficie)",
        border:"0.5px solid var(--borde)",
        fontSize:14.5, lineHeight:1.55, color:"var(--texto)",
      }}>
        👋 Hola {primer}. Soy <strong>Uros</strong>, tu asistente clínico de UroSearch.
        <div style={{ marginTop:10 }}>¿En qué te puedo ayudar?</div>
      </div>
      <Uros expresion="hero" size={260} style={{ flex:"0 0 auto", width:"auto", maxWidth:"46%", maxHeight:"46vh" }} />
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
        <div style={{fontSize:14, fontWeight:600, color:"var(--texto)"}}>Mis conversaciones</div>
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
          fontSize: 13,
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
          <div style={{textAlign:"center", padding:"24px 16px", color:"var(--texto-ter)", fontSize:12, lineHeight:1.5}}>
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
                  fontSize: 12.5,
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
                <div style={{fontSize: 10, color: "var(--texto-ter)"}}>
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
                    fontSize: 14,
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
  const bubbleStyle = { padding:"10px 14px", borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px", background: isUser ? "var(--primario)" : "var(--superficie)", color: isUser ?"var(--texto-inv)":"var(--texto)", fontSize:14, lineHeight:1.6, border: isUser ? "none" : "0.5px solid var(--borde)", whiteSpace:"pre-wrap" };
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
            <div style={{fontSize:10,fontWeight:500,color:"var(--primario-osc)"}}>📅 Información de tu tabla quirúrgica · {msg.cirugiasConsulta.cantidad} {msg.cirugiasConsulta.cantidad === 1 ? "cirugía" : "cirugías"} en {msg.cirugiasConsulta.rango}</div>
          </div>
        )}
        {msg.pacientesConsulta && (
          <div style={{marginTop:6,padding:"7px 10px",background:"var(--chip-rosa-bg)",border:"0.5px solid var(--chip-rosa-borde)",borderRadius:8}}>
            <div style={{fontSize:10,fontWeight:500,color:"var(--chip-rosa)"}}>🏥 Información de tus pacientes · {msg.pacientesConsulta.cantidad} {msg.pacientesConsulta.cantidad === 1 ? "paciente" : "pacientes"}</div>
          </div>
        )}
        {msg.fuentes && msg.fuentes.length > 0 && (
          <div style={{marginTop:6,padding:"7px 10px",background:"var(--exito-bg)",border:"0.5px solid var(--exito-borde)",borderRadius:8}}>
            <div style={{fontSize:10,fontWeight:500,color:"var(--exito)",marginBottom:4}}>📚 Basado en tu base de conocimiento:</div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              {msg.fuentes.map(f => <div key={f.id} style={{fontSize:11,color:"var(--exito)",lineHeight:1.4}}>• <strong>{f.titulo}</strong>{f.fuente ? <span style={{color:"var(--texto-ter)"}}> — {f.fuente}</span> : (f.categoria ? <span style={{color:"var(--texto-ter)"}}> ({f.categoria})</span> : null)}</div>)}
            </div>
          </div>
        )}
        {msg.videos && msg.videos.length > 0 && (
          <div style={{marginTop:8,padding:"10px 12px",background:"var(--fondo-suave)",border:"0.5px solid var(--borde)",borderRadius:10}}>
            <div style={{fontSize:11,fontWeight:500,color:"var(--texto-sec)",marginBottom:8}}>🎬 Videos sugeridos de la biblioteca</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {msg.videos.map(v => {
                const ytId = getYouTubeId(v.url);
                const thumb = ytId ? `https://img.youtube.com/vi/${ytId}/default.jpg` : null;
                return (
                  <div key={v.id} onClick={()=>onPlayVideo(v)} style={{display:"flex",alignItems:"center",gap:10,padding:"6px",background:"var(--superficie)",borderRadius:8,cursor:"pointer",border:"0.5px solid var(--header-bg)"}}>
                    {thumb && <img src={thumb} alt="" style={{width:60,height:45,objectFit:"cover",borderRadius:4,flexShrink:0}}/>}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:500,color:"var(--texto)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v.titulo}</div>
                      <div style={{fontSize:10,color:"var(--texto-ter)"}}>{v.categoria} · {v.autor}</div>
                    </div>
                    <div style={{fontSize:13,color:"var(--primario)"}}>▶</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {isUser && <div style={{width:30,height:30,borderRadius:"50%",background:"var(--primario-claro)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:500,color:"var(--texto-inv)",marginLeft:8,flexShrink:0,marginTop:2}}>{userInitials}</div>}
    </div>
  );
}

const inputStyle = { width:"100%", padding:"10px 12px", fontSize:14, borderRadius:8, border:"1px solid var(--borde)", background:"var(--superficie)", color:"var(--texto)", outline:"none", boxSizing:"border-box", marginBottom:10, fontFamily:"inherit" };
const labelStyle = { fontSize:12, fontWeight:500, color:"var(--texto-sec)", marginBottom:4, display:"block" };
const btnPrimary = { width:"100%", padding:"11px", fontSize:14, fontWeight:500, background:"var(--primario)", color:"var(--texto-inv)", border:"none", borderRadius:8, cursor:"pointer", marginTop:6 };

// ============================================================
// TEMAS (modo claro / oscuro) — variables CSS
// ============================================================
const THEME_CSS = `
:root, [data-theme="light"] {
  color-scheme: light;
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
const btnSecondary = { width:"100%", padding:"11px", fontSize:14, fontWeight:500, background:"var(--superficie)", color:"var(--primario)", border:"1px solid var(--primario)", borderRadius:8, cursor:"pointer", marginTop:8 };

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
    if (!form.correo.trim() || !form.correo.includes("@")) return setError("Ingresa un correo válido");
    if (!form.password) return setError("Ingresa tu contraseña");

    setLoading(true);
    const result = await loginUser({
      correo: form.correo,
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
        <div style={{fontSize:15, color:"var(--texto-sec)", marginBottom:34, lineHeight:1.5}}>Asistente Clínico de Urología</div>
        <div style={{maxWidth:340, margin:"0 auto"}}>
          <button onClick={()=>{setView("login"); setError(""); setInfo("");}} style={{...btnPrimary, padding:"14px", fontSize:16}}>Iniciar sesión</button>
          <button onClick={()=>{setView("register"); setError(""); setInfo("");}} style={{...btnSecondary, padding:"14px", fontSize:16}}>Solicitar cuenta</button>
        </div>
        <div style={{fontSize:12, color:"var(--texto-ter)", marginTop:36, padding:"0 20px", lineHeight:1.5}}>Acceso restringido a equipo clínico<br/>urológico autorizado</div>
        <div style={{fontSize:12, fontStyle:"italic", color:"var(--texto-sec)", marginTop:24, paddingTop:16, borderTop:"0.5px solid var(--borde)"}}>Creado por Dr. Sebastián Gárate Ortega - Residente de Urología UACh</div>
        <div style={{fontSize:9, fontFamily:"monospace", color:"var(--texto-ter)", marginTop:4, letterSpacing:"0.3px"}}>{VERSION}</div>
      </div>
    );
  }

  if (view === "login") {
    return (
      <div style={{padding:"24px 24px 32px"}}>
        <button onClick={()=>setView("welcome")} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:13,cursor:"pointer",marginBottom:14,padding:0}}>← Volver</button>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:24}}>
          <LogoUroSearch size={36}/>
          <div style={{fontSize:22,fontWeight:600,fontStyle:"italic",fontFamily:"Georgia, 'Times New Roman', serif",color:"var(--texto)"}}>Iniciar sesión</div>
        </div>
        <label style={labelStyle}>Correo electrónico</label>
        <input type="email" value={form.correo} onChange={e=>setForm({...form,correo:e.target.value})} placeholder="tu.correo@hbv.cl" style={inputStyle} disabled={loading}/>
        <label style={labelStyle}>Contraseña</label>
        <input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} onKeyDown={e=>{if(e.key==="Enter")handleLogin();}} placeholder="••••••••" style={inputStyle} disabled={loading}/>
        {error && <div style={{fontSize:12,color:"var(--peligro)",background:"var(--peligro-bg)",padding:"8px 10px",borderRadius:6,marginBottom:6}}>{error}</div>}
        <button onClick={handleLogin} disabled={loading} style={{...btnPrimary, opacity: loading ? 0.6 : 1, cursor: loading ? "default" : "pointer"}}>
          {loading ? "Ingresando..." : "Ingresar"}
        </button>
        <div style={{textAlign:"center",fontSize:12,color:"var(--texto-sec)",marginTop:14}}>¿No tienes cuenta? <button onClick={()=>{setView("register");setError("");setInfo("");}} style={{background:"none",border:"none",color:"var(--primario)",fontWeight:500,cursor:"pointer",padding:0,fontSize:12}}>Solicítala aquí</button></div>
      </div>
    );
  }

  return (
    <div style={{padding:"24px 24px 32px"}}>
      <button onClick={()=>setView("welcome")} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:13,cursor:"pointer",marginBottom:14,padding:0}}>← Volver</button>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
        <LogoUroSearch size={36}/>
        <div style={{fontSize:22,fontWeight:600,fontStyle:"italic",fontFamily:"Georgia, 'Times New Roman', serif",color:"var(--texto)"}}>Solicitar cuenta</div>
      </div>
      <div style={{fontSize:12,color:"var(--texto-sec)",marginBottom:18,lineHeight:1.5}}>Tu cuenta será revisada por el administrador antes de ser activada.</div>
      <label style={labelStyle}>Nombre completo</label>
      <input value={form.nombre} onChange={e=>setForm({...form,nombre:e.target.value})} placeholder="Dr. Juan Pérez" style={inputStyle} disabled={loading}/>
      <label style={labelStyle}>Correo electrónico</label>
      <input type="email" value={form.correo} onChange={e=>setForm({...form,correo:e.target.value})} placeholder="tu.correo@hbv.cl" style={inputStyle} disabled={loading}/>
      <label style={labelStyle}>Especialidad / cargo</label>
      <select value={form.especialidad} onChange={e=>setForm({...form,especialidad:e.target.value})} style={inputStyle} disabled={loading}>
        {ESPECIALIDADES.map(e=><option key={e}>{e}</option>)}
      </select>
      <label style={labelStyle}>Documento de respaldo</label>
      <div style={{fontSize:11,color:"var(--texto-ter)",marginBottom:6}}>Adjunta título de especialidad o carta de residencia (PDF/JPG/PNG, máx. 5 MB)</div>
      <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleFile} style={{display:"none"}} disabled={loading}/>
      <button onClick={()=>fileRef.current?.click()} disabled={loading} style={{width:"100%",padding:"10px",fontSize:13,background:"var(--superficie)",color:"var(--primario)",border:"1px dashed var(--primario)",borderRadius:8,cursor:loading?"default":"pointer",marginBottom:10,textAlign:"left",opacity:loading?0.6:1}}>📎 {form.documentoNombre || "Seleccionar archivo..."}</button>
      <label style={labelStyle}>Contraseña</label>
      <input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Mínimo 6 caracteres" style={inputStyle} disabled={loading}/>
      <label style={labelStyle}>Confirmar contraseña</label>
      <input type="password" value={form.password2} onChange={e=>setForm({...form,password2:e.target.value})} onKeyDown={e=>{if(e.key==="Enter")handleRegister();}} placeholder="Repite tu contraseña" style={inputStyle} disabled={loading}/>
      {error && <div style={{fontSize:12,color:"var(--peligro)",background:"var(--peligro-bg)",padding:"8px 10px",borderRadius:6,marginBottom:6}}>{error}</div>}
      {info && <div style={{fontSize:12,color:"var(--exito)",background:"var(--exito-bg)",padding:"10px 12px",borderRadius:6,marginBottom:6,lineHeight:1.5}}>✓ {info}</div>}
      <button onClick={handleRegister} disabled={loading} style={{...btnPrimary, opacity: loading ? 0.6 : 1, cursor: loading ? "default" : "pointer"}}>
        {loading ? "Enviando solicitud..." : "Enviar solicitud"}
      </button>
      <div style={{textAlign:"center",fontSize:12,color:"var(--texto-sec)",marginTop:14}}>¿Ya tienes cuenta? <button onClick={()=>{setView("login");setError("");setInfo("");}} style={{background:"none",border:"none",color:"var(--primario)",fontWeight:500,cursor:"pointer",padding:0,fontSize:12}}>Inicia sesión</button></div>
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
    fontSize:10, fontWeight:500, padding:"2px 8px", borderRadius:10,
    background: e==="aprobado"?"var(--exito-bg)":e==="rechazado"?"var(--peligro-bg)":"var(--alerta-bg)",
    color: e==="aprobado"?"var(--exito)":e==="rechazado"?"var(--peligro)":"var(--alerta)"
  });

  if (loading) {
    return (
      <div style={{padding:"40px 16px", textAlign:"center", color:"var(--texto-ter)", fontSize:13}}>
        Cargando usuarios...
      </div>
    );
  }

  return (
    <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
      <div style={{marginBottom:16, display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10}}>
        <div>
          <div style={{fontSize:15,fontWeight:600,color:"var(--texto)",marginBottom:4}}>Panel de administración</div>
          <div style={{fontSize:12,color:"var(--texto-sec)"}}>Gestión de cuentas del equipo clínico</div>
        </div>
        <button onClick={cargarPerfiles} style={{padding:"6px 12px",fontSize:11,background:"var(--superficie)",color:"var(--primario)",border:"0.5px solid var(--primario)",borderRadius:6,cursor:"pointer"}}>↻ Actualizar</button>
      </div>

      {error && <div style={{fontSize:12,color:"var(--peligro)",background:"var(--peligro-bg)",padding:"8px 10px",borderRadius:6,marginBottom:10}}>{error}</div>}

      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        {[["pendiente",`Pendientes (${counts.pendiente})`],["aprobado",`Aprobados (${counts.aprobado})`],["rechazado",`Rechazados (${counts.rechazado})`],["todos","Todos"]].map(([id,label]) => (
          <button key={id} onClick={()=>setFiltro(id)} style={{padding:"6px 12px",fontSize:12,fontWeight:filtro===id?500:400,borderRadius:6,cursor:"pointer",border:filtro===id?"none":"0.5px solid var(--borde)",background:filtro===id?"var(--primario)":"var(--superficie)",color:filtro===id?"var(--texto-inv)":"var(--texto-sec)"}}>{label}</button>
        ))}
      </div>

      {filtrados.length === 0 ? (
        <div style={{textAlign:"center",padding:"40px 0",color:"var(--texto-ter)",fontSize:13}}>
          {perfiles.length === 0 ? "No hay usuarios registrados" : "No hay usuarios en esta categoría"}
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {filtrados.map(u => (
            <div key={u.id} style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"12px 14px"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
                <div style={{fontSize:14,fontWeight:500,color:"var(--texto)"}}>{u.nombre || "Sin nombre"}</div>
                <span style={badge(u.estado)}>{u.estado}</span>
                {u.rol === "admin" && <span style={{fontSize:9,padding:"1px 6px",background:"var(--navy-fijo)",color:"var(--texto-inv)",borderRadius:4,fontWeight:500}}>ADMIN</span>}
              </div>
              <div style={{fontSize:12,color:"var(--texto-sec)"}}>{u.correo} · {u.especialidad || "Sin especialidad"}</div>
              {u.fecha_registro && <div style={{fontSize:11,color:"var(--texto-ter)",marginTop:2}}>Solicitud: {new Date(u.fecha_registro).toLocaleDateString("es-CL")}</div>}
              {u.documento_nombre && (
                <div style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",background:"var(--fondo-suave)",borderRadius:6,fontSize:11,color:"var(--texto-sec)",marginTop:8}}>📎 <span style={{flex:1}}>{u.documento_nombre}</span></div>
              )}
              {u.rol !== "admin" && (
                <div style={{display:"flex",alignItems:"center",gap:6,marginTop:8}}>
                  <span style={{fontSize:11,color:"var(--texto-ter)"}}>Perfil:</span>
                  <select value={u.rol || "urologo"} onChange={e=>cambiarRol(u.id, e.target.value)} style={{padding:"4px 8px",fontSize:12,borderRadius:6,border:"0.5px solid var(--borde)",background:"var(--superficie)",color:"var(--texto)",cursor:"pointer"}}>
                    {ROLES_ASIGNABLES.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              )}
              <div style={{display:"flex",gap:6,marginTop:8}}>
                {u.estado === "pendiente" && (<>
                  <button onClick={()=>cambiar(u.id,"aprobado")} style={{flex:1,padding:"7px",fontSize:12,background:"var(--exito)",color:"var(--texto-inv)",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>✓ Aprobar</button>
                  <button onClick={()=>cambiar(u.id,"rechazado")} style={{flex:1,padding:"7px",fontSize:12,background:"var(--peligro)",color:"var(--texto-inv)",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>✗ Rechazar</button>
                </>)}
                {u.estado === "aprobado" && u.rol !== "admin" && <button onClick={()=>cambiar(u.id,"rechazado")} style={{flex:1,padding:"7px",fontSize:12,background:"var(--superficie)",color:"var(--peligro)",border:"0.5px solid var(--peligro)",borderRadius:6,cursor:"pointer",fontWeight:500}}>Suspender</button>}
                {u.estado === "rechazado" && <button onClick={()=>cambiar(u.id,"aprobado")} style={{flex:1,padding:"7px",fontSize:12,background:"var(--superficie)",color:"var(--exito)",border:"0.5px solid var(--exito)",borderRadius:6,cursor:"pointer",fontWeight:500}}>Reactivar</button>}
                {u.rol !== "admin" && <button onClick={()=>eliminar(u.id)} style={{padding:"7px 10px",fontSize:12,background:"var(--superficie)",color:"var(--texto-ter)",border:"0.5px solid var(--borde)",borderRadius:6,cursor:"pointer"}}>Eliminar</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
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

  const cargar = async () => {
    setLoading(true);
    const result = await listarPreguntas();
    setLoading(false);
    if (result.ok) setPreguntas(result.preguntas);
  };
  useEffect(() => { cargar(); }, []);

  const categorias = ["Todas", ...Array.from(new Set(preguntas.map(p => p.categoria || "General")))];
  const filtradas = filtroCat === "Todas" ? preguntas : preguntas.filter(p => (p.categoria||"General") === filtroCat);
  const actual = filtradas[idx] || null;

  const responder = (i) => {
    if (mostrarResp) return;
    setSeleccion(i);
    setMostrarResp(true);
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
        <button onClick={()=>{setVista("quiz");setErrorForm("");}} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:13,cursor:"pointer",marginBottom:12,padding:0}}>← Volver</button>
        <div style={{fontSize:15,fontWeight:600,color:"var(--texto)",marginBottom:14}}>Nueva pregunta</div>
        <label style={labelStyle}>Enunciado</label>
        <textarea value={form.enunciado} onChange={e=>setForm({...form,enunciado:e.target.value})} placeholder="Escribe la pregunta..." rows={3} style={{...inputStyle,resize:"vertical"}}/>
        <label style={labelStyle}>Alternativas (marca la correcta)</label>
        {form.alternativas.map((alt, i) => (
          <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
            <button onClick={()=>setForm({...form,correcta:i})} style={{width:24,height:24,borderRadius:"50%",border:form.correcta===i?"none":"1px solid var(--borde)",background:form.correcta===i?"var(--exito)":"var(--superficie)",color:"var(--texto-inv)",cursor:"pointer",fontSize:12,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>{form.correcta===i?"✓":""}</button>
            <input value={alt} onChange={e=>{const nuevas=[...form.alternativas];nuevas[i]=e.target.value;setForm({...form,alternativas:nuevas});}} placeholder={`Alternativa ${String.fromCharCode(65+i)}`} style={{...inputStyle,marginBottom:0,flex:1}}/>
          </div>
        ))}
        <label style={{...labelStyle,marginTop:8}}>Feedback / explicación</label>
        <textarea value={form.feedback} onChange={e=>setForm({...form,feedback:e.target.value})} placeholder="Explicación que se muestra al responder..." rows={3} style={{...inputStyle,resize:"vertical"}}/>
        <label style={labelStyle}>Categoría</label>
        <input value={form.categoria} onChange={e=>setForm({...form,categoria:e.target.value})} placeholder="Ej: Litiasis, Oncología, NMIBC..." style={inputStyle}/>
        {errorForm && <div style={{fontSize:12,color:"var(--peligro)",background:"var(--peligro-bg)",padding:"8px 10px",borderRadius:6,marginBottom:8}}>{errorForm}</div>}
        <button onClick={guardar} style={{...btnPrimary,marginTop:0}}>Guardar pregunta</button>
      </div>
    );
  }

  // VISTA: lista de preguntas (admin, para gestionar/eliminar)
  if (vista === "lista") {
    return (
      <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <button onClick={()=>setVista("quiz")} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:13,cursor:"pointer",padding:0}}>← Volver al quiz</button>
          <span style={{fontSize:12,color:"var(--texto-ter)"}}>{preguntas.length} preguntas</span>
        </div>
        {preguntas.length === 0 ? (
          <div style={{textAlign:"center",padding:"30px",color:"var(--texto-ter)",fontSize:13}}>No hay preguntas aún.</div>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {preguntas.map(p => (
              <div key={p.id} style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:8,padding:"10px 12px"}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
                  <span style={{fontSize:10,color:"var(--primario)",fontWeight:600}}>{p.categoria||"General"}</span>
                  {isAdmin && <button onClick={()=>eliminar(p.id)} style={{background:"none",border:"none",color:"var(--peligro)",cursor:"pointer",fontSize:12,padding:0}}>🗑</button>}
                </div>
                <div style={{fontSize:13,color:"var(--texto)",marginTop:3}}>{p.enunciado}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // VISTA: quiz (todos)
  return (
    <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,gap:10}}>
        <div>
          <div style={{fontSize:22,fontWeight:700,color:"var(--texto)"}}>❓ Preguntas</div>
          <div style={{fontSize:13,color:"var(--texto-sec)"}}>{preguntas.length} preguntas para estudiar</div>
        </div>
        {isAdmin && (
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            <button onClick={()=>setVista("nueva")} style={{padding:"7px 12px",fontSize:12,background:"var(--primario)",color:"var(--texto-inv)",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>+ Nueva</button>
            <button onClick={()=>setVista("lista")} style={{padding:"7px 12px",fontSize:12,background:"var(--superficie)",color:"var(--primario)",border:"0.5px solid var(--borde)",borderRadius:6,cursor:"pointer"}}>Gestionar</button>
          </div>
        )}
      </div>

      {categorias.length > 1 && (
        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:14}}>
          {categorias.map(c => (
            <button key={c} onClick={()=>{setFiltroCat(c);setIdx(0);setSeleccion(null);setMostrarResp(false);}} style={{padding:"4px 11px",fontSize:11,borderRadius:14,cursor:"pointer",border:filtroCat===c?"none":"0.5px solid var(--borde)",background:filtroCat===c?"var(--primario)":"var(--superficie)",color:filtroCat===c?"var(--texto-inv)":"var(--texto-sec)",fontWeight:filtroCat===c?600:400}}>{c}</button>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{textAlign:"center",padding:"40px",color:"var(--texto-ter)",fontSize:13}}>Cargando...</div>
      ) : !actual ? (
        <div style={{textAlign:"center",padding:"40px 20px",color:"var(--texto-ter)",fontSize:13,lineHeight:1.6}}>
          {preguntas.length === 0 ? (isAdmin ? "Aún no has creado preguntas. Usa el botón \"+ Nueva\"." : "El administrador aún no ha creado preguntas.") : "No hay preguntas en esta categoría."}
        </div>
      ) : (
        <div>
          <div style={{fontSize:11,color:"var(--texto-ter)",marginBottom:8,textAlign:"center"}}>Pregunta {idx+1} de {filtradas.length}</div>
          <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"16px",marginBottom:12}}>
            <div style={{fontSize:15,fontWeight:600,color:"var(--texto)",lineHeight:1.5,marginBottom:14}}>{actual.enunciado}</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {(actual.alternativas||[]).map((alt, i) => {
                let bg = "var(--superficie)", border = "0.5px solid var(--borde)", color = "var(--texto)";
                if (mostrarResp) {
                  if (i === actual.correcta) { bg = "var(--exito-bg)"; border = "1px solid var(--exito)"; color = "var(--exito)"; }
                  else if (i === seleccion) { bg = "var(--peligro-bg)"; border = "1px solid var(--peligro)"; color = "var(--peligro)"; }
                }
                return (
                  <button key={i} onClick={()=>responder(i)} disabled={mostrarResp} style={{textAlign:"left",padding:"11px 14px",fontSize:14,background:bg,border,borderRadius:8,cursor:mostrarResp?"default":"pointer",color,display:"flex",alignItems:"center",gap:10,fontWeight:mostrarResp&&i===actual.correcta?600:400}}>
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
                <div style={{fontSize:13,fontWeight:600,color:seleccion===actual.correcta?"var(--exito)":"var(--texto-sec)"}}>
                  {seleccion===actual.correcta ? "¡Bien hecho!" : "Revisa la explicación 👇"}
                </div>
              </div>
            )}
            {mostrarResp && actual.feedback && (
              <div style={{marginTop:10,padding:"12px",background:"var(--fondo-suave)",borderRadius:8,borderLeft:"3px solid var(--primario)"}}>
                <div style={{fontSize:11,fontWeight:600,color:"var(--primario)",marginBottom:4}}>💡 Explicación</div>
                <div style={{fontSize:13,color:"var(--texto)",lineHeight:1.5,whiteSpace:"pre-wrap"}}>{actual.feedback}</div>
              </div>
            )}
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"space-between"}}>
            <button onClick={anterior} disabled={filtradas.length<=1} style={{padding:"10px 16px",fontSize:13,background:"var(--superficie)",color:"var(--texto-sec)",border:"0.5px solid var(--borde)",borderRadius:8,cursor:filtradas.length<=1?"default":"pointer",opacity:filtradas.length<=1?0.5:1}}>← Anterior</button>
            <button onClick={siguiente} disabled={filtradas.length<=1} style={{padding:"10px 16px",fontSize:13,background:"var(--primario)",color:"var(--texto-inv)",border:"none",borderRadius:8,cursor:filtradas.length<=1?"default":"pointer",opacity:filtradas.length<=1?0.5:1,fontWeight:500}}>Siguiente →</button>
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
  const fileRef = useRef(null);

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
    const matchQ = !q || (d.titulo||"").toLowerCase().includes(q) || (d.contenido||"").toLowerCase().includes(q);
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
        <button onClick={()=>{setVista("lista");setErrorForm("");}} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:13,cursor:"pointer",marginBottom:12,padding:0}}>← Volver</button>
        <div style={{fontSize:15,fontWeight:600,color:"var(--texto)",marginBottom:14}}>Agregar a base de conocimiento</div>
        <div style={{background:"var(--exito-bg)",border:"0.5px solid var(--exito-borde)",borderRadius:8,padding:"10px 12px",marginBottom:14,fontSize:11,color:"var(--exito)",lineHeight:1.5}}>📚 Lo que subas será la fuente prioritaria que UroSearch use para responder.</div>
        <label style={labelStyle}>Título del documento</label>
        <input value={nuevoForm.titulo} onChange={e=>setNuevoForm({...nuevoForm,titulo:e.target.value})} placeholder="Ej: Guía EAU 2024 - Litiasis ureteral" style={inputStyle}/>
        <label style={labelStyle}>Categoría</label>
        <select value={nuevoForm.categoria} onChange={e=>setNuevoForm({...nuevoForm,categoria:e.target.value})} style={inputStyle}>
          {CATEGORIAS_KB.map(c=><option key={c}>{c}</option>)}
        </select>
        <label style={labelStyle}>Libro / Fuente (opcional)</label>
        <input value={nuevoForm.fuente||""} onChange={e=>setNuevoForm({...nuevoForm,fuente:e.target.value})} placeholder="Ej: Campbell-Walsh Urology — para agrupar capítulos" style={inputStyle}/>
        <label style={labelStyle}>Contenido del documento</label>
        <div style={{fontSize:11,color:"var(--texto-ter)",marginBottom:6}}>Sube un archivo (PDF, Word .docx, .txt, .md, máx 10 MB) o pega el texto</div>
        <input ref={fileRef} type="file" accept=".txt,.md,.pdf,.docx" onChange={handleFile} style={{display:"none"}}/>
        <button onClick={()=>fileRef.current?.click()} style={{width:"100%",padding:"10px",fontSize:13,background:"var(--superficie)",color:"var(--primario)",border:"1px dashed var(--primario)",borderRadius:8,cursor:"pointer",marginBottom:8,textAlign:"left"}}>📎 Subir archivo (PDF · Word · TXT)</button>
        <textarea value={nuevoForm.contenido} onChange={e=>setNuevoForm({...nuevoForm,contenido:e.target.value})} placeholder="Pega aquí el contenido..." rows={10} style={{...inputStyle,resize:"vertical"}}/>
        <div style={{fontSize:11,color:"var(--texto-ter)",marginTop:-6,marginBottom:10,textAlign:"right"}}>{nuevoForm.contenido.length.toLocaleString()} caracteres</div>
        <label style={labelStyle}>Palabras clave / tags (opcional)</label>
        <input value={nuevoForm.tags} onChange={e=>setNuevoForm({...nuevoForm,tags:e.target.value})} placeholder="Separadas por coma" style={inputStyle}/>
        {errorForm && <div style={{fontSize:12,color: errorForm.includes("Procesando")?"var(--exito)":"var(--peligro)",background: errorForm.includes("Procesando")?"var(--exito-bg)":"var(--peligro-bg)",padding:"8px 10px",borderRadius:6,marginBottom:8}}>{errorForm}</div>}
        <button onClick={guardar} style={{...btnPrimary, marginTop:0}}>Guardar documento</button>
      </div>
    );
  }

  if (vista === "ver" && seleccionado) {
    return (
      <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
        <button onClick={()=>{setVista("lista");setSeleccionado(null);}} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:13,cursor:"pointer",marginBottom:12,padding:0}}>← Volver</button>
        <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"14px",marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:500,color:"var(--primario)",marginBottom:4}}>{seleccionado.categoria}</div>
          <div style={{fontSize:16,fontWeight:600,color:"var(--texto)",marginBottom:6}}>{seleccionado.titulo}</div>
          <div style={{fontSize:11,color:"var(--texto-ter)",marginBottom:8}}>Agregado: {seleccionado.fecha_creacion} · {(seleccionado.caracteres ?? seleccionado.contenido?.length ?? 0).toLocaleString()} caracteres</div>
          {isAdmin && <button onClick={()=>eliminar(seleccionado.id)} style={{padding:"5px 10px",fontSize:11,background:"var(--superficie)",color:"var(--peligro)",border:"0.5px solid var(--peligro-borde)",borderRadius:6,cursor:"pointer"}}>Eliminar</button>}
        </div>
        <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"14px",fontSize:13,color:"var(--texto)",lineHeight:1.6,whiteSpace:"pre-wrap"}}>{(seleccionado.contenido || "(Sin contenido)").slice(0,20000)}{(seleccionado.contenido||"").length>20000 ? `\n\n[...] Mostrando los primeros 20.000 de ${(seleccionado.contenido||"").length.toLocaleString()} caracteres. El texto completo está guardado y disponible para el chat.` : ""}</div>
      </div>
    );
  }

  return (
    <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,gap:10}}>
        <div>
          <div style={{fontSize:15,fontWeight:600,color:"var(--texto)",marginBottom:2}}>📚 Base de conocimiento</div>
          <div style={{fontSize:11,color:"var(--texto-sec)"}}>{conocimiento.length} documentos</div>
        </div>
        {isAdmin && <button onClick={()=>setVista("nuevo")} style={{padding:"7px 12px",fontSize:12,fontWeight:500,background:"var(--primario)",color:"var(--texto-inv)",border:"none",borderRadius:8,cursor:"pointer",whiteSpace:"nowrap"}}>+ Agregar</button>}
      </div>
      <input value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="Buscar..." style={{...inputStyle, marginBottom:8}}/>
      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:14}}>
        {["Todas",...CATEGORIAS_KB].map(c => (
          <button key={c} onClick={()=>setFiltroCat(c)} style={{padding:"4px 10px",fontSize:11,fontWeight:filtroCat===c?500:400,borderRadius:14,cursor:"pointer",border:filtroCat===c?"none":"0.5px solid var(--borde)",background:filtroCat===c?"var(--primario)":"var(--superficie)",color:filtroCat===c?"var(--texto-inv)":"var(--texto-sec)"}}>{c}</button>
        ))}
      </div>
      {filtrados.length === 0 ? (
        <div style={{textAlign:"center",padding:"40px 20px",color:"var(--texto-ter)",fontSize:13,lineHeight:1.6}}>{conocimiento.length === 0 ? (isAdmin ? "Aún no has agregado documentos." : "El administrador aún no ha cargado documentos.") : "Ningún documento coincide"}</div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {filtrados.map(d => (
            <div key={d.id} onClick={()=>{setSeleccionado(d); setVista("ver");}} style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"12px 14px",cursor:"pointer"}}>
              <div style={{fontSize:11,fontWeight:500,color:"var(--primario)",marginBottom:3}}>{d.categoria}{d.fuente ? <span style={{marginLeft:6,fontSize:10,background:"var(--ccv-bg)",color:"var(--ccv)",padding:"1px 7px",borderRadius:8,fontWeight:600}}>📖 {d.fuente}</span> : null}</div>
              <div style={{fontSize:14,fontWeight:500,color:"var(--texto)",marginBottom:4}}>{d.titulo}</div>
              <div style={{fontSize:11,color:"var(--texto-ter)",marginBottom:6}}>{new Date(d.fecha_creacion).toLocaleDateString("es-CL")} · {d.contenido?.length?.toLocaleString() || 0} caracteres</div>
              <div style={{fontSize:12,color:"var(--texto-sec)",lineHeight:1.4}}>{(d.contenido||"").slice(0,150)}{(d.contenido||"").length>150?"...":""}</div>
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
        <div style={{fontSize:12,fontWeight:600,color,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.3px"}}>{titulo}</div>
        <ul style={{margin:0,paddingLeft:18,fontSize:13,color:"var(--texto)",lineHeight:1.6}}>
          {items.map((it,i) => <li key={i} style={{marginBottom:3}}>{it}</li>)}
        </ul>
      </div>
    );
    return (
      <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
        <button onClick={()=>setSeleccionado(null)} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:13,cursor:"pointer",marginBottom:12,padding:0}}>← Volver a cirugías</button>
        <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"16px",marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:500,color:"var(--primario)",marginBottom:4}}>{seleccionado.categoria}</div>
          <div style={{fontSize:18,fontWeight:600,color:"var(--texto)",marginBottom:8}}>{seleccionado.titulo}</div>
          <div style={{fontSize:13,color:"var(--texto-sec)",lineHeight:1.5,marginBottom:10}}>{seleccionado.descripcion}</div>
          <div style={{display:"flex",gap:14,fontSize:11,color:"var(--texto-ter)",paddingTop:8,borderTop:"0.5px solid var(--fondo)"}}>
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
      <div style={{marginBottom:14}}>
        <div style={{fontSize:22,fontWeight:700,color:"var(--texto)",marginBottom:2}}>🔪 Protocolos quirúrgicos</div>
        <div style={{fontSize:13,color:"var(--texto-sec)"}}>{PROTOCOLOS_CIRUGIAS.length} procedimientos urológicos estándar</div>
      </div>
      <input value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="Buscar cirugía..." style={{...inputStyle, marginBottom:8}}/>
      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:14}}>
        {CATEGORIAS_CIRUGIAS.map(c => (
          <button key={c} onClick={()=>setFiltro(c)} style={{padding:"4px 10px",fontSize:11,fontWeight:filtro===c?500:400,borderRadius:14,cursor:"pointer",border:filtro===c?"none":"0.5px solid var(--borde)",background:filtro===c?"var(--primario)":"var(--superficie)",color:filtro===c?"var(--texto-inv)":"var(--texto-sec)"}}>{c}</button>
        ))}
      </div>
      {filtrados.length === 0 ? (
        <div style={{textAlign:"center",padding:"40px 20px",color:"var(--texto-ter)",fontSize:13}}>Ningún procedimiento coincide</div>
      ) : (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:10}}>
          {filtrados.map(p => (
            <div key={p.id} onClick={()=>setSeleccionado(p)} style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"12px 14px",cursor:"pointer",borderLeft:"3px solid var(--primario)"}}>
              <div style={{fontSize:10,fontWeight:500,color:"var(--primario)",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.3px"}}>{p.categoria}</div>
              <div style={{fontSize:14,fontWeight:500,color:"var(--texto)",marginBottom:6}}>{p.titulo}</div>
              <div style={{fontSize:11,color:"var(--texto-sec)",lineHeight:1.4,marginBottom:8,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{p.descripcion}</div>
              <div style={{display:"flex",gap:8,fontSize:10,color:"var(--texto-ter)"}}>
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

function ConocimientoHub({ conocimiento, setConocimiento, isAdmin, currentUser, videos, setVideos, setPlayingVideo, mapaTema, setMapaTema, mapaActual, setMapaActual, mapaLoading, generarMapa, topicOpen, setTopicOpen, mapasGuardados, onGuardarMapa, onEliminarMapa, onCargarMapaGuardado, guardandoMapa }) {
  const [subTab, setSubTab] = useState("cirugias");
 const tabsConocimiento = [["cirugias","🔪 Cirugías"],["videos","📚 Videos"],["preguntas","❓ Preguntas"]];
  if (isAdmin) tabsConocimiento.push(["documentos","📄 Documentos"]);

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0}}>
      <div style={{display:"flex",gap:0,background:"var(--fondo-suave)",borderBottom:"0.5px solid var(--borde)",padding:"0 12px",overflowX:"auto"}}>
        {tabsConocimiento.map(([id,label]) => (
          <button key={id} onClick={()=>setSubTab(id)} style={{padding:"13px 18px",fontSize:14,fontWeight:subTab===id?600:500,background:"transparent",border:"none",borderBottom:subTab===id?"3px solid var(--primario)":"3px solid transparent",color:subTab===id?"var(--primario)":"var(--texto-sec)",cursor:"pointer",whiteSpace:"nowrap"}}>{label}</button>
        ))}
      </div>

      {subTab === "mapas" && (
  <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
    {/* MAPAS PRECARGADOS */}
    <div style={{marginBottom:16}}>
      <div style={{fontSize:13,fontWeight:500,color:"var(--texto-sec)",marginBottom:10}}>Mapas precargados</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8}}>
        {TOPICS.map(t => (
          <div key={t.id}>
            <button onClick={() => setTopicOpen(topicOpen===t.id ? null : t.id)} style={{width:"100%",padding:"8px 10px",fontSize:12,fontWeight:500,textAlign:"left",background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:8,color:"var(--texto)",cursor:"pointer",borderBottomLeftRadius:topicOpen===t.id ? 0 : 8,borderBottomRightRadius:topicOpen===t.id ? 0 : 8}}>{t.label} {topicOpen===t.id ? "▲" : "▼"}</button>
            {topicOpen===t.id && (
              <div style={{border:"0.5px solid var(--borde)",borderTop:"none",borderRadius:"0 0 8px 8px",overflow:"hidden",background:"var(--superficie)"}}>
                {t.subtopics.map(s => <button key={s} onClick={() => { generarMapa(s); setTopicOpen(null); }} style={{display:"block",width:"100%",padding:"7px 12px",fontSize:12,textAlign:"left",background:"var(--superficie)",border:"none",borderTop:"0.5px solid var(--fondo)",color:"var(--texto-sec)",cursor:"pointer"}}>{s}</button>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>

    {/* GENERAR MAPA CON IA */}
    <div style={{marginBottom:16}}>
      <div style={{fontSize:13,fontWeight:500,color:"var(--texto-sec)",marginBottom:8}}>Generar mapa con IA</div>
      <div style={{display:"flex",gap:8}}>
        <input value={mapaTema} onChange={e=>setMapaTema(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")generarMapa(mapaTema);}} placeholder="Ej: Hematuria macroscópica..." style={{flex:1,padding:"9px 12px",fontSize:13,borderRadius:8,border:"0.5px solid var(--borde)",background:"var(--superficie)",color:"var(--texto)",outline:"none"}}/>
        <button onClick={()=>generarMapa(mapaTema)} disabled={mapaLoading||!mapaTema.trim()} style={{padding:"9px 14px",borderRadius:8,border:"none",background:mapaLoading||!mapaTema.trim()?"var(--borde)":"var(--primario)",color:"var(--texto-inv)",fontSize:13,cursor:mapaLoading||!mapaTema.trim()?"default":"pointer",fontWeight:500}}>{mapaLoading ? "Generando..." : "Generar ↗"}</button>
      </div>
    </div>

    {mapaLoading && <div style={{textAlign:"center",padding:"40px 0",color:"var(--texto-ter)",fontSize:13}}>Generando mapa...</div>}

    {/* MAPA ACTUAL CON BOTÓN DE GUARDAR */}
    {mapaActual && !mapaLoading && (
      <div style={{border:"0.5px solid var(--borde)",borderRadius:12,overflow:"hidden",background:"var(--superficie)",marginBottom:16}}>
        <div style={{padding:"10px 14px",borderBottom:"0.5px solid var(--borde)",display:"flex",justifyContent:"space-between",alignItems:"center",background:"var(--fondo-suave)",gap:10}}>
          <div style={{fontSize:13,fontWeight:500,color:"var(--texto)"}}>{mapaActual.titulo}</div>
          <button 
            onClick={onGuardarMapa} 
            disabled={guardandoMapa}
            style={{
              padding:"5px 12px",
              fontSize:11,
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

    {!mapaActual && !mapaLoading && <div style={{textAlign:"center",padding:"32px 0",color:"var(--texto-ter)",fontSize:13}}>Selecciona un tema o escribe uno</div>}

    {/* MIS MAPAS GUARDADOS */}
    {mapasGuardados && mapasGuardados.length > 0 && (
      <div style={{marginTop:24, paddingTop:16, borderTop:"0.5px solid var(--borde)"}}>
        <div style={{fontSize:13,fontWeight:500,color:"var(--texto-sec)",marginBottom:10}}>
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
                <div style={{fontSize:12,fontWeight:500,color:"var(--texto)",marginBottom:3, lineHeight:1.3}}>
                  {mapa.titulo}
                </div>
                <div style={{fontSize:10,color:"var(--texto-ter)"}}>
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
                  fontSize:13,
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
          return <button key={op} onClick={()=>onChange(sel ? "" : op)} style={{padding:"5px 10px",fontSize:11,fontWeight:sel?500:400,borderRadius:14,cursor:"pointer",border:sel?"none":"0.5px solid var(--borde)",background:sel?"var(--primario)":"var(--superficie)",color:sel?"var(--texto-inv)":"var(--texto-sec)"}}>{op}</button>;
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
        <button onClick={()=>{setVista("lista");setError("");}} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:13,cursor:"pointer",marginBottom:12,padding:0}}>← Volver</button>
        <div style={{fontSize:16,fontWeight:600,color:"var(--texto)",marginBottom:14}}>Crear nuevo equipo</div>
        <label style={labelStyle}>Nombre del equipo</label>
        <input value={nuevoNombre} onChange={e=>setNuevoNombre(e.target.value)} placeholder="Ej: Equipo Urología HBV" style={inputStyle} disabled={loading}/>
        <label style={labelStyle}>Descripción (opcional)</label>
        <textarea value={nuevoDescripcion} onChange={e=>setNuevoDescripcion(e.target.value)} placeholder="Para qué se usará este equipo" rows={3} style={{...inputStyle,resize:"none"}} disabled={loading}/>
        {error && <div style={{fontSize:12,color:"var(--peligro)",background:"var(--peligro-bg)",padding:"8px 10px",borderRadius:6,marginBottom:8}}>{error}</div>}
        <button onClick={crearEquipoHandler} disabled={loading} style={{...btnPrimary, marginTop:0, opacity: loading ? 0.6 : 1}}>{loading ? "Creando..." : "Crear equipo"}</button>
      </div>
    );
  }

  // VISTA: DETALLE
  if (vista === "detalle" && seleccionado) {
    const esDueño = seleccionado.dueno_id === currentUser.id;
    return (
      <div style={{padding:"20px",overflowY:"auto"}}>
        <button onClick={()=>{setVista("lista");setSeleccionado(null);setError("");}} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:13,cursor:"pointer",marginBottom:12,padding:0}}>← Volver a equipos</button>
        <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"14px",marginBottom:14}}>
          <div style={{fontSize:16,fontWeight:600,color:"var(--texto)",marginBottom:4}}>{seleccionado.nombre}</div>
          {seleccionado.descripcion && <div style={{fontSize:12,color:"var(--texto-sec)",marginBottom:6}}>{seleccionado.descripcion}</div>}
          <div style={{fontSize:11,color:"var(--texto-ter)"}}>{miembros.length} miembros</div>
        </div>

        <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"14px",marginBottom:14}}>
          <div style={{fontSize:13,fontWeight:600,color:"var(--texto)",marginBottom:10}}>👥 Miembros</div>
          {miembros.map(m => {
            const perfil = m.perfiles;
            return (
              <div key={m.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 10px",background:"var(--fondo-suave)",borderRadius:6,marginBottom:5}}>
                <div>
                  <div style={{fontSize:12,fontWeight:500,color:"var(--texto)"}}>
                    {perfil?.nombre || "Sin nombre"}
                    {m.user_id === seleccionado.dueno_id && <span style={{fontSize:9,marginLeft:6,padding:"1px 6px",background:"var(--primario)",color:"var(--texto-inv)",borderRadius:4}}>DUEÑO</span>}
                    {m.user_id === currentUser.id && <span style={{fontSize:9,marginLeft:6,padding:"1px 6px",background:"var(--exito)",color:"var(--texto-inv)",borderRadius:4}}>TÚ</span>}
                  </div>
                  <div style={{fontSize:10,color:"var(--texto-ter)"}}>{perfil?.correo}</div>
                </div>
                {esDueño && m.user_id !== currentUser.id && (
                  <button onClick={()=>expulsar(m.user_id)} style={{padding:"4px 10px",fontSize:11,background:"var(--superficie)",color:"var(--peligro)",border:"0.5px solid var(--peligro-borde)",borderRadius:6,cursor:"pointer"}}>Expulsar</button>
                )}
              </div>
            );
          })}
        </div>

        {esDueño && (
          <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"14px",marginBottom:14}}>
            <div style={{fontSize:13,fontWeight:600,color:"var(--texto)",marginBottom:10}}>+ Invitar miembro</div>
            <div style={{fontSize:11,color:"var(--texto-ter)",marginBottom:6}}>Solo puedes invitar usuarios ya aprobados en UroSearch</div>
            <div style={{display:"flex",gap:6}}>
              <input value={invitarCorreo} onChange={e=>setInvitarCorreo(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")invitar();}} placeholder="correo del usuario" style={{flex:1,padding:"9px 12px",fontSize:13,borderRadius:8,border:"0.5px solid var(--borde)",outline:"none"}} disabled={loading}/>
              <button onClick={invitar} disabled={!invitarCorreo.trim() || loading} style={{padding:"9px 14px",fontSize:13,fontWeight:500,background:invitarCorreo.trim() && !loading ?"var(--primario)":"var(--borde)",color:"var(--texto-inv)",border:"none",borderRadius:8,cursor:"pointer"}}>{loading ? "..." : "Invitar"}</button>
            </div>
            {error && <div style={{fontSize:12,color:"var(--peligro)",background:"var(--peligro-bg)",padding:"8px 10px",borderRadius:6,marginTop:8}}>{error}</div>}

            {invitacionesEquipo.length > 0 && (
              <div style={{marginTop:12}}>
                <div style={{fontSize:11,fontWeight:500,color:"var(--texto-ter)",marginBottom:4}}>Invitaciones pendientes</div>
                {invitacionesEquipo.map(i => (
                  <div key={i.id} style={{padding:"6px 10px",background:"var(--alerta-bg)",borderRadius:6,fontSize:11,color:"var(--alerta)",marginBottom:4}}>
                    📨 {i.perfiles?.nombre} ({i.perfiles?.correo})
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{display:"flex",gap:6}}>
          {esDueño ? (
            <button onClick={()=>eliminarEquipoHandler(seleccionado)} style={{flex:1,padding:"10px",fontSize:13,background:"var(--superficie)",color:"var(--peligro)",border:"1px solid var(--peligro)",borderRadius:8,cursor:"pointer",fontWeight:500}}>🗑 Eliminar equipo</button>
          ) : (
            <button onClick={()=>salir(seleccionado)} style={{flex:1,padding:"10px",fontSize:13,background:"var(--superficie)",color:"var(--peligro)",border:"1px solid var(--peligro)",borderRadius:8,cursor:"pointer",fontWeight:500}}>Salir del equipo</button>
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
          <div style={{fontSize:12,fontWeight:500,color:"var(--alerta)",marginBottom:6}}>📨 Invitaciones pendientes ({invitacionesPendientes.length})</div>
          {invitacionesPendientes.map(inv => (
            <div key={inv.id} style={{background:"var(--alerta-bg)",border:"0.5px solid var(--alerta-borde)",borderRadius:8,padding:"10px 12px",marginBottom:6}}>
              <div style={{fontSize:13,fontWeight:500,color:"var(--alerta)",marginBottom:2}}>{inv.equipos?.nombre}</div>
              <div style={{fontSize:11,color:"var(--alerta)",marginBottom:8}}>Invitado por {inv.invitador?.nombre}</div>
              <div style={{display:"flex",gap:6}}>
                <button onClick={()=>aceptar(inv)} style={{flex:1,padding:"6px",fontSize:12,background:"var(--exito)",color:"var(--texto-inv)",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>✓ Aceptar</button>
                <button onClick={()=>rechazar(inv)} style={{flex:1,padding:"6px",fontSize:12,background:"var(--superficie)",color:"var(--peligro)",border:"0.5px solid var(--peligro)",borderRadius:6,cursor:"pointer",fontWeight:500}}>Rechazar</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <button onClick={()=>setVista("nuevo")} style={{...btnPrimary, marginTop:0, marginBottom:14}}>+ Crear nuevo equipo</button>

      {equipos.length === 0 ? (
        <div style={{textAlign:"center",padding:"30px 20px",color:"var(--texto-ter)",fontSize:13,lineHeight:1.6}}>No perteneces a ningún equipo.<br/>Crea uno o espera invitación.</div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {equipos.map(eq => (
            <div key={eq.id} onClick={()=>abrirDetalle(eq)} style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"12px 14px",cursor:"pointer"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4,gap:10}}>
                <div style={{fontSize:14,fontWeight:500,color:"var(--texto)"}}>{eq.nombre}</div>
                {eq.dueno_id === currentUser.id && <span style={{fontSize:9,padding:"1px 6px",background:"var(--primario)",color:"var(--texto-inv)",borderRadius:4,fontWeight:500}}>DUEÑO</span>}
              </div>
              {eq.descripcion && <div style={{fontSize:11,color:"var(--texto-sec)",marginBottom:4}}>{eq.descripcion}</div>}
              <div style={{fontSize:10,color:"var(--texto-ter)"}}>{eq.miembros_equipo?.length || 0} miembros</div>
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
      <button onClick={()=>setAbierto(!abierto)} title="Cambiar contexto (equipos / mis pacientes)" style={{padding:"5px 10px",fontSize:12,fontWeight:600,borderRadius:14,cursor:"pointer",border:"none",background:actual.color,color:"var(--texto-inv)",display:"flex",alignItems:"center",gap:5,maxWidth:150,whiteSpace:"nowrap",overflow:"hidden"}}>
        <span>{actual.icono}</span><span style={{overflow:"hidden",textOverflow:"ellipsis"}}>{actual.nombre}</span> <span style={{fontSize:10}}>▾</span>
      </button>
      {abierto && (
        <>
          <div onClick={()=>setAbierto(false)} style={{position:"fixed",inset:0,zIndex:20}}/>
          <div style={{position:"absolute",top:"115%",right:0,background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:8,padding:"4px",minWidth:210,zIndex:30,boxShadow:"0 2px 8px rgba(0,0,0,0.12)"}}>
            <div onClick={()=>elegir("personal")} style={{padding:"8px 10px",fontSize:13,cursor:"pointer",borderRadius:6,background:contexto==="personal"?"var(--fondo-suave)":"transparent",color:"var(--texto)",display:"flex",alignItems:"center",gap:8}}>
              <span>👤</span> Mis Pacientes {contexto==="personal" && <span style={{marginLeft:"auto",color:"var(--primario)"}}>✓</span>}
            </div>
            {misEquipos.map(eq => (
              <div key={eq.id} onClick={()=>elegir(eq.id)} style={{padding:"8px 10px",fontSize:13,cursor:"pointer",borderRadius:6,background:contexto===eq.id?"var(--fondo-suave)":"transparent",color:"var(--texto)",display:"flex",alignItems:"center",gap:8}}>
                <span>👥</span> {eq.nombre} {contexto===eq.id && <span style={{marginLeft:"auto",color:"var(--exito)"}}>✓</span>}
              </div>
            ))}
            <div onClick={()=>{ setAbierto(false); onAbrirEquipos(); }} style={{padding:"8px 10px",fontSize:13,cursor:"pointer",borderRadius:6,color:"var(--primario)",borderTop:"0.5px solid var(--fondo)",marginTop:4,display:"flex",alignItems:"center",gap:8}}>
              <span>⚙️</span> Gestionar / crear equipo
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function HospitalPanel({ pacientes, setPacientes, currentUser, tablaCirugias, setTablaCirugias, misServiciosLista, setMisServiciosLista, loadingPacientes, setLoadingPacientes, loadingCirugias, setLoadingCirugias, loadingPendientes, setLoadingPendientes, pendientes, setPendientes, equipos, setEquipos, invitacionesPendientes, setInvitacionesPendientes, users }) {
  const [subTab, setSubTab] = useState(() => {
    try {
      const guardada = localStorage.getItem("uro_subtab_hospital");
      return (guardada && guardada !== "pendientes") ? guardada : "pacientes";
    }
    catch { return "pacientes"; }
  });
  const [contexto, setContexto] = useState(() => {
    try { return localStorage.getItem("uro_contexto") || "personal"; }
    catch { return "personal"; }
  });
  const [mostrarEquipos, setMostrarEquipos] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false); // submenú de herramientas (2do toque en la pestaña)

  useEffect(() => {
    try { localStorage.setItem("uro_subtab_hospital", subTab); } catch {}
  }, [subTab]);

  useEffect(() => {
    try { localStorage.setItem("uro_contexto", contexto); } catch {}
  }, [contexto]);

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
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0}}>
      <div style={{display:"flex",alignItems:"flex-end",background:"var(--fondo-suave)",borderBottom:"0.5px solid var(--borde)",padding:"4px 10px 0",flexShrink:0}}>
        <div style={{display:"flex",gap:0,overflowX:"auto",flex:1,minWidth:0}}>
          {[["pacientes","👥 Pacientes"],["tabla","📋 Tabla"],["notas","🗒️ Notas"]].map(([id,label]) => {
            const activo = subTab===id;
            const conTools = id==="pacientes" || id==="tabla";
            return (
              <button key={id} onClick={()=>{ if(activo && conTools){ setToolsOpen(o=>!o); } else { setSubTab(id); setToolsOpen(false); } }} style={{padding:"13px 14px",fontSize:14,fontWeight:activo?600:500,background:"transparent",border:"none",borderBottom:activo?"3px solid var(--primario)":"3px solid transparent",color:activo?"var(--primario)":"var(--texto-sec)",cursor:"pointer",whiteSpace:"nowrap"}} title={conTools?"Toca de nuevo para ver opciones":undefined}>
                {label}{activo && conTools ? (toolsOpen ? " ▴" : " ▾") : ""}
              </button>
            );
          })}
        </div>
        <SelectorContexto contexto={contexto} setContexto={setContexto} equipos={equipos} currentUser={currentUser} onAbrirEquipos={()=>setMostrarEquipos(true)}/>
      </div>
      {subTab === "pacientes" && <PacientesPanel pacientes={pacientes} setPacientes={setPacientes} currentUser={currentUser} contexto={contexto} equipos={equipos} misServiciosLista={misServiciosLista} setMisServiciosLista={setMisServiciosLista} loadingPacientes={loadingPacientes} setLoadingPacientes={setLoadingPacientes} pendientes={pendientes} setPendientes={setPendientes} toolsOpen={toolsOpen} soloLectura={soloLectura}/>}
      {subTab === "tabla" && <TablaQuirurgicaPanel tablaCirugias={tablaCirugias} setTablaCirugias={setTablaCirugias} currentUser={currentUser} contexto={contexto} equipos={equipos} loadingCirugias={loadingCirugias} setLoadingCirugias={setLoadingCirugias} setPacientes={setPacientes} toolsOpen={toolsOpen} soloLectura={soloLectura}/>}
      {subTab === "notas" && <NotasPanel currentUser={currentUser} contexto={contexto} equipos={equipos}/>}
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
            <span key={id} style={{fontSize:11,background:"var(--exito-bg)",color:"var(--exito)",padding:"3px 9px",borderRadius:10,fontWeight:600}}>👤 {nombreMiembro(id)}</span>
          )
        ))}
        <button onClick={()=>setAbierto(!abierto)} style={{fontSize:14,background:"var(--fondo-suave)",color:"var(--primario)",border:"0.5px solid var(--borde)",borderRadius:"50%",width:24,height:24,cursor:"pointer",fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1,padding:0}}>
          {abierto ? "×" : "+"}
        </button>
      </div>
      {abierto && (
        <div style={{marginTop:4,background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:6,padding:"4px",maxHeight:140,overflowY:"auto"}}>
          {miembros.map(m => {
            const id = m.perfiles?.id;
            const asignado = encargados.includes(id);
            return (
              <div key={id} onClick={()=>onToggle(pendiente, id)} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 5px",cursor:"pointer",fontSize:12,color:"var(--texto)"}}>
                <span style={{width:15,height:15,borderRadius:3,border:"1px solid var(--borde)",background:asignado?"var(--exito)":"var(--superficie)",color:"var(--texto-inv)",fontSize:11,display:"flex",alignItems:"center",justifyContent:"center"}}>{asignado?"✓":""}</span>
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
  const [nueva, setNueva] = useState({ titulo: "", texto: "", visibilidad: esEquipo ? "equipo" : "personal" });

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
      <div style={{fontSize:16,fontWeight:600,color:"var(--texto)",marginBottom:14}}>
        {esEquipo ? `🗒️ Notas - ${equipoActual?.nombre}` : "🗒️ Mis notas"}
      </div>

      <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"12px",marginBottom:14}}>
        <input value={nueva.titulo} onChange={e=>setNueva({...nueva,titulo:e.target.value})} placeholder="Título (opcional)" style={{...inputStyle,marginBottom:6}}/>
        <textarea value={nueva.texto} onChange={e=>setNueva({...nueva,texto:e.target.value})} placeholder="Escribe una nota libre..." rows={3} style={{...inputStyle,resize:"vertical",marginBottom:6}}/>
        {esEquipo && (
          <div style={{display:"flex",gap:6,marginBottom:8}}>
            <button onClick={()=>setNueva({...nueva,visibilidad:"equipo"})} style={{flex:1,padding:"7px",fontSize:12,borderRadius:8,cursor:"pointer",fontWeight:nueva.visibilidad==="equipo"?600:400,background:nueva.visibilidad==="equipo"?"var(--primario)":"var(--superficie)",color:nueva.visibilidad==="equipo"?"var(--texto-inv)":"var(--texto-sec)",border:nueva.visibilidad==="equipo"?"none":"0.5px solid var(--borde)"}}>👥 La ve el equipo</button>
            <button onClick={()=>setNueva({...nueva,visibilidad:"personal"})} style={{flex:1,padding:"7px",fontSize:12,borderRadius:8,cursor:"pointer",fontWeight:nueva.visibilidad==="personal"?600:400,background:nueva.visibilidad==="personal"?"var(--primario)":"var(--superficie)",color:nueva.visibilidad==="personal"?"var(--texto-inv)":"var(--texto-sec)",border:nueva.visibilidad==="personal"?"none":"0.5px solid var(--borde)"}}>🔒 Solo yo</button>
          </div>
        )}
        <button onClick={guardar} disabled={!nueva.texto.trim()} style={{...btnPrimary,marginTop:0,opacity:nueva.texto.trim()?1:0.6}}>+ Guardar nota</button>
      </div>

      {cargando && <div style={{fontSize:12,color:"var(--texto-ter)",fontStyle:"italic"}}>Cargando...</div>}
      {!cargando && notas.length === 0 && <div style={{fontSize:12,color:"var(--texto-ter)",fontStyle:"italic",padding:"14px 0"}}>No hay notas aún.</div>}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {notas.map(n => (
          <div key={n.id} style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:8,padding:"11px 13px",borderLeft:n.visibilidad==="personal"?"3px solid var(--alerta)":"3px solid var(--primario)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
              <div style={{flex:1,minWidth:0}}>
                {n.titulo && <div style={{fontSize:13,fontWeight:600,color:"var(--texto)",marginBottom:3}}>{n.titulo}</div>}
                <div style={{fontSize:12,color:"var(--texto)",whiteSpace:"pre-wrap",lineHeight:1.45}}>{n.texto}</div>
                <div style={{fontSize:10,color:"var(--texto-ter)",marginTop:5}}>
                  {n.visibilidad==="personal"?"🔒 Solo yo":"👥 Equipo"} · {n.autor?.nombre || "—"} · {new Date(n.created_at).toLocaleDateString("es-CL",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}
                </div>
              </div>
              {n.autor_id === currentUser.id && (
                <button onClick={()=>eliminar(n)} style={{background:"none",border:"none",color:"var(--peligro)",cursor:"pointer",fontSize:12,padding:0}}>🗑</button>
              )}
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
      crearNotificacion(userId, `Te asignaron un pendiente: "${pendiente.texto.slice(0,80)}"${pendiente.fecha_objetivo ? ` (para el ${pendiente.fecha_objetivo})` : ""}`, "pendiente");
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
          <div style={{fontSize:10,color:"var(--texto-ter)",marginBottom:4}}>Sugerencias rápidas:</div>
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            {sugerencias.map(s => (
              <button key={s} onClick={()=>usarSugerencia(s)} style={{padding:"3px 8px",fontSize:10,background:"var(--fondo-suave)",border:"0.5px solid var(--borde)",color:"var(--texto-sec)",borderRadius:12,cursor:"pointer"}}>{s}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
        <span style={{fontSize:11,color:"var(--texto-ter)"}}>Filtrar:</span>
        <select value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)} style={{padding:"5px 10px",fontSize:11,borderRadius:6,border:"0.5px solid var(--borde)",background:"var(--superficie)",color:"var(--texto)",cursor:"pointer"}}>
          <option value="pendiente">Pendientes</option>
          <option value="completado">Completados</option>
          <option value="todos">Todos</option>
        </select>
        <select value={filtroPrioridad} onChange={e=>setFiltroPrioridad(e.target.value)} style={{padding:"5px 10px",fontSize:11,borderRadius:6,border:"0.5px solid var(--borde)",background:"var(--superficie)",color:"var(--texto)",cursor:"pointer"}}>
          <option value="todas">Todas las prioridades</option>
          <option value="alta">🔴 Alta</option>
          <option value="normal">🟡 Normal</option>
          <option value="baja">🟢 Baja</option>
        </select>
        <span style={{fontSize:11,color:"var(--texto-ter)",marginLeft:"auto"}}>{filtrados.length}</span>
      </div>

      {loadingPendientes && (
        <div style={{textAlign:"center",padding:"20px",color:"var(--texto-ter)",fontSize:13}}>Cargando...</div>
      )}

      {!loadingPendientes && filtrados.length === 0 && (
        <div style={{textAlign:"center",padding:"40px 20px",color:"var(--texto-ter)",fontSize:13}}>
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
                    <div style={{fontSize:13,color:"var(--texto)",textDecoration:completado?"line-through":"none",lineHeight:1.4,whiteSpace:"pre-wrap"}}>{p.texto}</div>
                    <div style={{fontSize:10,color:"var(--texto-ter)",marginTop:4,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                      <span>{p.autor?.nombre || "Anónimo"}</span>
                      {p.fecha_objetivo && <span>📅 {p.fecha_objetivo}</span>}
                      <span style={{color:colorPrioridad,fontWeight:500}}>● {p.prioridad}</span>
                    </div>
                    {esEquipo && (
                      <EncargadosPendiente pendiente={p} miembros={miembrosEquipo} onToggle={toggleEncargadoPendiente} nombreMiembro={nombreMiembro} />
                    )}
                  </div>
                  {esAutor && (
                    <button onClick={()=>eliminar(p)} style={{background:"none",border:"none",color:"var(--peligro)",cursor:"pointer",fontSize:13,padding:0}}>🗑</button>
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
      <div style={{fontSize:12,color:"var(--texto-sec)",marginBottom:16,lineHeight:1.5}}>Antes de empezar, dime qué servicios o pisos del hospital quieres tener disponibles para asignar a tus pacientes. Puedes modificar esto después.</div>

      <div style={{fontSize:12,fontWeight:500,color:"var(--texto-sec)",marginBottom:8}}>Sugerencias (toca para seleccionar):</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:18}}>
        {todos.map(s => {
          const sel = seleccionados.includes(s);
          return (
            <button key={s} onClick={()=>toggle(s)} style={{padding:"6px 12px",fontSize:12,fontWeight:sel?500:400,borderRadius:14,cursor:"pointer",border:sel?"none":"0.5px solid var(--borde)",background:sel?"var(--primario)":"var(--superficie)",color:sel?"var(--texto-inv)":"var(--texto-sec)"}}>
              {sel ? "✓ " : ""}{s}
            </button>
          );
        })}
      </div>

      <div style={{fontSize:12,fontWeight:500,color:"var(--texto-sec)",marginBottom:6}}>O agrega uno personalizado:</div>
      <div style={{display:"flex",gap:6,marginBottom:18}}>
        <input value={personalizado} onChange={e=>setPersonalizado(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")agregarPersonalizado();}} placeholder="Ej: Pediatría, 4to piso ala B..." style={{flex:1,padding:"9px 12px",fontSize:13,borderRadius:8,border:"0.5px solid var(--borde)",outline:"none"}}/>
        <button onClick={agregarPersonalizado} disabled={!personalizado.trim()} style={{padding:"9px 14px",fontSize:13,fontWeight:500,background:personalizado.trim()?"var(--primario)":"var(--borde)",color:"var(--texto-inv)",border:"none",borderRadius:8,cursor:personalizado.trim()?"pointer":"default"}}>+ Agregar</button>
      </div>

      <div style={{padding:"10px 12px",background:"var(--fondo-suave)",borderRadius:8,marginBottom:16,fontSize:12,color:"var(--primario-osc)",lineHeight:1.5}}>
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
  const [modoVista, setModoVista] = useState("planner"); // "planner" | "lista"
  const [lunesSemana, setLunesSemana] = useState(() => {
    const d = new Date();
    const dow = (d.getDay() + 6) % 7; // 0 = lunes
    d.setDate(d.getDate() - dow);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const [nuevo, setNuevo] = useState({
    fecha: new Date().toISOString().slice(0,10), hora: "08:00",
    iniciales: "", edad: "", procedimiento: "", lateralidad: "",
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
  const navBtn = { width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, background:"var(--superficie)", color: "var(--primario)", border: "0.5px solid var(--borde)", borderRadius: 6, cursor: "pointer", fontWeight: 600 };
  const toggleOn = { padding: "4px 10px", fontSize: 11, background: "var(--primario)", color:"var(--texto-inv)", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 500 };
  const toggleOff = { padding: "4px 10px", fontSize: 11, background:"var(--superficie)", color: "var(--primario)", border: "0.5px solid var(--borde)", borderRadius: 6, cursor: "pointer", fontWeight: 500 };

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
    setNuevo({ fecha: new Date().toISOString().slice(0,10), hora: "08:00", iniciales: "", edad: "", procedimiento: "", lateralidad: "", cirujano: currentUser.nombre, primer_ayudante: "", pabellon: "5", estado: "programada", observaciones: "" });
  };

  // Cargar una cirugía existente en el formulario para editarla
  const empezarEdicion = (c) => {
    setEditId(c.id);
    setNuevo({
      fecha: c.fecha || new Date().toISOString().slice(0,10),
      hora: (c.hora || "08:00").slice(0,5),
      iniciales: c.iniciales || "",
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

    // Al completar una cirugía → crear automáticamente el paciente hospitalizado
    if (nuevoEstado === "completada") {
      // Avisar al equipo
      if (esEquipo) {
        try {
          const rm = await listarMiembros(contexto);
          if (rm.ok) rm.miembros.forEach(m => {
            const uid = m.perfiles?.id;
            if (uid && uid !== currentUser.id) crearNotificacion(uid, `Cirugía completada: ${cirugia.procedimiento} — ${cirugia.iniciales} (${cirugia.fecha})`, "cirugia");
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
        cama: "Por asignar",
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
        crearNotificacion(uid, `Te asignaron como primer ayudante: ${cirugia.procedimiento} — ${cirugia.iniciales} (${cirugia.fecha} ${cirugia.hora?.slice(0,5)})`, "cirugia");
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
      if (!confirm(`Se importarán ${filas.length} cirugías con nombre completo${resumenCCV}. ¿Continuar?`)) {
        e.target.value = "";
        return;
      }

      const result = await crearCirugiasBulk(filas);
      if (!result.ok) {
        alert("Error al importar: " + result.error);
        return;
      }

      setTablaCirugias(prev => [...prev, ...result.cirugias].sort((a,b) => (a.fecha+a.hora).localeCompare(b.fecha+b.hora)));
      alert(`✓ ${result.cirugias.length} cirugías importadas`);
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
        <button onClick={()=>{resetForm();setVista(editId?"detalle":"tabla");}} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:13,cursor:"pointer",marginBottom:12,padding:0}}>← Volver</button>
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

        {error && <div style={{fontSize:12,color:"var(--peligro)",background:"var(--peligro-bg)",padding:"8px 10px",borderRadius:6,marginBottom:8}}>{error}</div>}

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
        <button onClick={()=>{setVista("tabla");setSeleccionado(null);}} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:13,cursor:"pointer",marginBottom:10,padding:0}}>← Volver a la tabla</button>

        <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"14px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
            <div>
              <div style={{fontSize:18,fontWeight:600,color:"var(--texto)"}}>{seleccionado.iniciales}{seleccionado.edad && ` (${seleccionado.edad}a)`}</div>
              <div style={{fontSize:13,color:"var(--texto-sec)",marginTop:4}}>{seleccionado.procedimiento}{seleccionado.lateralidad && ` • ${seleccionado.lateralidad}`}</div>
              <div style={{fontSize:11,color:"var(--texto-ter)",marginTop:4}}>📅 {seleccionado.fecha} {seleccionado.hora?.slice(0,5)} | {seleccionado.pabellon==="CCV" ? "CCV (Costanera)" : `Pabellón ${seleccionado.pabellon}`}</div>
              {seleccionado.cirujano && <div style={{fontSize:11,color:"var(--texto-ter)",marginTop:2}}>👨‍⚕️ Cirujano: {seleccionado.cirujano}</div>}
              {seleccionado.primer_ayudante && <div style={{fontSize:11,color:"var(--texto-ter)",marginTop:2}}>🧑‍⚕️ Primer ayudante: {seleccionado.primer_ayudante}</div>}
            </div>
            <button onClick={()=>empezarEdicion(seleccionado)} style={{padding:"5px 12px",fontSize:12,background:"var(--superficie)",color:"var(--primario)",border:"0.5px solid var(--borde)",borderRadius:6,cursor:"pointer",fontWeight:500,whiteSpace:"nowrap"}}>✏️ Editar</button>
          </div>

          <div style={{fontSize:12,color:"var(--texto)",marginBottom:10,padding:"6px 10px",background:"var(--fondo-suave)",borderRadius:6}}>
            <strong>Estado actual:</strong> {seleccionado.estado}
          </div>

          <div style={{marginBottom:10,padding:"8px 10px",background:"var(--fondo-suave)",borderRadius:6}}>
            <div style={{fontSize:11,fontWeight:600,color:"var(--texto)",marginBottom:5}}>🧑‍⚕️ Primer ayudante</div>
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
            <div style={{fontSize:12,color:"var(--texto)",marginBottom:10,padding:"8px 10px",background:"var(--alerta-bg)",borderRadius:6}}>
              <strong>Observaciones:</strong> {seleccionado.observaciones}
            </div>
          )}

          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:14}}>
            {["programada","en_curso","completada","suspendida","cancelada"].map(estado => (
              <button 
                key={estado} 
                onClick={()=>cambiarEstado(seleccionado, estado)}
                disabled={seleccionado.estado === estado}
                style={{padding:"5px 10px",fontSize:11,background:seleccionado.estado === estado ? "var(--primario)" : "var(--superficie)",color:seleccionado.estado === estado ?"var(--texto-inv)":"var(--texto-sec)",border:"0.5px solid var(--borde)",borderRadius:6,cursor:seleccionado.estado === estado ? "default" : "pointer",fontWeight:500}}
              >{estado.replace("_"," ")}</button>
            ))}
          </div>

          {esCirujano && (
            <button onClick={()=>eliminar(seleccionado)} style={{marginTop:14,width:"100%",padding:"10px",fontSize:12,background:"var(--superficie)",color:"var(--peligro)",border:"1px solid var(--peligro)",borderRadius:8,cursor:"pointer",fontWeight:500}}>🗑 Eliminar cirugía</button>
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
          <label style={{padding:"6px 12px",fontSize:12,background:"var(--superficie)",color:"var(--primario)",border:"0.5px solid var(--borde)",borderRadius:6,cursor:"pointer",fontWeight:500}}>
            📊 Importar Excel
            <input type="file" accept=".xlsx,.xls" onChange={importarExcel} style={{display:"none"}}/>
          </label>
          <button onClick={()=>setVista("nuevo")} style={{padding:"6px 12px",fontSize:12,background:"var(--primario)",color:"var(--texto-inv)",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>+ Nueva</button>
          <div style={{display:"flex",gap:4,marginLeft:"auto",alignItems:"center"}}>
            <button onClick={()=>setModoVista("planner")} style={modoVista==="planner"?toggleOn:toggleOff}>📅 Planner</button>
            <button onClick={()=>setModoVista("lista")} style={modoVista==="lista"?toggleOn:toggleOff}>☰ Lista</button>
          </div>
        </div>
      )}

      {/* Navegación de semana + filtro de estado (siempre visible) */}
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
        <div style={{display:"flex",alignItems:"center",gap:4}}>
          <button onClick={()=>{const d=new Date(lunesSemana);d.setDate(d.getDate()-7);setLunesSemana(d);}} style={navBtn}>‹</button>
          <span style={{fontSize:12,fontWeight:600,color:"var(--texto)",minWidth:120,textAlign:"center"}}>
            {new Date(diasSemana[0]+"T00:00:00").toLocaleDateString("es-CL",{day:"numeric",month:"short"})} – {new Date(diasSemana[6]+"T00:00:00").toLocaleDateString("es-CL",{day:"numeric",month:"short"})}
          </span>
          <button onClick={()=>{const d=new Date(lunesSemana);d.setDate(d.getDate()+7);setLunesSemana(d);}} style={navBtn}>›</button>
          <button onClick={()=>setLunesSemana(lunesDe(new Date()))} style={{...navBtn,width:"auto",padding:"0 10px",fontSize:11}}>Hoy</button>
        </div>
        <select value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)} style={{padding:"5px 10px",fontSize:11,borderRadius:6,border:"0.5px solid var(--borde)",background:"var(--superficie)",color:"var(--texto)",cursor:"pointer"}}>
          <option value="todos">Todos los estados</option>
          <option value="programada">Programadas</option>
          <option value="en_curso">En curso</option>
          <option value="completada">Completadas</option>
          <option value="suspendida">Suspendidas</option>
          <option value="cancelada">Canceladas</option>
        </select>
        <span style={{fontSize:11,color:"var(--texto-ter)",marginLeft:"auto"}}>{cirugiasSemana.length} cx</span>
      </div>

      {loadingCirugias && (
        <div style={{textAlign:"center",padding:"30px",color:"var(--texto-ter)",fontSize:13}}>Cargando tabla...</div>
      )}

      {!loadingCirugias && cirugiasSemana.length === 0 && (
        <div style={{textAlign:"center",padding:"30px 20px",color:"var(--texto-ter)",fontSize:13,lineHeight:1.6}}>
          No hay cirugías esta semana.<br/>
          Usa ‹ › para cambiar de semana, o agrega con + Nueva / Importar Excel.
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
                    <span style={{fontSize:10,fontWeight:700,color:coloresEstado[c.estado]}}>{c.hora?.slice(0,5)}</span>
                    {c.pabellon==="CCV"
                      ? <span style={{fontSize:8,fontWeight:600,background:"var(--ccv)",color:"var(--texto-inv)",padding:"0 4px",borderRadius:6}}>CCV</span>
                      : c.pabellon && <span style={{fontSize:8,color:"var(--texto-ter)"}}>Pab {c.pabellon}</span>}
                  </div>
                  <div style={{fontSize:10,color:"var(--texto)",fontWeight:600,marginTop:2,lineHeight:1.25}}>{c.iniciales}{c.edad?` (${c.edad}a)`:""}</div>
                  <div style={{fontSize:10,color:"var(--texto-sec)",marginTop:1,lineHeight:1.25}}>{c.procedimiento}{c.lateralidad?` · ${c.lateralidad}`:""}</div>
                  {c.cirujano && <div style={{fontSize:9,color:"var(--texto-ter)",marginTop:1}}>👨‍⚕️ {c.cirujano}</div>}
                  {c.primer_ayudante && <div style={{fontSize:9,color:"var(--texto-ter)"}}>🧑‍⚕️ {c.primer_ayudante}</div>}
                  <div style={{marginTop:3,display:"inline-block",fontSize:8,fontWeight:700,textTransform:"uppercase",letterSpacing:.3,color:"var(--texto-inv)",background:coloresEstado[c.estado],padding:"1px 6px",borderRadius:8}}>{textoEstado[c.estado]}</div>
                </div>
              );

              return (
                <div key={fecha} style={{background:esHoy?"var(--hoy-bg)":"var(--fondo-suave)",borderRadius:8,border:esHoy?"1.5px solid var(--primario)":"0.5px solid var(--borde-suave)",padding:6,minHeight:130}}>
                  <div style={{textAlign:"center",fontSize:11,fontWeight:700,color:esHoy?"var(--primario)":"var(--texto-sec)",padding:"3px 0 6px",borderBottom:"0.5px solid var(--borde-suave)",marginBottom:6,textTransform:"capitalize"}}>
                    {dObj.toLocaleDateString("es-CL",{weekday:"short"})} {dObj.getDate()}
                    {total>0 && <span style={{fontSize:9,fontWeight:500,color:"var(--texto-ter)"}}> · {total}</span>}
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:5}}>
                    {total===0 && <div style={{textAlign:"center",fontSize:10,color:"var(--borde-suave)",padding:"14px 0"}}>—</div>}
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
          <div style={{fontSize:12,fontWeight:600,color:"var(--texto)",marginBottom:8,padding:"4px 10px",background:"var(--fondo-suave)",borderRadius:6}}>
            📅 {new Date(fecha + "T00:00:00").toLocaleDateString("es-CL",{weekday:"long",day:"numeric",month:"long"})} ({porFecha[fecha].length})
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:5}}>
            {ordenadas.map((c,idx) => (
              <Fragment key={c.id}>
                {idx===hospital.length && ccv.length>0 && (
                  <div style={{fontSize:10,fontWeight:700,color:"var(--ccv)",textAlign:"center",margin:"2px 0",padding:"2px 0",borderTop:"1px dashed var(--ccv-borde)",borderBottom:"1px dashed var(--ccv-borde)"}}>CCV · COSTANERA</div>
                )}
                <div onClick={()=>{setSeleccionado(c);setVista("detalle");}} style={{background:fondoEstado[c.estado],border:`0.5px solid ${coloresEstado[c.estado]}`,borderRadius:8,padding:"10px 12px",cursor:"pointer",borderLeft:`4px solid ${coloresEstado[c.estado]}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,color:"var(--texto)",fontWeight:500}}>
                        {c.hora?.slice(0,5)} | {c.iniciales}{c.edad ? ` (${c.edad}a)` : ""} | {c.procedimiento}{c.lateralidad ? ` (${c.lateralidad})` : ""}
                      </div>
                      <div style={{fontSize:10,color:"var(--texto-ter)",marginTop:2}}>
                        {c.pabellon==="CCV" ? "CCV" : `Pabellón ${c.pabellon}`}{c.cirujano && ` | 👨‍⚕️ ${c.cirujano}`}{c.primer_ayudante && ` | 🧑‍⚕️ ${c.primer_ayudante}`}
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
};

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
const [editForm, setEditForm] = useState({});
const [formCirugia, setFormCirugia] = useState(null); // {fecha, nombre} cuando se está agregando una cirugía

  // Form de nuevo paciente
  const [nuevo, setNuevo] = useState({
    iniciales: "", edad: "", sexo: "M", cama: "", servicio: "",
    diagnostico: "", plan_manejo: "", fecha_ingreso: new Date().toISOString().slice(0, 10)
  });

  // Form de evoluciones
  const [evoLibre, setEvoLibre] = useState("");
  const [evoEstructurada, setEvoEstructurada] = useState({ subjetivo: "", objetivo: "", examen: "", indicaciones: "" });
  const [diuresis, setDiuresis] = useState({ cantidad: "", via: "", caracteristicas: "" });
  const [drenaje, setDrenaje] = useState({ activo: false, tipo: "", aspiracion: "", localizacion: "", cantidad: "", caracteristicas: "" });
  const [seccionAbierta, setSeccionAbierta] = useState(null); // qué bloque de sugerencias está desplegado
  const [tipoEvo, setTipoEvo] = useState("estructurada");

  // Form de exámenes
  const [nuevoEx, setNuevoEx] = useState({ tipo: "Laboratorio", nombre: "", resultado: "", fecha_examen: new Date().toISOString().slice(0, 10), pirads: "", pesoProstatico: "", lugar: "", tipoCultivo: "" });
  const [paramsLab, setParamsLab] = useState({}); // valores de los parámetros numéricos del lab seleccionado
  const [litiasis, setLitiasis] = useState([]); // lista de litiasis agregadas
  const [formLitiasis, setFormLitiasis] = useState({ ubicacion: "", tercio: "", lateralidad: "", tamano: "", uh: "" });
  const [tumores, setTumores] = useState([]); // lista de tumores agregados
  const [formTumor, setFormTumor] = useState({ organo: "", sublocalizacion: "", tamano: "" });

  // Servicios
  const [nuevoServicio, setNuevoServicio] = useState("");
  const [serviciosEquipo, setServiciosEquipo] = useState([]);
const [miembrosEquipo, setMiembrosEquipo] = useState([]);
  const esEquipo = contexto !== "personal";
  const equipoActual = esEquipo ? equipos.find(e => e.id === contexto) : null;

  // Cargar pacientes según contexto
  const cargarPacientes = async () => {
    setLoadingPacientes(true);
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
      setPacientes(combinados);
    } else {
      const result = await listarPacientes(currentUser.id, contexto);
      if (result.ok) setPacientes(result.pacientes);
    }
    setLoadingPacientes(false);
  };

  // Cargar servicios del equipo si estoy en contexto equipo
  const cargarServiciosEquipo = async () => {
    if (esEquipo) {
      const result = await listarServiciosEquipo(contexto);
      if (result.ok) setServiciosEquipo(result.servicios);
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

  // Servicios disponibles según contexto
  const serviciosDisponibles = esEquipo 
    ? serviciosEquipo 
    : misServiciosLista.map(s => s.nombre);

  // Filtrar pacientes
  const pacientesFiltrados = pacientes.filter(p => {
    if (filtroEstado !== "todos" && p.estado !== filtroEstado) return false;
    if (filtroServicio !== "todos" && p.servicio !== filtroServicio) return false;
    return true;
  });

  // Agrupar por servicio para vista kanban
  const porServicio = {};
  pacientesFiltrados.forEach(p => {
    if (!porServicio[p.servicio]) porServicio[p.servicio] = [];
    porServicio[p.servicio].push(p);
  });

  // ============================================================
  // CRUD PACIENTES
  // ============================================================

  const guardarNuevo = async () => {
    setError("");
    if (!nuevo.iniciales.trim()) return setError("Ingresa las iniciales");
    if (nuevo.iniciales.length > 100) return setError("Máximo 100 caracteres");
    if (!nuevo.cama.trim()) return setError("Ingresa la cama");
    if (!nuevo.servicio.trim()) return setError("Ingresa el servicio");
    if (!nuevo.diagnostico.trim()) return setError("Ingresa el diagnóstico");

    const datos = {
      medico_id: currentUser.id,
      equipo_id: esEquipo ? contexto : null,
      iniciales: nuevo.iniciales.trim().toUpperCase(),
      edad: nuevo.edad ? parseInt(nuevo.edad) : null,
      sexo: nuevo.sexo,
      cama: nuevo.cama.trim(),
      servicio: nuevo.servicio.trim(),
      diagnostico: nuevo.diagnostico.trim(),
      plan_manejo: nuevo.plan_manejo.trim() || null,
      fecha_ingreso: nuevo.fecha_ingreso,
      estado: 'activo'
    };

    const result = await crearPaciente(datos);
    if (!result.ok) return setError(result.error);

    setPacientes(prev => [result.paciente, ...prev]);
    setNuevo({ iniciales: "", edad: "", sexo: "M", cama: "", servicio: "", diagnostico: "", plan_manejo: "", fecha_ingreso: new Date().toISOString().slice(0, 10) });
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
        crearNotificacion(id, `Paciente dado de alta: ${paciente.iniciales} (cama ${paciente.cama})`, "paciente");
      });
    }
  };
  const iniciarEdicion = () => {
  setEditForm({
    iniciales: seleccionado.iniciales || "",
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

const guardarEdicion = async () => {
  const datos = {
    iniciales: editForm.iniciales.trim().toUpperCase(),
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
    crearNotificacion(id, `Te asignaron como encargado del paciente ${paciente?.iniciales || ""} (cama ${paciente?.cama || "?"})`, "paciente");
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
    setMostrarEvosAntiguas(false);
    setMostrarExAntiguos(false);
    setEditandoHistoria(false);
    setAbrirFormPendiente(false);
    setAbrirFormEvo(false);
    setAbrirFormExamen(false);
    const evoResult = await listarEvoluciones(paciente.id);
    if (evoResult.ok) setEvoluciones(evoResult.evoluciones);
    const exResult = await listarExamenes(paciente.id);
    if (exResult.ok) setExamenes(exResult.examenes.map(normalizarExamen));
    cargarPendientesPaciente(paciente.id);
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
      crearNotificacion(id, `Te asignaron un pendiente del paciente ${seleccionado.iniciales}: "${nuevoPendientePac.texto.trim().slice(0,70)}"`, "pendiente");
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
    if (!result.ok) return alert("Error: " + result.error);
    setEvoluciones(prev => [result.evolucion, ...prev]);
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
    if (!result.ok) return alert("Error: " + result.error);
    // Recargar desde la base para asegurar que los datos estructurados se lean correctamente
    const recarga = await listarExamenes(seleccionado.id);
    if (recarga.ok) setExamenes(recarga.examenes.map(normalizarExamen));
    else setExamenes(prev => [normalizarExamen(result.examen), ...prev]);

    // Copiar automáticamente el examen a la evolución del día
    const partesEx = [];
    partesEx.push(`${nuevoEx.tipo}: ${nombreExamen}`);
    if (estructurados.pirads) partesEx.push(`PI-RADS ${estructurados.pirads}`);
    if (estructurados.pesoProstatico) partesEx.push(`Próstata ${estructurados.pesoProstatico} g`);
    if (estructurados.lugar) partesEx.push(`Lugar: ${estructurados.lugar}`);
    if (estructurados.tipoCultivo) partesEx.push(estructurados.tipoCultivo);
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

    setNuevoEx({ tipo: "Laboratorio", nombre: "", resultado: "", fecha_examen: new Date().toISOString().slice(0, 10), pirads: "", pesoProstatico: "", lugar: "", tipoCultivo: "" });
    setParamsLab({});
    setLitiasis([]);
    setFormLitiasis({ ubicacion: "", tercio: "", lateralidad: "", tamano: "", uh: "" });
    setTumores([]);
    setFormTumor({ organo: "", sublocalizacion: "", tamano: "" });
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
    const result = await crearServicio(currentUser.id, nuevoServicio.trim());
    if (!result.ok) return alert(result.error);
    setMisServiciosLista(prev => [...prev, result.servicio]);
    setNuevoServicio("");
  };

  const quitarServicio = async (servicioId) => {
    const result = await eliminarServicio(servicioId);
    if (!result.ok) return alert("Error: " + result.error);
    setMisServiciosLista(prev => prev.filter(s => s.id !== servicioId));
  };

  // ============================================================
  // RENDER: VISTA NUEVO PACIENTE
  // ============================================================

  if (vista === "nuevo") {
    return (
      <div style={{padding:"20px",overflowY:"auto"}}>
        <button onClick={()=>{setVista("lista");setError("");}} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:13,cursor:"pointer",marginBottom:12,padding:0}}>← Volver</button>
        <div style={{fontSize:16,fontWeight:600,color:"var(--texto)",marginBottom:14}}>Nuevo paciente {esEquipo && `en equipo "${equipoActual?.nombre}"`}</div>
        
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
            <label style={labelStyle}>Sexo</label>
            <select value={nuevo.sexo} onChange={e=>setNuevo({...nuevo,sexo:e.target.value})} style={inputStyle}>
              <option value="M">Masculino</option>
              <option value="F">Femenino</option>
              <option value="Otro">Otro</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Cama</label>
            <input value={nuevo.cama} onChange={e=>setNuevo({...nuevo,cama:e.target.value})} placeholder="3-12" style={inputStyle}/>
          </div>
        </div>

        <label style={labelStyle}>Servicio / Piso</label>
        {serviciosDisponibles.length > 0 ? (
          <select value={nuevo.servicio} onChange={e=>setNuevo({...nuevo,servicio:e.target.value})} style={inputStyle}>
            <option value="">Selecciona...</option>
            {serviciosDisponibles.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : (
          <div style={{fontSize:11,color:"var(--alerta)",background:"var(--alerta-bg)",padding:"8px 10px",borderRadius:6,marginBottom:8}}>
            No tienes servicios configurados. Ve a "⚙️ Servicios" antes de crear pacientes.
          </div>
        )}

        <label style={labelStyle}>Fecha ingreso</label>
        <input type="date" value={nuevo.fecha_ingreso} onChange={e=>setNuevo({...nuevo,fecha_ingreso:e.target.value})} style={inputStyle}/>

        <label style={labelStyle}>Diagnóstico</label>
        <textarea value={nuevo.diagnostico} onChange={e=>setNuevo({...nuevo,diagnostico:e.target.value})} placeholder="Diagnóstico principal" rows={2} style={{...inputStyle,resize:"vertical"}}/>

        <label style={labelStyle}>Plan de manejo (opcional)</label>
        <textarea value={nuevo.plan_manejo} onChange={e=>setNuevo({...nuevo,plan_manejo:e.target.value})} placeholder="Plan inicial" rows={3} style={{...inputStyle,resize:"vertical"}}/>

        {error && <div style={{fontSize:12,color:"var(--peligro)",background:"var(--peligro-bg)",padding:"8px 10px",borderRadius:6,marginBottom:8}}>{error}</div>}

        <button onClick={guardarNuevo} style={{...btnPrimary, marginTop:0}}>Guardar paciente</button>
      </div>
    );
  }

  // ============================================================
  // RENDER: VISTA SERVICIOS
  // ============================================================

  if (vista === "servicios") {
    return (
      <div style={{padding:"20px",overflowY:"auto"}}>
        <button onClick={()=>setVista("lista")} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:13,cursor:"pointer",marginBottom:12,padding:0}}>← Volver</button>
        <div style={{fontSize:16,fontWeight:600,color:"var(--texto)",marginBottom:6}}>⚙️ Mis servicios</div>
        <div style={{fontSize:12,color:"var(--texto-ter)",marginBottom:14}}>Configura los servicios/pisos del hospital donde atiendes</div>

        <div style={{display:"flex",gap:6,marginBottom:14}}>
          <input value={nuevoServicio} onChange={e=>setNuevoServicio(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")agregarServicio();}} placeholder="Ej: Cirugía 3er piso" style={{flex:1,padding:"9px 12px",fontSize:13,borderRadius:8,border:"0.5px solid var(--borde)",outline:"none"}}/>
          <button onClick={agregarServicio} disabled={!nuevoServicio.trim()} style={{padding:"9px 14px",fontSize:13,fontWeight:500,background:nuevoServicio.trim()?"var(--primario)":"var(--borde)",color:"var(--texto-inv)",border:"none",borderRadius:8,cursor:"pointer"}}>Agregar</button>
        </div>

        {misServiciosLista.length === 0 ? (
          <div style={{textAlign:"center",padding:"30px 16px",color:"var(--texto-ter)",fontSize:13}}>No tienes servicios configurados.</div>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {misServiciosLista.map(s => (
              <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:8,padding:"10px 14px"}}>
                <div style={{fontSize:13,color:"var(--texto)"}}>{s.nombre}</div>
                <button onClick={()=>quitarServicio(s.id)} style={{background:"none",border:"none",color:"var(--peligro)",cursor:"pointer",fontSize:14}}>🗑</button>
              </div>
            ))}
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
      <div style={{padding:"16px",overflowY:"auto"}}>
        <button onClick={()=>{setVista("lista");setSeleccionado(null);}} style={{background:"none",border:"none",color:"var(--texto-sec)",fontSize:13,cursor:"pointer",marginBottom:10,padding:0}}>← Volver a la lista</button>

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
          <label style={labelStyle}>Cama</label>
          <input value={editForm.cama} onChange={e=>setEditForm({...editForm,cama:e.target.value})} style={inputStyle}/>
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
                    }} style={{padding:"5px 11px",fontSize:13,borderRadius:14,cursor:"pointer",border:activo?"none":"0.5px solid var(--borde)",background:activo?"#f2a03f":"var(--superficie)",color:activo?"var(--texto-inv)":"var(--texto-ter)",fontWeight:activo?600:400}}>
                      {ant}
                    </button>
                  );
                })}
                {personalizados.map(ant => (
                  <button key={ant} type="button" title="Clic para quitar" onClick={()=>setEditForm({...editForm, antecedentes: lista.filter(x=>x!==ant)})} style={{padding:"5px 11px",fontSize:13,borderRadius:14,cursor:"pointer",border:"none",background:"#f2a03f",color:"var(--texto-inv)",fontWeight:600}}>
                    {ant} ✕
                  </button>
                ))}
              </>
            );
          })()}
        </div>
        <div style={{display:"flex",gap:6,marginTop:8}}>
          <input value={otroAntecedente} onChange={e=>setOtroAntecedente(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&otroAntecedente.trim()){const lista=Array.isArray(editForm.antecedentes)?editForm.antecedentes:[];if(!lista.includes(otroAntecedente.trim()))setEditForm({...editForm,antecedentes:[...lista,otroAntecedente.trim()]});setOtroAntecedente("");}}} placeholder="Otro antecedente (ej: EPOC, ERC etapa 3...)" style={{...inputStyle,marginBottom:0,flex:1}}/>
          <button type="button" disabled={!otroAntecedente.trim()} onClick={()=>{const lista=Array.isArray(editForm.antecedentes)?editForm.antecedentes:[];if(!lista.includes(otroAntecedente.trim()))setEditForm({...editForm,antecedentes:[...lista,otroAntecedente.trim()]});setOtroAntecedente("");}} style={{padding:"0 16px",fontSize:13,background:"var(--primario)",color:"var(--texto-inv)",border:"none",borderRadius:8,cursor:"pointer",fontWeight:600,opacity:otroAntecedente.trim()?1:0.5}}>+ Agregar</button>
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
        <button onClick={()=>setEditandoFicha(false)} style={{padding:"9px 14px",fontSize:13,background:"var(--superficie)",color:"var(--texto-ter)",border:"0.5px solid var(--borde)",borderRadius:8,cursor:"pointer"}}>Cancelar</button>
      </div>
    </div>
  ) : (
    <>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,marginBottom:8}}>
        <div>
          <div style={{fontSize:24,fontWeight:700,color:"var(--texto)"}}>{seleccionado.iniciales} <span style={{fontSize:28,fontWeight:700,color:seleccionado.sexo==="F"?"var(--chip-rosa)":"var(--primario)"}}>{seleccionado.sexo==="F"?"♀":"♂"}</span></div>
          <div style={{fontSize:16,fontWeight:600,color:"var(--texto-sec)",marginTop:4}}>
            {seleccionado.edad} años · Cama {seleccionado.cama} · {seleccionado.servicio}
          </div>
          <div style={{fontSize:14,color:"var(--texto-ter)",marginTop:4}}>Ingreso: {seleccionado.fecha_ingreso}</div>
        </div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          <button onClick={iniciarEdicion} style={{padding:"5px 10px",fontSize:11,background:"var(--primario)",color:"var(--texto-inv)",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>✏ Editar</button>
          {seleccionado.estado === "activo" ? (
            <button onClick={()=>cambiarEstado(seleccionado, "alta")} style={{padding:"5px 10px",fontSize:11,background:"var(--exito)",color:"var(--texto-inv)",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>✓ Dar alta</button>
          ) : (
            <button onClick={()=>cambiarEstado(seleccionado, "activo")} style={{padding:"5px 10px",fontSize:11,background:"var(--superficie)",color:"var(--primario)",border:"0.5px solid var(--borde)",borderRadius:6,cursor:"pointer"}}>↺ Reactivar</button>
          )}
          {esCreador && (
            <button onClick={()=>eliminarPacienteHandler(seleccionado)} style={{padding:"5px 10px",fontSize:11,background:"var(--superficie)",color:"var(--peligro)",border:"0.5px solid var(--peligro-borde)",borderRadius:6,cursor:"pointer"}}>🗑</button>
          )}
        </div>
      </div>
      <div style={{fontSize:14,color:"var(--texto)",marginTop:8,padding:"10px 12px",background:"var(--fondo-suave)",borderRadius:6}}>
        <strong>Diagnóstico:</strong> {seleccionado.diagnostico}
      </div>
      {/* Estado clínico */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:6,padding:"10px 12px",background:"var(--fondo-suave)",borderRadius:6}}>
        <span style={{fontSize:14,color:"var(--texto)",fontWeight:600}}>Estado del paciente</span>
        <select value={seleccionado.estado_clinico || ""} onChange={e=>cambiarEstadoClinico(e.target.value)} style={{fontSize:13,padding:"5px 10px",borderRadius:6,border:"0.5px solid var(--borde)",background:"var(--superficie)",color:"var(--texto)",cursor:"pointer"}}>
          <option value="">Sin definir</option>
          <option value="estable">🟢 Estable</option>
          <option value="regular">🟡 Regular</option>
          <option value="cuidado">🔴 De cuidado</option>
        </select>
      </div>
      {/* Operado + agregar cirugía */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:6,padding:"10px 12px",background:seleccionado.operado?"var(--exito-bg)":"var(--fondo-suave)",borderRadius:6,gap:10,flexWrap:"wrap"}}>
        <span style={{fontSize:14,color:"var(--texto)",fontWeight:600}}>🔪 Paciente operado</span>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {seleccionado.operado && (
            <button onClick={abrirFormCirugia} style={{fontSize:12,background:"var(--exito)",color:"var(--texto-inv)",border:"none",borderRadius:6,padding:"5px 10px",cursor:"pointer",fontWeight:500}}>+ Agregar cirugía</button>
          )}
          <button onClick={toggleOperado} style={{width:46,height:26,borderRadius:13,border:"none",cursor:"pointer",background:seleccionado.operado?"var(--exito)":"var(--borde-suave)",position:"relative",transition:"background 0.2s",padding:0}}>
            <span style={{position:"absolute",top:3,left:seleccionado.operado?23:3,width:20,height:20,borderRadius:"50%",background:"var(--superficie)",transition:"left 0.2s",boxShadow:"0 1px 2px rgba(0,0,0,0.2)"}}/>
          </button>
        </div>
      </div>
      {/* Formulario para agregar cirugía */}
      {seleccionado.operado && formCirugia && (
        <div style={{marginTop:6,padding:"12px",background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:6}}>
          <div style={{fontSize:13,fontWeight:600,color:"var(--texto)",marginBottom:8}}>Nueva cirugía</div>
          <label style={labelStyle}>Fecha de la cirugía</label>
          <input type="date" value={formCirugia.fecha} onChange={e=>setFormCirugia({...formCirugia, fecha:e.target.value})} style={inputStyle}/>
          <label style={labelStyle}>Cirugía realizada</label>
          <input value={formCirugia.nombre} onChange={e=>setFormCirugia({...formCirugia, nombre:e.target.value})} placeholder="Ej: RTU vesical, Nefrectomía..." style={inputStyle}/>
          <div style={{display:"flex",gap:8,marginTop:4}}>
            <button onClick={guardarCirugia} style={{...btnPrimary,marginTop:0,flex:1}}>Guardar cirugía</button>
            <button onClick={()=>setFormCirugia(null)} style={{padding:"9px 14px",fontSize:13,background:"var(--superficie)",color:"var(--texto-ter)",border:"0.5px solid var(--borde)",borderRadius:8,cursor:"pointer"}}>Cancelar</button>
          </div>
        </div>
      )}
      {/* Lista de cirugías con día post-op */}
      {seleccionado.operado && Array.isArray(seleccionado.cirugias_realizadas) && seleccionado.cirugias_realizadas.length > 0 && (
        <div style={{marginTop:6,padding:"10px 12px",background:"var(--exito-bg)",borderRadius:6}}>
          {seleccionado.cirugias_realizadas.map((cx, idx) => {
            const dia = diaPostOp(cx.fecha);
            return (
              <div key={idx} style={{display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:14,color:"var(--texto)",padding:"3px 0"}}>
                <span><strong>Día {dia}:</strong> {cx.nombre}</span>
                <button onClick={()=>eliminarCirugia(idx)} style={{background:"none",border:"none",color:"var(--peligro)",cursor:"pointer",fontSize:13,padding:0}}>✕</button>
              </div>
            );
          })}
        </div>
      )}
      {Array.isArray(seleccionado.antecedentes) && seleccionado.antecedentes.length > 0 && (
        <div style={{fontSize:14,color:"var(--texto)",marginTop:6,padding:"10px 12px",background:"var(--fondo-suave)",borderRadius:6}}>
          <strong>Antecedentes:</strong>{" "}
          <span style={{display:"inline-flex",flexWrap:"wrap",gap:5,verticalAlign:"middle"}}>
            {seleccionado.antecedentes.map(a => (
              <span key={a} style={{fontSize:12,background:"var(--alerta-bg)",color:"var(--alerta)",padding:"2px 8px",borderRadius:8,fontWeight:600}}>{a}</span>
            ))}
          </span>
        </div>
      )}
      {seleccionado.alergias && seleccionado.alergias.trim() && (
        <div style={{fontSize:14,color:"var(--texto)",marginTop:6,padding:"10px 12px",background:"var(--peligro-bg)",borderRadius:6}}>
          <strong style={{color:"var(--peligro)"}}>⚠ Alergias:</strong> {seleccionado.alergias}
        </div>
      )}
      {seleccionado.plan_manejo && (
        <div style={{fontSize:14,color:"var(--texto)",marginTop:6,padding:"10px 12px",background:"var(--fondo-suave)",borderRadius:6,whiteSpace:"pre-wrap"}}>
          <strong>Plan:</strong> {seleccionado.plan_manejo}
        </div>
      )}
    </>
  )}
</div>

        {/* HISTORIA DEL PACIENTE */}
        <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"14px",marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:seleccionado.historia||editandoHistoria?8:0}}>
            <div style={{fontSize:13,fontWeight:600,color:"var(--texto)"}}>📖 Historia</div>
            {!editandoHistoria && (
              <button onClick={()=>{setHistoriaDraft(seleccionado.historia||"");setEditandoHistoria(true);}} style={{padding:"4px 11px",fontSize:11,background:seleccionado.historia?"var(--superficie)":"var(--primario)",color:seleccionado.historia?"var(--primario)":"var(--texto-inv)",border:seleccionado.historia?"0.5px solid var(--borde)":"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>
                {seleccionado.historia ? "✏ Editar" : "+ Agregar Historia"}
              </button>
            )}
          </div>
          {editandoHistoria ? (
            <>
              <textarea value={historiaDraft} onChange={e=>setHistoriaDraft(e.target.value)} placeholder="Breve historia del paciente: motivo de ingreso, contexto clínico, evolución previa..." rows={4} style={{...inputStyle,resize:"vertical",marginBottom:6}}/>
              <div style={{display:"flex",gap:8}}>
                <button onClick={guardarHistoria} style={{...btnPrimary,marginTop:0,flex:1}}>Guardar historia</button>
                <button onClick={()=>setEditandoHistoria(false)} style={{padding:"9px 14px",fontSize:13,background:"var(--superficie)",color:"var(--texto-ter)",border:"0.5px solid var(--borde)",borderRadius:8,cursor:"pointer"}}>Cancelar</button>
              </div>
            </>
          ) : seleccionado.historia ? (
            <div style={{fontSize:13,color:"var(--texto)",whiteSpace:"pre-wrap",lineHeight:1.5,background:"var(--fondo-suave)",borderRadius:6,padding:"10px 12px"}}>{seleccionado.historia}</div>
          ) : null}
        </div>

        {/* ÚLTIMA EVOLUCIÓN + anteriores colapsadas */}
        <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"14px",marginBottom:12}}>
          <div style={{fontSize:13,fontWeight:600,color:"var(--texto)",marginBottom:10}}>📝 Evoluciones</div>
          {evoluciones.length === 0 ? (
            <div style={{fontSize:11,color:"var(--texto-ter)",fontStyle:"italic",padding:"6px 0"}}>No hay evoluciones registradas</div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {(mostrarEvosAntiguas ? evoluciones : evoluciones.slice(0,1)).map((e, idx) => (
                <div key={e.id} style={{background:"var(--fondo-suave)",borderRadius:6,padding:"10px 12px",borderLeft:idx===0?"3px solid var(--primario)":"3px solid var(--borde)",border:idx===0?"0.5px solid var(--primario)":"none"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4,gap:8}}>
                    <div style={{fontSize:11,color:"var(--texto-ter)",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                      {idx===0 && <span style={{fontSize:9,background:"var(--primario)",color:"var(--texto-inv)",padding:"1px 7px",borderRadius:8,fontWeight:600}}>MÁS RECIENTE</span>}
                      {e.fecha_evolucion} {e.hora_evolucion?.slice(0,5)} | {e.autor?.nombre || "Anónimo"} | <span style={{color:e.tipo==="estructurada"?"var(--exito)":e.tipo==="examen"?"var(--alerta)":"var(--texto-sec)",fontWeight:e.tipo==="examen"?600:400}}>{e.tipo==="examen"?"🧪 examen":e.tipo}</span>
                    </div>
                    {e.autor_id === currentUser.id && (
                      <button onClick={()=>eliminarEvo(e.id)} style={{background:"none",border:"none",color:"var(--peligro)",cursor:"pointer",fontSize:12,padding:0}}>🗑</button>
                    )}
                  </div>
                  <div style={{fontSize:idx===0?13:12,color:"var(--texto)",whiteSpace:"pre-wrap",lineHeight:1.4}}>{e.texto}</div>
                </div>
              ))}
              {evoluciones.length > 1 && (
                <button onClick={()=>setMostrarEvosAntiguas(!mostrarEvosAntiguas)} style={{padding:"8px",fontSize:12,background:"var(--fondo-suave)",border:"0.5px dashed var(--borde)",color:"var(--primario)",borderRadius:8,cursor:"pointer",fontWeight:500}}>
                  {mostrarEvosAntiguas ? "▴ Ver menos evoluciones" : "▾ Ver más evoluciones"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* EXÁMENES agrupados por día + anteriores colapsados */}
        <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"14px",marginBottom:12}}>
          <div style={{fontSize:13,fontWeight:600,color:"var(--texto)",marginBottom:10}}>🧪 Exámenes</div>
          {examenes.length === 0 ? (
            <div style={{fontSize:11,color:"var(--texto-ter)",fontStyle:"italic",padding:"6px 0"}}>No hay exámenes registrados</div>
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
                      <div style={{fontSize:12,fontWeight:500,color:"var(--texto)"}}>
                        <span style={{fontSize:9,padding:"1px 6px",background:"var(--exito)",color:"var(--texto-inv)",borderRadius:3,marginRight:6}}>{ex.tipo}</span>
                        {ex.nombre}
                      </div>
                      <div style={{fontSize:10,color:"var(--texto-ter)",marginTop:2}}>{ex.autor?.nombre || "Anónimo"}</div>
                    </div>
                    {ex.autor_id === currentUser.id && (
                      <button onClick={()=>eliminarEx(ex.id)} style={{background:"none",border:"none",color:"var(--peligro)",cursor:"pointer",fontSize:12,padding:0}}>🗑</button>
                    )}
                  </div>
                  {ex.datos_estructurados && (ex.datos_estructurados.pirads || ex.datos_estructurados.pesoProstatico || ex.datos_estructurados.lugar || ex.datos_estructurados.tipoCultivo) && (
                    <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:4}}>
                      {ex.datos_estructurados.pirads && <span style={{fontSize:11,background:"var(--alerta-bg)",color:"var(--alerta)",padding:"2px 8px",borderRadius:8,fontWeight:600}}>PI-RADS {ex.datos_estructurados.pirads}</span>}
                      {ex.datos_estructurados.pesoProstatico && <span style={{fontSize:11,background:"var(--chip-azul-bg)",color:"var(--chip-azul)",padding:"2px 8px",borderRadius:8,fontWeight:600}}>Próstata {ex.datos_estructurados.pesoProstatico} g</span>}
                      {ex.datos_estructurados.lugar && <span style={{fontSize:11,background:"var(--ccv-bg)",color:"var(--ccv)",padding:"2px 8px",borderRadius:8,fontWeight:600}}>📍 {ex.datos_estructurados.lugar}</span>}
                      {ex.datos_estructurados.tipoCultivo && <span style={{fontSize:11,background:"var(--exito-bg)",color:"var(--exito)",padding:"2px 8px",borderRadius:8,fontWeight:600}}>{ex.datos_estructurados.tipoCultivo}</span>}
                    </div>
                  )}
                  {ex.datos_estructurados && ex.datos_estructurados.parametros && Object.keys(ex.datos_estructurados.parametros).length > 0 && (
                    <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:6}}>
                      {Object.entries(ex.datos_estructurados.parametros).map(([k,v]) => {
                        const def = (PARAMETROS_LAB[ex.nombre] || []).find(p => p.key === k);
                        return (
                          <span key={k} style={{fontSize:11,background:"var(--superficie)",border:"0.5px solid var(--borde)",color:"var(--texto)",padding:"2px 8px",borderRadius:8}}>
                            <strong>{def?.label || k}:</strong> {v}{def?.unidad ? ` ${def.unidad}` : ""}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {ex.datos_estructurados && Array.isArray(ex.datos_estructurados.litiasis) && ex.datos_estructurados.litiasis.length > 0 && (
                    <div style={{marginTop:6}}>
                      <div style={{fontSize:11,fontWeight:600,color:"var(--primario)",marginBottom:3}}>🪨 Litiasis</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                        {ex.datos_estructurados.litiasis.map((l,i) => (
                          <span key={i} style={{fontSize:11,background:"var(--alerta-bg)",color:"var(--alerta)",padding:"2px 8px",borderRadius:8,fontWeight:500}}>
                            {[l.ubicacion,l.tercio,l.lateralidad,l.tamano?`${l.tamano} mm`:"",l.uh?`${l.uh} UH`:""].filter(Boolean).join(" · ")}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {ex.datos_estructurados && Array.isArray(ex.datos_estructurados.tumores) && ex.datos_estructurados.tumores.length > 0 && (
                    <div style={{marginTop:6}}>
                      <div style={{fontSize:11,fontWeight:600,color:"var(--primario)",marginBottom:3}}>🎯 Tumor</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                        {ex.datos_estructurados.tumores.map((t,i) => (
                          <span key={i} style={{fontSize:11,background:"var(--peligro-bg)",color:"var(--peligro)",padding:"2px 8px",borderRadius:8,fontWeight:500}}>
                            {[t.organo,t.sublocalizacion,t.tamano?`${t.tamano} cm`:""].filter(Boolean).join(" · ")}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {ex.resultado && <div style={{fontSize:12,color:"var(--texto)",marginTop:6,whiteSpace:"pre-wrap"}}>{ex.resultado}</div>}
                </div>
            );
            return (
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {fechasVisibles.map(fecha => (
                  <div key={fecha}>
                    <div style={{fontSize:11,fontWeight:700,color:"var(--texto-sec)",marginBottom:5,padding:"3px 10px",background:"var(--fondo-suave)",borderRadius:6,display:"inline-block"}}>
                      📅 {fecha === "s/f" ? "Sin fecha" : fecha} · {porDia[fecha].length} examen{porDia[fecha].length===1?"":"es"}
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {porDia[fecha].map(cardExamen)}
                    </div>
                  </div>
                ))}
                {fechas.length > 1 && (
                  <button onClick={()=>setMostrarExAntiguos(!mostrarExAntiguos)} style={{padding:"8px",fontSize:12,background:"var(--fondo-suave)",border:"0.5px dashed var(--borde)",color:"var(--primario)",borderRadius:8,cursor:"pointer",fontWeight:500}}>
                    {mostrarExAntiguos ? "▴ Ver menos exámenes" : "▾ Ver más exámenes"}
                  </button>
                )}
              </div>
            );
          })()}
        </div>

        {/* PENDIENTES DEL PACIENTE */}
        <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"14px",marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:abrirFormPendiente||pendientesPaciente.length>0?10:0}}>
            <div style={{fontSize:13,fontWeight:600,color:"var(--texto)"}}>✅ Pendientes del paciente</div>
            <button onClick={()=>setAbrirFormPendiente(!abrirFormPendiente)} style={{padding:"5px 12px",fontSize:12,background:abrirFormPendiente?"var(--superficie)":"var(--primario)",color:abrirFormPendiente?"var(--texto-sec)":"var(--texto-inv)",border:abrirFormPendiente?"0.5px solid var(--borde)":"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>{abrirFormPendiente?"Cancelar":"+ Agregar pendiente"}</button>
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
              <div style={{fontSize:11,color:"var(--texto-ter)",marginBottom:4}}>Agregar encargado:</div>
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
                      <span key={uid} onClick={()=>setNuevoPendientePac({...nuevoPendientePac,encargados:nuevoPendientePac.encargados.filter(x=>x!==uid)})} style={{padding:"4px 11px",fontSize:11,borderRadius:14,cursor:"pointer",background:"var(--primario)",color:"var(--texto-inv)",fontWeight:600}}>{m?.perfiles?.nombre||"?"} ✕</span>
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
              <button onClick={()=>togglePendientePacCompletado(p)} style={{width:17,height:17,borderRadius:4,border:"1px solid var(--borde)",background:p.estado==="completado"?"var(--exito)":"var(--superficie)",color:"var(--texto-inv)",cursor:"pointer",fontSize:11,padding:0,flexShrink:0}}>{p.estado==="completado"?"✓":""}</button>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,color:"var(--texto)",textDecoration:p.estado==="completado"?"line-through":"none"}}>{p.texto.replace(/^\[[^\]]*\]\s*/,"")}</div>
                <div style={{fontSize:10,color:"var(--texto-ter)"}}>{p.prioridad==="alta"?"🔴":p.prioridad==="baja"?"🟢":"🟡"}{p.fecha_objetivo?` · para el ${p.fecha_objetivo}`:""}</div>
              </div>
            </div>
          ))}
        </div>

        {/* NUEVA EVOLUCIÓN (formulario) */}
        <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"14px",marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:abrirFormEvo?10:0}}>
            <div style={{fontSize:13,fontWeight:600,color:"var(--texto)"}}>➕ Nueva evolución</div>
            <button onClick={()=>setAbrirFormEvo(!abrirFormEvo)} style={{padding:"5px 12px",fontSize:12,background:abrirFormEvo?"var(--superficie)":"var(--primario)",color:abrirFormEvo?"var(--texto-sec)":"var(--texto-inv)",border:abrirFormEvo?"0.5px solid var(--borde)":"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>{abrirFormEvo?"Cerrar":"+ Agregar evolución"}</button>
          </div>
          {abrirFormEvo && (<>
          {/* Selector tipo */}
          <div style={{display:"flex",gap:8,marginBottom:10}}>
            <button onClick={()=>setTipoEvo("estructurada")} style={{flex:1,padding:"11px 14px",fontSize:14,background:tipoEvo==="estructurada"?"var(--primario)":"var(--superficie)",color:tipoEvo==="estructurada"?"var(--texto-inv)":"var(--texto-sec)",border:tipoEvo==="estructurada"?"none":"0.5px solid var(--borde)",borderRadius:8,cursor:"pointer",fontWeight:600}}>Estructurada (SOAP)</button>
            <button onClick={()=>setTipoEvo("libre")} style={{flex:1,padding:"11px 14px",fontSize:14,background:tipoEvo==="libre"?"var(--primario)":"var(--superficie)",color:tipoEvo==="libre"?"var(--texto-inv)":"var(--texto-sec)",border:tipoEvo==="libre"?"none":"0.5px solid var(--borde)",borderRadius:8,cursor:"pointer",fontWeight:600}}>Libre</button>
          </div>

          {tipoEvo === "libre" ? (
            <textarea value={evoLibre} onChange={e=>setEvoLibre(e.target.value)} placeholder="Escribe la evolución..." rows={4} style={{...inputStyle,resize:"vertical",marginBottom:6}}/>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:6}}>
  
  {/* PLANTILLAS COMPLETAS - desplegable */}
  <div style={{border:"0.5px solid var(--borde)",borderRadius:6,overflow:"hidden"}}>
    <button onClick={()=>setSeccionAbierta(seccionAbierta==="plantillas"?null:"plantillas")} style={{width:"100%",padding:"9px 12px",background:"var(--fondo-suave)",border:"none",cursor:"pointer",fontSize:12,fontWeight:600,color:"var(--primario)",textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      📋 Plantillas completas <span>{seccionAbierta==="plantillas"?"▴":"▾"}</span>
    </button>
    {seccionAbierta==="plantillas" && (
      <div style={{display:"flex",flexWrap:"wrap",gap:5,padding:"8px 12px"}}>
        {Object.keys(PLANTILLAS_SOAP).map(nombre => (
          <button key={nombre} onClick={()=>setEvoEstructurada(PLANTILLAS_SOAP[nombre])} style={{padding:"5px 11px",fontSize:11,background:"var(--superficie)",border:"0.5px solid var(--borde)",color:"var(--primario)",borderRadius:10,cursor:"pointer"}}>{nombre}</button>
        ))}
      </div>
    )}
  </div>

  {/* SUBJETIVO */}
  <div>
    <textarea value={evoEstructurada.subjetivo} onChange={e=>setEvoEstructurada({...evoEstructurada,subjetivo:e.target.value})} placeholder="S - Subjetivo (lo que refiere el paciente)" rows={2} style={{...inputStyle,resize:"vertical",marginBottom:3}}/>
    <button onClick={()=>setSeccionAbierta(seccionAbierta==="subjetivo"?null:"subjetivo")} style={{padding:"4px 10px",fontSize:11,background:"var(--fondo-suave)",border:"0.5px solid var(--borde)",color:"var(--texto-ter)",borderRadius:8,cursor:"pointer"}}>+ Sugerencias {seccionAbierta==="subjetivo"?"▴":"▾"}</button>
    {seccionAbierta==="subjetivo" && (
      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
        {SUGERENCIAS_SOAP.subjetivo.map(s => (
          <button key={s} onClick={()=>setEvoEstructurada({...evoEstructurada,subjetivo: evoEstructurada.subjetivo ? evoEstructurada.subjetivo + " " + s : s})} style={{padding:"3px 8px",fontSize:11,background:"var(--superficie)",border:"0.5px solid var(--borde)",color:"var(--texto-sec)",borderRadius:8,cursor:"pointer"}}>{s}</button>
        ))}
      </div>
    )}
  </div>

  {/* OBJETIVO */}
  <div>
    <textarea value={evoEstructurada.objetivo} onChange={e=>setEvoEstructurada({...evoEstructurada,objetivo:e.target.value})} placeholder="O - Objetivo (signos vitales, laboratorio)" rows={2} style={{...inputStyle,resize:"vertical",marginBottom:3}}/>
    <button onClick={()=>setSeccionAbierta(seccionAbierta==="objetivo"?null:"objetivo")} style={{padding:"4px 10px",fontSize:11,background:"var(--fondo-suave)",border:"0.5px solid var(--borde)",color:"var(--texto-ter)",borderRadius:8,cursor:"pointer"}}>+ Sugerencias {seccionAbierta==="objetivo"?"▴":"▾"}</button>
    {seccionAbierta==="objetivo" && (
      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
        {SUGERENCIAS_SOAP.objetivo.map(s => (
          <button key={s} onClick={()=>setEvoEstructurada({...evoEstructurada,objetivo: evoEstructurada.objetivo ? evoEstructurada.objetivo + " " + s : s})} style={{padding:"3px 8px",fontSize:11,background:"var(--superficie)",border:"0.5px solid var(--borde)",color:"var(--texto-sec)",borderRadius:8,cursor:"pointer"}}>{s}</button>
        ))}
      </div>
    )}
  </div>

  {/* DIURESIS */}
  <div style={{padding:"10px 12px",background:"var(--fondo-suave)",borderRadius:6,border:"0.5px solid var(--borde)"}}>
    <div style={{fontSize:12,fontWeight:600,color:"var(--primario)",marginBottom:6}}>💧 Diuresis</div>
    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
      <input type="number" value={diuresis.cantidad} onChange={e=>setDiuresis({...diuresis,cantidad:e.target.value})} placeholder="Cantidad" style={{...inputStyle,marginBottom:0,width:100,flex:"0 0 auto"}}/>
      <span style={{alignSelf:"center",fontSize:12,color:"var(--texto-ter)"}}>ml</span>
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
      <div style={{fontSize:12,fontWeight:600,color:"var(--primario)"}}>🩸 Drenaje</div>
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
          <span style={{fontSize:12,color:"var(--texto-ter)"}}>ml</span>
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
    <button onClick={()=>setSeccionAbierta(seccionAbierta==="examen"?null:"examen")} style={{padding:"4px 10px",fontSize:11,background:"var(--fondo-suave)",border:"0.5px solid var(--borde)",color:"var(--texto-ter)",borderRadius:8,cursor:"pointer"}}>+ Sugerencias {seccionAbierta==="examen"?"▴":"▾"}</button>
    {seccionAbierta==="examen" && (
      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
        {SUGERENCIAS_SOAP.examen.map(s => (
          <button key={s} onClick={()=>setEvoEstructurada({...evoEstructurada,examen: evoEstructurada.examen ? evoEstructurada.examen + " " + s : s})} style={{padding:"3px 8px",fontSize:11,background:"var(--superficie)",border:"0.5px solid var(--borde)",color:"var(--texto-sec)",borderRadius:8,cursor:"pointer"}}>{s}</button>
        ))}
      </div>
    )}
  </div>

  {/* INDICACIONES */}
  <div>
    <textarea value={evoEstructurada.indicaciones} onChange={e=>setEvoEstructurada({...evoEstructurada,indicaciones:e.target.value})} placeholder="P - Plan/indicaciones" rows={2} style={{...inputStyle,resize:"vertical",marginBottom:3}}/>
    <button onClick={()=>setSeccionAbierta(seccionAbierta==="indicaciones"?null:"indicaciones")} style={{padding:"4px 10px",fontSize:11,background:"var(--fondo-suave)",border:"0.5px solid var(--borde)",color:"var(--texto-ter)",borderRadius:8,cursor:"pointer"}}>+ Sugerencias {seccionAbierta==="indicaciones"?"▴":"▾"}</button>
    {seccionAbierta==="indicaciones" && (
      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
        {SUGERENCIAS_SOAP.indicaciones.map(s => (
          <button key={s} onClick={()=>setEvoEstructurada({...evoEstructurada,indicaciones: evoEstructurada.indicaciones ? evoEstructurada.indicaciones + "\n" + s : s})} style={{padding:"3px 8px",fontSize:11,background:"var(--superficie)",border:"0.5px solid var(--borde)",color:"var(--texto-sec)",borderRadius:8,cursor:"pointer"}}>{s}</button>
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
        <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"14px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:abrirFormExamen?10:0}}>
            <div style={{fontSize:13,fontWeight:600,color:"var(--texto)"}}>➕ Nuevo examen</div>
            <button onClick={()=>setAbrirFormExamen(!abrirFormExamen)} style={{padding:"5px 12px",fontSize:12,background:abrirFormExamen?"var(--superficie)":"var(--primario)",color:abrirFormExamen?"var(--texto-sec)":"var(--texto-inv)",border:abrirFormExamen?"0.5px solid var(--borde)":"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>{abrirFormExamen?"Cerrar":"+ Agregar examen"}</button>
          </div>
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
              {["Función renal","Hemograma","Coagulación","VFG","PCR","ELP","Pruebas hepáticas","Glicemia","Orina completa","Antígeno prostático (PSA)","Testosterona","Gases venosos","Lactato","Otro"].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
          {/* Panel de parámetros numéricos para exámenes con set definido */}
          {nuevoEx.tipo === "Laboratorio" && PARAMETROS_LAB[nuevoEx.nombre] && (
            <div style={{padding:"10px 12px",background:"var(--fondo-suave)",borderRadius:6,border:"0.5px solid var(--borde)",marginBottom:6}}>
              <div style={{fontSize:11,color:"var(--texto-ter)",marginBottom:8}}>Completa solo los parámetros que tengas (los vacíos se omiten):</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {PARAMETROS_LAB[nuevoEx.nombre].map(param => (
                  <div key={param.key} style={{display:"flex",alignItems:"center",gap:4}}>
                    <span style={{fontSize:11,color:"var(--texto)",fontWeight:500,minWidth:74}}>{param.label}</span>
                    <input type="number" value={paramsLab[param.key] || ""} onChange={e=>setParamsLab({...paramsLab,[param.key]:e.target.value})} style={{...inputStyle,marginBottom:0,padding:"6px 8px",fontSize:12}}/>
                    {param.unidad && <span style={{fontSize:10,color:"var(--texto-ter)",minWidth:38}}>{param.unidad}</span>}
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
          {(nuevoEx.tipo === "Cistoscopia" || nuevoEx.tipo === "Otro") && (
            <input value={nuevoEx.nombre} onChange={e=>setNuevoEx({...nuevoEx,nombre:e.target.value})} placeholder={nuevoEx.tipo==="Cistoscopia"?"Detalle (opcional)":"Nombre del examen"} style={inputStyle}/>
          )}

          {/* Campos condicionales: peso prostático y PI-RADS */}
          {(nuevoEx.nombre === "RM próstata" || nuevoEx.nombre === "Eco VP") && (
            <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:6}}>
              <input type="number" value={nuevoEx.pesoProstatico} onChange={e=>setNuevoEx({...nuevoEx,pesoProstatico:e.target.value})} placeholder="Peso prostático" style={{...inputStyle,marginBottom:0,flex:1}}/>
              <span style={{fontSize:12,color:"var(--texto-ter)"}}>g</span>
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
              <div style={{fontSize:12,fontWeight:600,color:"var(--primario)",marginBottom:8}}>🪨 Litiasis</div>
              {litiasis.length > 0 && (
                <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:8}}>
                  {litiasis.map((l, idx) => (
                    <div key={idx} style={{display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:12,color:"var(--texto)",background:"var(--superficie)",padding:"5px 9px",borderRadius:6}}>
                      <span>{[l.ubicacion, l.tercio, l.lateralidad, l.tamano?`${l.tamano} mm`:"", l.uh?`${l.uh} UH`:""].filter(Boolean).join(" · ")}</span>
                      <button onClick={()=>setLitiasis(litiasis.filter((_,i)=>i!==idx))} style={{background:"none",border:"none",color:"var(--peligro)",cursor:"pointer",fontSize:13,padding:0}}>✕</button>
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
                    <span style={{fontSize:11,color:"var(--texto-ter)"}}>mm</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:4,flex:1}}>
                    <input type="number" value={formLitiasis.uh} onChange={e=>setFormLitiasis({...formLitiasis,uh:e.target.value})} placeholder="Densidad" style={{...inputStyle,marginBottom:0}}/>
                    <span style={{fontSize:11,color:"var(--texto-ter)"}}>UH</span>
                  </div>
                </div>
                <button onClick={()=>{
                  if (!formLitiasis.ubicacion) return alert("Selecciona la ubicación");
                  setLitiasis([...litiasis, formLitiasis]);
                  setFormLitiasis({ ubicacion: "", tercio: "", lateralidad: "", tamano: "", uh: "" });
                }} style={{padding:"7px 12px",fontSize:12,background:"var(--exito)",color:"var(--texto-inv)",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>+ Agregar litiasis</button>
              </div>
            </div>
          )}

          {/* CONSTRUCTOR DE TUMOR (UROTAC, TAC TAP, Eco renal) */}
          {(nuevoEx.nombre === "UROTAC" || nuevoEx.nombre === "TAC" || nuevoEx.nombre === "Eco renal") && (
            <div style={{padding:"10px 12px",background:"var(--fondo-suave)",borderRadius:6,border:"0.5px solid var(--borde)",marginBottom:6}}>
              <div style={{fontSize:12,fontWeight:600,color:"var(--primario)",marginBottom:8}}>🎯 Tumor</div>
              {tumores.length > 0 && (
                <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:8}}>
                  {tumores.map((t, idx) => (
                    <div key={idx} style={{display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:12,color:"var(--texto)",background:"var(--superficie)",padding:"5px 9px",borderRadius:6}}>
                      <span>{[t.organo, t.sublocalizacion, t.tamano?`${t.tamano} cm`:""].filter(Boolean).join(" · ")}</span>
                      <button onClick={()=>setTumores(tumores.filter((_,i)=>i!==idx))} style={{background:"none",border:"none",color:"var(--peligro)",cursor:"pointer",fontSize:13,padding:0}}>✕</button>
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
                  <span style={{fontSize:11,color:"var(--texto-ter)"}}>cm</span>
                </div>
                <button onClick={()=>{
                  if (!formTumor.organo) return alert("Selecciona el órgano");
                  setTumores([...tumores, formTumor]);
                  setFormTumor({ organo: "", sublocalizacion: "", tamano: "" });
                }} style={{padding:"7px 12px",fontSize:12,background:"var(--exito)",color:"var(--texto-inv)",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>+ Agregar tumor</button>
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
    <div style={{padding:"16px",overflowY:"auto"}}>
      {/* Submenú (aparece al tocar de nuevo la pestaña "Pacientes") */}
      {toolsOpen && (
        <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap",alignItems:"center",padding:"10px 12px",background:"var(--fondo-suave)",border:"0.5px solid var(--borde)",borderRadius:10}}>
          {!soloLectura && <button onClick={()=>setVista("servicios")} style={{padding:"6px 12px",fontSize:12,background:"var(--superficie)",color:"var(--primario)",border:"0.5px solid var(--borde)",borderRadius:6,cursor:"pointer",fontWeight:500}}>⚙️ Servicios</button>}
          {!soloLectura && <button onClick={()=>setVista("nuevo")} style={{padding:"6px 12px",fontSize:12,background:"var(--primario)",color:"var(--texto-inv)",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>+ Nuevo</button>}
          <select value={filtroServicio} onChange={e=>setFiltroServicio(e.target.value)} style={{padding:"5px 10px",fontSize:11,borderRadius:6,border:"0.5px solid var(--borde)",background:"var(--superficie)",color:"var(--texto)",outline:"none",cursor:"pointer"}}>
            <option value="todos">Todos los servicios</option>
            {serviciosDisponibles.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)} style={{padding:"5px 10px",fontSize:11,borderRadius:6,border:"0.5px solid var(--borde)",background:"var(--superficie)",color:"var(--texto)",outline:"none",cursor:"pointer"}}>
            <option value="activo">Solo activos</option>
            <option value="alta">Solo dados de alta</option>
            <option value="todos">Todos</option>
          </select>
        </div>
      )}

      <div style={{fontSize:11,color:"var(--texto-ter)",marginBottom:10}}>
        {pacientesFiltrados.length} pacientes{filtroServicio!=="todos"?` · ${filtroServicio}`:""}{filtroEstado!=="activo"?` · ${filtroEstado==="alta"?"dados de alta":"todos"}`:""}
      </div>

      {loadingPacientes && (
        <div style={{textAlign:"center",padding:"30px",color:"var(--texto-ter)",fontSize:13}}>Cargando pacientes...</div>
      )}

      {!loadingPacientes && pacientesFiltrados.length === 0 && (
        <div style={{textAlign:"center",padding:"40px 20px",color:"var(--texto-ter)",fontSize:13,lineHeight:1.6}}>
          No hay pacientes en este contexto.<br/>
          {soloLectura ? "" : (esEquipo ? "Toca de nuevo la pestaña para agregar con + Nuevo" : "Toca de nuevo la pestaña y crea tu primer paciente con + Nuevo")}
        </div>
      )}

      {/* Vista kanban por servicio */}
      {!loadingPacientes && pacientesFiltrados.length > 0 && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:12}}>
          {Object.keys(porServicio).sort((a, b) => {
  const orden = ["MQ 1", "GINECOLOGÍA", "TRAUMATOLOGÍA", "NEUROCIRUGÍA", "UTI 1", "CIRUGÍA", "MQ 2", "UCI", "UTI 2", "MEDICINA", "TABLA - HOSPITALIZADOS" ];
  const ia = orden.indexOf(a);
  const ib = orden.indexOf(b);
  if (ia === -1 && ib === -1) return a.localeCompare(b);
  if (ia === -1) return 1;
  if (ib === -1) return -1;
  return ia - ib;
}).map(servicio => (
            <div key={servicio} style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"12px"}}>
              <div style={{fontSize:15,fontWeight:700,color:"var(--texto)",marginBottom:8,paddingBottom:6,borderBottom:"0.5px solid var(--fondo)"}}>
                {servicio} <span style={{color:"var(--texto-ter)",fontWeight:400,fontSize:13}}>({porServicio[servicio].length})</span>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {porServicio[servicio].map(p => (
                  <div key={p.id} onClick={()=>abrirFicha(p)} style={{background:p.estado==="activo"?"var(--fondo-suave)":"var(--neutro-bg)",borderRadius:6,padding:"10px 12px",cursor:"pointer",borderLeft:`3px solid ${p.estado==="activo"?"var(--primario)":"var(--neutro)"}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                      <div style={{fontSize:15,fontWeight:600,color:"var(--texto)"}}>
                        {p.iniciales} <span style={{fontSize:19,fontWeight:700,color:p.sexo==="F"?"var(--chip-rosa)":"var(--primario)"}}>{p.sexo==="F"?"♀":"♂"}</span>{p.estado_clinico && <span style={{marginLeft:5,fontSize:13}} title={p.estado_clinico}>{p.estado_clinico==="estable"?"🟢":p.estado_clinico==="regular"?"🟡":p.estado_clinico==="cuidado"?"🔴":""}</span>}{p.operado && <span style={{marginLeft:4}} title="Operado">🔪</span>}
                      </div>
                      <div style={{fontSize:13,fontWeight:600,color:"var(--primario)",background:"var(--chip-azul-bg)",padding:"2px 8px",borderRadius:8,whiteSpace:"nowrap"}}>Cama {p.cama}</div>
                    </div>
                    <div style={{fontSize:13,fontWeight:500,color:"var(--texto-sec)",marginBottom:3}}>{p.edad} años</div>
                    <div style={{fontSize:11,color:"var(--texto)",lineHeight:1.3,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{p.diagnostico}</div>
                    {p.estado === "alta" && <div style={{fontSize:9,color:"var(--neutro)",marginTop:4,fontStyle:"italic"}}>DADO DE ALTA</div>}
                    {esEquipo && <EncargadosPaciente paciente={p} miembros={miembrosEquipo} currentUser={currentUser} onActualizar={asignarEncargados} />}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
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
  const colorDeEncargado = (id) => {
    const paleta = [
      { bg: "var(--chip-azul-bg)", text: "var(--chip-azul)" },
      { bg: "var(--exito-bg)", text: "var(--exito)" },
      { bg: "var(--peligro-bg)", text: "var(--peligro)" },
      { bg: "var(--alerta-bg)", text: "var(--alerta)" },
      { bg: "var(--ccv-bg)", text: "var(--ccv)" },
      { bg: "var(--exito-bg)", text: "var(--exito)" },
      { bg: "var(--peligro-bg)", text: "var(--peligro)" },
      { bg: "var(--alerta-bg)", text: "var(--alerta)" },
      { bg: "var(--chip-indigo-bg)", text: "var(--chip-indigo)" },
      { bg: "var(--exito-bg)", text: "var(--exito)" },
    ];
    const idx = miembros.findIndex(x => x.perfiles?.id === id);
    return paleta[(idx < 0 ? 0 : idx) % paleta.length];
  };

  return (
    <div onClick={(e)=>e.stopPropagation()} style={{marginTop:6}}>
      <div style={{display:"flex",flexWrap:"wrap",gap:4,alignItems:"center"}}>
        {encargados.map(id => {
  const c = colorDeEncargado(id);
  return (
    <span key={id} style={{fontSize:12,background:c.bg,color:c.text,padding:"3px 9px",borderRadius:10,fontWeight:600}}>
      {nombreDe(id)}
    </span>
  );
})}
        <button onClick={()=>setAbierto(!abierto)} style={{fontSize:15,background:"var(--fondo-suave)",color:"var(--primario)",border:"0.5px solid var(--borde)",borderRadius:"50%",width:24,height:24,cursor:"pointer",fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1,padding:0}}>
          {abierto ? "×" : "+"}
        </button>
      </div>
      {abierto && (
        <div style={{marginTop:4,background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:6,padding:"4px",maxHeight:140,overflowY:"auto"}}>
          {miembros.map(m => {
            const id = m.perfiles?.id;
            const asignado = encargados.includes(id);
            return (
              <div key={id} onClick={()=>toggle(id)} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 4px",cursor:"pointer",fontSize:11,color:"var(--texto)"}}>
                <span style={{width:14,height:14,borderRadius:3,border:"1px solid var(--borde)",background:asignado?"var(--primario)":"var(--superficie)",color:"var(--texto-inv)",fontSize:10,display:"flex",alignItems:"center",justifyContent:"center"}}>{asignado?"✓":""}</span>
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
  return (
    <div onClick={onClose} style={{position:"absolute",inset:0,background:"rgba(26,58,92,0.85)",zIndex:50,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px",borderRadius:"var(--border-radius-lg)"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"var(--superficie)",borderRadius:12,maxWidth:720,width:"100%",overflow:"hidden"}}>
        <div style={{padding:"10px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"0.5px solid var(--borde)"}}>
          <div style={{fontSize:13,fontWeight:500,color:"var(--texto)"}}>{video.titulo}</div>
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
        <div>
          <div style={{fontSize:22,fontWeight:700,color:"var(--texto)",marginBottom:2}}>Biblioteca quirúrgica</div>
          <div style={{fontSize:13,color:"var(--texto-sec)"}}>{videos.length} videos</div>
        </div>
        {isAdmin && <button onClick={()=>setAgregando(!agregando)} style={{padding:"7px 12px",fontSize:12,fontWeight:500,background: agregando?"var(--superficie)":"var(--primario)",color: agregando?"var(--primario)":"var(--texto-inv)",border: agregando?"1px solid var(--primario)":"none",borderRadius:8,cursor:"pointer"}}>{agregando ? "Cancelar" : "+ Agregar"}</button>}
      </div>
      {agregando && isAdmin && (
        <div style={{background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,padding:"14px",marginBottom:14}}>
          <input value={nuevo.titulo} onChange={e=>setNuevo({...nuevo,titulo:e.target.value})} placeholder="Título" style={inputStyle}/>
          <select value={nuevo.categoria} onChange={e=>setNuevo({...nuevo,categoria:e.target.value})} style={inputStyle}>{CATEGORIAS_VIDEO.filter(c=>c!=="Todas").map(c=><option key={c}>{c}</option>)}</select>
          <input value={nuevo.url} onChange={e=>setNuevo({...nuevo,url:e.target.value})} placeholder="URL YouTube" style={inputStyle}/>
          <input value={nuevo.autor} onChange={e=>setNuevo({...nuevo,autor:e.target.value})} placeholder="Autor (opcional)" style={inputStyle}/>
          <textarea value={nuevo.descripcion} onChange={e=>setNuevo({...nuevo,descripcion:e.target.value})} placeholder="Descripción" rows={2} style={{...inputStyle,resize:"none"}}/>
          {errorAdd && <div style={{fontSize:12,color:"var(--peligro)",background:"var(--peligro-bg)",padding:"8px 10px",borderRadius:6,marginBottom:8}}>{errorAdd}</div>}
          <button onClick={agregarVideo} style={{...btnPrimary, marginTop:0}}>Guardar video</button>
        </div>
      )}
      <input value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="Buscar..." style={{...inputStyle, marginBottom:8}}/>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
        {CATEGORIAS_VIDEO.map(c => <button key={c} onClick={()=>setFiltro(c)} style={{padding:"5px 10px",fontSize:11,fontWeight:filtro===c?500:400,borderRadius:14,cursor:"pointer",border:filtro===c?"none":"0.5px solid var(--borde)",background:filtro===c?"var(--primario)":"var(--superficie)",color:filtro===c?"var(--texto-inv)":"var(--texto-sec)"}}>{c}</button>)}
      </div>
      {filtrados.length === 0 ? (
        <div style={{textAlign:"center",padding:"40px 0",color:"var(--texto-ter)",fontSize:13}}>No hay videos</div>
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
                  <div style={{fontSize:13,fontWeight:500,color:"var(--texto)",marginBottom:3,lineHeight:1.3}}>{v.titulo}</div>
                  <div style={{fontSize:11,color:"var(--texto-sec)",marginBottom:6}}>{v.categoria} · {v.autor}</div>
                  <div style={{fontSize:11,color:"var(--texto-ter)",lineHeight:1.4,flex:1}}>{v.descripcion}</div>
                  {isAdmin && <button onClick={()=>eliminarVideo(v.id)} style={{marginTop:8,padding:"5px 8px",fontSize:11,background:"var(--superficie)",color:"var(--peligro)",border:"0.5px solid var(--peligro-borde)",borderRadius:6,cursor:"pointer",alignSelf:"flex-start"}}>Eliminar</button>}
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

  return (
    <div style={{position:"relative"}}>
      <button onClick={abrir} title="Notificaciones" style={{width:38,height:38,borderRadius:"50%",background:"var(--superficie)",border:"0.5px solid var(--borde)",cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",padding:0,position:"relative"}}>
        🔔
        {noLeidas > 0 && <span style={{position:"absolute",top:-3,right:-3,minWidth:17,height:17,borderRadius:9,background:"var(--peligro)",color:"var(--texto-inv)",fontSize:10,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 4px"}}>{noLeidas}</span>}
      </button>
      {abierto && (
        <div style={{position:"absolute",top:46,right:0,background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:10,minWidth:290,maxWidth:340,maxHeight:380,overflowY:"auto",zIndex:30,boxShadow:"0 4px 14px rgba(0,0,0,0.15)"}}>
          <div style={{padding:"10px 14px",borderBottom:"0.5px solid var(--borde-suave)",fontSize:13,fontWeight:600,color:"var(--texto)"}}>Notificaciones</div>
          {notifs.length === 0 && <div style={{padding:"18px 14px",fontSize:12,color:"var(--texto-ter)",fontStyle:"italic"}}>Sin notificaciones</div>}
          {notifs.map(n => (
            <div key={n.id} style={{padding:"10px 14px",borderBottom:"0.5px solid var(--borde-suave)",background:n.leida?"transparent":"var(--fondo-suave)"}}>
              <div style={{fontSize:12,color:"var(--texto)",lineHeight:1.4}}>{iconoTipo[n.tipo]||"🔔"} {n.texto}</div>
              <div style={{fontSize:10,color:"var(--texto-ter)",marginTop:3}}>{new Date(n.created_at).toLocaleString("es-CL",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</div>
            </div>
          ))}
        </div>
      )}
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
  const [tab, setTab] = useState(() => {
  try { return localStorage.getItem("uro_tab") || "chat"; }
  catch { return "chat"; }
});
  const [tema, setTema] = useState(() => {
    try { return localStorage.getItem("uro_tema") || "light"; }
    catch { return "light"; }
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", tema);
    try { localStorage.setItem("uro_tema", tema); } catch {}
  }, [tema]);
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
  const bottomRef = useRef(null);

  useEffect(() => {
  try { localStorage.setItem("uro_tab", tab); }
  catch {}
}, [tab]);

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
  getSession().then((result) => {
    if (result.ok && result.session) {
      setSession(result.session);
      cargarPerfil(result.session);
    }
    setLoadingSession(false);
  });

  // Suscribirse a cambios futuros (login, logout)
  const unsubscribe = onAuthChange((event, newSession) => {
    setSession(newSession);
    if (newSession) {
      cargarPerfil(newSession);
    } else {
      setCurrentUser(null);
    }
  });

  return () => unsubscribe();
}, []);
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
const cargarPerfil = async (sessionData) => {
  if (!sessionData?.user) {
    setCurrentUser(null);
    return;
  }
  
  const result = await getPerfil(sessionData.user.id);
  
  if (!result.ok) {
    // Si no se pudo cargar el perfil, cerrar sesión
    console.error("Error al cargar perfil:", result.error);
    await logoutUser();
    setCurrentUser(null);
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
  // Respetar la pestaña guardada; si no hay, usar la por defecto según rol
  let tabGuardado = null;
  try { tabGuardado = localStorage.getItem("uro_tab"); } catch {}
  const tabsValidos = tabsPorRol(perfil.rol).map(t => t[0]);
  if (tabGuardado && tabsValidos.includes(tabGuardado)) {
    setTab(tabGuardado);
  } else {
    setTab(perfil.rol === "admin" ? "admin" : "chat");
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
// Cargar mis servicios (pisos/áreas del hospital)
const serviciosResult = await listarMisServicios(perfil.id);
if (serviciosResult.ok) {
  setMisServiciosLista(serviciosResult.servicios);
}
// Cargar conocimiento (la IA lo usa para todos)
const conocimientoResult = await listarConocimiento();
if (conocimientoResult.ok) {
  setConocimiento(conocimientoResult.conocimiento);
}

// Cargar videos
const videosResult = await listarVideos();
if (videosResult.ok) {
  setVideos(videosResult.videos);
}
// Al abrir el chat, siempre partir en una conversación nueva con el saludo de Uros
if (perfil.rol !== "admin") {
  setConversacionActual(null);
  setMessages([{ role:"assistant", content:saludoUros(perfil.nombre) }]);
}
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

  try {
    const modoIns = modo === "precisa"
      ? "\n\nMODO PRECISA: Responde en máximo 3-4 líneas (aproximadamente 50 palabras). Sé estricto con esta extensión: solo lo esencial, directo al grano, sin introducción ni rodeos. NO te extiendas."
      : "\n\nMODO EXPLICATIVA: respuesta completa con contexto y evidencia.";
    let ctx = "";
    if (tieneFuentes) {
      ctx += "\n\n=== BASE DE CONOCIMIENTO ===\nResponde ÚNICA Y EXCLUSIVAMENTE con la información contenida en estos documentos. NO uses conocimiento externo ni general. Si los documentos no contienen lo suficiente para responder, dilo explícitamente. NO menciones la fuente ni el título dentro de tu respuesta (se muestra aparte automáticamente).\n\n" + docsRelevantes.map((d,i) => `--- DOC ${i+1}: ${d.titulo}${d.fuente ? " ("+d.fuente+")" : ""} ---\n${(d.contenido||"").slice(0,8000)}`).join("\n\n");
    } else if (!consultaCirugias && !consultaPacientes) {
      // Pregunta clínica/teórica pero SIN documentos relevantes en la base: modo estricto
      ctx += "\n\n=== SIN INFORMACIÓN EN LA BASE ===\nNo se encontraron documentos relevantes en la base de conocimiento para esta consulta. Responde EXACTAMENTE con este mensaje, sin agregar información propia: \"No tengo información sobre esto en mi base de conocimiento. Solo puedo responder con los documentos que han sido cargados en UroSearch.\"";
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
    if (videosRelevantes.length > 0) respuesta.videos = videosRelevantes;
    if (tieneFuentes) {
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
const cargarMapaGuardado = (mapa) => {
  setMapaActual(mapa.contenido);
  setMapaTema(mapa.tema || mapa.titulo);
};
  // Pantalla de carga mientras se verifica la sesión inicial
if (loadingSession) {
  return (
    <div style={{fontFamily:"var(--font-sans)",minHeight:"100vh",background:"var(--fondo)",borderRadius:"var(--border-radius-lg)",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center",color:"var(--texto-sec)",fontSize:14}}>
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

  const tabs = tabsPorRol(currentUser.rol, pendientesCount);

  return (
    <div style={{fontFamily:"var(--font-sans)",height:"100vh",display:"flex",flexDirection:"column",overflow:"hidden",background:"var(--fondo)",borderRadius:"var(--border-radius-lg)"}}>
      <div style={{padding:"16px 20px 0",borderBottom:"0.5px solid var(--borde)",background:"var(--header-bg)",borderRadius:"var(--border-radius-lg) var(--border-radius-lg) 0 0",position:"relative"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <LogoUroSearch size={40}/>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{fontWeight:600,fontStyle:"italic",fontFamily:"Georgia, 'Times New Roman', serif",fontSize:21,color:"var(--texto)",letterSpacing:"-0.3px"}}>UroSearch</div>
                {isAdmin && <span style={{fontSize:10,fontWeight:600,padding:"2px 6px",background:"var(--primario)",color:"var(--texto-inv)",borderRadius:4}}>ADMIN</span>}
              </div>
              <div style={{fontSize:14,color:"var(--texto-sec)"}}>Asistente Clínico de Urología</div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <NotificationBell currentUser={currentUser}/>
            <button onClick={()=>setMenuOpen(!menuOpen)} style={{display:"flex",alignItems:"center",gap:8,background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:24,padding:"5px 14px 5px 5px",cursor:"pointer"}}>
              <div style={{width:38,height:38,borderRadius:"50%",background:isAdmin?"var(--navy-fijo)":"var(--primario)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:600,color:"var(--texto-inv)"}}>{userInitials}</div>
              <span style={{fontSize:14,color:"var(--texto)",fontWeight:500}}>▾</span>
            </button>
          </div>
        </div>
        {menuOpen && (
          <div style={{position:"absolute",top:60,right:20,background:"var(--superficie)",border:"0.5px solid var(--borde)",borderRadius:8,padding:"8px 0",minWidth:220,zIndex:10,boxShadow:"0 2px 8px rgba(0,0,0,0.08)"}}>
            <div style={{padding:"8px 14px",borderBottom:"0.5px solid var(--fondo)"}}>
              <div style={{fontSize:13,fontWeight:500,color:"var(--texto)"}}>{currentUser.nombre}</div>
              <div style={{fontSize:11,color:"var(--texto-sec)"}}>{currentUser.correo}</div>
              <div style={{fontSize:11,color:"var(--texto-ter)",marginTop:2}}>{currentUser.especialidad}{isAdmin?" · Administrador":""}</div>
            </div>
            <button onClick={()=>setTema(tema==="light"?"dark":"light")} style={{width:"100%",padding:"8px 14px",fontSize:13,textAlign:"left",background:"none",border:"none",color:"var(--texto)",cursor:"pointer",display:"flex",alignItems:"center",gap:8}}>
              {tema==="light" ? "🌙 Modo oscuro" : "☀️ Modo claro"}
            </button>
            <button onClick={handleLogout} style={{width:"100%",padding:"8px 14px",fontSize:13,textAlign:"left",background:"none",border:"none",color:"var(--peligro)",cursor:"pointer"}}>Cerrar sesión</button>
          </div>
        )}
        <div style={{display:"flex",gap:0,overflowX:"auto"}}>
          {tabs.map(([id,label]) => (
            <button key={id} onClick={() => setTab(id)} style={{flex:"1 0 auto",padding:"13px 10px",fontSize:14,fontWeight:tab===id?600:500,background:"transparent",border:"none",borderBottom:tab===id?"3px solid var(--primario)":"3px solid transparent",color:tab===id?"var(--primario)":"var(--texto-sec)",cursor:"pointer",whiteSpace:"nowrap"}}>{label}</button>
          ))}
        </div>
      </div>

      {tab==="admin" && isAdmin && <AdminPanel/>}
      {tab==="hospital" && <HospitalPanel pacientes={pacientes} setPacientes={setPacientes} currentUser={currentUser} tablaCirugias={tablaCirugias} setTablaCirugias={setTablaCirugias} misServiciosLista={misServiciosLista} setMisServiciosLista={setMisServiciosLista} loadingPacientes={loadingPacientes} setLoadingPacientes={setLoadingPacientes} loadingCirugias={loadingCirugias} setLoadingCirugias={setLoadingCirugias} loadingPendientes={loadingPendientes} setLoadingPendientes={setLoadingPendientes} pendientes={pendientes} setPendientes={setPendientes} equipos={equipos} setEquipos={setEquipos} invitacionesPendientes={invitacionesPendientes} setInvitacionesPendientes={setInvitacionesPendientes} users={users}/>}
      {tab==="conocimiento" && <ConocimientoHub conocimiento={conocimiento} setConocimiento={setConocimiento} isAdmin={isAdmin} currentUser={currentUser} videos={videos} setVideos={setVideos} setPlayingVideo={setPlayingVideo} mapaTema={mapaTema} setMapaTema={setMapaTema} mapaActual={mapaActual} setMapaActual={setMapaActual} mapaLoading={mapaLoading} generarMapa={generarMapa} topicOpen={topicOpen} setTopicOpen={setTopicOpen} mapasGuardados={mapasGuardados} onGuardarMapa={handleGuardarMapa} onEliminarMapa={handleEliminarMapa} onCargarMapaGuardado={cargarMapaGuardado} guardandoMapa={guardandoMapa}/>}
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
        fontSize:12,
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
          fontSize:11,
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
    <div style={{textAlign:"center",padding:"40px 16px",color:"var(--texto-ter)",fontSize:13}}>
      Cargando conversación...
    </div>
  )}
{!loadingConversaciones && messages.length === 0 && isAdmin && <div style={{textAlign:"center",padding:"32px 16px",color:"var(--texto-ter)",fontSize:13,lineHeight:1.6}}><Uros expresion="hola" size={96} style={{margin:"0 auto 12px"}}/>Como admin puedes usar el chat. Escribe una consulta.</div>}

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
                <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",borderRadius:"16px 16px 16px 4px",background:"var(--superficie)",fontSize:14,color:"var(--texto-ter)",border:"0.5px solid var(--borde)"}}>
                  <Uros expresion="pensando" size={26}/> Consultando...
                </div>
              </div>
            )}
            <div ref={bottomRef}/>
          </div>
          <div style={{padding:"8px 12px 12px",borderTop:"0.5px solid var(--borde)"}}>
            <div style={{display:"flex",gap:6,marginBottom:8,alignItems:"center"}}>
              {[["precisa","⚡ Precisa"],["explicativa","📖 Explicativa"]].map(([id,label])=><button key={id} onClick={()=>setModo(id)} style={{padding:"5px 12px",fontSize:12,fontWeight:modo===id?500:400,borderRadius:8,cursor:"pointer",border:modo===id?"none":"0.5px solid var(--borde)",background:modo===id?"var(--primario)":"var(--superficie)",color:modo===id?"var(--texto-inv)":"var(--texto-sec)"}}>{label}</button>)}
              <span style={{fontSize:11,color:"var(--texto-ter)",marginLeft:4}}>{modo==="precisa" ? "Definición breve" : "Explicación completa"}</span>
            </div>
            <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
              <textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMsg();}}} placeholder="Escribe tu consulta..." rows={2} style={{flex:1,resize:"none",padding:"10px 12px",fontSize:14,borderRadius:8,border:"0.5px solid var(--borde)",background:"var(--superficie)",color:"var(--texto)",lineHeight:1.5,outline:"none",fontFamily:"inherit"}}/>
              <button onClick={sendMsg} disabled={loading||!input.trim()} style={{padding:"10px 16px",borderRadius:8,border:"none",background:loading||!input.trim()?"var(--borde)":"var(--primario)",color:"var(--texto-inv)",fontSize:14,cursor:loading||!input.trim()?"default":"pointer",fontWeight:500,whiteSpace:"nowrap"}}>Enviar</button>
            </div>
            <div style={{fontSize:10.5,color:"var(--texto-ter)",lineHeight:1.4,marginTop:8,textAlign:"center"}}>
              ⚠️ Información de apoyo clínico. No reemplaza el juicio médico ni la evaluación individualizada del paciente.
            </div>
          </div>
        </div>
      )}

      {playingVideo && <VideoPlayer video={playingVideo} onClose={()=>setPlayingVideo(null)}/>}

      <div style={{padding:"8px 16px",borderTop:"0.5px solid var(--borde)",background:"var(--header-bg)",borderRadius:"0 0 var(--border-radius-lg) var(--border-radius-lg)",display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:10,fontStyle:"italic",color:"var(--texto-sec)"}}>
        <span>Creado por Dr. Sebastián Gárate Ortega - Residente de Urología UACh</span>
        <span style={{fontStyle:"normal",fontFamily:"monospace",fontSize:9,color:"var(--texto-ter)",letterSpacing:"0.3px"}}>{VERSION}</span>
      </div>
    </div>
  );
}

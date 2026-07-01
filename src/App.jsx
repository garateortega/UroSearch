import { useState, useRef, useEffect } from "react";
import { register as registerUser, login as loginUser, logout as logoutUser, getPerfil, getSession, onAuthChange, listarPerfiles, cambiarEstadoUsuario, eliminarUsuario } from "./auth";
import { listarConversaciones, crearConversacion, cargarMensajes, agregarMensaje, actualizarTitulo, eliminarConversacion, generarTituloDesdeMensaje } from "./chat";
import { listarMapas, guardarMapa, eliminarMapa } from "./mapas";
import { listarMisEquipos, listarMisInvitaciones, listarMiembros, listarInvitacionesEquipo, crearEquipo, eliminarEquipo, salirDelEquipo, expulsarMiembro, buscarUsuarioPorCorreo, crearInvitacion, aceptarInvitacion, rechazarInvitacion } from "./equipos";
import { listarPacientes, crearPaciente, actualizarPaciente, eliminarPaciente, listarEvoluciones, crearEvolucion, eliminarEvolucion, listarExamenes, crearExamen, eliminarExamen, listarMisServicios, crearServicio, eliminarServicio, crearServiciosBulk, listarServiciosEquipo } from "./pacientes";
import { listarCirugias, crearCirugia, crearCirugiasBulk, actualizarCirugia, eliminarCirugia, listarPendientes, crearPendiente, actualizarPendiente, eliminarPendiente } from "./cirugias";
import { listarConocimiento, crearConocimiento, eliminarConocimiento, listarVideos, crearVideo, eliminarVideo as eliminarVideoSupabase, listarPreguntas, crearPregunta, eliminarPregunta, crearChunks, listarChunks } from "./biblioteca";

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

const SYSTEM_PROMPT = `Eres un asistente clínico especializado en urología. Respondes en español clínico, con precisión y concisión.

Áreas: urooncología, derivaciones urinarias, litiasis e infecciones urológicas, trasplante renal, urología funcional, farmacología urológica, guías EAU y AUA.

Al responder:
1. Sé directo y clínico.
2. Cuando sea relevante, menciona guías EAU/AUA o evidencia.
3. Estructura con claridad: opciones, indicaciones, contraindicaciones.
4. Para fármacos, incluye dosis habituales.
5. Para mapas conceptuales: responde SOLO con JSON: {"tipo":"mapa","titulo":"...","nodo_central":"...","ramas":[{"rama":"...","subnodos":["...","..."]}]}

IMPORTANTE: al final de cada respuesta clínica agrega: "⚠️ Esta información es de apoyo clínico y no reemplaza el juicio médico ni la evaluación individualizada del paciente."`;

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
      <circle cx="25" cy="25" r="23.5" fill="#fff" stroke="#1a4a7c" strokeWidth="2"/>
      <path d="M 15 11 C 10 11, 8 14, 8 19 C 8 24, 10 27, 15 27 C 17.5 27, 19 26, 19.5 24 C 20 21, 20 16, 19.5 13.5 C 19 12, 17.5 11, 15 11 Z" fill="#1a4a7c"/>
      <path d="M 17 27 C 19 30, 16 33, 18.5 36 C 21 39, 23 40, 25 42" stroke="#1a4a7c" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
      <path d="M 35 11 C 40 11, 42 14, 42 19 C 42 24, 40 27, 35 27 C 32.5 27, 31 26, 30.5 24 C 30 21, 30 16, 30.5 13.5 C 31 12, 32.5 11, 35 11 Z" fill="#7ec0e8"/>
      <path d="M 33 27 C 31 30, 34 33, 31.5 36 C 29 39, 27 40, 25 42" stroke="#7ec0e8" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
      <path d="M 19 43 C 19 41.5, 21 40.5, 25 40.5 C 22 42, 28 45.5, 25 47 C 21 47, 19 45.5, 19 43 Z" fill="#1a4a7c"/>
      <path d="M 31 43 C 31 41.5, 29 40.5, 25 40.5 C 22 42, 28 45.5, 25 47 C 29 47, 31 45.5, 31 43 Z" fill="#7ec0e8"/>
    </svg>
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
                  <rect x={sx-44} y={sy-13} width="88" height="26" rx="6" fill="#fff" stroke={color} strokeWidth="0.8" strokeOpacity="0.6"/>
                  <text x={sx} y={sy+1} textAnchor="middle" dominantBaseline="central" fontSize="10" fill="#555">{s}</text>
                </g>
              );
            })}
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r="46" fill="#fff" stroke="#1a6fb5" strokeWidth="1.5"/>
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize="13" fontWeight="500" fill="#1a3a5c">{data.nodo_central}</text>
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
      background: "#fff",
      borderRight: "0.5px solid #b8d8ef",
      display: "flex",
      flexDirection: "column",
      zIndex: 20,
      boxShadow: "2px 0 8px rgba(0,0,0,0.05)",
      borderRadius: "var(--border-radius-lg) 0 0 var(--border-radius-lg)",
    }}>
      {/* Header */}
      <div style={{
        padding: "14px 16px",
        borderBottom: "0.5px solid #b8d8ef",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        background: "#f0f8fd",
      }}>
        <div style={{fontSize:14, fontWeight:600, color:"#1a3a5c"}}>Mis conversaciones</div>
        <button onClick={onCerrar} style={{
          background: "none",
          border: "none",
          fontSize: 18,
          color: "#7aa3c4",
          cursor: "pointer",
          padding: 0,
          lineHeight: 1,
        }}>✕</button>
      </div>

      {/* Botón nueva conversación */}
      <div style={{padding: "10px 12px", borderBottom: "0.5px solid #e8f3fb"}}>
        <button onClick={onNueva} style={{
          width: "100%",
          padding: "9px",
          fontSize: 13,
          fontWeight: 500,
          background: "#1a6fb5",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          cursor: "pointer",
        }}>+ Nueva conversación</button>
      </div>

      {/* Lista de conversaciones */}
      <div style={{flex: 1, overflowY: "auto", padding: "8px 6px"}}>
        {conversaciones.length === 0 ? (
          <div style={{textAlign:"center", padding:"30px 16px", color:"#7aa3c4", fontSize:12, lineHeight:1.5}}>
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
                  background: esActual ? "#e0e9f5" : "transparent",
                  border: esActual ? "0.5px solid #1a6fb5" : "0.5px solid transparent",
                  marginBottom: 4,
                  position: "relative",
          
                }}
                onMouseEnter={e => {
                  if (!esActual) e.currentTarget.style.background = "#f0f8fd";
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
                  color: "#1a3a5c",
                  marginBottom: 3,
                  lineHeight: 1.3,
                  paddingRight: 24,
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}>{conv.titulo || "Sin título"}</div>
                <div style={{fontSize: 10, color: "#7aa3c4"}}>
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
                    color: "#c0392b",
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
function ChatBubble({ msg, userInitials, onPlayVideo }) {
  const isUser = msg.role === "user";
  const bubbleStyle = { padding:"10px 14px", borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px", background: isUser ? "#1a6fb5" : "#fff", color: isUser ? "#fff" : "#1a3a5c", fontSize:14, lineHeight:1.6, border: isUser ? "none" : "0.5px solid #b8d8ef", whiteSpace:"pre-wrap" };
  return (
    <div style={{display:"flex", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom:"12px"}}>
      {!isUser && <div style={{width:30,height:30,borderRadius:"50%",background:"#1a6fb5",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:500,color:"#fff",marginRight:8,flexShrink:0,marginTop:2}}>U</div>}
      <div style={{maxWidth:"82%"}}>
        <div style={bubbleStyle}>{msg.content}</div>
        {msg.cirugiasConsulta && (
          <div style={{marginTop:6,padding:"7px 10px",background:"#e0e9f5",border:"0.5px solid #b8c8de",borderRadius:8}}>
            <div style={{fontSize:10,fontWeight:500,color:"#1a4a7c"}}>📅 Información de tu tabla quirúrgica · {msg.cirugiasConsulta.cantidad} {msg.cirugiasConsulta.cantidad === 1 ? "cirugía" : "cirugías"} en {msg.cirugiasConsulta.rango}</div>
          </div>
        )}
        {msg.pacientesConsulta && (
          <div style={{marginTop:6,padding:"7px 10px",background:"#f5e0f0",border:"0.5px solid #e0b8d0",borderRadius:8}}>
            <div style={{fontSize:10,fontWeight:500,color:"#7a3a6b"}}>🏥 Información de tus pacientes · {msg.pacientesConsulta.cantidad} {msg.pacientesConsulta.cantidad === 1 ? "paciente" : "pacientes"}</div>
          </div>
        )}
        {msg.fuentes && msg.fuentes.length > 0 && (
          <div style={{marginTop:6,padding:"7px 10px",background:"#e0f5ec",border:"0.5px solid #a8d4be",borderRadius:8}}>
            <div style={{fontSize:10,fontWeight:500,color:"#1a6f5c",marginBottom:4}}>📚 Basado en tu base de conocimiento:</div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              {msg.fuentes.map(f => <div key={f.id} style={{fontSize:11,color:"#1a6f5c",lineHeight:1.4}}>• <strong>{f.titulo}</strong> <span style={{color:"#7aa3a4"}}>({f.categoria})</span></div>)}
            </div>
          </div>
        )}
        {msg.videos && msg.videos.length > 0 && (
          <div style={{marginTop:8,padding:"10px 12px",background:"#f0f8fd",border:"0.5px solid #b8d8ef",borderRadius:10}}>
            <div style={{fontSize:11,fontWeight:500,color:"#4a7eab",marginBottom:8}}>🎬 Videos sugeridos de la biblioteca</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {msg.videos.map(v => {
                const ytId = getYouTubeId(v.url);
                const thumb = ytId ? `https://img.youtube.com/vi/${ytId}/default.jpg` : null;
                return (
                  <div key={v.id} onClick={()=>onPlayVideo(v)} style={{display:"flex",alignItems:"center",gap:10,padding:"6px",background:"#fff",borderRadius:8,cursor:"pointer",border:"0.5px solid #d0e9f8"}}>
                    {thumb && <img src={thumb} alt="" style={{width:60,height:45,objectFit:"cover",borderRadius:4,flexShrink:0}}/>}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:500,color:"#1a3a5c",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v.titulo}</div>
                      <div style={{fontSize:10,color:"#7aa3c4"}}>{v.categoria} · {v.autor}</div>
                    </div>
                    <div style={{fontSize:13,color:"#1a6fb5"}}>▶</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {isUser && <div style={{width:30,height:30,borderRadius:"50%",background:"#3a8dc5",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:500,color:"#fff",marginLeft:8,flexShrink:0,marginTop:2}}>{userInitials}</div>}
    </div>
  );
}

const inputStyle = { width:"100%", padding:"10px 12px", fontSize:14, borderRadius:8, border:"1px solid #b8d8ef", background:"#fff", color:"#1a3a5c", outline:"none", boxSizing:"border-box", marginBottom:10, fontFamily:"inherit" };
const labelStyle = { fontSize:12, fontWeight:500, color:"#4a7eab", marginBottom:4, display:"block" };
const btnPrimary = { width:"100%", padding:"11px", fontSize:14, fontWeight:500, background:"#1a6fb5", color:"#fff", border:"none", borderRadius:8, cursor:"pointer", marginTop:6 };
const btnSecondary = { width:"100%", padding:"11px", fontSize:14, fontWeight:500, background:"#fff", color:"#1a6fb5", border:"1px solid #1a6fb5", borderRadius:8, cursor:"pointer", marginTop:8 };

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
      <div style={{padding:"48px 32px", textAlign:"center"}}>
        <div style={{display:"flex",justifyContent:"center",marginBottom:24}}><LogoUroSearch size={110}/></div>
        <div style={{fontSize:42, fontWeight:600, fontStyle:"italic", fontFamily:"Georgia, 'Times New Roman', serif", color:"#1a3a5c", letterSpacing:"-0.5px", marginBottom:8}}>UroSearch</div>
        <div style={{fontSize:17, color:"#4a7eab", marginBottom:38, lineHeight:1.5}}>Asistente Clínico de Urología</div>
        <div style={{maxWidth:340, margin:"0 auto"}}>
          <button onClick={()=>{setView("login"); setError(""); setInfo("");}} style={{...btnPrimary, padding:"14px", fontSize:16}}>Iniciar sesión</button>
          <button onClick={()=>{setView("register"); setError(""); setInfo("");}} style={{...btnSecondary, padding:"14px", fontSize:16}}>Solicitar cuenta</button>
        </div>
        <div style={{fontSize:12, color:"#7aa3c4", marginTop:36, padding:"0 20px", lineHeight:1.5}}>Acceso restringido a equipo clínico<br/>urológico autorizado</div>
        <div style={{fontSize:12, fontStyle:"italic", color:"#4a7eab", marginTop:24, paddingTop:16, borderTop:"0.5px solid #b8d8ef"}}>Creado por Dr. Sebastián Gárate Ortega - Residente de Urología UACh</div>
        <div style={{fontSize:9, fontFamily:"monospace", color:"#7aa3c4", marginTop:4, letterSpacing:"0.3px"}}>{VERSION}</div>
      </div>
    );
  }

  if (view === "login") {
    return (
      <div style={{padding:"24px 24px 32px"}}>
        <button onClick={()=>setView("welcome")} style={{background:"none",border:"none",color:"#4a7eab",fontSize:13,cursor:"pointer",marginBottom:14,padding:0}}>← Volver</button>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:24}}>
          <LogoUroSearch size={36}/>
          <div style={{fontSize:22,fontWeight:600,fontStyle:"italic",fontFamily:"Georgia, 'Times New Roman', serif",color:"#1a3a5c"}}>Iniciar sesión</div>
        </div>
        <label style={labelStyle}>Correo electrónico</label>
        <input type="email" value={form.correo} onChange={e=>setForm({...form,correo:e.target.value})} placeholder="tu.correo@hbv.cl" style={inputStyle} disabled={loading}/>
        <label style={labelStyle}>Contraseña</label>
        <input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} onKeyDown={e=>{if(e.key==="Enter")handleLogin();}} placeholder="••••••••" style={inputStyle} disabled={loading}/>
        {error && <div style={{fontSize:12,color:"#c0392b",background:"#fde8e6",padding:"8px 10px",borderRadius:6,marginBottom:6}}>{error}</div>}
        <button onClick={handleLogin} disabled={loading} style={{...btnPrimary, opacity: loading ? 0.6 : 1, cursor: loading ? "default" : "pointer"}}>
          {loading ? "Ingresando..." : "Ingresar"}
        </button>
        <div style={{textAlign:"center",fontSize:12,color:"#4a7eab",marginTop:14}}>¿No tienes cuenta? <button onClick={()=>{setView("register");setError("");setInfo("");}} style={{background:"none",border:"none",color:"#1a6fb5",fontWeight:500,cursor:"pointer",padding:0,fontSize:12}}>Solicítala aquí</button></div>
      </div>
    );
  }

  return (
    <div style={{padding:"24px 24px 32px"}}>
      <button onClick={()=>setView("welcome")} style={{background:"none",border:"none",color:"#4a7eab",fontSize:13,cursor:"pointer",marginBottom:14,padding:0}}>← Volver</button>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
        <LogoUroSearch size={36}/>
        <div style={{fontSize:22,fontWeight:600,fontStyle:"italic",fontFamily:"Georgia, 'Times New Roman', serif",color:"#1a3a5c"}}>Solicitar cuenta</div>
      </div>
      <div style={{fontSize:12,color:"#4a7eab",marginBottom:18,lineHeight:1.5}}>Tu cuenta será revisada por el administrador antes de ser activada.</div>
      <label style={labelStyle}>Nombre completo</label>
      <input value={form.nombre} onChange={e=>setForm({...form,nombre:e.target.value})} placeholder="Dr. Juan Pérez" style={inputStyle} disabled={loading}/>
      <label style={labelStyle}>Correo electrónico</label>
      <input type="email" value={form.correo} onChange={e=>setForm({...form,correo:e.target.value})} placeholder="tu.correo@hbv.cl" style={inputStyle} disabled={loading}/>
      <label style={labelStyle}>Especialidad / cargo</label>
      <select value={form.especialidad} onChange={e=>setForm({...form,especialidad:e.target.value})} style={inputStyle} disabled={loading}>
        {ESPECIALIDADES.map(e=><option key={e}>{e}</option>)}
      </select>
      <label style={labelStyle}>Documento de respaldo</label>
      <div style={{fontSize:11,color:"#7aa3c4",marginBottom:6}}>Adjunta título de especialidad o carta de residencia (PDF/JPG/PNG, máx. 5 MB)</div>
      <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleFile} style={{display:"none"}} disabled={loading}/>
      <button onClick={()=>fileRef.current?.click()} disabled={loading} style={{width:"100%",padding:"10px",fontSize:13,background:"#fff",color:"#1a6fb5",border:"1px dashed #1a6fb5",borderRadius:8,cursor:loading?"default":"pointer",marginBottom:10,textAlign:"left",opacity:loading?0.6:1}}>📎 {form.documentoNombre || "Seleccionar archivo..."}</button>
      <label style={labelStyle}>Contraseña</label>
      <input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Mínimo 6 caracteres" style={inputStyle} disabled={loading}/>
      <label style={labelStyle}>Confirmar contraseña</label>
      <input type="password" value={form.password2} onChange={e=>setForm({...form,password2:e.target.value})} onKeyDown={e=>{if(e.key==="Enter")handleRegister();}} placeholder="Repite tu contraseña" style={inputStyle} disabled={loading}/>
      {error && <div style={{fontSize:12,color:"#c0392b",background:"#fde8e6",padding:"8px 10px",borderRadius:6,marginBottom:6}}>{error}</div>}
      {info && <div style={{fontSize:12,color:"#1a6f5c",background:"#e0f5ec",padding:"10px 12px",borderRadius:6,marginBottom:6,lineHeight:1.5}}>✓ {info}</div>}
      <button onClick={handleRegister} disabled={loading} style={{...btnPrimary, opacity: loading ? 0.6 : 1, cursor: loading ? "default" : "pointer"}}>
        {loading ? "Enviando solicitud..." : "Enviar solicitud"}
      </button>
      <div style={{textAlign:"center",fontSize:12,color:"#4a7eab",marginTop:14}}>¿Ya tienes cuenta? <button onClick={()=>{setView("login");setError("");setInfo("");}} style={{background:"none",border:"none",color:"#1a6fb5",fontWeight:500,cursor:"pointer",padding:0,fontSize:12}}>Inicia sesión</button></div>
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
    background: e==="aprobado"?"#d4f0e0":e==="rechazado"?"#fde8e6":"#fdf0d0",
    color: e==="aprobado"?"#1a6f5c":e==="rechazado"?"#c0392b":"#a06b1a"
  });

  if (loading) {
    return (
      <div style={{padding:"40px 16px", textAlign:"center", color:"#7aa3c4", fontSize:13}}>
        Cargando usuarios...
      </div>
    );
  }

  return (
    <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
      <div style={{marginBottom:16, display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10}}>
        <div>
          <div style={{fontSize:15,fontWeight:600,color:"#1a3a5c",marginBottom:4}}>Panel de administración</div>
          <div style={{fontSize:12,color:"#4a7eab"}}>Gestión de cuentas del equipo clínico</div>
        </div>
        <button onClick={cargarPerfiles} style={{padding:"6px 12px",fontSize:11,background:"#fff",color:"#1a6fb5",border:"0.5px solid #1a6fb5",borderRadius:6,cursor:"pointer"}}>↻ Actualizar</button>
      </div>

      {error && <div style={{fontSize:12,color:"#c0392b",background:"#fde8e6",padding:"8px 10px",borderRadius:6,marginBottom:10}}>{error}</div>}

      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        {[["pendiente",`Pendientes (${counts.pendiente})`],["aprobado",`Aprobados (${counts.aprobado})`],["rechazado",`Rechazados (${counts.rechazado})`],["todos","Todos"]].map(([id,label]) => (
          <button key={id} onClick={()=>setFiltro(id)} style={{padding:"6px 12px",fontSize:12,fontWeight:filtro===id?500:400,borderRadius:6,cursor:"pointer",border:filtro===id?"none":"0.5px solid #b8d8ef",background:filtro===id?"#1a6fb5":"#fff",color:filtro===id?"#fff":"#4a7eab"}}>{label}</button>
        ))}
      </div>

      {filtrados.length === 0 ? (
        <div style={{textAlign:"center",padding:"40px 0",color:"#7aa3c4",fontSize:13}}>
          {perfiles.length === 0 ? "No hay usuarios registrados" : "No hay usuarios en esta categoría"}
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {filtrados.map(u => (
            <div key={u.id} style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"12px 14px"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
                <div style={{fontSize:14,fontWeight:500,color:"#1a3a5c"}}>{u.nombre || "Sin nombre"}</div>
                <span style={badge(u.estado)}>{u.estado}</span>
                {u.rol === "admin" && <span style={{fontSize:9,padding:"1px 6px",background:"#1a3a5c",color:"#fff",borderRadius:4,fontWeight:500}}>ADMIN</span>}
              </div>
              <div style={{fontSize:12,color:"#4a7eab"}}>{u.correo} · {u.especialidad || "Sin especialidad"}</div>
              {u.fecha_registro && <div style={{fontSize:11,color:"#7aa3c4",marginTop:2}}>Solicitud: {new Date(u.fecha_registro).toLocaleDateString("es-CL")}</div>}
              {u.documento_nombre && (
                <div style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",background:"#f0f8fd",borderRadius:6,fontSize:11,color:"#4a7eab",marginTop:8}}>📎 <span style={{flex:1}}>{u.documento_nombre}</span></div>
              )}
              <div style={{display:"flex",gap:6,marginTop:8}}>
                {u.estado === "pendiente" && (<>
                  <button onClick={()=>cambiar(u.id,"aprobado")} style={{flex:1,padding:"7px",fontSize:12,background:"#1a6f5c",color:"#fff",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>✓ Aprobar</button>
                  <button onClick={()=>cambiar(u.id,"rechazado")} style={{flex:1,padding:"7px",fontSize:12,background:"#c0392b",color:"#fff",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>✗ Rechazar</button>
                </>)}
                {u.estado === "aprobado" && u.rol !== "admin" && <button onClick={()=>cambiar(u.id,"rechazado")} style={{flex:1,padding:"7px",fontSize:12,background:"#fff",color:"#c0392b",border:"0.5px solid #c0392b",borderRadius:6,cursor:"pointer",fontWeight:500}}>Suspender</button>}
                {u.estado === "rechazado" && <button onClick={()=>cambiar(u.id,"aprobado")} style={{flex:1,padding:"7px",fontSize:12,background:"#fff",color:"#1a6f5c",border:"0.5px solid #1a6f5c",borderRadius:6,cursor:"pointer",fontWeight:500}}>Reactivar</button>}
                {u.rol !== "admin" && <button onClick={()=>eliminar(u.id)} style={{padding:"7px 10px",fontSize:12,background:"#fff",color:"#7aa3c4",border:"0.5px solid #b8d8ef",borderRadius:6,cursor:"pointer"}}>Eliminar</button>}
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
        <button onClick={()=>{setVista("quiz");setErrorForm("");}} style={{background:"none",border:"none",color:"#4a7eab",fontSize:13,cursor:"pointer",marginBottom:12,padding:0}}>← Volver</button>
        <div style={{fontSize:15,fontWeight:600,color:"#1a3a5c",marginBottom:14}}>Nueva pregunta</div>
        <label style={labelStyle}>Enunciado</label>
        <textarea value={form.enunciado} onChange={e=>setForm({...form,enunciado:e.target.value})} placeholder="Escribe la pregunta..." rows={3} style={{...inputStyle,resize:"vertical"}}/>
        <label style={labelStyle}>Alternativas (marca la correcta)</label>
        {form.alternativas.map((alt, i) => (
          <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
            <button onClick={()=>setForm({...form,correcta:i})} style={{width:24,height:24,borderRadius:"50%",border:form.correcta===i?"none":"1px solid #b8d8ef",background:form.correcta===i?"#1a6f5c":"#fff",color:"#fff",cursor:"pointer",fontSize:12,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>{form.correcta===i?"✓":""}</button>
            <input value={alt} onChange={e=>{const nuevas=[...form.alternativas];nuevas[i]=e.target.value;setForm({...form,alternativas:nuevas});}} placeholder={`Alternativa ${String.fromCharCode(65+i)}`} style={{...inputStyle,marginBottom:0,flex:1}}/>
          </div>
        ))}
        <label style={{...labelStyle,marginTop:8}}>Feedback / explicación</label>
        <textarea value={form.feedback} onChange={e=>setForm({...form,feedback:e.target.value})} placeholder="Explicación que se muestra al responder..." rows={3} style={{...inputStyle,resize:"vertical"}}/>
        <label style={labelStyle}>Categoría</label>
        <input value={form.categoria} onChange={e=>setForm({...form,categoria:e.target.value})} placeholder="Ej: Litiasis, Oncología, NMIBC..." style={inputStyle}/>
        {errorForm && <div style={{fontSize:12,color:"#c0392b",background:"#fde8e6",padding:"8px 10px",borderRadius:6,marginBottom:8}}>{errorForm}</div>}
        <button onClick={guardar} style={{...btnPrimary,marginTop:0}}>Guardar pregunta</button>
      </div>
    );
  }

  // VISTA: lista de preguntas (admin, para gestionar/eliminar)
  if (vista === "lista") {
    return (
      <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <button onClick={()=>setVista("quiz")} style={{background:"none",border:"none",color:"#4a7eab",fontSize:13,cursor:"pointer",padding:0}}>← Volver al quiz</button>
          <span style={{fontSize:12,color:"#7aa3c4"}}>{preguntas.length} preguntas</span>
        </div>
        {preguntas.length === 0 ? (
          <div style={{textAlign:"center",padding:"30px",color:"#7aa3c4",fontSize:13}}>No hay preguntas aún.</div>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {preguntas.map(p => (
              <div key={p.id} style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:8,padding:"10px 12px"}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
                  <span style={{fontSize:10,color:"#1a6fb5",fontWeight:600}}>{p.categoria||"General"}</span>
                  {isAdmin && <button onClick={()=>eliminar(p.id)} style={{background:"none",border:"none",color:"#c0392b",cursor:"pointer",fontSize:12,padding:0}}>🗑</button>}
                </div>
                <div style={{fontSize:13,color:"#1a3a5c",marginTop:3}}>{p.enunciado}</div>
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
          <div style={{fontSize:22,fontWeight:700,color:"#1a3a5c"}}>❓ Preguntas</div>
          <div style={{fontSize:13,color:"#4a7eab"}}>{preguntas.length} preguntas para estudiar</div>
        </div>
        {isAdmin && (
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            <button onClick={()=>setVista("nueva")} style={{padding:"7px 12px",fontSize:12,background:"#1a6fb5",color:"#fff",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>+ Nueva</button>
            <button onClick={()=>setVista("lista")} style={{padding:"7px 12px",fontSize:12,background:"#fff",color:"#1a6fb5",border:"0.5px solid #b8d8ef",borderRadius:6,cursor:"pointer"}}>Gestionar</button>
          </div>
        )}
      </div>

      {categorias.length > 1 && (
        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:14}}>
          {categorias.map(c => (
            <button key={c} onClick={()=>{setFiltroCat(c);setIdx(0);setSeleccion(null);setMostrarResp(false);}} style={{padding:"4px 11px",fontSize:11,borderRadius:14,cursor:"pointer",border:filtroCat===c?"none":"0.5px solid #b8d8ef",background:filtroCat===c?"#1a6fb5":"#fff",color:filtroCat===c?"#fff":"#4a7eab",fontWeight:filtroCat===c?600:400}}>{c}</button>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{textAlign:"center",padding:"40px",color:"#7aa3c4",fontSize:13}}>Cargando...</div>
      ) : !actual ? (
        <div style={{textAlign:"center",padding:"40px 20px",color:"#7aa3c4",fontSize:13,lineHeight:1.6}}>
          {preguntas.length === 0 ? (isAdmin ? "Aún no has creado preguntas. Usa el botón \"+ Nueva\"." : "El administrador aún no ha creado preguntas.") : "No hay preguntas en esta categoría."}
        </div>
      ) : (
        <div>
          <div style={{fontSize:11,color:"#7aa3c4",marginBottom:8,textAlign:"center"}}>Pregunta {idx+1} de {filtradas.length}</div>
          <div style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"16px",marginBottom:12}}>
            <div style={{fontSize:15,fontWeight:600,color:"#1a3a5c",lineHeight:1.5,marginBottom:14}}>{actual.enunciado}</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {(actual.alternativas||[]).map((alt, i) => {
                let bg = "#fff", border = "0.5px solid #b8d8ef", color = "#1a3a5c";
                if (mostrarResp) {
                  if (i === actual.correcta) { bg = "#e0f5ec"; border = "1px solid #1a6f5c"; color = "#1a6f5c"; }
                  else if (i === seleccion) { bg = "#fde8e6"; border = "1px solid #c0392b"; color = "#c0392b"; }
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
            {mostrarResp && actual.feedback && (
              <div style={{marginTop:14,padding:"12px",background:"#f0f8fd",borderRadius:8,borderLeft:"3px solid #1a6fb5"}}>
                <div style={{fontSize:11,fontWeight:600,color:"#1a6fb5",marginBottom:4}}>💡 Explicación</div>
                <div style={{fontSize:13,color:"#1a3a5c",lineHeight:1.5,whiteSpace:"pre-wrap"}}>{actual.feedback}</div>
              </div>
            )}
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"space-between"}}>
            <button onClick={anterior} disabled={filtradas.length<=1} style={{padding:"10px 16px",fontSize:13,background:"#fff",color:"#4a7eab",border:"0.5px solid #b8d8ef",borderRadius:8,cursor:filtradas.length<=1?"default":"pointer",opacity:filtradas.length<=1?0.5:1}}>← Anterior</button>
            <button onClick={siguiente} disabled={filtradas.length<=1} style={{padding:"10px 16px",fontSize:13,background:"#1a6fb5",color:"#fff",border:"none",borderRadius:8,cursor:filtradas.length<=1?"default":"pointer",opacity:filtradas.length<=1?0.5:1,fontWeight:500}}>Siguiente →</button>
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
        <button onClick={()=>{setVista("lista");setErrorForm("");}} style={{background:"none",border:"none",color:"#4a7eab",fontSize:13,cursor:"pointer",marginBottom:12,padding:0}}>← Volver</button>
        <div style={{fontSize:15,fontWeight:600,color:"#1a3a5c",marginBottom:14}}>Agregar a base de conocimiento</div>
        <div style={{background:"#e0f5ec",border:"0.5px solid #a8d4be",borderRadius:8,padding:"10px 12px",marginBottom:14,fontSize:11,color:"#1a6f5c",lineHeight:1.5}}>📚 Lo que subas será la fuente prioritaria que UroSearch use para responder.</div>
        <label style={labelStyle}>Título del documento</label>
        <input value={nuevoForm.titulo} onChange={e=>setNuevoForm({...nuevoForm,titulo:e.target.value})} placeholder="Ej: Guía EAU 2024 - Litiasis ureteral" style={inputStyle}/>
        <label style={labelStyle}>Categoría</label>
        <select value={nuevoForm.categoria} onChange={e=>setNuevoForm({...nuevoForm,categoria:e.target.value})} style={inputStyle}>
          {CATEGORIAS_KB.map(c=><option key={c}>{c}</option>)}
        </select>
        <label style={labelStyle}>Libro / Fuente (opcional)</label>
        <input value={nuevoForm.fuente||""} onChange={e=>setNuevoForm({...nuevoForm,fuente:e.target.value})} placeholder="Ej: Campbell-Walsh Urology — para agrupar capítulos" style={inputStyle}/>
        <label style={labelStyle}>Contenido del documento</label>
        <div style={{fontSize:11,color:"#7aa3c4",marginBottom:6}}>Sube un archivo (PDF, Word .docx, .txt, .md, máx 10 MB) o pega el texto</div>
        <input ref={fileRef} type="file" accept=".txt,.md,.pdf,.docx" onChange={handleFile} style={{display:"none"}}/>
        <button onClick={()=>fileRef.current?.click()} style={{width:"100%",padding:"10px",fontSize:13,background:"#fff",color:"#1a6fb5",border:"1px dashed #1a6fb5",borderRadius:8,cursor:"pointer",marginBottom:8,textAlign:"left"}}>📎 Subir archivo (PDF · Word · TXT)</button>
        <textarea value={nuevoForm.contenido} onChange={e=>setNuevoForm({...nuevoForm,contenido:e.target.value})} placeholder="Pega aquí el contenido..." rows={10} style={{...inputStyle,resize:"vertical"}}/>
        <div style={{fontSize:11,color:"#7aa3c4",marginTop:-6,marginBottom:10,textAlign:"right"}}>{nuevoForm.contenido.length.toLocaleString()} caracteres</div>
        <label style={labelStyle}>Palabras clave / tags (opcional)</label>
        <input value={nuevoForm.tags} onChange={e=>setNuevoForm({...nuevoForm,tags:e.target.value})} placeholder="Separadas por coma" style={inputStyle}/>
        {errorForm && <div style={{fontSize:12,color: errorForm.includes("Procesando")?"#1a6f5c":"#c0392b",background: errorForm.includes("Procesando")?"#e0f5ec":"#fde8e6",padding:"8px 10px",borderRadius:6,marginBottom:8}}>{errorForm}</div>}
        <button onClick={guardar} style={{...btnPrimary, marginTop:0}}>Guardar documento</button>
      </div>
    );
  }

  if (vista === "ver" && seleccionado) {
    return (
      <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
        <button onClick={()=>{setVista("lista");setSeleccionado(null);}} style={{background:"none",border:"none",color:"#4a7eab",fontSize:13,cursor:"pointer",marginBottom:12,padding:0}}>← Volver</button>
        <div style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"14px",marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:500,color:"#1a6fb5",marginBottom:4}}>{seleccionado.categoria}</div>
          <div style={{fontSize:16,fontWeight:600,color:"#1a3a5c",marginBottom:6}}>{seleccionado.titulo}</div>
          <div style={{fontSize:11,color:"#7aa3c4",marginBottom:8}}>Agregado: {seleccionado.fecha_creacion} · {(seleccionado.caracteres ?? seleccionado.contenido?.length ?? 0).toLocaleString()} caracteres</div>
          {isAdmin && <button onClick={()=>eliminar(seleccionado.id)} style={{padding:"5px 10px",fontSize:11,background:"#fff",color:"#c0392b",border:"0.5px solid #f0c5c0",borderRadius:6,cursor:"pointer"}}>Eliminar</button>}
        </div>
        <div style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"14px",fontSize:13,color:"#1a3a5c",lineHeight:1.6,whiteSpace:"pre-wrap"}}>{(seleccionado.contenido || "(Sin contenido)").slice(0,20000)}{(seleccionado.contenido||"").length>20000 ? `\n\n[...] Mostrando los primeros 20.000 de ${(seleccionado.contenido||"").length.toLocaleString()} caracteres. El texto completo está guardado y disponible para el chat.` : ""}</div>
      </div>
    );
  }

  return (
    <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,gap:10}}>
        <div>
          <div style={{fontSize:15,fontWeight:600,color:"#1a3a5c",marginBottom:2}}>📚 Base de conocimiento</div>
          <div style={{fontSize:11,color:"#4a7eab"}}>{conocimiento.length} documentos</div>
        </div>
        {isAdmin && <button onClick={()=>setVista("nuevo")} style={{padding:"7px 12px",fontSize:12,fontWeight:500,background:"#1a6fb5",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",whiteSpace:"nowrap"}}>+ Agregar</button>}
      </div>
      <input value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="Buscar..." style={{...inputStyle, marginBottom:8}}/>
      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:14}}>
        {["Todas",...CATEGORIAS_KB].map(c => (
          <button key={c} onClick={()=>setFiltroCat(c)} style={{padding:"4px 10px",fontSize:11,fontWeight:filtroCat===c?500:400,borderRadius:14,cursor:"pointer",border:filtroCat===c?"none":"0.5px solid #b8d8ef",background:filtroCat===c?"#1a6fb5":"#fff",color:filtroCat===c?"#fff":"#4a7eab"}}>{c}</button>
        ))}
      </div>
      {filtrados.length === 0 ? (
        <div style={{textAlign:"center",padding:"40px 20px",color:"#7aa3c4",fontSize:13,lineHeight:1.6}}>{conocimiento.length === 0 ? (isAdmin ? "Aún no has agregado documentos." : "El administrador aún no ha cargado documentos.") : "Ningún documento coincide"}</div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {filtrados.map(d => (
            <div key={d.id} onClick={()=>{setSeleccionado(d); setVista("ver");}} style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"12px 14px",cursor:"pointer"}}>
              <div style={{fontSize:11,fontWeight:500,color:"#1a6fb5",marginBottom:3}}>{d.categoria}{d.fuente ? <span style={{marginLeft:6,fontSize:10,background:"#f3e8ff",color:"#6b21a8",padding:"1px 7px",borderRadius:8,fontWeight:600}}>📖 {d.fuente}</span> : null}</div>
              <div style={{fontSize:14,fontWeight:500,color:"#1a3a5c",marginBottom:4}}>{d.titulo}</div>
              <div style={{fontSize:11,color:"#7aa3c4",marginBottom:6}}>{new Date(d.fecha_creacion).toLocaleDateString("es-CL")} · {d.contenido?.length?.toLocaleString() || 0} caracteres</div>
              <div style={{fontSize:12,color:"#4a7eab",lineHeight:1.4}}>{(d.contenido||"").slice(0,150)}{(d.contenido||"").length>150?"...":""}</div>
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
    const Section = ({ titulo, items, color = "#1a6fb5" }) => (
      <div style={{marginBottom:14}}>
        <div style={{fontSize:12,fontWeight:600,color,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.3px"}}>{titulo}</div>
        <ul style={{margin:0,paddingLeft:18,fontSize:13,color:"#1a3a5c",lineHeight:1.6}}>
          {items.map((it,i) => <li key={i} style={{marginBottom:3}}>{it}</li>)}
        </ul>
      </div>
    );
    return (
      <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
        <button onClick={()=>setSeleccionado(null)} style={{background:"none",border:"none",color:"#4a7eab",fontSize:13,cursor:"pointer",marginBottom:12,padding:0}}>← Volver a cirugías</button>
        <div style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"16px",marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:500,color:"#1a6fb5",marginBottom:4}}>{seleccionado.categoria}</div>
          <div style={{fontSize:18,fontWeight:600,color:"#1a3a5c",marginBottom:8}}>{seleccionado.titulo}</div>
          <div style={{fontSize:13,color:"#4a7eab",lineHeight:1.5,marginBottom:10}}>{seleccionado.descripcion}</div>
          <div style={{display:"flex",gap:14,fontSize:11,color:"#7aa3c4",paddingTop:8,borderTop:"0.5px solid #e8f3fb"}}>
            <span>⏱ Duración: <strong style={{color:"#1a3a5c"}}>{seleccionado.duracion}</strong></span>
            <span>💉 Anestesia: <strong style={{color:"#1a3a5c"}}>{seleccionado.anestesia}</strong></span>
          </div>
        </div>
        <div style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"16px",marginBottom:14}}>
          <Section titulo="✓ Indicaciones" items={seleccionado.indicaciones} color="#1a6f5c"/>
          <Section titulo="✗ Contraindicaciones" items={seleccionado.contraindicaciones} color="#c0392b"/>
        </div>
        <div style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"16px",marginBottom:14}}>
          <Section titulo="📋 Preparación pre-operatoria" items={seleccionado.preparacion}/>
          <Section titulo="🔪 Técnica quirúrgica" items={seleccionado.tecnica}/>
          <Section titulo="🛌 Manejo postoperatorio" items={seleccionado.postoperatorio}/>
        </div>
        <div style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"16px"}}>
          <Section titulo="⚠️ Complicaciones potenciales" items={seleccionado.complicaciones} color="#a06b1a"/>
        </div>
      </div>
    );
  }

  return (
    <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:22,fontWeight:700,color:"#1a3a5c",marginBottom:2}}>🔪 Protocolos quirúrgicos</div>
        <div style={{fontSize:13,color:"#4a7eab"}}>{PROTOCOLOS_CIRUGIAS.length} procedimientos urológicos estándar</div>
      </div>
      <input value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="Buscar cirugía..." style={{...inputStyle, marginBottom:8}}/>
      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:14}}>
        {CATEGORIAS_CIRUGIAS.map(c => (
          <button key={c} onClick={()=>setFiltro(c)} style={{padding:"4px 10px",fontSize:11,fontWeight:filtro===c?500:400,borderRadius:14,cursor:"pointer",border:filtro===c?"none":"0.5px solid #b8d8ef",background:filtro===c?"#1a6fb5":"#fff",color:filtro===c?"#fff":"#4a7eab"}}>{c}</button>
        ))}
      </div>
      {filtrados.length === 0 ? (
        <div style={{textAlign:"center",padding:"40px 20px",color:"#7aa3c4",fontSize:13}}>Ningún procedimiento coincide</div>
      ) : (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:10}}>
          {filtrados.map(p => (
            <div key={p.id} onClick={()=>setSeleccionado(p)} style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"12px 14px",cursor:"pointer",borderLeft:"3px solid #1a6fb5"}}>
              <div style={{fontSize:10,fontWeight:500,color:"#1a6fb5",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.3px"}}>{p.categoria}</div>
              <div style={{fontSize:14,fontWeight:500,color:"#1a3a5c",marginBottom:6}}>{p.titulo}</div>
              <div style={{fontSize:11,color:"#4a7eab",lineHeight:1.4,marginBottom:8,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{p.descripcion}</div>
              <div style={{display:"flex",gap:8,fontSize:10,color:"#7aa3c4"}}>
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
      <div style={{display:"flex",gap:0,background:"#f0f8fd",borderBottom:"0.5px solid #b8d8ef",padding:"0 12px",overflowX:"auto"}}>
        {tabsConocimiento.map(([id,label]) => (
          <button key={id} onClick={()=>setSubTab(id)} style={{padding:"13px 18px",fontSize:14,fontWeight:subTab===id?600:500,background:"transparent",border:"none",borderBottom:subTab===id?"3px solid #1a6fb5":"3px solid transparent",color:subTab===id?"#1a6fb5":"#4a7eab",cursor:"pointer",whiteSpace:"nowrap"}}>{label}</button>
        ))}
      </div>

      {subTab === "mapas" && (
  <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
    {/* MAPAS PRECARGADOS */}
    <div style={{marginBottom:16}}>
      <div style={{fontSize:13,fontWeight:500,color:"#4a7eab",marginBottom:10}}>Mapas precargados</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8}}>
        {TOPICS.map(t => (
          <div key={t.id}>
            <button onClick={() => setTopicOpen(topicOpen===t.id ? null : t.id)} style={{width:"100%",padding:"8px 10px",fontSize:12,fontWeight:500,textAlign:"left",background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:8,color:"#1a3a5c",cursor:"pointer",borderBottomLeftRadius:topicOpen===t.id ? 0 : 8,borderBottomRightRadius:topicOpen===t.id ? 0 : 8}}>{t.label} {topicOpen===t.id ? "▲" : "▼"}</button>
            {topicOpen===t.id && (
              <div style={{border:"0.5px solid #b8d8ef",borderTop:"none",borderRadius:"0 0 8px 8px",overflow:"hidden",background:"#fff"}}>
                {t.subtopics.map(s => <button key={s} onClick={() => { generarMapa(s); setTopicOpen(null); }} style={{display:"block",width:"100%",padding:"7px 12px",fontSize:12,textAlign:"left",background:"#fff",border:"none",borderTop:"0.5px solid #e8f3fb",color:"#4a7eab",cursor:"pointer"}}>{s}</button>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>

    {/* GENERAR MAPA CON IA */}
    <div style={{marginBottom:16}}>
      <div style={{fontSize:13,fontWeight:500,color:"#4a7eab",marginBottom:8}}>Generar mapa con IA</div>
      <div style={{display:"flex",gap:8}}>
        <input value={mapaTema} onChange={e=>setMapaTema(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")generarMapa(mapaTema);}} placeholder="Ej: Hematuria macroscópica..." style={{flex:1,padding:"9px 12px",fontSize:13,borderRadius:8,border:"0.5px solid #b8d8ef",background:"#fff",color:"#1a3a5c",outline:"none"}}/>
        <button onClick={()=>generarMapa(mapaTema)} disabled={mapaLoading||!mapaTema.trim()} style={{padding:"9px 14px",borderRadius:8,border:"none",background:mapaLoading||!mapaTema.trim()?"#cdddec":"#1a6fb5",color:"#fff",fontSize:13,cursor:mapaLoading||!mapaTema.trim()?"default":"pointer",fontWeight:500}}>{mapaLoading ? "Generando..." : "Generar ↗"}</button>
      </div>
    </div>

    {mapaLoading && <div style={{textAlign:"center",padding:"40px 0",color:"#7aa3c4",fontSize:13}}>Generando mapa...</div>}

    {/* MAPA ACTUAL CON BOTÓN DE GUARDAR */}
    {mapaActual && !mapaLoading && (
      <div style={{border:"0.5px solid #b8d8ef",borderRadius:12,overflow:"hidden",background:"#fff",marginBottom:16}}>
        <div style={{padding:"10px 14px",borderBottom:"0.5px solid #b8d8ef",display:"flex",justifyContent:"space-between",alignItems:"center",background:"#f0f8fd",gap:10}}>
          <div style={{fontSize:13,fontWeight:500,color:"#1a3a5c"}}>{mapaActual.titulo}</div>
          <button 
            onClick={onGuardarMapa} 
            disabled={guardandoMapa}
            style={{
              padding:"5px 12px",
              fontSize:11,
              fontWeight:500,
              background: guardandoMapa ? "#cdddec" : "#1a6fb5",
              color:"#fff",
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

    {!mapaActual && !mapaLoading && <div style={{textAlign:"center",padding:"32px 0",color:"#7aa3c4",fontSize:13}}>Selecciona un tema o escribe uno</div>}

    {/* MIS MAPAS GUARDADOS */}
    {mapasGuardados && mapasGuardados.length > 0 && (
      <div style={{marginTop:24, paddingTop:16, borderTop:"0.5px solid #b8d8ef"}}>
        <div style={{fontSize:13,fontWeight:500,color:"#4a7eab",marginBottom:10}}>
          Mis mapas guardados ({mapasGuardados.length})
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:8}}>
          {mapasGuardados.map(mapa => (
            <div 
              key={mapa.id}
              style={{
                background:"#fff",
                border:"0.5px solid #b8d8ef",
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
                <div style={{fontSize:12,fontWeight:500,color:"#1a3a5c",marginBottom:3, lineHeight:1.3}}>
                  {mapa.titulo}
                </div>
                <div style={{fontSize:10,color:"#7aa3c4"}}>
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
                  color:"#c0392b",
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
          return <button key={op} onClick={()=>onChange(sel ? "" : op)} style={{padding:"5px 10px",fontSize:11,fontWeight:sel?500:400,borderRadius:14,cursor:"pointer",border:sel?"none":"0.5px solid #b8d8ef",background:sel?"#1a6fb5":"#fff",color:sel?"#fff":"#4a7eab"}}>{op}</button>;
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
        <button onClick={()=>{setVista("lista");setError("");}} style={{background:"none",border:"none",color:"#4a7eab",fontSize:13,cursor:"pointer",marginBottom:12,padding:0}}>← Volver</button>
        <div style={{fontSize:16,fontWeight:600,color:"#1a3a5c",marginBottom:14}}>Crear nuevo equipo</div>
        <label style={labelStyle}>Nombre del equipo</label>
        <input value={nuevoNombre} onChange={e=>setNuevoNombre(e.target.value)} placeholder="Ej: Equipo Urología HBV" style={inputStyle} disabled={loading}/>
        <label style={labelStyle}>Descripción (opcional)</label>
        <textarea value={nuevoDescripcion} onChange={e=>setNuevoDescripcion(e.target.value)} placeholder="Para qué se usará este equipo" rows={3} style={{...inputStyle,resize:"none"}} disabled={loading}/>
        {error && <div style={{fontSize:12,color:"#c0392b",background:"#fde8e6",padding:"8px 10px",borderRadius:6,marginBottom:8}}>{error}</div>}
        <button onClick={crearEquipoHandler} disabled={loading} style={{...btnPrimary, marginTop:0, opacity: loading ? 0.6 : 1}}>{loading ? "Creando..." : "Crear equipo"}</button>
      </div>
    );
  }

  // VISTA: DETALLE
  if (vista === "detalle" && seleccionado) {
    const esDueño = seleccionado.dueno_id === currentUser.id;
    return (
      <div style={{padding:"20px",overflowY:"auto"}}>
        <button onClick={()=>{setVista("lista");setSeleccionado(null);setError("");}} style={{background:"none",border:"none",color:"#4a7eab",fontSize:13,cursor:"pointer",marginBottom:12,padding:0}}>← Volver a equipos</button>
        <div style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"14px",marginBottom:14}}>
          <div style={{fontSize:16,fontWeight:600,color:"#1a3a5c",marginBottom:4}}>{seleccionado.nombre}</div>
          {seleccionado.descripcion && <div style={{fontSize:12,color:"#4a7eab",marginBottom:6}}>{seleccionado.descripcion}</div>}
          <div style={{fontSize:11,color:"#7aa3c4"}}>{miembros.length} miembros</div>
        </div>

        <div style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"14px",marginBottom:14}}>
          <div style={{fontSize:13,fontWeight:600,color:"#1a3a5c",marginBottom:10}}>👥 Miembros</div>
          {miembros.map(m => {
            const perfil = m.perfiles;
            return (
              <div key={m.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 10px",background:"#f0f8fd",borderRadius:6,marginBottom:5}}>
                <div>
                  <div style={{fontSize:12,fontWeight:500,color:"#1a3a5c"}}>
                    {perfil?.nombre || "Sin nombre"}
                    {m.user_id === seleccionado.dueno_id && <span style={{fontSize:9,marginLeft:6,padding:"1px 6px",background:"#1a6fb5",color:"#fff",borderRadius:4}}>DUEÑO</span>}
                    {m.user_id === currentUser.id && <span style={{fontSize:9,marginLeft:6,padding:"1px 6px",background:"#1a6f5c",color:"#fff",borderRadius:4}}>TÚ</span>}
                  </div>
                  <div style={{fontSize:10,color:"#7aa3c4"}}>{perfil?.correo}</div>
                </div>
                {esDueño && m.user_id !== currentUser.id && (
                  <button onClick={()=>expulsar(m.user_id)} style={{padding:"4px 10px",fontSize:11,background:"#fff",color:"#c0392b",border:"0.5px solid #f0c5c0",borderRadius:6,cursor:"pointer"}}>Expulsar</button>
                )}
              </div>
            );
          })}
        </div>

        {esDueño && (
          <div style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"14px",marginBottom:14}}>
            <div style={{fontSize:13,fontWeight:600,color:"#1a3a5c",marginBottom:10}}>+ Invitar miembro</div>
            <div style={{fontSize:11,color:"#7aa3c4",marginBottom:6}}>Solo puedes invitar usuarios ya aprobados en UroSearch</div>
            <div style={{display:"flex",gap:6}}>
              <input value={invitarCorreo} onChange={e=>setInvitarCorreo(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")invitar();}} placeholder="correo del usuario" style={{flex:1,padding:"9px 12px",fontSize:13,borderRadius:8,border:"0.5px solid #b8d8ef",outline:"none"}} disabled={loading}/>
              <button onClick={invitar} disabled={!invitarCorreo.trim() || loading} style={{padding:"9px 14px",fontSize:13,fontWeight:500,background:invitarCorreo.trim() && !loading ?"#1a6fb5":"#cdddec",color:"#fff",border:"none",borderRadius:8,cursor:"pointer"}}>{loading ? "..." : "Invitar"}</button>
            </div>
            {error && <div style={{fontSize:12,color:"#c0392b",background:"#fde8e6",padding:"8px 10px",borderRadius:6,marginTop:8}}>{error}</div>}

            {invitacionesEquipo.length > 0 && (
              <div style={{marginTop:12}}>
                <div style={{fontSize:11,fontWeight:500,color:"#7aa3c4",marginBottom:4}}>Invitaciones pendientes</div>
                {invitacionesEquipo.map(i => (
                  <div key={i.id} style={{padding:"6px 10px",background:"#fff8e1",borderRadius:6,fontSize:11,color:"#8a6610",marginBottom:4}}>
                    📨 {i.perfiles?.nombre} ({i.perfiles?.correo})
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{display:"flex",gap:6}}>
          {esDueño ? (
            <button onClick={()=>eliminarEquipoHandler(seleccionado)} style={{flex:1,padding:"10px",fontSize:13,background:"#fff",color:"#c0392b",border:"1px solid #c0392b",borderRadius:8,cursor:"pointer",fontWeight:500}}>🗑 Eliminar equipo</button>
          ) : (
            <button onClick={()=>salir(seleccionado)} style={{flex:1,padding:"10px",fontSize:13,background:"#fff",color:"#c0392b",border:"1px solid #c0392b",borderRadius:8,cursor:"pointer",fontWeight:500}}>Salir del equipo</button>
          )}
        </div>
      </div>
    );
  }

  // VISTA: LISTA
  return (
    <div style={{padding:"20px",overflowY:"auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{fontSize:16,fontWeight:600,color:"#1a3a5c"}}>👥 Mis equipos</div>
        <button onClick={onCerrar} style={{background:"none",border:"none",fontSize:18,color:"#7aa3c4",cursor:"pointer"}}>✕</button>
      </div>

      {invitacionesPendientes.length > 0 && (
        <div style={{marginBottom:16}}>
          <div style={{fontSize:12,fontWeight:500,color:"#a06b1a",marginBottom:6}}>📨 Invitaciones pendientes ({invitacionesPendientes.length})</div>
          {invitacionesPendientes.map(inv => (
            <div key={inv.id} style={{background:"#fff8e1",border:"0.5px solid #f0d896",borderRadius:8,padding:"10px 12px",marginBottom:6}}>
              <div style={{fontSize:13,fontWeight:500,color:"#8a6610",marginBottom:2}}>{inv.equipos?.nombre}</div>
              <div style={{fontSize:11,color:"#a06b1a",marginBottom:8}}>Invitado por {inv.invitador?.nombre}</div>
              <div style={{display:"flex",gap:6}}>
                <button onClick={()=>aceptar(inv)} style={{flex:1,padding:"6px",fontSize:12,background:"#1a6f5c",color:"#fff",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>✓ Aceptar</button>
                <button onClick={()=>rechazar(inv)} style={{flex:1,padding:"6px",fontSize:12,background:"#fff",color:"#c0392b",border:"0.5px solid #c0392b",borderRadius:6,cursor:"pointer",fontWeight:500}}>Rechazar</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <button onClick={()=>setVista("nuevo")} style={{...btnPrimary, marginTop:0, marginBottom:14}}>+ Crear nuevo equipo</button>

      {equipos.length === 0 ? (
        <div style={{textAlign:"center",padding:"30px 20px",color:"#7aa3c4",fontSize:13,lineHeight:1.6}}>No perteneces a ningún equipo.<br/>Crea uno o espera invitación.</div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {equipos.map(eq => (
            <div key={eq.id} onClick={()=>abrirDetalle(eq)} style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"12px 14px",cursor:"pointer"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4,gap:10}}>
                <div style={{fontSize:14,fontWeight:500,color:"#1a3a5c"}}>{eq.nombre}</div>
                {eq.dueno_id === currentUser.id && <span style={{fontSize:9,padding:"1px 6px",background:"#1a6fb5",color:"#fff",borderRadius:4,fontWeight:500}}>DUEÑO</span>}
              </div>
              {eq.descripcion && <div style={{fontSize:11,color:"#4a7eab",marginBottom:4}}>{eq.descripcion}</div>}
              <div style={{fontSize:10,color:"#7aa3c4"}}>{eq.miembros_equipo?.length || 0} miembros</div>
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

  // Etiqueta de lo que se está viendo actualmente
  // Buscamos en TODA la lista de equipos (no solo misEquipos) para que el nombre
  // siempre aparezca aunque el filtro de pertenencia no calce.
  const actual = contexto === "personal"
    ? { icono: "👤", nombre: "Mis Pacientes", color: "#1a6fb5" }
    : (() => {
        const eq = equipos.find(e => e.id === contexto);
        return eq ? { icono: "👥", nombre: eq.nombre, color: "#1a6f5c" } : { icono: "👤", nombre: "Mis Pacientes", color: "#1a6fb5" };
      })();

  const elegir = (valor) => { setContexto(valor); setAbierto(false); };

  return (
    <div style={{padding:"8px 14px",background:"#fff",borderBottom:"0.5px solid #b8d8ef",display:"flex",alignItems:"center",gap:8}}>
      <span style={{fontSize:12,color:"#7aa3c4"}}>Viendo:</span>
      <div style={{position:"relative"}}>
        <button onClick={()=>setAbierto(!abierto)} style={{padding:"6px 12px",fontSize:13,fontWeight:600,borderRadius:14,cursor:"pointer",border:"none",background:actual.color,color:"#fff",display:"flex",alignItems:"center",gap:6}}>
          {actual.icono} {actual.nombre} <span style={{fontSize:11}}>▾</span>
        </button>
        {abierto && (
          <>
            <div onClick={()=>setAbierto(false)} style={{position:"fixed",inset:0,zIndex:20}}/>
            <div style={{position:"absolute",top:"110%",left:0,background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:8,padding:"4px",minWidth:200,zIndex:30,boxShadow:"0 2px 8px rgba(0,0,0,0.12)"}}>
              <div onClick={()=>elegir("personal")} style={{padding:"8px 10px",fontSize:13,cursor:"pointer",borderRadius:6,background:contexto==="personal"?"#f0f8fd":"transparent",color:"#1a3a5c",display:"flex",alignItems:"center",gap:8}}>
                <span>👤</span> Mis Pacientes {contexto==="personal" && <span style={{marginLeft:"auto",color:"#1a6fb5"}}>✓</span>}
              </div>
              {misEquipos.map(eq => (
                <div key={eq.id} onClick={()=>elegir(eq.id)} style={{padding:"8px 10px",fontSize:13,cursor:"pointer",borderRadius:6,background:contexto===eq.id?"#f0f8fd":"transparent",color:"#1a3a5c",display:"flex",alignItems:"center",gap:8}}>
                  <span>👥</span> {eq.nombre} {contexto===eq.id && <span style={{marginLeft:"auto",color:"#1a6f5c"}}>✓</span>}
                </div>
              ))}
              <div onClick={()=>{ setAbierto(false); onAbrirEquipos(); }} style={{padding:"8px 10px",fontSize:13,cursor:"pointer",borderRadius:6,color:"#1a6fb5",borderTop:"0.5px solid #e8f3fb",marginTop:4,display:"flex",alignItems:"center",gap:8}}>
                <span>⚙️</span> Gestionar / crear equipo
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function HospitalPanel({ pacientes, setPacientes, currentUser, tablaCirugias, setTablaCirugias, misServiciosLista, setMisServiciosLista, loadingPacientes, setLoadingPacientes, loadingCirugias, setLoadingCirugias, loadingPendientes, setLoadingPendientes, pendientes, setPendientes, equipos, setEquipos, invitacionesPendientes, setInvitacionesPendientes, users }) {
  const [subTab, setSubTab] = useState(() => {
    try { return localStorage.getItem("uro_subtab_hospital") || "pacientes"; }
    catch { return "pacientes"; }
  });
  const [contexto, setContexto] = useState(() => {
    try { return localStorage.getItem("uro_contexto") || "personal"; }
    catch { return "personal"; }
  });
  const [mostrarEquipos, setMostrarEquipos] = useState(false);

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

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0}}>
      <SelectorContexto contexto={contexto} setContexto={setContexto} equipos={equipos} currentUser={currentUser} onAbrirEquipos={()=>setMostrarEquipos(true)}/>
      <div style={{display:"flex",gap:0,background:"#f0f8fd",borderBottom:"0.5px solid #b8d8ef",padding:"4px 12px 0",overflowX:"auto",flexShrink:0}}>
        {[["pacientes","👥 Pacientes"],["pendientes","✅ Pendientes"],["tabla","📋 Tabla Quirúrgica"]].map(([id,label]) => (
          <button key={id} onClick={()=>setSubTab(id)} style={{padding:"13px 18px",fontSize:14,fontWeight:subTab===id?600:500,background:"transparent",border:"none",borderBottom:subTab===id?"3px solid #1a6fb5":"3px solid transparent",color:subTab===id?"#1a6fb5":"#4a7eab",cursor:"pointer",whiteSpace:"nowrap"}}>{label}</button>
        ))}
      </div>
      {subTab === "pacientes" && <PacientesPanel pacientes={pacientes} setPacientes={setPacientes} currentUser={currentUser} contexto={contexto} equipos={equipos} misServiciosLista={misServiciosLista} setMisServiciosLista={setMisServiciosLista} loadingPacientes={loadingPacientes} setLoadingPacientes={setLoadingPacientes}/>}
      {subTab === "tabla" && <TablaQuirurgicaPanel tablaCirugias={tablaCirugias} setTablaCirugias={setTablaCirugias} currentUser={currentUser} contexto={contexto} equipos={equipos} loadingCirugias={loadingCirugias} setLoadingCirugias={setLoadingCirugias}/>}
      {subTab === "pendientes" && <PendientesPanel pendientes={pendientes} setPendientes={setPendientes} currentUser={currentUser} contexto={contexto} equipos={equipos} loadingPendientes={loadingPendientes} setLoadingPendientes={setLoadingPendientes}/>}
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
            <span key={id} style={{fontSize:11,background:"#e0f5ec",color:"#1a6f5c",padding:"3px 9px",borderRadius:10,fontWeight:600}}>👤 {nombreMiembro(id)}</span>
          )
        ))}
        <button onClick={()=>setAbierto(!abierto)} style={{fontSize:14,background:"#f0f8fd",color:"#1a6fb5",border:"0.5px solid #b8d8ef",borderRadius:"50%",width:24,height:24,cursor:"pointer",fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1,padding:0}}>
          {abierto ? "×" : "+"}
        </button>
      </div>
      {abierto && (
        <div style={{marginTop:4,background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:6,padding:"4px",maxHeight:140,overflowY:"auto"}}>
          {miembros.map(m => {
            const id = m.perfiles?.id;
            const asignado = encargados.includes(id);
            return (
              <div key={id} onClick={()=>onToggle(pendiente, id)} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 5px",cursor:"pointer",fontSize:12,color:"#1a3a5c"}}>
                <span style={{width:15,height:15,borderRadius:3,border:"1px solid #b8d8ef",background:asignado?"#1a6f5c":"#fff",color:"#fff",fontSize:11,display:"flex",alignItems:"center",justifyContent:"center"}}>{asignado?"✓":""}</span>
                {m.perfiles?.nombre}
              </div>
            );
          })}
        </div>
      )}
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
    const nuevos = actuales.includes(userId)
      ? actuales.filter(id => id !== userId)
      : [...actuales, userId];
    const result = await actualizarPendiente(pendiente.id, { encargados: nuevos });
    if (!result.ok) return alert("Error: " + result.error);
    setPendientes(prev => prev.map(x => x.id === pendiente.id ? result.pendiente : x));
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
      <div style={{fontSize:16,fontWeight:600,color:"#1a3a5c",marginBottom:14}}>
        {esEquipo ? `📋 Pendientes - ${equipoActual?.nombre}` : "📋 Mis pendientes"}
      </div>

      {/* Form */}
      <div style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"12px",marginBottom:14}}>
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
          <div style={{fontSize:10,color:"#7aa3c4",marginBottom:4}}>Sugerencias rápidas:</div>
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            {sugerencias.map(s => (
              <button key={s} onClick={()=>usarSugerencia(s)} style={{padding:"3px 8px",fontSize:10,background:"#f0f8fd",border:"0.5px solid #b8d8ef",color:"#4a7eab",borderRadius:12,cursor:"pointer"}}>{s}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
        <span style={{fontSize:11,color:"#7aa3c4"}}>Filtrar:</span>
        <select value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)} style={{padding:"5px 10px",fontSize:11,borderRadius:6,border:"0.5px solid #b8d8ef",background:"#fff",color:"#1a3a5c",cursor:"pointer"}}>
          <option value="pendiente">Pendientes</option>
          <option value="completado">Completados</option>
          <option value="todos">Todos</option>
        </select>
        <select value={filtroPrioridad} onChange={e=>setFiltroPrioridad(e.target.value)} style={{padding:"5px 10px",fontSize:11,borderRadius:6,border:"0.5px solid #b8d8ef",background:"#fff",color:"#1a3a5c",cursor:"pointer"}}>
          <option value="todas">Todas las prioridades</option>
          <option value="alta">🔴 Alta</option>
          <option value="normal">🟡 Normal</option>
          <option value="baja">🟢 Baja</option>
        </select>
        <span style={{fontSize:11,color:"#7aa3c4",marginLeft:"auto"}}>{filtrados.length}</span>
      </div>

      {loadingPendientes && (
        <div style={{textAlign:"center",padding:"20px",color:"#7aa3c4",fontSize:13}}>Cargando...</div>
      )}

      {!loadingPendientes && filtrados.length === 0 && (
        <div style={{textAlign:"center",padding:"40px 20px",color:"#7aa3c4",fontSize:13}}>
          No hay pendientes en este filtro
        </div>
      )}

      {!loadingPendientes && filtrados.length > 0 && (
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {filtrados.map(p => {
            const colorPrioridad = p.prioridad === "alta" ? "#c0392b" : p.prioridad === "normal" ? "#a06b1a" : "#1a6f5c";
            const completado = p.estado === "completado";
            const esAutor = p.autor_id === currentUser.id;
            return (
              <div key={p.id} style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:8,padding:"10px 12px",borderLeft:`3px solid ${colorPrioridad}`,opacity:completado?0.6:1}}>
                <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
                  <input type="checkbox" checked={completado} onChange={()=>toggleCompletar(p)} style={{marginTop:2,cursor:"pointer"}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,color:"#1a3a5c",textDecoration:completado?"line-through":"none",lineHeight:1.4,whiteSpace:"pre-wrap"}}>{p.texto}</div>
                    <div style={{fontSize:10,color:"#7aa3c4",marginTop:4,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                      <span>{p.autor?.nombre || "Anónimo"}</span>
                      {p.fecha_objetivo && <span>📅 {p.fecha_objetivo}</span>}
                      <span style={{color:colorPrioridad,fontWeight:500}}>● {p.prioridad}</span>
                    </div>
                    {esEquipo && (
                      <EncargadosPendiente pendiente={p} miembros={miembrosEquipo} onToggle={toggleEncargadoPendiente} nombreMiembro={nombreMiembro} />
                    )}
                  </div>
                  {esAutor && (
                    <button onClick={()=>eliminar(p)} style={{background:"none",border:"none",color:"#c0392b",cursor:"pointer",fontSize:13,padding:0}}>🗑</button>
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
      <div style={{fontSize:18,fontWeight:600,color:"#1a3a5c",marginBottom:6}}>Configura tus servicios</div>
      <div style={{fontSize:12,color:"#4a7eab",marginBottom:16,lineHeight:1.5}}>Antes de empezar, dime qué servicios o pisos del hospital quieres tener disponibles para asignar a tus pacientes. Puedes modificar esto después.</div>

      <div style={{fontSize:12,fontWeight:500,color:"#4a7eab",marginBottom:8}}>Sugerencias (toca para seleccionar):</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:18}}>
        {todos.map(s => {
          const sel = seleccionados.includes(s);
          return (
            <button key={s} onClick={()=>toggle(s)} style={{padding:"6px 12px",fontSize:12,fontWeight:sel?500:400,borderRadius:14,cursor:"pointer",border:sel?"none":"0.5px solid #b8d8ef",background:sel?"#1a6fb5":"#fff",color:sel?"#fff":"#4a7eab"}}>
              {sel ? "✓ " : ""}{s}
            </button>
          );
        })}
      </div>

      <div style={{fontSize:12,fontWeight:500,color:"#4a7eab",marginBottom:6}}>O agrega uno personalizado:</div>
      <div style={{display:"flex",gap:6,marginBottom:18}}>
        <input value={personalizado} onChange={e=>setPersonalizado(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")agregarPersonalizado();}} placeholder="Ej: Pediatría, 4to piso ala B..." style={{flex:1,padding:"9px 12px",fontSize:13,borderRadius:8,border:"0.5px solid #b8d8ef",outline:"none"}}/>
        <button onClick={agregarPersonalizado} disabled={!personalizado.trim()} style={{padding:"9px 14px",fontSize:13,fontWeight:500,background:personalizado.trim()?"#1a6fb5":"#cdddec",color:"#fff",border:"none",borderRadius:8,cursor:personalizado.trim()?"pointer":"default"}}>+ Agregar</button>
      </div>

      <div style={{padding:"10px 12px",background:"#f0f8fd",borderRadius:8,marginBottom:16,fontSize:12,color:"#1a4a7c",lineHeight:1.5}}>
        <strong>{seleccionados.length}</strong> servicio{seleccionados.length === 1 ? "" : "s"} seleccionado{seleccionados.length === 1 ? "" : "s"}{seleccionados.length > 0 ? `: ${seleccionados.join(", ")}` : ""}
      </div>

      <button onClick={guardar} disabled={seleccionados.length === 0} style={{...btnPrimary, marginTop:0, opacity: seleccionados.length === 0 ? 0.5 : 1}}>Empezar a usar UroSearch</button>
    </div>
  );
}

function TablaQuirurgicaPanel({ tablaCirugias, setTablaCirugias, currentUser, contexto, equipos, loadingCirugias, setLoadingCirugias }) {
  const [vista, setVista] = useState("tabla");
  const [seleccionado, setSeleccionado] = useState(null);
  useBackClose(vista !== "tabla", () => { setVista("tabla"); setSeleccionado(null); });
  const [error, setError] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [filtroFecha, setFiltroFecha] = useState("semana");

  const [nuevo, setNuevo] = useState({
    fecha: new Date().toISOString().slice(0,10), hora: "08:00",
    iniciales: "", edad: "", procedimiento: "", lateralidad: "",
    cirujano: currentUser.nombre, pabellon: "1", estado: "programada", observaciones: ""
  });

  const esEquipo = contexto !== "personal";
  const equipoActual = esEquipo ? equipos.find(e => e.id === contexto) : null;

  const cargar = async () => {
    setLoadingCirugias(true);
    const result = await listarCirugias(currentUser.id, contexto);
    setLoadingCirugias(false);
    if (result.ok) setTablaCirugias(result.cirugias);
  };

  useEffect(() => { cargar(); }, [contexto]);

  // Filtrar por fecha
  const ahora = new Date();
  const finDeSemana = new Date(ahora);
  finDeSemana.setDate(ahora.getDate() + 7);
  const finDeMes = new Date(ahora);
  finDeMes.setDate(ahora.getDate() + 30);

  const cirugiasFiltradas = tablaCirugias.filter(c => {
    if (filtroEstado !== "todos" && c.estado !== filtroEstado) return false;
    const fechaC = new Date(c.fecha + "T00:00:00");
    if (filtroFecha === "hoy") return c.fecha === ahora.toISOString().slice(0,10);
    if (filtroFecha === "semana") return fechaC >= ahora && fechaC <= finDeSemana;
    if (filtroFecha === "mes") return fechaC >= ahora && fechaC <= finDeMes;
    return true;
  });

  // Agrupar por fecha
  const porFecha = {};
  cirugiasFiltradas.forEach(c => {
    if (!porFecha[c.fecha]) porFecha[c.fecha] = [];
    porFecha[c.fecha].push(c);
  });

  // ============================================================
  // CRUD
  // ============================================================

  const guardar = async () => {
    setError("");
    if (!nuevo.iniciales.trim()) return setError("Ingresa las iniciales");
    if (nuevo.iniciales.length > 8) return setError("Máximo 8 caracteres");
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
      pabellon: nuevo.pabellon.trim() || null,
      estado: nuevo.estado,
      observaciones: nuevo.observaciones.trim() || null,
    };

    const result = await crearCirugia(datos);
    if (!result.ok) return setError(result.error);

    setTablaCirugias(prev => [...prev, result.cirugia].sort((a,b) => (a.fecha+a.hora).localeCompare(b.fecha+b.hora)));
    setNuevo({ fecha: new Date().toISOString().slice(0,10), hora: "08:00", iniciales: "", edad: "", procedimiento: "", lateralidad: "", cirujano: currentUser.nombre, pabellon: "1", estado: "programada", observaciones: "" });
    setVista("tabla");
  };

  const cambiarEstado = async (cirugia, nuevoEstado) => {
    const result = await actualizarCirugia(cirugia.id, { estado: nuevoEstado });
    if (!result.ok) return alert("Error: " + result.error);
    setTablaCirugias(prev => prev.map(c => c.id === cirugia.id ? result.cirugia : c));
    if (seleccionado?.id === cirugia.id) setSeleccionado(result.cirugia);
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
      // PROCESAR FILAS DE DATOS
      // ====================================================================
      const filas = [];
      let fechaActual = null;
      let horarioActual = "AM"; // AM o PM
      
      for (let i = filaHeaders + 1; i < matriz.length; i++) {
        const fila = matriz[i];
        if (!fila || fila.every(c => !c || String(c).trim() === "")) continue;

        // Detectar fila de día (ej: "LUNES 04" en columna A)
        const colA = String(fila[0] || "").toUpperCase().trim();
        const matchDia = colA.match(/(LUNES|MARTES|MIERCOLES|MIÉRCOLES|JUEVES|VIERNES|SABADO|SÁBADO|DOMINGO)\s*(\d{1,2})/);
        if (matchDia) {
          const diaNum = matchDia[2].padStart(2, "0");
          // Detectar mes y año del título principal o del nombre del archivo
          const ahora = new Date();
          const mes = String(ahora.getMonth() + 1).padStart(2, "0");
          const anio = ahora.getFullYear();
          fechaActual = `${anio}-${mes}-${diaNum}`;
          continue;
        }

        // Detectar horario (AM/PM/PC en col B)
        const colB = String(fila[1] || "").toUpperCase().trim();
        if (colB === "AM" || colB === "PM" || colB === "PC") {
          horarioActual = colB;
        }

        // Si no hay fecha actual, no se puede importar
        if (!fechaActual) continue;

        // Extraer datos de la fila
        const nombreCompleto = String(fila[mapaColumnas.nombre] || "").trim();
        const diagnostico = String(fila[mapaColumnas.diagnostico] || "").trim();
        const cirugia = String(fila[mapaColumnas.cirugia] || "").trim();
        
        // Solo importar si hay diagnóstico Y cirugía
        if (!diagnostico || !cirugia) continue;
        if (nombreCompleto === "" || nombreCompleto.toUpperCase() === "NOMBRE") continue;

        // Anonimizar: convertir nombre completo a iniciales
        const iniciales = nombreCompleto
          .split(/\s+/)
          .filter(p => p.length > 1)
          .map(p => p[0].toUpperCase())
          .join("")
          .slice(0, 8) || "??";

        // Edad
        const edadStr = String(fila[mapaColumnas.edad] || "").trim();
        const edad = edadStr && !isNaN(parseInt(edadStr)) ? parseInt(edadStr) : null;

        // Lateralidad
        const ladoRaw = String(fila[mapaColumnas.lado] || "").trim().toUpperCase();
        let lateralidad = null;
        if (ladoRaw.includes("D") || ladoRaw === "DER") lateralidad = "Derecha";
        else if (ladoRaw.includes("I") || ladoRaw === "IZQ") lateralidad = "Izquierda";
        else if (ladoRaw.includes("BIL")) lateralidad = "Bilateral";

        // Cirujano (anonimizar también si tiene nombres completos)
        const cirujanoRaw = String(fila[mapaColumnas.cirujano] || "").trim();
        const cirujano = cirujanoRaw || null;

        // Hora estimada según horario
        const hora = horarioActual === "AM" ? "08:00" : horarioActual === "PM" ? "14:00" : "08:00";

        filas.push({
          cirujano_id: currentUser.id,
          equipo_id: esEquipo ? contexto : null,
          fecha: fechaActual,
          hora: hora,
          iniciales: iniciales,
          edad: edad,
          procedimiento: cirugia.slice(0, 200),
          lateralidad: lateralidad,
          cirujano: cirujano ? cirujano.slice(0, 100) : null,
          pabellon: "1",
          estado: 'programada',
          observaciones: String(fila[mapaColumnas.obs] || "").trim().slice(0, 500) || `Diagnóstico: ${diagnostico}`,
        });
      }

      if (filas.length === 0) {
        alert("No se pudo extraer ninguna cirugía válida del Excel.");
        return;
      }

      // Confirmar antes de insertar
      if (!confirm(`Se importarán ${filas.length} cirugías (con nombres convertidos a iniciales). ¿Continuar?`)) {
        e.target.value = "";
        return;
      }

      const result = await crearCirugiasBulk(filas);
      if (!result.ok) {
        alert("Error al importar: " + result.error);
        return;
      }

      setTablaCirugias(prev => [...prev, ...result.cirugias].sort((a,b) => (a.fecha+a.hora).localeCompare(b.fecha+b.hora)));
      alert(`✓ ${result.cirugias.length} cirugías importadas y anonimizadas`);
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
        <button onClick={()=>{setVista("tabla");setError("");}} style={{background:"none",border:"none",color:"#4a7eab",fontSize:13,cursor:"pointer",marginBottom:12,padding:0}}>← Volver</button>
        <div style={{fontSize:16,fontWeight:600,color:"#1a3a5c",marginBottom:14}}>Nueva cirugía {esEquipo && `en equipo "${equipoActual?.nombre}"`}</div>

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
            <label style={labelStyle}>Iniciales (máx 8)</label>
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
            <input value={nuevo.pabellon} onChange={e=>setNuevo({...nuevo,pabellon:e.target.value})} placeholder="1" style={inputStyle}/>
          </div>
        </div>

        <label style={labelStyle}>Cirujano</label>
        <input value={nuevo.cirujano} onChange={e=>setNuevo({...nuevo,cirujano:e.target.value})} style={inputStyle}/>

        <label style={labelStyle}>Observaciones (opcional)</label>
        <textarea value={nuevo.observaciones} onChange={e=>setNuevo({...nuevo,observaciones:e.target.value})} rows={2} style={{...inputStyle,resize:"vertical"}}/>

        {error && <div style={{fontSize:12,color:"#c0392b",background:"#fde8e6",padding:"8px 10px",borderRadius:6,marginBottom:8}}>{error}</div>}

        <button onClick={guardar} style={{...btnPrimary, marginTop:0}}>Guardar cirugía</button>
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
        <button onClick={()=>{setVista("tabla");setSeleccionado(null);}} style={{background:"none",border:"none",color:"#4a7eab",fontSize:13,cursor:"pointer",marginBottom:10,padding:0}}>← Volver a la tabla</button>

        <div style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"14px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
            <div>
              <div style={{fontSize:18,fontWeight:600,color:"#1a3a5c"}}>{seleccionado.iniciales}{seleccionado.edad && ` (${seleccionado.edad}a)`}</div>
              <div style={{fontSize:13,color:"#4a7eab",marginTop:4}}>{seleccionado.procedimiento}{seleccionado.lateralidad && ` • ${seleccionado.lateralidad}`}</div>
              <div style={{fontSize:11,color:"#7aa3c4",marginTop:4}}>📅 {seleccionado.fecha} {seleccionado.hora?.slice(0,5)} | Pabellón {seleccionado.pabellon}</div>
              {seleccionado.cirujano && <div style={{fontSize:11,color:"#7aa3c4",marginTop:2}}>👨‍⚕️ {seleccionado.cirujano}</div>}
            </div>
          </div>

          <div style={{fontSize:12,color:"#1a3a5c",marginBottom:10,padding:"6px 10px",background:"#f0f8fd",borderRadius:6}}>
            <strong>Estado actual:</strong> {seleccionado.estado}
          </div>

          {seleccionado.observaciones && (
            <div style={{fontSize:12,color:"#1a3a5c",marginBottom:10,padding:"8px 10px",background:"#fff8e1",borderRadius:6}}>
              <strong>Observaciones:</strong> {seleccionado.observaciones}
            </div>
          )}

          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:14}}>
            {["programada","en_curso","completada","suspendida","cancelada"].map(estado => (
              <button 
                key={estado} 
                onClick={()=>cambiarEstado(seleccionado, estado)}
                disabled={seleccionado.estado === estado}
                style={{padding:"5px 10px",fontSize:11,background:seleccionado.estado === estado ? "#1a6fb5" : "#fff",color:seleccionado.estado === estado ? "#fff" : "#4a7eab",border:"0.5px solid #b8d8ef",borderRadius:6,cursor:seleccionado.estado === estado ? "default" : "pointer",fontWeight:500}}
              >{estado.replace("_"," ")}</button>
            ))}
          </div>

          {esCirujano && (
            <button onClick={()=>eliminar(seleccionado)} style={{marginTop:14,width:"100%",padding:"10px",fontSize:12,background:"#fff",color:"#c0392b",border:"1px solid #c0392b",borderRadius:8,cursor:"pointer",fontWeight:500}}>🗑 Eliminar cirugía</button>
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
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
        <div style={{fontSize:16,fontWeight:600,color:"#1a3a5c"}}>
          {esEquipo ? `🔪 Tabla - ${equipoActual?.nombre}` : "🔪 Mi tabla quirúrgica"}
        </div>
        <div style={{display:"flex",gap:6}}>
          <label style={{padding:"6px 12px",fontSize:12,background:"#fff",color:"#1a6fb5",border:"0.5px solid #b8d8ef",borderRadius:6,cursor:"pointer",fontWeight:500}}>
            📊 Importar Excel
            <input type="file" accept=".xlsx,.xls" onChange={importarExcel} style={{display:"none"}}/>
          </label>
          <button onClick={()=>setVista("nuevo")} style={{padding:"6px 12px",fontSize:12,background:"#1a6fb5",color:"#fff",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>+ Nueva</button>
        </div>
      </div>

      {/* Filtros */}
      <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
        <span style={{fontSize:11,color:"#7aa3c4"}}>Filtrar:</span>
        <select value={filtroFecha} onChange={e=>setFiltroFecha(e.target.value)} style={{padding:"5px 10px",fontSize:11,borderRadius:6,border:"0.5px solid #b8d8ef",background:"#fff",color:"#1a3a5c",cursor:"pointer"}}>
          <option value="hoy">Hoy</option>
          <option value="semana">Próxima semana</option>
          <option value="mes">Próximo mes</option>
          <option value="todos">Todas</option>
        </select>
        <select value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)} style={{padding:"5px 10px",fontSize:11,borderRadius:6,border:"0.5px solid #b8d8ef",background:"#fff",color:"#1a3a5c",cursor:"pointer"}}>
          <option value="todos">Todos los estados</option>
          <option value="programada">Programadas</option>
          <option value="en_curso">En curso</option>
          <option value="completada">Completadas</option>
          <option value="suspendida">Suspendidas</option>
          <option value="cancelada">Canceladas</option>
        </select>
        <span style={{fontSize:11,color:"#7aa3c4",marginLeft:"auto"}}>{cirugiasFiltradas.length} cirugías</span>
      </div>

      {loadingCirugias && (
        <div style={{textAlign:"center",padding:"30px",color:"#7aa3c4",fontSize:13}}>Cargando tabla...</div>
      )}

      {!loadingCirugias && cirugiasFiltradas.length === 0 && (
        <div style={{textAlign:"center",padding:"40px 20px",color:"#7aa3c4",fontSize:13,lineHeight:1.6}}>
          No hay cirugías en el filtro seleccionado.<br/>
          Agrega manualmente con + Nueva o importa un Excel.
        </div>
      )}

      {!loadingCirugias && Object.keys(porFecha).sort().map(fecha => (
        <div key={fecha} style={{marginBottom:14}}>
          <div style={{fontSize:12,fontWeight:600,color:"#1a3a5c",marginBottom:8,padding:"4px 10px",background:"#e0e9f5",borderRadius:6}}>
            📅 {new Date(fecha + "T00:00:00").toLocaleDateString("es-CL",{weekday:"long",day:"numeric",month:"long"})} ({porFecha[fecha].length})
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:5}}>
            {porFecha[fecha].sort((a,b)=>(a.hora||"").localeCompare(b.hora||"")).map(c => {
              const colores = {
                programada: "#1a6fb5", en_curso: "#a06b1a", completada: "#1a6f5c",
                suspendida: "#999", cancelada: "#c0392b"
              };
              return (
                <div key={c.id} onClick={()=>{setSeleccionado(c);setVista("detalle");}} style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:8,padding:"10px 12px",cursor:"pointer",borderLeft:`3px solid ${colores[c.estado]}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,color:"#1a3a5c",fontWeight:500}}>
                        {c.hora?.slice(0,5)} | {c.iniciales}{c.edad ? ` (${c.edad}a)` : ""} | {c.procedimiento}{c.lateralidad ? ` (${c.lateralidad})` : ""}
                      </div>
                      <div style={{fontSize:10,color:"#7aa3c4",marginTop:2}}>
                        Pabellón {c.pabellon} {c.cirujano && `| ${c.cirujano}`}
                      </div>
                    </div>
                    <span style={{fontSize:9,padding:"2px 8px",background:colores[c.estado],color:"#fff",borderRadius:10,whiteSpace:"nowrap"}}>{c.estado.replace("_"," ")}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
  }

 

function PacientesPanel({ pacientes, setPacientes, currentUser, contexto, equipos, misServiciosLista, setMisServiciosLista, loadingPacientes, setLoadingPacientes }) {
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
  const result = await actualizarPaciente(pacienteId, { encargados: nuevosEncargados });
  if (!result.ok) return alert("Error: " + result.error);
  setPacientes(prev => prev.map(p => p.id === pacienteId ? result.paciente : p));
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
    const evoResult = await listarEvoluciones(paciente.id);
    if (evoResult.ok) setEvoluciones(evoResult.evoluciones);
    const exResult = await listarExamenes(paciente.id);
    if (exResult.ok) setExamenes(exResult.examenes.map(normalizarExamen));
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

    // DIAGNÓSTICO TEMPORAL - muestra lo que se va a enviar
    alert("DIAGNÓSTICO - datos_estructurados que se envía:\n\n" + JSON.stringify(estructurados, null, 2));

    const result = await crearExamen(seleccionado.id, currentUser.id, datos);
    if (!result.ok) return alert("Error: " + result.error);
    // DIAGNÓSTICO TEMPORAL - muestra lo que devolvió la base
    alert("DIAGNÓSTICO - lo que devolvió crearExamen:\n\n" + JSON.stringify(result.examen?.datos_estructurados, null, 2));
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
        <button onClick={()=>{setVista("lista");setError("");}} style={{background:"none",border:"none",color:"#4a7eab",fontSize:13,cursor:"pointer",marginBottom:12,padding:0}}>← Volver</button>
        <div style={{fontSize:16,fontWeight:600,color:"#1a3a5c",marginBottom:14}}>Nuevo paciente {esEquipo && `en equipo "${equipoActual?.nombre}"`}</div>
        
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
          <div style={{fontSize:11,color:"#a06b1a",background:"#fff8e1",padding:"8px 10px",borderRadius:6,marginBottom:8}}>
            No tienes servicios configurados. Ve a "⚙️ Servicios" antes de crear pacientes.
          </div>
        )}

        <label style={labelStyle}>Fecha ingreso</label>
        <input type="date" value={nuevo.fecha_ingreso} onChange={e=>setNuevo({...nuevo,fecha_ingreso:e.target.value})} style={inputStyle}/>

        <label style={labelStyle}>Diagnóstico</label>
        <textarea value={nuevo.diagnostico} onChange={e=>setNuevo({...nuevo,diagnostico:e.target.value})} placeholder="Diagnóstico principal" rows={2} style={{...inputStyle,resize:"vertical"}}/>

        <label style={labelStyle}>Plan de manejo (opcional)</label>
        <textarea value={nuevo.plan_manejo} onChange={e=>setNuevo({...nuevo,plan_manejo:e.target.value})} placeholder="Plan inicial" rows={3} style={{...inputStyle,resize:"vertical"}}/>

        {error && <div style={{fontSize:12,color:"#c0392b",background:"#fde8e6",padding:"8px 10px",borderRadius:6,marginBottom:8}}>{error}</div>}

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
        <button onClick={()=>setVista("lista")} style={{background:"none",border:"none",color:"#4a7eab",fontSize:13,cursor:"pointer",marginBottom:12,padding:0}}>← Volver</button>
        <div style={{fontSize:16,fontWeight:600,color:"#1a3a5c",marginBottom:6}}>⚙️ Mis servicios</div>
        <div style={{fontSize:12,color:"#7aa3c4",marginBottom:14}}>Configura los servicios/pisos del hospital donde atiendes</div>

        <div style={{display:"flex",gap:6,marginBottom:14}}>
          <input value={nuevoServicio} onChange={e=>setNuevoServicio(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")agregarServicio();}} placeholder="Ej: Cirugía 3er piso" style={{flex:1,padding:"9px 12px",fontSize:13,borderRadius:8,border:"0.5px solid #b8d8ef",outline:"none"}}/>
          <button onClick={agregarServicio} disabled={!nuevoServicio.trim()} style={{padding:"9px 14px",fontSize:13,fontWeight:500,background:nuevoServicio.trim()?"#1a6fb5":"#cdddec",color:"#fff",border:"none",borderRadius:8,cursor:"pointer"}}>Agregar</button>
        </div>

        {misServiciosLista.length === 0 ? (
          <div style={{textAlign:"center",padding:"30px 16px",color:"#7aa3c4",fontSize:13}}>No tienes servicios configurados.</div>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {misServiciosLista.map(s => (
              <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:8,padding:"10px 14px"}}>
                <div style={{fontSize:13,color:"#1a3a5c"}}>{s.nombre}</div>
                <button onClick={()=>quitarServicio(s.id)} style={{background:"none",border:"none",color:"#c0392b",cursor:"pointer",fontSize:14}}>🗑</button>
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
        <button onClick={()=>{setVista("lista");setSeleccionado(null);}} style={{background:"none",border:"none",color:"#4a7eab",fontSize:13,cursor:"pointer",marginBottom:10,padding:0}}>← Volver a la lista</button>

       {/* Cabecera */}
<div style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"14px",marginBottom:12}}>
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
          {["HTA","DM 2","Hipotiroidismo","Cardiópata","IAM","ACV","Obesidad","Otro"].map(ant => {
            const lista = Array.isArray(editForm.antecedentes) ? editForm.antecedentes : [];
            const activo = lista.includes(ant);
            return (
              <button key={ant} type="button" onClick={()=>{
                const nueva = activo ? lista.filter(x=>x!==ant) : [...lista, ant];
                setEditForm({...editForm, antecedentes: nueva});
              }} style={{padding:"5px 11px",fontSize:13,borderRadius:14,cursor:"pointer",border:activo?"none":"0.5px solid #b8d8ef",background:activo?"#f2a03f":"#fff",color:activo?"#fff":"#7aa3c4",fontWeight:activo?600:400}}>
                {ant}
              </button>
            );
          })}
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
        <button onClick={()=>setEditandoFicha(false)} style={{padding:"9px 14px",fontSize:13,background:"#fff",color:"#7aa3c4",border:"0.5px solid #b8d8ef",borderRadius:8,cursor:"pointer"}}>Cancelar</button>
      </div>
    </div>
  ) : (
    <>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,marginBottom:8}}>
        <div>
          <div style={{fontSize:24,fontWeight:700,color:"#1a3a5c"}}>{seleccionado.iniciales} <span style={{fontSize:28,fontWeight:700,color:seleccionado.sexo==="F"?"#d6336c":"#1a6fb5"}}>{seleccionado.sexo==="F"?"♀":"♂"}</span></div>
          <div style={{fontSize:16,fontWeight:600,color:"#4a7eab",marginTop:4}}>
            {seleccionado.edad} años · Cama {seleccionado.cama} · {seleccionado.servicio}
          </div>
          <div style={{fontSize:14,color:"#7aa3c4",marginTop:4}}>Ingreso: {seleccionado.fecha_ingreso}</div>
        </div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          <button onClick={iniciarEdicion} style={{padding:"5px 10px",fontSize:11,background:"#1a6fb5",color:"#fff",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>✏ Editar</button>
          {seleccionado.estado === "activo" ? (
            <button onClick={()=>cambiarEstado(seleccionado, "alta")} style={{padding:"5px 10px",fontSize:11,background:"#1a6f5c",color:"#fff",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>✓ Dar alta</button>
          ) : (
            <button onClick={()=>cambiarEstado(seleccionado, "activo")} style={{padding:"5px 10px",fontSize:11,background:"#fff",color:"#1a6fb5",border:"0.5px solid #b8d8ef",borderRadius:6,cursor:"pointer"}}>↺ Reactivar</button>
          )}
          {esCreador && (
            <button onClick={()=>eliminarPacienteHandler(seleccionado)} style={{padding:"5px 10px",fontSize:11,background:"#fff",color:"#c0392b",border:"0.5px solid #f0c5c0",borderRadius:6,cursor:"pointer"}}>🗑</button>
          )}
        </div>
      </div>
      <div style={{fontSize:14,color:"#1a3a5c",marginTop:8,padding:"10px 12px",background:"#f0f8fd",borderRadius:6}}>
        <strong>Diagnóstico:</strong> {seleccionado.diagnostico}
      </div>
      {/* Estado clínico */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:6,padding:"10px 12px",background:"#f0f8fd",borderRadius:6}}>
        <span style={{fontSize:14,color:"#1a3a5c",fontWeight:600}}>Estado del paciente</span>
        <select value={seleccionado.estado_clinico || ""} onChange={e=>cambiarEstadoClinico(e.target.value)} style={{fontSize:13,padding:"5px 10px",borderRadius:6,border:"0.5px solid #b8d8ef",background:"#fff",color:"#1a3a5c",cursor:"pointer"}}>
          <option value="">Sin definir</option>
          <option value="estable">🟢 Estable</option>
          <option value="regular">🟡 Regular</option>
          <option value="cuidado">🔴 De cuidado</option>
        </select>
      </div>
      {/* Operado + agregar cirugía */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:6,padding:"10px 12px",background:seleccionado.operado?"#e0f5ec":"#f0f8fd",borderRadius:6,gap:10,flexWrap:"wrap"}}>
        <span style={{fontSize:14,color:"#1a3a5c",fontWeight:600}}>🔪 Paciente operado</span>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {seleccionado.operado && (
            <button onClick={abrirFormCirugia} style={{fontSize:12,background:"#1a6f5c",color:"#fff",border:"none",borderRadius:6,padding:"5px 10px",cursor:"pointer",fontWeight:500}}>+ Agregar cirugía</button>
          )}
          <button onClick={toggleOperado} style={{width:46,height:26,borderRadius:13,border:"none",cursor:"pointer",background:seleccionado.operado?"#1a6f5c":"#c8d8e4",position:"relative",transition:"background 0.2s",padding:0}}>
            <span style={{position:"absolute",top:3,left:seleccionado.operado?23:3,width:20,height:20,borderRadius:"50%",background:"#fff",transition:"left 0.2s",boxShadow:"0 1px 2px rgba(0,0,0,0.2)"}}/>
          </button>
        </div>
      </div>
      {/* Formulario para agregar cirugía */}
      {seleccionado.operado && formCirugia && (
        <div style={{marginTop:6,padding:"12px",background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:6}}>
          <div style={{fontSize:13,fontWeight:600,color:"#1a3a5c",marginBottom:8}}>Nueva cirugía</div>
          <label style={labelStyle}>Fecha de la cirugía</label>
          <input type="date" value={formCirugia.fecha} onChange={e=>setFormCirugia({...formCirugia, fecha:e.target.value})} style={inputStyle}/>
          <label style={labelStyle}>Cirugía realizada</label>
          <input value={formCirugia.nombre} onChange={e=>setFormCirugia({...formCirugia, nombre:e.target.value})} placeholder="Ej: RTU vesical, Nefrectomía..." style={inputStyle}/>
          <div style={{display:"flex",gap:8,marginTop:4}}>
            <button onClick={guardarCirugia} style={{...btnPrimary,marginTop:0,flex:1}}>Guardar cirugía</button>
            <button onClick={()=>setFormCirugia(null)} style={{padding:"9px 14px",fontSize:13,background:"#fff",color:"#7aa3c4",border:"0.5px solid #b8d8ef",borderRadius:8,cursor:"pointer"}}>Cancelar</button>
          </div>
        </div>
      )}
      {/* Lista de cirugías con día post-op */}
      {seleccionado.operado && Array.isArray(seleccionado.cirugias_realizadas) && seleccionado.cirugias_realizadas.length > 0 && (
        <div style={{marginTop:6,padding:"10px 12px",background:"#e0f5ec",borderRadius:6}}>
          {seleccionado.cirugias_realizadas.map((cx, idx) => {
            const dia = diaPostOp(cx.fecha);
            return (
              <div key={idx} style={{display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:14,color:"#1a3a5c",padding:"3px 0"}}>
                <span><strong>Día {dia}:</strong> {cx.nombre}</span>
                <button onClick={()=>eliminarCirugia(idx)} style={{background:"none",border:"none",color:"#c0392b",cursor:"pointer",fontSize:13,padding:0}}>✕</button>
              </div>
            );
          })}
        </div>
      )}
      {Array.isArray(seleccionado.antecedentes) && seleccionado.antecedentes.length > 0 && (
        <div style={{fontSize:14,color:"#1a3a5c",marginTop:6,padding:"10px 12px",background:"#f0f8fd",borderRadius:6}}>
          <strong>Antecedentes:</strong>{" "}
          <span style={{display:"inline-flex",flexWrap:"wrap",gap:5,verticalAlign:"middle"}}>
            {seleccionado.antecedentes.map(a => (
              <span key={a} style={{fontSize:12,background:"#fef3c7",color:"#92400e",padding:"2px 8px",borderRadius:8,fontWeight:600}}>{a}</span>
            ))}
          </span>
        </div>
      )}
      {seleccionado.alergias && seleccionado.alergias.trim() && (
        <div style={{fontSize:14,color:"#1a3a5c",marginTop:6,padding:"10px 12px",background:"#fde8e6",borderRadius:6}}>
          <strong style={{color:"#c0392b"}}>⚠ Alergias:</strong> {seleccionado.alergias}
        </div>
      )}
      {seleccionado.plan_manejo && (
        <div style={{fontSize:14,color:"#1a3a5c",marginTop:6,padding:"10px 12px",background:"#f0f8fd",borderRadius:6,whiteSpace:"pre-wrap"}}>
          <strong>Plan:</strong> {seleccionado.plan_manejo}
        </div>
      )}
    </>
  )}
</div>

        {/* EVOLUCIONES */}
        <div style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"14px",marginBottom:12}}>
          <div style={{fontSize:13,fontWeight:600,color:"#1a3a5c",marginBottom:10}}>📝 Evoluciones</div>

          {/* Selector tipo */}
          <div style={{display:"flex",gap:8,marginBottom:10}}>
            <button onClick={()=>setTipoEvo("estructurada")} style={{flex:1,padding:"11px 14px",fontSize:14,background:tipoEvo==="estructurada"?"#1a6fb5":"#fff",color:tipoEvo==="estructurada"?"#fff":"#4a7eab",border:tipoEvo==="estructurada"?"none":"0.5px solid #b8d8ef",borderRadius:8,cursor:"pointer",fontWeight:600}}>Estructurada (SOAP)</button>
            <button onClick={()=>setTipoEvo("libre")} style={{flex:1,padding:"11px 14px",fontSize:14,background:tipoEvo==="libre"?"#1a6fb5":"#fff",color:tipoEvo==="libre"?"#fff":"#4a7eab",border:tipoEvo==="libre"?"none":"0.5px solid #b8d8ef",borderRadius:8,cursor:"pointer",fontWeight:600}}>Libre</button>
          </div>

          {tipoEvo === "libre" ? (
            <textarea value={evoLibre} onChange={e=>setEvoLibre(e.target.value)} placeholder="Escribe la evolución..." rows={4} style={{...inputStyle,resize:"vertical",marginBottom:6}}/>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:6}}>
  
  {/* PLANTILLAS COMPLETAS - desplegable */}
  <div style={{border:"0.5px solid #b8d8ef",borderRadius:6,overflow:"hidden"}}>
    <button onClick={()=>setSeccionAbierta(seccionAbierta==="plantillas"?null:"plantillas")} style={{width:"100%",padding:"9px 12px",background:"#f0f8fd",border:"none",cursor:"pointer",fontSize:12,fontWeight:600,color:"#1a6fb5",textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      📋 Plantillas completas <span>{seccionAbierta==="plantillas"?"▴":"▾"}</span>
    </button>
    {seccionAbierta==="plantillas" && (
      <div style={{display:"flex",flexWrap:"wrap",gap:5,padding:"8px 12px"}}>
        {Object.keys(PLANTILLAS_SOAP).map(nombre => (
          <button key={nombre} onClick={()=>setEvoEstructurada(PLANTILLAS_SOAP[nombre])} style={{padding:"5px 11px",fontSize:11,background:"#fff",border:"0.5px solid #b8d8ef",color:"#1a6fb5",borderRadius:10,cursor:"pointer"}}>{nombre}</button>
        ))}
      </div>
    )}
  </div>

  {/* SUBJETIVO */}
  <div>
    <textarea value={evoEstructurada.subjetivo} onChange={e=>setEvoEstructurada({...evoEstructurada,subjetivo:e.target.value})} placeholder="S - Subjetivo (lo que refiere el paciente)" rows={2} style={{...inputStyle,resize:"vertical",marginBottom:3}}/>
    <button onClick={()=>setSeccionAbierta(seccionAbierta==="subjetivo"?null:"subjetivo")} style={{padding:"4px 10px",fontSize:11,background:"#f8fbfd",border:"0.5px solid #cdddec",color:"#7aa3c4",borderRadius:8,cursor:"pointer"}}>+ Sugerencias {seccionAbierta==="subjetivo"?"▴":"▾"}</button>
    {seccionAbierta==="subjetivo" && (
      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
        {SUGERENCIAS_SOAP.subjetivo.map(s => (
          <button key={s} onClick={()=>setEvoEstructurada({...evoEstructurada,subjetivo: evoEstructurada.subjetivo ? evoEstructurada.subjetivo + " " + s : s})} style={{padding:"3px 8px",fontSize:11,background:"#fff",border:"0.5px solid #cdddec",color:"#4a7eab",borderRadius:8,cursor:"pointer"}}>{s}</button>
        ))}
      </div>
    )}
  </div>

  {/* OBJETIVO */}
  <div>
    <textarea value={evoEstructurada.objetivo} onChange={e=>setEvoEstructurada({...evoEstructurada,objetivo:e.target.value})} placeholder="O - Objetivo (signos vitales, laboratorio)" rows={2} style={{...inputStyle,resize:"vertical",marginBottom:3}}/>
    <button onClick={()=>setSeccionAbierta(seccionAbierta==="objetivo"?null:"objetivo")} style={{padding:"4px 10px",fontSize:11,background:"#f8fbfd",border:"0.5px solid #cdddec",color:"#7aa3c4",borderRadius:8,cursor:"pointer"}}>+ Sugerencias {seccionAbierta==="objetivo"?"▴":"▾"}</button>
    {seccionAbierta==="objetivo" && (
      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
        {SUGERENCIAS_SOAP.objetivo.map(s => (
          <button key={s} onClick={()=>setEvoEstructurada({...evoEstructurada,objetivo: evoEstructurada.objetivo ? evoEstructurada.objetivo + " " + s : s})} style={{padding:"3px 8px",fontSize:11,background:"#fff",border:"0.5px solid #cdddec",color:"#4a7eab",borderRadius:8,cursor:"pointer"}}>{s}</button>
        ))}
      </div>
    )}
  </div>

  {/* DIURESIS */}
  <div style={{padding:"10px 12px",background:"#f0f8fd",borderRadius:6,border:"0.5px solid #b8d8ef"}}>
    <div style={{fontSize:12,fontWeight:600,color:"#1a6fb5",marginBottom:6}}>💧 Diuresis</div>
    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
      <input type="number" value={diuresis.cantidad} onChange={e=>setDiuresis({...diuresis,cantidad:e.target.value})} placeholder="Cantidad" style={{...inputStyle,marginBottom:0,width:100,flex:"0 0 auto"}}/>
      <span style={{alignSelf:"center",fontSize:12,color:"#7aa3c4"}}>ml</span>
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
  <div style={{padding:"10px 12px",background:"#f0f8fd",borderRadius:6,border:"0.5px solid #b8d8ef"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div style={{fontSize:12,fontWeight:600,color:"#1a6fb5"}}>🩸 Drenaje</div>
      <button onClick={()=>setDrenaje({...drenaje, activo: !drenaje.activo})} style={{width:46,height:26,borderRadius:13,border:"none",cursor:"pointer",background:drenaje.activo?"#1a6f5c":"#c8d8e4",position:"relative",transition:"background 0.2s",padding:0}}>
        <span style={{position:"absolute",top:3,left:drenaje.activo?23:3,width:20,height:20,borderRadius:"50%",background:"#fff",transition:"left 0.2s",boxShadow:"0 1px 2px rgba(0,0,0,0.2)"}}/>
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
          <span style={{fontSize:12,color:"#7aa3c4"}}>ml</span>
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
    <button onClick={()=>setSeccionAbierta(seccionAbierta==="examen"?null:"examen")} style={{padding:"4px 10px",fontSize:11,background:"#f8fbfd",border:"0.5px solid #cdddec",color:"#7aa3c4",borderRadius:8,cursor:"pointer"}}>+ Sugerencias {seccionAbierta==="examen"?"▴":"▾"}</button>
    {seccionAbierta==="examen" && (
      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
        {SUGERENCIAS_SOAP.examen.map(s => (
          <button key={s} onClick={()=>setEvoEstructurada({...evoEstructurada,examen: evoEstructurada.examen ? evoEstructurada.examen + " " + s : s})} style={{padding:"3px 8px",fontSize:11,background:"#fff",border:"0.5px solid #cdddec",color:"#4a7eab",borderRadius:8,cursor:"pointer"}}>{s}</button>
        ))}
      </div>
    )}
  </div>

  {/* INDICACIONES */}
  <div>
    <textarea value={evoEstructurada.indicaciones} onChange={e=>setEvoEstructurada({...evoEstructurada,indicaciones:e.target.value})} placeholder="P - Plan/indicaciones" rows={2} style={{...inputStyle,resize:"vertical",marginBottom:3}}/>
    <button onClick={()=>setSeccionAbierta(seccionAbierta==="indicaciones"?null:"indicaciones")} style={{padding:"4px 10px",fontSize:11,background:"#f8fbfd",border:"0.5px solid #cdddec",color:"#7aa3c4",borderRadius:8,cursor:"pointer"}}>+ Sugerencias {seccionAbierta==="indicaciones"?"▴":"▾"}</button>
    {seccionAbierta==="indicaciones" && (
      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
        {SUGERENCIAS_SOAP.indicaciones.map(s => (
          <button key={s} onClick={()=>setEvoEstructurada({...evoEstructurada,indicaciones: evoEstructurada.indicaciones ? evoEstructurada.indicaciones + "\n" + s : s})} style={{padding:"3px 8px",fontSize:11,background:"#fff",border:"0.5px solid #cdddec",color:"#4a7eab",borderRadius:8,cursor:"pointer"}}>{s}</button>
        ))}
      </div>
    )}
  </div>

</div>
          )}

          <button onClick={guardarEvolucion} style={{...btnPrimary, marginTop:0, marginBottom:12}}>+ Guardar evolución</button>

          {/* Lista de evoluciones */}
          {evoluciones.length === 0 ? (
            <div style={{fontSize:11,color:"#7aa3c4",fontStyle:"italic",padding:"10px 0"}}>No hay evoluciones registradas</div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {evoluciones.map((e, idx) => (
                <div key={e.id} style={{background:idx===0?"#e8f4fd":"#f0f8fd",borderRadius:6,padding:"10px 12px",borderLeft:idx===0?"3px solid #1a6fb5":"3px solid #b8d8ef",border:idx===0?"0.5px solid #1a6fb5":"none"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4,gap:8}}>
                    <div style={{fontSize:11,color:"#7aa3c4",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                      {idx===0 && <span style={{fontSize:9,background:"#1a6fb5",color:"#fff",padding:"1px 7px",borderRadius:8,fontWeight:600}}>MÁS RECIENTE</span>}
                      {e.fecha_evolucion} {e.hora_evolucion?.slice(0,5)} | {e.autor?.nombre || "Anónimo"} | <span style={{color:e.tipo==="estructurada"?"#1a6f5c":e.tipo==="examen"?"#a06b1a":"#4a7eab",fontWeight:e.tipo==="examen"?600:400}}>{e.tipo==="examen"?"🧪 examen":e.tipo}</span>
                    </div>
                    {e.autor_id === currentUser.id && (
                      <button onClick={()=>eliminarEvo(e.id)} style={{background:"none",border:"none",color:"#c0392b",cursor:"pointer",fontSize:12,padding:0}}>🗑</button>
                    )}
                  </div>
                  <div style={{fontSize:idx===0?13:12,color:"#1a3a5c",whiteSpace:"pre-wrap",lineHeight:1.4}}>{e.texto}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* EXÁMENES */}
        <div style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"14px"}}>
          <div style={{fontSize:13,fontWeight:600,color:"#1a3a5c",marginBottom:10}}>🧪 Exámenes</div>

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
            <div style={{padding:"10px 12px",background:"#f0f8fd",borderRadius:6,border:"0.5px solid #b8d8ef",marginBottom:6}}>
              <div style={{fontSize:11,color:"#7aa3c4",marginBottom:8}}>Completa solo los parámetros que tengas (los vacíos se omiten):</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {PARAMETROS_LAB[nuevoEx.nombre].map(param => (
                  <div key={param.key} style={{display:"flex",alignItems:"center",gap:4}}>
                    <span style={{fontSize:11,color:"#1a3a5c",fontWeight:500,minWidth:74}}>{param.label}</span>
                    <input type="number" value={paramsLab[param.key] || ""} onChange={e=>setParamsLab({...paramsLab,[param.key]:e.target.value})} style={{...inputStyle,marginBottom:0,padding:"6px 8px",fontSize:12}}/>
                    {param.unidad && <span style={{fontSize:10,color:"#7aa3c4",minWidth:38}}>{param.unidad}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {nuevoEx.tipo === "Imagen" && (
            <select value={nuevoEx.nombre} onChange={e=>setNuevoEx({...nuevoEx,nombre:e.target.value,pirads:"",pesoProstatico:""})} style={inputStyle}>
              <option value="">Selecciona imagen...</option>
              {["UROTAC","TAC TAP","Pielotac","RM próstata","TAC tórax","Eco VP","Eco testicular","Eco renal","Eco abdominal","Cintigrama óseo","PET PSMA","Otro"].map(o => <option key={o} value={o}>{o}</option>)}
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
              <span style={{fontSize:12,color:"#7aa3c4"}}>g</span>
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
            <div style={{padding:"10px 12px",background:"#f0f8fd",borderRadius:6,border:"0.5px solid #b8d8ef",marginBottom:6}}>
              <div style={{fontSize:12,fontWeight:600,color:"#1a6fb5",marginBottom:8}}>🪨 Litiasis</div>
              {litiasis.length > 0 && (
                <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:8}}>
                  {litiasis.map((l, idx) => (
                    <div key={idx} style={{display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:12,color:"#1a3a5c",background:"#fff",padding:"5px 9px",borderRadius:6}}>
                      <span>{[l.ubicacion, l.tercio, l.lateralidad, l.tamano?`${l.tamano} mm`:"", l.uh?`${l.uh} UH`:""].filter(Boolean).join(" · ")}</span>
                      <button onClick={()=>setLitiasis(litiasis.filter((_,i)=>i!==idx))} style={{background:"none",border:"none",color:"#c0392b",cursor:"pointer",fontSize:13,padding:0}}>✕</button>
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
                    <span style={{fontSize:11,color:"#7aa3c4"}}>mm</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:4,flex:1}}>
                    <input type="number" value={formLitiasis.uh} onChange={e=>setFormLitiasis({...formLitiasis,uh:e.target.value})} placeholder="Densidad" style={{...inputStyle,marginBottom:0}}/>
                    <span style={{fontSize:11,color:"#7aa3c4"}}>UH</span>
                  </div>
                </div>
                <button onClick={()=>{
                  if (!formLitiasis.ubicacion) return alert("Selecciona la ubicación");
                  setLitiasis([...litiasis, formLitiasis]);
                  setFormLitiasis({ ubicacion: "", tercio: "", lateralidad: "", tamano: "", uh: "" });
                }} style={{padding:"7px 12px",fontSize:12,background:"#1a6f5c",color:"#fff",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>+ Agregar litiasis</button>
              </div>
            </div>
          )}

          {/* CONSTRUCTOR DE TUMOR (UROTAC, TAC TAP, Eco renal) */}
          {(nuevoEx.nombre === "UROTAC" || nuevoEx.nombre === "TAC TAP" || nuevoEx.nombre === "Eco renal") && (
            <div style={{padding:"10px 12px",background:"#f0f8fd",borderRadius:6,border:"0.5px solid #b8d8ef",marginBottom:6}}>
              <div style={{fontSize:12,fontWeight:600,color:"#1a6fb5",marginBottom:8}}>🎯 Tumor</div>
              {tumores.length > 0 && (
                <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:8}}>
                  {tumores.map((t, idx) => (
                    <div key={idx} style={{display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:12,color:"#1a3a5c",background:"#fff",padding:"5px 9px",borderRadius:6}}>
                      <span>{[t.organo, t.sublocalizacion, t.tamano?`${t.tamano} cm`:""].filter(Boolean).join(" · ")}</span>
                      <button onClick={()=>setTumores(tumores.filter((_,i)=>i!==idx))} style={{background:"none",border:"none",color:"#c0392b",cursor:"pointer",fontSize:13,padding:0}}>✕</button>
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
                  <span style={{fontSize:11,color:"#7aa3c4"}}>cm</span>
                </div>
                <button onClick={()=>{
                  if (!formTumor.organo) return alert("Selecciona el órgano");
                  setTumores([...tumores, formTumor]);
                  setFormTumor({ organo: "", sublocalizacion: "", tamano: "" });
                }} style={{padding:"7px 12px",fontSize:12,background:"#1a6f5c",color:"#fff",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>+ Agregar tumor</button>
              </div>
            </div>
          )}

          <textarea value={nuevoEx.resultado} onChange={e=>setNuevoEx({...nuevoEx,resultado:e.target.value})} placeholder="Resultado (opcional)" rows={2} style={{...inputStyle,resize:"vertical"}}/>
          <button onClick={guardarExamen} style={{...btnPrimary, marginTop:0, marginBottom:12}}>+ Guardar examen</button>

          {examenes.length === 0 ? (
            <div style={{fontSize:11,color:"#7aa3c4",fontStyle:"italic",padding:"10px 0"}}>No hay exámenes registrados</div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {examenes.map(ex => (
                <div key={ex.id} style={{background:"#f0f8fd",borderRadius:6,padding:"10px 12px",borderLeft:"3px solid #1a6f5c"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4,gap:8}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:12,fontWeight:500,color:"#1a3a5c"}}>
                        <span style={{fontSize:9,padding:"1px 6px",background:"#1a6f5c",color:"#fff",borderRadius:3,marginRight:6}}>{ex.tipo}</span>
                        {ex.nombre}
                      </div>
                      <div style={{fontSize:10,color:"#7aa3c4",marginTop:2}}>{ex.fecha_examen} | {ex.autor?.nombre || "Anónimo"}</div>
                    </div>
                    {ex.autor_id === currentUser.id && (
                      <button onClick={()=>eliminarEx(ex.id)} style={{background:"none",border:"none",color:"#c0392b",cursor:"pointer",fontSize:12,padding:0}}>🗑</button>
                    )}
                  </div>
                  {ex.datos_estructurados && (ex.datos_estructurados.pirads || ex.datos_estructurados.pesoProstatico || ex.datos_estructurados.lugar || ex.datos_estructurados.tipoCultivo) && (
                    <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:4}}>
                      {ex.datos_estructurados.pirads && <span style={{fontSize:11,background:"#fef3c7",color:"#92400e",padding:"2px 8px",borderRadius:8,fontWeight:600}}>PI-RADS {ex.datos_estructurados.pirads}</span>}
                      {ex.datos_estructurados.pesoProstatico && <span style={{fontSize:11,background:"#dbeafe",color:"#1e40af",padding:"2px 8px",borderRadius:8,fontWeight:600}}>Próstata {ex.datos_estructurados.pesoProstatico} g</span>}
                      {ex.datos_estructurados.lugar && <span style={{fontSize:11,background:"#f3e8ff",color:"#6b21a8",padding:"2px 8px",borderRadius:8,fontWeight:600}}>📍 {ex.datos_estructurados.lugar}</span>}
                      {ex.datos_estructurados.tipoCultivo && <span style={{fontSize:11,background:"#dcfce7",color:"#166534",padding:"2px 8px",borderRadius:8,fontWeight:600}}>{ex.datos_estructurados.tipoCultivo}</span>}
                    </div>
                  )}
                  {ex.datos_estructurados && ex.datos_estructurados.parametros && Object.keys(ex.datos_estructurados.parametros).length > 0 && (
                    <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:6}}>
                      {Object.entries(ex.datos_estructurados.parametros).map(([k,v]) => {
                        const def = (PARAMETROS_LAB[ex.nombre] || []).find(p => p.key === k);
                        return (
                          <span key={k} style={{fontSize:11,background:"#fff",border:"0.5px solid #b8d8ef",color:"#1a3a5c",padding:"2px 8px",borderRadius:8}}>
                            <strong>{def?.label || k}:</strong> {v}{def?.unidad ? ` ${def.unidad}` : ""}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {ex.datos_estructurados && Array.isArray(ex.datos_estructurados.litiasis) && ex.datos_estructurados.litiasis.length > 0 && (
                    <div style={{marginTop:6}}>
                      <div style={{fontSize:11,fontWeight:600,color:"#1a6fb5",marginBottom:3}}>🪨 Litiasis</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                        {ex.datos_estructurados.litiasis.map((l,i) => (
                          <span key={i} style={{fontSize:11,background:"#fef3c7",color:"#92400e",padding:"2px 8px",borderRadius:8,fontWeight:500}}>
                            {[l.ubicacion,l.tercio,l.lateralidad,l.tamano?`${l.tamano} mm`:"",l.uh?`${l.uh} UH`:""].filter(Boolean).join(" · ")}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {ex.datos_estructurados && Array.isArray(ex.datos_estructurados.tumores) && ex.datos_estructurados.tumores.length > 0 && (
                    <div style={{marginTop:6}}>
                      <div style={{fontSize:11,fontWeight:600,color:"#1a6fb5",marginBottom:3}}>🎯 Tumor</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                        {ex.datos_estructurados.tumores.map((t,i) => (
                          <span key={i} style={{fontSize:11,background:"#fee2e2",color:"#991b1b",padding:"2px 8px",borderRadius:8,fontWeight:500}}>
                            {[t.organo,t.sublocalizacion,t.tamano?`${t.tamano} cm`:""].filter(Boolean).join(" · ")}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {ex.resultado && <div style={{fontSize:12,color:"#1a3a5c",marginTop:6,whiteSpace:"pre-wrap"}}>{ex.resultado}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ============================================================
  // RENDER: VISTA LISTA (KANBAN)
  // ============================================================

  return (
    <div style={{padding:"16px",overflowY:"auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,gap:8,flexWrap:"wrap"}}>
        <div style={{fontSize:16,fontWeight:600,color:"#1a3a5c"}}>
          {esEquipo ? `🏥 Pacientes - ${equipoActual?.nombre}` : "👤 Mis Pacientes"}
        </div>
        <div style={{display:"flex",gap:6}}>
          <button onClick={()=>setVista("servicios")} style={{padding:"6px 12px",fontSize:12,background:"#fff",color:"#1a6fb5",border:"0.5px solid #b8d8ef",borderRadius:6,cursor:"pointer",fontWeight:500}}>⚙️ Servicios</button>
          <button onClick={()=>setVista("nuevo")} style={{padding:"6px 12px",fontSize:12,background:"#1a6fb5",color:"#fff",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>+ Nuevo</button>
        </div>
      </div>

      {/* Filtros */}
      <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
        <span style={{fontSize:11,color:"#7aa3c4"}}>Filtrar:</span>
        <select value={filtroServicio} onChange={e=>setFiltroServicio(e.target.value)} style={{padding:"5px 10px",fontSize:11,borderRadius:6,border:"0.5px solid #b8d8ef",background:"#fff",color:"#1a3a5c",outline:"none",cursor:"pointer"}}>
          <option value="todos">Todos los servicios</option>
          {serviciosDisponibles.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)} style={{padding:"5px 10px",fontSize:11,borderRadius:6,border:"0.5px solid #b8d8ef",background:"#fff",color:"#1a3a5c",outline:"none",cursor:"pointer"}}>
          <option value="activo">Solo activos</option>
          <option value="alta">Solo dados de alta</option>
          <option value="todos">Todos</option>
        </select>
        <span style={{fontSize:11,color:"#7aa3c4",marginLeft:"auto"}}>{pacientesFiltrados.length} pacientes</span>
      </div>

      {loadingPacientes && (
        <div style={{textAlign:"center",padding:"30px",color:"#7aa3c4",fontSize:13}}>Cargando pacientes...</div>
      )}

      {!loadingPacientes && pacientesFiltrados.length === 0 && (
        <div style={{textAlign:"center",padding:"40px 20px",color:"#7aa3c4",fontSize:13,lineHeight:1.6}}>
          No hay pacientes en este contexto.<br/>
          {esEquipo ? "Agrega uno con el botón + Nuevo" : "Crea tu primer paciente con + Nuevo"}
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
            <div key={servicio} style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"12px"}}>
              <div style={{fontSize:15,fontWeight:700,color:"#1a3a5c",marginBottom:8,paddingBottom:6,borderBottom:"0.5px solid #e8f3fb"}}>
                {servicio} <span style={{color:"#7aa3c4",fontWeight:400,fontSize:13}}>({porServicio[servicio].length})</span>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {porServicio[servicio].map(p => (
                  <div key={p.id} onClick={()=>abrirFicha(p)} style={{background:p.estado==="activo"?"#f0f8fd":"#f5f5f5",borderRadius:6,padding:"10px 12px",cursor:"pointer",borderLeft:`3px solid ${p.estado==="activo"?"#1a6fb5":"#999"}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                      <div style={{fontSize:15,fontWeight:600,color:"#1a3a5c"}}>
                        {p.iniciales} <span style={{fontSize:19,fontWeight:700,color:p.sexo==="F"?"#d6336c":"#1a6fb5"}}>{p.sexo==="F"?"♀":"♂"}</span>{p.estado_clinico && <span style={{marginLeft:5,fontSize:13}} title={p.estado_clinico}>{p.estado_clinico==="estable"?"🟢":p.estado_clinico==="regular"?"🟡":p.estado_clinico==="cuidado"?"🔴":""}</span>}{p.operado && <span style={{marginLeft:4}} title="Operado">🔪</span>}
                      </div>
                      <div style={{fontSize:13,fontWeight:600,color:"#1a6fb5",background:"#dbeafe",padding:"2px 8px",borderRadius:8,whiteSpace:"nowrap"}}>Cama {p.cama}</div>
                    </div>
                    <div style={{fontSize:13,fontWeight:500,color:"#4a7eab",marginBottom:3}}>{p.edad} años</div>
                    <div style={{fontSize:11,color:"#1a3a5c",lineHeight:1.3,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{p.diagnostico}</div>
                    {p.estado === "alta" && <div style={{fontSize:9,color:"#999",marginTop:4,fontStyle:"italic"}}>DADO DE ALTA</div>}
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
      { bg: "#dbeafe", text: "#1e40af" },
      { bg: "#dcfce7", text: "#166534" },
      { bg: "#fee2e2", text: "#991b1b" },
      { bg: "#fef3c7", text: "#92400e" },
      { bg: "#f3e8ff", text: "#6b21a8" },
      { bg: "#ccfbf1", text: "#115e59" },
      { bg: "#ffe4e6", text: "#9f1239" },
      { bg: "#ffedd5", text: "#9a3412" },
      { bg: "#e0e7ff", text: "#3730a3" },
      { bg: "#d1fae5", text: "#065f46" },
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
        <button onClick={()=>setAbierto(!abierto)} style={{fontSize:15,background:"#f0f8fd",color:"#1a6fb5",border:"0.5px solid #b8d8ef",borderRadius:"50%",width:24,height:24,cursor:"pointer",fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1,padding:0}}>
          {abierto ? "×" : "+"}
        </button>
      </div>
      {abierto && (
        <div style={{marginTop:4,background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:6,padding:"4px",maxHeight:140,overflowY:"auto"}}>
          {miembros.map(m => {
            const id = m.perfiles?.id;
            const asignado = encargados.includes(id);
            return (
              <div key={id} onClick={()=>toggle(id)} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 4px",cursor:"pointer",fontSize:11,color:"#1a3a5c"}}>
                <span style={{width:14,height:14,borderRadius:3,border:"1px solid #b8d8ef",background:asignado?"#1a6fb5":"#fff",color:"#fff",fontSize:10,display:"flex",alignItems:"center",justifyContent:"center"}}>{asignado?"✓":""}</span>
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
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:12,maxWidth:720,width:"100%",overflow:"hidden"}}>
        <div style={{padding:"10px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"0.5px solid #b8d8ef"}}>
          <div style={{fontSize:13,fontWeight:500,color:"#1a3a5c"}}>{video.titulo}</div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:18,color:"#7aa3c4",cursor:"pointer",padding:0}}>✕</button>
        </div>
        <div style={{aspectRatio:"16/9",background:"#000"}}>
          {vimeoId ? <iframe src={`https://player.vimeo.com/video/${vimeoId}?autoplay=1`} style={{width:"100%",height:"100%",border:"none"}} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen title={video.titulo}/> : ytId ? <iframe src={`https://www.youtube.com/embed/${ytId}?autoplay=1`} style={{width:"100%",height:"100%",border:"none"}} allow="autoplay; encrypted-media" allowFullScreen title={video.titulo}/> : <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",color:"#fff"}}>Video no disponible</div>}
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
          <div style={{fontSize:22,fontWeight:700,color:"#1a3a5c",marginBottom:2}}>Biblioteca quirúrgica</div>
          <div style={{fontSize:13,color:"#4a7eab"}}>{videos.length} videos</div>
        </div>
        {isAdmin && <button onClick={()=>setAgregando(!agregando)} style={{padding:"7px 12px",fontSize:12,fontWeight:500,background: agregando?"#fff":"#1a6fb5",color: agregando?"#1a6fb5":"#fff",border: agregando?"1px solid #1a6fb5":"none",borderRadius:8,cursor:"pointer"}}>{agregando ? "Cancelar" : "+ Agregar"}</button>}
      </div>
      {agregando && isAdmin && (
        <div style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"14px",marginBottom:14}}>
          <input value={nuevo.titulo} onChange={e=>setNuevo({...nuevo,titulo:e.target.value})} placeholder="Título" style={inputStyle}/>
          <select value={nuevo.categoria} onChange={e=>setNuevo({...nuevo,categoria:e.target.value})} style={inputStyle}>{CATEGORIAS_VIDEO.filter(c=>c!=="Todas").map(c=><option key={c}>{c}</option>)}</select>
          <input value={nuevo.url} onChange={e=>setNuevo({...nuevo,url:e.target.value})} placeholder="URL YouTube" style={inputStyle}/>
          <input value={nuevo.autor} onChange={e=>setNuevo({...nuevo,autor:e.target.value})} placeholder="Autor (opcional)" style={inputStyle}/>
          <textarea value={nuevo.descripcion} onChange={e=>setNuevo({...nuevo,descripcion:e.target.value})} placeholder="Descripción" rows={2} style={{...inputStyle,resize:"none"}}/>
          {errorAdd && <div style={{fontSize:12,color:"#c0392b",background:"#fde8e6",padding:"8px 10px",borderRadius:6,marginBottom:8}}>{errorAdd}</div>}
          <button onClick={agregarVideo} style={{...btnPrimary, marginTop:0}}>Guardar video</button>
        </div>
      )}
      <input value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="Buscar..." style={{...inputStyle, marginBottom:8}}/>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
        {CATEGORIAS_VIDEO.map(c => <button key={c} onClick={()=>setFiltro(c)} style={{padding:"5px 10px",fontSize:11,fontWeight:filtro===c?500:400,borderRadius:14,cursor:"pointer",border:filtro===c?"none":"0.5px solid #b8d8ef",background:filtro===c?"#1a6fb5":"#fff",color:filtro===c?"#fff":"#4a7eab"}}>{c}</button>)}
      </div>
      {filtrados.length === 0 ? (
        <div style={{textAlign:"center",padding:"40px 0",color:"#7aa3c4",fontSize:13}}>No hay videos</div>
      ) : (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12}}>
          {filtrados.map(v => {
            return (
              <div key={v.id} style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,overflow:"hidden",display:"flex",flexDirection:"column"}}>
                <div onClick={()=>setPlayingVideo(v)} style={{position:"relative",cursor:"pointer",background:"#1a3a5c",aspectRatio:"16/9",overflow:"hidden"}}>
                  <VideoThumb url={v.url} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
                  <div style={{position:"absolute",inset:0,background:"rgba(26,58,92,0.25)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <div style={{width:44,height:44,borderRadius:"50%",background:"rgba(255,255,255,0.9)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,color:"#1a6fb5"}}>▶</div>
                  </div>
                </div>
                <div style={{padding:"10px 12px",flex:1,display:"flex",flexDirection:"column"}}>
                  <div style={{fontSize:13,fontWeight:500,color:"#1a3a5c",marginBottom:3,lineHeight:1.3}}>{v.titulo}</div>
                  <div style={{fontSize:11,color:"#4a7eab",marginBottom:6}}>{v.categoria} · {v.autor}</div>
                  <div style={{fontSize:11,color:"#7aa3c4",lineHeight:1.4,flex:1}}>{v.descripcion}</div>
                  {isAdmin && <button onClick={()=>eliminarVideo(v.id)} style={{marginTop:8,padding:"5px 8px",fontSize:11,background:"#fff",color:"#c0392b",border:"0.5px solid #f0c5c0",borderRadius:6,cursor:"pointer",alignSelf:"flex-start"}}>Eliminar</button>}
                </div>
              </div>
            );
          })}
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
      content: `Hola ${currentUser.nombre.split(" ")[0]}. Soy UroSearch. ¿En qué te puedo ayudar?` 
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
      content: `Hola ${currentUser.nombre.split(" ")[0]}. Soy UroSearch. ¿En qué te puedo ayudar?` 
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
  const tabsValidos = perfil.rol === "admin"
    ? ["admin", "chat", "hospital", "conocimiento", "videos"]
    : ["chat", "hospital", "conocimiento", "videos"];
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
// Cargar chunks (fragmentos) para la búsqueda del chat
const chunksResult = await listarChunks();
if (chunksResult.ok) {
  setChunks(chunksResult.chunks);
}

// Cargar videos
const videosResult = await listarVideos();
if (videosResult.ok) {
  setVideos(videosResult.videos);
}
// Si no hay conversaciones, mostrar mensaje de bienvenida
if (perfil.rol !== "admin" && (!convResult.ok || convResult.conversaciones.length === 0)) {
  setMessages([{ role:"assistant", content:`Hola ${perfil.nombre.split(" ")[0]}. Soy UroSearch. ¿En qué te puedo ayudar?` }]);
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
    const palabrasPacientes = ["paciente","pacientes","hospitalizad","hospitalizado","cama","camas","servicio","ingres","alta","altas","mis","tengo","cuanto","cuanta","cuanto","quien","quien","resumen","ficha","evolucion","evolución","examen","examen","diagnostic","diagnóstic","mi paciente"];
    const esConsulta = palabrasPacientes.some(p => q.includes(p));
    if (!esConsulta) return null;
    const misPacientes = pacientes.filter(p => p.medicoId === currentUser.correo);
    if (misPacientes.length === 0) return { ningun: true, total: 0 };

    // Filtrar por estado si se menciona
    let filtrados = misPacientes;
    if (q.includes("hospitalizad") || q.includes("activo") || q.includes("internad")) {
      filtrados = filtrados.filter(p => p.estado === "activo");
    } else if (q.includes("dado de alta") || q.includes("dados de alta") || q.includes("alta")) {
      filtrados = filtrados.filter(p => p.estado === "alta");
    }

    // Filtrar por servicio si se menciona
    const misServicios = (serviciosUsuario && serviciosUsuario[currentUser.correo]) || [];
    misServicios.forEach(s => {
      const sNorm = s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
      if (q.includes(sNorm)) {
        filtrados = filtrados.filter(p => p.servicio === s);
      }
    });

    // Filtrar por iniciales si se mencionan (busca patrones como J.P.M. o iniciales en mayúscula)
    const inicialesEnQuery = consulta.match(/[A-Z]\.[A-Z]\.[A-Z]\.?/g) || consulta.match(/[A-Z]{2,4}/g) || [];
    if (inicialesEnQuery.length > 0) {
      const matched = filtrados.filter(p => inicialesEnQuery.some(ini => (p.iniciales || "").includes(ini.replace(/\./g,"")) || ini.includes((p.iniciales || "").replace(/\./g,""))));
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
      // Agregar la nueva conversación al inicio de la lista
      setConversaciones(prev => [crearResult.conversacion, ...prev]);
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
  const docsRelevantes = chunks.length > 0
    ? buscarEnConocimiento(txt, chunks, 6)
    : buscarEnConocimiento(txt, conocimiento, 3);
  const tieneFuentes = docsRelevantes.length > 0;
  const consultaCirugias = buscarCirugiasRelevantes(txt);
  const consultaPacientes = buscarPacientesRelevantes(txt);

  try {
    const modoIns = modo === "precisa" ? "\n\nMODO PRECISA: máximo 3-4 líneas, sin advertencia." : "\n\nMODO EXPLICATIVA: respuesta completa con contexto y evidencia.";
    let ctx = "";
    if (tieneFuentes) {
      ctx += "\n\n=== BASE DE CONOCIMIENTO ===\nResponde PRIORITARIAMENTE con estos documentos. Cita la fuente al final.\n\n" + docsRelevantes.map((d,i) => `--- DOC ${i+1}: ${d.titulo}${d.fuente ? " ("+d.fuente+")" : ""} ---\n${(d.contenido||"").slice(0,8000)}`).join("\n\n");
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
          let detalle = `- ${p.iniciales} (${p.edad}a ${p.sexo}) | Cama ${p.cama} | Servicio: ${p.servicio} | Estado: ${p.estado === "activo" ? "Hospitalizado" : "Alta"} | Ingreso: ${p.fechaIngreso}\n  Diagnóstico: ${p.diagnostico}`;
          if (p.planManejo) detalle += `\n  Plan: ${p.planManejo}`;
          if (p.evoluciones.length > 0) {
            detalle += `\n  Última evolución (${p.evoluciones[0].fecha}): ${p.evoluciones[0].texto.slice(0,200)}${p.evoluciones[0].texto.length > 200 ? "..." : ""}`;
          }
          if (p.examenes.length > 0) {
            detalle += `\n  Exámenes: ${p.examenes.slice(0,3).map(ex => `${ex.tipo} ${ex.nombre} (${ex.fecha})`).join(", ")}`;
          }
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
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1500,
        system: sysPrompt,
        messages: apiMsgs,
      }),
    });
    const data = await res.json();
    const reply = data.content?.find(b => b.type==="text")?.text || "Sin respuesta.";
    const respuesta = { role:"assistant", content:reply };
    if (videosRelevantes.length > 0) respuesta.videos = videosRelevantes;
    if (tieneFuentes) respuesta.fuentes = docsRelevantes.map(d => ({id:d.id, titulo:d.titulo, categoria:d.categoria}));
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
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1000,
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
    <div style={{fontFamily:"var(--font-sans)",minHeight:"100vh",background:"#e8f3fb",borderRadius:"var(--border-radius-lg)",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center",color:"#4a7eab",fontSize:14}}>
        <LogoUroSearch size={60}/>
        <div style={{marginTop:16}}>Cargando UroSearch...</div>
      </div>
    </div>
  );
}

if (!currentUser) {
  return (
    <div style={{fontFamily:"var(--font-sans)",minHeight:"100vh",background:"#e8f3fb",borderRadius:"var(--border-radius-lg)",display:"flex",alignItems:"center",justifyContent:"center",padding:"24px"}}>
      <div style={{width:"100%",maxWidth:480,background:"#fff",borderRadius:16,boxShadow:"0 4px 24px rgba(26,58,92,0.10)",padding:"8px"}}>
        <AuthScreen/>
      </div>
    </div>
  );
}

  const tabs = isAdmin
    ? [["admin",`👤 Cuentas${pendientesCount>0?` (${pendientesCount})`:""}`],["chat","💬 Chat"],["hospital","🏥 Hospital"],["conocimiento","📖 Biblioteca"]]
    : [["chat","💬 Chat"],["hospital","🏥 Hospital"],["conocimiento","📖 Biblioteca"]];

  return (
    <div style={{fontFamily:"var(--font-sans)",height:"100vh",display:"flex",flexDirection:"column",overflow:"hidden",background:"#e8f3fb",borderRadius:"var(--border-radius-lg)"}}>
      <div style={{padding:"16px 20px 0",borderBottom:"0.5px solid #b8d8ef",background:"#d0e9f8",borderRadius:"var(--border-radius-lg) var(--border-radius-lg) 0 0",position:"relative"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <LogoUroSearch size={56}/>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{fontWeight:600,fontStyle:"italic",fontFamily:"Georgia, 'Times New Roman', serif",fontSize:28,color:"#1a3a5c",letterSpacing:"-0.3px"}}>UroSearch</div>
                {isAdmin && <span style={{fontSize:10,fontWeight:600,padding:"2px 6px",background:"#1a6fb5",color:"#fff",borderRadius:4}}>ADMIN</span>}
              </div>
              <div style={{fontSize:14,color:"#4a7eab"}}>Asistente Clínico de Urología</div>
            </div>
          </div>
          <button onClick={()=>setMenuOpen(!menuOpen)} style={{display:"flex",alignItems:"center",gap:8,background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:24,padding:"5px 14px 5px 5px",cursor:"pointer"}}>
            <div style={{width:38,height:38,borderRadius:"50%",background:isAdmin?"#1a3a5c":"#1a6fb5",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:600,color:"#fff"}}>{userInitials}</div>
            <span style={{fontSize:14,color:"#1a3a5c",fontWeight:500}}>▾</span>
          </button>
        </div>
        {menuOpen && (
          <div style={{position:"absolute",top:60,right:20,background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:8,padding:"8px 0",minWidth:220,zIndex:10,boxShadow:"0 2px 8px rgba(0,0,0,0.08)"}}>
            <div style={{padding:"8px 14px",borderBottom:"0.5px solid #e8f3fb"}}>
              <div style={{fontSize:13,fontWeight:500,color:"#1a3a5c"}}>{currentUser.nombre}</div>
              <div style={{fontSize:11,color:"#4a7eab"}}>{currentUser.correo}</div>
              <div style={{fontSize:11,color:"#7aa3c4",marginTop:2}}>{currentUser.especialidad}{isAdmin?" · Administrador":""}</div>
            </div>
            <button onClick={handleLogout} style={{width:"100%",padding:"8px 14px",fontSize:13,textAlign:"left",background:"none",border:"none",color:"#c0392b",cursor:"pointer"}}>Cerrar sesión</button>
          </div>
        )}
        <div style={{display:"flex",gap:0,overflowX:"auto"}}>
          {tabs.map(([id,label]) => (
            <button key={id} onClick={() => setTab(id)} style={{flex:"1 0 auto",padding:"13px 10px",fontSize:14,fontWeight:tab===id?600:500,background:"transparent",border:"none",borderBottom:tab===id?"3px solid #1a6fb5":"3px solid transparent",color:tab===id?"#1a6fb5":"#4a7eab",cursor:"pointer",whiteSpace:"nowrap"}}>{label}</button>
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
  <div style={{padding:"8px 12px", borderBottom:"0.5px solid #e8f3fb", display:"flex", alignItems:"center", justifyContent:"space-between", background:"#f8fbfd"}}>
    <button 
      onClick={() => setPanelConversacionesAbierto(!panelConversacionesAbierto)}
      style={{
        background:"#fff",
        border:"0.5px solid #b8d8ef",
        color:"#1a6fb5",
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
          background:"#fff",
          border:"0.5px solid #b8d8ef",
          color:"#1a6fb5",
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
    <div style={{textAlign:"center",padding:"40px 16px",color:"#7aa3c4",fontSize:13}}>
      Cargando conversación...
    </div>
  )}
  {!loadingConversaciones && messages.length === 0 && isAdmin && <div style={{textAlign:"center",padding:"40px 16px",color:"#7aa3c4",fontSize:13,lineHeight:1.6}}>Como admin puedes usar el chat. Escribe una consulta.</div>}
  {!loadingConversaciones && messages.map((m,i) => <ChatBubble key={i} msg={m} userInitials={userInitials} onPlayVideo={setPlayingVideo}/>)}
            {loading && (
              <div style={{display:"flex",gap:8,alignItems:"center",padding:"8px 0"}}>
                <div style={{width:30,height:30,borderRadius:"50%",background:"#1a6fb5",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:500,color:"#fff"}}>U</div>
                <div style={{padding:"10px 14px",borderRadius:"16px 16px 16px 4px",background:"#fff",fontSize:14,color:"#7aa3c4",border:"0.5px solid #b8d8ef"}}>Consultando...</div>
              </div>
            )}
            <div ref={bottomRef}/>
          </div>
          <div style={{padding:"8px 12px 12px",borderTop:"0.5px solid #b8d8ef"}}>
            <div style={{display:"flex",gap:6,marginBottom:8,alignItems:"center"}}>
              {[["precisa","⚡ Precisa"],["explicativa","📖 Explicativa"]].map(([id,label])=><button key={id} onClick={()=>setModo(id)} style={{padding:"5px 12px",fontSize:12,fontWeight:modo===id?500:400,borderRadius:8,cursor:"pointer",border:modo===id?"none":"0.5px solid #b8d8ef",background:modo===id?"#1a6fb5":"#fff",color:modo===id?"#fff":"#4a7eab"}}>{label}</button>)}
              <span style={{fontSize:11,color:"#7aa3c4",marginLeft:4}}>{modo==="precisa" ? "Definición breve" : "Explicación completa"}</span>
            </div>
            <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
              <textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMsg();}}} placeholder="Escribe tu consulta..." rows={2} style={{flex:1,resize:"none",padding:"10px 12px",fontSize:14,borderRadius:8,border:"0.5px solid #b8d8ef",background:"#fff",color:"#1a3a5c",lineHeight:1.5,outline:"none",fontFamily:"inherit"}}/>
              <button onClick={sendMsg} disabled={loading||!input.trim()} style={{padding:"10px 16px",borderRadius:8,border:"none",background:loading||!input.trim()?"#cdddec":"#1a6fb5",color:"#fff",fontSize:14,cursor:loading||!input.trim()?"default":"pointer",fontWeight:500,whiteSpace:"nowrap"}}>Enviar</button>
            </div>
          </div>
        </div>
      )}

      {playingVideo && <VideoPlayer video={playingVideo} onClose={()=>setPlayingVideo(null)}/>}

      <div style={{padding:"8px 16px",borderTop:"0.5px solid #b8d8ef",background:"#d0e9f8",borderRadius:"0 0 var(--border-radius-lg) var(--border-radius-lg)",display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:10,fontStyle:"italic",color:"#4a7eab"}}>
        <span>Creado por Dr. Sebastián Gárate Ortega - Residente de Urología UACh</span>
        <span style={{fontStyle:"normal",fontFamily:"monospace",fontSize:9,color:"#7aa3c4",letterSpacing:"0.3px"}}>{VERSION}</span>
      </div>
    </div>
  );
}
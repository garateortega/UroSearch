import { useState, useRef, useEffect } from "react";
import { register as registerUser, login as loginUser, logout as logoutUser, getPerfil, getSession, onAuthChange, listarPerfiles, cambiarEstadoUsuario, eliminarUsuario } from "./auth";
import { listarConversaciones, crearConversacion, cargarMensajes, agregarMensaje, actualizarTitulo, eliminarConversacion, generarTituloDesdeMensaje } from "./chat";
import { listarMapas, guardarMapa, eliminarMapa } from "./mapas";
import { listarMisEquipos, listarMisInvitaciones, listarMiembros, listarInvitacionesEquipo, crearEquipo, eliminarEquipo, salirDelEquipo, expulsarMiembro, buscarUsuarioPorCorreo, crearInvitacion, aceptarInvitacion, rechazarInvitacion } from "./equipos";
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

const VERSION = "v0.4.0 (beta)";
const ESPECIALIDADES = ["Urología", "Medicina General", "Cirugía", "Nefrología", "Trasplantología", "Residente Urología", "Interno", "Otro"];

const ADMIN_ACCOUNT = { nombre: "Dr. Sebastián (Admin)", correo: "admin@urosearch.cl", password: "admin2026", especialidad: "Urología", rol: "admin", estado: "aprobado" };

const VIDEOS_INICIALES = [
  { id:"v1", titulo:"Prostatectomía radical robótica", categoria:"Oncología", url:"https://www.youtube.com/watch?v=4w8pY7C3FpQ", autor:"AUA University", keywords:["prostatectomía","próstata","radical","robótica"], descripcion:"Técnica paso a paso de prostatectomía radical asistida por robot." },
  { id:"v2", titulo:"Nefrectomía parcial laparoscópica", categoria:"Oncología", url:"https://www.youtube.com/watch?v=6WdBgBHqNqI", autor:"EAU", keywords:["nefrectomía","parcial","riñón","laparoscópica"], descripcion:"Resección de tumor renal con preservación del parénquima." },
  { id:"v3", titulo:"NLP - Nefrolitotomía percutánea", categoria:"Litiasis", url:"https://www.youtube.com/watch?v=1oH_d9GZmjA", autor:"Endourology Society", keywords:["nlp","nefrolitotomía","litiasis","percutánea","cálculo"], descripcion:"Acceso percutáneo y fragmentación de cálculo coraliforme." },
  { id:"v4", titulo:"URS flexible con láser holmium", categoria:"Litiasis", url:"https://www.youtube.com/watch?v=KS8t9xRr0Pg", autor:"AUA", keywords:["urs","ureteroscopía","láser","holmium","cálculo"], descripcion:"Litotricia intracorpórea con ureteroscopía flexible." },
  { id:"v5", titulo:"Trasplante renal - anastomosis ureterovesical", categoria:"Trasplante", url:"https://www.youtube.com/watch?v=9Y3OVF5gEjE", autor:"Sociedad Chilena Trasplante", keywords:["trasplante","ureterovesical","lich-gregoir","anastomosis"], descripcion:"Técnica de Lich-Gregoir en trasplante renal." },
  { id:"v6", titulo:"Instalación de catéter doble J", categoria:"Derivaciones", url:"https://www.youtube.com/watch?v=6kSCqK1Cj_E", autor:"Urology Care", keywords:["doble j","catéter","ureteral","derivación"], descripcion:"Instalación endoscópica de catéter ureteral doble J." },
  { id:"v7", titulo:"Nefrostomía percutánea ecoguiada", categoria:"Derivaciones", url:"https://www.youtube.com/watch?v=Vv_PEJiQbPo", autor:"HBV", keywords:["nefrostomía","percutánea","npc","ecoguiada"], descripcion:"Técnica de nefrostomía bajo guía ecográfica." },
  { id:"v8", titulo:"Cistectomía radical con neovejiga", categoria:"Oncología", url:"https://www.youtube.com/watch?v=RtJq3pTU5HQ", autor:"EAU", keywords:["cistectomía","vejiga","neovejiga","derivación urinaria"], descripcion:"Cistectomía radical con reconstrucción ortotópica." }
];

const CATEGORIAS_VIDEO = ["Todas", "Oncología", "Litiasis", "Derivaciones", "Trasplante", "Funcional", "Otros"];
const CATEGORIAS_KB = ["Guías clínicas", "Protocolos HBV", "Apuntes propios", "Papers", "Casos clínicos", "Otro"];

function getYouTubeId(url) {
  if (!url) return null;
  const patterns = [/youtube\.com\/watch\?v=([^&]+)/, /youtu\.be\/([^?]+)/, /youtube\.com\/embed\/([^?]+)/];
  for (const p of patterns) { const m = url.match(p); if (m) return m[1]; }
  return null;
}

function buscarEnConocimiento(consulta, documentos, maxDocs = 3) {
  if (!documentos || documentos.length === 0) return [];
  const stopwords = new Set(["para","como","cual","cuales","cuando","donde","que","quien","con","por","del","las","los","una","uno","desde","hasta","sobre","entre","muy","mas","menos","pero","sino","aunque","porque","esto","esta","ese","esa","este","tan","tanto","todo","toda","cada","ser","estar","tener","puede","debe","entonces","luego","ademas","tambien","ahora","aqui","si","no","es","son","fue","fueron","han","ha","habia","yo","tu","el","ella","mi","su","sus"]);
  const consultaNorm = consulta.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const palabras = consultaNorm.replace(/[¿?¡!.,;:()"'`]/g,"").split(/\s+/).filter(p => p.length > 2 && !stopwords.has(p));
  if (palabras.length === 0) return [];
  const puntuados = documentos.map(doc => {
    const tituloN = doc.titulo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    const contN = doc.contenido.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    const tagsN = (doc.tags||[]).join(" ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
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
  const conScore = puntuados.filter(d => d.score > 0);
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
      <div style={{padding:"40px 24px", textAlign:"center"}}>
        <div style={{display:"flex",justifyContent:"center",marginBottom:20}}><LogoUroSearch size={84}/></div>
        <div style={{fontSize:34, fontWeight:600, fontStyle:"italic", fontFamily:"Georgia, 'Times New Roman', serif", color:"#1a3a5c", letterSpacing:"-0.5px", marginBottom:6}}>UroSearch</div>
        <div style={{fontSize:14, color:"#4a7eab", marginBottom:30, lineHeight:1.5}}>Asistente Clínico de Urología</div>
        <div style={{maxWidth:280, margin:"0 auto"}}>
          <button onClick={()=>{setView("login"); setError(""); setInfo("");}} style={btnPrimary}>Iniciar sesión</button>
          <button onClick={()=>{setView("register"); setError(""); setInfo("");}} style={btnSecondary}>Solicitar cuenta</button>
        </div>
        <div style={{fontSize:11, color:"#7aa3c4", marginTop:30, padding:"0 20px", lineHeight:1.5}}>Acceso restringido a equipo clínico<br/>urológico autorizado</div>
        <div style={{fontSize:11, fontStyle:"italic", color:"#4a7eab", marginTop:24, paddingTop:16, borderTop:"0.5px solid #b8d8ef"}}>Creado por Dr. Sebastián Gárate Ortega - Residente de Urología UACh</div>
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

function ConocimientoPanel({ conocimiento, setConocimiento, isAdmin }) {
  const [vista, setVista] = useState("lista");
  const [seleccionado, setSeleccionado] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [filtroCat, setFiltroCat] = useState("Todas");
  const [nuevoForm, setNuevoForm] = useState({ titulo:"", categoria:"Guías clínicas", contenido:"", tags:"" });
  const [errorForm, setErrorForm] = useState("");
  const fileRef = useRef(null);

  const filtrados = conocimiento.filter(d => {
    const matchCat = filtroCat === "Todas" || d.categoria === filtroCat;
    const q = busqueda.toLowerCase().trim();
    const matchQ = !q || d.titulo.toLowerCase().includes(q) || d.contenido.toLowerCase().includes(q);
    return matchCat && matchQ;
  });

  const handleFile = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 10*1024*1024) { setErrorForm("El archivo no debe superar 10 MB"); return; }
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
        if (!texto.trim() || texto.length < 100) { setErrorForm("No se pudo extraer texto del PDF (¿es escaneado?)"); return; }
        setNuevoForm({...nuevoForm, contenido: texto, titulo: nuevoForm.titulo || tituloSugerido});
        setErrorForm("");
        return;
      }
      setErrorForm("Formato no soportado. Usa .txt, .md, .docx o .pdf");
    } catch (err) {
      setErrorForm("Error al procesar: " + (err.message || "desconocido"));
    }
  };

  const guardar = () => {
    setErrorForm("");
    if (!nuevoForm.titulo.trim()) return setErrorForm("Ingresa un título");
    if (!nuevoForm.contenido.trim()) return setErrorForm("Ingresa o sube el contenido");
    if (nuevoForm.contenido.length < 50) return setErrorForm("Contenido muy corto (mínimo 50 caracteres)");
    const nuevo = { id: "k" + Date.now(), titulo: nuevoForm.titulo, categoria: nuevoForm.categoria, contenido: nuevoForm.contenido, tags: nuevoForm.tags.split(",").map(t=>t.trim()).filter(Boolean), fechaCreacion: new Date().toISOString().split("T")[0], caracteres: nuevoForm.contenido.length };
    setConocimiento([nuevo, ...conocimiento]);
    setNuevoForm({ titulo:"", categoria:"Guías clínicas", contenido:"", tags:"" });
    setVista("lista");
  };

  const eliminar = (id) => {
    if (confirm("¿Eliminar este documento?")) {
      setConocimiento(conocimiento.filter(d => d.id !== id));
      if (seleccionado?.id === id) { setSeleccionado(null); setVista("lista"); }
    }
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
          <div style={{fontSize:11,color:"#7aa3c4",marginBottom:8}}>Agregado: {seleccionado.fechaCreacion} · {seleccionado.caracteres.toLocaleString()} caracteres</div>
          {isAdmin && <button onClick={()=>eliminar(seleccionado.id)} style={{padding:"5px 10px",fontSize:11,background:"#fff",color:"#c0392b",border:"0.5px solid #f0c5c0",borderRadius:6,cursor:"pointer"}}>Eliminar</button>}
        </div>
        <div style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"14px",fontSize:13,color:"#1a3a5c",lineHeight:1.6,whiteSpace:"pre-wrap"}}>{seleccionado.contenido}</div>
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
              <div style={{fontSize:11,fontWeight:500,color:"#1a6fb5",marginBottom:3}}>{d.categoria}</div>
              <div style={{fontSize:14,fontWeight:500,color:"#1a3a5c",marginBottom:4}}>{d.titulo}</div>
              <div style={{fontSize:11,color:"#7aa3c4",marginBottom:6}}>{d.fechaCreacion} · {d.caracteres.toLocaleString()} caracteres</div>
              <div style={{fontSize:12,color:"#4a7eab",lineHeight:1.4}}>{d.contenido.slice(0,150)}{d.contenido.length>150?"...":""}</div>
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
        <div style={{fontSize:15,fontWeight:600,color:"#1a3a5c",marginBottom:2}}>🔪 Protocolos quirúrgicos</div>
        <div style={{fontSize:11,color:"#4a7eab"}}>{PROTOCOLOS_CIRUGIAS.length} procedimientos urológicos estándar</div>
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

function ConocimientoHub({ conocimiento, setConocimiento, isAdmin, videos, setVideos, setPlayingVideo, mapaTema, setMapaTema, mapaActual, setMapaActual, mapaLoading, generarMapa, topicOpen, setTopicOpen, mapasGuardados, onGuardarMapa, onEliminarMapa, onCargarMapaGuardado, guardandoMapa }) {
  const [subTab, setSubTab] = useState("mapas");
  const tabsConocimiento = [["mapas","🗺 Mapas"],["videos","🎬 Videos"],["cirugias","🔪 Cirugías"]];
  if (isAdmin) tabsConocimiento.push(["documentos","📄 Documentos"]);

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0}}>
      <div style={{display:"flex",gap:0,background:"#f0f8fd",borderBottom:"0.5px solid #b8d8ef",padding:"0 12px",overflowX:"auto"}}>
        {tabsConocimiento.map(([id,label]) => (
          <button key={id} onClick={()=>setSubTab(id)} style={{padding:"10px 14px",fontSize:12,fontWeight:subTab===id?500:400,background:"transparent",border:"none",borderBottom:subTab===id?"2px solid #1a6fb5":"2px solid transparent",color:subTab===id?"#1a6fb5":"#4a7eab",cursor:"pointer",whiteSpace:"nowrap"}}>{label}</button>
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

// Componente selector de contexto (mío vs equipo)
function SelectorContexto({ contexto, setContexto, equipos, currentUser, onAbrirEquipos }) {
  const misEquipos = equipos.filter(e => 
    e.dueno_id === currentUser.id || 
    e.miembros_equipo?.some(m => m.user_id === currentUser.id)
  );
  return (
    <div style={{padding:"8px 14px",background:"#fff",borderBottom:"0.5px solid #b8d8ef",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
      <span style={{fontSize:11,color:"#7aa3c4",marginRight:4}}>Viendo:</span>
      <button onClick={()=>setContexto("personal")} style={{padding:"4px 10px",fontSize:11,fontWeight:contexto==="personal"?500:400,borderRadius:14,cursor:"pointer",border:contexto==="personal"?"none":"0.5px solid #b8d8ef",background:contexto==="personal"?"#1a6fb5":"#fff",color:contexto==="personal"?"#fff":"#4a7eab"}}>🔒 Solo míos</button>
      {misEquipos.map(eq => (
        <button key={eq.id} onClick={()=>setContexto(eq.id)} style={{padding:"4px 10px",fontSize:11,fontWeight:contexto===eq.id?500:400,borderRadius:14,cursor:"pointer",border:contexto===eq.id?"none":"0.5px solid #b8d8ef",background:contexto===eq.id?"#1a6f5c":"#fff",color:contexto===eq.id?"#fff":"#4a7eab"}}>👥 {eq.nombre}</button>
      ))}
      <button onClick={onAbrirEquipos} style={{padding:"4px 10px",fontSize:11,borderRadius:14,cursor:"pointer",border:"0.5px dashed #1a6fb5",background:"#fff",color:"#1a6fb5",marginLeft:"auto"}}>⚙️ Equipos</button>
    </div>
  );
}

function HospitalPanel({ pacientes, setPacientes, currentUser, tablaCirugias, setTablaCirugias, serviciosUsuario, setServiciosUsuario, pendientes, setPendientes, equipos, setEquipos, invitacionesPendientes, setInvitacionesPendientes, users }) {
  const [subTab, setSubTab] = useState("pacientes");
  const [contexto, setContexto] = useState("personal");
  const [mostrarEquipos, setMostrarEquipos] = useState(false);

  const equipoActual = contexto !== "personal" ? equipos.find(e => e.id === contexto) : null;
  const esEquipo = !!equipoActual;

  if (mostrarEquipos) {
    return (
      <EquiposPanel equipos={equipos} setEquipos={setEquipos} invitacionesPendientes={invitacionesPendientes} setInvitacionesPendientes={setInvitacionesPendientes} currentUser={currentUser} onCerrar={()=>setMostrarEquipos(false)}/>
    );
  }

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0}}>
      <SelectorContexto contexto={contexto} setContexto={setContexto} equipos={equipos} currentUser={currentUser} onAbrirEquipos={()=>setMostrarEquipos(true)}/>
      <div style={{display:"flex",gap:0,background:"#f0f8fd",borderBottom:"0.5px solid #b8d8ef",padding:"0 12px",overflowX:"auto"}}>
        {[["pacientes","👥 Pacientes"],["tabla","📅 Tabla Quirúrgica"],["pendientes","✅ Pendientes del día"]].map(([id,label]) => (
          <button key={id} onClick={()=>setSubTab(id)} style={{padding:"10px 14px",fontSize:12,fontWeight:subTab===id?500:400,background:"transparent",border:"none",borderBottom:subTab===id?"2px solid #1a6fb5":"2px solid transparent",color:subTab===id?"#1a6fb5":"#4a7eab",cursor:"pointer",whiteSpace:"nowrap"}}>{label}</button>
        ))}
      </div>
      {subTab === "pacientes" && <PacientesPanel pacientes={pacientes} setPacientes={setPacientes} currentUser={currentUser} serviciosUsuario={serviciosUsuario} setServiciosUsuario={setServiciosUsuario} contexto={contexto} equipoActual={equipoActual}/>}
      {subTab === "tabla" && <TablaQuirurgicaPanel tablaCirugias={tablaCirugias} setTablaCirugias={setTablaCirugias} currentUser={currentUser} contexto={contexto} equipoActual={equipoActual}/>}
      {subTab === "pendientes" && <PendientesPanel pendientes={pendientes} setPendientes={setPendientes} currentUser={currentUser} contexto={contexto} equipoActual={equipoActual}/>}
    </div>
  );
}

// ---------- PENDIENTES DEL DÍA ----------
function PendientesPanel({ pendientes, setPendientes, currentUser, contexto, equipoActual }) {
  const esEquipo = !!equipoActual;
  const [nuevo, setNuevo] = useState("");
  const [filtro, setFiltro] = useState("hoy");
  const hoy = new Date().toISOString().split("T")[0];
  const misPendientes = esEquipo
    ? pendientes.filter(p => p.equipoId === equipoActual.id)
    : pendientes.filter(p => p.userId === currentUser.correo && !p.equipoId);

  const agregar = (texto) => {
    const t = texto.trim();
    if (!t) return;
    const nuevoP = { id: "pen" + Date.now() + Math.random().toString(36).slice(2,6), userId: currentUser.correo, userNombre: currentUser.nombre, equipoId: esEquipo ? equipoActual.id : null, texto: t, fecha: hoy, completado: false, fechaCreacion: new Date().toISOString() };
    setPendientes([nuevoP, ...pendientes]);
    setNuevo("");
  };

  const toggle = (id) => {
    setPendientes(pendientes.map(p => p.id === id ? {...p, completado: !p.completado, fechaCompletado: !p.completado ? new Date().toISOString() : null, completadoPor: !p.completado ? currentUser.nombre : null} : p));
  };

  const eliminar = (id) => setPendientes(pendientes.filter(p => p.id !== id));

  const filtrados = misPendientes.filter(p => {
    if (filtro === "hoy") return p.fecha === hoy;
    if (filtro === "pendientes") return !p.completado;
    if (filtro === "completados") return p.completado;
    return true;
  }).sort((a,b) => {
    if (a.completado !== b.completado) return a.completado ? 1 : -1;
    return new Date(b.fechaCreacion) - new Date(a.fechaCreacion);
  });

  const counts = {
    hoy: misPendientes.filter(p => p.fecha === hoy).length,
    pendientes: misPendientes.filter(p => !p.completado).length,
    completados: misPendientes.filter(p => p.completado).length
  };

  return (
    <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:15,fontWeight:600,color:"#1a3a5c",marginBottom:2}}>✅ Pendientes del día</div>
        <div style={{fontSize:11,color:"#4a7eab"}}>{counts.pendientes} pendientes · {counts.completados} completados</div>
      </div>

      <div style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"12px",marginBottom:14}}>
        <div style={{fontSize:12,fontWeight:500,color:"#4a7eab",marginBottom:8}}>Sugerencias rápidas</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:12}}>
          {PENDIENTES_SUGERIDOS.map(s => (
            <button key={s} onClick={()=>agregar(s)} style={{padding:"5px 10px",fontSize:11,borderRadius:14,cursor:"pointer",border:"0.5px dashed #1a6fb5",background:"#fff",color:"#1a6fb5"}}>+ {s}</button>
          ))}
        </div>
        <div style={{display:"flex",gap:6}}>
          <input value={nuevo} onChange={e=>setNuevo(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")agregar(nuevo);}} placeholder="O escribe una tarea personalizada..." style={{flex:1,padding:"9px 12px",fontSize:13,borderRadius:8,border:"0.5px solid #b8d8ef",background:"#fff",color:"#1a3a5c",outline:"none"}}/>
          <button onClick={()=>agregar(nuevo)} disabled={!nuevo.trim()} style={{padding:"9px 14px",fontSize:13,fontWeight:500,background:nuevo.trim()?"#1a6fb5":"#cdddec",color:"#fff",border:"none",borderRadius:8,cursor:nuevo.trim()?"pointer":"default"}}>Agregar</button>
        </div>
      </div>

      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {[["hoy",`Hoy (${counts.hoy})`],["pendientes",`Pendientes (${counts.pendientes})`],["completados",`Completados (${counts.completados})`],["todos","Todos"]].map(([id,label]) => (
          <button key={id} onClick={()=>setFiltro(id)} style={{padding:"5px 10px",fontSize:11,fontWeight:filtro===id?500:400,borderRadius:14,cursor:"pointer",border:filtro===id?"none":"0.5px solid #b8d8ef",background:filtro===id?"#1a6fb5":"#fff",color:filtro===id?"#fff":"#4a7eab"}}>{label}</button>
        ))}
      </div>

      {filtrados.length === 0 ? (
        <div style={{textAlign:"center",padding:"40px 20px",color:"#7aa3c4",fontSize:13,lineHeight:1.6}}>{misPendientes.length === 0 ? "No tienes pendientes aún.\nUsa las sugerencias o escribe la tarea." : "No hay pendientes en esta categoría"}</div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {filtrados.map(p => (
            <div key={p.id} style={{display:"flex",alignItems:"center",gap:10,background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"10px 12px",opacity:p.completado?0.55:1}}>
              <div onClick={()=>toggle(p.id)} style={{width:20,height:20,borderRadius:5,border:p.completado?"none":"1.5px solid #b8d8ef",background:p.completado?"#1a6f5c":"#fff",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,fontSize:13,color:"#fff"}}>{p.completado ? "✓" : ""}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,color:"#1a3a5c",textDecoration:p.completado?"line-through":"none",lineHeight:1.4}}>{p.texto}</div>
                <div style={{fontSize:10,color:"#7aa3c4",marginTop:2}}>
                  {p.fecha === hoy ? "Hoy" : p.fecha}
                  {esEquipo && p.userNombre && ` · creado por ${p.userNombre.split(" ")[0]}`}
                  {p.completado && p.completadoPor && ` · completado por ${p.completadoPor.split(" ")[0]}`}
                </div>
              </div>
              <button onClick={()=>eliminar(p.id)} style={{background:"none",border:"none",fontSize:14,color:"#cdddec",cursor:"pointer",padding:4}}>✕</button>
            </div>
          ))}
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

function TablaQuirurgicaPanel({ tablaCirugias, setTablaCirugias, currentUser, contexto, equipoActual }) {
  const esEquipo = !!equipoActual;
  const cirugiasFiltradas = esEquipo
    ? tablaCirugias.filter(c => c.equipoId === equipoActual.id)
    : tablaCirugias.filter(c => c.creadoPor === currentUser.correo && !c.equipoId);
  const [vista, setVista] = useState("semana");
  const [seleccionado, setSeleccionado] = useState(null);
  const [semanaOffset, setSemanaOffset] = useState(0);
  const [nuevoForm, setNuevoForm] = useState({ fecha: new Date().toISOString().split("T")[0], hora:"08:00", iniciales:"", edad:"", procedimiento:"", cirujano: currentUser.nombre, ayudante:"", anestesia:"General", pabellon:"1", duracionEstimada:"", observaciones:"", lateralidad:"" });
  const [errorForm, setErrorForm] = useState("");
  const [importPreview, setImportPreview] = useState(null);
  const [importError, setImportError] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const importFileRef = useRef(null);

  // Calcular el lunes de la semana actual con offset
  const hoy = new Date();
  hoy.setHours(0,0,0,0);
  const diaSemana = hoy.getDay() === 0 ? 6 : hoy.getDay() - 1; // 0=lunes, 6=domingo
  const lunes = new Date(hoy);
  lunes.setDate(hoy.getDate() - diaSemana + (semanaOffset * 7));

  const diasSemana = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(lunes);
    d.setDate(lunes.getDate() + i);
    diasSemana.push(d);
  }

  const formatFecha = (d) => d.toISOString().split("T")[0];
  const hoyStr = formatFecha(hoy);
  const nombresDias = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
  const nombreMes = lunes.toLocaleDateString("es-CL",{month:"long", year:"numeric"});

  // Cirugías agrupadas por día - SOLO las del contexto actual
  const cirugiasPorDia = {};
  diasSemana.forEach(d => { cirugiasPorDia[formatFecha(d)] = []; });
  cirugiasFiltradas.forEach(c => {
    if (cirugiasPorDia[c.fecha]) cirugiasPorDia[c.fecha].push(c);
  });
  Object.keys(cirugiasPorDia).forEach(k => cirugiasPorDia[k].sort((a,b) => a.hora.localeCompare(b.hora)));

  const totalSemana = Object.values(cirugiasPorDia).reduce((sum,arr)=>sum+arr.length, 0);

  const crear = () => {
    setErrorForm("");
    if (!nuevoForm.fecha) return setErrorForm("Selecciona una fecha");
    if (!nuevoForm.hora) return setErrorForm("Selecciona una hora");
    if (!nuevoForm.iniciales.trim()) return setErrorForm("Ingresa las iniciales");
    if (!nuevoForm.procedimiento.trim()) return setErrorForm("Ingresa el procedimiento");
    if (!nuevoForm.cirujano.trim()) return setErrorForm("Ingresa el cirujano");
    const nueva = { id: "c" + Date.now(), ...nuevoForm, iniciales: nuevoForm.iniciales.toUpperCase(), edad: nuevoForm.edad ? parseInt(nuevoForm.edad) : null, estado: "programada", creadoPor: currentUser.correo, equipoId: esEquipo ? equipoActual.id : null, creadoPorNombre: currentUser.nombre, fechaCreacion: new Date().toISOString().split("T")[0] };
    setTablaCirugias([nueva, ...tablaCirugias]);
    setNuevoForm({ fecha: new Date().toISOString().split("T")[0], hora:"08:00", iniciales:"", edad:"", procedimiento:"", cirujano: currentUser.nombre, ayudante:"", anestesia:"General", pabellon:"1", duracionEstimada:"", observaciones:"", lateralidad:"" });
    setVista("semana");
  };

  const cambiarEstado = (e) => {
    setTablaCirugias(tablaCirugias.map(c => c.id === seleccionado.id ? {...c, estado: e} : c));
    setSeleccionado({...seleccionado, estado: e});
  };

  const eliminar = (id) => {
    if (confirm("¿Eliminar esta cirugía?")) {
      setTablaCirugias(tablaCirugias.filter(c => c.id !== id));
      if (seleccionado?.id === id) { setSeleccionado(null); setVista("semana"); }
    }
  };

  // ---- IMPORTAR EXCEL ----
  const handleImportExcel = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setImportError(""); setImportLoading(true); setImportPreview(null);
    try {
      // Cargar SheetJS (xlsx) desde CDN
      if (!window.XLSX) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
          script.onload = resolve; script.onerror = reject;
          document.head.appendChild(script);
        });
      }
      const arrayBuffer = await f.arrayBuffer();
      const workbook = window.XLSX.read(arrayBuffer, { type:"array", cellDates:true });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = window.XLSX.utils.sheet_to_json(firstSheet, { defval:"", raw:false });

      if (rows.length === 0) {
        setImportError("El archivo no contiene datos");
        setImportLoading(false);
        return;
      }

      // Función para encontrar el valor de una columna probando varios nombres alternativos
      const buscarCampo = (row, posibles) => {
        const claves = Object.keys(row);
        for (const p of posibles) {
          const pNorm = p.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim();
          const found = claves.find(k => {
            const kNorm = k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim();
            return kNorm === pNorm || kNorm.includes(pNorm) || pNorm.includes(kNorm);
          });
          if (found && row[found] !== "" && row[found] != null) return String(row[found]).trim();
        }
        return "";
      };

      const parseFecha = (val) => {
        if (!val) return "";
        // Si ya es Date object
        if (val instanceof Date) return val.toISOString().split("T")[0];
        const s = String(val).trim();
        // Formato yyyy-mm-dd
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.split("T")[0].split(" ")[0];
        // Formato dd/mm/yyyy o dd-mm-yyyy
        const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
        if (m1) {
          let yr = m1[3];
          if (yr.length === 2) yr = "20" + yr;
          return `${yr}-${m1[2].padStart(2,"0")}-${m1[1].padStart(2,"0")}`;
        }
        // Formato yyyy/mm/dd
        const m2 = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
        if (m2) return `${m2[1]}-${m2[2].padStart(2,"0")}-${m2[3].padStart(2,"0")}`;
        return s;
      };

      const parseHora = (val) => {
        if (!val) return "08:00";
        const s = String(val).trim();
        // Formato HH:MM o HH:MM:SS
        const m = s.match(/(\d{1,2})[:.](\d{2})/);
        if (m) return `${m[1].padStart(2,"0")}:${m[2]}`;
        // Solo número (hora)
        if (/^\d{1,2}$/.test(s)) return `${s.padStart(2,"0")}:00`;
        return "08:00";
      };

      const cirugiasParseadas = rows.map((row, idx) => {
        const fecha = parseFecha(buscarCampo(row, ["fecha","date","día","dia"]));
        const hora = parseHora(buscarCampo(row, ["hora","hour","time","horario"]));
        const iniciales = buscarCampo(row, ["iniciales","paciente","nombre","name","patient"]).toUpperCase().slice(0,15);
        const edadStr = buscarCampo(row, ["edad","age","años"]);
        const edad = edadStr && !isNaN(parseInt(edadStr)) ? parseInt(edadStr) : null;
        const procedimiento = buscarCampo(row, ["procedimiento","cirugía","cirugia","intervencion","intervención","operacion","operación","surgery","procedure"]);
        const lateralidad = buscarCampo(row, ["lateralidad","lado","side"]);
        const cirujano = buscarCampo(row, ["cirujano","surgeon","doctor","médico","medico"]) || currentUser.nombre;
        const ayudante = buscarCampo(row, ["ayudante","asistente","assistant"]);
        const pabellon = buscarCampo(row, ["pabellón","pabellon","sala","room","quirófano","quirofano"]) || "1";
        const anestesia = buscarCampo(row, ["anestesia","anesthesia"]) || "General";
        const observaciones = buscarCampo(row, ["observaciones","obs","notas","notes","comentarios"]);

        return {
          fila: idx + 2, // +2 porque la fila 1 es el header y los índices empiezan en 0
          fecha, hora, iniciales, edad, procedimiento, lateralidad, cirujano, ayudante, pabellon, anestesia, observaciones,
          valido: !!(fecha && iniciales && procedimiento)
        };
      });

      const validas = cirugiasParseadas.filter(c => c.valido);
      const invalidas = cirugiasParseadas.filter(c => !c.valido);

      if (validas.length === 0) {
        setImportError(`No se pudo extraer ninguna cirugía válida de las ${rows.length} filas. Verifica que tu Excel tenga columnas para fecha, paciente y procedimiento.`);
        setImportLoading(false);
        return;
      }

      setImportPreview({ validas, invalidas, total: rows.length });
      setImportLoading(false);
    } catch (err) {
      console.error(err);
      setImportError("Error al leer el archivo: " + (err.message || "desconocido"));
      setImportLoading(false);
    }
    // Limpiar input para que se pueda volver a subir el mismo archivo
    if (importFileRef.current) importFileRef.current.value = "";
  };

  const confirmarImportacion = () => {
    if (!importPreview) return;
    const nuevas = importPreview.validas.map(c => ({
      id: "c" + Date.now() + Math.random().toString(36).slice(2,8),
      fecha: c.fecha,
      hora: c.hora,
      iniciales: c.iniciales,
      edad: c.edad,
      procedimiento: c.procedimiento,
      lateralidad: c.lateralidad,
      cirujano: c.cirujano,
      ayudante: c.ayudante,
      pabellon: c.pabellon,
      anestesia: c.anestesia,
      duracionEstimada: "",
      observaciones: c.observaciones,
      estado: "programada",
      creadoPor: currentUser.correo,
      equipoId: esEquipo ? equipoActual.id : null,
      creadoPorNombre: currentUser.nombre,
      fechaCreacion: new Date().toISOString().split("T")[0],
      importado: true
    }));
    setTablaCirugias([...nuevas, ...tablaCirugias]);
    setImportPreview(null);
    setVista("semana");
  };

  const colorEstado = (e) => e === "realizada" ? {bg:"#d4f0e0",fg:"#1a6f5c",bd:"#a8d4be"} : e === "suspendida" ? {bg:"#fde8e6",fg:"#c0392b",bd:"#f0c5c0"} : e === "en_curso" ? {bg:"#fdf0d0",fg:"#a06b1a",bd:"#e8d09a"} : {bg:"#e0e9f5",fg:"#1a4a7c",bd:"#b8c8de"};
  const labelEstado = (e) => e === "realizada" ? "Realizada" : e === "suspendida" ? "Suspendida" : e === "en_curso" ? "En curso" : "Programada";

  // VISTA: NUEVO
  if (vista === "nuevo") {
    return (
      <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
        <button onClick={()=>{setVista("semana");setErrorForm("");}} style={{background:"none",border:"none",color:"#4a7eab",fontSize:13,cursor:"pointer",marginBottom:12,padding:0}}>← Volver</button>
        <div style={{fontSize:15,fontWeight:600,color:"#1a3a5c",marginBottom:14}}>Programar cirugía</div>
        <div style={{background:"#fff8e1",border:"0.5px solid #f0d896",borderRadius:8,padding:"8px 12px",marginBottom:14,fontSize:11,color:"#8a6610",lineHeight:1.5}}>⚠️ Usa <strong>iniciales</strong>, no nombres completos.</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <div><label style={labelStyle}>Fecha</label><input type="date" value={nuevoForm.fecha} onChange={e=>setNuevoForm({...nuevoForm,fecha:e.target.value})} style={inputStyle}/></div>
          <div><label style={labelStyle}>Hora</label><input type="time" value={nuevoForm.hora} onChange={e=>setNuevoForm({...nuevoForm,hora:e.target.value})} style={inputStyle}/></div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <div><label style={labelStyle}>Iniciales paciente</label><input value={nuevoForm.iniciales} onChange={e=>setNuevoForm({...nuevoForm,iniciales:e.target.value})} placeholder="J.P.M." maxLength={8} style={inputStyle}/></div>
          <div><label style={labelStyle}>Edad</label><input type="number" value={nuevoForm.edad} onChange={e=>setNuevoForm({...nuevoForm,edad:e.target.value})} placeholder="65" style={inputStyle}/></div>
        </div>
        <label style={labelStyle}>Procedimiento</label>
        <input value={nuevoForm.procedimiento} onChange={e=>setNuevoForm({...nuevoForm,procedimiento:e.target.value})} placeholder="Ej: URS flexible + láser holmium" style={inputStyle}/>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <div><label style={labelStyle}>Lateralidad</label>
            <select value={nuevoForm.lateralidad} onChange={e=>setNuevoForm({...nuevoForm,lateralidad:e.target.value})} style={inputStyle}><option value="">No aplica</option><option value="Derecho">Derecho</option><option value="Izquierdo">Izquierdo</option><option value="Bilateral">Bilateral</option></select>
          </div>
          <div><label style={labelStyle}>Pabellón</label><input value={nuevoForm.pabellon} onChange={e=>setNuevoForm({...nuevoForm,pabellon:e.target.value})} placeholder="1" style={inputStyle}/></div>
        </div>
        <label style={labelStyle}>Cirujano principal</label>
        <input value={nuevoForm.cirujano} onChange={e=>setNuevoForm({...nuevoForm,cirujano:e.target.value})} placeholder="Dr. ..." style={inputStyle}/>
        <label style={labelStyle}>Ayudante (opcional)</label>
        <input value={nuevoForm.ayudante} onChange={e=>setNuevoForm({...nuevoForm,ayudante:e.target.value})} placeholder="Dr. ..." style={inputStyle}/>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <div><label style={labelStyle}>Anestesia</label>
            <select value={nuevoForm.anestesia} onChange={e=>setNuevoForm({...nuevoForm,anestesia:e.target.value})} style={inputStyle}><option>General</option><option>Espinal</option><option>Epidural</option><option>Sedación</option><option>Local</option><option>Combinada</option></select>
          </div>
          <div><label style={labelStyle}>Duración estimada</label><input value={nuevoForm.duracionEstimada} onChange={e=>setNuevoForm({...nuevoForm,duracionEstimada:e.target.value})} placeholder="90 min" style={inputStyle}/></div>
        </div>
        <label style={labelStyle}>Observaciones (opcional)</label>
        <textarea value={nuevoForm.observaciones} onChange={e=>setNuevoForm({...nuevoForm,observaciones:e.target.value})} placeholder="Material especial, alergias, comorbilidades..." rows={3} style={{...inputStyle,resize:"none"}}/>
        {errorForm && <div style={{fontSize:12,color:"#c0392b",background:"#fde8e6",padding:"8px 10px",borderRadius:6,marginBottom:8}}>{errorForm}</div>}
        <button onClick={crear} style={{...btnPrimary, marginTop:0}}>Programar cirugía</button>
      </div>
    );
  }

  // VISTA: FICHA
  if (vista === "ficha" && seleccionado) {
    const col = colorEstado(seleccionado.estado);
    return (
      <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
        <button onClick={()=>{setVista("semana");setSeleccionado(null);}} style={{background:"none",border:"none",color:"#4a7eab",fontSize:13,cursor:"pointer",marginBottom:12,padding:0}}>← Volver al planner</button>
        <div style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"14px",marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8,gap:10}}>
            <div>
              <div style={{fontSize:18,fontWeight:600,color:"#1a3a5c",marginBottom:2}}>{seleccionado.procedimiento}</div>
              {seleccionado.lateralidad && <div style={{fontSize:11,color:"#1a6fb5",fontWeight:500,marginBottom:2}}>● {seleccionado.lateralidad}</div>}
              <div style={{fontSize:13,color:"#4a7eab"}}>📅 {seleccionado.fecha} a las {seleccionado.hora} · Pabellón {seleccionado.pabellon}</div>
            </div>
            <span style={{fontSize:10,fontWeight:500,padding:"3px 10px",borderRadius:10,background:col.bg,color:col.fg,whiteSpace:"nowrap"}}>{labelEstado(seleccionado.estado)}</span>
          </div>
          <div style={{borderTop:"0.5px solid #e8f3fb",paddingTop:8,marginTop:8,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,fontSize:12}}>
            <div><div style={{fontSize:10,fontWeight:500,color:"#7aa3c4",marginBottom:2}}>PACIENTE</div><div style={{color:"#1a3a5c"}}>{seleccionado.iniciales}{seleccionado.edad ? ` · ${seleccionado.edad}a` : ""}</div></div>
            <div><div style={{fontSize:10,fontWeight:500,color:"#7aa3c4",marginBottom:2}}>ANESTESIA</div><div style={{color:"#1a3a5c"}}>{seleccionado.anestesia}</div></div>
            <div><div style={{fontSize:10,fontWeight:500,color:"#7aa3c4",marginBottom:2}}>CIRUJANO</div><div style={{color:"#1a3a5c"}}>{seleccionado.cirujano}</div></div>
            {seleccionado.ayudante && <div><div style={{fontSize:10,fontWeight:500,color:"#7aa3c4",marginBottom:2}}>AYUDANTE</div><div style={{color:"#1a3a5c"}}>{seleccionado.ayudante}</div></div>}
            {seleccionado.duracionEstimada && <div><div style={{fontSize:10,fontWeight:500,color:"#7aa3c4",marginBottom:2}}>DURACIÓN</div><div style={{color:"#1a3a5c"}}>{seleccionado.duracionEstimada}</div></div>}
          </div>
          {seleccionado.observaciones && (
            <div style={{borderTop:"0.5px solid #e8f3fb",paddingTop:8,marginTop:10}}>
              <div style={{fontSize:10,fontWeight:500,color:"#7aa3c4",marginBottom:3}}>OBSERVACIONES</div>
              <div style={{fontSize:13,color:"#1a3a5c",lineHeight:1.5,whiteSpace:"pre-wrap"}}>{seleccionado.observaciones}</div>
            </div>
          )}
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:12,paddingTop:10,borderTop:"0.5px solid #e8f3fb"}}>
            {seleccionado.estado !== "realizada" && <button onClick={()=>cambiarEstado("realizada")} style={{flex:"1 1 auto",padding:"6px 10px",fontSize:11,background:"#1a6f5c",color:"#fff",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>✓ Realizada</button>}
            {seleccionado.estado === "programada" && <button onClick={()=>cambiarEstado("en_curso")} style={{flex:"1 1 auto",padding:"6px 10px",fontSize:11,background:"#a06b1a",color:"#fff",border:"none",borderRadius:6,cursor:"pointer",fontWeight:500}}>▶ En curso</button>}
            {seleccionado.estado !== "suspendida" && seleccionado.estado !== "realizada" && <button onClick={()=>cambiarEstado("suspendida")} style={{flex:"1 1 auto",padding:"6px 10px",fontSize:11,background:"#fff",color:"#c0392b",border:"0.5px solid #c0392b",borderRadius:6,cursor:"pointer",fontWeight:500}}>Suspender</button>}
            {seleccionado.estado !== "programada" && <button onClick={()=>cambiarEstado("programada")} style={{flex:"1 1 auto",padding:"6px 10px",fontSize:11,background:"#fff",color:"#1a4a7c",border:"0.5px solid #1a4a7c",borderRadius:6,cursor:"pointer",fontWeight:500}}>Reprogramar</button>}
            <button onClick={()=>eliminar(seleccionado.id)} style={{padding:"6px 10px",fontSize:11,background:"#fff",color:"#7aa3c4",border:"0.5px solid #b8d8ef",borderRadius:6,cursor:"pointer"}}>Eliminar</button>
          </div>
        </div>
      </div>
    );
  }

  // VISTA: PLANNER SEMANAL
  // Modal de importación
  const importModal = (importPreview || importError || importLoading) && (
    <div onClick={()=>{if(!importLoading){setImportPreview(null);setImportError("");}}} style={{position:"absolute",inset:0,background:"rgba(26,58,92,0.85)",zIndex:50,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px",borderRadius:"var(--border-radius-lg)"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:12,maxWidth:600,width:"100%",maxHeight:"90%",overflow:"auto",padding:18}}>
        <div style={{fontSize:15,fontWeight:600,color:"#1a3a5c",marginBottom:10}}>📊 Importar Excel</div>
        {importLoading && <div style={{textAlign:"center",padding:"30px 0",color:"#7aa3c4",fontSize:13}}>Procesando archivo...</div>}
        {importError && (
          <div style={{padding:"10px 12px",background:"#fde8e6",border:"0.5px solid #f0c5c0",borderRadius:8,fontSize:12,color:"#c0392b",lineHeight:1.5,marginBottom:10}}>
            <strong>Error:</strong> {importError}
          </div>
        )}
        {importPreview && (
          <>
            <div style={{padding:"10px 12px",background:"#e0f5ec",border:"0.5px solid #a8d4be",borderRadius:8,fontSize:12,color:"#1a6f5c",lineHeight:1.5,marginBottom:12}}>
              ✓ Se detectaron <strong>{importPreview.validas.length} cirugías válidas</strong> de {importPreview.total} filas leídas{importPreview.invalidas.length > 0 ? `. ${importPreview.invalidas.length} filas se omitirán por datos faltantes.` : "."}
            </div>
            <div style={{maxHeight:300,overflowY:"auto",border:"0.5px solid #b8d8ef",borderRadius:8,marginBottom:12}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                <thead style={{position:"sticky",top:0,background:"#f0f8fd"}}>
                  <tr>
                    <th style={{padding:"6px 8px",textAlign:"left",borderBottom:"0.5px solid #b8d8ef",color:"#4a7eab",fontWeight:500}}>Fecha</th>
                    <th style={{padding:"6px 8px",textAlign:"left",borderBottom:"0.5px solid #b8d8ef",color:"#4a7eab",fontWeight:500}}>Hora</th>
                    <th style={{padding:"6px 8px",textAlign:"left",borderBottom:"0.5px solid #b8d8ef",color:"#4a7eab",fontWeight:500}}>Paciente</th>
                    <th style={{padding:"6px 8px",textAlign:"left",borderBottom:"0.5px solid #b8d8ef",color:"#4a7eab",fontWeight:500}}>Procedimiento</th>
                    <th style={{padding:"6px 8px",textAlign:"left",borderBottom:"0.5px solid #b8d8ef",color:"#4a7eab",fontWeight:500}}>Cirujano</th>
                    <th style={{padding:"6px 8px",textAlign:"left",borderBottom:"0.5px solid #b8d8ef",color:"#4a7eab",fontWeight:500}}>Pab.</th>
                  </tr>
                </thead>
                <tbody>
                  {importPreview.validas.map((c,i) => (
                    <tr key={i} style={{borderBottom:"0.5px solid #e8f3fb"}}>
                      <td style={{padding:"6px 8px",color:"#1a3a5c"}}>{c.fecha}</td>
                      <td style={{padding:"6px 8px",color:"#1a3a5c"}}>{c.hora}</td>
                      <td style={{padding:"6px 8px",color:"#1a3a5c",fontWeight:500}}>{c.iniciales}{c.edad?` · ${c.edad}a`:""}</td>
                      <td style={{padding:"6px 8px",color:"#1a3a5c"}}>{c.procedimiento}{c.lateralidad?` (${c.lateralidad})`:""}</td>
                      <td style={{padding:"6px 8px",color:"#4a7eab"}}>{c.cirujano}</td>
                      <td style={{padding:"6px 8px",color:"#4a7eab"}}>{c.pabellon}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {importPreview.invalidas.length > 0 && (
              <div style={{padding:"8px 10px",background:"#fff8e1",border:"0.5px solid #f0d896",borderRadius:6,fontSize:11,color:"#8a6610",marginBottom:12,lineHeight:1.5}}>
                <strong>Filas omitidas:</strong> {importPreview.invalidas.map(c=>`fila ${c.fila}`).join(", ")}. Falta fecha, paciente o procedimiento.
              </div>
            )}
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>{setImportPreview(null);setImportError("");}} style={{flex:1,padding:"10px",fontSize:13,background:"#fff",color:"#4a7eab",border:"1px solid #b8d8ef",borderRadius:8,cursor:"pointer"}}>Cancelar</button>
              <button onClick={confirmarImportacion} style={{flex:2,padding:"10px",fontSize:13,fontWeight:500,background:"#1a6fb5",color:"#fff",border:"none",borderRadius:8,cursor:"pointer"}}>Importar {importPreview.validas.length} cirugías</button>
            </div>
          </>
        )}
        {importError && !importLoading && !importPreview && (
          <button onClick={()=>{setImportError("");}} style={{...btnPrimary, marginTop:0}}>Cerrar</button>
        )}
      </div>
    </div>
  );

  return (
    <div style={{padding:"14px",flex:1,overflowY:"auto",position:"relative"}}>
      {importModal}
      {/* Header con navegación de semana */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,gap:8,flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <button onClick={()=>setSemanaOffset(semanaOffset-1)} style={{padding:"6px 10px",fontSize:14,background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:6,cursor:"pointer",color:"#1a4a7c"}}>‹</button>
          <button onClick={()=>setSemanaOffset(0)} disabled={semanaOffset===0} style={{padding:"6px 10px",fontSize:11,fontWeight:500,background: semanaOffset===0?"#cdddec":"#1a6fb5",color:"#fff",border:"none",borderRadius:6,cursor:semanaOffset===0?"default":"pointer"}}>Hoy</button>
          <button onClick={()=>setSemanaOffset(semanaOffset+1)} style={{padding:"6px 10px",fontSize:14,background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:6,cursor:"pointer",color:"#1a4a7c"}}>›</button>
        </div>
        <div style={{display:"flex",gap:6}}>
          <input ref={importFileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImportExcel} style={{display:"none"}}/>
          <button onClick={()=>importFileRef.current?.click()} style={{padding:"7px 12px",fontSize:12,fontWeight:500,background:"#fff",color:"#1a6fb5",border:"1px solid #1a6fb5",borderRadius:8,cursor:"pointer",whiteSpace:"nowrap"}}>📊 Importar Excel</button>
          <button onClick={()=>setVista("nuevo")} style={{padding:"7px 12px",fontSize:12,fontWeight:500,background:"#1a6fb5",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",whiteSpace:"nowrap"}}>+ Programar</button>
        </div>
      </div>

      <div style={{textAlign:"center",marginBottom:14}}>
        <div style={{fontSize:14,fontWeight:600,color:"#1a3a5c",textTransform:"capitalize"}}>{nombreMes}</div>
        <div style={{fontSize:11,color:"#4a7eab"}}>{totalSemana} {totalSemana === 1 ? "cirugía" : "cirugías"} esta semana</div>
      </div>

      {/* Grilla semanal */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7, 1fr)",gap:6}}>
        {diasSemana.map((d, idx) => {
          const fechaStr = formatFecha(d);
          const cirugias = cirugiasPorDia[fechaStr];
          const esHoy = fechaStr === hoyStr;
          const esFinde = idx >= 5;
          return (
            <div key={fechaStr} style={{background: esHoy ? "#fff" : esFinde ? "#f0f4f8" : "#fff",border: esHoy ? "1.5px solid #1a6fb5" : "0.5px solid #b8d8ef",borderRadius:8,padding:"6px 4px",minHeight:120,display:"flex",flexDirection:"column"}}>
              <div style={{textAlign:"center",paddingBottom:6,marginBottom:6,borderBottom:"0.5px solid #e8f3fb"}}>
                <div style={{fontSize:9,fontWeight:500,color: esHoy ? "#1a6fb5" : "#7aa3c4",textTransform:"uppercase",letterSpacing:"0.5px"}}>{nombresDias[idx]}</div>
                <div style={{fontSize:16,fontWeight:600,color: esHoy ? "#1a6fb5" : "#1a3a5c",marginTop:2}}>{d.getDate()}</div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:3,flex:1}}>
                {cirugias.length === 0 ? (
                  <div onClick={()=>{setNuevoForm({...nuevoForm, fecha: fechaStr}); setVista("nuevo");}} style={{flex:1,minHeight:60,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",borderRadius:4,fontSize:18,color:"#cdddec"}}>+</div>
                ) : (
                  cirugias.map(c => {
                    const col = colorEstado(c.estado);
                    return (
                      <div key={c.id} onClick={()=>{setSeleccionado(c); setVista("ficha");}} style={{padding:"4px 5px",background: col.bg,border:`0.5px solid ${col.bd}`,borderRadius:4,cursor:"pointer",borderLeft:`3px solid ${col.fg}`}}>
                        <div style={{fontSize:9,fontWeight:600,color:col.fg,marginBottom:1}}>{c.hora}</div>
                        <div style={{fontSize:9,color:"#1a3a5c",lineHeight:1.2,fontWeight:500,wordBreak:"break-word"}}>{c.procedimiento.length > 28 ? c.procedimiento.slice(0,28) + "…" : c.procedimiento}</div>
                        <div style={{fontSize:8,color:"#4a7eab",marginTop:1}}>{c.iniciales} · P{c.pabellon}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Leyenda */}
      <div style={{marginTop:14,padding:"8px 10px",background:"#f0f8fd",borderRadius:8,display:"flex",flexWrap:"wrap",gap:10,justifyContent:"center"}}>
        {[["programada","Programada"],["en_curso","En curso"],["realizada","Realizada"],["suspendida","Suspendida"]].map(([id,label]) => {
          const col = colorEstado(id);
          return (
            <div key={id} style={{display:"flex",alignItems:"center",gap:4,fontSize:10,color:"#4a7eab"}}>
              <div style={{width:10,height:10,borderRadius:2,background:col.bg,border:`1px solid ${col.bd}`,borderLeft:`3px solid ${col.fg}`}}/>
              <span>{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PacientesPanel({ pacientes, setPacientes, currentUser, serviciosUsuario, setServiciosUsuario, contexto, equipoActual }) {
  const esEquipo = !!equipoActual;
  const [vista, setVista] = useState("kanban");
  const [seleccionado, setSeleccionado] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("activos");
  const misServicios = (serviciosUsuario && serviciosUsuario[currentUser.correo]) || [];
  const necesitaConfig = !esEquipo && misServicios.length === 0;
  // Para equipos, usar los servicios del dueño (o agrupados de todos los miembros)
  const serviciosVista = esEquipo ? Array.from(new Set((equipoActual.miembros_equipo || []).flatMap(m => (serviciosUsuario && serviciosUsuario[m.user_id]) || []))) : misServicios;

  const [nuevoForm, setNuevoForm] = useState({ iniciales:"", edad:"", sexo:"M", cama:"", servicio: "Urología", diagnostico:"", planManejo:"", fechaIngreso: new Date().toISOString().split("T")[0] });
  const [evolucionTexto, setEvolucionTexto] = useState("");
  const [modoEvolucion, setModoEvolucion] = useState("libre");
  const [evolEstr, setEvolEstr] = useState({ estadoGeneral:"", diuresis:"", dolor:"", fiebre:"", deambulacion:"", tolerancia:"", catetereres:"", examenFisico:"", plan:"" });
  const [examenForm, setExamenForm] = useState({ tipo:"Laboratorio", nombre:"", resultado:"", fecha: new Date().toISOString().split("T")[0] });
  const [errorForm, setErrorForm] = useState("");
  const [servicioPersonalizado, setServicioPersonalizado] = useState("");

  // Filtrar pacientes según contexto
  const misPacientes = esEquipo
    ? pacientes.filter(p => p.equipoId === equipoActual.id)
    : pacientes.filter(p => p.medicoId === currentUser.correo && !p.equipoId);
  const filtrados = misPacientes.filter(p => {
    const matchEstado = filtroEstado === "todos" || p.estado === filtroEstado;
    const q = busqueda.toLowerCase().trim();
    const matchQ = !q || p.iniciales.toLowerCase().includes(q) || p.cama.toLowerCase().includes(q) || p.diagnostico.toLowerCase().includes(q);
    return matchEstado && matchQ;
  });
  const counts = { activos: misPacientes.filter(p => p.estado==="activo").length, alta: misPacientes.filter(p => p.estado==="alta").length };

  // Configuración inicial de servicios
  if (necesitaConfig) {
    return (
      <ConfiguracionServiciosModal
        currentUser={currentUser}
        onConfigurar={(servicios) => {
          setServiciosUsuario({...serviciosUsuario, [currentUser.correo]: servicios});
          setNuevoForm({...nuevoForm, servicio: servicios[0]});
        }}
      />
    );
  }

  const crear = () => {
    setErrorForm("");
    if (!nuevoForm.iniciales.trim()) return setErrorForm("Ingresa las iniciales");
    if (!nuevoForm.edad || nuevoForm.edad < 0 || nuevoForm.edad > 120) return setErrorForm("Edad inválida");
    if (!nuevoForm.cama.trim()) return setErrorForm("Ingresa la cama");
    if (!nuevoForm.diagnostico.trim()) return setErrorForm("Ingresa el diagnóstico");
    const nuevo = { id: "p" + Date.now(), medicoId: currentUser.correo, equipoId: esEquipo ? equipoActual.id : null, creadoPor: currentUser.nombre, iniciales: nuevoForm.iniciales.toUpperCase(), edad: parseInt(nuevoForm.edad), sexo: nuevoForm.sexo, cama: nuevoForm.cama, servicio: nuevoForm.servicio, diagnostico: nuevoForm.diagnostico, planManejo: nuevoForm.planManejo, fechaIngreso: nuevoForm.fechaIngreso, estado: "activo", evoluciones: [], examenes: [] };
    setPacientes([nuevo, ...pacientes]);
    setNuevoForm({ iniciales:"", edad:"", sexo:"M", cama:"", servicio: misServicios[0], diagnostico:"", planManejo:"", fechaIngreso: new Date().toISOString().split("T")[0] });
    setVista("kanban");
  };

  const agregarServicio = () => {
    const s = servicioPersonalizado.trim();
    if (!s || misServicios.includes(s)) return;
    setServiciosUsuario({...serviciosUsuario, [currentUser.correo]: [...misServicios, s]});
    setServicioPersonalizado("");
  };

  const eliminarServicio = (s) => {
    if (misPacientes.some(p => p.servicio === s && p.estado === "activo")) {
      alert("No puedes eliminar un servicio que tiene pacientes activos");
      return;
    }
    setServiciosUsuario({...serviciosUsuario, [currentUser.correo]: misServicios.filter(x => x !== s)});
  };

  const agregarEvolucion = () => {
    let textoFinal = "";
    if (modoEvolucion === "libre") {
      if (!evolucionTexto.trim()) return;
      textoFinal = evolucionTexto;
    } else {
      const partes = [];
      if (evolEstr.estadoGeneral) partes.push(`Estado general: ${evolEstr.estadoGeneral}`);
      if (evolEstr.dolor) partes.push(`Dolor: ${evolEstr.dolor}`);
      if (evolEstr.fiebre) partes.push(`Fiebre: ${evolEstr.fiebre}`);
      if (evolEstr.diuresis) partes.push(`Diuresis: ${evolEstr.diuresis}`);
      if (evolEstr.tolerancia) partes.push(`Tolerancia oral: ${evolEstr.tolerancia}`);
      if (evolEstr.deambulacion) partes.push(`Deambulación: ${evolEstr.deambulacion}`);
      if (evolEstr.catetereres) partes.push(`Catéteres/drenajes: ${evolEstr.catetereres}`);
      if (evolEstr.examenFisico.trim()) partes.push(`Examen físico: ${evolEstr.examenFisico}`);
      if (evolEstr.plan.trim()) partes.push(`Plan: ${evolEstr.plan}`);
      if (partes.length === 0) return;
      textoFinal = partes.join("\n");
    }
    const ev = { id: "e" + Date.now(), fecha: new Date().toISOString().split("T")[0], hora: new Date().toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit"}), texto: textoFinal, tipo: modoEvolucion, autor: currentUser.nombre };
    setPacientes(pacientes.map(p => p.id === seleccionado.id ? {...p, evoluciones: [ev, ...p.evoluciones]} : p));
    setSeleccionado({...seleccionado, evoluciones: [ev, ...seleccionado.evoluciones]});
    setEvolucionTexto("");
    setEvolEstr({ estadoGeneral:"", diuresis:"", dolor:"", fiebre:"", deambulacion:"", tolerancia:"", catetereres:"", examenFisico:"", plan:"" });
  };

  const agregarExamen = () => {
    if (!examenForm.nombre.trim()) return;
    const ex = { id: "x" + Date.now(), ...examenForm };
    setPacientes(pacientes.map(p => p.id === seleccionado.id ? {...p, examenes: [ex, ...p.examenes]} : p));
    setSeleccionado({...seleccionado, examenes: [ex, ...seleccionado.examenes]});
    setExamenForm({ tipo:"Laboratorio", nombre:"", resultado:"", fecha: new Date().toISOString().split("T")[0] });
  };

  const cambiarEstado = (e) => {
    setPacientes(pacientes.map(p => p.id === seleccionado.id ? {...p, estado: e} : p));
    setSeleccionado({...seleccionado, estado: e});
  };

  const eliminarPaciente = (id) => {
    if (confirm("¿Eliminar paciente?")) {
      setPacientes(pacientes.filter(p => p.id !== id));
      if (seleccionado?.id === id) { setSeleccionado(null); setVista("kanban"); }
    }
  };

  // VISTA: GESTIÓN DE SERVICIOS
  if (vista === "servicios") {
    return (
      <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
        <button onClick={()=>setVista("kanban")} style={{background:"none",border:"none",color:"#4a7eab",fontSize:13,cursor:"pointer",marginBottom:12,padding:0}}>← Volver</button>
        <div style={{fontSize:15,fontWeight:600,color:"#1a3a5c",marginBottom:14}}>Mis servicios / pisos</div>
        <div style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"12px",marginBottom:14}}>
          <div style={{fontSize:12,fontWeight:500,color:"#4a7eab",marginBottom:8}}>Servicios actuales</div>
          {misServicios.map(s => {
            const cantidadPac = misPacientes.filter(p => p.servicio === s && p.estado === "activo").length;
            return (
              <div key={s} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 10px",background:"#f0f8fd",borderRadius:6,marginBottom:5}}>
                <div>
                  <div style={{fontSize:13,fontWeight:500,color:"#1a3a5c"}}>{s}</div>
                  <div style={{fontSize:10,color:"#7aa3c4"}}>{cantidadPac} paciente{cantidadPac === 1 ? "" : "s"} activo{cantidadPac === 1 ? "" : "s"}</div>
                </div>
                <button onClick={()=>eliminarServicio(s)} disabled={cantidadPac > 0} style={{padding:"4px 10px",fontSize:11,background:"#fff",color:cantidadPac>0?"#cdddec":"#c0392b",border:`0.5px solid ${cantidadPac>0?"#cdddec":"#f0c5c0"}`,borderRadius:6,cursor:cantidadPac>0?"not-allowed":"pointer"}}>Eliminar</button>
              </div>
            );
          })}
        </div>
        <div style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"12px"}}>
          <div style={{fontSize:12,fontWeight:500,color:"#4a7eab",marginBottom:8}}>Agregar servicio</div>
          <div style={{display:"flex",gap:6,marginBottom:10}}>
            <input value={servicioPersonalizado} onChange={e=>setServicioPersonalizado(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")agregarServicio();}} placeholder="Nombre del servicio" style={{flex:1,padding:"9px 12px",fontSize:13,borderRadius:8,border:"0.5px solid #b8d8ef",outline:"none"}}/>
            <button onClick={agregarServicio} disabled={!servicioPersonalizado.trim()} style={{padding:"9px 14px",fontSize:13,fontWeight:500,background:servicioPersonalizado.trim()?"#1a6fb5":"#cdddec",color:"#fff",border:"none",borderRadius:8,cursor:"pointer"}}>+ Agregar</button>
          </div>
          <div style={{fontSize:11,color:"#7aa3c4",marginBottom:6}}>Sugerencias rápidas:</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
            {SERVICIOS_SUGERIDOS.filter(s => !misServicios.includes(s)).map(s => (
              <button key={s} onClick={()=>{setServiciosUsuario({...serviciosUsuario, [currentUser.correo]: [...misServicios, s]});}} style={{padding:"4px 10px",fontSize:11,borderRadius:14,cursor:"pointer",border:"0.5px dashed #1a6fb5",background:"#fff",color:"#1a6fb5"}}>+ {s}</button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // VISTA: NUEVO PACIENTE
  if (vista === "nuevo") {
    return (
      <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
        <button onClick={()=>{setVista("kanban");setErrorForm("");}} style={{background:"none",border:"none",color:"#4a7eab",fontSize:13,cursor:"pointer",marginBottom:12,padding:0}}>← Volver</button>
        <div style={{fontSize:15,fontWeight:600,color:"#1a3a5c",marginBottom:14}}>Nuevo paciente</div>
        <div style={{background:"#fff8e1",border:"0.5px solid #f0d896",borderRadius:8,padding:"8px 12px",marginBottom:14,fontSize:11,color:"#8a6610",lineHeight:1.5}}>⚠️ Usa <strong>iniciales</strong>, no nombres completos.</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <div><label style={labelStyle}>Iniciales</label><input value={nuevoForm.iniciales} onChange={e=>setNuevoForm({...nuevoForm,iniciales:e.target.value})} placeholder="J.P.M." style={inputStyle} maxLength={8}/></div>
          <div><label style={labelStyle}>Edad</label><input type="number" value={nuevoForm.edad} onChange={e=>setNuevoForm({...nuevoForm,edad:e.target.value})} placeholder="65" style={inputStyle}/></div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <div><label style={labelStyle}>Sexo</label><select value={nuevoForm.sexo} onChange={e=>setNuevoForm({...nuevoForm,sexo:e.target.value})} style={inputStyle}><option value="M">Masculino</option><option value="F">Femenino</option></select></div>
          <div><label style={labelStyle}>Cama</label><input value={nuevoForm.cama} onChange={e=>setNuevoForm({...nuevoForm,cama:e.target.value})} placeholder="412B" style={inputStyle}/></div>
        </div>
        <label style={labelStyle}>Servicio</label>
        <select value={nuevoForm.servicio} onChange={e=>setNuevoForm({...nuevoForm,servicio:e.target.value})} style={inputStyle}>
          {misServicios.map(s => <option key={s}>{s}</option>)}
        </select>
        <label style={labelStyle}>Fecha de ingreso</label>
        <input type="date" value={nuevoForm.fechaIngreso} onChange={e=>setNuevoForm({...nuevoForm,fechaIngreso:e.target.value})} style={inputStyle}/>
        <label style={labelStyle}>Diagnóstico</label>
        <textarea value={nuevoForm.diagnostico} onChange={e=>setNuevoForm({...nuevoForm,diagnostico:e.target.value})} placeholder="Ej: Litiasis renal obstructiva" rows={2} style={{...inputStyle,resize:"none"}}/>
        <label style={labelStyle}>Plan de manejo</label>
        <textarea value={nuevoForm.planManejo} onChange={e=>setNuevoForm({...nuevoForm,planManejo:e.target.value})} placeholder="Ej: NPC + ATB" rows={3} style={{...inputStyle,resize:"none"}}/>
        {errorForm && <div style={{fontSize:12,color:"#c0392b",background:"#fde8e6",padding:"8px 10px",borderRadius:6,marginBottom:8}}>{errorForm}</div>}
        <button onClick={crear} style={{...btnPrimary, marginTop:0}}>Guardar paciente</button>
      </div>
    );
  }

  // VISTA: FICHA DEL PACIENTE
  if (vista === "ficha" && seleccionado) {
    return (
      <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
        <button onClick={()=>{setVista("kanban");setSeleccionado(null);}} style={{background:"none",border:"none",color:"#4a7eab",fontSize:13,cursor:"pointer",marginBottom:12,padding:0}}>← Volver</button>
        <div style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"14px",marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
            <div style={{fontSize:18,fontWeight:600,color:"#1a3a5c"}}>{seleccionado.iniciales}</div>
            <span style={{fontSize:10,fontWeight:500,padding:"2px 8px",borderRadius:10,background: seleccionado.estado==="activo"?"#d4f0e0":"#e0e0e0",color: seleccionado.estado==="activo"?"#1a6f5c":"#666"}}>{seleccionado.estado === "activo" ? "Hospitalizado" : "Alta"}</span>
          </div>
          <div style={{fontSize:12,color:"#4a7eab"}}>{seleccionado.edad}a · {seleccionado.sexo} · Cama {seleccionado.cama} · {seleccionado.servicio}</div>
          <div style={{fontSize:11,color:"#7aa3c4",marginTop:2}}>Ingreso: {seleccionado.fechaIngreso}</div>
          <div style={{borderTop:"0.5px solid #e8f3fb",paddingTop:8,marginTop:8}}>
            <div style={{fontSize:11,fontWeight:500,color:"#4a7eab",marginBottom:3}}>DIAGNÓSTICO</div>
            <div style={{fontSize:13,color:"#1a3a5c",marginBottom:8}}>{seleccionado.diagnostico}</div>
            <div style={{fontSize:11,fontWeight:500,color:"#4a7eab",marginBottom:3}}>PLAN DE MANEJO</div>
            <div style={{fontSize:13,color:"#1a3a5c",whiteSpace:"pre-wrap"}}>{seleccionado.planManejo || "Sin plan registrado"}</div>
          </div>
          <div style={{display:"flex",gap:6,marginTop:12,paddingTop:10,borderTop:"0.5px solid #e8f3fb"}}>
            {seleccionado.estado === "activo" ? <button onClick={()=>cambiarEstado("alta")} style={{flex:1,padding:"6px",fontSize:12,background:"#fff",color:"#1a6f5c",border:"0.5px solid #1a6f5c",borderRadius:6,cursor:"pointer",fontWeight:500}}>Dar de alta</button> : <button onClick={()=>cambiarEstado("activo")} style={{flex:1,padding:"6px",fontSize:12,background:"#fff",color:"#1a6fb5",border:"0.5px solid #1a6fb5",borderRadius:6,cursor:"pointer",fontWeight:500}}>Reactivar</button>}
            <button onClick={()=>eliminarPaciente(seleccionado.id)} style={{padding:"6px 12px",fontSize:12,background:"#fff",color:"#c0392b",border:"0.5px solid #f0c5c0",borderRadius:6,cursor:"pointer"}}>Eliminar</button>
          </div>
        </div>
        <div style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"14px",marginBottom:14}}>
          <div style={{fontSize:13,fontWeight:600,color:"#1a3a5c",marginBottom:10}}>📋 Evoluciones diarias</div>
          <div style={{display:"flex",gap:6,marginBottom:12,background:"#f0f8fd",padding:4,borderRadius:8}}>
            {[["libre","✏️ Libre"],["estructurada","☑️ Estructurada"]].map(([id,label])=><button key={id} onClick={()=>setModoEvolucion(id)} style={{flex:1,padding:"6px",fontSize:12,fontWeight:modoEvolucion===id?500:400,borderRadius:6,cursor:"pointer",border:"none",background:modoEvolucion===id?"#1a6fb5":"transparent",color:modoEvolucion===id?"#fff":"#4a7eab"}}>{label}</button>)}
          </div>
          {modoEvolucion === "libre" ? (
            <>
              <textarea value={evolucionTexto} onChange={e=>setEvolucionTexto(e.target.value)} placeholder="Ej: Día 2 post-NPC. Afebril..." rows={4} style={{...inputStyle,resize:"none"}}/>
              <button onClick={agregarEvolucion} disabled={!evolucionTexto.trim()} style={{...btnPrimary, marginTop:0, padding:"8px", fontSize:13, opacity: evolucionTexto.trim()?1:0.5}}>+ Agregar evolución</button>
            </>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <CampoAlt label="Estado general" opciones={["Excelente","Bueno","Regular","Malo","Crítico"]} value={evolEstr.estadoGeneral} onChange={v=>setEvolEstr({...evolEstr,estadoGeneral:v})}/>
              <CampoAlt label="Dolor" opciones={["Sin dolor","Leve (EVA 1-3)","Moderado (EVA 4-6)","Severo (EVA 7-10)"]} value={evolEstr.dolor} onChange={v=>setEvolEstr({...evolEstr,dolor:v})}/>
              <CampoAlt label="Fiebre" opciones={["Afebril","Febrícula","Fiebre","Fiebre alta"]} value={evolEstr.fiebre} onChange={v=>setEvolEstr({...evolEstr,fiebre:v})}/>
              <CampoAlt label="Diuresis" opciones={["Conservada","Disminuida","Oliguria","Anuria","Por sonda Foley","Hematuria"]} value={evolEstr.diuresis} onChange={v=>setEvolEstr({...evolEstr,diuresis:v})}/>
              <CampoAlt label="Tolerancia oral" opciones={["Buena","Regular","Mala","Régimen cero","Náuseas/vómitos"]} value={evolEstr.tolerancia} onChange={v=>setEvolEstr({...evolEstr,tolerancia:v})}/>
              <CampoAlt label="Deambulación" opciones={["Independiente","Asistida","Reposo relativo","Reposo absoluto"]} value={evolEstr.deambulacion} onChange={v=>setEvolEstr({...evolEstr,deambulacion:v})}/>
              <CampoAlt label="Catéteres/drenajes" opciones={["Sin dispositivos","Foley","Doble J","Nefrostomía","Drenaje quirúrgico","VVC","Múltiples"]} value={evolEstr.catetereres} onChange={v=>setEvolEstr({...evolEstr,catetereres:v})}/>
              <div><label style={labelStyle}>Examen físico (opcional)</label><textarea value={evolEstr.examenFisico} onChange={e=>setEvolEstr({...evolEstr,examenFisico:e.target.value})} rows={2} style={{...inputStyle,resize:"none",marginBottom:0}}/></div>
              <div><label style={labelStyle}>Plan / indicaciones (opcional)</label><textarea value={evolEstr.plan} onChange={e=>setEvolEstr({...evolEstr,plan:e.target.value})} rows={2} style={{...inputStyle,resize:"none",marginBottom:0}}/></div>
              <button onClick={agregarEvolucion} style={{...btnPrimary, marginTop:0, padding:"8px", fontSize:13}}>+ Agregar evolución</button>
            </div>
          )}
          {seleccionado.evoluciones.length > 0 && (
            <div style={{marginTop:14,display:"flex",flexDirection:"column",gap:8}}>
              {seleccionado.evoluciones.map(e => (
                <div key={e.id} style={{padding:"10px 12px",background:"#f0f8fd",borderRadius:8,borderLeft:"3px solid #1a6fb5"}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:11,fontWeight:500,color:"#1a6fb5",marginBottom:4}}>
                    <span>{e.fecha} · {e.hora}</span>
                    {e.tipo === "estructurada" && <span style={{fontSize:9,padding:"1px 6px",background:"#1a6fb5",color:"#fff",borderRadius:8}}>ESTRUCTURADA</span>}
                  </div>
                  <div style={{fontSize:13,color:"#1a3a5c",lineHeight:1.5,whiteSpace:"pre-wrap"}}>{e.texto}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,padding:"14px"}}>
          <div style={{fontSize:13,fontWeight:600,color:"#1a3a5c",marginBottom:10}}>🧪 Exámenes</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <div><label style={labelStyle}>Tipo</label><select value={examenForm.tipo} onChange={e=>setExamenForm({...examenForm,tipo:e.target.value})} style={inputStyle}><option>Laboratorio</option><option>Imagen</option><option>Cultivo</option><option>Anatomía patológica</option><option>Otro</option></select></div>
            <div><label style={labelStyle}>Fecha</label><input type="date" value={examenForm.fecha} onChange={e=>setExamenForm({...examenForm,fecha:e.target.value})} style={inputStyle}/></div>
          </div>
          <label style={labelStyle}>Nombre del examen</label>
          <input value={examenForm.nombre} onChange={e=>setExamenForm({...examenForm,nombre:e.target.value})} placeholder="Ej: Urocultivo..." style={inputStyle}/>
          <label style={labelStyle}>Resultado</label>
          <textarea value={examenForm.resultado} onChange={e=>setExamenForm({...examenForm,resultado:e.target.value})} rows={2} style={{...inputStyle,resize:"none"}}/>
          <button onClick={agregarExamen} disabled={!examenForm.nombre.trim()} style={{...btnPrimary, marginTop:0, padding:"8px", fontSize:13, opacity: examenForm.nombre.trim()?1:0.5}}>+ Agregar examen</button>
          {seleccionado.examenes.length > 0 && (
            <div style={{marginTop:14,display:"flex",flexDirection:"column",gap:8}}>
              {seleccionado.examenes.map(ex => (
                <div key={ex.id} style={{padding:"10px 12px",background:"#f5f0fd",borderRadius:8,borderLeft:"3px solid #8a5cb5"}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:11,fontWeight:500,color:"#8a5cb5",marginBottom:4}}><span>{ex.tipo} · {ex.nombre}</span><span>{ex.fecha}</span></div>
                  {ex.resultado && <div style={{fontSize:13,color:"#1a3a5c",whiteSpace:"pre-wrap"}}>{ex.resultado}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // VISTA: KANBAN (por servicios)
  return (
    <div style={{padding:"14px",flex:1,overflowY:"auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10,gap:8,flexWrap:"wrap"}}>
        <div>
          <div style={{fontSize:15,fontWeight:600,color:"#1a3a5c",marginBottom:2}}>Mis pacientes</div>
          <div style={{fontSize:11,color:"#4a7eab"}}>{counts.activos} hospitalizados · {counts.alta} alta</div>
        </div>
        <div style={{display:"flex",gap:6}}>
          <button onClick={()=>setVista("servicios")} style={{padding:"7px 10px",fontSize:11,background:"#fff",color:"#1a6fb5",border:"0.5px solid #1a6fb5",borderRadius:8,cursor:"pointer"}}>⚙️ Servicios</button>
          <button onClick={()=>setVista("nuevo")} style={{padding:"7px 12px",fontSize:12,fontWeight:500,background:"#1a6fb5",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",whiteSpace:"nowrap"}}>+ Nuevo paciente</button>
        </div>
      </div>

      <div style={{background:"#fff8e1",border:"0.5px solid #f0d896",borderRadius:8,padding:"7px 10px",marginBottom:10,fontSize:11,color:"#8a6610"}}>🔒 Solo tú ves tus pacientes. Usa iniciales.</div>

      <input value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="Buscar por iniciales, cama, diagnóstico..." style={{...inputStyle, marginBottom:8}}/>

      <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
        {[["activos",`Activos (${counts.activos})`],["alta",`Alta (${counts.alta})`],["todos","Todos"]].map(([id,label])=><button key={id} onClick={()=>setFiltroEstado(id)} style={{padding:"5px 10px",fontSize:11,fontWeight:filtroEstado===id?500:400,borderRadius:14,cursor:"pointer",border:filtroEstado===id?"none":"0.5px solid #b8d8ef",background:filtroEstado===id?"#1a6fb5":"#fff",color:filtroEstado===id?"#fff":"#4a7eab"}}>{label}</button>)}
      </div>

      {filtrados.length === 0 ? (
        <div style={{textAlign:"center",padding:"40px 20px",color:"#7aa3c4",fontSize:13}}>{misPacientes.length === 0 ? "No tienes pacientes aún." : "Ningún paciente coincide"}</div>
      ) : (
        <div style={{overflowX:"auto",paddingBottom:8}}>
          <div style={{display:"flex",gap:10,minWidth:"max-content"}}>
            {misServicios.map(serv => {
              const pacsServicio = filtrados.filter(p => p.servicio === serv);
              return (
                <div key={serv} style={{minWidth:200,maxWidth:240,flex:"0 0 220px",background:"#f0f8fd",borderRadius:10,padding:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,paddingBottom:6,borderBottom:"0.5px solid #b8d8ef"}}>
                    <div style={{fontSize:12,fontWeight:600,color:"#1a3a5c"}}>{serv}</div>
                    <span style={{fontSize:10,padding:"1px 7px",background:"#1a6fb5",color:"#fff",borderRadius:8,fontWeight:500}}>{pacsServicio.length}</span>
                  </div>
                  {pacsServicio.length === 0 ? (
                    <div style={{fontSize:11,color:"#7aa3c4",textAlign:"center",padding:"16px 8px",fontStyle:"italic"}}>Sin pacientes</div>
                  ) : (
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {pacsServicio.map(p => (
                        <div key={p.id} onClick={()=>{setSeleccionado(p);setVista("ficha");}} style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:8,padding:"8px 10px",cursor:"pointer",borderLeft:`3px solid ${p.estado==="activo"?"#1a6fb5":"#b8b8b8"}`}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:3}}>
                            <div style={{fontSize:12,fontWeight:600,color:"#1a3a5c"}}>{p.iniciales}</div>
                            <span style={{fontSize:9,padding:"1px 6px",borderRadius:8,background:p.estado==="activo"?"#d4f0e0":"#e8e8e8",color:p.estado==="activo"?"#1a6f5c":"#666",fontWeight:500}}>{p.estado === "activo" ? "Hosp." : "Alta"}</span>
                          </div>
                          <div style={{fontSize:11,color:"#4a7eab",marginBottom:3}}>{p.edad}a {p.sexo} · 🛏 {p.cama}</div>
                          <div style={{fontSize:11,color:"#7aa3c4",lineHeight:1.3,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{p.diagnostico}</div>
                          <div style={{fontSize:9,color:"#7aa3c4",marginTop:4,display:"flex",gap:8}}>
                            <span>📋 {p.evoluciones.length}</span>
                            <span>🧪 {p.examenes.length}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function VideoPlayer({ video, onClose }) {
  const ytId = getYouTubeId(video.url);
  return (
    <div onClick={onClose} style={{position:"absolute",inset:0,background:"rgba(26,58,92,0.85)",zIndex:50,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px",borderRadius:"var(--border-radius-lg)"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:12,maxWidth:720,width:"100%",overflow:"hidden"}}>
        <div style={{padding:"10px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"0.5px solid #b8d8ef"}}>
          <div style={{fontSize:13,fontWeight:500,color:"#1a3a5c"}}>{video.titulo}</div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:18,color:"#7aa3c4",cursor:"pointer",padding:0}}>✕</button>
        </div>
        <div style={{aspectRatio:"16/9",background:"#000"}}>
          {ytId ? <iframe src={`https://www.youtube.com/embed/${ytId}?autoplay=1`} style={{width:"100%",height:"100%",border:"none"}} allow="autoplay; encrypted-media" allowFullScreen title={video.titulo}/> : <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",color:"#fff"}}>Video no disponible</div>}
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
    const matchQ = !q || v.titulo.toLowerCase().includes(q) || v.descripcion.toLowerCase().includes(q) || v.keywords.some(k=>k.toLowerCase().includes(q));
    return matchCat && matchQ;
  });
  const agregarVideo = () => {
    setErrorAdd("");
    if (!nuevo.titulo.trim()) return setErrorAdd("Ingresa un título");
    if (!nuevo.url.trim()) return setErrorAdd("Ingresa la URL");
    if (!getYouTubeId(nuevo.url)) return setErrorAdd("URL de YouTube inválida");
    const newVid = { id: "v" + Date.now(), titulo: nuevo.titulo, categoria: nuevo.categoria, url: nuevo.url, autor: nuevo.autor || "Sin especificar", descripcion: nuevo.descripcion || "Sin descripción", keywords: nuevo.keywords.split(",").map(k=>k.trim()).filter(Boolean) };
    setVideos([newVid, ...videos]);
    setNuevo({ titulo:"", categoria:"Oncología", url:"", autor:"", descripcion:"", keywords:"" });
    setAgregando(false);
  };
  const eliminarVideo = (id) => { if (confirm("¿Eliminar?")) setVideos(videos.filter(v => v.id !== id)); };

  return (
    <div style={{padding:"16px",flex:1,overflowY:"auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,gap:10}}>
        <div>
          <div style={{fontSize:15,fontWeight:600,color:"#1a3a5c",marginBottom:2}}>Biblioteca quirúrgica</div>
          <div style={{fontSize:11,color:"#4a7eab"}}>{videos.length} videos</div>
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
          <input value={nuevo.keywords} onChange={e=>setNuevo({...nuevo,keywords:e.target.value})} placeholder="Palabras clave (separadas por coma)" style={inputStyle}/>
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
            const ytId = getYouTubeId(v.url);
            const thumb = ytId ? `https://img.youtube.com/vi/${ytId}/mqdefault.jpg` : null;
            return (
              <div key={v.id} style={{background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:10,overflow:"hidden",display:"flex",flexDirection:"column"}}>
                <div onClick={()=>setPlayingVideo(v)} style={{position:"relative",cursor:"pointer",background:"#1a3a5c",aspectRatio:"16/9",overflow:"hidden"}}>
                  {thumb && <img src={thumb} alt="" style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>}
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
  const [videos, setVideos] = useState(VIDEOS_INICIALES);
  const [pacientes, setPacientes] = useState([]);
  const [tablaCirugias, setTablaCirugias] = useState([]);
  const [conocimiento, setConocimiento] = useState([]);
  const [serviciosUsuario, setServiciosUsuario] = useState({});
  const [pendientes, setPendientes] = useState([]);
  const [equipos, setEquipos] = useState([]);
  const [invitacionesPendientes, setInvitacionesPendientes] = useState([]);
  const [invitaciones, setInvitaciones] = useState([]);
  const [playingVideo, setPlayingVideo] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [tab, setTab] = useState("chat");
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
setTab(perfil.rol === "admin" ? "admin" : "chat");

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
// Si no hay conversaciones, mostrar mensaje de bienvenida
if (perfil.rol !== "admin" && (!convResult.ok || convResult.conversaciones.length === 0)) {
  setMessages([{ role:"assistant", content:`Hola ${perfil.nombre.split(" ")[0]}. Soy UroSearch. ¿En qué te puedo ayudar?` }]);
}
};

  const userInitials = currentUser ? (currentUser.nombre.split(" ").map(p=>p[0]).filter(c=>c.match(/[A-Z]/i)).slice(0,2).join("").toUpperCase() || "U") : "";

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
      const matched = filtrados.filter(p => inicialesEnQuery.some(ini => p.iniciales.includes(ini.replace(/\./g,"")) || ini.includes(p.iniciales.replace(/\./g,""))));
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
  const docsRelevantes = buscarEnConocimiento(txt, conocimiento, 3);
  const tieneFuentes = docsRelevantes.length > 0;
  const consultaCirugias = buscarCirugiasRelevantes(txt);
  const consultaPacientes = buscarPacientesRelevantes(txt);

  try {
    const modoIns = modo === "precisa" ? "\n\nMODO PRECISA: máximo 3-4 líneas, sin advertencia." : "\n\nMODO EXPLICATIVA: respuesta completa con contexto y evidencia.";
    let ctx = "";
    if (tieneFuentes) {
      ctx += "\n\n=== BASE DE CONOCIMIENTO ===\nResponde PRIORITARIAMENTE con estos documentos. Cita la fuente al final.\n\n" + docsRelevantes.map((d,i) => `--- DOC ${i+1}: ${d.titulo} ---\n${d.contenido.slice(0,3000)}`).join("\n\n");
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
    <div style={{fontFamily:"var(--font-sans)",minHeight:"100vh",background:"#e8f3fb",borderRadius:"var(--border-radius-lg)"}}>
      <AuthScreen/>
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
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <LogoUroSearch size={40}/>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{fontWeight:600,fontStyle:"italic",fontFamily:"Georgia, 'Times New Roman', serif",fontSize:20,color:"#1a3a5c",letterSpacing:"-0.3px"}}>UroSearch</div>
                {isAdmin && <span style={{fontSize:9,fontWeight:600,padding:"2px 6px",background:"#1a6fb5",color:"#fff",borderRadius:4}}>ADMIN</span>}
              </div>
              <div style={{fontSize:11,color:"#4a7eab"}}>Asistente Clínico de Urología</div>
            </div>
          </div>
          <button onClick={()=>setMenuOpen(!menuOpen)} style={{display:"flex",alignItems:"center",gap:6,background:"#fff",border:"0.5px solid #b8d8ef",borderRadius:20,padding:"4px 10px 4px 4px",cursor:"pointer"}}>
            <div style={{width:28,height:28,borderRadius:"50%",background:isAdmin?"#1a3a5c":"#1a6fb5",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:500,color:"#fff"}}>{userInitials}</div>
            <span style={{fontSize:12,color:"#1a3a5c",fontWeight:500}}>▾</span>
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
            <button key={id} onClick={() => setTab(id)} style={{flex:"1 0 auto",padding:"8px 6px",fontSize:11,fontWeight:tab===id?500:400,background:"transparent",border:"none",borderBottom:tab===id?"2px solid #1a6fb5":"2px solid transparent",color:tab===id?"#1a6fb5":"#4a7eab",cursor:"pointer",whiteSpace:"nowrap"}}>{label}</button>
          ))}
        </div>
      </div>

      {tab==="admin" && isAdmin && <AdminPanel/>}
      {tab==="hospital" && <HospitalPanel pacientes={pacientes} setPacientes={setPacientes} currentUser={currentUser} tablaCirugias={tablaCirugias} setTablaCirugias={setTablaCirugias} serviciosUsuario={serviciosUsuario} setServiciosUsuario={setServiciosUsuario} pendientes={pendientes} setPendientes={setPendientes} equipos={equipos} setEquipos={setEquipos} invitacionesPendientes={invitacionesPendientes} setInvitacionesPendientes={setInvitacionesPendientes} users={users}/>}
      {tab==="conocimiento" && <ConocimientoHub conocimiento={conocimiento} setConocimiento={setConocimiento} isAdmin={isAdmin} videos={videos} setVideos={setVideos} setPlayingVideo={setPlayingVideo} mapaTema={mapaTema} setMapaTema={setMapaTema} mapaActual={mapaActual} setMapaActual={setMapaActual} mapaLoading={mapaLoading} generarMapa={generarMapa} topicOpen={topicOpen} setTopicOpen={setTopicOpen} mapasGuardados={mapasGuardados} onGuardarMapa={handleGuardarMapa} onEliminarMapa={handleEliminarMapa} onCargarMapaGuardado={cargarMapaGuardado} guardandoMapa={guardandoMapa}/>}
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
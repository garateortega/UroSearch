// ============================================================
// LOGBOOK QUIRÚRGICO PERSONAL
// - Foto del protocolo operatorio → extracción automática con IA
// - Revisión/edición manual antes de guardar
// - Métricas de la casuística personal (KPIs + gráficos SVG)
// Estilo: mismas CSS vars y patrones del resto de UroSearch.
// ============================================================
import { useState, useRef, useEffect, useMemo, Fragment } from "react";
import {
  listarLogbook, crearRegistroLogbook, actualizarRegistroLogbook,
  eliminarRegistroLogbook, subirFotoLogbook, obtenerUrlFoto, eliminarFotoLogbook,
} from "./logbook";

const CATEGORIAS_LOGBOOK = ["Endourología", "Laparoscopía", "Cirugía abierta", "Cistoscopía", "Biopsia prostática", "Uretra / genital", "Otro"];
const ROLES = [["cirujano", "Cirujano principal"], ["primer_ayudante", "1er ayudante"], ["segundo_ayudante", "2do ayudante"], ["observador", "Observador"]];
const CLAVIEN = ["", "I", "II", "IIIa", "IIIb", "IVa", "IVb", "V"];

const REGISTRO_VACIO = {
  fecha: new Date().toISOString().slice(0, 10),
  iniciales: "", edad: "", sexo: "", diagnostico_pre: "", diagnostico_post: "",
  procedimiento: "", categoria: "", lateralidad: "", rol: "cirujano",
  cirujano: "", ayudantes: "", anestesia: "", hora_inicio: "", hora_termino: "",
  duracion_min: "", sangrado_ml: "", hallazgos: "", tecnica: "",
  complicacion: false, clavien: "", detalles_complicacion: "", observaciones: "",
};

// ─── Comprime la foto en el navegador antes de enviarla (máx 1568 px, JPEG) ───
async function comprimirImagen(file, maxDim = 1568, calidad = 0.85) {
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
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", calidad));
  return { base64: dataUrl.split(",")[1], dataUrl, blob };
}

// ─── Detecta el rol del usuario según su nombre en el protocolo ───
function detectarRol(nombreUsuario, cirujano, ayudantes) {
  if (!nombreUsuario) return "cirujano";
  const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Usa apellidos/palabras significativas del usuario (≥4 letras, sin "dr")
  const tokens = norm(nombreUsuario).split(/[\s.,]+/).filter((t) => t.length >= 4 && !["doctor"].includes(t));
  const aparece = (campo) => tokens.some((t) => norm(campo).includes(t));
  if (aparece(cirujano)) return "cirujano";
  if (aparece(ayudantes)) return "primer_ayudante";
  return "cirujano";
}

// ─── Extracción con IA (visión) vía la misma edge function del chat ───
async function extraerDeFotos(imagenesBase64) {
  const instrucciones = `Analiza la(s) foto(s) de este protocolo operatorio de urología y extrae los datos en JSON.
Responde SOLO con un objeto JSON válido, sin markdown, sin backticks, sin texto adicional.
Si un dato no aparece en el documento, usa null. NO inventes datos.

Esquema exacto:
{
  "fecha": "YYYY-MM-DD o null",
  "iniciales": "iniciales del paciente (2-4 letras mayúsculas, desde el nombre si aparece) o null",
  "edad": numero o null,
  "sexo": "M" | "F" | null,
  "diagnostico_pre": "diagnóstico preoperatorio o null",
  "diagnostico_post": "diagnóstico postoperatorio o null",
  "procedimiento": "nombre de la cirugía realizada, estandarizado (ej: 'Ureterolitectomía endoscópica', 'RTU próstata', 'Nefrectomía radical laparoscópica') o null",
  "categoria": una de ["Endourología","Laparoscopía","Cirugía abierta","Cistoscopía","Biopsia prostática","Uretra / genital","Otro"],
  "lateralidad": "Derecha" | "Izquierda" | "Bilateral" | null,
  "cirujano": "nombre del cirujano principal o null",
  "ayudantes": "nombres de ayudantes separados por coma o null",
  "anestesia": "tipo de anestesia o null",
  "hora_inicio": "HH:MM o null",
  "hora_termino": "HH:MM o null",
  "duracion_min": numero de minutos (calculado de las horas si existen) o null,
  "sangrado_ml": numero o null,
  "hallazgos": "hallazgos operatorios resumidos o null",
  "tecnica": "resumen breve de la técnica/descripción operatoria (máx 3 frases) o null",
  "complicacion": true | false,
  "detalles_complicacion": "descripción de complicación intraoperatoria o null",
  "observaciones": "otras observaciones relevantes (drenajes, catéter JJ, sonda, biopsias enviadas) o null"
}
IMPORTANTE: nunca incluyas el nombre completo ni RUT del paciente, solo iniciales.`;

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
      max_tokens: 1500,
      system: "Eres un extractor de datos clínicos de protocolos quirúrgicos de urología. Respondes exclusivamente con JSON válido.",
      messages: [{ role: "user", content }],
    }),
  });
  const data = await res.json();
  const txt = data.content?.find((b) => b.type === "text")?.text || "";
  const clean = txt.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ─── Utilitarios de métricas ───
function mesClave(fecha) { return (fecha || "").slice(0, 7); } // "YYYY-MM"
function mesLabel(clave) {
  const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const [y, m] = clave.split("-");
  return `${meses[parseInt(m, 10) - 1]} ${y.slice(2)}`;
}
function ultimosMeses(n) {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const t = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

// ─── Gráfico de barras mensual (SVG, sin librerías) ───
function BarrasMensuales({ datos }) {
  const W = 620, H = 170, padL = 26, padB = 26, padT = 12;
  const max = Math.max(1, ...datos.map((d) => d.total));
  const bw = (W - padL - 8) / datos.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      {[0, 0.5, 1].map((f) => {
        const y = padT + (H - padT - padB) * (1 - f);
        return (
          <Fragment key={f}>
            <line x1={padL} y1={y} x2={W - 4} y2={y} stroke="var(--borde)" strokeWidth="0.5" />
            <text x={padL - 5} y={y + 3} fontSize="9" fill="var(--texto-ter)" textAnchor="end">{Math.round(max * f)}</text>
          </Fragment>
        );
      })}
      {datos.map((d, i) => {
        const hTot = (H - padT - padB) * (d.total / max);
        const hCx = (H - padT - padB) * (d.cirujano / max);
        const x = padL + i * bw + bw * 0.15;
        const ancho = bw * 0.7;
        return (
          <Fragment key={d.mes}>
            <rect x={x} y={H - padB - hTot} width={ancho} height={hTot} rx="3" fill="var(--primario)" opacity="0.25" />
            <rect x={x} y={H - padB - hCx} width={ancho} height={hCx} rx="3" fill="var(--primario)" />
            {d.total > 0 && <text x={x + ancho / 2} y={H - padB - hTot - 3} fontSize="9" fill="var(--texto-sec)" textAnchor="middle">{d.total}</text>}
            <text x={x + ancho / 2} y={H - padB + 12} fontSize="8.5" fill="var(--texto-ter)" textAnchor="middle">{mesLabel(d.mes)}</text>
          </Fragment>
        );
      })}
    </svg>
  );
}

// ─── Barras horizontales (top procedimientos / categorías) ───
function BarrasHorizontales({ items, color = "var(--primario)" }) {
  const max = Math.max(1, ...items.map((i) => i.n));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {items.map((it) => (
        <div key={it.label}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
            <span style={{ color: "var(--texto)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 8 }}>{it.label}</span>
            <span style={{ color: "var(--texto-sec)", fontWeight: 600, flexShrink: 0 }}>{it.n}{it.extra ? ` · ${it.extra}` : ""}</span>
          </div>
          <div style={{ height: 8, background: "var(--fondo-suave)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${(it.n / max) * 100}%`, height: "100%", background: color, borderRadius: 4 }} />
          </div>
        </div>
      ))}
      {items.length === 0 && <div style={{ fontSize: 12, color: "var(--texto-ter)" }}>Sin datos aún.</div>}
    </div>
  );
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================
export default function LogbookPanel({ currentUser }) {
  const [registros, setRegistros] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [vista, setVista] = useState("lista"); // lista | nueva | metricas
  const [error, setError] = useState("");

  // Formulario / extracción
  const [reg, setReg] = useState({ ...REGISTRO_VACIO });
  const [editId, setEditId] = useState(null);
  const [extrayendo, setExtrayendo] = useState(false);
  const [extraidoOk, setExtraidoOk] = useState(false);
  const [fotos, setFotos] = useState([]); // [{dataUrl, blob, base64}]
  const [guardando, setGuardando] = useState(false);
  const inputFotoRef = useRef(null);

  // Lista
  const [busqueda, setBusqueda] = useState("");
  const [filtroCat, setFiltroCat] = useState("Todas");
  const [filtroRol, setFiltroRol] = useState("todos");
  const [abierto, setAbierto] = useState(null);
  const [fotoUrl, setFotoUrl] = useState(null); // url firmada para visor

  // ─── Carga inicial ───
  useEffect(() => {
    if (!currentUser) return;
    setCargando(true);
    listarLogbook(currentUser.id).then((r) => {
      if (r.ok) setRegistros(r.registros);
      else setError(r.error);
      setCargando(false);
    });
  }, [currentUser]);

  const set = (campo, valor) => setReg((prev) => ({ ...prev, [campo]: valor }));

  // ─── Foto → extracción ───
  const onFotos = async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 3);
    if (files.length === 0) return;
    setError("");
    setExtrayendo(true);
    setExtraidoOk(false);
    try {
      const comprimidas = [];
      for (const f of files) comprimidas.push(await comprimirImagen(f));
      setFotos(comprimidas);
      const datos = await extraerDeFotos(comprimidas.map((c) => c.base64));
      const rolDetectado = detectarRol(currentUser?.nombre, datos.cirujano, datos.ayudantes);
      setReg((prev) => ({
        ...prev,
        fecha: datos.fecha || prev.fecha,
        iniciales: (datos.iniciales || "").toUpperCase(),
        edad: datos.edad != null ? String(datos.edad) : "",
        sexo: datos.sexo || "",
        diagnostico_pre: datos.diagnostico_pre || "",
        diagnostico_post: datos.diagnostico_post || "",
        procedimiento: datos.procedimiento || "",
        categoria: CATEGORIAS_LOGBOOK.includes(datos.categoria) ? datos.categoria : "Otro",
        lateralidad: datos.lateralidad || "",
        rol: rolDetectado,
        cirujano: datos.cirujano || "",
        ayudantes: datos.ayudantes || "",
        anestesia: datos.anestesia || "",
        hora_inicio: datos.hora_inicio || "",
        hora_termino: datos.hora_termino || "",
        duracion_min: datos.duracion_min != null ? String(datos.duracion_min) : "",
        sangrado_ml: datos.sangrado_ml != null ? String(datos.sangrado_ml) : "",
        hallazgos: datos.hallazgos || "",
        tecnica: datos.tecnica || "",
        complicacion: !!datos.complicacion,
        detalles_complicacion: datos.detalles_complicacion || "",
        observaciones: datos.observaciones || "",
      }));
      setExtraidoOk(true);
    } catch (err) {
      setError("No se pudo extraer el protocolo automáticamente. Puedes ingresar los datos a mano. (" + (err.message || "error") + ")");
    }
    setExtrayendo(false);
    if (inputFotoRef.current) inputFotoRef.current.value = "";
  };

  // ─── Duración automática si hay horas y no hay duración ───
  useEffect(() => {
    if (reg.hora_inicio && reg.hora_termino && !reg.duracion_min) {
      const [h1, m1] = reg.hora_inicio.split(":").map(Number);
      const [h2, m2] = reg.hora_termino.split(":").map(Number);
      let d = h2 * 60 + m2 - (h1 * 60 + m1);
      if (d < 0) d += 24 * 60; // cruzó medianoche
      if (d > 0 && d < 24 * 60) set("duracion_min", String(d));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reg.hora_inicio, reg.hora_termino]);

  // ─── Guardar ───
  const guardar = async () => {
    setError("");
    if (!reg.procedimiento.trim()) return setError("Ingresa el procedimiento");
    if (!reg.fecha) return setError("Ingresa la fecha");
    setGuardando(true);

    let foto_path = null;
    if (fotos.length > 0 && !editId) {
      const up = await subirFotoLogbook(currentUser.id, fotos[0].blob);
      if (up.ok) foto_path = up.path; // si falla el bucket, se guarda igual sin foto
    }

    const datos = {
      fecha: reg.fecha,
      iniciales: reg.iniciales.trim().toUpperCase() || null,
      edad: reg.edad ? parseInt(reg.edad) : null,
      sexo: reg.sexo || null,
      diagnostico_pre: reg.diagnostico_pre.trim() || null,
      diagnostico_post: reg.diagnostico_post.trim() || null,
      procedimiento: reg.procedimiento.trim(),
      categoria: reg.categoria || "Otro",
      lateralidad: reg.lateralidad || null,
      rol: reg.rol,
      cirujano: reg.cirujano.trim() || null,
      ayudantes: reg.ayudantes.trim() || null,
      anestesia: reg.anestesia.trim() || null,
      hora_inicio: reg.hora_inicio || null,
      hora_termino: reg.hora_termino || null,
      duracion_min: reg.duracion_min ? parseInt(reg.duracion_min) : null,
      sangrado_ml: reg.sangrado_ml ? parseInt(reg.sangrado_ml) : null,
      hallazgos: reg.hallazgos.trim() || null,
      tecnica: reg.tecnica.trim() || null,
      complicacion: !!reg.complicacion,
      clavien: reg.complicacion ? (reg.clavien || null) : null,
      detalles_complicacion: reg.complicacion ? (reg.detalles_complicacion.trim() || null) : null,
      observaciones: reg.observaciones.trim() || null,
      extraido_ia: extraidoOk,
    };

    let result;
    if (editId) {
      result = await actualizarRegistroLogbook(editId, datos);
      if (result.ok) setRegistros((prev) => prev.map((r) => (r.id === editId ? result.registro : r)));
    } else {
      result = await crearRegistroLogbook({ ...datos, user_id: currentUser.id, foto_path });
      if (result.ok) setRegistros((prev) => [result.registro, ...prev].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "")));
    }
    setGuardando(false);
    if (!result.ok) return setError(result.error);
    resetForm();
    setVista("lista");
  };

  const resetForm = () => {
    setReg({ ...REGISTRO_VACIO });
    setFotos([]);
    setEditId(null);
    setExtraidoOk(false);
    setError("");
  };

  const empezarEdicion = (r) => {
    setEditId(r.id);
    setFotos([]);
    setExtraidoOk(false);
    setReg({
      fecha: r.fecha || new Date().toISOString().slice(0, 10),
      iniciales: r.iniciales || "", edad: r.edad != null ? String(r.edad) : "", sexo: r.sexo || "",
      diagnostico_pre: r.diagnostico_pre || "", diagnostico_post: r.diagnostico_post || "",
      procedimiento: r.procedimiento || "", categoria: r.categoria || "Otro", lateralidad: r.lateralidad || "",
      rol: r.rol || "cirujano", cirujano: r.cirujano || "", ayudantes: r.ayudantes || "",
      anestesia: r.anestesia || "", hora_inicio: (r.hora_inicio || "").slice(0, 5), hora_termino: (r.hora_termino || "").slice(0, 5),
      duracion_min: r.duracion_min != null ? String(r.duracion_min) : "", sangrado_ml: r.sangrado_ml != null ? String(r.sangrado_ml) : "",
      hallazgos: r.hallazgos || "", tecnica: r.tecnica || "",
      complicacion: !!r.complicacion, clavien: r.clavien || "", detalles_complicacion: r.detalles_complicacion || "",
      observaciones: r.observaciones || "",
    });
    setError("");
    setVista("nueva");
  };

  const eliminar = async (r) => {
    if (!confirm(`¿Eliminar "${r.procedimiento}" del ${r.fecha}?\n\nNo podrás recuperarlo.`)) return;
    const result = await eliminarRegistroLogbook(r.id);
    if (!result.ok) return alert("Error: " + result.error);
    if (r.foto_path) eliminarFotoLogbook(r.foto_path);
    setRegistros((prev) => prev.filter((x) => x.id !== r.id));
  };

  const verFoto = async (path) => {
    const r = await obtenerUrlFoto(path);
    if (r.ok) setFotoUrl(r.url);
    else alert("No se pudo cargar la foto: " + r.error);
  };

  // ─── Exportar CSV ───
  const exportarCSV = () => {
    const cols = ["fecha", "iniciales", "edad", "sexo", "procedimiento", "categoria", "lateralidad", "rol", "cirujano", "ayudantes", "diagnostico_pre", "diagnostico_post", "anestesia", "duracion_min", "sangrado_ml", "complicacion", "clavien", "hallazgos", "observaciones"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const filas = [cols.join(";"), ...registros.map((r) => cols.map((c) => esc(c === "complicacion" ? (r[c] ? "Sí" : "No") : r[c])).join(";"))];
    const blob = new Blob(["\uFEFF" + filas.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `logbook_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ─── Lista filtrada ───
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return registros.filter((r) => {
      if (filtroCat !== "Todas" && r.categoria !== filtroCat) return false;
      if (filtroRol !== "todos" && r.rol !== filtroRol) return false;
      if (q && !`${r.procedimiento} ${r.diagnostico_pre} ${r.diagnostico_post} ${r.iniciales} ${r.hallazgos}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [registros, busqueda, filtroCat, filtroRol]);

  // ─── Métricas ───
  const met = useMemo(() => {
    const total = registros.length;
    const comoCirujano = registros.filter((r) => r.rol === "cirujano").length;
    const conComplicacion = registros.filter((r) => r.complicacion).length;
    const clavienAlto = registros.filter((r) => r.complicacion && ["IIIb", "IVa", "IVb", "V"].includes(r.clavien)).length;
    const duraciones = registros.filter((r) => r.duracion_min > 0);
    const durProm = duraciones.length ? Math.round(duraciones.reduce((s, r) => s + r.duracion_min, 0) / duraciones.length) : null;

    const porCat = {};
    const porProc = {};
    registros.forEach((r) => {
      porCat[r.categoria || "Otro"] = (porCat[r.categoria || "Otro"] || 0) + 1;
      const p = r.procedimiento || "—";
      if (!porProc[p]) porProc[p] = { n: 0, cx: 0, dur: [], compl: 0 };
      porProc[p].n++;
      if (r.rol === "cirujano") porProc[p].cx++;
      if (r.duracion_min > 0) porProc[p].dur.push(r.duracion_min);
      if (r.complicacion) porProc[p].compl++;
    });

    const meses = ultimosMeses(12).map((mes) => ({
      mes,
      total: registros.filter((r) => mesClave(r.fecha) === mes).length,
      cirujano: registros.filter((r) => mesClave(r.fecha) === mes && r.rol === "cirujano").length,
    }));

    const topProc = Object.entries(porProc)
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 8)
      .map(([label, v]) => ({
        label, n: v.n,
        extra: v.dur.length ? `${Math.round(v.dur.reduce((s, d) => s + d, 0) / v.dur.length)} min prom` : null,
      }));

    const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, n }));

    return { total, comoCirujano, conComplicacion, clavienAlto, durProm, meses, topProc, cats };
  }, [registros]);

  // ─── Estilos compartidos ───
  const inp = { width: "100%", padding: "8px 10px", fontSize: 13, border: "0.5px solid var(--borde)", borderRadius: 8, background: "var(--superficie)", color: "var(--texto)", boxSizing: "border-box", outline: "none" };
  const lbl = { fontSize: 11, fontWeight: 600, color: "var(--texto-sec)", marginBottom: 3, display: "block" };
  const btnPrim = { padding: "10px 18px", fontSize: 14, fontWeight: 600, background: "var(--primario)", color: "var(--texto-inv)", border: "none", borderRadius: 8, cursor: "pointer" };
  const btnSec = { padding: "10px 14px", fontSize: 13, background: "var(--superficie)", color: "var(--primario)", border: "0.5px solid var(--borde)", borderRadius: 8, cursor: "pointer" };
  const card = { border: "0.5px solid var(--borde)", borderRadius: 12, padding: "12px 14px", background: "var(--superficie)" };
  const kpi = { ...card, flex: "1 1 130px", textAlign: "center" };
  const campo = (etiqueta, hijo) => (<div><label style={lbl}>{etiqueta}</label>{hijo}</div>);
  const rolLabel = (r) => (ROLES.find(([id]) => id === r) || [r, r])[1];

  if (!currentUser) return null;

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", width: "100%", boxSizing: "border-box" }}>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "14px 12px 40px" }}>
      {/* ─── Encabezado + sub-pestañas ─── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 19, color: "var(--texto)" }}>📓 Logbook quirúrgico</h2>
        <div style={{ display: "flex", gap: 6 }}>
          {[["lista", "📋 Registros"], ["nueva", "📷 Nueva"], ["metricas", "📊 Métricas"]].map(([id, label]) => (
            <button key={id} onClick={() => { if (id === "nueva" && vista !== "nueva") resetForm(); setVista(id); }}
              style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600, borderRadius: 20, cursor: "pointer", border: "0.5px solid var(--borde)", background: vista === id ? "var(--primario)" : "var(--superficie)", color: vista === id ? "var(--texto-inv)" : "var(--primario)" }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <div style={{ padding: "9px 12px", marginBottom: 10, fontSize: 13, background: "var(--peligro-bg)", border: "1px solid var(--peligro)", borderRadius: 8, color: "var(--peligro)" }}>{error}</div>}

      {/* ============ VISTA: NUEVA / EDITAR ============ */}
      {vista === "nueva" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Captura */}
          {!editId && (
            <div style={{ ...card, textAlign: "center", borderStyle: "dashed", borderWidth: 1.5, padding: "18px 14px" }}>
              <input ref={inputFotoRef} type="file" accept="image/*" capture="environment" multiple style={{ display: "none" }} onChange={onFotos} />
              {extrayendo ? (
                <div style={{ fontSize: 14, color: "var(--texto-sec)" }}>
                  <div style={{ fontSize: 26, marginBottom: 6 }}>🔍</div>
                  Leyendo el protocolo operatorio…
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 30, marginBottom: 6 }}>📷</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--texto)", marginBottom: 4 }}>Fotografía el protocolo operatorio</div>
                  <div style={{ fontSize: 12, color: "var(--texto-ter)", marginBottom: 10 }}>La IA extrae los datos automáticamente. Puedes tomar hasta 3 fotos si el protocolo tiene varias páginas.</div>
                  <button onClick={() => inputFotoRef.current?.click()} style={btnPrim}>Tomar / subir foto</button>
                  {fotos.length > 0 && (
                    <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 12 }}>
                      {fotos.map((f, i) => <img key={i} src={f.dataUrl} alt={`página ${i + 1}`} style={{ height: 70, borderRadius: 6, border: "0.5px solid var(--borde)" }} />)}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {extraidoOk && (
            <div style={{ padding: "9px 12px", fontSize: 13, background: "var(--exito-bg)", border: "1px solid var(--exito)", borderRadius: 8, color: "var(--exito)" }}>
              ✓ Datos extraídos del protocolo. Revísalos y corrige lo que falte antes de guardar.
            </div>
          )}

          {/* Formulario */}
          <div style={{ ...card, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            {campo("Fecha *", <input type="date" style={inp} value={reg.fecha} onChange={(e) => set("fecha", e.target.value)} />)}
            {campo("Iniciales paciente", <input style={inp} value={reg.iniciales} onChange={(e) => set("iniciales", e.target.value.toUpperCase())} placeholder="JPG" maxLength={5} />)}
            {campo("Edad", <input type="number" style={inp} value={reg.edad} onChange={(e) => set("edad", e.target.value)} />)}
            {campo("Sexo", (
              <select style={inp} value={reg.sexo} onChange={(e) => set("sexo", e.target.value)}>
                <option value="">—</option><option value="M">Masculino</option><option value="F">Femenino</option>
              </select>
            ))}
            <div style={{ gridColumn: "1 / -1" }}>{campo("Procedimiento *", <input style={inp} value={reg.procedimiento} onChange={(e) => set("procedimiento", e.target.value)} placeholder="Ej: Ureterolitectomía endoscópica láser" />)}</div>
            {campo("Categoría", (
              <select style={inp} value={reg.categoria} onChange={(e) => set("categoria", e.target.value)}>
                <option value="">—</option>
                {CATEGORIAS_LOGBOOK.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            ))}
            {campo("Lateralidad", (
              <select style={inp} value={reg.lateralidad} onChange={(e) => set("lateralidad", e.target.value)}>
                <option value="">—</option><option>Derecha</option><option>Izquierda</option><option>Bilateral</option>
              </select>
            ))}
            {campo("Mi rol *", (
              <select style={inp} value={reg.rol} onChange={(e) => set("rol", e.target.value)}>
                {ROLES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            ))}
            {campo("Cirujano", <input style={inp} value={reg.cirujano} onChange={(e) => set("cirujano", e.target.value)} />)}
            {campo("Ayudante(s)", <input style={inp} value={reg.ayudantes} onChange={(e) => set("ayudantes", e.target.value)} />)}
            {campo("Anestesia", <input style={inp} value={reg.anestesia} onChange={(e) => set("anestesia", e.target.value)} placeholder="General / Raquídea…" />)}
            {campo("Hora inicio", <input type="time" style={inp} value={reg.hora_inicio} onChange={(e) => set("hora_inicio", e.target.value)} />)}
            {campo("Hora término", <input type="time" style={inp} value={reg.hora_termino} onChange={(e) => set("hora_termino", e.target.value)} />)}
            {campo("Duración (min)", <input type="number" style={inp} value={reg.duracion_min} onChange={(e) => set("duracion_min", e.target.value)} />)}
            {campo("Sangrado (ml)", <input type="number" style={inp} value={reg.sangrado_ml} onChange={(e) => set("sangrado_ml", e.target.value)} />)}
            <div style={{ gridColumn: "1 / -1" }}>{campo("Diagnóstico preoperatorio", <input style={inp} value={reg.diagnostico_pre} onChange={(e) => set("diagnostico_pre", e.target.value)} />)}</div>
            <div style={{ gridColumn: "1 / -1" }}>{campo("Diagnóstico postoperatorio", <input style={inp} value={reg.diagnostico_post} onChange={(e) => set("diagnostico_post", e.target.value)} />)}</div>
            <div style={{ gridColumn: "1 / -1" }}>{campo("Hallazgos", <textarea rows={2} style={{ ...inp, resize: "vertical" }} value={reg.hallazgos} onChange={(e) => set("hallazgos", e.target.value)} />)}</div>
            <div style={{ gridColumn: "1 / -1" }}>{campo("Técnica (resumen)", <textarea rows={2} style={{ ...inp, resize: "vertical" }} value={reg.tecnica} onChange={(e) => set("tecnica", e.target.value)} />)}</div>

            {/* Complicación */}
            <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--texto)", cursor: "pointer" }}>
                <input type="checkbox" checked={reg.complicacion} onChange={(e) => set("complicacion", e.target.checked)} />
                Hubo complicación
              </label>
              {reg.complicacion && (
                <select style={{ ...inp, width: "auto" }} value={reg.clavien} onChange={(e) => set("clavien", e.target.value)}>
                  {CLAVIEN.map((c) => <option key={c} value={c}>{c ? `Clavien-Dindo ${c}` : "Clavien-Dindo…"}</option>)}
                </select>
              )}
            </div>
            {reg.complicacion && (
              <div style={{ gridColumn: "1 / -1" }}>{campo("Detalle de la complicación", <textarea rows={2} style={{ ...inp, resize: "vertical" }} value={reg.detalles_complicacion} onChange={(e) => set("detalles_complicacion", e.target.value)} />)}</div>
            )}
            <div style={{ gridColumn: "1 / -1" }}>{campo("Observaciones (JJ, sonda, drenajes, biopsias…)", <textarea rows={2} style={{ ...inp, resize: "vertical" }} value={reg.observaciones} onChange={(e) => set("observaciones", e.target.value)} />)}</div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={guardar} disabled={guardando || extrayendo} style={{ ...btnPrim, opacity: guardando ? 0.6 : 1 }}>
              {guardando ? "Guardando…" : editId ? "Guardar cambios" : "Guardar en mi logbook"}
            </button>
            <button onClick={() => { resetForm(); setVista("lista"); }} style={btnSec}>Cancelar</button>
          </div>
        </div>
      )}

      {/* ============ VISTA: LISTA ============ */}
      {vista === "lista" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input style={{ ...inp, flex: "2 1 180px" }} placeholder="🔎 Buscar procedimiento, diagnóstico…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            <select style={{ ...inp, flex: "1 1 130px" }} value={filtroCat} onChange={(e) => setFiltroCat(e.target.value)}>
              <option>Todas</option>
              {CATEGORIAS_LOGBOOK.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select style={{ ...inp, flex: "1 1 130px" }} value={filtroRol} onChange={(e) => setFiltroRol(e.target.value)}>
              <option value="todos">Todos los roles</option>
              {ROLES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            {registros.length > 0 && <button onClick={exportarCSV} style={btnSec}>⬇ CSV</button>}
          </div>

          {cargando && <div style={{ fontSize: 13, color: "var(--texto-sec)", textAlign: "center", padding: 20 }}>Cargando registros…</div>}

          {!cargando && filtrados.length === 0 && (
            <div style={{ ...card, textAlign: "center", padding: "26px 14px" }}>
              <div style={{ fontSize: 30, marginBottom: 6 }}>📓</div>
              <div style={{ fontSize: 14, color: "var(--texto-sec)" }}>{registros.length === 0 ? "Tu logbook está vacío. Fotografía tu primer protocolo en 📷 Nueva." : "Ningún registro coincide con el filtro."}</div>
            </div>
          )}

          {filtrados.map((r) => (
            <div key={r.id} style={{ ...card, cursor: "pointer" }} onClick={() => setAbierto(abierto === r.id ? null : r.id)}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--texto)" }}>
                    {r.procedimiento}{r.lateralidad ? ` (${r.lateralidad.toLowerCase()})` : ""}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--texto-sec)", marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span>📅 {r.fecha}</span>
                    {r.iniciales && <span>👤 {r.iniciales}{r.edad != null ? `, ${r.edad}a` : ""}</span>}
                    {r.duracion_min != null && <span>⏱ {r.duracion_min} min</span>}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: r.rol === "cirujano" ? "var(--exito-bg)" : "var(--fondo-suave)", color: r.rol === "cirujano" ? "var(--exito)" : "var(--texto-sec)", border: "0.5px solid var(--borde)" }}>
                    {rolLabel(r.rol)}
                  </span>
                  {r.complicacion && (
                    <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: "var(--peligro-bg)", color: "var(--peligro)", border: "0.5px solid var(--peligro)" }}>
                      ⚠ {r.clavien ? `CD ${r.clavien}` : "Complicación"}
                    </span>
                  )}
                </div>
              </div>

              {abierto === r.id && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "0.5px solid var(--borde)", fontSize: 12.5, color: "var(--texto)", display: "flex", flexDirection: "column", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                  {r.categoria && <div><b>Categoría:</b> {r.categoria}</div>}
                  {r.diagnostico_pre && <div><b>Dg. preop:</b> {r.diagnostico_pre}</div>}
                  {r.diagnostico_post && <div><b>Dg. postop:</b> {r.diagnostico_post}</div>}
                  {(r.cirujano || r.ayudantes) && <div><b>Equipo:</b> {r.cirujano}{r.ayudantes ? ` · Ayudantes: ${r.ayudantes}` : ""}</div>}
                  {r.anestesia && <div><b>Anestesia:</b> {r.anestesia}</div>}
                  {(r.hora_inicio || r.sangrado_ml != null) && <div>{r.hora_inicio && <><b>Horario:</b> {(r.hora_inicio || "").slice(0, 5)}–{(r.hora_termino || "").slice(0, 5)}  </>}{r.sangrado_ml != null && <><b>Sangrado:</b> {r.sangrado_ml} ml</>}</div>}
                  {r.hallazgos && <div><b>Hallazgos:</b> {r.hallazgos}</div>}
                  {r.tecnica && <div><b>Técnica:</b> {r.tecnica}</div>}
                  {r.detalles_complicacion && <div style={{ color: "var(--peligro)" }}><b>Complicación:</b> {r.detalles_complicacion}</div>}
                  {r.observaciones && <div><b>Obs:</b> {r.observaciones}</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    {r.foto_path && <button onClick={() => verFoto(r.foto_path)} style={{ ...btnSec, padding: "6px 12px", fontSize: 12 }}>🖼 Ver protocolo</button>}
                    <button onClick={() => empezarEdicion(r)} style={{ ...btnSec, padding: "6px 12px", fontSize: 12 }}>✏️ Editar</button>
                    <button onClick={() => eliminar(r)} style={{ ...btnSec, padding: "6px 12px", fontSize: 12, color: "var(--peligro)" }}>🗑 Eliminar</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ============ VISTA: MÉTRICAS ============ */}
      {vista === "metricas" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={kpi}>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--primario)" }}>{met.total}</div>
              <div style={{ fontSize: 11, color: "var(--texto-sec)" }}>Cirugías registradas</div>
            </div>
            <div style={kpi}>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--exito)" }}>{met.comoCirujano}</div>
              <div style={{ fontSize: 11, color: "var(--texto-sec)" }}>Como cirujano principal{met.total > 0 ? ` (${Math.round((met.comoCirujano / met.total) * 100)}%)` : ""}</div>
            </div>
            <div style={kpi}>
              <div style={{ fontSize: 24, fontWeight: 700, color: met.conComplicacion > 0 ? "var(--alerta)" : "var(--exito)" }}>
                {met.total > 0 ? `${((met.conComplicacion / met.total) * 100).toFixed(1)}%` : "—"}
              </div>
              <div style={{ fontSize: 11, color: "var(--texto-sec)" }}>Complicaciones ({met.conComplicacion}){met.clavienAlto > 0 ? ` · ${met.clavienAlto} CD≥IIIb` : ""}</div>
            </div>
            <div style={kpi}>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--primario)" }}>{met.durProm != null ? `${met.durProm}′` : "—"}</div>
              <div style={{ fontSize: 11, color: "var(--texto-sec)" }}>Duración promedio</div>
            </div>
          </div>

          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--texto)", marginBottom: 8 }}>
              Volumen mensual (últimos 12 meses)
              <span style={{ fontSize: 11, fontWeight: 400, color: "var(--texto-ter)", marginLeft: 8 }}>■ como cirujano · <span style={{ opacity: 0.4 }}>■</span> total</span>
            </div>
            <BarrasMensuales datos={met.meses} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--texto)", marginBottom: 10 }}>Procedimientos más frecuentes</div>
              <BarrasHorizontales items={met.topProc} />
            </div>
            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--texto)", marginBottom: 10 }}>Por categoría</div>
              <BarrasHorizontales items={met.cats} color="var(--exito)" />
            </div>
          </div>

          {registros.length > 0 && (
            <button onClick={exportarCSV} style={{ ...btnSec, alignSelf: "flex-start" }}>⬇ Exportar todo a CSV (para tu casuística)</button>
          )}
        </div>
      )}

      {/* ─── Visor de foto ─── */}
      {fotoUrl && (
        <div onClick={() => setFotoUrl(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, cursor: "zoom-out" }}>
          <img src={fotoUrl} alt="Protocolo operatorio" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 8 }} />
        </div>
      )}
      </div>
    </div>
  );
}

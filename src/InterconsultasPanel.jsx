// ============================================================
// INTERCONSULTAS — UroSearch
// Archivo de las interconsultas realizadas: se fotografían (o se suben desde
// la galería), la IA lee el contenido y lo estructura, y con eso se calculan
// métricas (servicio solicitante, motivo, prioridad, resolución).
// ============================================================
import React, { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "./supabase";

const VACIA = {
  fecha: new Date().toISOString().slice(0, 10),
  paciente: "", ficha_clinica: "", rut: "", edad: "", sexo: "",
  servicio_solicitante: "", medico_solicitante: "",
  cama: "", servicio: "",
  motivo: "", diagnostico: "", resumen: "",
  prioridad: "normal",           // urgente | normal | electiva
  estado: "pendiente",           // pendiente | resuelta
  conducta: "", texto_extraido: "",
};

const PRIORIDADES = [["urgente", "🔴 Urgente"], ["normal", "🟡 Normal"], ["electiva", "🟢 Electiva"]];
const MOTIVOS_FRECUENTES = [
  "Retención urinaria", "Hematuria", "Sonda / cambio de sonda", "Cólico renal",
  "Litiasis", "ITU complicada", "Uropatía obstructiva", "Falla renal",
  "Masa renal", "Alteración del PSA", "Trauma urológico", "Otro",
];


// ─── Lectura tolerante del JSON que devuelve la IA ───
// Si la respuesta se corta (por límite de tokens), el JSON queda incompleto.
// En vez de fallar, se intenta cerrar lo que quedó abierto y rescatar los campos.
function parseJSONTolerante(texto) {
  let t = (texto || "").replace(/```json|```/g, "").trim();
  // Recorta lo que haya antes del primer { y después del último } si existe
  const ini = t.indexOf("{");
  if (ini > 0) t = t.slice(ini);
  try { return JSON.parse(t); } catch {}

  // Intento de reparación: cerrar comillas y llaves pendientes
  let reparado = t;
  const comillas = (reparado.match(/(?<!\\)"/g) || []).length;
  if (comillas % 2 !== 0) reparado += '"';
  const abiertas = (reparado.match(/\{/g) || []).length;
  const cerradas = (reparado.match(/\}/g) || []).length;
  reparado += "}".repeat(Math.max(0, abiertas - cerradas));
  // Quita una coma colgante antes del cierre
  reparado = reparado.replace(/,(\s*[}\]])/g, "$1");
  try { return JSON.parse(reparado); } catch {}

  // Último recurso: extraer los pares "clave": "valor" que sí estén completos
  const obj = {};
  const re = /"(\w+)"\s*:\s*(?:"((?:[^"\\]|\\.)*)"|(-?\d+(?:\.\d+)?)|null|true|false)/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    obj[m[1]] = m[2] !== undefined ? m[2].replace(/\\"/g, '"').replace(/\\n/g, "\n") : (m[3] !== undefined ? Number(m[3]) : null);
  }
  if (Object.keys(obj).length === 0) throw new Error("La respuesta no se pudo interpretar.");
  return obj;
}

// ─── Lectura del documento con IA (misma edge function del chat) ───
async function extraerInterconsulta(imagenesBase64) {
  const instrucciones = `Analiza la(s) foto(s) de esta interconsulta médica dirigida a Urología y extrae los datos en JSON.
Responde SOLO con un objeto JSON válido, sin markdown, sin backticks, sin texto adicional.
Si un dato no aparece, usa null. NO inventes datos.

Esquema exacto:
{
  "fecha": "AAAA-MM-DD o null",
  "paciente": "nombre completo del paciente tal como aparece o null",
  "ficha_clinica": "número de ficha clínica / FC o null",
  "rut": "RUT del paciente (formato 12.345.678-9) o null",
  "edad": numero o null,
  "sexo": "M" | "F" | null,
  "servicio_solicitante": "servicio o unidad que solicita (ej: 'Medicina Interna', 'Urgencia', 'UCI', 'Cirugía') o null",
  "servicio": "servicio/unidad donde está hospitalizado el paciente (ej: 'Medicina 3er piso', 'UCI', 'Urgencia') o null",
  "cama": "número o identificador de cama/box del paciente o null",
  "medico_solicitante": "nombre del médico que solicita o null",
  "motivo": "motivo de la interconsulta, en pocas palabras (ej: 'Retención urinaria aguda') o null",
  "diagnostico": "diagnóstico o hipótesis diagnóstica del solicitante o null",
  "resumen": "resumen clínico del cuadro en 1-3 frases, con lo relevante para urología o null",
  "prioridad": "urgente" | "normal" | "electiva" | null,
  "conducta": "conducta, respuesta o sugerencia de urología si aparece escrita o null",
  "texto_extraido": "resumen del texto legible del documento, MÁXIMO 600 caracteres (no transcribas el documento completo)"
}

Reglas:
- "prioridad": usa "urgente" si dice urgente/prioritario o el cuadro lo es (retención, sepsis, anuria); "electiva" si es una derivación ambulatoria; si no, "normal".
- Transcribe los datos tal cual aparecen; no inventes ni completes lo que no esté.`;

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
      max_tokens: 3000,
      system: "Eres un extractor de datos de interconsultas médicas dirigidas a urología. Respondes exclusivamente con JSON válido.",
      messages: [{ role: "user", content }],
    }),
  });
  const data = await res.json();
  const txt = data.content?.find((b) => b.type === "text")?.text || "";
  return parseJSONTolerante(txt);
}

const comprimir = (file, maxLado = 1500, calidad = 0.75) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * escala);
      c.height = Math.round(img.height * escala);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", calidad));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No se pudo leer la imagen")); };
    img.src = url;
  });

export default function InterconsultasPanel({ currentUser, contexto = "personal" }) {
  const [lista, setLista] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [vista, setVista] = useState("lista"); // lista | nueva | metricas
  const [error, setError] = useState("");
  const [ic, setIc] = useState(VACIA);
  const [editId, setEditId] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [extrayendo, setExtrayendo] = useState(false);
  const [fotos, setFotos] = useState([]);
  const [abiertoId, setAbiertoId] = useState(null);
  const [filtro, setFiltro] = useState("todas"); // todas | pendiente | resuelta
  const [fechaDesde, setFechaDesde] = useState(""); // filtro por fecha (rango, opcional)
  const [fechaHasta, setFechaHasta] = useState("");
  const [mostrarCaptura, setMostrarCaptura] = useState(false); // despliegue del bloque "Agregar interconsulta"
  const inputGaleriaRef = useRef(null);
  const inputCamaraRef = useRef(null);

  const esEquipo = contexto && contexto !== "personal";
  const set = (k, v) => setIc((p) => ({ ...p, [k]: v }));

  // ─── Carga ───
  const cargar = async () => {
    setCargando(true);
    try {
      let q = supabase.from("interconsultas").select("*").order("fecha", { ascending: false });
      q = esEquipo ? q.eq("equipo_id", contexto) : q.eq("user_id", currentUser.id).is("equipo_id", null);
      const { data, error } = await q;
      if (error) throw error;
      setLista(data || []);
    } catch (e) { setError(e.message || String(e)); }
    setCargando(false);
  };
  useEffect(() => { if (currentUser) cargar(); /* eslint-disable-next-line */ }, [currentUser, contexto]);

  // Acciones desde el submenú de Hospital
  useEffect(() => {
    const h = (e) => {
      if (e.detail?.tab !== "hospital") return;
      if (e.detail.accion === "ic-nueva") { resetForm(); setVista("nueva"); }
      if (e.detail.accion === "ic-metricas") setVista("metricas");
    };
    window.addEventListener("uro-submenu-accion", h);
    return () => window.removeEventListener("uro-submenu-accion", h);
    // eslint-disable-next-line
  }, []);

  const resetForm = () => { setIc(VACIA); setEditId(null); setFotos([]); setError(""); setMostrarCaptura(false); };

  // ─── Foto → IA ───
  const onFotos = async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 3);
    if (files.length === 0) return;
    setExtrayendo(true); setError("");
    try {
      const comprimidas = [];
      for (const f of files) comprimidas.push(await comprimir(f));
      setFotos(comprimidas.map((d) => ({ dataUrl: d })));
      const b64s = comprimidas.map((d) => d.split(",")[1]);
      const x = await extraerInterconsulta(b64s);
      setIc((prev) => ({
        ...prev,
        fecha: x.fecha || prev.fecha,
        paciente: x.paciente ? String(x.paciente).slice(0, 120) : prev.paciente,
        ficha_clinica: x.ficha_clinica ? String(x.ficha_clinica).slice(0, 30) : prev.ficha_clinica,
        rut: x.rut ? String(x.rut).slice(0, 15) : prev.rut,
        edad: (x.edad ?? "") !== "" ? String(x.edad) : prev.edad,
        sexo: x.sexo || prev.sexo,
        servicio_solicitante: x.servicio_solicitante || prev.servicio_solicitante,
        cama: x.cama ? String(x.cama).slice(0, 20) : prev.cama,
        servicio: x.servicio ? String(x.servicio).slice(0, 60) : prev.servicio,
        medico_solicitante: x.medico_solicitante || prev.medico_solicitante,
        motivo: x.motivo || prev.motivo,
        diagnostico: x.diagnostico || prev.diagnostico,
        resumen: x.resumen || prev.resumen,
        prioridad: x.prioridad || prev.prioridad,
        conducta: x.conducta || prev.conducta,
        texto_extraido: x.texto_extraido || prev.texto_extraido,
      }));
      setVista("nueva");
    } catch (err) {
      setError("No se pudo leer la interconsulta. Prueba con una foto más nítida o de una sola página, o llénala a mano. (" + (err.message || err) + ")");
      setVista("nueva");
    }
    setExtrayendo(false);
    if (inputGaleriaRef.current) inputGaleriaRef.current.value = "";
    if (inputCamaraRef.current) inputCamaraRef.current.value = "";
  };

  // ─── Guardar ───
  const guardar = async () => {
    if (!ic.motivo.trim() && !ic.diagnostico.trim()) { setError("Indica al menos el motivo o el diagnóstico."); return; }
    setGuardando(true); setError("");
    const payload = {
      user_id: currentUser.id,
      equipo_id: esEquipo ? contexto : null,
      fecha: ic.fecha,
      paciente: ic.paciente.trim() || null,
      ficha_clinica: ic.ficha_clinica.trim() || null,
      rut: ic.rut.trim() || null,
      edad: ic.edad ? parseInt(ic.edad) : null,
      sexo: ic.sexo || null,
      servicio_solicitante: ic.servicio_solicitante.trim() || null,
      medico_solicitante: ic.medico_solicitante.trim() || null,
      cama: ic.cama.trim() || null,
      servicio: ic.servicio.trim() || null,
      motivo: ic.motivo.trim() || null,
      diagnostico: ic.diagnostico.trim() || null,
      resumen: ic.resumen.trim() || null,
      prioridad: ic.prioridad || "normal",
      estado: ic.estado || "pendiente",
      conducta: ic.conducta.trim() || null,
      texto_extraido: ic.texto_extraido.trim() || null,
    };
    // Guarda tolerando que la tabla aún no tenga las columnas cama/servicio:
    // si Postgres/PostgREST se queja de esas columnas, reintenta sin ellas.
    const opGuardar = (p) => editId
      ? supabase.from("interconsultas").update(p).eq("id", editId)
      : supabase.from("interconsultas").insert(p);
    try {
      let { error } = await opGuardar(payload);
      if (error && /(cama|servicio)/i.test(error.message || "") && /(column|find|schema)/i.test(error.message || "")) {
        const { cama, servicio, ...resto } = payload;
        ({ error } = await opGuardar(resto));
      }
      if (error) throw error;
      resetForm();
      setVista("lista");
      await cargar();
    } catch (e) { setError("No se pudo guardar: " + (e.message || e)); }
    setGuardando(false);
  };

  const editar = (r) => {
    setEditId(r.id);
    setIc({
      fecha: r.fecha || VACIA.fecha,
      paciente: r.paciente || "", ficha_clinica: r.ficha_clinica || "", rut: r.rut || "",
      edad: r.edad != null ? String(r.edad) : "", sexo: r.sexo || "",
      servicio_solicitante: r.servicio_solicitante || "", medico_solicitante: r.medico_solicitante || "",
      cama: r.cama || "", servicio: r.servicio || "",
      motivo: r.motivo || "", diagnostico: r.diagnostico || "", resumen: r.resumen || "",
      prioridad: r.prioridad || "normal", estado: r.estado || "pendiente",
      conducta: r.conducta || "", texto_extraido: r.texto_extraido || "",
    });
    setFotos([]);
    setVista("nueva");
  };

  const eliminar = async (id) => {
    if (!confirm("¿Eliminar esta interconsulta?")) return;
    try {
      const { error } = await supabase.from("interconsultas").delete().eq("id", id);
      if (error) throw error;
      await cargar();
    } catch (e) { setError("No se pudo eliminar: " + (e.message || e)); }
  };

  const alternarEstado = async (r) => {
    const nuevo = r.estado === "resuelta" ? "pendiente" : "resuelta";
    try {
      await supabase.from("interconsultas").update({ estado: nuevo }).eq("id", r.id);
      setLista((prev) => prev.map((x) => (x.id === r.id ? { ...x, estado: nuevo } : x)));
    } catch (e) { setError("No se pudo actualizar: " + (e.message || e)); }
  };

  // ─── Métricas ───
  const met = useMemo(() => {
    const total = lista.length;
    const resueltas = lista.filter((r) => r.estado === "resuelta").length;
    const agrupar = (campo) => {
      const m = {};
      lista.forEach((r) => { const k = (r[campo] || "Sin registrar").trim(); m[k] = (m[k] || 0) + 1; });
      return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, n }));
    };
    const porMes = {};
    lista.forEach((r) => { const k = (r.fecha || "").slice(0, 7); if (k) porMes[k] = (porMes[k] || 0) + 1; });
    const meses = Object.entries(porMes).sort((a, b) => a[0].localeCompare(b[0])).slice(-12).map(([mes, n]) => ({ mes, n }));
    const edades = lista.filter((r) => r.edad > 0).map((r) => r.edad);
    return {
      total, resueltas, pendientes: total - resueltas,
      servicios: agrupar("servicio_solicitante"),
      motivos: agrupar("motivo"),
      diagnosticos: agrupar("diagnostico"),
      prioridades: agrupar("prioridad"),
      meses,
      edadProm: edades.length ? Math.round(edades.reduce((s, e) => s + e, 0) / edades.length) : null,
    };
  }, [lista]);

  const exportarCSV = () => {
    const cols = ["fecha", "paciente", "ficha_clinica", "rut", "edad", "sexo", "servicio", "cama", "servicio_solicitante", "medico_solicitante", "motivo", "diagnostico", "prioridad", "estado", "conducta", "resumen"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const filas = [cols.join(";"), ...lista.map((r) => cols.map((c) => esc(r[c])).join(";"))];
    const blob = new Blob(["\uFEFF" + filas.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `interconsultas_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ─── Estilos ───
  const inp = { width: "100%", padding: "9px 11px", fontSize: "var(--fs-2)", border: "0.5px solid var(--borde)", borderRadius: 8, background: "var(--superficie)", color: "var(--texto)", outline: "none", boxSizing: "border-box" };
  const lbl = { display: "block", fontSize: "var(--fs-0)", fontWeight: 600, color: "var(--texto-sec)", marginBottom: 4 };
  const btnPrim = { padding: "9px 16px", fontSize: "var(--fs-2)", fontWeight: 600, background: "var(--primario)", color: "var(--texto-inv)", border: "none", borderRadius: 8, cursor: "pointer" };
  const btnSec = { padding: "9px 14px", fontSize: "var(--fs-1)", fontWeight: 600, background: "var(--superficie)", color: "var(--primario)", border: "0.5px solid var(--borde)", borderRadius: 8, cursor: "pointer" };
  const card = { background: "var(--superficie)", border: "0.5px solid var(--borde)", borderRadius: 10, padding: "12px" };
  const campo = (etiqueta, hijo) => (<div><label style={lbl}>{etiqueta}</label>{hijo}</div>);
  const colorPrio = { urgente: "var(--peligro)", normal: "var(--alerta)", electiva: "var(--exito)" };

  const Barras = ({ items, color = "var(--primario)" }) => {
    if (!items || items.length === 0) return <div style={{ fontSize: "var(--fs-1)", color: "var(--texto-ter)" }}>Sin datos.</div>;
    const max = Math.max(...items.map((i) => i.n));
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.slice(0, 8).map((i) => (
          <div key={i.label}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--fs-0)", color: "var(--texto)", marginBottom: 3, gap: 8 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.label}</span>
              <span style={{ fontWeight: 700, color: "var(--texto-sec)", flexShrink: 0 }}>{i.n}</span>
            </div>
            <div style={{ height: 6, background: "var(--fondo-suave)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ width: `${(i.n / max) * 100}%`, height: "100%", background: color, borderRadius: 3 }} />
            </div>
          </div>
        ))}
      </div>
    );
  };

  if (!currentUser) return null;

  const filtradas = lista.filter((r) => {
    if (filtro !== "todas" && r.estado !== filtro) return false;
    const f = (r.fecha || "").slice(0, 10);
    if (fechaDesde && (!f || f < fechaDesde)) return false;
    if (fechaHasta && (!f || f > fechaHasta)) return false;
    return true;
  });

  return (
    <div style={{ padding: 16, flex: 1, overflowY: "auto" }}>
      {error && <div style={{ padding: "9px 12px", marginBottom: 10, fontSize: "var(--fs-2)", background: "var(--peligro-bg)", border: "1px solid var(--peligro)", borderRadius: 8, color: "var(--peligro)" }}>{error}</div>}

      {/* ============ LISTA ============ */}
      {vista === "lista" && (
        <>
          <input ref={inputGaleriaRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={onFotos} />
          <input ref={inputCamaraRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={onFotos} />

          <div style={{ ...card, textAlign: "center", marginBottom: 14, borderStyle: "dashed" }}>
            {extrayendo ? (
              <div style={{ fontSize: 14, color: "var(--texto-sec)", padding: "6px 0" }}>
                <div style={{ fontSize: 26, marginBottom: 6 }}>🔍</div>
                Leyendo la interconsulta…
              </div>
            ) : !mostrarCaptura ? (
              <button onClick={() => setMostrarCaptura(true)} style={{ ...btnPrim, width: "100%", padding: "12px", fontSize: 14 }}>➕ Agregar interconsulta</button>
            ) : (
              <>
                <div style={{ fontSize: 28, marginBottom: 6 }}>📄</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--texto)", marginBottom: 4 }}>Archiva una interconsulta</div>
                <div style={{ fontSize: "var(--fs-1)", color: "var(--texto-ter)", marginBottom: 10 }}>Fotografíala o súbela: la IA lee el contenido y completa los campos para que solo revises.</div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                  <button onClick={() => inputCamaraRef.current?.click()} style={btnPrim}>📸 Tomar foto</button>
                  <button onClick={() => inputGaleriaRef.current?.click()} style={btnSec}>🖼 Galería / archivos</button>
                  <button onClick={() => { resetForm(); setVista("nueva"); }} style={btnSec}>✍️ A mano</button>
                </div>
                <button onClick={() => setMostrarCaptura(false)} style={{ background: "none", border: "none", color: "var(--texto-ter)", fontSize: "var(--fs-1)", cursor: "pointer", marginTop: 10 }}>Cancelar</button>
              </>
            )}
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
            {[["todas", "Todas"], ["pendiente", "Pendientes"], ["resuelta", "Resueltas"]].map(([id, label]) => (
              <button key={id} onClick={() => setFiltro(id)} style={{ padding: "6px 12px", fontSize: "var(--fs-1)", borderRadius: 14, cursor: "pointer", fontWeight: filtro === id ? 700 : 500, background: filtro === id ? "var(--primario)" : "var(--superficie)", color: filtro === id ? "var(--texto-inv)" : "var(--texto-sec)", border: filtro === id ? "none" : "0.5px solid var(--borde)" }}>{label}</button>
            ))}
            <span style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)", marginLeft: "auto" }}>{filtradas.length} de {lista.length}</span>
          </div>

          {/* Buscar por fecha (rango, opcional) */}
          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)" }}>📅 Fecha:</span>
            <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} aria-label="Desde" style={{ padding: "5px 8px", fontSize: "var(--fs-1)", borderRadius: 8, border: "0.5px solid var(--borde)", background: "var(--superficie)", color: "var(--texto)" }} />
            <span style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)" }}>—</span>
            <input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} aria-label="Hasta" style={{ padding: "5px 8px", fontSize: "var(--fs-1)", borderRadius: 8, border: "0.5px solid var(--borde)", background: "var(--superficie)", color: "var(--texto)" }} />
            {(fechaDesde || fechaHasta) && (
              <button onClick={() => { setFechaDesde(""); setFechaHasta(""); }} style={{ padding: "5px 10px", fontSize: "var(--fs-0)", borderRadius: 14, cursor: "pointer", background: "var(--superficie)", color: "var(--texto-sec)", border: "0.5px solid var(--borde)" }}>✕ Limpiar</button>
            )}
          </div>

          {cargando && <div style={{ textAlign: "center", padding: 24, color: "var(--texto-ter)", fontSize: "var(--fs-2)" }}>Cargando…</div>}
          {!cargando && filtradas.length === 0 && (
            <div style={{ textAlign: "center", padding: "26px 16px", color: "var(--texto-ter)", fontSize: "var(--fs-2)", lineHeight: 1.6 }}>
              No hay interconsultas archivadas.<br />Fotografía la primera para empezar a acumular tu casuística.
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filtradas.map((r) => {
              const abierto = abiertoId === r.id;
              return (
                <div key={r.id} style={{ ...card, borderLeft: `3px solid ${colorPrio[r.prioridad] || "var(--borde)"}`, padding: "11px 13px" }}>
                  <div onClick={() => setAbiertoId(abierto ? null : r.id)} style={{ cursor: "pointer" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--texto)" }}>{r.motivo || r.diagnostico || "Interconsulta"}</div>
                        <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-sec)", marginTop: 2 }}>
                          📅 {r.fecha}{r.servicio_solicitante ? ` · ${r.servicio_solicitante}` : ""}{r.paciente ? ` · ${r.paciente}` : ""}
                        </div>
                        {(r.ficha_clinica || r.rut) && (
                          <div style={{ fontSize: "var(--fs-xs)", color: "var(--texto-ter)", marginTop: 1 }}>
                            {r.ficha_clinica ? `FC ${r.ficha_clinica}` : ""}{r.ficha_clinica && r.rut ? " · " : ""}{r.rut || ""}
                          </div>
                        )}
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 10, flexShrink: 0, background: r.estado === "resuelta" ? "var(--exito-bg)" : "var(--fondo-suave)", color: r.estado === "resuelta" ? "var(--exito)" : "var(--texto-ter)" }}>
                        {r.estado === "resuelta" ? "✓ Resuelta" : "Pendiente"}
                      </span>
                    </div>
                  </div>
                  {abierto && (
                    <div style={{ marginTop: 8, fontSize: "var(--fs-1)", color: "var(--texto)", lineHeight: 1.5, display: "flex", flexDirection: "column", gap: 3 }}>
                      {r.edad != null && <div><b>Paciente:</b> {r.edad} años{r.sexo ? ` · ${r.sexo}` : ""}</div>}
                      {(r.servicio || r.cama) && <div><b>Ubicación:</b> {[r.servicio, r.cama ? `cama ${r.cama}` : ""].filter(Boolean).join(" · ")}</div>}
                      {r.medico_solicitante && <div><b>Solicita:</b> {r.medico_solicitante}</div>}
                      {r.diagnostico && <div><b>Diagnóstico:</b> {r.diagnostico}</div>}
                      {r.resumen && <div><b>Resumen:</b> {r.resumen}</div>}
                      {r.conducta && <div><b>Conducta:</b> {r.conducta}</div>}
                      {r.texto_extraido && (
                        <details style={{ marginTop: 4 }}>
                          <summary style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)", cursor: "pointer" }}>Ver texto leído del documento</summary>
                          <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-sec)", whiteSpace: "pre-wrap", marginTop: 4, lineHeight: 1.45 }}>{r.texto_extraido}</div>
                        </details>
                      )}
                      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                        <button onClick={() => alternarEstado(r)} style={{ ...btnSec, padding: "6px 12px" }}>{r.estado === "resuelta" ? "Marcar pendiente" : "✓ Marcar resuelta"}</button>
                        <button onClick={() => editar(r)} style={{ ...btnSec, padding: "6px 12px" }}>✎ Editar</button>
                        <button onClick={() => eliminar(r.id)} style={{ padding: "6px 12px", fontSize: "var(--fs-1)", background: "none", border: "none", color: "var(--peligro)", cursor: "pointer" }}>🗑</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ============ NUEVA / EDITAR ============ */}
      {vista === "nueva" && (
        <>
          <button onClick={() => { resetForm(); setVista("lista"); }} style={{ background: "none", border: "none", color: "var(--texto-sec)", fontSize: "var(--fs-2)", cursor: "pointer", marginBottom: 12, padding: 0 }}>← Volver</button>
          {fotos.length > 0 && (
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              {fotos.map((f, i) => <img key={i} src={f.dataUrl} alt={`página ${i + 1}`} style={{ height: 70, borderRadius: 6, border: "0.5px solid var(--borde)" }} />)}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            {campo("Fecha", <input type="date" style={inp} value={ic.fecha} onChange={(e) => set("fecha", e.target.value)} />)}
            {campo("Prioridad", (
              <select style={inp} value={ic.prioridad} onChange={(e) => set("prioridad", e.target.value)}>
                {PRIORIDADES.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
              </select>
            ))}
            <div style={{ gridColumn: "1 / -1" }}>{campo("Paciente (nombre completo)", <input style={inp} value={ic.paciente} onChange={(e) => set("paciente", e.target.value.slice(0, 120))} />)}</div>
            {campo("Ficha clínica (FC)", <input style={inp} value={ic.ficha_clinica} onChange={(e) => set("ficha_clinica", e.target.value.slice(0, 30))} />)}
            {campo("RUT", <input style={inp} value={ic.rut} onChange={(e) => set("rut", e.target.value.slice(0, 15))} />)}
            {campo("Edad", <input type="number" style={inp} value={ic.edad} onChange={(e) => set("edad", e.target.value)} />)}
            {campo("Sexo", (
              <select style={inp} value={ic.sexo} onChange={(e) => set("sexo", e.target.value)}>
                <option value="">—</option><option value="M">M</option><option value="F">F</option>
              </select>
            ))}
            {campo("Servicio solicitante", <input style={inp} value={ic.servicio_solicitante} onChange={(e) => set("servicio_solicitante", e.target.value)} placeholder="Medicina, Urgencia, UCI…" />)}
            {campo("Médico solicitante", <input style={inp} value={ic.medico_solicitante} onChange={(e) => set("medico_solicitante", e.target.value)} />)}
            {campo("Servicio (ubicación del paciente)", <input style={inp} value={ic.servicio} onChange={(e) => set("servicio", e.target.value.slice(0, 60))} placeholder="Medicina 3er piso, UCI…" />)}
            {campo("Cama", <input style={inp} value={ic.cama} onChange={(e) => set("cama", e.target.value.slice(0, 20))} placeholder="Cama / box" />)}
            <div style={{ gridColumn: "1 / -1" }}>
              {campo("Motivo", <input style={inp} value={ic.motivo} onChange={(e) => set("motivo", e.target.value)} list="motivos-ic" placeholder="Retención urinaria…" />)}
              <datalist id="motivos-ic">{MOTIVOS_FRECUENTES.map((m) => <option key={m} value={m} />)}</datalist>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>{campo("Diagnóstico", <input style={inp} value={ic.diagnostico} onChange={(e) => set("diagnostico", e.target.value)} />)}</div>
            <div style={{ gridColumn: "1 / -1" }}>{campo("Resumen clínico", <textarea rows={3} style={{ ...inp, resize: "vertical" }} value={ic.resumen} onChange={(e) => set("resumen", e.target.value)} />)}</div>
            <div style={{ gridColumn: "1 / -1" }}>{campo("Conducta / respuesta de urología", <textarea rows={2} style={{ ...inp, resize: "vertical" }} value={ic.conducta} onChange={(e) => set("conducta", e.target.value)} />)}</div>
            <div style={{ gridColumn: "1 / -1" }}>
              {campo("Estado", (
                <select style={inp} value={ic.estado} onChange={(e) => set("estado", e.target.value)}>
                  <option value="pendiente">Pendiente</option><option value="resuelta">Resuelta</option>
                </select>
              ))}
            </div>
          </div>
          <button onClick={guardar} disabled={guardando} style={{ ...btnPrim, width: "100%", marginTop: 14, opacity: guardando ? 0.6 : 1 }}>
            {guardando ? "Guardando…" : editId ? "Guardar cambios" : "Archivar interconsulta"}
          </button>
        </>
      )}

      {/* ============ MÉTRICAS ============ */}
      {vista === "metricas" && (
        <>
          <button onClick={() => setVista("lista")} style={{ background: "none", border: "none", color: "var(--texto-sec)", fontSize: "var(--fs-2)", cursor: "pointer", marginBottom: 12, padding: 0 }}>← Volver</button>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <div style={{ ...card, flex: "1 1 110px" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--primario)" }}>{met.total}</div>
              <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-sec)" }}>Interconsultas</div>
            </div>
            <div style={{ ...card, flex: "1 1 110px" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--exito)" }}>{met.resueltas}</div>
              <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-sec)" }}>Resueltas{met.total ? ` (${Math.round((met.resueltas / met.total) * 100)}%)` : ""}</div>
            </div>
            <div style={{ ...card, flex: "1 1 110px" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--alerta)" }}>{met.pendientes}</div>
              <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-sec)" }}>Pendientes</div>
            </div>
            <div style={{ ...card, flex: "1 1 110px" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--primario)" }}>{met.edadProm ?? "—"}</div>
              <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-sec)" }}>Edad promedio</div>
            </div>
          </div>

          {met.meses.length > 0 && (
            <div style={{ ...card, marginBottom: 12 }}>
              <div style={{ fontSize: "var(--fs-2)", fontWeight: 600, color: "var(--texto)", marginBottom: 8 }}>Volumen por mes</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 90 }}>
                {met.meses.map((m) => {
                  const max = Math.max(...met.meses.map((x) => x.n));
                  return (
                    <div key={m.mes} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                      <div style={{ fontSize: 9, color: "var(--texto-ter)" }}>{m.n}</div>
                      <div style={{ width: "100%", height: `${(m.n / max) * 62}px`, background: "var(--primario)", borderRadius: "3px 3px 0 0", minHeight: 2 }} />
                      <div style={{ fontSize: 8, color: "var(--texto-ter)" }}>{m.mes.slice(5)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            <div style={card}>
              <div style={{ fontSize: "var(--fs-2)", fontWeight: 600, color: "var(--texto)", marginBottom: 10 }}>Servicio solicitante</div>
              <Barras items={met.servicios} />
            </div>
            <div style={card}>
              <div style={{ fontSize: "var(--fs-2)", fontWeight: 600, color: "var(--texto)", marginBottom: 10 }}>Motivos más frecuentes</div>
              <Barras items={met.motivos} color="var(--exito)" />
            </div>
            <div style={card}>
              <div style={{ fontSize: "var(--fs-2)", fontWeight: 600, color: "var(--texto)", marginBottom: 10 }}>Diagnósticos</div>
              <Barras items={met.diagnosticos} color="var(--alerta)" />
            </div>
            <div style={card}>
              <div style={{ fontSize: "var(--fs-2)", fontWeight: 600, color: "var(--texto)", marginBottom: 10 }}>Prioridad</div>
              <Barras items={met.prioridades} color="var(--peligro)" />
            </div>
          </div>

          {lista.length > 0 && (
            <button onClick={exportarCSV} style={{ ...btnSec, marginTop: 14 }}>⬇ Exportar a CSV</button>
          )}
        </>
      )}
    </div>
  );
}

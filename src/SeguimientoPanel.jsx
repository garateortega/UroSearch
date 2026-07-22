// ============================================================
// SEGUIMIENTO DE PACIENTES — UroSearch
// Protocolos de control configurables (p. ej. "Vigilancia activa
// cáncer testicular"): cada uno define cada cuánto hay que controlar
// al paciente. La app calcula el próximo control y avisa por color
// cuando se acerca o se pasa la fecha.
// ============================================================
import React, { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "./supabase";

// ─── Utilidades de fechas ───
const hoyISO = () => new Date().toISOString().slice(0, 10);

const sumar = (fechaISO, valor, unidad) => {
  if (!fechaISO) return null;
  const d = new Date(fechaISO + "T12:00:00");
  const n = parseInt(valor) || 0;
  if (unidad === "dias") d.setDate(d.getDate() + n);
  else if (unidad === "semanas") d.setDate(d.getDate() + n * 7);
  else if (unidad === "meses") d.setMonth(d.getMonth() + n);
  else if (unidad === "anios") d.setFullYear(d.getFullYear() + n);
  return d.toISOString().slice(0, 10);
};

const diasHasta = (fechaISO) => {
  if (!fechaISO) return null;
  const a = new Date(hoyISO() + "T12:00:00");
  const b = new Date(fechaISO + "T12:00:00");
  return Math.round((b - a) / 86400000);
};

const fmt = (iso) => {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
};

const UNIDADES = [["dias", "días"], ["semanas", "semanas"], ["meses", "meses"], ["anios", "años"]];

// Plantillas para partir rápido (el usuario puede cambiarlas o crear las suyas)
const PLANTILLAS = [
  { nombre: "Vigilancia activa cáncer de próstata", intervalo_valor: 6, intervalo_unidad: "meses", aviso_dias: 30, descripcion: "PSA y control clínico. Biopsia según protocolo." },
  { nombre: "Vigilancia activa cáncer testicular", intervalo_valor: 3, intervalo_unidad: "meses", aviso_dias: 21, descripcion: "Marcadores, TAC según etapa y control clínico." },
  { nombre: "Seguimiento post-RTU vesical", intervalo_valor: 3, intervalo_unidad: "meses", aviso_dias: 21, descripcion: "Cistoscopia de control según riesgo." },
  { nombre: "Control de litiasis", intervalo_valor: 6, intervalo_unidad: "meses", aviso_dias: 30, descripcion: "Imagen de control y estudio metabólico." },
];

// ─── Estado de un paciente según su próximo control ───
function estadoControl(prox, avisoDias = 14) {
  const d = diasHasta(prox);
  if (d === null) return { id: "sinfecha", label: "Sin fecha", color: "var(--neutro)", bg: "var(--neutro-bg)", orden: 3, dias: null };
  if (d < 0) return { id: "atrasado", label: `Atrasado ${Math.abs(d)} d`, color: "var(--peligro)", bg: "var(--peligro-bg)", orden: 0, dias: d };
  if (d <= avisoDias) return { id: "proximo", label: `En ${d} d`, color: "var(--alerta)", bg: "var(--alerta-bg)", orden: 1, dias: d };
  return { id: "aldia", label: `En ${d} d`, color: "var(--exito)", bg: "var(--exito-bg)", orden: 2, dias: d };
}


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

// ─── Extracción por foto ───
async function extraerSeguimiento(imagenesBase64) {
  const instrucciones = `Analiza la(s) foto(s) de este documento clínico de urología y extrae los datos en JSON.
El documento puede ser un CONSENTIMIENTO INFORMADO de ingreso a un protocolo de vigilancia,
un control ambulatorio, una biopsia o un informe de imágenes.
Responde SOLO con un objeto JSON válido, sin markdown, sin backticks, sin texto adicional.
Si un dato no aparece, usa null. NO inventes datos.

Esquema exacto:
{
  "paciente": "nombre completo del paciente tal como aparece o null",
  "ficha_clinica": "número de ficha clínica / FC o null",
  "rut": "RUT del paciente (formato 12.345.678-9) o null",
  "edad": numero o null,
  "sexo": "M" | "F" | null,
  "diagnostico": "diagnóstico principal. Si es cáncer testicular, indica el tipo histológico (seminoma / no seminoma) y la etapa si aparecen. null si no está",
  "ultimo_control": "AAAA-MM-DD. Es la fecha ANCLA desde la que se contará el próximo control. En un consentimiento informado de ingreso usa la FECHA DE INGRESO AL PROTOCOLO o, si no está, la fecha de firma del documento. En un control o examen usa la fecha de ese control. null si no hay ninguna fecha",
  "hallazgos": "resumen de exámenes, marcadores, imágenes, histología o factores de riesgo relevantes, en 1-3 frases. null si no hay",
  "texto_extraido": "resumen del texto legible del documento, MÁXIMO 600 caracteres (no transcribas el documento completo)"
}

Reglas:
- En un consentimiento informado, los datos del paciente suelen estar en el encabezado y la fecha al final, junto a las firmas.
- Transcribe los datos tal cual aparecen; no inventes ni completes lo que no esté.`;

  const content = imagenesBase64.map((b64) => ({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: b64 },
  }));
  content.push({ type: "text", text: instrucciones });

  const res = await fetch(import.meta.env.VITE_CHAT_FUNCTION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 3000,
      system: "Eres un extractor de datos clínicos de urología. Respondes exclusivamente con JSON válido.",
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

// ─── Resumen en texto para que el chat pueda responder sobre estos pacientes ───
export async function resumenSeguimientoParaIA(userId, contexto) {
  try {
    let qp = supabase.from("seguimiento_protocolos").select("id, nombre, intervalo_valor, intervalo_unidad, aviso_dias");
    qp = contexto && contexto !== "personal" ? qp.eq("equipo_id", contexto) : qp.eq("user_id", userId).is("equipo_id", null);
    const { data: protos } = await qp;
    if (!protos?.length) return "";

    let qs = supabase.from("seguimiento_pacientes").select("*").eq("estado", "activo");
    qs = contexto && contexto !== "personal" ? qs.eq("equipo_id", contexto) : qs.eq("user_id", userId).is("equipo_id", null);
    const { data: pacs } = await qs;
    if (!pacs?.length) return "";

    const porProto = new Map(protos.map((p) => [p.id, p]));
    const lineas = ["PACIENTES EN SEGUIMIENTO (datos reales del usuario):"];
    protos.forEach((p) => {
      const suyos = pacs.filter((x) => x.protocolo_id === p.id);
      if (!suyos.length) return;
      lineas.push(`\n• Protocolo "${p.nombre}" (control cada ${p.intervalo_valor} ${p.intervalo_unidad}) — ${suyos.length} paciente(s):`);
      suyos
        .sort((a, b) => (a.proximo_control || "9999").localeCompare(b.proximo_control || "9999"))
        .forEach((s) => {
          const e = estadoControl(s.proximo_control, p.aviso_dias);
          lineas.push(
            `   - ${s.paciente || "Sin nombre"}${s.edad ? `, ${s.edad}a` : ""}${s.ficha_clinica ? ` (FC ${s.ficha_clinica})` : ""}: ` +
            `${s.diagnostico || "sin diagnóstico registrado"}. Último control ${fmt(s.ultimo_control)}, próximo ${fmt(s.proximo_control)} → ${e.label}.` +
            (s.hallazgos ? ` Hallazgos: ${s.hallazgos}` : "")
          );
        });
    });
    const atrasados = pacs.filter((s) => {
      const p = porProto.get(s.protocolo_id);
      return estadoControl(s.proximo_control, p?.aviso_dias).id === "atrasado";
    });
    if (atrasados.length) lineas.push(`\nHay ${atrasados.length} paciente(s) con el control ATRASADO.`);
    return lineas.join("\n");
  } catch {
    return "";
  }
}

// ════════════════════════════════════════════════════════════
export default function SeguimientoPanel({ currentUser, contexto = "personal" }) {
  const [protocolos, setProtocolos] = useState([]);
  const [pacientes, setPacientes] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [vista, setVista] = useState("lista");          // lista | protocolo | paciente
  const [protoSel, setProtoSel] = useState(null);       // protocolo abierto
  const [ordenPor, setOrdenPor] = useState("urgencia"); // urgencia | antiguedad | nombre

  // formularios
  const [protoForm, setProtoForm] = useState(null);     // objeto o null
  const [pacForm, setPacForm] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [extrayendo, setExtrayendo] = useState(false);
  const [fotos, setFotos] = useState([]);
  const inputGaleriaRef = useRef(null);
  const inputCamaraRef = useRef(null);

  const esEquipo = contexto && contexto !== "personal";

  // ─── Carga ───
  const cargar = async () => {
    setCargando(true);
    try {
      let qp = supabase.from("seguimiento_protocolos").select("*").order("nombre");
      qp = esEquipo ? qp.eq("equipo_id", contexto) : qp.eq("user_id", currentUser.id).is("equipo_id", null);
      const { data: pr, error: e1 } = await qp;
      if (e1) throw e1;

      let qs = supabase.from("seguimiento_pacientes").select("*");
      qs = esEquipo ? qs.eq("equipo_id", contexto) : qs.eq("user_id", currentUser.id).is("equipo_id", null);
      const { data: pa, error: e2 } = await qs;
      if (e2) throw e2;

      setProtocolos(pr || []);
      setPacientes(pa || []);
    } catch (e) { setError(e.message || String(e)); }
    setCargando(false);
  };
  useEffect(() => { if (currentUser) cargar(); /* eslint-disable-next-line */ }, [currentUser, contexto]);

  // Acciones desde el submenú de Hospital
  useEffect(() => {
    const h = (e) => {
      if (e.detail?.tab !== "hospital") return;
      if (e.detail.accion === "seg-protocolo") abrirNuevoProtocolo();
    };
    window.addEventListener("uro-submenu-accion", h);
    return () => window.removeEventListener("uro-submenu-accion", h);
    // eslint-disable-next-line
  }, []);

  // ─── Protocolos ───
  const abrirNuevoProtocolo = (plantilla = null) => {
    setProtoForm(plantilla
      ? { ...plantilla, id: null, color: "azul" }
      : { id: null, nombre: "", descripcion: "", intervalo_valor: 3, intervalo_unidad: "meses", aviso_dias: 21, color: "azul" });
  };

  const guardarProtocolo = async () => {
    if (!protoForm.nombre.trim()) { setError("Ponle un nombre al criterio de seguimiento."); return; }
    setGuardando(true); setError("");
    const payload = {
      user_id: currentUser.id,
      equipo_id: esEquipo ? contexto : null,
      nombre: protoForm.nombre.trim(),
      descripcion: protoForm.descripcion?.trim() || null,
      intervalo_valor: parseInt(protoForm.intervalo_valor) || 3,
      intervalo_unidad: protoForm.intervalo_unidad,
      aviso_dias: parseInt(protoForm.aviso_dias) || 14,
      color: protoForm.color || "azul",
    };
    try {
      if (protoForm.id) {
        const { error } = await supabase.from("seguimiento_protocolos").update(payload).eq("id", protoForm.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("seguimiento_protocolos").insert(payload);
        if (error) throw error;
      }
      setProtoForm(null);
      await cargar();
    } catch (e) { setError("No se pudo guardar: " + (e.message || e)); }
    setGuardando(false);
  };

  const eliminarProtocolo = async (id) => {
    if (!confirm("¿Eliminar este criterio y todos sus pacientes en seguimiento?")) return;
    try {
      await supabase.from("seguimiento_pacientes").delete().eq("protocolo_id", id);
      await supabase.from("seguimiento_protocolos").delete().eq("id", id);
      setVista("lista"); setProtoSel(null);
      await cargar();
    } catch (e) { setError("No se pudo eliminar: " + (e.message || e)); }
  };

  // ─── Pacientes en seguimiento ───
  const abrirNuevoPaciente = (protocoloId) => {
    setFotos([]);
    setPacForm({
      id: null, protocolo_id: protocoloId,
      paciente: "", ficha_clinica: "", rut: "", edad: "", sexo: "",
      diagnostico: "", hallazgos: "", notas: "",
      ultimo_control: hoyISO(), proximo_control: "", estado: "activo", texto_extraido: "",
    });
  };

  // Recalcula el próximo control al cambiar el último control
  const recalcularProximo = (form, protoId) => {
    const p = protocolos.find((x) => x.id === (protoId || form.protocolo_id));
    if (!p || !form.ultimo_control) return form.proximo_control;
    return sumar(form.ultimo_control, p.intervalo_valor, p.intervalo_unidad);
  };

  const guardarPaciente = async () => {
    if (!pacForm.paciente.trim() && !pacForm.ficha_clinica.trim()) {
      setError("Indica al menos el nombre o la ficha clínica."); return;
    }
    setGuardando(true); setError("");
    const prox = pacForm.proximo_control || recalcularProximo(pacForm);
    const payload = {
      user_id: currentUser.id,
      equipo_id: esEquipo ? contexto : null,
      protocolo_id: pacForm.protocolo_id,
      paciente: pacForm.paciente.trim() || null,
      ficha_clinica: pacForm.ficha_clinica.trim() || null,
      rut: pacForm.rut.trim() || null,
      edad: pacForm.edad ? parseInt(pacForm.edad) : null,
      sexo: pacForm.sexo || null,
      diagnostico: pacForm.diagnostico.trim() || null,
      hallazgos: pacForm.hallazgos.trim() || null,
      notas: pacForm.notas.trim() || null,
      ultimo_control: pacForm.ultimo_control || null,
      proximo_control: prox || null,
      estado: pacForm.estado || "activo",
      texto_extraido: pacForm.texto_extraido?.trim() || null,
    };
    try {
      if (pacForm.id) {
        const { error } = await supabase.from("seguimiento_pacientes").update(payload).eq("id", pacForm.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("seguimiento_pacientes").insert(payload);
        if (error) throw error;
      }
      setPacForm(null); setFotos([]);
      await cargar();
    } catch (e) { setError("No se pudo guardar: " + (e.message || e)); }
    setGuardando(false);
  };

  // Registrar control hecho hoy → recalcula el próximo
  const marcarControlado = async (p) => {
    const proto = protocolos.find((x) => x.id === p.protocolo_id);
    const nuevo = sumar(hoyISO(), proto?.intervalo_valor || 3, proto?.intervalo_unidad || "meses");
    try {
      await supabase.from("seguimiento_pacientes")
        .update({ ultimo_control: hoyISO(), proximo_control: nuevo }).eq("id", p.id);
      setPacientes((prev) => prev.map((x) => x.id === p.id ? { ...x, ultimo_control: hoyISO(), proximo_control: nuevo } : x));
    } catch (e) { setError("No se pudo actualizar: " + (e.message || e)); }
  };

  const eliminarPaciente = async (id) => {
    if (!confirm("¿Sacar a este paciente del seguimiento?")) return;
    try {
      await supabase.from("seguimiento_pacientes").delete().eq("id", id);
      await cargar();
    } catch (e) { setError("No se pudo eliminar: " + (e.message || e)); }
  };

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
      const x = await extraerSeguimiento(b64s);
      setPacForm((prev) => {
        const base = prev || { id: null, protocolo_id: protoSel?.id, paciente: "", ficha_clinica: "", rut: "", edad: "", sexo: "", diagnostico: "", hallazgos: "", notas: "", ultimo_control: hoyISO(), proximo_control: "", estado: "activo", texto_extraido: "" };
        const actualizado = {
          ...base,
          paciente: x.paciente ? String(x.paciente).slice(0, 120) : base.paciente,
          ficha_clinica: x.ficha_clinica ? String(x.ficha_clinica).slice(0, 30) : base.ficha_clinica,
          rut: x.rut ? String(x.rut).slice(0, 15) : base.rut,
          edad: (x.edad ?? "") !== "" ? String(x.edad) : base.edad,
          sexo: x.sexo || base.sexo,
          diagnostico: x.diagnostico || base.diagnostico,
          hallazgos: x.hallazgos || base.hallazgos,
          ultimo_control: x.ultimo_control || base.ultimo_control,
          texto_extraido: x.texto_extraido || base.texto_extraido,
        };
        actualizado.proximo_control = recalcularProximo(actualizado, actualizado.protocolo_id);
        return actualizado;
      });
    } catch (err) {
      setError("No se pudo leer el documento. Prueba con una foto más nítida o de una sola página, o llénalo a mano. (" + (err.message || err) + ")");
      if (!pacForm) abrirNuevoPaciente(protoSel?.id);
    }
    setExtrayendo(false);
    if (inputGaleriaRef.current) inputGaleriaRef.current.value = "";
    if (inputCamaraRef.current) inputCamaraRef.current.value = "";
  };

  // ─── Derivados ───
  const pacientesDe = (protoId) => pacientes.filter((p) => p.protocolo_id === protoId && p.estado === "activo");

  const ordenados = useMemo(() => {
    if (!protoSel) return [];
    const lista = pacientesDe(protoSel.id);
    const conEstado = lista.map((p) => ({ ...p, _e: estadoControl(p.proximo_control, protoSel.aviso_dias) }));
    if (ordenPor === "urgencia") {
      return conEstado.sort((a, b) => (a._e.orden - b._e.orden) || ((a._e.dias ?? 9999) - (b._e.dias ?? 9999)));
    }
    if (ordenPor === "antiguedad") {
      return conEstado.sort((a, b) => (a.ultimo_control || "9999").localeCompare(b.ultimo_control || "9999"));
    }
    return conEstado.sort((a, b) => (a.paciente || "").localeCompare(b.paciente || ""));
    // eslint-disable-next-line
  }, [pacientes, protoSel, ordenPor]);

  const resumenProto = (p) => {
    const lista = pacientesDe(p.id);
    let atr = 0, prox = 0;
    lista.forEach((x) => {
      const e = estadoControl(x.proximo_control, p.aviso_dias);
      if (e.id === "atrasado") atr++;
      else if (e.id === "proximo") prox++;
    });
    return { total: lista.length, atrasados: atr, proximos: prox };
  };

  // ─── Estilos ───
  const inp = { width: "100%", padding: "9px 11px", fontSize: 13, border: "0.5px solid var(--borde)", borderRadius: 8, background: "var(--superficie)", color: "var(--texto)", outline: "none", boxSizing: "border-box" };
  const lbl = { display: "block", fontSize: 11, fontWeight: 600, color: "var(--texto-sec)", marginBottom: 4 };
  const btnPrim = { padding: "9px 16px", fontSize: 13, fontWeight: 600, background: "var(--primario)", color: "var(--texto-inv)", border: "none", borderRadius: 8, cursor: "pointer" };
  const btnSec = { padding: "9px 14px", fontSize: 12.5, fontWeight: 600, background: "var(--superficie)", color: "var(--primario)", border: "0.5px solid var(--borde)", borderRadius: 8, cursor: "pointer" };
  const card = { background: "var(--superficie)", border: "0.5px solid var(--borde)", borderRadius: 10, padding: "12px" };
  const campo = (etiqueta, hijo) => (<div><label style={lbl}>{etiqueta}</label>{hijo}</div>);

  if (!currentUser) return null;

  return (
    <div style={{ padding: 16, flex: 1, overflowY: "auto" }}>
      {error && (
        <div style={{ padding: "9px 12px", marginBottom: 10, fontSize: 13, background: "var(--peligro-bg)", border: "1px solid var(--peligro)", borderRadius: 8, color: "var(--peligro)" }}>
          {error} <button onClick={() => setError("")} style={{ float: "right", background: "none", border: "none", color: "var(--peligro)", cursor: "pointer" }}>✕</button>
        </div>
      )}

      {/* ══════════ LISTA DE CRITERIOS ══════════ */}
      {vista === "lista" && !protoForm && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12.5, color: "var(--texto-sec)" }}>
              {cargando ? "Cargando…" : `${protocolos.length} criterio(s) · ${pacientes.filter(p => p.estado === "activo").length} paciente(s) en seguimiento`}
            </div>
            <button onClick={() => abrirNuevoProtocolo()} style={btnPrim}>+ Nuevo criterio</button>
          </div>

          {!cargando && protocolos.length === 0 && (
            <>
              <div style={{ textAlign: "center", padding: "22px 16px", color: "var(--texto-ter)", fontSize: 13, lineHeight: 1.6 }}>
                Aún no tienes criterios de seguimiento.<br />Crea uno o parte con una de estas plantillas:
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10 }}>
                {PLANTILLAS.map((pl) => (
                  <div key={pl.nombre} onClick={() => abrirNuevoProtocolo(pl)} style={{ ...card, cursor: "pointer", borderStyle: "dashed" }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--primario)", marginBottom: 3 }}>{pl.nombre}</div>
                    <div style={{ fontSize: 11.5, color: "var(--texto-ter)" }}>Control cada {pl.intervalo_valor} {pl.intervalo_unidad}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {protocolos.map((p) => {
              const r = resumenProto(p);
              return (
                <div key={p.id} onClick={() => { setProtoSel(p); setVista("protocolo"); }} style={{ ...card, cursor: "pointer", borderLeft: `3px solid ${r.atrasados > 0 ? "var(--peligro)" : r.proximos > 0 ? "var(--alerta)" : "var(--exito)"}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--texto)" }}>{p.nombre}</div>
                      <div style={{ fontSize: 11.5, color: "var(--texto-sec)", marginTop: 2 }}>
                        Control cada {p.intervalo_valor} {(UNIDADES.find(u => u[0] === p.intervalo_unidad) || ["", p.intervalo_unidad])[1]} · avisa {p.aviso_dias} días antes
                      </div>
                      {p.descripcion && <div style={{ fontSize: 11.5, color: "var(--texto-ter)", marginTop: 3 }}>{p.descripcion}</div>}
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--primario)" }}>{r.total}</div>
                      <div style={{ fontSize: 10, color: "var(--texto-ter)" }}>pacientes</div>
                    </div>
                  </div>
                  {(r.atrasados > 0 || r.proximos > 0) && (
                    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                      {r.atrasados > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 10, background: "var(--peligro-bg)", color: "var(--peligro)" }}>⚠️ {r.atrasados} atrasado(s)</span>}
                      {r.proximos > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 10, background: "var(--alerta-bg)", color: "var(--alerta)" }}>⏳ {r.proximos} por vencer</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ══════════ FORM DE CRITERIO ══════════ */}
      {protoForm && (
        <>
          <button onClick={() => setProtoForm(null)} style={{ background: "none", border: "none", color: "var(--texto-sec)", fontSize: 13, cursor: "pointer", marginBottom: 12, padding: 0 }}>← Volver</button>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--texto)", marginBottom: 10 }}>
            {protoForm.id ? "Editar criterio" : "Nuevo criterio de seguimiento"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <div style={{ gridColumn: "1 / -1" }}>{campo("Nombre *", <input style={inp} value={protoForm.nombre} onChange={(e) => setProtoForm({ ...protoForm, nombre: e.target.value })} placeholder="Vigilancia activa cáncer testicular" />)}</div>
            <div style={{ gridColumn: "1 / -1" }}>{campo("Descripción", <textarea rows={2} style={{ ...inp, resize: "vertical" }} value={protoForm.descripcion || ""} onChange={(e) => setProtoForm({ ...protoForm, descripcion: e.target.value })} placeholder="Qué se controla en cada visita" />)}</div>
            {campo("Controlar cada", <input type="number" min={1} style={inp} value={protoForm.intervalo_valor} onChange={(e) => setProtoForm({ ...protoForm, intervalo_valor: e.target.value })} />)}
            {campo("Unidad", (
              <select style={inp} value={protoForm.intervalo_unidad} onChange={(e) => setProtoForm({ ...protoForm, intervalo_unidad: e.target.value })}>
                {UNIDADES.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
              </select>
            ))}
            {campo("Avisarme (días antes)", <input type="number" min={0} style={inp} value={protoForm.aviso_dias} onChange={(e) => setProtoForm({ ...protoForm, aviso_dias: e.target.value })} />)}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--texto-ter)", marginTop: 8, lineHeight: 1.45 }}>
            Cuando registres un control, la fecha del próximo se calcula sola. Los pacientes se marcan en 🟡 amarillo cuando falten {protoForm.aviso_dias || 0} días o menos, y en 🔴 rojo si se pasó la fecha.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button onClick={guardarProtocolo} disabled={guardando} style={{ ...btnPrim, opacity: guardando ? 0.6 : 1 }}>{guardando ? "Guardando…" : "Guardar criterio"}</button>
            {protoForm.id && <button onClick={() => eliminarProtocolo(protoForm.id)} style={{ ...btnSec, color: "var(--peligro)", borderColor: "var(--peligro)" }}>Eliminar</button>}
          </div>
        </>
      )}

      {/* ══════════ DETALLE DE UN CRITERIO ══════════ */}
      {vista === "protocolo" && protoSel && !protoForm && !pacForm && (
        <>
          <button onClick={() => { setVista("lista"); setProtoSel(null); }} style={{ background: "none", border: "none", color: "var(--texto-sec)", fontSize: 13, cursor: "pointer", marginBottom: 10, padding: 0 }}>← Todos los criterios</button>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: "var(--texto)" }}>{protoSel.nombre}</div>
              <div style={{ fontSize: 11.5, color: "var(--texto-sec)", marginTop: 2 }}>
                Control cada {protoSel.intervalo_valor} {(UNIDADES.find(u => u[0] === protoSel.intervalo_unidad) || ["", ""])[1]}
              </div>
            </div>
            <button onClick={() => setProtoForm({ ...protoSel })} style={btnSec}>⚙️ Editar criterio</button>
          </div>

          <input ref={inputGaleriaRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={onFotos} />
          <input ref={inputCamaraRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={onFotos} />

          <div style={{ ...card, textAlign: "center", borderStyle: "dashed", marginBottom: 12 }}>
            {extrayendo ? (
              <div style={{ fontSize: 14, color: "var(--texto-sec)", padding: "6px 0" }}>
                <div style={{ fontSize: 26, marginBottom: 6 }}>🔍</div>Leyendo el documento…
              </div>
            ) : (
              <>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--texto)", marginBottom: 3 }}>Agregar paciente a este seguimiento</div>
                <div style={{ fontSize: 11.5, color: "var(--texto-ter)", marginBottom: 9 }}>Fotografía el consentimiento informado de ingreso, un control o un examen: Uros extrae los datos del paciente y la fecha.</div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                  <button onClick={() => inputCamaraRef.current?.click()} style={btnPrim}>📸 Tomar foto</button>
                  <button onClick={() => inputGaleriaRef.current?.click()} style={btnSec}>🖼 Galería</button>
                  <button onClick={() => abrirNuevoPaciente(protoSel.id)} style={btnSec}>✍️ A mano</button>
                </div>
              </>
            )}
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 11.5, color: "var(--texto-ter)" }}>Ordenar por:</span>
            {[["urgencia", "⚠️ Urgencia"], ["antiguedad", "🕐 Más antiguos"], ["nombre", "A-Z"]].map(([id, l]) => (
              <button key={id} onClick={() => setOrdenPor(id)} style={{ padding: "5px 11px", fontSize: 11.5, borderRadius: 12, cursor: "pointer", fontWeight: ordenPor === id ? 700 : 500, background: ordenPor === id ? "var(--primario)" : "var(--superficie)", color: ordenPor === id ? "var(--texto-inv)" : "var(--texto-sec)", border: ordenPor === id ? "none" : "0.5px solid var(--borde)" }}>{l}</button>
            ))}
          </div>

          {ordenados.length === 0 && (
            <div style={{ textAlign: "center", padding: "24px 16px", color: "var(--texto-ter)", fontSize: 13 }}>
              Aún no hay pacientes en este seguimiento.
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {ordenados.map((p) => {
              const e = p._e;
              return (
                <div key={p.id} style={{ ...card, borderLeft: `3px solid ${e.color}`, padding: "11px 13px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--texto)" }}>
                        {p.paciente || "Sin nombre"}{p.edad ? `, ${p.edad}a` : ""}{p.sexo ? ` · ${p.sexo}` : ""}
                      </div>
                      {(p.ficha_clinica || p.rut) && (
                        <div style={{ fontSize: 10.5, color: "var(--texto-ter)", marginTop: 1 }}>
                          {p.ficha_clinica ? `FC ${p.ficha_clinica}` : ""}{p.ficha_clinica && p.rut ? " · " : ""}{p.rut || ""}
                        </div>
                      )}
                      {p.diagnostico && <div style={{ fontSize: 12.5, color: "var(--texto-sec)", marginTop: 3 }}>{p.diagnostico}</div>}
                      <div style={{ fontSize: 11.5, color: "var(--texto-ter)", marginTop: 4 }}>
                        Último control: {fmt(p.ultimo_control)} · Próximo: <b style={{ color: e.color }}>{fmt(p.proximo_control)}</b>
                      </div>
                      {p.hallazgos && <div style={{ fontSize: 11.5, color: "var(--texto-sec)", marginTop: 4, lineHeight: 1.45 }}>{p.hallazgos}</div>}
                    </div>
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: "4px 9px", borderRadius: 10, flexShrink: 0, background: e.bg, color: e.color, whiteSpace: "nowrap" }}>{e.label}</span>
                  </div>
                  <div style={{ display: "flex", gap: 7, marginTop: 9, flexWrap: "wrap" }}>
                    <button onClick={() => marcarControlado(p)} style={{ ...btnSec, padding: "6px 11px", fontSize: 11.5, color: "var(--exito)", borderColor: "var(--exito-borde)" }}>✓ Controlado hoy</button>
                    <button onClick={() => { setFotos([]); setPacForm({ ...p, edad: p.edad != null ? String(p.edad) : "", paciente: p.paciente || "", ficha_clinica: p.ficha_clinica || "", rut: p.rut || "", diagnostico: p.diagnostico || "", hallazgos: p.hallazgos || "", notas: p.notas || "", texto_extraido: p.texto_extraido || "" }); }} style={{ ...btnSec, padding: "6px 11px", fontSize: 11.5 }}>✎ Editar</button>
                    <button onClick={() => eliminarPaciente(p.id)} style={{ padding: "6px 10px", fontSize: 11.5, background: "none", border: "none", color: "var(--peligro)", cursor: "pointer" }}>🗑</button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ══════════ FORM DE PACIENTE ══════════ */}
      {pacForm && (
        <>
          <button onClick={() => { setPacForm(null); setFotos([]); }} style={{ background: "none", border: "none", color: "var(--texto-sec)", fontSize: 13, cursor: "pointer", marginBottom: 12, padding: 0 }}>← Volver</button>
          {fotos.length > 0 && (
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              {fotos.map((f, i) => <img key={i} src={f.dataUrl} alt={`página ${i + 1}`} style={{ height: 70, borderRadius: 6, border: "0.5px solid var(--borde)" }} />)}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <div style={{ gridColumn: "1 / -1" }}>{campo("Paciente (nombre completo)", <input style={inp} value={pacForm.paciente} onChange={(e) => setPacForm({ ...pacForm, paciente: e.target.value.slice(0, 120) })} />)}</div>
            {campo("Ficha clínica (FC)", <input style={inp} value={pacForm.ficha_clinica} onChange={(e) => setPacForm({ ...pacForm, ficha_clinica: e.target.value.slice(0, 30) })} />)}
            {campo("RUT", <input style={inp} value={pacForm.rut} onChange={(e) => setPacForm({ ...pacForm, rut: e.target.value.slice(0, 15) })} />)}
            {campo("Edad", <input type="number" style={inp} value={pacForm.edad} onChange={(e) => setPacForm({ ...pacForm, edad: e.target.value })} />)}
            {campo("Sexo", (
              <select style={inp} value={pacForm.sexo} onChange={(e) => setPacForm({ ...pacForm, sexo: e.target.value })}>
                <option value="">—</option><option value="M">M</option><option value="F">F</option>
              </select>
            ))}
            <div style={{ gridColumn: "1 / -1" }}>{campo("Diagnóstico", <input style={inp} value={pacForm.diagnostico} onChange={(e) => setPacForm({ ...pacForm, diagnostico: e.target.value })} />)}</div>
            {campo("Último control / ingreso al protocolo", <input type="date" style={inp} value={pacForm.ultimo_control || ""} onChange={(e) => { const f = { ...pacForm, ultimo_control: e.target.value }; f.proximo_control = recalcularProximo(f); setPacForm(f); }} />)}
            {campo("Próximo control (se calcula solo)", <input type="date" style={inp} value={pacForm.proximo_control || ""} onChange={(e) => setPacForm({ ...pacForm, proximo_control: e.target.value })} />)}
            <div style={{ gridColumn: "1 / -1", fontSize: 11, color: "var(--texto-ter)", lineHeight: 1.45, marginTop: -4 }}>
              Si estás ingresando al paciente con su consentimiento informado, en «último control» va la <b>fecha de ingreso al protocolo</b>: desde ahí se cuenta el primer control.
            </div>
            <div style={{ gridColumn: "1 / -1" }}>{campo("Hallazgos / exámenes", <textarea rows={2} style={{ ...inp, resize: "vertical" }} value={pacForm.hallazgos} onChange={(e) => setPacForm({ ...pacForm, hallazgos: e.target.value })} placeholder="Marcadores, imágenes, PSA…" />)}</div>
            <div style={{ gridColumn: "1 / -1" }}>{campo("Notas", <textarea rows={2} style={{ ...inp, resize: "vertical" }} value={pacForm.notas} onChange={(e) => setPacForm({ ...pacForm, notas: e.target.value })} />)}</div>
            {campo("Estado", (
              <select style={inp} value={pacForm.estado} onChange={(e) => setPacForm({ ...pacForm, estado: e.target.value })}>
                <option value="activo">En seguimiento</option>
                <option value="alta">Dado de alta</option>
                <option value="perdido">Perdido de vista</option>
              </select>
            ))}
          </div>
          <button onClick={guardarPaciente} disabled={guardando} style={{ ...btnPrim, width: "100%", marginTop: 14, opacity: guardando ? 0.6 : 1 }}>
            {guardando ? "Guardando…" : pacForm.id ? "Guardar cambios" : "Agregar al seguimiento"}
          </button>
        </>
      )}
    </div>
  );
}

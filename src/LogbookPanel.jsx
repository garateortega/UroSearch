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
  listarCompanerosEquipo, agregarLogbookACompanero,
} from "./logbook";
import { supabase } from "./supabase";

// Token para la Edge Function de IA: usa la sesión del usuario (la función
// valida que el usuario exista y esté aprobado antes de llamar a Anthropic).
async function tokenFuncionIA() {
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.access_token) return data.session.access_token;
  } catch {}
  return import.meta.env.VITE_SUPABASE_ANON_KEY;
}

const CATEGORIAS_LOGBOOK = ["Endourología", "Laparoscopía", "Cirugía abierta", "Cistoscopía", "Biopsia prostática", "Uretra / genital", "Otro"];
const ROLES = [["cirujano", "Cirujano principal"], ["primer_ayudante", "1er ayudante"], ["segundo_ayudante", "2do ayudante"], ["observador", "Observador"]];
const ROLES_AYUDANTE = ["primer_ayudante", "segundo_ayudante"]; // cuentan como "ayudante" en las métricas

// ─── Agrupación de procedimientos ───
// Junta las variantes de una misma intervención (técnicas, lateralidad, siglas)
// bajo una sola familia, para que las métricas no queden fragmentadas.
// Se compara SIN tildes y en minúsculas, así "prostata" y "próstata" son lo mismo.
const sinTildes = (t) => (t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const C = "\\s*(?:de\\s+|del\\s+|la\\s+|los\\s+)?"; // conectores opcionales: "RTU de prostata"

const FAMILIAS = [
  // ── LITIASIS ── RIRS (renal) y URS (ureteral) son procedimientos DISTINTOS
  [/nlpc|pcnl|mini\s*perc|nefrolitotomia\s*percut|percutanea/,                       "Nefrolitotomía percutánea (NLPC)"],
  [/rirs|retrograda\s*intrarrenal|ureterorrenoscopia\s*flex|urs\s*flex|nefrolitotomia\s*(endosc|flex|laser)/, "Nefrolitotomía endoscópica (RIRS)"],
  [/ureterolitotomia|ureteroscopia|ureterorrenoscopia|\burs\b|\bursl\b/,             "Ureterolitotomía endoscópica (URS)"],
  [/litotricia\s*extracorp|\bleco\b|\beswl\b/,                                      "Litotricia extracorpórea (LEC)"],
  [/cistolitotomia|cistolitotricia|litotricia\s*vesical|litotripsia\s*vesical/,       "Cistolitotomía"],
  [/pielolitotomia/,                                                                 "Pielolitotomía"],

  // ── ENDOUROLOGÍA / VÍA URINARIA ──
  [/doble\s*j|\bjj\b|pigtail|cateter\s*ureteral/,                                   "Catéter doble J (instalación/cambio/retiro)"],
  [/nefrostomia/,                                                                    "Nefrostomía percutánea"],
  [/(botox|toxina\s*botulinica|onabotulinum)/,                                       "Botox intravesical"],
  [/cistoscopia|uretrocistoscopia/,                                                  "Cistoscopía"],
  [/uretrotomia\s*interna|uretrotomia/,                                              "Uretrotomía interna"],
  [/talla\s*vesical|cistostomia|puncion\s*vesical/,                                  "Cistostomía / talla vesical"],
  [/dilatacion\s*uretral/,                                                           "Dilatación uretral"],

  // ── RESECCIONES TRANSURETRALES ──
  [new RegExp("rtu\\s*-?\\s*v\\b|rtu" + C + "vesic|rtu" + C + "(tumor|lesion)|reseccion\\s*transuretral" + C + "(tumor\\s*)?vesic"), "RTU vesical (RTU-V)"],
  [new RegExp("rtu\\s*-?\\s*p\\b|rtu" + C + "prostat|reseccion\\s*transuretral" + C + "prostat|\\brtup\\b"),                        "RTU prostática (RTU-P)"],
  [/reseccion\s*transuretral/,                                                       "Resección transuretral (otra)"],

  // ── ESCROTO Y TESTÍCULO ── (la lateralidad nunca separa)
  [/eversion.*tunica|tunica\s*vaginal|winkelmann|jaboulay|\blord\b/,                "Eversión de túnica vaginal"],
  [/orqu[ii]?d?ectomia|orquiectomia|orquidectomia/,                                  "Orquiectomía"],
  [/orquidopexia|orquiopexia|criptorquid|descenso\s*testicular/,                     "Orquidopexia"],
  [/hidrocelectomia|hidrocele/,                                                      "Hidrocelectomía"],
  [/varicocelectomia|varicocele/,                                                    "Varicocelectomía"],
  [/espermatocele|epididimectomia|quiste\s*epididim/,                                "Cirugía de epidídimo"],
  [/vasectomia|vasovasostomia/,                                                      "Vasectomía"],
  [/aseo.*(escrotal|escroto|perine|genital)|debridamiento.*(escrotal|perine|genital|fournier)|fournier/, "Aseo quirúrgico escrotal/perineal"],
  [/exploracion\s*escrotal|torsion\s*testicular|detorsion/,                          "Exploración escrotal"],
  [/biopsia\s*testicular|\btese\b|\bmicrotese\b/,                                  "Biopsia testicular"],
  [/protesis\s*testicular/,                                                          "Prótesis testicular"],

  // ── PENE Y URETRA ──
  [/circuncision|postectomia|fimosis|parafimosis/,                                   "Circuncisión"],
  [/frenulo|frenuloplastia/,                                                         "Frenuloplastía"],
  [/meatotomia|meatoplastia/,                                                        "Meatotomía"],
  [/uretroplastia/,                                                                  "Uretroplastía"],
  [/protesis\s*peneana|implante\s*peneano/,                                          "Prótesis peneana"],
  [/priapismo/,                                                                      "Cirugía de priapismo"],

  // ── PRÓSTATA ── PTV (transvesical, por HBP) ≠ radical (oncológica)
  [/\bptv\b|prostatectomia\s*(transvesic|suprapub|simple)|adenomectomia/,           "Adenomectomía prostática (PTV)"],
  [/prostatectomia\s*radical|\bprr\b|prostatectomia\s*(abierta|laparosc|robot|retropub)/, "Prostatectomía radical"],
  [/biopsia\s*prostat|biopsia\s*(transrectal|transperineal)|biopsia\s*por\s*fusion/, "Biopsia prostática"],

  // ── RIÑÓN Y VÍA ALTA ──
  [/nefroureterectomia/,                                                             "Nefroureterectomía"],
  [/nefrectomia\s*parcial|tumorectomia\s*renal/,                                     "Nefrectomía parcial"],
  [/nefrectomia/,                                                                    "Nefrectomía"],
  [/pieloplastia/,                                                                   "Pieloplastía"],
  [/adrenalectomia|suprarrenalectomia/,                                              "Adrenalectomía"],
  [/reimplante\s*ureteral|ureteroneocist/,                                           "Reimplante ureteral"],
  [/anastomosis\s*ureter|ureteroureterostomia/,                                      "Anastomosis ureteral"],

  // ── VEJIGA Y ONCOLOGÍA MAYOR ──
  [/cistectomia/,                                                                    "Cistectomía"],
  [/linfadenectomia|\brplnd\b/,                                                      "Linfadenectomía"],
  [/diverticulectomia\s*vesical|diverticulo\s*vesical/,                              "Diverticulectomía vesical"],
  [/cistoplastia|ampliacion\s*vesical/,                                              "Cistoplastía de ampliación"],

  // ── PISO PÉLVICO / INCONTINENCIA ──
  [/\bsling\b|\btvt\b|\btot\b|cinta\s*suburetral/,                               "Sling suburetral"],
  [/esfinter\s*urinario\s*artificial|\baus\b/,                                      "Esfínter urinario artificial"],

  // ── OTROS ──
  [/hernioplastia|herniorrafia|hernia\s*inguinal/,                                   "Hernioplastía inguinal"],
  [/trasplante\s*renal/,                                                             "Trasplante renal"],
  [/fistula/,                                                                        "Cirugía de fístula"],
  [/biopsia\s*renal/,                                                                "Biopsia renal"],
];

function familiaProc(nombre) {
  let t = sinTildes(nombre).trim();
  if (!t) return "Sin especificar";
  // La lateralidad y algunos calificativos no deben separar familias
  t = t
    .replace(/\b(derech[ao]|izquierd[ao]|bilateral|unilateral|izq|der|\(d\)|\(i\))\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [re, fam] of FAMILIAS) if (re.test(t)) return fam;
  // Si no calza, se normaliza para que al menos las variantes de escritura se junten
  const limpio = t.replace(/[.,;]+$/, "");
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}
const CLAVIEN = ["", "I", "II", "IIIa", "IIIb", "IVa", "IVb", "V"];

const REGISTRO_VACIO = {
  fecha: new Date().toISOString().slice(0, 10),
  iniciales: "", ficha_clinica: "", rut: "", edad: "", sexo: "", diagnostico_pre: "", diagnostico_post: "",
  procedimiento: "", intervencion: "", categoria: "", lateralidad: "", rol: "cirujano",
  cirujano: "", ayudantes: "", anestesia: "", hora_inicio: "", hora_termino: "",
  duracion_min: "", sangrado_ml: "", tamano_litiasis_mm: "", tamano_prostata_cc: "",
  hallazgos: "", tecnica: "",
  complicacion: false, clavien: "", detalles_complicacion: "", observaciones: "",
  // Complementos posteriores (biopsia / control imagenológico)
  biopsia_resultado: "", biopsia_isup: "", control_stone_free: "", control_imagen_detalle: "",
};

// ─── Comprime la foto en el navegador antes de enviarla (máx 1568 px, JPEG) ───
async function comprimirImagen(file, maxDim = 1568, calidad = 0.85) {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name || "")) {
    const base64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = () => rej(new Error("No se pudo leer el PDF")); r.readAsDataURL(file); });
    return { base64, mime: "application/pdf" };
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
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", calidad));
  return { base64: dataUrl.split(",")[1], dataUrl, blob, mime: "image/jpeg" };
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
async function extraerDeFotos(items) {
  const instrucciones = `Analiza la(s) foto(s) de este protocolo operatorio de urología y extrae los datos en JSON.
Responde SOLO con un objeto JSON válido, sin markdown, sin backticks, sin texto adicional.
Si un dato no aparece en el documento, usa null. NO inventes datos.

Esquema exacto:
{
  "fecha": "YYYY-MM-DD o null",
  "iniciales": "NOMBRE COMPLETO del paciente tal como aparece en el protocolo (ej: 'Juan Pérez Mora'). Si solo hay iniciales, deja las iniciales. null si no aparece",
  "ficha_clinica": "número de ficha clínica / FC / N° de ficha o null",
  "rut": "RUT del paciente (formato 12.345.678-9) o null",
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
IMPORTANTE: transcribe los datos tal cual aparecen en el documento; no inventes ni completes datos que no estén.`;

  const content = items.map((it) => it.mime === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: it.base64 } }
    : { type: "image", source: { type: "base64", media_type: "image/jpeg", data: it.base64 } });
  content.push({ type: "text", text: instrucciones });

  const res = await fetch(import.meta.env.VITE_CHAT_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${await tokenFuncionIA()}`,
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 2048,
      system: "Eres un extractor de datos clínicos de protocolos quirúrgicos de urología. Respondes exclusivamente con JSON válido. No almacenes, registres ni retengas los datos personales de los pacientes que aparezcan en las imágenes.",
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) {
    let detalle = "";
    try { detalle = (await res.text()).slice(0, 160); } catch {}
    throw new Error(`el servidor de IA respondió ${res.status}${detalle ? " — " + detalle : ""}`);
  }
  let data;
  try { data = await res.json(); } catch { throw new Error("respuesta vacía del servidor de IA"); }
  const txt = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  if (!txt) throw new Error("la IA no devolvió texto (imagen ilegible o límite alcanzado)");
  // Aísla el objeto JSON aunque venga con backticks o texto alrededor, y tolera
  // respuestas cortadas quedándose con lo que haya entre la primera { y la última }.
  let clean = txt.replace(/```json|```/g, "").trim();
  const i0 = clean.indexOf("{"), i1 = clean.lastIndexOf("}");
  if (i0 >= 0 && i1 > i0) clean = clean.slice(i0, i1 + 1);
  try {
    return JSON.parse(clean);
  } catch {
    throw new Error("no se pudo interpretar la respuesta de la IA");
  }
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
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--fs-1)", marginBottom: 2 }}>
            <span style={{ color: "var(--texto)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 8 }}>{it.label}</span>
            <span style={{ color: "var(--texto-sec)", fontWeight: 600, flexShrink: 0 }}>{it.n}{it.extra ? ` · ${it.extra}` : ""}</span>
          </div>
          <div style={{ height: 8, background: "var(--fondo-suave)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${(it.n / max) * 100}%`, height: "100%", background: color, borderRadius: 4 }} />
          </div>
        </div>
      ))}
      {items.length === 0 && <div style={{ fontSize: "var(--fs-1)", color: "var(--texto-ter)" }}>Sin datos aún.</div>}
    </div>
  );
}

// ─── Heurística: ¿es una cirugía oncológica? (por procedimiento/diagnóstico) ───
function esOncologica(r) {
  const t = sinTildes(
    (r.procedimiento || "") + " " + (r.intervencion || "") + " " +
    (r.diagnostico_pre || "") + " " + (r.diagnostico_post || "") + " " + (r.categoria || "")
  );
  return /prostatectomia radical|cistectomia|nefrectomia|nefroureterectomia|orquiectomia|penectomia|linfadenectomia|adrenalectomia|rtuv|rtu v|tumor|cancer|neoplasia|oncolog|carcinoma|masa renal|biopsia prostatica/.test(t);
}

// ─── Gráfico de dispersión: cada punto es una cirugía (x = orden temporal, y = valor) ───
// Muestra la mediana como línea de referencia. Útil para ver tiempos operatorios,
// sangrado, etc. de un procedimiento y detectar la curva de aprendizaje.
function Dispersion({ puntos, unidad = "min", color = "var(--primario)", mediana = null }) {
  if (!puntos || puntos.length === 0) return <div style={{ fontSize: "var(--fs-1)", color: "var(--texto-ter)" }}>Sin datos numéricos.</div>;
  const W = 300, H = 120, padL = 30, padR = 8, padT = 10, padB = 18;
  const vals = puntos.map((p) => p.val);
  const maxV = Math.max(...vals), minV = Math.min(...vals);
  const rango = maxV - minV || 1;
  const n = puntos.length;
  const x = (i) => padL + (n === 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR));
  const y = (v) => padT + (1 - (v - minV) / rango) * (H - padT - padB);
  const medY = mediana != null ? y(mediana) : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ overflow: "visible" }}>
      {/* ejes */}
      <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="var(--borde)" strokeWidth="0.5" />
      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="var(--borde)" strokeWidth="0.5" />
      {/* etiquetas min/max */}
      <text x={padL - 3} y={padT + 3} textAnchor="end" fontSize="8" fill="var(--texto-ter)">{Math.round(maxV)}</text>
      <text x={padL - 3} y={H - padB} textAnchor="end" fontSize="8" fill="var(--texto-ter)">{Math.round(minV)}</text>
      {/* línea de mediana */}
      {medY != null && (
        <>
          <line x1={padL} y1={medY} x2={W - padR} y2={medY} stroke={color} strokeWidth="0.8" strokeDasharray="3 2" opacity="0.6" />
          <text x={W - padR} y={medY - 2} textAnchor="end" fontSize="8" fill={color}>mediana {mediana} {unidad}</text>
        </>
      )}
      {/* línea que une los puntos (tendencia / curva de aprendizaje) */}
      {puntos.length > 1 && (
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="1.3"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity="0.55"
          points={puntos.map((p, i) => `${x(i)},${y(p.val)}`).join(" ")}
        />
      )}
      {/* puntos */}
      {puntos.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.val)} r="3" fill={color} opacity="0.75">
          <title>{p.fecha ? p.fecha + " · " : ""}{p.val} {unidad}</title>
        </circle>
      ))}
    </svg>
  );
}

// ─── ¿Un compañero (por su nombre) figura en un texto de participante? ───
// Normaliza (sin tildes, sin títulos "Dr./Dra.") y exige coincidencia razonable
// para no agregar cirugías al logbook de la persona equivocada.
function _normNombre(s) {
  return sinTildes(s || "").replace(/\bd(r|ra)s?\b\.?/g, " ").replace(/[.,;]/g, " ").replace(/\s+/g, " ").trim();
}
function _tokensNombre(s) {
  return _normNombre(s).split(" ").filter((t) => t.length >= 3);
}
function participaEnTexto(nombreMiembro, textoParticipante) {
  if (!nombreMiembro || !textoParticipante) return false;
  const nm = _tokensNombre(nombreMiembro);
  if (nm.size === 0 && nm.length === 0) return false;
  const tp = new Set(_tokensNombre(textoParticipante));
  let comunes = 0;
  nm.forEach((t) => { if (tp.has(t)) comunes++; });
  // Match fuerte: ≥2 tokens en común (nombre + apellido), o si el miembro tiene
  // un solo token significativo, que ese aparezca.
  return comunes >= 2 || (nm.length === 1 && comunes === 1);
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================
export default function LogbookPanel({ currentUser, equipos = [], vista = "lista", setVista }) {
  const [registros, setRegistros] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [compartirOpen, setCompartirOpen] = useState(false); // modal "compartir"
  const [compartirQue, setCompartirQue] = useState("registros"); // "registros" | "metricas"

  // Formulario / extracción
  const [reg, setReg] = useState({ ...REGISTRO_VACIO });
  const [editId, setEditId] = useState(null);
  const [extrayendo, setExtrayendo] = useState(false);
  const [extraidoOk, setExtraidoOk] = useState(false);
  const [fotos, setFotos] = useState([]); // [{dataUrl, blob, base64}]
  const [guardando, setGuardando] = useState(false);
  // Subida múltiple: cada foto es una CIRUGÍA DISTINTA. `cola` guarda las que faltan
  // por revisar (después de la que está en el formulario); `colaTotal` es el total del lote.
  const [cola, setCola] = useState([]);          // [{ reg, foto }]
  const [colaTotal, setColaTotal] = useState(0);
  const [extractProgreso, setExtractProgreso] = useState(null); // { i, n } mientras la IA lee cada foto
  const [complementoOpen, setComplementoOpen] = useState(false); // sección biopsia/control colapsable
  // Multi-foto: el usuario elige cada vez si cada foto es una cirugía distinta o si
  // todas las fotos son páginas de la MISMA cirugía.
  const [modoFotos, setModoFotos] = useState("distintas"); // "distintas" | "misma"
  // Métricas: criterio de separación y secciones colapsables
  const [criterioMet, setCriterioMet] = useState("todas"); // "todas" | "onco" | "noonco"
  const [metPorCxOpen, setMetPorCxOpen] = useState(false);  // "Métricas por cirugía" colapsado por defecto
  const [procAbierto, setProcAbierto] = useState(null);     // procedimiento expandido (muestra gráfico)
  const [resumenIA, setResumenIA] = useState("");           // resumen escrito por la IA
  const [resumenCargando, setResumenCargando] = useState(false);
  const [resumenError, setResumenError] = useState("");
  // Logbook de equipo: compañeros (para agregar la cirugía a quien participó)
  const [companeros, setCompaneros] = useState([]);
  const [compartidoMsg, setCompartidoMsg] = useState(""); // aviso "agregado también a X, Y"
  const inputFotoRef = useRef(null);   // galería / archivos
  const inputCamaraRef = useRef(null); // cámara directa

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

  // Compañeros de mis equipos (para el logbook de equipo)
  useEffect(() => {
    if (!currentUser) { setCompaneros([]); return; }
    const ids = (equipos || []).map((e) => e.id).filter(Boolean);
    if (ids.length === 0) { setCompaneros([]); return; }
    let vivo = true;
    listarCompanerosEquipo(ids, currentUser.id).then((r) => {
      if (vivo && r.ok) setCompaneros(r.companeros);
    });
    return () => { vivo = false; };
  }, [currentUser, equipos]);

  // Acciones enviadas desde el submenú de la pestaña Logbook
  useEffect(() => {
    const h = (e) => {
      if (e.detail?.tab !== "logbook") return;
      if (e.detail.accion === "compartir") { setCompartirQue(vista === "metricas" ? "metricas" : "registros"); setCompartirOpen(true); }
    };
    window.addEventListener("uro-submenu-accion", h);
    return () => window.removeEventListener("uro-submenu-accion", h);
  }, [vista]);

  // Al entrar a "Nueva" desde el submenú, partir con el formulario limpio
  useEffect(() => {
    if (vista === "nueva" && !editId) resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista]);

  const set = (campo, valor) => setReg((prev) => ({ ...prev, [campo]: valor }));

  // Convierte la respuesta de la IA en un objeto de formulario. El "Nombre de
  // intervención" se autocompleta con el procedimiento detectado (editable).
  const datosAReg = (datos) => {
    const rolDetectado = detectarRol(currentUser?.nombre, datos.cirujano, datos.ayudantes);
    const proc = datos.procedimiento || "";
    return {
      fecha: datos.fecha || new Date().toISOString().slice(0, 10),
      iniciales: datos.iniciales || "",
      ficha_clinica: datos.ficha_clinica || "",
      rut: datos.rut || "",
      edad: datos.edad != null ? String(datos.edad) : "",
      sexo: datos.sexo || "",
      diagnostico_pre: datos.diagnostico_pre || "",
      diagnostico_post: datos.diagnostico_post || "",
      procedimiento: proc,
      intervencion: proc, // autocompletado; el usuario puede cambiarlo
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
    };
  };

  // ─── Fotos → extracción ───
  // Cada imagen se trata como una CIRUGÍA DISTINTA: se extrae por separado y se
  // arma una cola. La primera se carga en el formulario; el resto queda pendiente
  // y se revisa/guarda una tras otra con "Guardar y siguiente".
  const onFotos = async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 6); // hasta 6 cirugías por lote
    if (files.length === 0) return;
    setError("");
    setExtrayendo(true);
    setExtraidoOk(false);
    try {
      const comprimidas = [];
      for (const f of files) comprimidas.push(await comprimirImagen(f));

      if (modoFotos === "misma" || comprimidas.length === 1) {
        // TODAS las fotos son páginas de UNA misma cirugía (o hay una sola foto).
        // Se extraen juntas para que la IA use todas las páginas. La foto queda
        // cargada aunque la extracción falle, para completar los datos a mano.
        setExtractProgreso(null);
        setFotos(comprimidas);
        try {
          const datos = await extraerDeFotos(comprimidas);
          setReg((prev) => ({ ...prev, ...datosAReg(datos) }));
          setExtraidoOk(true);
        } catch (err) {
          setError("No se pudo leer la foto automáticamente. Completa los datos a mano. (" + (err.message || "error") + ")");
        }
        setCola([]); setColaTotal(0);
      } else {
        // Cada foto es una CIRUGÍA DISTINTA: se extrae cada una por separado.
        const drafts = [];
        for (let i = 0; i < comprimidas.length; i++) {
          setExtractProgreso({ i: i + 1, n: comprimidas.length });
          let datos = {};
          try { datos = await extraerDeFotos([comprimidas[i]]); } catch { datos = {}; }
          drafts.push({ reg: { ...REGISTRO_VACIO, ...datosAReg(datos) }, foto: comprimidas[i] });
        }
        setExtractProgreso(null);
        setReg({ ...REGISTRO_VACIO, ...drafts[0].reg }); // primera cirugía al formulario
        setFotos([drafts[0].foto]);
        setCola(drafts.slice(1));                        // el resto, en cola
        setColaTotal(drafts.length);
        setExtraidoOk(true);
      }
    } catch (err) {
      setExtractProgreso(null);
      setError("No se pudo extraer el protocolo automáticamente. Puedes ingresar los datos a mano. (" + (err.message || "error") + ")");
    }
    setExtrayendo(false);
    if (inputFotoRef.current) inputFotoRef.current.value = "";
    if (inputCamaraRef.current) inputCamaraRef.current.value = "";
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
      iniciales: reg.iniciales.trim() || null,
      ficha_clinica: reg.ficha_clinica.trim() || null,
      rut: reg.rut.trim() || null,
      edad: reg.edad ? parseInt(reg.edad) : null,
      sexo: reg.sexo || null,
      diagnostico_pre: reg.diagnostico_pre.trim() || null,
      diagnostico_post: reg.diagnostico_post.trim() || null,
      procedimiento: reg.procedimiento.trim(),
      intervencion: (reg.intervencion?.trim() || reg.procedimiento.trim()) || null,
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
      tamano_litiasis_mm: reg.tamano_litiasis_mm ? parseFloat(reg.tamano_litiasis_mm) : null,
      tamano_prostata_cc: reg.tamano_prostata_cc ? parseFloat(reg.tamano_prostata_cc) : null,
      biopsia_resultado: reg.biopsia_resultado.trim() || null,
      biopsia_isup: reg.biopsia_isup || null,
      control_stone_free: reg.control_stone_free || null,
      control_imagen_detalle: reg.control_imagen_detalle.trim() || null,
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
    // Si hay un paciente hospitalizado con nombre coincidente (sin tildes), le adjunta el protocolo.
    if (!editId) {
      try {
        const tk = (s) => new Set(sinTildes(s || "").replace(/[.,]/g, " ").split(/\s+/).filter((t) => t.length >= 2));
        const nomTk = tk(datos.iniciales);
        if (nomTk.size >= 2) {
          const { data: pacs } = await supabase.from("pacientes").select("id, iniciales").neq("estado", "alta");
          const cand = (pacs || [])
            .map((p) => { const s = tk(p.iniciales); let c = 0; nomTk.forEach((t) => { if (s.has(t)) c++; }); return { p, c }; })
            .filter((x) => x.c >= 2)
            .sort((a, b) => b.c - a.c);
          // Solo adjunta si hay un mejor match claro (único o con más coincidencias que el resto).
          if (cand.length && (cand.length === 1 || cand[0].c > cand[1].c)) {
            const m = cand[0].p;
            const texto = `PROTOCOLO OPERATORIO — ${datos.procedimiento || "Cirugía"}${datos.fecha ? ` (${datos.fecha})` : ""}${datos.cirujano ? `\nCirujano: ${datos.cirujano}` : ""}${datos.ayudantes ? `\nAyudantes: ${datos.ayudantes}` : ""}`;
            await supabase.from("evoluciones").insert({ paciente_id: m.id, autor_id: currentUser.id, texto, tipo: "protocolo" });
          }
        }
      } catch { /* no bloquea el guardado del logbook */ }

      // ── Logbook de equipo: agrega la cirugía a los compañeros que participaron ──
      try {
        setCompartidoMsg("");
        const agregados = [];
        for (const comp of companeros) {
          let rolComp = null;
          if (participaEnTexto(comp.nombre, datos.cirujano)) rolComp = "cirujano";
          else if (participaEnTexto(comp.nombre, datos.ayudantes)) rolComp = "primer_ayudante";
          if (!rolComp) continue;
          // Se le agrega con SU rol; sin foto (el path es del bucket del que subió).
          const r = await agregarLogbookACompanero(comp.id, { ...datos, rol: rolComp });
          if (r.ok && r.id) agregados.push(comp.nombre || "compañero");
        }
        if (agregados.length > 0) {
          setCompartidoMsg(`✓ También se agregó al logbook de ${agregados.join(", ")}.`);
          setTimeout(() => setCompartidoMsg(""), 6000);
        }
      } catch { /* silencioso: nunca bloquea el guardado propio */ }
    }
    // Subida múltiple: si quedan cirugías en la cola, carga la siguiente y se queda en el formulario.
    if (!editId && cola.length > 0) {
      const [siguiente, ...resto] = cola;
      setCola(resto);
      setReg({ ...REGISTRO_VACIO, ...siguiente.reg });
      setFotos([siguiente.foto]);
      setEditId(null);
      setExtraidoOk(true);
      setComplementoOpen(false);
      setError("");
      try { window.scrollTo?.({ top: 0, behavior: "smooth" }); } catch {}
      return;
    }
    resetForm();
    setVista("lista");
  };

  const resetForm = () => {
    setReg({ ...REGISTRO_VACIO });
    setFotos([]);
    setEditId(null);
    setExtraidoOk(false);
    setError("");
    setCola([]); setColaTotal(0);
    setExtractProgreso(null);
  };

  const empezarEdicion = (r) => {
    setEditId(r.id);
    setFotos([]);
    setExtraidoOk(false);
    setReg({
      fecha: r.fecha || new Date().toISOString().slice(0, 10),
      iniciales: r.iniciales || "", ficha_clinica: r.ficha_clinica || "", rut: r.rut || "", edad: r.edad != null ? String(r.edad) : "", sexo: r.sexo || "",
      diagnostico_pre: r.diagnostico_pre || "", diagnostico_post: r.diagnostico_post || "",
      procedimiento: r.procedimiento || "", intervencion: r.intervencion || r.procedimiento || "", categoria: r.categoria || "Otro", lateralidad: r.lateralidad || "",
      rol: r.rol || "cirujano", cirujano: r.cirujano || "", ayudantes: r.ayudantes || "",
      anestesia: r.anestesia || "", hora_inicio: (r.hora_inicio || "").slice(0, 5), hora_termino: (r.hora_termino || "").slice(0, 5),
      duracion_min: r.duracion_min != null ? String(r.duracion_min) : "", sangrado_ml: r.sangrado_ml != null ? String(r.sangrado_ml) : "",
      tamano_litiasis_mm: r.tamano_litiasis_mm != null ? String(r.tamano_litiasis_mm) : "", tamano_prostata_cc: r.tamano_prostata_cc != null ? String(r.tamano_prostata_cc) : "",
      biopsia_resultado: r.biopsia_resultado || "", biopsia_isup: r.biopsia_isup || "",
      control_stone_free: r.control_stone_free || "", control_imagen_detalle: r.control_imagen_detalle || "",
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

  // ─── Exportar CSV (incluye complicaciones y complementos) ───
  const exportarCSV = () => {
    const cols = ["fecha", "iniciales", "ficha_clinica", "rut", "edad", "sexo", "procedimiento", "categoria", "lateralidad", "rol", "cirujano", "ayudantes", "diagnostico_pre", "diagnostico_post", "anestesia", "duracion_min", "sangrado_ml", "tamano_litiasis_mm", "tamano_prostata_cc", "biopsia_resultado", "biopsia_isup", "control_stone_free", "control_imagen_detalle", "complicacion", "clavien", "detalles_complicacion", "hallazgos", "observaciones"];
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
  const prom = (arr) => (arr.length ? Math.round((arr.reduce((s, x) => s + x, 0) / arr.length) * 10) / 10 : null);
  // Mediana: más representativa que el promedio cuando hay un caso extremo
  // (una cirugía muy larga arrastra el promedio; la mediana no).
  const mediana = (arr) => {
    if (!arr.length) return null;
    const a = [...arr].sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    const v = a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
    return Math.round(v * 10) / 10;
  };
  // Devuelve {mediana, prom, n} o null si no hay datos
  const stat = (arr) => (arr.length ? { med: mediana(arr), prom: prom(arr), n: arr.length } : null);
  const met = useMemo(() => {
    // Criterio de separación (oncológicas / no oncológicas / todas)
    const base = criterioMet === "onco" ? registros.filter(esOncologica)
      : criterioMet === "noonco" ? registros.filter((r) => !esOncologica(r))
      : registros;
    const total = base.length;
    const comoCirujano = base.filter((r) => r.rol === "cirujano").length;
    const comoAyudante = base.filter((r) => ROLES_AYUDANTE.includes(r.rol)).length;
    const conComplicacion = base.filter((r) => r.complicacion).length;
    const clavienAlto = base.filter((r) => r.complicacion && ["IIIb", "IVa", "IVb", "V"].includes(r.clavien)).length;
    // Nota: no se calcula una "duración promedio global" — mezclar cirugías
    // heterogéneas da un número que no significa nada. La duración va por procedimiento.
    const conDuracion = base.filter((r) => r.duracion_min > 0).length;
    const onco = registros.filter(esOncologica).length; // conteo global (para el chip del criterio)

    const porCat = {};
    const porProc = {};
    base.forEach((r) => {
      porCat[r.categoria || "Otro"] = (porCat[r.categoria || "Otro"] || 0) + 1;
      const p = familiaProc(r.procedimiento);
      if (!porProc[p]) porProc[p] = { n: 0, cx: 0, ayud: 0, dur: [], sangrado: [], litiasis: [], prostata: [], compl: 0, stoneFree: 0, stoneTotal: 0, durCasos: [], sangradoCasos: [] };
      const v = porProc[p];
      v.n++;
      if (r.rol === "cirujano") v.cx++;
      if (ROLES_AYUDANTE.includes(r.rol)) v.ayud++;
      if (r.duracion_min > 0) { v.dur.push(r.duracion_min); v.durCasos.push({ fecha: r.fecha, val: r.duracion_min }); }
      // Sangrado: un 0 es un dato válido, y un campo vacío también cuenta como 0
      // (no toda cirugía sangra; si hubiera sangrado se habría anotado).
      // Por eso el n del sangrado es siempre el total de cirugías del procedimiento.
      const sg = r.sangrado_ml != null && r.sangrado_ml !== "" ? Number(r.sangrado_ml) : 0;
      v.sangrado.push(sg); v.sangradoCasos.push({ fecha: r.fecha, val: sg });
      if (r.tamano_litiasis_mm > 0) v.litiasis.push(r.tamano_litiasis_mm);
      if (r.tamano_prostata_cc > 0) v.prostata.push(r.tamano_prostata_cc);
      if (r.complicacion) v.compl++;
      if (r.control_stone_free) { v.stoneTotal++; if (r.control_stone_free === "stone_free") v.stoneFree++; }
    });

    const meses = ultimosMeses(12).map((mes) => ({
      mes,
      total: base.filter((r) => mesClave(r.fecha) === mes).length,
      cirujano: base.filter((r) => mesClave(r.fecha) === mes && r.rol === "cirujano").length,
    }));

    // Detalle completo por procedimiento (para tarjetas de métricas)
    const ordenarPorFecha = (a) => [...a].sort((x, y) => (x.fecha || "").localeCompare(y.fecha || ""));
    const detalleProc = Object.entries(porProc)
      .sort((a, b) => b[1].n - a[1].n)
      .map(([label, v]) => ({
        label, n: v.n, cx: v.cx, ayud: v.ayud,
        dur: stat(v.dur), sangrado: stat(v.sangrado),
        litiasis: stat(v.litiasis), prostata: stat(v.prostata),
        durProm: prom(v.dur),   // se mantiene para el orden y el KPI
        compl: v.compl,
        stoneFree: v.stoneTotal > 0 ? { free: v.stoneFree, total: v.stoneTotal } : null,
        durCasos: ordenarPorFecha(v.durCasos),      // puntos para el gráfico de tiempos
        sangradoCasos: ordenarPorFecha(v.sangradoCasos),
      }));

    const topProc = detalleProc.slice(0, 8).map((d) => ({
      label: d.label, n: d.n, extra: d.dur ? `${d.dur.med} min` : null,
    }));

    // Resumen de ayudantías separado por procedimiento
    const ayudantiasPorProc = detalleProc.filter((d) => d.ayud > 0).map((d) => ({ label: d.label, n: d.ayud }));

    const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, n }));

    // Procedimiento más frecuente (reemplaza a la duración promedio global)
    const masFrecuente = detalleProc.length ? detalleProc[0] : null;
    return { total, comoCirujano, comoAyudante, conComplicacion, clavienAlto, conDuracion, masFrecuente, meses, topProc, cats, detalleProc, ayudantiasPorProc, onco };
  }, [registros, criterioMet]);

  // ─── Estilos compartidos ───
  const inp = { width: "100%", padding: "8px 10px", fontSize: "var(--fs-2)", border: "0.5px solid var(--borde)", borderRadius: 8, background: "var(--superficie)", color: "var(--texto)", boxSizing: "border-box", outline: "none" };
  const lbl = { fontSize: "var(--fs-0)", fontWeight: 600, color: "var(--texto-sec)", marginBottom: 3, display: "block" };
  const btnPrim = { padding: "10px 18px", fontSize: 14, fontWeight: 600, background: "var(--primario)", color: "var(--texto-inv)", border: "none", borderRadius: 8, cursor: "pointer" };
  const btnSec = { padding: "10px 14px", fontSize: "var(--fs-2)", background: "var(--superficie)", color: "var(--primario)", border: "0.5px solid var(--borde)", borderRadius: 8, cursor: "pointer" };
  const card = { border: "0.5px solid var(--borde)", borderRadius: 12, padding: "12px 14px", background: "var(--superficie)" };
  const kpi = { ...card, flex: "1 1 130px", textAlign: "center" };
  const campo = (etiqueta, hijo) => (<div><label style={lbl}>{etiqueta}</label>{hijo}</div>);
  const rolLabel = (r) => (ROLES.find(([id]) => id === r) || [r, r])[1];
  // Chip compacto para las métricas por cirugía
  const Chip = ({ label, val, ok, sub }) => (
    <span style={{ fontSize: "var(--fs-0)", padding: "3px 9px", borderRadius: 20, background: ok ? "var(--exito-bg)" : "var(--superficie)", border: "0.5px solid " + (ok ? "var(--exito-borde)" : "var(--borde)"), color: ok ? "var(--exito)" : "var(--texto-sec)", whiteSpace: "nowrap" }}>
      <span style={{ color: "var(--texto-ter)" }}>{label}:</span> <b style={{ color: ok ? "var(--exito)" : "var(--texto)" }}>{val}</b>
      {sub ? <span style={{ color: "var(--texto-ter)", marginLeft: 4, fontSize: 10 }}>({sub})</span> : null}
    </span>
  );

  // ─── Resumen escrito por la IA sobre la casuística (bajo demanda, pocos tokens) ───
  // Se genera solo al entrar a Métricas (una vez por sesión); el botón queda para regenerar.
  const autoResumenRef = useRef(false);
  useEffect(() => {
    if (vista !== "metricas") return;
    if (autoResumenRef.current) return;
    if (!met || met.total === 0) return;
    autoResumenRef.current = true;
    generarResumenIA();
  }, [vista, met]);

  const generarResumenIA = async () => {
    if (resumenCargando) return;
    setResumenCargando(true); setResumenError(""); setResumenIA("");
    try {
      const criterioTxt = criterioMet === "onco" ? "solo cirugías oncológicas" : criterioMet === "noonco" ? "solo cirugías no oncológicas" : "todas las cirugías";
      const lineas = [
        `Casuística (${criterioTxt}). Total: ${met.total}. Como cirujano principal: ${met.comoCirujano}. Como ayudante: ${met.comoAyudante}. Con complicación: ${met.conComplicacion} (Clavien-Dindo alto: ${met.clavienAlto}).`,
        "Por procedimiento (valores = medianas):",
        ...met.detalleProc.map((d) => `- ${d.label}: ${d.n} cx (cirujano ${d.cx}, ayudante ${d.ayud})${d.dur ? `, duración ${d.dur.med} min (n=${d.dur.n})` : ""}${d.sangrado ? `, sangrado ${d.sangrado.med} ml` : ""}${d.litiasis ? `, litiasis ${d.litiasis.med} mm` : ""}${d.prostata ? `, próstata ${d.prostata.med} cc` : ""}${d.stoneFree ? `, stone free ${d.stoneFree.free}/${d.stoneFree.total}` : ""}`),
      ].join("\n");
      const res = await fetch(import.meta.env.VITE_CHAT_FUNCTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${await tokenFuncionIA()}` },
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: 500,
          system: "Eres un urólogo cercano y de buen humor que revisa la casuística de un colega residente. Escribe un resumen MUY breve (2 a 4 frases), cálido y motivador, en español y con un toque simpático pero profesional: cuánto lleva, en qué va más sólido y una sugerencia concreta de qué reforzar. Máximo un emoji. Básate SOLO en los datos entregados, no inventes cifras. Sin markdown ni viñetas.",
          messages: [{ role: "user", content: `Analiza esta casuística de logbook de urología y dame conclusiones:\n\n${lineas}` }],
        }),
      });
      if (!res.ok) throw new Error(`el servidor respondió ${res.status}`);
      const data = await res.json();
      const txt = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      if (!txt) throw new Error("respuesta vacía");
      setResumenIA(txt);
    } catch (e) {
      setResumenError("No se pudo generar el resumen: " + (e.message || "error"));
    }
    setResumenCargando(false);
  };

  // ─── Compartir registros/métricas con el equipo o personas seleccionadas ───
  const [destinatarios, setDestinatarios] = useState([]); // ids seleccionados
  const [equipoDestino, setEquipoDestino] = useState(""); // id de equipo o ""
  const [miembrosCompartir, setMiembrosCompartir] = useState([]);
  const [compartiendo, setCompartiendo] = useState(false);
  const [compartirMsg, setCompartirMsg] = useState("");
  const [recibidos, setRecibidos] = useState([]);          // métricas que otros me compartieron
  const [recibidoAbierto, setRecibidoAbierto] = useState(null);

  const cargarRecibidos = async () => {
    try {
      const { data } = await supabase.from("logbook_compartido")
        .select("*").eq("para_user_id", currentUser.id)
        .order("created_at", { ascending: false }).limit(50);
      setRecibidos(data || []);
    } catch { setRecibidos([]); }
  };
  useEffect(() => { if (currentUser) cargarRecibidos(); /* eslint-disable-next-line */ }, [currentUser]);

  useEffect(() => {
    if (!compartirOpen || !equipoDestino) { setMiembrosCompartir([]); return; }
    (async () => {
      try {
        const { data } = await supabase.from("miembros_equipo").select("user_id, perfiles(id, nombre, correo)").eq("equipo_id", equipoDestino);
        setMiembrosCompartir((data || []).map(m => m.perfiles).filter(p => p && p.id !== currentUser.id));
      } catch { setMiembrosCompartir([]); }
    })();
  }, [compartirOpen, equipoDestino, currentUser.id]);

  const resumenCompartir = () => {
    if (compartirQue === "metricas") {
      const lineas = [
        `Métricas de logbook — ${currentUser.nombre}`,
        `Total: ${met.total} · Como cirujano: ${met.comoCirujano} · Como ayudante: ${met.comoAyudante}`,
        met.masFrecuente ? `Procedimiento más frecuente: ${met.masFrecuente.label} (${met.masFrecuente.n})` : "",
        "",
        "Por procedimiento:",
        ...met.detalleProc.map(d => `• ${d.label}: ${d.n} (cirujano ${d.cx}, ayudante ${d.ayud})${d.dur ? `, mediana ${d.dur.med} min (n=${d.dur.n})` : ""}${d.stoneFree ? `, stone free ${d.stoneFree.free}/${d.stoneFree.total}` : ""}`),
      ];
      return lineas.filter(Boolean).join("\n");
    }
    return `Registros de logbook compartidos por ${currentUser.nombre} (${registros.length} cirugías). Revisa el detalle en la app.`;
  };

  const enviarCompartir = async () => {
    if (destinatarios.length === 0) { setCompartirMsg("⚠️ Selecciona al menos una persona."); return; }
    setCompartiendo(true); setCompartirMsg("");
    const texto = resumenCompartir();
    try {
      // Se guarda el contenido en su propia tabla y la notificación queda corta:
      // el detalle se lee dentro del Logbook, en "Compartido conmigo".
      const filas = destinatarios.map((uid) => ({
        de_user_id: currentUser.id,
        de_nombre: currentUser.nombre,
        para_user_id: uid,
        equipo_id: equipoDestino || null,
        tipo: compartirQue,
        contenido: texto,
      }));
      const { error: errIns } = await supabase.from("logbook_compartido").insert(filas);
      if (errIns) throw errIns;

      for (const uid of destinatarios) {
        await supabase.from("notificaciones").insert({
          user_id: uid,
          texto: `${currentUser.nombre} compartió sus ${compartirQue === "metricas" ? "métricas" : "registros"} de logbook. Ábrelo en Logbook › Compartido conmigo.`,
          tipo: "logbook",
        });
      }
      setCompartirMsg(`✓ Compartido con ${destinatarios.length} persona(s).`);
      setTimeout(() => { setCompartirOpen(false); setDestinatarios([]); setCompartirMsg(""); }, 1200);
    } catch (e) {
      setCompartirMsg("⚠️ No se pudo compartir: " + (e.message || e));
    }
    setCompartiendo(false);
  };

  if (!currentUser) return null;

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", width: "100%", boxSizing: "border-box" }}>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "14px 12px 40px" }}>
      {error && <div style={{ padding: "9px 12px", marginBottom: 10, fontSize: "var(--fs-2)", background: "var(--peligro-bg)", border: "1px solid var(--peligro)", borderRadius: 8, color: "var(--peligro)" }}>{error}</div>}

      {/* ============ VISTA: NUEVA / EDITAR ============ */}
      {vista === "nueva" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Captura */}
          {!editId && (
            <div style={{ ...card, textAlign: "center", borderStyle: "dashed", borderWidth: 1.5, padding: "18px 14px" }}>
              <input ref={inputFotoRef} type="file" accept="image/*,application/pdf" multiple style={{ display: "none" }} onChange={onFotos} />
              <input ref={inputCamaraRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={onFotos} />
              {extrayendo ? (
                <div style={{ fontSize: 14, color: "var(--texto-sec)" }}>
                  <div style={{ fontSize: 26, marginBottom: 6 }}>🔍</div>
                  {extractProgreso ? `Leyendo cirugía ${extractProgreso.i} de ${extractProgreso.n}…` : "Leyendo el protocolo operatorio…"}
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 30, marginBottom: 6 }}>📷</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--texto)", marginBottom: 4 }}>Fotografía o sube los protocolos operatorios</div>
                  <div style={{ fontSize: "var(--fs-1)", color: "var(--texto-ter)", marginBottom: 10 }}>La IA extrae los datos automáticamente (hasta 6 imágenes por lote).</div>
                  {/* Toggle: cada foto es una cirugía distinta, o todas son la misma */}
                  <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 10, flexWrap: "wrap" }}>
                    {[["distintas", "📸 Cada foto = una cirugía"], ["misma", "📄 Varias fotos = misma cirugía"]].map(([id, label]) => {
                      const on = modoFotos === id;
                      return (
                        <button key={id} onClick={() => setModoFotos(id)} style={{ padding: "6px 11px", fontSize: "var(--fs-0)", fontWeight: on ? 700 : 500, borderRadius: 18, cursor: "pointer", border: on ? "none" : "0.5px solid var(--borde)", background: on ? "var(--primario)" : "var(--superficie)", color: on ? "var(--texto-inv)" : "var(--texto-sec)" }}>{label}</button>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                    <button onClick={() => inputCamaraRef.current?.click()} style={btnPrim}>📸 Tomar foto</button>
                    <button onClick={() => inputFotoRef.current?.click()} style={btnSec}>🖼 Galería / archivos</button>
                  </div>
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
            <div style={{ padding: "9px 12px", fontSize: "var(--fs-2)", background: "var(--exito-bg)", border: "1px solid var(--exito)", borderRadius: 8, color: "var(--exito)" }}>
              ✓ Datos extraídos del protocolo. Revísalos y corrige lo que falte antes de guardar.
            </div>
          )}
          {colaTotal > 1 && (
            <div style={{ padding: "9px 12px", fontSize: "var(--fs-2)", background: "var(--primario-bg, var(--superficie))", border: "1px solid var(--primario)", borderRadius: 8, color: "var(--primario)", fontWeight: 600 }}>
              🗂 Cirugía {colaTotal - cola.length} de {colaTotal} · al guardar pasas a la siguiente.
            </div>
          )}

          {/* Formulario */}
          <div style={{ ...card, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            {campo("Fecha *", <input type="date" style={inp} value={reg.fecha} onChange={(e) => set("fecha", e.target.value)} />)}
            <div style={{ gridColumn: "1 / -1" }}>{campo("Nombre completo o iniciales", <input style={inp} value={reg.iniciales} onChange={(e) => set("iniciales", e.target.value.slice(0, 120))} placeholder="Juan Pérez Mora  ·  o JPM" maxLength={120} />)}</div>
            {campo("Ficha clínica (FC)", <input style={inp} value={reg.ficha_clinica} onChange={(e) => set("ficha_clinica", e.target.value.slice(0, 30))} placeholder="123456" />)}
            {campo("RUT", <input style={inp} value={reg.rut} onChange={(e) => set("rut", e.target.value.slice(0, 15))} placeholder="12.345.678-9" />)}
            {campo("Edad", <input type="number" style={inp} value={reg.edad} onChange={(e) => set("edad", e.target.value)} />)}
            {campo("Sexo", (
              <select style={inp} value={reg.sexo} onChange={(e) => set("sexo", e.target.value)}>
                <option value="">—</option><option value="M">Masculino</option><option value="F">Femenino</option>
              </select>
            ))}
            <div style={{ gridColumn: "1 / -1" }}>{campo("Procedimiento *", <input style={inp} value={reg.procedimiento} onChange={(e) => set("procedimiento", e.target.value)} placeholder="Ej: Ureterolitectomía endoscópica láser" />)}</div>
            <div style={{ gridColumn: "1 / -1" }}>{campo("Nombre de intervención", <input style={inp} value={reg.intervencion} onChange={(e) => set("intervencion", e.target.value)} placeholder="Se autocompleta con el procedimiento; puedes cambiarlo" />)}</div>
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
            {campo("Sangrado (ml)", <input type="number" min={0} style={inp} value={reg.sangrado_ml} onChange={(e) => set("sangrado_ml", e.target.value)} placeholder="0 si no sangró" />)}
            {campo("Tamaño litiasis (mm)", <input type="number" step="0.1" style={inp} value={reg.tamano_litiasis_mm} onChange={(e) => set("tamano_litiasis_mm", e.target.value)} placeholder="Ej: 12" />)}
            {campo("Tamaño próstata (cc)", <input type="number" step="0.1" style={inp} value={reg.tamano_prostata_cc} onChange={(e) => set("tamano_prostata_cc", e.target.value)} placeholder="Ej: 55" />)}
            <div style={{ gridColumn: "1 / -1" }}>{campo("Diagnóstico preoperatorio", <input style={inp} value={reg.diagnostico_pre} onChange={(e) => set("diagnostico_pre", e.target.value)} />)}</div>
            <div style={{ gridColumn: "1 / -1" }}>{campo("Diagnóstico postoperatorio", <input style={inp} value={reg.diagnostico_post} onChange={(e) => set("diagnostico_post", e.target.value)} />)}</div>
            <div style={{ gridColumn: "1 / -1" }}>{campo("Hallazgos", <textarea rows={2} style={{ ...inp, resize: "vertical" }} value={reg.hallazgos} onChange={(e) => set("hallazgos", e.target.value)} />)}</div>
            <div style={{ gridColumn: "1 / -1" }}>{campo("Técnica (resumen)", <textarea rows={2} style={{ ...inp, resize: "vertical" }} value={reg.tecnica} onChange={(e) => set("tecnica", e.target.value)} />)}</div>

            {/* Complemento posterior: biopsia / control imagenológico (colapsable) */}
            <div style={{ gridColumn: "1 / -1", marginTop: 2 }}>
              <button type="button" onClick={() => setComplementoOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", fontSize: "var(--fs-1)", fontWeight: 600, borderRadius: 8, cursor: "pointer", border: "0.5px solid var(--borde)", background: "var(--fondo-suave)", color: "var(--primario)" }}>
                🔬 Complementar después (biopsia / control) {complementoOpen ? "▴" : "▾"}
              </button>
              {complementoOpen && (
                <div style={{ marginTop: 8, padding: "10px 12px", border: "0.5px solid var(--borde)", borderRadius: 10, background: "var(--superficie)", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                  <div style={{ gridColumn: "1 / -1", fontSize: "var(--fs-0)", color: "var(--texto-ter)", lineHeight: 1.4 }}>Puedes dejar esto vacío ahora y editarlo cuando llegue la biopsia o el control con imagen (p.ej. para saber si quedó <i>stone free</i>).</div>
                  {campo("Resultado de biopsia", <input style={inp} value={reg.biopsia_resultado} onChange={(e) => set("biopsia_resultado", e.target.value)} placeholder="Ej: Adenocarcinoma acinar" />)}
                  {campo("ISUP (si aplica)", (
                    <select style={inp} value={reg.biopsia_isup} onChange={(e) => set("biopsia_isup", e.target.value)}>
                      <option value="">—</option>{["1", "2", "3", "4", "5"].map((g) => <option key={g} value={g}>ISUP {g}</option>)}
                    </select>
                  ))}
                  {campo("Control con imagen (stone free)", (
                    <select style={inp} value={reg.control_stone_free} onChange={(e) => set("control_stone_free", e.target.value)}>
                      <option value="">—</option>
                      <option value="stone_free">✓ Stone free</option>
                      <option value="fragmento_residual">Fragmento residual</option>
                      <option value="pendiente">Pendiente de control</option>
                    </select>
                  ))}
                  <div style={{ gridColumn: "1 / -1" }}>{campo("Detalle del control imagenológico", <input style={inp} value={reg.control_imagen_detalle} onChange={(e) => set("control_imagen_detalle", e.target.value)} placeholder="Ej: UroTAC a las 6 semanas, sin litiasis residual" />)}</div>
                </div>
              )}
            </div>

            {/* Complicación: NO aparece de entrada; se agrega con este botón */}
            <div style={{ gridColumn: "1 / -1" }}>
              {!reg.complicacion ? (
                <button type="button" onClick={() => set("complicacion", true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", fontSize: "var(--fs-1)", fontWeight: 600, borderRadius: 8, cursor: "pointer", border: "0.5px solid var(--borde)", background: "var(--fondo-suave)", color: "var(--texto-sec)" }}>
                  ⚠️ Agregar complicación
                </button>
              ) : (
                <div style={{ padding: "10px 12px", border: "0.5px solid var(--peligro)", borderRadius: 10, background: "var(--peligro-bg)", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: "var(--fs-2)", fontWeight: 600, color: "var(--peligro)" }}>⚠️ Complicación</span>
                    <select style={{ ...inp, width: "auto" }} value={reg.clavien} onChange={(e) => set("clavien", e.target.value)}>
                      {CLAVIEN.map((c) => <option key={c} value={c}>{c ? `Clavien-Dindo ${c}` : "Clavien-Dindo…"}</option>)}
                    </select>
                    <button type="button" onClick={() => { set("complicacion", false); set("clavien", ""); set("detalles_complicacion", ""); }} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--peligro)", cursor: "pointer", fontSize: "var(--fs-1)", fontWeight: 600 }}>Quitar</button>
                  </div>
                  {campo("Detalle de la complicación", <textarea rows={2} style={{ ...inp, resize: "vertical" }} value={reg.detalles_complicacion} onChange={(e) => set("detalles_complicacion", e.target.value)} />)}
                </div>
              )}
            </div>
            <div style={{ gridColumn: "1 / -1" }}>{campo("Observaciones (JJ, sonda, drenajes, biopsias…)", <textarea rows={2} style={{ ...inp, resize: "vertical" }} value={reg.observaciones} onChange={(e) => set("observaciones", e.target.value)} />)}</div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={guardar} disabled={guardando || extrayendo} style={{ ...btnPrim, opacity: guardando ? 0.6 : 1 }}>
              {guardando ? "Guardando…" : editId ? "Guardar cambios" : (cola.length > 0 ? `Guardar y siguiente (${colaTotal - cola.length}/${colaTotal})` : "Guardar en mi logbook")}
            </button>
            <button onClick={() => { resetForm(); setVista("lista"); }} style={btnSec}>Cancelar</button>
          </div>
        </div>
      )}

      {/* ─── Métricas que otros me compartieron ─── */}
      {vista === "lista" && recibidos.length > 0 && (
        <div style={{ ...card, marginBottom: 12, borderLeft: "3px solid var(--primario)" }}>
          <div style={{ fontSize: "var(--fs-2)", fontWeight: 700, color: "var(--texto)", marginBottom: 8 }}>🔗 Compartido conmigo ({recibidos.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {recibidos.map((r) => {
              const abierto = recibidoAbierto === r.id;
              return (
                <div key={r.id} style={{ border: "0.5px solid var(--borde)", borderRadius: 8, padding: "9px 11px", background: "var(--fondo-suave)" }}>
                  <div onClick={() => setRecibidoAbierto(abierto ? null : r.id)} style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "var(--fs-2)", fontWeight: 600, color: "var(--texto)" }}>{r.de_nombre || "Un colega"}</div>
                      <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)" }}>
                        {r.tipo === "metricas" ? "📊 Métricas" : "📋 Registros"} · {new Date(r.created_at).toLocaleDateString("es-CL", { day: "numeric", month: "short" })}
                      </div>
                    </div>
                    <span style={{ fontSize: "var(--fs-1)", color: "var(--primario)", flexShrink: 0 }}>{abierto ? "▴ Ocultar" : "▾ Ver"}</span>
                  </div>
                  {abierto && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "0.5px solid var(--borde)", fontSize: "var(--fs-1)", color: "var(--texto)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                      {r.contenido}
                    </div>
                  )}
                </div>
              );
            })}
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

          {cargando && <div style={{ fontSize: "var(--fs-2)", color: "var(--texto-sec)", textAlign: "center", padding: 20 }}>Cargando registros…</div>}

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
                  <div style={{ fontSize: "var(--fs-1)", color: "var(--texto-sec)", marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span>📅 {r.fecha}</span>
                    {r.iniciales && <span>👤 {r.iniciales}{r.edad != null ? `, ${r.edad}a` : ""}</span>}
                    {r.ficha_clinica && <span>FC {r.ficha_clinica}</span>}
                    {r.rut && <span>{r.rut}</span>}
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
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "0.5px solid var(--borde)", fontSize: "var(--fs-1)", color: "var(--texto)", display: "flex", flexDirection: "column", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                  {r.categoria && <div><b>Categoría:</b> {r.categoria}</div>}
                  {r.diagnostico_pre && <div><b>Dg. preop:</b> {r.diagnostico_pre}</div>}
                  {r.diagnostico_post && <div><b>Dg. postop:</b> {r.diagnostico_post}</div>}
                  {(r.cirujano || r.ayudantes) && <div><b>Equipo:</b> {r.cirujano}{r.ayudantes ? ` · Ayudantes: ${r.ayudantes}` : ""}</div>}
                  {r.anestesia && <div><b>Anestesia:</b> {r.anestesia}</div>}
                  {(r.hora_inicio || r.sangrado_ml != null) && <div>{r.hora_inicio && <><b>Horario:</b> {(r.hora_inicio || "").slice(0, 5)}–{(r.hora_termino || "").slice(0, 5)}  </>}{r.sangrado_ml != null && <><b>Sangrado:</b> {r.sangrado_ml} ml</>}</div>}
                  {(r.tamano_litiasis_mm != null || r.tamano_prostata_cc != null) && <div>{r.tamano_litiasis_mm != null && <><b>Litiasis:</b> {r.tamano_litiasis_mm} mm  </>}{r.tamano_prostata_cc != null && <><b>Próstata:</b> {r.tamano_prostata_cc} cc</>}</div>}
                  {(r.biopsia_resultado || r.biopsia_isup) && <div><b>Biopsia:</b> {r.biopsia_resultado}{r.biopsia_isup ? ` (ISUP ${r.biopsia_isup})` : ""}</div>}
                  {r.control_stone_free && <div><b>Control:</b> {r.control_stone_free === "stone_free" ? "✓ Stone free" : r.control_stone_free === "fragmento_residual" ? "Fragmento residual" : "Pendiente"}{r.control_imagen_detalle ? ` — ${r.control_imagen_detalle}` : ""}</div>}
                  {r.hallazgos && <div><b>Hallazgos:</b> {r.hallazgos}</div>}
                  {r.tecnica && <div><b>Técnica:</b> {r.tecnica}</div>}
                  {r.detalles_complicacion && <div style={{ color: "var(--peligro)" }}><b>Complicación:</b> {r.detalles_complicacion}</div>}
                  {r.observaciones && <div><b>Obs:</b> {r.observaciones}</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    {r.foto_path && <button onClick={() => verFoto(r.foto_path)} style={{ ...btnSec, padding: "6px 12px", fontSize: "var(--fs-1)" }}>🖼 Ver protocolo</button>}
                    <button onClick={() => empezarEdicion(r)} style={{ ...btnSec, padding: "6px 12px", fontSize: "var(--fs-1)" }}>✏️ Editar</button>
                    <button onClick={() => eliminar(r)} style={{ ...btnSec, padding: "6px 12px", fontSize: "var(--fs-1)", color: "var(--peligro)" }}>🗑 Eliminar</button>
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
          {/* Criterio de separación de la casuística */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {[["todas", "Todas"], ["onco", "Oncológicas"], ["noonco", "No oncológicas"]].map(([id, label]) => {
              const on = criterioMet === id;
              return (
                <button key={id} onClick={() => { setCriterioMet(id); setProcAbierto(null); setResumenIA(""); }} style={{ padding: "6px 12px", fontSize: "var(--fs-1)", fontWeight: on ? 700 : 500, borderRadius: 20, cursor: "pointer", border: on ? "none" : "0.5px solid var(--borde)", background: on ? "var(--primario)" : "var(--superficie)", color: on ? "var(--texto-inv)" : "var(--texto-sec)" }}>
                  {label}{id === "onco" ? ` (${met.onco})` : ""}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={kpi}>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--primario)" }}>{met.total}</div>
              <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-sec)" }}>Cirugías registradas</div>
            </div>
            <div style={kpi}>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--exito)" }}>{met.comoCirujano}</div>
              <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-sec)" }}>Como cirujano principal{met.total > 0 ? ` (${Math.round((met.comoCirujano / met.total) * 100)}%)` : ""}</div>
            </div>
            <div style={kpi}>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--primario)" }}>{met.comoAyudante}</div>
              <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-sec)" }}>Como ayudante{met.total > 0 ? ` (${Math.round((met.comoAyudante / met.total) * 100)}%)` : ""}</div>
            </div>
            <div style={kpi}>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--alerta)" }}>{registros.filter(r => r.fecha && (Date.now() - new Date(r.fecha).getTime()) < 30 * 864e5).length}</div>
              <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-sec)" }}>Últimos 30 días</div>
            </div>
            <div style={{ ...kpi, minWidth: 180 }}>
              <div style={{ fontSize: "var(--fs-3)", fontWeight: 700, color: "var(--primario)", lineHeight: 1.25 }}>{met.masFrecuente ? met.masFrecuente.label : "—"}</div>
              <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-sec)", marginTop: 3 }}>Procedimiento más frecuente{met.masFrecuente ? ` (${met.masFrecuente.n})` : ""}</div>
            </div>
          </div>

          <div style={card}>
            <div style={{ fontSize: "var(--fs-2)", fontWeight: 600, color: "var(--texto)", marginBottom: 8 }}>
              Volumen mensual (últimos 12 meses)
              <span style={{ fontSize: "var(--fs-0)", fontWeight: 400, color: "var(--texto-ter)", marginLeft: 8 }}>■ como cirujano · <span style={{ opacity: 0.4 }}>■</span> total</span>
            </div>
            <BarrasMensuales datos={met.meses} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
            <div style={card}>
              <div style={{ fontSize: "var(--fs-2)", fontWeight: 600, color: "var(--texto)", marginBottom: 10 }}>Procedimientos más frecuentes</div>
              <BarrasHorizontales items={met.topProc} />
            </div>
            <div style={card}>
              <div style={{ fontSize: "var(--fs-2)", fontWeight: 600, color: "var(--texto)", marginBottom: 10 }}>Ayudantías por procedimiento</div>
              <BarrasHorizontales items={met.ayudantiasPorProc} color="var(--alerta)" />
            </div>
            <div style={card}>
              <div style={{ fontSize: "var(--fs-2)", fontWeight: 600, color: "var(--texto)", marginBottom: 10 }}>Por categoría</div>
              <BarrasHorizontales items={met.cats} color="var(--exito)" />
            </div>
          </div>

          {/* Métricas por cirugía: colapsadas; cada procedimiento se despliega y muestra su gráfico */}
          <div style={card}>
            <button onClick={() => setMetPorCxOpen((o) => !o)} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", padding: 0, cursor: "pointer" }}>
              <span style={{ fontSize: "var(--fs-2)", fontWeight: 600, color: "var(--texto)" }}>Métricas por cirugía {met.detalleProc.length > 0 ? `(${met.detalleProc.length})` : ""}</span>
              <span style={{ fontSize: 14, color: "var(--primario)" }}>{metPorCxOpen ? "▴" : "▾"}</span>
            </button>
            {metPorCxOpen && (
              met.detalleProc.length === 0 ? (
                <div style={{ fontSize: "var(--fs-1)", color: "var(--texto-ter)", marginTop: 10 }}>Sin datos aún.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                  {met.detalleProc.map((d) => {
                    const abierto = procAbierto === d.label;
                    return (
                      <div key={d.label} style={{ border: "0.5px solid var(--borde)", borderRadius: 10, background: "var(--fondo-suave)", overflow: "hidden" }}>
                        <button onClick={() => setProcAbierto(abierto ? null : d.label)} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, padding: "10px 12px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                          <span style={{ fontSize: "var(--fs-2)", fontWeight: 600, color: "var(--texto)" }}>{d.label}</span>
                          <span style={{ fontSize: "var(--fs-1)", color: "var(--texto-sec)", fontWeight: 600, flexShrink: 0 }}>{d.n} cx {abierto ? "▴" : "▾"}</span>
                        </button>
                        {abierto && (
                          <div style={{ padding: "0 12px 12px" }}>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                              <Chip label="Cirujano" val={d.cx} />
                              {d.ayud > 0 && <Chip label="Ayudante" val={d.ayud} />}
                              {d.dur && <Chip label="Duración" val={`${d.dur.med} min`} sub={`n=${d.dur.n}`} />}
                              {d.sangrado && <Chip label="Sangrado" val={`${d.sangrado.med} ml`} sub={`n=${d.sangrado.n}`} />}
                              {d.litiasis && <Chip label="Litiasis" val={`${d.litiasis.med} mm`} sub={`n=${d.litiasis.n}`} />}
                              {d.prostata && <Chip label="Próstata" val={`${d.prostata.med} cc`} sub={`n=${d.prostata.n}`} />}
                              {d.compl > 0 && <Chip label="Complic." val={d.compl} />}
                              {d.stoneFree && <Chip label="Stone free" val={`${d.stoneFree.free}/${d.stoneFree.total}`} ok />}
                            </div>
                            {d.durCasos.length > 0 ? (
                              <div>
                                <div style={{ fontSize: "var(--fs-0)", fontWeight: 600, color: "var(--texto-sec)", marginBottom: 2 }}>Tiempo operatorio por cirugía (orden cronológico)</div>
                                <Dispersion puntos={d.durCasos} unidad="min" mediana={d.dur ? d.dur.med : null} />
                              </div>
                            ) : (
                              <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)" }}>Sin tiempos operatorios registrados para graficar.</div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </div>

          {/* Resumen escrito por la IA */}
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: resumenIA || resumenError ? 8 : 0 }}>
              <span style={{ fontSize: "var(--fs-2)", fontWeight: 600, color: "var(--texto)" }}>🧠 Resumen de la casuística</span>
              <button onClick={generarResumenIA} disabled={resumenCargando || met.total === 0} style={{ ...btnSec, padding: "6px 12px", fontSize: "var(--fs-1)", opacity: resumenCargando || met.total === 0 ? 0.6 : 1 }}>{resumenCargando ? "Generando…" : resumenIA ? "↻ Regenerar" : "Generar resumen"}</button>
            </div>
            {resumenError && <div style={{ fontSize: "var(--fs-1)", color: "var(--peligro)" }}>{resumenError}</div>}
            {resumenIA && <div style={{ fontSize: "var(--fs-2)", color: "var(--texto)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{resumenIA}</div>}
            {!resumenIA && !resumenError && !resumenCargando && <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)" }}>La IA analiza tus medianas y conteos (no envía fotos) y escribe conclusiones sobre este logbook. Consume muy pocos tokens.</div>}
          </div>

          {registros.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={exportarCSV} style={{ ...btnSec, alignSelf: "flex-start" }}>⬇ Exportar todo a CSV (para tu casuística)</button>
              <button onClick={() => { setCompartirQue("metricas"); setCompartirOpen(true); }} style={{ ...btnSec, alignSelf: "flex-start" }}>🔗 Compartir métricas</button>
            </div>
          )}
        </div>
      )}

      {/* ─── Aviso: cirugía agregada al logbook de compañeros ─── */}
      {compartidoMsg && (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: 18, zIndex: 1100, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
          <div style={{ background: "var(--exito-bg, var(--superficie))", border: "1px solid var(--exito)", color: "var(--exito)", borderRadius: 10, padding: "9px 14px", fontSize: "var(--fs-2)", fontWeight: 600, boxShadow: "0 8px 20px rgba(0,0,0,0.2)", maxWidth: "90%" }}>{compartidoMsg}</div>
        </div>
      )}

      {/* ─── Visor de foto ─── */}
      {fotoUrl && (
        <div onClick={() => setFotoUrl(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, cursor: "zoom-out" }}>
          <img src={fotoUrl} alt="Protocolo operatorio" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 8 }} />
        </div>
      )}

      {/* ─── Modal: compartir registros / métricas ─── */}
      {compartirOpen && (
        <div onClick={() => setCompartirOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--fondo)", border: "0.5px solid var(--borde)", borderRadius: 14, padding: 20, width: "100%", maxWidth: 460, maxHeight: "85vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--texto)" }}>🔗 Compartir</div>
              <button onClick={() => setCompartirOpen(false)} style={{ background: "none", border: "none", fontSize: 20, color: "var(--texto-ter)", cursor: "pointer", lineHeight: 1 }}>✕</button>
            </div>

            {/* Qué compartir */}
            <div style={{ display: "flex", gap: 6, margin: "10px 0 14px" }}>
              {[["registros", "📋 Registros"], ["metricas", "📊 Métricas"]].map(([id, label]) => (
                <button key={id} onClick={() => setCompartirQue(id)} style={{ flex: 1, padding: "8px", fontSize: "var(--fs-1)", fontWeight: 600, borderRadius: 8, cursor: "pointer", border: compartirQue === id ? "none" : "0.5px solid var(--borde)", background: compartirQue === id ? "var(--primario)" : "var(--superficie)", color: compartirQue === id ? "var(--texto-inv)" : "var(--texto-sec)" }}>{label}</button>
              ))}
            </div>

            {/* Elegir equipo */}
            <label style={lbl}>Equipo</label>
            <select style={{ ...inp, marginBottom: 12 }} value={equipoDestino} onChange={(e) => { setEquipoDestino(e.target.value); setDestinatarios([]); }}>
              <option value="">— Selecciona un equipo —</option>
              {equipos.map((eq) => <option key={eq.id} value={eq.id}>{eq.nombre}</option>)}
            </select>

            {/* Personas del equipo */}
            {equipoDestino && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <label style={{ ...lbl, marginBottom: 0 }}>Personas</label>
                  {miembrosCompartir.length > 0 && (
                    <button onClick={() => setDestinatarios(destinatarios.length === miembrosCompartir.length ? [] : miembrosCompartir.map(m => m.id))} style={{ background: "none", border: "none", color: "var(--primario)", fontSize: "var(--fs-0)", cursor: "pointer", fontWeight: 600 }}>
                      {destinatarios.length === miembrosCompartir.length ? "Ninguno" : "Todo el equipo"}
                    </button>
                  )}
                </div>
                {miembrosCompartir.length === 0 ? (
                  <div style={{ fontSize: "var(--fs-1)", color: "var(--texto-ter)", marginBottom: 12 }}>Este equipo no tiene otros miembros.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12, maxHeight: 200, overflowY: "auto" }}>
                    {miembrosCompartir.map((m) => {
                      const on = destinatarios.includes(m.id);
                      return (
                        <div key={m.id} onClick={() => setDestinatarios(on ? destinatarios.filter(x => x !== m.id) : [...destinatarios, m.id])} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 8, cursor: "pointer", background: on ? "var(--exito-bg)" : "var(--superficie)", border: "0.5px solid " + (on ? "var(--exito-borde)" : "var(--borde)") }}>
                          <span style={{ width: 17, height: 17, borderRadius: 4, flexShrink: 0, border: "1px solid " + (on ? "var(--exito)" : "var(--borde)"), background: on ? "var(--exito)" : "transparent", color: "var(--texto-inv)", fontSize: "var(--fs-1)", display: "flex", alignItems: "center", justifyContent: "center" }}>{on ? "✓" : ""}</span>
                          <span style={{ fontSize: "var(--fs-2)", color: "var(--texto)" }}>{m.nombre}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {compartirMsg && <div style={{ fontSize: "var(--fs-1)", padding: "8px 10px", borderRadius: 8, marginBottom: 10, background: compartirMsg.startsWith("✓") ? "var(--exito-bg)" : "var(--peligro-bg)", color: compartirMsg.startsWith("✓") ? "var(--exito)" : "var(--peligro)", border: "0.5px solid " + (compartirMsg.startsWith("✓") ? "var(--exito-borde)" : "var(--peligro)") }}>{compartirMsg}</div>}

            <button onClick={enviarCompartir} disabled={compartiendo || destinatarios.length === 0} style={{ ...btnPrim, width: "100%", opacity: (compartiendo || destinatarios.length === 0) ? 0.6 : 1 }}>
              {compartiendo ? "Compartiendo…" : `Compartir ${compartirQue === "metricas" ? "métricas" : "registros"}`}
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

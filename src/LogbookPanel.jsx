// ============================================================
// LOGBOOK QUIRÚRGICO PERSONAL
// - Foto del protocolo operatorio → extracción automática con IA
// - Revisión/edición manual antes de guardar
// - Métricas de la casuística personal (KPIs + gráficos SVG)
// Estilo: mismas CSS vars y patrones del resto de UroSearch.
// ============================================================
import { useState, useRef, useEffect, useMemo, useCallback, Fragment } from "react";
import {
  listarLogbook, crearRegistroLogbook, actualizarRegistroLogbook,
  eliminarRegistroLogbook, subirFotoLogbook, obtenerUrlFoto, eliminarFotoLogbook,
  listarCompanerosEquipo, agregarLogbookACompanero,
} from "./logbook";
import { supabase } from "./supabase";
import { uroToast, uroConfirm } from "./ui";

// Token para la Edge Function de IA: usa la sesión del usuario (la función
// valida que el usuario exista y esté aprobado antes de llamar a Anthropic).
async function tokenFuncionIA() {
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.access_token) return data.session.access_token;
  } catch {}
  return import.meta.env.VITE_SUPABASE_ANON_KEY;
}

const CATEGORIAS_LOGBOOK = ["Endourología", "Laparoscopía", "Cirugía abierta", "Cistoscopía", "Biopsia prostática", "Uretra / genital", "Procedimiento de box", "Otro"];

// ─── Lugar de realización ─────────────────────────────────────────
// El mismo procedimiento cuenta distinto según dónde se hizo: una cistoscopía
// en pabellón es actividad quirúrgica y en box es procedimiento ambulatorio.
// Mezclarlos infla la casuística de pabellón, así que el lugar es un campo
// aparte y no una categoría.
const LUGARES_LOGBOOK = [["pabellon", "🔪 Pabellón"], ["box", "🏥 Box / policlínico"]];
const LABEL_LUGAR = Object.fromEntries(LUGARES_LOGBOOK);
const esBox = (r) => (r?.lugar || "pabellon") === "box";

// Procedimientos que típicamente se hacen en box. Se ofrecen como atajo al
// elegir ese lugar; el campo sigue siendo texto libre.
const PROCEDIMIENTOS_BOX = [
  "Cistostomía",
  "Cambio de cistostomía",
  "Cistoscopía diagnóstica",
  "Cistografía",
  "Uretrocistografía retrógrada",
  "Uretrocistografía miccional",
  "Biopsia prostática transrectal",
  "Biopsia prostática transperineal",
  "Instilación intravesical",
  "Cateterismo uretral dificultoso",
  "Retiro de catéter JJ",
  "Dilatación uretral",
];
const ROLES = [["cirujano", "Cirujano principal"], ["primer_ayudante", "1er ayudante"], ["segundo_ayudante", "2do ayudante"], ["tercer_ayudante", "3er ayudante"], ["cuarto_ayudante", "4to ayudante"], ["observador", "Observador"]];
const ROLES_AYUDANTE = ["primer_ayudante", "segundo_ayudante", "tercer_ayudante", "cuarto_ayudante"]; // cuentan como "ayudante" en las métricas

// Filtros de rol disponibles en las métricas
const FILTROS_ROL = [
  ["todos", "Todos"],
  ["cirujano", "Cirujano principal"],
  ["ayudante", "Cualquier ayudantía"],
  ["primer_ayudante", "1er ayudante"],
  ["segundo_ayudante", "2do ayudante"],
  ["tercer_ayudante", "3er ayudante"],
  ["cuarto_ayudante", "4to ayudante"],
  ["observador", "Observador"],
];
const ES_FILTRO_AYUDANTE = ["ayudante", "primer_ayudante", "segundo_ayudante", "tercer_ayudante", "cuarto_ayudante"];
const cumpleRol = (r, filtro) =>
  filtro === "todos" ? true
  : filtro === "ayudante" ? ROLES_AYUDANTE.includes(r.rol)
  : r.rol === filtro;

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
  // Si no calza con ninguna familia conocida, se normaliza fuerte para que las
  // variantes de escritura del MISMO procedimiento terminen en el mismo grupo:
  // se quitan la vía de abordaje, los conectores y la puntuación.
  const limpio = t
    .replace(/\b(laparoscopic[ao]|laparoscopia|videolaparoscopic[ao]|robotic[ao]|asistida\s*por\s*robot|abiert[ao]|endoscopic[ao]|percutane[ao]|transuretral|retroperitoneoscopic[ao]|mano\s*asistida|video\s*asistida)\b/g, " ")
    .replace(/\b(cirugia|operacion|procedimiento)\s+(de|del|de\s*la)?\s*/g, " ")
    .replace(/\b(de|del|la|el|los|las|por|con|via|mas|y)\b/g, " ")
    .replace(/[.,;:()\-]+/g, " ")
    .replace(/s\b/g, "")            // singular/plural no separan
    .replace(/\s+/g, " ")
    .trim();
  if (!limpio) return "Sin especificar";
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}
// ─── Clasificación de complicaciones ──────────────────────────────
// Una sola escala: Clavien-Dindo, aplicada tanto a lo intraoperatorio como a
// lo post-operatorio. El momento se elige aparte porque cambia la lectura de la
// casuística (una lesión en pabellón y una fístula al séptimo día no son lo
// mismo aunque compartan grado), pero la escala es la misma.
//
// Aparte queda el incidente sin consecuencia para el paciente (falla de un
// instrumento, de un insumo): se registra para tenerlo a la vista, pero no es
// una complicación y no entra en el numerador.
const GRADOS_CLAVIEN = [
  { v: "ninguno",   complicacion: false, escala: null,        grado: null,   label: "Sin complicación" },
  { v: "incidente", complicacion: false, escala: "incidente", grado: null,   label: "Incidente sin consecuencia (equipo, insumo) — no cuenta como complicación" },
  { v: "I",    complicacion: true, escala: "clavien", grado: "I",    label: "Clavien I — desviación menor, sin tratamiento" },
  { v: "II",   complicacion: true, escala: "clavien", grado: "II",   label: "Clavien II — tratamiento farmacológico o transfusión" },
  { v: "IIIa", complicacion: true, escala: "clavien", grado: "IIIa", label: "Clavien IIIa — intervención sin anestesia general" },
  { v: "IIIb", complicacion: true, escala: "clavien", grado: "IIIb", label: "Clavien IIIb — intervención con anestesia general" },
  { v: "IVa",  complicacion: true, escala: "clavien", grado: "IVa",  label: "Clavien IVa — disfunción de un órgano (UCI)" },
  { v: "IVb",  complicacion: true, escala: "clavien", grado: "IVb",  label: "Clavien IVb — disfunción multiorgánica" },
  { v: "V",    complicacion: true, escala: "clavien", grado: "V",    label: "Clavien V — fallecimiento" },
];
const GRADO_POR_VALOR = Object.fromEntries(GRADOS_CLAVIEN.map((e) => [e.v, e]));
const MOMENTOS_COMPLICACION = [["intraoperatoria", "🔪 Intraoperatoria"], ["postoperatoria", "🏥 Post-operatoria"]];

function valorEvento(r) {
  if (r?.escala_complicacion === "incidente") return "incidente";
  if (!r?.complicacion) return "ninguno";
  return GRADO_POR_VALOR[String(r.clavien || "")] ? String(r.clavien) : "I";
}

function etiquetaEvento(r) {
  if (r?.escala_complicacion === "incidente") return "Incidente · sin consecuencia";
  if (!r?.complicacion) return "";
  const m = r.momento_complicacion || "intraoperatoria";
  const mm = m === "postoperatoria" ? "Post-op" : m === "ambas" ? "Intra+post" : "Intraop";
  return r.clavien ? `${mm} · CD ${r.clavien}` : mm;
}

// Complicación MAYOR: Clavien-Dindo ≥ IIIa, es decir, la que requirió alguna
// intervención. Es la cifra que se reporta; la tasa global mezcla un íleo con
// una reintervención.
const esMayor = (r) => !!r?.complicacion && ["IIIa", "IIIb", "IVa", "IVb", "V"].includes(String(r.clavien || ""));
const esIncidente = (r) => r?.escala_complicacion === "incidente";

// Identidad estable de un grupo de posibles duplicados: los ids de sus
// registros, ordenados. No depende del agrupador de procedimientos ni de los
// alias, así que un grupo descartado sigue descartado tras actualizar la app.
const claveIds = (items) => "ids:" + items.map((r) => String(r.id)).sort().join("-");

// "No aplica" es una respuesta válida al registrar, pero no aporta nada impresa
// junto al nombre del procedimiento.
const latTxt = (r) => (r?.lateralidad && r.lateralidad !== "No aplica" ? r.lateralidad : "");

// Campos que van a la base para una opción del selector. Una sola fuente de
// verdad para el formulario y para el editor rápido del listado.
function camposEvento(v, detalle, momento) {
  const e = GRADO_POR_VALOR[v] || GRADO_POR_VALOR.ninguno;
  const hay = v !== "ninguno";
  return {
    complicacion: e.complicacion,
    clavien: e.grado || null,
    escala_complicacion: e.escala || null,
    momento_complicacion: hay ? (momento || "intraoperatoria") : null,
    detalles_complicacion: hay ? ((detalle || "").trim() || null) : null,
  };
}

// Aplica el grado elegido a los campos del formulario en un solo gesto.
function aplicarEvento(set, v) {
  const e = GRADO_POR_VALOR[v] || GRADO_POR_VALOR.ninguno;
  set("complicacion", e.complicacion);
  set("clavien", e.grado || "");
  set("escala_complicacion", e.escala || "");
  if (v === "ninguno") { set("detalles_complicacion", ""); set("momento_complicacion", "intraoperatoria"); }
}

const LABEL_MOMENTO = { intraoperatoria: "Intraoperatoria", postoperatoria: "Post-operatoria", ambas: "Intra y post-operatoria" };
const esIntra = (r) => !!r.complicacion && (r.momento_complicacion || "intraoperatoria") !== "postoperatoria";
const esPost = (r) => !!r.complicacion && ["postoperatoria", "ambas"].includes(r.momento_complicacion || "intraoperatoria");

const REGISTRO_VACIO = {
  fecha: new Date().toISOString().slice(0, 10),
  iniciales: "", ficha_clinica: "", rut: "", edad: "", sexo: "", diagnostico_pre: "", diagnostico_post: "",
  procedimiento: "", intervencion: "", categoria: "", lateralidad: "", rol: "cirujano", lugar: "pabellon",
  cirujano: "", ayudantes: "", anestesia: "", hora_inicio: "", hora_termino: "",
  duracion_min: "", sangrado_ml: "", tamano_litiasis_mm: "", tamano_prostata_cc: "",
  hallazgos: "", tecnica: "",
  complicacion: false, clavien: "", escala_complicacion: "", momento_complicacion: "intraoperatoria", detalles_complicacion: "", observaciones: "",
  // Complementos posteriores (biopsia / control imagenológico)
  biopsia_resultado: "", biopsia_isup: "", biopsia_peso_g: "", biopsia_extension: "", biopsia_margenes: "", rtuv_musculo: "",
  control_stone_free: "", control_imagen_detalle: "",
  // Control post-operatorio: cómo llegó el paciente al control (comentario + Clavien-Dindo)
  control_fecha: "", control_evolucion: "", control_resultado: "",
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

// ─── Control post-operatorio: escala Clavien-Dindo ───
// "favorable" = sin complicaciones al control; el resto sigue la clasificación
// estándar de complicaciones post-operatorias (Clavien-Dindo).
const OPCIONES_CONTROL_POSTOP = [
  ["favorable", "✓ Favorable, sin complicaciones"],
  ["clavien_1", "Clavien I — desviación menor, sin tratamiento"],
  ["clavien_2", "Clavien II — tratamiento farmacológico"],
  ["clavien_3a", "Clavien IIIa — intervención sin anestesia general"],
  ["clavien_3b", "Clavien IIIb — intervención con anestesia general"],
  ["clavien_4a", "Clavien IVa — disfunción de un órgano (UCI)"],
  ["clavien_4b", "Clavien IVb — disfunción multiorgánica"],
  ["clavien_5", "Clavien V — fallecimiento"],
];
const LABEL_CONTROL_POSTOP = Object.fromEntries(OPCIONES_CONTROL_POSTOP);

// ─── Campos de patología según el procedimiento ───────────────────
// No todos los datos aplican a toda cirugía: el peso de la pieza y la extensión
// solo tienen sentido si se resecó un órgano, y la presencia de músculo en la
// muestra es una pregunta exclusiva de la RTU-V (define si el T es evaluable).
// Mostrar los seis campos siempre obliga a leer y descartar; se muestran solo
// los que corresponden.
const EXTENSION_PROSTATA = ["Órgano-confinada (pT2)", "Extraprostática (pT3a)", "Invade vesículas seminales (pT3b)", "Invade estructuras vecinas (pT4)"];
const EXTENSION_RENAL = ["Limitada al riñón", "Invade grasa perirrenal", "Invade vena renal / VCI", "Invade más allá de Gerota"];
const EXTENSION_VESICAL = ["No músculo-invasor (Ta / T1 / CIS)", "Músculo-invasor (T2+)", "No evaluable"];
const MUSCULO_MUESTRA = [["presente", "Sí, hay músculo detrusor"], ["ausente", "No hay músculo detrusor"], ["no_evaluable", "No evaluable"]];

// Devuelve qué campos mostrar para un procedimiento dado.
function camposPatologia(procedimiento) {
  const t = sinTildes(procedimiento || "");
  const esProstatectomia = /prostatectomia|adenomectomia|rtu\s*-?\s*p|rtup|reseccion transuretral de prostata|holep|enucleacion/.test(t);
  const esRtuv = /rtu\s*-?\s*v|rtuv|reseccion transuretral de (vejiga|tumor vesical)|tumor vesical/.test(t);
  const esRenal = /nefrectomia|nefroureterectomia|tumorectomia renal|nefrourectomia/.test(t);
  const esBxProstata = /biopsia\s*prostat/.test(t);
  return {
    isup: esProstatectomia || esBxProstata,
    peso: esProstatectomia || esRenal,          // peso de la pieza operatoria
    extension: esProstatectomia ? EXTENSION_PROSTATA : esRenal ? EXTENSION_RENAL : esRtuv ? EXTENSION_VESICAL : null,
    margenes: esProstatectomia || esRenal,
    musculo: esRtuv,
    etiquetaPeso: esRenal ? "Peso de la pieza (g)" : "Peso de la próstata / tejido resecado (g)",
  };
}
const esClavienMayor = (v) => ["clavien_3a", "clavien_3b", "clavien_4a", "clavien_4b", "clavien_5"].includes(v);

// ─── Detecta el rol del usuario según su nombre en el protocolo ───
function detectarRol(nombreUsuario, cirujano, ayudantes) {
  if (!nombreUsuario) return "cirujano";
  const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Usa apellidos/palabras significativas del usuario (≥4 letras, sin "dr")
  const tokens = norm(nombreUsuario).split(/[\s.,]+/).filter((t) => t.length >= 4 && !["doctor"].includes(t));
  const aparece = (campo) => tokens.some((t) => norm(campo).includes(t));
  if (aparece(cirujano)) return "cirujano";
  if (aparece(ayudantes)) {
    // El orden en que aparece en la lista del protocolo indica la ayudantía:
    // "Dr. X, Dr. Y, Dr. Z" → 1er, 2do y 3er ayudante respectivamente.
    const lista = String(ayudantes || "").split(/[,;/]|\by\b|\n/).map((x) => x.trim()).filter(Boolean);
    const idx = lista.findIndex((x) => tokens.some((t) => norm(x).includes(t)));
    const porOrden = ["primer_ayudante", "segundo_ayudante", "tercer_ayudante", "cuarto_ayudante"];
    return porOrden[idx] || "primer_ayudante";
  }
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
function BarrasMensuales({ datos, onMes, alto = 170, resaltado = null }) {
  const W = 620, H = alto, padL = 34, padB = 30, padT = 14;
  const max = Math.max(1, ...datos.map((d) => d.total));
  const bw = (W - padL - 8) / datos.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      {[0, 0.5, 1].map((f) => {
        const y = padT + (H - padT - padB) * (1 - f);
        return (
          <Fragment key={f}>
            <line x1={padL} y1={y} x2={W - 4} y2={y} stroke="var(--borde)" strokeWidth="0.5" />
            <text x={padL - 6} y={y + 4} fontSize="11" fill="var(--texto-ter)" textAnchor="end">{Math.round(max * f)}</text>
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
            {resaltado === d.mes && <rect x={x - 2} y={padT} width={ancho + 4} height={H - padT - padB} rx="4" fill="none" stroke="var(--primario)" strokeWidth="1.5" strokeDasharray="3 2" />}
            {onMes && <rect x={x - bw * 0.15} y={padT} width={bw} height={H - padT - padB + 16} fill="transparent" style={{ cursor: "pointer" }} onClick={() => onMes(d.mes)} />}
            {d.total > 0 && <text x={x + ancho / 2} y={H - padB - hTot - 4} fontSize="11" fontWeight="600" fill="var(--texto-sec)" textAnchor="middle">{d.total}</text>}
            <text x={x + ancho / 2} y={H - padB + 14} fontSize="11" fill="var(--texto-ter)" textAnchor="middle">{mesLabel(d.mes)}</text>
          </Fragment>
        );
      })}
    </svg>
  );
}

// ─── Barras horizontales (top procedimientos / categorías) ───
// Unir grupos bajo un nombre escrito por el usuario (ámbitos propios,
// p. ej. juntar toda la cirugía de litiasis en "Litiasis").
function NombreNuevoGrupo({ onUnir }) {
  const [nombre, setNombre] = useState("");
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="…o escribe un nombre nuevo para el grupo" style={{ flex: 1, minWidth: 0, padding: "8px 10px", fontSize: "var(--fs-1)", background: "var(--superficie)", color: "var(--texto)", border: "0.5px solid var(--borde)", borderRadius: 8 }} />
      <button onClick={() => onUnir(nombre)} disabled={!nombre.trim()} style={{ flexShrink: 0, padding: "8px 14px", fontSize: "var(--fs-1)", fontWeight: 700, background: nombre.trim() ? "var(--primario)" : "var(--borde)", color: "var(--texto-inv)", border: "none", borderRadius: 8, cursor: nombre.trim() ? "pointer" : "default" }}>Unir</button>
    </div>
  );
}

// Renombrar un solo grupo (cambia cómo se muestra, no toca los registros).
function RenombrarGrupo({ origen, onRenombrar, onCancelar }) {
  const [nombre, setNombre] = useState(origen);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 10, background: "var(--fondo-suave)", border: "1px solid var(--primario)", borderRadius: 10, marginBottom: 12 }}>
      <div style={{ fontSize: "var(--fs-1)", fontWeight: 700, color: "var(--texto)" }}>Renombrar "{origen}"</div>
      <div style={{ display: "flex", gap: 6 }}>
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} style={{ flex: 1, minWidth: 0, padding: "8px 10px", fontSize: "var(--fs-1)", background: "var(--superficie)", color: "var(--texto)", border: "0.5px solid var(--borde)", borderRadius: 8 }} />
        <button onClick={() => onRenombrar(nombre)} style={{ flexShrink: 0, padding: "8px 14px", fontSize: "var(--fs-1)", fontWeight: 700, background: "var(--primario)", color: "var(--texto-inv)", border: "none", borderRadius: 8, cursor: "pointer" }}>Guardar</button>
      </div>
      <button onClick={onCancelar} style={{ padding: 4, fontSize: "var(--fs-0)", background: "none", border: "none", color: "var(--texto-ter)", cursor: "pointer" }}>Cancelar</button>
    </div>
  );
}

function BarrasHorizontales({ items, color = "var(--primario)", onItem }) {
  const max = Math.max(1, ...items.map((i) => i.n));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {items.map((it) => (
        <div key={it.label} onClick={onItem ? () => onItem(it) : undefined} style={onItem ? { cursor: "pointer" } : undefined} title={onItem ? "Ver estas cirugías" : undefined}>
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
  const W = 300, H = 120, padL = 34, padR = 10, padT = 12, padB = 20;
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
      <text x={padL - 4} y={padT + 4} textAnchor="end" fontSize="9.5" fill="var(--texto-ter)">{Math.round(maxV)}</text>
      <text x={padL - 4} y={H - padB} textAnchor="end" fontSize="9.5" fill="var(--texto-ter)">{Math.round(minV)}</text>
      {/* línea de mediana */}
      {medY != null && (
        <>
          <line x1={padL} y1={medY} x2={W - padR} y2={medY} stroke={color} strokeWidth="0.8" strokeDasharray="3 2" opacity="0.6" />
          <text x={W - padR} y={medY - 3} textAnchor="end" fontSize="9.5" fontWeight="600" fill={color}>mediana {mediana} {unidad}</text>
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
  const [filtroRolMet, setFiltroRolMet] = useState("todos"); // rol con el que se filtran las métricas
  const [agruparOpen, setAgruparOpen] = useState(false);     // modal para unir procedimientos
  const [seleccionGrupos, setSeleccionGrupos] = useState([]);
  // Uniones manuales: { "nombre detectado": "nombre definitivo" }. Se guardan en
  // el navegador porque son una preferencia de lectura, no un dato clínico.
  const [aliasProc, setAliasProc] = useState(() => {
    try { return JSON.parse(localStorage.getItem("uro_logbook_alias") || "{}"); } catch { return {}; }
  });
  const guardarAlias = (nuevo) => {
    setAliasProc(nuevo);
    try { localStorage.setItem("uro_logbook_alias", JSON.stringify(nuevo)); } catch {}
  };
  // Grupo definitivo de un registro: familia detectada, salvo que se haya unido a mano.
  const grupoProc = useCallback((nombre) => {
    const fam = familiaProc(nombre);
    return aliasProc[fam] || fam;
  }, [aliasProc]);
  const [metPorCxOpen, setMetPorCxOpen] = useState(false);  // "Métricas por cirugía" colapsado por defecto
  const [procAbierto, setProcAbierto] = useState(null);     // procedimiento expandido (muestra gráfico)
  const [graficoOpen, setGraficoOpen] = useState(false);    // gráfico mensual ampliado (modal)
  const [mesAbierto, setMesAbierto] = useState(null);       // mes seleccionado dentro del gráfico ampliado
  const [duplicadosOpen, setDuplicadosOpen] = useState(false); // revisor de posibles duplicados
  const [desdeTabla, setDesdeTabla] = useState(false);         // el formulario viene precargado desde una cirugía
  const [sugerirIngreso, setSugerirIngreso] = useState(false); // el paciente del protocolo no está hospitalizado
  const [certOpen, setCertOpen] = useState(false);             // modal del certificado de casuística
  const [certDesde, setCertDesde] = useState("");
  const [certHasta, setCertHasta] = useState("");
  const [certGenerando, setCertGenerando] = useState(false);
  const [listaAbierta, setListaAbierta] = useState(null);      // {titulo, ids} visor genérico de cirugías
  const [patRapida, setPatRapida] = useState(null);            // {reg, campos, datos} panel rápido de biopsia/control
  const [patGuardando, setPatGuardando] = useState(false);
  const [complDesglose, setComplDesglose] = useState(false);   // desglose intra/post de complicaciones mayores
  const [complRapida, setComplRapida] = useState(null);        // {reg, valor, detalle} editor rápido por pulsación larga
  const [complGuardando, setComplGuardando] = useState(false);
  const pulsacionRef = useRef(null);                           // temporizador de la pulsación larga
  const [dupIgnorados, setDupIgnorados] = useState(() => {     // grupos de duplicados marcados como "no son duplicados"
    try { return JSON.parse(localStorage.getItem("uro_logbook_dup_ign") || "[]"); } catch { return []; }
  });
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
  const [filtroLugar, setFiltroLugar] = useState("todos"); // todos | pabellon | box
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
      lugar: reg.lugar === "box" ? "box" : "pabellon",
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
      biopsia_peso_g: reg.biopsia_peso_g === "" || reg.biopsia_peso_g == null ? null : Number(reg.biopsia_peso_g),
      biopsia_extension: reg.biopsia_extension || null,
      biopsia_margenes: reg.biopsia_margenes || null,
      rtuv_musculo: reg.rtuv_musculo || null,
      control_stone_free: reg.control_stone_free || null,
      control_imagen_detalle: reg.control_imagen_detalle.trim() || null,
      control_fecha: reg.control_fecha || null,
      control_evolucion: reg.control_evolucion.trim() || null,
      control_resultado: reg.control_resultado || null,
      hallazgos: reg.hallazgos.trim() || null,
      tecnica: reg.tecnica.trim() || null,
      complicacion: !!reg.complicacion,
      clavien: reg.complicacion ? (reg.clavien || null) : null,
      escala_complicacion: reg.escala_complicacion || null,
      momento_complicacion: (reg.complicacion || esIncidente(reg)) ? (reg.momento_complicacion || "intraoperatoria") : null,
      detalles_complicacion: (reg.complicacion || esIncidente(reg)) ? (reg.detalles_complicacion.trim() || null) : null,
      observaciones: reg.observaciones.trim() || null,
      extraido_ia: extraidoOk,
    };

    let result;
    if (editId) {
      result = await actualizarRegistroLogbook(editId, datos);
      if (result.ok) setRegistros((prev) => prev.map((r) => (r.id === editId ? result.registro : r)));
    } else {
      result = await crearRegistroLogbook({ ...datos, user_id: currentUser.id, foto_path });
      if (result?.ok) window.dispatchEvent(new CustomEvent("uro-evento", { detail: { evento: "cirugia_registrada", detalle: { lugar: datos.lugar || "pabellon", rol: datos.rol, con_foto: !!foto_path } } }));
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
    setDesdeTabla(false);
    setFotos([]);
    setEditId(null);
    setExtraidoOk(false);
    setError("");
    setCola([]); setColaTotal(0);
    setExtractProgreso(null);
  };

  // Borrador enviado desde la ficha de una cirugía completada: abre el
  // formulario ya lleno para no escribir dos veces el mismo caso. No guarda
  // nada solo; el usuario revisa, completa y confirma.
  useEffect(() => {
    const tomar = () => {
      let borrador = null;
      try {
        const crudo = localStorage.getItem("uro_logbook_borrador");
        if (!crudo) return;
        borrador = JSON.parse(crudo);
        localStorage.removeItem("uro_logbook_borrador");
      } catch { return; }
      if (!borrador) return;
      setEditId(null);
      setReg({ ...REGISTRO_VACIO, ...borrador });
      setDesdeTabla(true);
      setVista("nueva");
    };
    tomar();
    window.addEventListener("uro-logbook-borrador", tomar);
    return () => window.removeEventListener("uro-logbook-borrador", tomar);
  }, []);

  // ─── Certificado de casuística en PDF ───────────────────────────
  // El documento que todo residente termina armando a mano en Excel para la
  // certificación: casuística por procedimiento y rol, en un rango de fechas,
  // con línea de firma para el tutor. Acá sale de los datos ya registrados.
  const generarCertificado = async () => {
    setCertGenerando(true);
    try {
      const { jsPDF } = await import("jspdf");

      const desde = certDesde || "0000-00-00";
      const hasta = certHasta || "9999-12-31";
      const enRango = registros.filter((r) => r.fecha && r.fecha >= desde && r.fecha <= hasta);
      if (enRango.length === 0) { uroToast("No hay cirugías registradas en ese rango de fechas."); setCertGenerando(false); return; }

      // Conteo por grupo de procedimiento × rol
      const ORD_ROLES = ["cirujano", "primer_ayudante", "segundo_ayudante", "tercer_ayudante", "cuarto_ayudante", "observador"];
      const porProc = new Map();
      enRango.forEach((r) => {
        const g = grupoProc(r.procedimiento);
        if (!porProc.has(g)) porProc.set(g, { cirujano: 0, primer_ayudante: 0, segundo_ayudante: 0, tercer_ayudante: 0, cuarto_ayudante: 0, observador: 0, total: 0 });
        const e = porProc.get(g);
        e[ORD_ROLES.includes(r.rol) ? r.rol : "observador"]++;
        e.total++;
      });
      const filas = Array.from(porProc.entries()).sort((a, b) => b[1].total - a[1].total);

      const nCx = enRango.filter((r) => r.rol === "cirujano").length;
      const nAy = enRango.filter((r) => ROLES_AYUDANTE.includes(r.rol)).length;
      const nObs = enRango.filter((r) => r.rol === "observador").length;
      const nComplIntra = enRango.filter(esIntra).length;
      const nComplPost = enRango.filter(esPost).length;
      const nMayores = enRango.filter(esMayor).length;

      const fmtCL = (iso) => { const [a, m, d] = String(iso || "").split("-"); return d ? `${d}/${m}/${a}` : (iso || ""); };
      const fechas = enRango.map((r) => r.fecha).sort();
      const periodoTxt = `${fmtCL(certDesde || fechas[0])} — ${fmtCL(certHasta || fechas[fechas.length - 1])}`;

      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const W = 210, M = 18;
      let y = 20;
      const azul = [26, 58, 92];

      // Encabezado
      doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...azul);
      doc.text("CERTIFICADO DE CASUÍSTICA QUIRÚRGICA", W / 2, y, { align: "center" }); y += 7;
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(90);
      doc.text("Registro personal de actividad quirúrgica — UroSearch", W / 2, y, { align: "center" }); y += 10;
      doc.setDrawColor(...azul); doc.setLineWidth(0.5); doc.line(M, y, W - M, y); y += 8;

      // Identificación
      doc.setTextColor(30); doc.setFontSize(10.5);
      const linea = (rot, val) => {
        doc.setFont("helvetica", "bold"); doc.text(rot, M, y);
        doc.setFont("helvetica", "normal");
        // El valor se acota al ancho restante para que nunca cruce el margen.
        const lineas = doc.splitTextToSize(String(val), W - M - (M + 42));
        lineas.forEach((l, k) => { doc.text(l, M + 42, y + k * 5); });
        y += 6 + (lineas.length - 1) * 5;
      };
      linea("Profesional:", currentUser?.nombre || "—");
      if (currentUser?.especialidad) linea("Especialidad:", currentUser.especialidad);
      linea("Período:", periodoTxt);
      linea("Fecha de emisión:", fmtCL(new Date().toISOString().slice(0, 10)));
      y += 3;

      // Resumen
      doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...azul);
      doc.text("RESUMEN", M, y); y += 6;
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(30);
      const resumen = [
        `Total de cirugías registradas: ${enRango.length}`,
        `Como cirujano principal: ${nCx}${nAy ? `   ·   Como ayudante (1º–4º): ${nAy}` : ""}${nObs ? `   ·   Como observador: ${nObs}` : ""}`,
        `Complicaciones intraoperatorias: ${nComplIntra}   ·   Post-operatorias: ${nComplPost}`,
        `Complicaciones mayores (Clavien-Dindo >= IIIa): ${nMayores}`,
      ];
      resumen.forEach((t) => {
        doc.splitTextToSize(t, W - 2 * M).forEach((l) => { doc.text(l, M, y); y += 5.5; });
      });
      y += 4;

      // Tabla por procedimiento × rol
      doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...azul);
      doc.text("DETALLE POR PROCEDIMIENTO Y ROL", M, y); y += 6;

      const cols = [
        { t: "Procedimiento", x: M, w: 78, align: "left" },
        { t: "Cx", x: M + 80, w: 12 },
        { t: "1º", x: M + 94, w: 12 },
        { t: "2º", x: M + 108, w: 12 },
        { t: "3º", x: M + 122, w: 12 },
        { t: "4º", x: M + 136, w: 12 },
        { t: "Obs", x: M + 150, w: 12 },
        { t: "Total", x: M + 164, w: 12 },
      ];
      const encabezadoTabla = () => {
        doc.setFillColor(238, 243, 249);
        doc.rect(M - 2, y - 4.2, W - 2 * M + 4, 6.4, "F");
        doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(...azul);
        cols.forEach((c) => doc.text(c.t, c.align === "left" ? c.x : c.x + c.w / 2, y, { align: c.align === "left" ? "left" : "center" }));
        y += 5.5;
        doc.setFont("helvetica", "normal"); doc.setFontSize(8.8); doc.setTextColor(30);
      };
      encabezadoTabla();

      filas.forEach(([nombre, v], i) => {
        if (y > 262) { doc.addPage(); y = 20; encabezadoTabla(); }
        if (i % 2 === 1) { doc.setFillColor(248, 250, 252); doc.rect(M - 2, y - 3.9, W - 2 * M + 4, 5.6, "F"); }
        const nom = doc.splitTextToSize(nombre, 76)[0];
        doc.text(nom, M, y);
        const vals = [v.cirujano, v.primer_ayudante, v.segundo_ayudante, v.tercer_ayudante, v.cuarto_ayudante, v.observador, v.total];
        vals.forEach((n, j) => { const c = cols[j + 1]; doc.setFont("helvetica", j === 6 ? "bold" : "normal"); doc.text(n ? String(n) : "·", c.x + c.w / 2, y, { align: "center" }); });
        doc.setFont("helvetica", "normal");
        y += 5.6;
      });

      // Totales
      if (y > 255) { doc.addPage(); y = 20; }
      y += 1.5;
      doc.setDrawColor(...azul); doc.setLineWidth(0.4); doc.line(M - 2, y - 3.5, W - M + 2, y - 3.5);
      doc.setFont("helvetica", "bold"); doc.setFontSize(8.8);
      doc.text("TOTAL", M, y);
      const tot = [nCx,
        enRango.filter((r) => r.rol === "primer_ayudante").length,
        enRango.filter((r) => r.rol === "segundo_ayudante").length,
        enRango.filter((r) => r.rol === "tercer_ayudante").length,
        enRango.filter((r) => r.rol === "cuarto_ayudante").length,
        nObs, enRango.length];
      tot.forEach((n, j) => { const c = cols[j + 1]; doc.text(String(n), c.x + c.w / 2, y, { align: "center" }); });
      y += 12;

      // Firmas
      if (y > 240) { doc.addPage(); y = 30; }
      y = Math.max(y, 230);
      doc.setLineWidth(0.3); doc.setDrawColor(60);
      doc.line(M + 6, y, M + 76, y);
      doc.line(W - M - 76, y, W - M - 6, y);
      y += 4.5;
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(60);
      doc.text(currentUser?.nombre || "Residente", M + 41, y, { align: "center" });
      doc.text("Tutor / Jefe de Programa", W - M - 41, y, { align: "center" });
      y += 4.5;
      doc.setFontSize(7.5); doc.setTextColor(120);
      doc.text("Firma del profesional", M + 41, y, { align: "center" });
      doc.text("Firma y timbre", W - M - 41, y, { align: "center" });

      // Pie en todas las páginas
      const paginas = doc.getNumberOfPages();
      for (let p = 1; p <= paginas; p++) {
        doc.setPage(p);
        // Marca de agua diagonal (con opacidad real si la versión de jsPDF
        // lo permite; si no, gris muy claro) + sello en la esquina superior.
        try {
          doc.saveGraphicsState();
          doc.setGState(new doc.GState({ opacity: 0.06 }));
          doc.setFont("helvetica", "bold"); doc.setFontSize(64); doc.setTextColor(26, 58, 92);
          doc.text("UroSearch", W / 2, 185, { align: "center", angle: 32 });
          doc.restoreGraphicsState();
        } catch {
          doc.setFont("helvetica", "bold"); doc.setFontSize(64); doc.setTextColor(238, 241, 246);
          doc.text("UroSearch", W / 2, 185, { align: "center", angle: 32 });
        }
        doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(26, 58, 92);
        doc.text("UroSearch", W - M, 11, { align: "right" });
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7); doc.setTextColor(150);
        doc.text("Generado por UroSearch · datos autorreportados por el profesional · verificar contra protocolos operatorios", M, 290);
        doc.text(`${p} / ${paginas}`, W - M, 290, { align: "right" });
      }

      doc.save(`casuistica_${(currentUser?.nombre || "residente").split(" ")[0].toLowerCase()}_${new Date().toISOString().slice(0, 10)}.pdf`);
      setCertOpen(false);
    } catch (e) {
      uroToast("No se pudo generar el certificado: " + (e?.message || e));
    }
    setCertGenerando(false);
  };

  // Tras leer un protocolo, se verifica si el paciente ya figura en los
  // hospitalizados o en la tabla quirúrgica; si no, se ofrece ingresarlo.
  useEffect(() => {
    if (!extraidoOk || editId || desdeTabla) { setSugerirIngreso(false); return; }
    const ident = [];
    if (reg.rut?.trim()) ident.push(`rut.eq.${reg.rut.trim()}`);
    if (reg.ficha_clinica?.trim()) ident.push(`ficha_clinica.eq.${reg.ficha_clinica.trim()}`);
    if (!ident.length && reg.iniciales?.trim()) ident.push(`iniciales.eq.${reg.iniciales.trim().toUpperCase()}`);
    if (!ident.length) return;
    let vivo = true;
    (async () => {
      try {
        const [pac, cir] = await Promise.all([
          supabase.from("pacientes").select("id").or(ident.join(",")).neq("estado", "alta").limit(1),
          supabase.from("cirugias").select("id").or(ident.filter((c) => !c.startsWith("iniciales")).join(",") || ident.join(",")).limit(1),
        ]);
        if (vivo && !(pac.data?.length) && !(cir.data?.length)) setSugerirIngreso(true);
      } catch {}
    })();
    return () => { vivo = false; };
  }, [extraidoOk]);

  const empezarEdicion = (r) => {
    setEditId(r.id);
    setFotos([]);
    setExtraidoOk(false);
    setReg({
      fecha: r.fecha || new Date().toISOString().slice(0, 10),
      iniciales: r.iniciales || "", ficha_clinica: r.ficha_clinica || "", rut: r.rut || "", edad: r.edad != null ? String(r.edad) : "", sexo: r.sexo || "",
      diagnostico_pre: r.diagnostico_pre || "", diagnostico_post: r.diagnostico_post || "",
      procedimiento: r.procedimiento || "", intervencion: r.intervencion || r.procedimiento || "", categoria: r.categoria || "Otro", lateralidad: r.lateralidad || "", lugar: r.lugar === "box" ? "box" : "pabellon",
      rol: r.rol || "cirujano", cirujano: r.cirujano || "", ayudantes: r.ayudantes || "",
      anestesia: r.anestesia || "", hora_inicio: (r.hora_inicio || "").slice(0, 5), hora_termino: (r.hora_termino || "").slice(0, 5),
      duracion_min: r.duracion_min != null ? String(r.duracion_min) : "", sangrado_ml: r.sangrado_ml != null ? String(r.sangrado_ml) : "",
      tamano_litiasis_mm: r.tamano_litiasis_mm != null ? String(r.tamano_litiasis_mm) : "", tamano_prostata_cc: r.tamano_prostata_cc != null ? String(r.tamano_prostata_cc) : "",
      biopsia_resultado: r.biopsia_resultado || "", biopsia_isup: r.biopsia_isup || "",
      biopsia_peso_g: r.biopsia_peso_g ?? "", biopsia_extension: r.biopsia_extension || "", biopsia_margenes: r.biopsia_margenes || "", rtuv_musculo: r.rtuv_musculo || "",
      control_stone_free: r.control_stone_free || "", control_imagen_detalle: r.control_imagen_detalle || "",
      control_fecha: r.control_fecha || "", control_evolucion: r.control_evolucion || "", control_resultado: r.control_resultado || "",
      hallazgos: r.hallazgos || "", tecnica: r.tecnica || "",
      ...(() => { const e = GRADO_POR_VALOR[valorEvento(r)] || GRADO_POR_VALOR.ninguno;
        return { complicacion: e.complicacion, clavien: e.grado || "", escala_complicacion: e.escala || "", momento_complicacion: r.momento_complicacion === "postoperatoria" ? "postoperatoria" : "intraoperatoria" }; })(),
      detalles_complicacion: r.detalles_complicacion || "",
      observaciones: r.observaciones || "",
    });
    setError("");
    setVista("nueva");
  };

  const eliminar = async (r) => {
    if (!(await uroConfirm(`¿Eliminar "${r.procedimiento}" del ${r.fecha}?\n\nNo podrás recuperarlo.`))) return;
    const result = await eliminarRegistroLogbook(r.id);
    if (!result.ok) return uroToast("Error: " + result.error);
    if (r.foto_path) eliminarFotoLogbook(r.foto_path);
    setRegistros((prev) => prev.filter((x) => x.id !== r.id));
  };

  const verFoto = async (path) => {
    const r = await obtenerUrlFoto(path);
    if (r.ok) setFotoUrl(r.url);
    else uroToast("No se pudo cargar la foto: " + r.error);
  };

  // ─── Exportar CSV (incluye complicaciones y complementos) ───
  const exportarCSV = () => {
    const cols = ["fecha", "iniciales", "ficha_clinica", "rut", "edad", "sexo", "procedimiento", "categoria", "lugar", "lateralidad", "rol", "cirujano", "ayudantes", "diagnostico_pre", "diagnostico_post", "anestesia", "duracion_min", "sangrado_ml", "tamano_litiasis_mm", "tamano_prostata_cc", "biopsia_resultado", "biopsia_isup", "biopsia_peso_g", "biopsia_extension", "biopsia_margenes", "rtuv_musculo", "control_stone_free", "control_imagen_detalle", "control_fecha", "control_resultado", "control_evolucion", "complicacion", "momento_complicacion", "escala_complicacion", "clavien", "detalles_complicacion", "hallazgos", "observaciones"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const filas = [cols.join(";"), ...registros.map((r) => cols.map((c) => esc(c === "complicacion" ? (r[c] ? "Sí" : "No") : c === "momento_complicacion" ? (r.complicacion ? (LABEL_MOMENTO[r[c] || "intraoperatoria"]) : "") : c === "control_resultado" ? (LABEL_CONTROL_POSTOP[r[c]] || r[c]) : r[c])).join(";"))];
    const blob = new Blob(["\uFEFF" + filas.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `logbook_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ─── Lista filtrada ───
  // ─── Posibles duplicados ───────────────────────────────────────
  // Al registrar una cirugía por foto y además recibirla del logbook de un
  // compañero, el mismo caso puede entrar dos veces. Se agrupan los registros
  // que comparten fecha + familia de procedimiento y, además, algún
  // identificador del paciente (RUT, ficha o iniciales). Nunca se borra nada
  // solo: se marcan para que tú revises y decidas.
  const gruposDuplicados = useMemo(() => {
    const norm = (t) => sinTildes(t || "").replace(/[^a-z0-9]/g, "");
    const grupos = new Map();
    registros.forEach((r) => {
      if (!r.fecha) return;
      const ident = norm(r.rut) || norm(r.ficha_clinica) || norm(r.iniciales);
      if (!ident) return;
      const clave = `${r.fecha}|${grupoProc(r.procedimiento)}|${ident}`;
      // (la clave de agrupación es derivada; la de "ignorar" se calcula abajo
      //  a partir de los ids, que sí son estables entre versiones)
      if (!grupos.has(clave)) grupos.set(clave, []);
      grupos.get(clave).push(r);
    });
    return Array.from(grupos.entries())
      .filter(([, g]) => g.length > 1)
      // La clave que se guarda al descartar un grupo se arma con los ids de los
      // registros, no con fecha+procedimiento+paciente. La clave derivada
      // cambiaba al cambiar el agrupador de procedimientos o al reagrupar con
      // alias, y entonces el grupo descartado reaparecía en cada actualización
      // como si nunca lo hubieras revisado.
      .map(([clave, g]) => ({ clave, claveIds: claveIds(g), items: g }))
      .filter((g) => !dupIgnorados.includes(g.claveIds) && !dupIgnorados.includes(g.clave))
      .sort((a, b) => (b.items[0].fecha || "").localeCompare(a.items[0].fecha || ""));
  }, [registros, grupoProc, dupIgnorados]);
  const nDuplicados = gruposDuplicados.reduce((acc, g) => acc + (g.items.length - 1), 0);
  // Visor genérico: abre la lista de cirugías que cumplen el filtro actual de
  // métricas más la condición extra (procedimiento, ayudantía, complicación…).
  const abrirLista = (titulo, condicion, esComplicaciones = false) => {
    const base = registros
      .filter((r) => (criterioMet === "onco" ? esOncologica(r) : criterioMet === "noonco" ? !esOncologica(r) : true))
      .filter((r) => cumpleRol(r, filtroRolMet))
      .filter(condicion)
      .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
    setListaAbierta({ titulo, ids: base.map((r) => r.id), esComplicaciones });
  };

  // Corrige un falso positivo: la extracción automática marcó complicación
  // donde no la hubo. Limpia complicación, Clavien, momento y detalle.
  const quitarComplicacion = async (r) => {
    if (!(await uroConfirm(`¿Marcar "${r.procedimiento}" del ${r.fecha} como SIN complicación?`))) return;
    const result = await actualizarRegistroLogbook(r.id, camposEvento("ninguno"));
    if (!result.ok) return uroToast("Error: " + result.error);
    setRegistros((prev) => prev.map((x) => (x.id === r.id ? result.registro : x)));
  };

  // ─── Panel rápido de patología y control post-operatorio ───
  // La biopsia llega días o semanas después de la cirugía. Abrir el formulario
  // completo para anotar un ISUP obliga a pasar por veinte campos ya llenos y
  // arriesga tocar algo por error; esto escribe solo lo que corresponde al
  // procedimiento y nada más.
  const abrirPatRapida = (r) => {
    setPatRapida({
      reg: r,
      campos: camposPatologia(r.procedimiento),
      datos: {
        biopsia_resultado: r.biopsia_resultado || "",
        biopsia_isup: r.biopsia_isup || "",
        biopsia_peso_g: r.biopsia_peso_g ?? "",
        biopsia_extension: r.biopsia_extension || "",
        biopsia_margenes: r.biopsia_margenes || "",
        rtuv_musculo: r.rtuv_musculo || "",
        control_fecha: r.control_fecha || "",
        control_resultado: r.control_resultado || "",
        control_evolucion: r.control_evolucion || "",
      },
    });
  };
  const setPat = (k, v) => setPatRapida((p) => ({ ...p, datos: { ...p.datos, [k]: v } }));
  const guardarPatRapida = async () => {
    if (!patRapida) return;
    setPatGuardando(true);
    const d = patRapida.datos;
    const parche = {
      biopsia_resultado: d.biopsia_resultado.trim() || null,
      biopsia_isup: d.biopsia_isup || null,
      biopsia_peso_g: d.biopsia_peso_g === "" ? null : Number(d.biopsia_peso_g),
      biopsia_extension: d.biopsia_extension || null,
      biopsia_margenes: d.biopsia_margenes || null,
      rtuv_musculo: d.rtuv_musculo || null,
      control_fecha: d.control_fecha || null,
      control_resultado: d.control_resultado || null,
      control_evolucion: d.control_evolucion.trim() || null,
    };
    const result = await actualizarRegistroLogbook(patRapida.reg.id, parche);
    setPatGuardando(false);
    if (!result.ok) return uroToast("Error: " + result.error);
    setRegistros((prev) => prev.map((x) => (x.id === patRapida.reg.id ? result.registro : x)));
    setPatRapida(null);
    uroToast("Registro complementado");
  };

  // ─── Editor rápido de complicación (pulsación larga sobre el registro) ───
  // Lo habitual es enterarse de la complicación días después de haber guardado
  // el protocolo: abrir el formulario completo para eso es desproporcionado.
  const abrirComplRapida = (r) => {
    setComplRapida({ reg: r, valor: valorEvento(r), momento: r.momento_complicacion === "postoperatoria" ? "postoperatoria" : "intraoperatoria", detalle: r.detalles_complicacion || "" });
  };
  const guardarComplRapida = async () => {
    if (!complRapida) return;
    setComplGuardando(true);
    const result = await actualizarRegistroLogbook(complRapida.reg.id, camposEvento(complRapida.valor, complRapida.detalle, complRapida.momento));
    setComplGuardando(false);
    if (!result.ok) return uroToast("Error: " + result.error);
    setRegistros((prev) => prev.map((x) => (x.id === complRapida.reg.id ? result.registro : x)));
    setComplRapida(null);
    uroToast(complRapida.valor === "ninguno" ? "Registro marcado sin complicación" : "Complicación actualizada");
  };

  // Gestos: ~550 ms mantenidos abren el editor. La bandera evita que al soltar
  // se dispare además el onClick que expande la tarjeta.
  const gestosPulsacion = (r) => ({
    onTouchStart: () => {
      pulsacionRef.current = { largo: false };
      pulsacionRef.current.t = setTimeout(() => {
        if (pulsacionRef.current) pulsacionRef.current.largo = true;
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch {} }
        abrirComplRapida(r);
      }, 550);
    },
    onTouchMove: () => { if (pulsacionRef.current?.t) { clearTimeout(pulsacionRef.current.t); pulsacionRef.current = null; } },
    onTouchEnd: () => { if (pulsacionRef.current?.t) clearTimeout(pulsacionRef.current.t); },
    onContextMenu: (e) => { e.preventDefault(); abrirComplRapida(r); }, // escritorio: clic derecho
  });
  const consumioPulsacionLarga = () => {
    const largo = !!pulsacionRef.current?.largo;
    pulsacionRef.current = null;
    return largo;
  };

  const ignorarDuplicado = (claveIds) => {
    const nuevo = [...dupIgnorados, claveIds];
    setDupIgnorados(nuevo);
    try { localStorage.setItem("uro_logbook_dup_ign", JSON.stringify(nuevo)); } catch {}
  };

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return registros.filter((r) => {
      if (filtroLugar !== "todos" && (filtroLugar === "box") !== esBox(r)) return false;
      if (filtroCat !== "Todas" && r.categoria !== filtroCat) return false;
      if (filtroRol !== "todos" && r.rol !== filtroRol) return false;
      if (q && !`${r.procedimiento} ${r.diagnostico_pre} ${r.diagnostico_post} ${r.iniciales} ${r.hallazgos}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [registros, busqueda, filtroCat, filtroRol, filtroLugar]);

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
    const porCriterio = criterioMet === "onco" ? registros.filter(esOncologica)
      : criterioMet === "noonco" ? registros.filter((r) => !esOncologica(r))
      : registros;
    // Filtro por rol: permite mirar solo lo operado como cirujano principal, o
    // solo las ayudantías de cierto orden.
    const base = porCriterio.filter((r) => cumpleRol(r, filtroRolMet));
    const total = base.length;
    const comoCirujano = base.filter((r) => r.rol === "cirujano").length;
    const comoAyudante = base.filter((r) => ROLES_AYUDANTE.includes(r.rol)).length;
    const conComplicacion = base.filter((r) => r.complicacion).length;
    const complIntra = base.filter(esIntra).length;
    const complPost = base.filter(esPost).length;
    // Cifra de cabecera: complicaciones mayores (Clavien-Dindo ≥ IIIa).
    // La tasa global no discrimina — mezcla un íleo con una reintervención.
    const complMayores = base.filter(esMayor).length;
    const mayoresIntra = base.filter((r) => esMayor(r) && esIntra(r)).length;
    const mayoresPost = base.filter((r) => esMayor(r) && esPost(r)).length;
    const incidentes = base.filter(esIncidente).length;
    // Nota: no se calcula una "duración promedio global" — mezclar cirugías
    // heterogéneas da un número que no significa nada. La duración va por procedimiento.
    const conDuracion = base.filter((r) => r.duracion_min > 0).length;
    const onco = registros.filter(esOncologica).length; // conteo global (para el chip del criterio)

    const porCat = {};
    const porProc = {};
    base.forEach((r) => {
      porCat[r.categoria || "Otro"] = (porCat[r.categoria || "Otro"] || 0) + 1;
      const p = grupoProc(r.procedimiento);
      if (!porProc[p]) porProc[p] = { n: 0, cx: 0, ayud: 0, dur: [], sangrado: [], litiasis: [], prostata: [], compl: 0, complIntra: 0, complPost: 0, stoneFree: 0, stoneTotal: 0, durCasos: [], sangradoCasos: [], ctrlTotal: 0, ctrlFav: 0, ctrlMayor: 0 };
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
      if (esIntra(r)) v.complIntra++;
      if (esPost(r)) v.complPost++;
      if (r.control_stone_free) { v.stoneTotal++; if (r.control_stone_free === "stone_free") v.stoneFree++; }
      if (r.control_resultado) { v.ctrlTotal++; if (r.control_resultado === "favorable") v.ctrlFav++; if (esClavienMayor(r.control_resultado)) v.ctrlMayor++; }
    });

    const meses = ultimosMeses(12).map((mes) => {
      const delMes = base.filter((r) => mesClave(r.fecha) === mes);
      return {
        mes,
        total: delMes.length,
        cirujano: delMes.filter((r) => r.rol === "cirujano").length,
        registros: [...delMes].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "")),
      };
    });

    // Detalle completo por procedimiento (para tarjetas de métricas)
    const ordenarPorFecha = (a) => [...a].sort((x, y) => (x.fecha || "").localeCompare(y.fecha || ""));
    const detalleProc = Object.entries(porProc)
      .sort((a, b) => b[1].n - a[1].n)
      .map(([label, v]) => ({
        label, n: v.n, cx: v.cx, ayud: v.ayud,
        dur: stat(v.dur), sangrado: stat(v.sangrado),
        litiasis: stat(v.litiasis), prostata: stat(v.prostata),
        durProm: prom(v.dur),   // se mantiene para el orden y el KPI
        compl: v.compl, complIntra: v.complIntra, complPost: v.complPost,
        stoneFree: v.stoneTotal > 0 ? { free: v.stoneFree, total: v.stoneTotal } : null,
        controlPostop: v.ctrlTotal > 0 ? { fav: v.ctrlFav, mayor: v.ctrlMayor, total: v.ctrlTotal } : null,
        durCasos: ordenarPorFecha(v.durCasos),      // puntos para el gráfico de tiempos
        sangradoCasos: ordenarPorFecha(v.sangradoCasos),
      }));

    const topProc = detalleProc.slice(0, 8).map((d) => ({
      label: d.label, n: d.n, extra: d.dur ? `${d.dur.med} min` : null,
    }));

    // Resumen de ayudantías separado por procedimiento
    const ayudantiasPorProc = detalleProc.filter((d) => d.ayud > 0).map((d) => ({ label: d.label, n: d.ayud }));

    const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, n }));

    // Distribución por rol asumido (cirujano / 1er ay. / 2do ay. / observador)
    const porRol = ROLES
      .map(([id, label]) => ({ label, n: base.filter((r) => r.rol === id).length }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n);

    // Procedimiento más frecuente (reemplaza a la duración promedio global)
    const masFrecuente = detalleProc.length ? detalleProc[0] : null;
    return { total, comoCirujano, comoAyudante, conComplicacion, complIntra, complPost, complMayores, mayoresIntra, mayoresPost, incidentes, conDuracion, masFrecuente, meses, topProc, cats, porRol, detalleProc, ayudantiasPorProc, onco };
  }, [registros, criterioMet, filtroRolMet, grupoProc]);

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
        `Casuística (${criterioTxt}). Total: ${met.total}. Como cirujano principal: ${met.comoCirujano}. Como ayudante: ${met.comoAyudante}.`,
        "Por procedimiento (valores = medianas):",
        ...met.detalleProc.map((d) => `- ${d.label}: ${d.n} cx (cirujano ${d.cx}, ayudante ${d.ayud})${d.dur ? `, duración ${d.dur.med} min (n=${d.dur.n})` : ""}${d.sangrado ? `, sangrado ${d.sangrado.med} ml` : ""}${d.litiasis ? `, litiasis ${d.litiasis.med} mm` : ""}${d.prostata ? `, próstata ${d.prostata.med} cc` : ""}${d.stoneFree ? `, stone free ${d.stoneFree.free}/${d.stoneFree.total}` : ""}${d.controlPostop ? `, control post-op favorable ${d.controlPostop.fav}/${d.controlPostop.total}` : ""}`),
      ].join("\n");
      const res = await fetch(import.meta.env.VITE_CHAT_FUNCTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${await tokenFuncionIA()}` },
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: 300,
          system: "Eres un urólogo cercano y de buen humor que mira la casuística de un colega residente. Escribe 2 o 3 frases como máximo, cálidas, simpáticas y motivadoras: cuánto lleva, en qué va más sólido y una sugerencia amable de qué reforzar. Nada de complicaciones ni cifras de riesgo. Máximo un emoji. Básate SOLO en los datos entregados, no inventes cifras. Sin markdown ni viñetas.",
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
          {desdeTabla && (
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", background: "var(--exito-bg)", border: "1px solid var(--exito)", borderRadius: 10 }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>📋</span>
              <div style={{ flex: 1, minWidth: 0, fontSize: "var(--fs-1)", color: "var(--texto)", lineHeight: 1.5 }}>
                <b style={{ color: "var(--exito)" }}>Datos traídos desde la tabla quirúrgica.</b> Revisa el rol y completa lo que falte (duración, hallazgos, complicaciones) antes de guardar.
              </div>
            </div>
          )}

          {/* Captura */}
          {!editId && !desdeTabla && (
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

          {sugerirIngreso && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 12px", background: "var(--alerta-bg)", border: "1px solid var(--alerta)", borderRadius: 10 }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: "var(--fs-1)", color: "var(--texto)", lineHeight: 1.45 }}>
                🏥 <b>{reg.iniciales}</b> no aparece en tus pacientes hospitalizados. ¿Quieres ingresarlo?
              </div>
              <button onClick={() => { window.dispatchEvent(new CustomEvent("uro-ingreso-prefill", { detail: { nombre: reg.iniciales || "", rut: reg.rut || "", ficha: reg.ficha_clinica || "", edad: reg.edad || "", sexo: reg.sexo || "", hipotesis: reg.diagnostico_pre || reg.procedimiento || "" } })); setSugerirIngreso(false); }} style={{ flexShrink: 0, padding: "7px 12px", fontSize: "var(--fs-0)", fontWeight: 700, background: "var(--primario)", color: "var(--texto-inv)", border: "none", borderRadius: 8, cursor: "pointer" }}>Ingresar</button>
              <button onClick={() => setSugerirIngreso(false)} style={{ flexShrink: 0, background: "none", border: "none", color: "var(--texto-ter)", fontSize: 15, cursor: "pointer" }}>✕</button>
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
            {/* Lugar primero: define si es actividad de pabellón o de box, y
                cambia los atajos que se ofrecen abajo. */}
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={lbl}>Lugar</label>
              <div style={{ display: "flex", gap: 6 }}>
                {LUGARES_LOGBOOK.map(([v, l]) => (
                  <button key={v} type="button" onClick={() => {
                    set("lugar", v);
                    // Al pasar a box se propone la categoría correspondiente,
                    // sin pisarla si ya eligió una distinta a propósito.
                    if (v === "box" && !reg.categoria) set("categoria", "Procedimiento de box");
                  }} style={{ flex: 1, padding: "9px 6px", fontSize: "var(--fs-1)", fontWeight: 600, borderRadius: 8, cursor: "pointer", border: "0.5px solid " + ((reg.lugar || "pabellon") === v ? "var(--primario)" : "var(--borde)"), background: (reg.lugar || "pabellon") === v ? "var(--primario)" : "var(--superficie)", color: (reg.lugar || "pabellon") === v ? "var(--texto-inv)" : "var(--texto-sec)" }}>{l}</button>
                ))}
              </div>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>{campo("Procedimiento *", <input style={inp} value={reg.procedimiento} onChange={(e) => set("procedimiento", e.target.value)} placeholder={esBox(reg) ? "Ej: Cambio de cistostomía" : "Ej: Ureterolitectomía endoscópica láser"} />)}</div>
            {esBox(reg) && (
              <div style={{ gridColumn: "1 / -1", display: "flex", flexWrap: "wrap", gap: 5, marginTop: -4 }}>
                {PROCEDIMIENTOS_BOX.map((pb) => (
                  <button key={pb} type="button" onClick={() => { set("procedimiento", pb); if (!reg.intervencion) set("intervencion", pb); }} style={{ padding: "5px 10px", fontSize: "var(--fs-0)", background: reg.procedimiento === pb ? "var(--primario)" : "var(--superficie)", color: reg.procedimiento === pb ? "var(--texto-inv)" : "var(--primario)", border: "0.5px solid var(--borde)", borderRadius: 10, cursor: "pointer" }}>{pb}</button>
                ))}
              </div>
            )}
            <div style={{ gridColumn: "1 / -1" }}>{campo("Nombre de intervención", <input style={inp} value={reg.intervencion} onChange={(e) => set("intervencion", e.target.value)} placeholder="Se autocompleta con el procedimiento; puedes cambiarlo" />)}</div>
            {campo("Categoría", (
              <select style={inp} value={reg.categoria} onChange={(e) => set("categoria", e.target.value)}>
                <option value="">—</option>
                {CATEGORIAS_LOGBOOK.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            ))}
            {campo("Lateralidad", (
              <select style={inp} value={reg.lateralidad} onChange={(e) => set("lateralidad", e.target.value)}>
                <option value="">—</option><option>Derecha</option><option>Izquierda</option><option>Bilateral</option><option>No aplica</option>
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

                  {/* Control post-operatorio: cómo llegó el paciente + Clavien-Dindo */}
                  <div style={{ gridColumn: "1 / -1", fontSize: "var(--fs-1)", fontWeight: 700, color: "var(--texto)", marginTop: 4, paddingTop: 8, borderTop: "0.5px solid var(--borde)" }}>🩺 Control post-operatorio</div>
                  {campo("Fecha del control", <input type="date" style={inp} value={reg.control_fecha} onChange={(e) => set("control_fecha", e.target.value)} />)}
                  {campo("Resultado del control (Clavien-Dindo)", (
                    <select style={inp} value={reg.control_resultado} onChange={(e) => set("control_resultado", e.target.value)}>
                      <option value="">—</option>
                      {OPCIONES_CONTROL_POSTOP.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  ))}
                  <div style={{ gridColumn: "1 / -1" }}>{campo("¿Cómo anduvo el paciente en el control?", <textarea rows={2} style={{ ...inp, resize: "vertical" }} value={reg.control_evolucion} onChange={(e) => set("control_evolucion", e.target.value)} placeholder="Ej: asintomático, herida sana, buen chorro miccional, sin fiebre; retiro de sonda sin incidentes" />)}</div>
                </div>
              )}
            </div>

            {/* Complicación: NO aparece de entrada; se agrega con este botón */}
            <div style={{ gridColumn: "1 / -1" }}>
              {valorEvento(reg) === "ninguno" ? (
                <button type="button" onClick={() => aplicarEvento(set, "intra_1")} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", fontSize: "var(--fs-1)", fontWeight: 600, borderRadius: 8, cursor: "pointer", border: "0.5px solid var(--borde)", background: "var(--fondo-suave)", color: "var(--texto-sec)" }}>
                  ⚠️ Agregar complicación o incidente
                </button>
              ) : (
                <div style={{ padding: "10px 12px", border: "0.5px solid " + (reg.complicacion ? "var(--peligro)" : "var(--borde)"), borderRadius: 10, background: reg.complicacion ? "var(--peligro-bg)" : "var(--fondo-suave)", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: "var(--fs-2)", fontWeight: 600, color: reg.complicacion ? "var(--peligro)" : "var(--texto-sec)" }}>{reg.complicacion ? "⚠️ Complicación" : "ℹ️ Incidente"}</span>
                    <button type="button" onClick={() => aplicarEvento(set, "ninguno")} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--peligro)", cursor: "pointer", fontSize: "var(--fs-1)", fontWeight: 600 }}>Quitar</button>
                  </div>
                  <select style={inp} value={valorEvento(reg)} onChange={(e) => aplicarEvento(set, e.target.value)}>
                    {GRADOS_CLAVIEN.filter((e) => e.v !== "ninguno").map((e) => <option key={e.v} value={e.v}>{e.label}</option>)}
                  </select>
                  {reg.complicacion && (
                    <div style={{ display: "flex", gap: 6 }}>
                      {MOMENTOS_COMPLICACION.map(([v, l]) => (
                        <button key={v} type="button" onClick={() => set("momento_complicacion", v)} style={{ flex: 1, padding: "8px 6px", fontSize: "var(--fs-1)", fontWeight: 600, borderRadius: 8, cursor: "pointer", border: "0.5px solid " + ((reg.momento_complicacion || "intraoperatoria") === v ? "var(--peligro)" : "var(--borde)"), background: (reg.momento_complicacion || "intraoperatoria") === v ? "var(--peligro)" : "var(--superficie)", color: (reg.momento_complicacion || "intraoperatoria") === v ? "var(--texto-inv)" : "var(--texto-sec)" }}>{l}</button>
                      ))}
                    </div>
                  )}
                  {campo("Detalle", <textarea rows={2} style={{ ...inp, resize: "vertical" }} value={reg.detalles_complicacion} onChange={(e) => set("detalles_complicacion", e.target.value)} />)}
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
            <select style={{ ...inp, flex: "1 1 120px" }} value={filtroLugar} onChange={(e) => setFiltroLugar(e.target.value)}>
              <option value="todos">Pabellón y box</option>
              <option value="pabellon">Solo pabellón</option>
              <option value="box">Solo box</option>
            </select>
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

          {nDuplicados > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--alerta-bg)", border: "1px solid var(--alerta)", borderRadius: 10, fontSize: "var(--fs-1)", color: "var(--alerta)", fontWeight: 600 }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                ⚠️ Hay {nDuplicados} registro{nDuplicados === 1 ? "" : "s"} que parece{nDuplicados === 1 ? "" : "n"} repetido{nDuplicados === 1 ? "" : "s"} ({gruposDuplicados.length} caso{gruposDuplicados.length === 1 ? "" : "s"}).
              </span>
              <button onClick={() => setDuplicadosOpen(true)} style={{ flexShrink: 0, padding: "6px 12px", fontSize: "var(--fs-1)", fontWeight: 700, background: "var(--alerta)", color: "var(--texto-inv)", border: "none", borderRadius: 8, cursor: "pointer" }}>Revisar</button>
            </div>
          )}

          {cargando && <div style={{ fontSize: "var(--fs-2)", color: "var(--texto-sec)", textAlign: "center", padding: 20 }}>Cargando registros…</div>}

          {!cargando && filtrados.length === 0 && (
            <div style={{ ...card, textAlign: "center", padding: "26px 14px" }}>
              <div style={{ fontSize: 30, marginBottom: 6 }}>📓</div>
              <div style={{ fontSize: 14, color: "var(--texto-sec)" }}>{registros.length === 0 ? "Tu logbook está vacío. Fotografía tu primer protocolo en 📷 Nueva." : "Ningún registro coincide con el filtro."}</div>
            </div>
          )}

          {filtrados.map((r) => (
            <div key={r.id} {...gestosPulsacion(r)} style={{ ...card, cursor: "pointer", WebkitTouchCallout: "none" }} onClick={() => { if (consumioPulsacionLarga()) return; setAbierto(abierto === r.id ? null : r.id); }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--texto)" }}>
                    {r.procedimiento}{latTxt(r) ? ` (${latTxt(r).toLowerCase()})` : ""}
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
                    <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: esMayor(r) ? "var(--peligro)" : "var(--peligro-bg)", color: esMayor(r) ? "var(--texto-inv)" : "var(--peligro)", border: "0.5px solid var(--peligro)" }}>
                      ⚠ {etiquetaEvento(r)}{esMayor(r) ? " · mayor" : ""}
                    </span>
                  )}
                  {esBox(r) && (
                    <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: "var(--fondo-suave)", color: "var(--texto-sec)", border: "0.5px solid var(--borde)" }}>
                      🏥 Box
                    </span>
                  )}
                  {esIncidente(r) && (
                    <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: "var(--fondo-suave)", color: "var(--texto-sec)", border: "0.5px solid var(--borde)" }}>
                      ℹ Incidente
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
                  {(r.biopsia_peso_g != null || r.biopsia_extension || r.biopsia_margenes) && (
                    <div><b>Pieza:</b> {[r.biopsia_peso_g != null ? `${r.biopsia_peso_g} g` : "", r.biopsia_extension, r.biopsia_margenes ? `márgenes ${r.biopsia_margenes.toLowerCase()}` : ""].filter(Boolean).join(" · ")}</div>
                  )}
                  {r.rtuv_musculo && <div><b>Músculo en la muestra:</b> {(MUSCULO_MUESTRA.find(([v]) => v === r.rtuv_musculo) || [, r.rtuv_musculo])[1]}</div>}
                  {r.control_stone_free && <div><b>Control:</b> {r.control_stone_free === "stone_free" ? "✓ Stone free" : r.control_stone_free === "fragmento_residual" ? "Fragmento residual" : "Pendiente"}{r.control_imagen_detalle ? ` — ${r.control_imagen_detalle}` : ""}</div>}
                  {(r.control_resultado || r.control_evolucion) && <div><b>Control post-op{r.control_fecha ? ` (${r.control_fecha})` : ""}:</b> {LABEL_CONTROL_POSTOP[r.control_resultado] || ""}{r.control_evolucion ? `${r.control_resultado ? " — " : ""}${r.control_evolucion}` : ""}</div>}
                  {r.hallazgos && <div><b>Hallazgos:</b> {r.hallazgos}</div>}
                  {r.tecnica && <div><b>Técnica:</b> {r.tecnica}</div>}
                  {r.detalles_complicacion && <div style={{ color: esIncidente(r) ? "var(--texto-sec)" : "var(--peligro)" }}><b>{esIncidente(r) ? "Incidente" : `Complicación (${etiquetaEvento(r)})`}:</b> {r.detalles_complicacion}</div>}
                  {r.observaciones && <div><b>Obs:</b> {r.observaciones}</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    {r.foto_path && <button onClick={() => verFoto(r.foto_path)} style={{ ...btnSec, padding: "6px 12px", fontSize: "var(--fs-1)" }}>🖼 Ver protocolo</button>}
                    <button onClick={() => empezarEdicion(r)} style={{ ...btnSec, padding: "6px 12px", fontSize: "var(--fs-1)" }}>✏️ Editar</button>
                    <button onClick={() => abrirPatRapida(r)} style={{ ...btnSec, padding: "6px 12px", fontSize: "var(--fs-1)", color: "var(--primario)", fontWeight: 700 }}>➕ Biopsia / control</button>
                    <button onClick={() => abrirComplRapida(r)} style={{ ...btnSec, padding: "6px 12px", fontSize: "var(--fs-1)" }}>⚠️ Complicación</button>
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

          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button onClick={() => { setSeleccionGrupos([]); setAgruparOpen(true); }} style={{ padding: "5px 11px", fontSize: "var(--fs-0)", fontWeight: 600, borderRadius: 20, cursor: "pointer", border: "0.5px solid var(--borde)", background: "var(--superficie)", color: "var(--primario)" }}>
              🧩 Agrupar{Object.keys(aliasProc).length > 0 ? ` (${Object.keys(aliasProc).length})` : ""}
            </button>
            <button onClick={() => setCertOpen(true)} style={{ padding: "5px 11px", fontSize: "var(--fs-0)", fontWeight: 700, borderRadius: 20, cursor: "pointer", border: "none", background: "var(--primario)", color: "var(--texto-inv)" }}>
              📜 Certificado
            </button>
          </div>

          {filtroRolMet !== "todos" && (
            <div style={{ fontSize: "var(--fs-0)", color: "var(--primario)", fontWeight: 700, marginTop: -4 }}>
              Filtrando: {(FILTROS_ROL.find(([id]) => id === filtroRolMet) || [, filtroRolMet])[1]} — toca la tarjeta otra vez para quitar el filtro
            </div>
          )}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div onClick={() => { setFiltroRolMet("todos"); setProcAbierto(null); }} style={{ ...kpi, cursor: "pointer", border: filtroRolMet === "todos" ? "1.5px solid var(--primario)" : "0.5px solid var(--borde)" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--primario)" }}>{met.total}</div>
              <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-sec)" }}>Cirugías registradas</div>
            </div>
            <div onClick={() => { setFiltroRolMet(filtroRolMet === "cirujano" ? "todos" : "cirujano"); setProcAbierto(null); }} style={{ ...kpi, cursor: "pointer", border: filtroRolMet === "cirujano" ? "1.5px solid var(--exito)" : "0.5px solid var(--borde)" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--exito)" }}>{met.comoCirujano}</div>
              <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-sec)" }}>Como cirujano principal{met.total > 0 ? ` (${Math.round((met.comoCirujano / met.total) * 100)}%)` : ""}</div>
            </div>
            <div onClick={() => { setFiltroRolMet(ES_FILTRO_AYUDANTE.includes(filtroRolMet) ? "todos" : "ayudante"); setProcAbierto(null); }} style={{ ...kpi, cursor: "pointer", border: ES_FILTRO_AYUDANTE.includes(filtroRolMet) ? "1.5px solid var(--primario)" : "0.5px solid var(--borde)" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--primario)" }}>{met.comoAyudante}</div>
              <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-sec)" }}>Como ayudante{met.total > 0 ? ` (${Math.round((met.comoAyudante / met.total) * 100)}%)` : ""} · toca para desglosar</div>
            </div>
            <div style={{ ...kpi, minWidth: 180 }}>
              <div style={{ fontSize: "var(--fs-3)", fontWeight: 700, color: "var(--primario)", lineHeight: 1.25 }}>{met.masFrecuente ? met.masFrecuente.label : "—"}</div>
              <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-sec)", marginTop: 3 }}>Procedimiento más frecuente{met.masFrecuente ? ` (${met.masFrecuente.n})` : ""}</div>
            </div>
          </div>

          {ES_FILTRO_AYUDANTE.includes(filtroRolMet) && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {["primer_ayudante", "segundo_ayudante", "tercer_ayudante", "cuarto_ayudante"].map((rid) => {
                const n = registros.filter((r) => (criterioMet === "onco" ? esOncologica(r) : criterioMet === "noonco" ? !esOncologica(r) : true) && r.rol === rid).length;
                const on = filtroRolMet === rid;
                const label = (ROLES.find(([id]) => id === rid) || [, rid])[1];
                return (
                  <div key={rid} onClick={() => { setFiltroRolMet(on ? "ayudante" : rid); setProcAbierto(null); }} style={{ flex: "1 1 110px", cursor: "pointer", textAlign: "center", padding: "9px 8px", background: on ? "var(--fondo-suave)" : "var(--superficie)", border: on ? "1.5px solid var(--primario)" : "0.5px solid var(--borde)", borderRadius: 10 }}>
                    <div style={{ fontSize: 19, fontWeight: 700, color: "var(--primario)" }}>{n}</div>
                    <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-sec)" }}>{label}</div>
                  </div>
                );
              })}
            </div>
          )}

          {(met.complIntra > 0 || met.complPost > 0 || met.incidentes > 0) && (
            <div style={{ ...card, borderLeft: "3px solid var(--peligro)" }}>
              {/* Una sola cifra: complicaciones mayores. Sin porcentaje — con
                  denominadores de dos dígitos un "12%" sugiere una precisión
                  que no existe, y el número absoluto es el que se discute. */}
              <div onClick={() => setComplDesglose((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
                <div style={{ fontSize: 30, fontWeight: 700, color: "var(--peligro)", lineHeight: 1 }}>{met.complMayores}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "var(--fs-2)", fontWeight: 700, color: "var(--texto)" }}>
                    Complicaciones mayores <span style={{ fontWeight: 400, color: "var(--texto-ter)" }}>de {met.total}</span>
                  </div>
                  <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-sec)", marginTop: 2 }}>
                    Clavien-Dindo ≥ IIIa · las que requirieron alguna intervención
                  </div>
                </div>
                <span style={{ flexShrink: 0, fontSize: "var(--fs-1)", color: "var(--primario)", fontWeight: 700 }}>{complDesglose ? "▴" : "▾"}</span>
              </div>

              {complDesglose && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "0.5px solid var(--borde)", display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    { k: "intra", n: met.mayoresIntra, tot: met.complIntra, label: "Intraoperatorias", sub: "Ocurridas en pabellón", color: "var(--peligro)", cond: (r) => esMayor(r) && esIntra(r), condTot: esIntra },
                    { k: "post", n: met.mayoresPost, tot: met.complPost, label: "Post-operatorias", sub: "Ocurridas después de la cirugía", color: "var(--alerta)", cond: (r) => esMayor(r) && esPost(r), condTot: esPost },
                  ].map((f) => (
                    <div key={f.k} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", background: "var(--fondo-suave)", border: "0.5px solid var(--borde)", borderRadius: 9 }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: f.color, minWidth: 28, textAlign: "center" }}>{f.n}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "var(--fs-1)", fontWeight: 600, color: "var(--texto)" }}>{f.label}</div>
                        <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)" }}>{f.sub}</div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {f.n > 0 && <button onClick={() => abrirLista(`⚠ Mayores · ${f.label.toLowerCase()}`, f.cond, true)} style={{ padding: "5px 10px", fontSize: "var(--fs-0)", fontWeight: 700, background: "var(--superficie)", color: "var(--peligro)", border: "0.5px solid var(--peligro)", borderRadius: 8, cursor: "pointer" }}>Ver mayores</button>}
                        {f.tot > 0 && <button onClick={() => abrirLista(`⚠ Todas · ${f.label.toLowerCase()}`, f.condTot, true)} style={{ padding: "5px 10px", fontSize: "var(--fs-0)", fontWeight: 600, background: "var(--superficie)", color: "var(--texto-sec)", border: "0.5px solid var(--borde)", borderRadius: 8, cursor: "pointer" }}>Todas ({f.tot})</button>}
                      </div>
                    </div>
                  ))}
                  {met.incidentes > 0 && (
                    <div onClick={() => abrirLista("ℹ Incidentes sin consecuencia", esIncidente, true)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", background: "var(--superficie)", border: "0.5px solid var(--borde)", borderRadius: 9, cursor: "pointer" }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--texto-sec)", minWidth: 28, textAlign: "center" }}>{met.incidentes}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "var(--fs-1)", fontWeight: 600, color: "var(--texto-sec)" }}>Incidentes sin consecuencia</div>
                        <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)" }}>Fallas de equipo o insumo · no cuentan como complicación</div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div style={card}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1, fontSize: "var(--fs-2)", fontWeight: 600, color: "var(--texto)" }}>
                Volumen mensual (últimos 12 meses)
                <span style={{ fontSize: "var(--fs-0)", fontWeight: 400, color: "var(--texto-ter)", marginLeft: 8 }}>■ como cirujano · <span style={{ opacity: 0.4 }}>■</span> total</span>
              </div>
              <button onClick={() => setGraficoOpen(true)} title="Ampliar gráfico" style={{ flexShrink: 0, background: "var(--fondo-suave)", border: "0.5px solid var(--borde)", borderRadius: 8, color: "var(--primario)", cursor: "pointer", fontSize: "var(--fs-1)", fontWeight: 700, padding: "5px 10px" }}>⤢ Ampliar</button>
            </div>
            <BarrasMensuales datos={met.meses} onMes={(m) => { setGraficoOpen(true); setMesAbierto(m); }} />
            <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)", marginTop: 6, textAlign: "center" }}>Toca un mes para ver sus cirugías</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
            <div style={card}>
              <div style={{ fontSize: "var(--fs-2)", fontWeight: 600, color: "var(--texto)", marginBottom: 10 }}>Procedimientos más frecuentes <span style={{fontSize:"var(--fs-0)",fontWeight:400,color:"var(--texto-ter)"}}>· toca para abrir</span></div>
              <BarrasHorizontales items={met.topProc} onItem={(it) => abrirLista(it.label, (r) => grupoProc(r.procedimiento) === it.label)} />
            </div>
            <div style={card}>
              <div style={{ fontSize: "var(--fs-2)", fontWeight: 600, color: "var(--texto)", marginBottom: 10 }}>Ayudantías por procedimiento <span style={{fontSize:"var(--fs-0)",fontWeight:400,color:"var(--texto-ter)"}}>· toca para abrir</span></div>
              <BarrasHorizontales items={met.ayudantiasPorProc} color="var(--alerta)" onItem={(it) => abrirLista(`Ayudantías · ${it.label}`, (r) => grupoProc(r.procedimiento) === it.label && ROLES_AYUDANTE.includes(r.rol))} />
            </div>
            <div style={card}>
              <div style={{ fontSize: "var(--fs-2)", fontWeight: 600, color: "var(--texto)", marginBottom: 10 }}>Por categoría <span style={{fontSize:"var(--fs-0)",fontWeight:400,color:"var(--texto-ter)"}}>· toca para abrir</span></div>
              <BarrasHorizontales items={met.cats} color="var(--exito)" onItem={(it) => abrirLista(`Categoría · ${it.label}`, (r) => (r.categoria || "Sin categoría") === it.label)} />
            </div>
            <div style={card}>
              <div style={{ fontSize: "var(--fs-2)", fontWeight: 600, color: "var(--texto)", marginBottom: 10 }}>Por rol asumido <span style={{fontSize:"var(--fs-0)",fontWeight:400,color:"var(--texto-ter)"}}>· toca para abrir</span></div>
              <BarrasHorizontales items={met.porRol} color="var(--primario)" onItem={(it) => { const rid = (ROLES.find(([, l]) => l === it.label) || [])[0]; if (rid) abrirLista(`Rol · ${it.label}`, (r) => r.rol === rid); }} />
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
                            <button onClick={() => abrirLista(d.label, (r) => grupoProc(r.procedimiento) === d.label)} style={{ marginBottom: 10, padding: "7px 12px", fontSize: "var(--fs-1)", fontWeight: 700, background: "var(--primario)", color: "var(--texto-inv)", border: "none", borderRadius: 8, cursor: "pointer" }}>📋 Ver las {d.n} cirugías</button>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                              <Chip label="Cirujano" val={d.cx} />
                              {d.ayud > 0 && <Chip label="Ayudante" val={d.ayud} />}
                              {d.dur && <Chip label="Duración" val={`${d.dur.med} min`} sub={`n=${d.dur.n}`} />}
                              {d.sangrado && <Chip label="Sangrado" val={`${d.sangrado.med} ml`} sub={`n=${d.sangrado.n}`} />}
                              {d.litiasis && <Chip label="Litiasis" val={`${d.litiasis.med} mm`} sub={`n=${d.litiasis.n}`} />}
                              {d.prostata && <Chip label="Próstata" val={`${d.prostata.med} cc`} sub={`n=${d.prostata.n}`} />}
                              {d.complIntra > 0 && <Chip label="Complic. intraop." val={d.complIntra} />}
                              {d.complPost > 0 && <Chip label="Complic. post-op" val={d.complPost} />}
                              {d.stoneFree && <Chip label="Stone free" val={`${d.stoneFree.free}/${d.stoneFree.total}`} ok />}
                              {d.controlPostop && <Chip label="Control favorable" val={`${d.controlPostop.fav}/${d.controlPostop.total}`} ok />}
                              {d.controlPostop && d.controlPostop.mayor > 0 && <Chip label="Clavien ≥ III" val={`${d.controlPostop.mayor}/${d.controlPostop.total}`} />}
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

      {/* ─── Modal: visor genérico de cirugías (con protocolo y edición) ─── */}
      {listaAbierta && (() => {
        const regs = listaAbierta.ids.map((id) => registros.find((r) => r.id === id)).filter(Boolean);
        return (
          <div onClick={() => setListaAbierta(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--fondo)", border: "0.5px solid var(--borde)", borderRadius: 14, padding: 14, width: "100%", maxWidth: 640, maxHeight: "90dvh", display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--texto)" }}>{listaAbierta.titulo} <span style={{ color: "var(--texto-ter)", fontWeight: 400 }}>({regs.length})</span></div>
                <button onClick={() => setListaAbierta(null)} style={{ background: "none", border: "none", fontSize: 20, color: "var(--texto-ter)", cursor: "pointer", lineHeight: 1 }}>✕</button>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                {regs.length === 0 && <div style={{ fontSize: "var(--fs-1)", color: "var(--texto-ter)", textAlign: "center", padding: 14 }}>Sin cirugías con el filtro actual.</div>}
                {regs.map((r) => (
                  <div key={r.id} style={{ background: "var(--superficie)", border: "0.5px solid var(--borde)", borderRadius: 9, padding: "9px 11px" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "var(--fs-0)", fontWeight: 700, color: "var(--primario)" }}>{(r.fecha || "").split("-").reverse().join("/")}</span>
                      <span style={{ fontSize: "var(--fs-1)", fontWeight: 600, color: "var(--texto)", flex: 1, minWidth: 120 }}>{r.procedimiento || "—"}{latTxt(r) ? ` (${latTxt(r)})` : ""}</span>
                    </div>
                    <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)", marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <span>{(ROLES.find(([id]) => id === r.rol) || [, r.rol])[1]}</span>
                      {r.iniciales && <span>· {r.iniciales}</span>}
                      {r.duracion_min > 0 && <span>· {r.duracion_min} min</span>}
                      {r.complicacion && <span style={{ color: "var(--peligro)", fontWeight: 700 }}>· ⚠ {etiquetaEvento(r)}</span>}
                    </div>
                    {r.detalles_complicacion && <div style={{ fontSize: "var(--fs-0)", color: "var(--peligro)", marginTop: 3 }}>{r.detalles_complicacion}</div>}
                    <div style={{ display: "flex", gap: 6, marginTop: 7, flexWrap: "wrap" }}>
                      {r.foto_path && <button onClick={() => verFoto(r.foto_path)} style={{ padding: "6px 11px", fontSize: "var(--fs-0)", fontWeight: 700, background: "var(--fondo-suave)", color: "var(--primario)", border: "0.5px solid var(--borde)", borderRadius: 8, cursor: "pointer" }}>🖼 Ver protocolo</button>}
                      <button onClick={() => { setListaAbierta(null); empezarEdicion(r); }} style={{ padding: "6px 11px", fontSize: "var(--fs-0)", fontWeight: 700, background: "var(--fondo-suave)", color: "var(--texto)", border: "0.5px solid var(--borde)", borderRadius: 8, cursor: "pointer" }}>✏️ Editar</button>
                      {listaAbierta.esComplicaciones && (
                        <button onClick={() => { setListaAbierta(null); abrirComplRapida(r); }} style={{ padding: "6px 11px", fontSize: "var(--fs-0)", fontWeight: 700, background: "var(--fondo-suave)", color: "var(--texto)", border: "0.5px solid var(--borde)", borderRadius: 8, cursor: "pointer" }}>⚠️ Cambiar complicación</button>
                      )}
                      {listaAbierta.esComplicaciones && r.complicacion && (
                        <button onClick={() => quitarComplicacion(r)} style={{ padding: "6px 11px", fontSize: "var(--fs-0)", fontWeight: 700, background: "var(--superficie)", color: "var(--exito)", border: "1px solid var(--exito)", borderRadius: 8, cursor: "pointer" }}>✓ No fue complicación</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ─── Modal: complementar biopsia / control post-operatorio ─── */}
      {patRapida && (
        <div onClick={() => setPatRapida(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--fondo)", border: "0.5px solid var(--borde)", borderRadius: 14, padding: 16, width: "100%", maxWidth: 560, maxHeight: "88dvh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--texto)" }}>Complementar registro</div>
                <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)", marginTop: 2 }}>
                  {patRapida.reg.procedimiento || "—"}{latTxt(patRapida.reg) ? ` (${latTxt(patRapida.reg).toLowerCase()})` : ""} · {(patRapida.reg.fecha || "").split("-").reverse().join("/")}
                  {patRapida.reg.iniciales ? ` · ${patRapida.reg.iniciales}` : ""}
                </div>
              </div>
              <button onClick={() => setPatRapida(null)} style={{ background: "none", border: "none", fontSize: 20, color: "var(--texto-ter)", cursor: "pointer", lineHeight: 1 }}>✕</button>
            </div>

            <div style={{ marginTop: 14, fontSize: "var(--fs-1)", fontWeight: 700, color: "var(--primario)" }}>🔬 Anatomía patológica</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginTop: 8 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={lbl}>Resultado</label>
                <input style={inp} value={patRapida.datos.biopsia_resultado} onChange={(e) => setPat("biopsia_resultado", e.target.value)} placeholder="Ej: Adenocarcinoma acinar" />
              </div>
              {patRapida.campos.isup && (
                <div>
                  <label style={lbl}>ISUP</label>
                  <select style={inp} value={patRapida.datos.biopsia_isup} onChange={(e) => setPat("biopsia_isup", e.target.value)}>
                    <option value="">—</option>{["1", "2", "3", "4", "5"].map((g) => <option key={g} value={g}>ISUP {g}</option>)}
                  </select>
                </div>
              )}
              {patRapida.campos.peso && (
                <div>
                  <label style={lbl}>{patRapida.campos.etiquetaPeso}</label>
                  <input type="number" inputMode="decimal" style={inp} value={patRapida.datos.biopsia_peso_g} onChange={(e) => setPat("biopsia_peso_g", e.target.value)} placeholder="g" />
                </div>
              )}
              {patRapida.campos.extension && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={lbl}>Extensión</label>
                  <select style={inp} value={patRapida.datos.biopsia_extension} onChange={(e) => setPat("biopsia_extension", e.target.value)}>
                    <option value="">—</option>{patRapida.campos.extension.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </div>
              )}
              {patRapida.campos.margenes && (
                <div>
                  <label style={lbl}>Márgenes</label>
                  <select style={inp} value={patRapida.datos.biopsia_margenes} onChange={(e) => setPat("biopsia_margenes", e.target.value)}>
                    <option value="">—</option><option value="Negativos">Negativos</option><option value="Positivos">Positivos</option><option value="No evaluables">No evaluables</option>
                  </select>
                </div>
              )}
              {patRapida.campos.musculo && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={lbl}>¿Hay músculo detrusor en la muestra?</label>
                  <select style={inp} value={patRapida.datos.rtuv_musculo} onChange={(e) => setPat("rtuv_musculo", e.target.value)}>
                    <option value="">—</option>{MUSCULO_MUESTRA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)", marginTop: 4 }}>Sin músculo en la pieza el T no es evaluable y suele indicarse re-RTU.</div>
                </div>
              )}
            </div>

            <div style={{ marginTop: 16, paddingTop: 12, borderTop: "0.5px solid var(--borde)", fontSize: "var(--fs-1)", fontWeight: 700, color: "var(--primario)" }}>🩺 Control post-operatorio</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginTop: 8 }}>
              <div>
                <label style={lbl}>Fecha del control</label>
                <input type="date" style={inp} value={patRapida.datos.control_fecha} onChange={(e) => setPat("control_fecha", e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Resultado</label>
                <select style={inp} value={patRapida.datos.control_resultado} onChange={(e) => setPat("control_resultado", e.target.value)}>
                  <option value="">—</option>{OPCIONES_CONTROL_POSTOP.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={lbl}>Evolución</label>
                <textarea rows={2} style={{ ...inp, resize: "vertical" }} value={patRapida.datos.control_evolucion} onChange={(e) => setPat("control_evolucion", e.target.value)} placeholder="Ej: asintomático, retiro de JJ a las 3 semanas" />
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={guardarPatRapida} disabled={patGuardando} style={{ ...btnPrim, opacity: patGuardando ? 0.6 : 1 }}>{patGuardando ? "Guardando…" : "Guardar"}</button>
              <button onClick={() => setPatRapida(null)} style={btnSec}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal: editor rápido de complicación (pulsación larga) ─── */}
      {complRapida && (
        <div onClick={() => setComplRapida(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--fondo)", border: "0.5px solid var(--borde)", borderRadius: 14, padding: 16, width: "100%", maxWidth: 520, maxHeight: "88dvh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--texto)" }}>Complicación</div>
                <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)", marginTop: 2 }}>
                  {complRapida.reg.procedimiento || "—"}{latTxt(complRapida.reg) ? ` (${latTxt(complRapida.reg).toLowerCase()})` : ""} · {(complRapida.reg.fecha || "").split("-").reverse().join("/")}
                  {complRapida.reg.iniciales ? ` · ${complRapida.reg.iniciales}` : ""}
                </div>
              </div>
              <button onClick={() => setComplRapida(null)} style={{ background: "none", border: "none", fontSize: 20, color: "var(--texto-ter)", cursor: "pointer", lineHeight: 1 }}>✕</button>
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={lbl}>¿Qué pasó?</label>
              <select style={inp} value={complRapida.valor} onChange={(e) => setComplRapida((c) => ({ ...c, valor: e.target.value }))}>
                {GRADOS_CLAVIEN.map((e) => <option key={e.v} value={e.v}>{e.label}</option>)}
              </select>
              {GRADO_POR_VALOR[complRapida.valor]?.complicacion && (
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  {MOMENTOS_COMPLICACION.map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setComplRapida((c) => ({ ...c, momento: v }))} style={{ flex: 1, padding: "8px 6px", fontSize: "var(--fs-1)", fontWeight: 600, borderRadius: 8, cursor: "pointer", border: "0.5px solid " + (complRapida.momento === v ? "var(--peligro)" : "var(--borde)"), background: complRapida.momento === v ? "var(--peligro)" : "var(--superficie)", color: complRapida.momento === v ? "var(--texto-inv)" : "var(--texto-sec)" }}>{l}</button>
                  ))}
                </div>
              )}
            </div>

            {complRapida.valor !== "ninguno" && (
              <div style={{ marginTop: 12 }}>
                <label style={lbl}>Detalle</label>
                <textarea rows={3} style={{ ...inp, resize: "vertical" }} value={complRapida.detalle} onChange={(e) => setComplRapida((c) => ({ ...c, detalle: e.target.value }))} placeholder="Ej: perforación vesical pequeña, se dejó Foley 5 días" />
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button onClick={guardarComplRapida} disabled={complGuardando} style={{ ...btnPrim, opacity: complGuardando ? 0.6 : 1 }}>{complGuardando ? "Guardando…" : "Guardar"}</button>
              <button onClick={() => setComplRapida(null)} style={btnSec}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal: gráfico mensual ampliado + cirugías del mes ─── */}
      {graficoOpen && (
        <div onClick={() => { setGraficoOpen(false); setMesAbierto(null); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--fondo)", border: "0.5px solid var(--borde)", borderRadius: 14, padding: 16, width: "100%", maxWidth: 720, maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: "var(--texto)" }}>📊 Volumen mensual</div>
              <button onClick={() => { setGraficoOpen(false); setMesAbierto(null); }} style={{ background: "none", border: "none", fontSize: 20, color: "var(--texto-ter)", cursor: "pointer", lineHeight: 1 }}>✕</button>
            </div>

            <BarrasMensuales datos={met.meses} alto={260} onMes={(m) => setMesAbierto((prev) => (prev === m ? null : m))} resaltado={mesAbierto} />
            <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)", textAlign: "center", margin: "6px 0 12px" }}>
              ■ como cirujano · <span style={{ opacity: 0.4 }}>■</span> total — toca un mes para ver el detalle
            </div>

            {(() => {
              const m = met.meses.find((x) => x.mes === mesAbierto);
              if (!m) return (
                <div style={{ fontSize: "var(--fs-1)", color: "var(--texto-ter)", textAlign: "center", padding: "14px 8px" }}>
                  Selecciona un mes en el gráfico para ver las cirugías de ese período.
                </div>
              );
              if (m.registros.length === 0) return (
                <div style={{ fontSize: "var(--fs-1)", color: "var(--texto-ter)", textAlign: "center", padding: "14px 8px" }}>
                  No hay cirugías registradas en {mesLabel(m.mes)}.
                </div>
              );
              return (
                <div>
                  <div style={{ fontSize: "var(--fs-2)", fontWeight: 700, color: "var(--texto)", marginBottom: 6 }}>
                    {mesLabel(m.mes)} — {m.total} cirugía{m.total === 1 ? "" : "s"} ({m.cirujano} como cirujano)
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {m.registros.map((r) => (
                      <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 10px", background: "var(--superficie)", border: "0.5px solid var(--borde)", borderRadius: 8 }}>
                        <div style={{ flexShrink: 0, fontSize: "var(--fs-0)", fontWeight: 700, color: "var(--primario)", minWidth: 56 }}>{(r.fecha || "").split("-").reverse().slice(0, 2).join("/")}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "var(--fs-1)", fontWeight: 600, color: "var(--texto)" }}>{r.procedimiento || "—"}{latTxt(r) ? ` (${latTxt(r)})` : ""}</div>
                          <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)", display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <span>{(ROLES.find(([id]) => id === r.rol) || [, r.rol])[1]}</span>
                            {r.categoria && <span>· {r.categoria}</span>}
                            {r.duracion_min > 0 && <span>· {r.duracion_min} min</span>}
                            {r.iniciales && <span>· {r.iniciales}</span>}
                            {r.complicacion && <span style={{ color: "var(--peligro)", fontWeight: 700 }}>· ⚠ {etiquetaEvento(r)}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ─── Modal: certificado de casuística en PDF ─── */}
      {certOpen && (() => {
        const fechas = registros.map((r) => r.fecha).filter(Boolean).sort();
        const desde = certDesde || fechas[0] || "";
        const hasta = certHasta || new Date().toISOString().slice(0, 10);
        const enRango = registros.filter((r) => r.fecha && r.fecha >= (desde || "0000") && r.fecha <= (hasta || "9999"));
        const nCx = enRango.filter((r) => r.rol === "cirujano").length;
        const nAy = enRango.filter((r) => ROLES_AYUDANTE.includes(r.rol)).length;
        return (
          <div onClick={() => setCertOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--fondo)", border: "0.5px solid var(--borde)", borderRadius: 14, padding: 16, width: "100%", maxWidth: 460 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: "var(--texto)" }}>📜 Certificado de casuística</div>
                <button onClick={() => setCertOpen(false)} style={{ background: "none", border: "none", fontSize: 20, color: "var(--texto-ter)", cursor: "pointer", lineHeight: 1 }}>✕</button>
              </div>
              <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)", marginBottom: 14, lineHeight: 1.5 }}>
                Documento PDF con tu casuística por procedimiento y rol, listo para presentar: incluye resumen, tabla detallada, complicaciones y líneas de firma para ti y tu tutor.
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: "var(--fs-0)", fontWeight: 600, color: "var(--texto-sec)", marginBottom: 4 }}>Desde</label>
                  <input type="date" value={certDesde || fechas[0] || ""} onChange={(e) => setCertDesde(e.target.value)} style={{ width: "100%", padding: "9px 10px", fontSize: "var(--fs-1)", background: "var(--superficie)", color: "var(--texto)", border: "0.5px solid var(--borde)", borderRadius: 8, boxSizing: "border-box" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: "var(--fs-0)", fontWeight: 600, color: "var(--texto-sec)", marginBottom: 4 }}>Hasta</label>
                  <input type="date" value={certHasta || new Date().toISOString().slice(0, 10)} onChange={(e) => setCertHasta(e.target.value)} style={{ width: "100%", padding: "9px 10px", fontSize: "var(--fs-1)", background: "var(--superficie)", color: "var(--texto)", border: "0.5px solid var(--borde)", borderRadius: 8, boxSizing: "border-box" }} />
                </div>
              </div>

              <div style={{ fontSize: "var(--fs-1)", color: "var(--texto)", background: "var(--fondo-suave)", borderRadius: 8, padding: "9px 12px", marginBottom: 12 }}>
                En este rango: <b>{enRango.length}</b> cirugía{enRango.length === 1 ? "" : "s"} — {nCx} como cirujano, {nAy} como ayudante.
              </div>

              <button onClick={generarCertificado} disabled={certGenerando || enRango.length === 0} style={{ width: "100%", padding: 12, fontSize: "var(--fs-2)", fontWeight: 700, background: enRango.length === 0 ? "var(--borde)" : "var(--primario)", color: "var(--texto-inv)", border: "none", borderRadius: 9, cursor: certGenerando || enRango.length === 0 ? "default" : "pointer", opacity: certGenerando ? 0.6 : 1 }}>
                {certGenerando ? "Generando…" : "📄 Generar PDF"}
              </button>
            </div>
          </div>
        );
      })()}

      {/* ─── Modal: agrupar cirugías escritas de distinta forma ─── */}
      {agruparOpen && (() => {
        // Todos los grupos detectados hoy, con su conteo y los nombres crudos que contienen.
        const mapa = new Map();
        registros.forEach((r) => {
          const g = grupoProc(r.procedimiento);
          if (!mapa.has(g)) mapa.set(g, { nombre: g, n: 0, crudos: new Set() });
          const e = mapa.get(g);
          e.n++;
          if (r.procedimiento) e.crudos.add(r.procedimiento.trim());
        });
        const grupos = Array.from(mapa.values()).sort((a, b) => b.n - a.n);
        return (
          <div onClick={() => setAgruparOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--fondo)", border: "0.5px solid var(--borde)", borderRadius: 14, padding: 16, width: "100%", maxWidth: 620, maxHeight: "88vh", overflowY: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: "var(--texto)" }}>🧩 Agrupar cirugías</div>
                <button onClick={() => setAgruparOpen(false)} style={{ background: "none", border: "none", fontSize: 20, color: "var(--texto-ter)", cursor: "pointer", lineHeight: 1 }}>✕</button>
              </div>
              <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)", marginBottom: 12, lineHeight: 1.5 }}>
                UroSearch junta solo las variantes de escritura que reconoce. Si dos grupos son en realidad la misma cirugía, márcalos y únelos: las métricas los contarán juntos. Esto no modifica ningún registro, solo cómo se agrupan.
              </div>

              {seleccionGrupos.length === 1 && (
                <RenombrarGrupo
                  origen={seleccionGrupos[0]}
                  onRenombrar={(nuevoNombre) => {
                    const limpio = nuevoNombre.trim();
                    if (!limpio || limpio === seleccionGrupos[0]) return;
                    const nuevo = { ...aliasProc, [seleccionGrupos[0]]: limpio };
                    Object.keys(nuevo).forEach((k) => { if (nuevo[k] === seleccionGrupos[0]) nuevo[k] = limpio; });
                    guardarAlias(nuevo);
                    setSeleccionGrupos([]);
                  }}
                  onCancelar={() => setSeleccionGrupos([])}
                />
              )}

              {seleccionGrupos.length >= 2 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 10, background: "var(--fondo-suave)", border: "1px solid var(--primario)", borderRadius: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: "var(--fs-1)", fontWeight: 700, color: "var(--texto)" }}>Unir {seleccionGrupos.length} grupos bajo el nombre:</div>
                  {seleccionGrupos.map((g) => (
                    <button key={g} onClick={() => {
                      const nuevo = { ...aliasProc };
                      seleccionGrupos.forEach((origen) => { if (origen !== g) nuevo[origen] = g; });
                      // Reencadenar: si algo apuntaba a uno de los unidos, ahora apunta al destino
                      Object.keys(nuevo).forEach((k) => { if (seleccionGrupos.includes(nuevo[k]) && nuevo[k] !== g) nuevo[k] = g; });
                      delete nuevo[g];
                      guardarAlias(nuevo);
                      setSeleccionGrupos([]);
                    }} style={{ textAlign: "left", padding: "8px 10px", fontSize: "var(--fs-1)", fontWeight: 600, background: "var(--superficie)", color: "var(--primario)", border: "0.5px solid var(--borde)", borderRadius: 8, cursor: "pointer" }}>
                      → {g}
                    </button>
                  ))}
                  <NombreNuevoGrupo onUnir={(nombre) => {
                    const limpio = nombre.trim();
                    if (!limpio) return;
                    const nuevo = { ...aliasProc };
                    seleccionGrupos.forEach((origen) => { if (origen !== limpio) nuevo[origen] = limpio; });
                    Object.keys(nuevo).forEach((k) => { if (seleccionGrupos.includes(nuevo[k]) && nuevo[k] !== limpio) nuevo[k] = limpio; });
                    delete nuevo[limpio];
                    guardarAlias(nuevo);
                    setSeleccionGrupos([]);
                  }} />
                  <button onClick={() => setSeleccionGrupos([])} style={{ padding: "6px", fontSize: "var(--fs-0)", background: "none", border: "none", color: "var(--texto-ter)", cursor: "pointer" }}>Cancelar selección</button>
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {grupos.map((g) => {
                  const marcado = seleccionGrupos.includes(g.nombre);
                  const variantes = Array.from(g.crudos);
                  return (
                    <div key={g.nombre} onClick={() => setSeleccionGrupos((prev) => marcado ? prev.filter((x) => x !== g.nombre) : [...prev, g.nombre])}
                      style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "9px 11px", background: marcado ? "var(--fondo-suave)" : "var(--superficie)", border: "1px solid " + (marcado ? "var(--primario)" : "var(--borde)"), borderRadius: 9, cursor: "pointer" }}>
                      <span style={{ flexShrink: 0, width: 18, height: 18, marginTop: 1, borderRadius: 4, border: "1px solid " + (marcado ? "var(--primario)" : "var(--borde)"), background: marcado ? "var(--primario)" : "transparent", color: "var(--texto-inv)", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>{marcado ? "✓" : ""}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "var(--fs-1)", fontWeight: 600, color: "var(--texto)" }}>{g.nombre} <span style={{ color: "var(--texto-ter)", fontWeight: 400 }}>· {g.n}</span></div>
                        {variantes.length > 1 && (
                          <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)", overflow: "hidden", textOverflow: "ellipsis" }}>{variantes.slice(0, 3).join(" · ")}{variantes.length > 3 ? ` · +${variantes.length - 3}` : ""}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {Object.keys(aliasProc).length > 0 && (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: "0.5px solid var(--borde)" }}>
                  <div style={{ fontSize: "var(--fs-1)", fontWeight: 700, color: "var(--texto)", marginBottom: 6 }}>Uniones activas</div>
                  {Object.entries(aliasProc).map(([origen, destino]) => (
                    <div key={origen} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--fs-0)", color: "var(--texto-sec)", padding: "4px 0" }}>
                      <span style={{ flex: 1, minWidth: 0 }}>{origen} → <b>{destino}</b></span>
                      <button onClick={() => { const n = { ...aliasProc }; delete n[origen]; guardarAlias(n); }} style={{ background: "none", border: "none", color: "var(--peligro)", cursor: "pointer", fontWeight: 700, fontSize: "var(--fs-0)" }}>Deshacer</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ─── Modal: revisar posibles duplicados ─── */}
      {duplicadosOpen && (
        <div onClick={() => setDuplicadosOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--fondo)", border: "0.5px solid var(--borde)", borderRadius: 14, padding: 16, width: "100%", maxWidth: 620, maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: "var(--texto)" }}>⚠️ Posibles duplicados</div>
              <button onClick={() => setDuplicadosOpen(false)} style={{ background: "none", border: "none", fontSize: 20, color: "var(--texto-ter)", cursor: "pointer", lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)", marginBottom: 12, lineHeight: 1.5 }}>
              Registros que comparten fecha, tipo de cirugía y paciente. Puede ser un duplicado real (por ejemplo, la misma cirugía cargada por foto y recibida del logbook de un compañero) o dos procedimientos distintos el mismo día. Revisa y elimina solo lo que corresponda.
            </div>

            {gruposDuplicados.length === 0 && (
              <div style={{ fontSize: "var(--fs-1)", color: "var(--texto-ter)", textAlign: "center", padding: "16px 8px" }}>✓ No quedan registros repetidos.</div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {gruposDuplicados.map((g) => (
                <div key={g.clave} style={{ border: "1px solid var(--alerta)", borderRadius: 10, padding: 10, background: "var(--superficie)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <div style={{ flex: 1, minWidth: 0, fontSize: "var(--fs-1)", fontWeight: 700, color: "var(--alerta)" }}>
                      {(g.items[0].fecha || "").split("-").reverse().join("/")} · {familiaProc(g.items[0].procedimiento)} · {g.items[0].iniciales || g.items[0].ficha_clinica || g.items[0].rut || ""} — {g.items.length} registros
                    </div>
                    <button onClick={() => ignorarDuplicado(g.claveIds)} title="Son procedimientos distintos del mismo día: dejar de sugerir" style={{ flexShrink: 0, padding: "5px 10px", fontSize: "var(--fs-0)", fontWeight: 700, background: "var(--superficie)", color: "var(--exito)", border: "1px solid var(--exito)", borderRadius: 8, cursor: "pointer" }}>✓ No son duplicados</button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {g.items.map((r) => (
                      <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "7px 9px", background: "var(--fondo-suave)", borderRadius: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "var(--fs-1)", fontWeight: 600, color: "var(--texto)" }}>{r.procedimiento || "—"}</div>
                          <div style={{ fontSize: "var(--fs-0)", color: "var(--texto-ter)" }}>
                            {(ROLES.find(([id]) => id === r.rol) || [, r.rol])[1]}
                            {r.cirujano ? ` · Cx: ${r.cirujano}` : ""}
                            {r.duracion_min > 0 ? ` · ${r.duracion_min} min` : ""}
                            {r.foto_path ? " · 🖼 con protocolo" : ""}
                            {r.extraido_ia ? " · leído por IA" : ""}
                          </div>
                        </div>
                        <button onClick={() => eliminar(r)} style={{ flexShrink: 0, background: "none", border: "1px solid var(--peligro)", color: "var(--peligro)", borderRadius: 8, padding: "5px 10px", fontSize: "var(--fs-0)", fontWeight: 700, cursor: "pointer" }}>🗑 Eliminar</button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
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

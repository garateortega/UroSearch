// ============================================================
// UroSearch — Set de íconos SVG unificados (duotono)
// Ubicación: src/iconos.jsx
//
// DIRECCIÓN DE DISEÑO
// Cada ícono combina una MASA rellena suave (currentColor con baja opacidad)
// con LINEWORK nítido encima. La masa da peso a tamaños pequeños en pantalla
// de celular, donde un ícono de solo línea se pierde; la línea mantiene la
// lectura precisa. La geometría es deliberadamente redondeada —cápsula, gota,
// cáliz—, que es el vocabulario de formas de la urología, en vez de geometría
// genérica de dashboard.
//
// El relleno usa currentColor + opacidad, nunca un segundo color fijo: así el
// set se adapta solo a tema claro/oscuro y a cualquier acento, sin API extra.
//
// Uso:
//   import { Ico } from "./iconos";
//   <Ico name="pacientes" size={18} />
//   <Ico name="pacientes" size={18} activo />     ← intensifica la masa
//   <span style={{ color: "var(--primario)" }}><Ico name="recetas" /></span>
//
// `activo` sirve para la pestaña seleccionada: la selección se lee por peso
// además de por color, que es lo que sostiene la jerarquía cuando el color
// solo no alcanza.
//
// Compatibilidad: mismos nombres y misma firma que la versión anterior.
// No hay que tocar nada en App.jsx para adoptarlo.
// ============================================================
import React from "react";

// Linework: 24×24, trazo 1.6, extremos redondeados.
const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };
// Masa rellena. Nunca se rellena una forma menor a ~4px del grid: se ensucia.
const M = (o) => ({ fill: "currentColor", stroke: "none", opacity: o });

const PATHS = (f) => ({
  // ─── Hospital ───
  pacientes: <>
    <circle cx="9" cy="8" r="3" {...M(f)} />
    <path d="M4 20c0-3 2-5 5-5s5 2 5 5" {...M(f * 0.55)} />
    <circle cx="9" cy="8" r="3" {...S} />
    <path d="M4 20c0-3 2-5 5-5s5 2 5 5" {...S} />
    <path d="M17 11a2.5 2.5 0 1 0 0-5" {...S} />
    <path d="M15 15.5c3 .3 5 2.2 5 4.5" {...S} />
  </>,
  tabla: <>
    <path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3H3V6z" {...M(f)} />
    <rect x="3" y="4" width="18" height="16" rx="2.5" {...S} />
    <path d="M3 9h18M3 14.5h18M9 9v11" {...S} />
  </>,
  notas: <>
    <path d="M14 3l5 5h-5V3z" {...M(f * 1.6)} />
    <path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" {...S} />
    <path d="M14 3v5h5M8.5 13h7M8.5 17h5" {...S} />
  </>,
  recetas: <>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5V7H4V5.5z" {...M(f * 1.5)} />
    <rect x="4" y="3" width="16" height="18" rx="2.5" {...S} />
    <path d="M4 7h16" {...S} />
    <path d="M8.5 10.5h4a2.2 2.2 0 0 1 0 4.4h-4v-4.4zM11.5 14.9l3 3.6" {...S} />
  </>,
  interconsultas: <>
    <path d="M20 4l-6 16-3.4-6L20 4z" {...M(f)} />
    <path d="M20 4L4 12l6.6 2L14 20l6-16z" {...S} />
    <path d="M20 4l-9.4 10" {...S} />
  </>,
  seguimiento: <>
    <circle cx="12" cy="12" r="4.5" {...M(f * 0.7)} />
    <path d="M4.5 12a7.5 7.5 0 0 1 12.8-5.3L19.5 9" {...S} />
    <path d="M19.5 4.5V9H15" {...S} />
    <path d="M19.5 12a7.5 7.5 0 0 1-12.8 5.3L4.5 15" {...S} />
    <path d="M4.5 19.5V15H9" {...S} />
  </>,
  comites: <>
    <circle cx="12" cy="9" r="5" {...M(f)} />
    <circle cx="12" cy="9" r="5" {...S} />
    <path d="M8.8 13.4L7 21l5-2.8L17 21l-1.8-7.6" {...S} />
  </>,
  ingresos: <>
    <path d="M14 3l5 5h-5V3z" {...M(f * 1.6)} />
    <path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" {...S} />
    <path d="M14 3v5h5M12 11.5v6M9 14.5h6" {...S} />
  </>,

  // ─── Biblioteca ───
  cirugias: <>
    <path d="M14.4 3.9l5.7 5.7-2.6 2.6-5.7-5.7 2.6-2.6z" {...M(f * 1.4)} />
    <path d="M14 4l6 6-9 9-3.6 1.2L8.6 16.6 14 4z" {...S} />
    <path d="M11.8 6.5l5.7 5.7" {...S} />
  </>,
  videos: <>
    <path d="M10 8.7l5.4 3.3-5.4 3.3V8.7z" {...M(f * 1.8)} />
    <rect x="3" y="5" width="18" height="14" rx="2.5" {...S} />
    <path d="M10 8.7l5.4 3.3-5.4 3.3V8.7z" {...S} />
  </>,
  preguntas: <>
    <circle cx="12" cy="12" r="9" {...M(f * 0.75)} />
    <circle cx="12" cy="12" r="9" {...S} />
    <path d="M9.4 9.6a2.6 2.6 0 1 1 3.6 2.4c-.8.4-1 .9-1 1.7" {...S} />
    <circle cx="12" cy="17" r="0.9" {...M(1)} />
  </>,
  medicamentos: <>
    <path d="M7 8h5v8H7a4 4 0 0 1 0-8z" {...M(f * 1.6)} />
    <rect x="3" y="8" width="18" height="8" rx="4" {...S} />
    <path d="M12 8v8" {...S} />
  </>,
  protocolos: <>
    <path d="M5 4a2 2 0 0 1 2-2h2v20H7a2 2 0 0 0-2 2V4z" {...M(f * 1.3)} />
    <path d="M5 4a2 2 0 0 1 2-2h11v18H7a2 2 0 0 0-2 2V4z" {...S} />
    <path d="M9 2v18M11.5 6.5h4M11.5 9.5h3" {...S} />
  </>,
  scores: <>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5V7.5H4V5.5z" {...M(f * 1.5)} />
    <rect x="4" y="3" width="16" height="18" rx="2.5" {...S} />
    <path d="M4 7.5h16" {...S} />
    <path d="M7.5 11.5h4M7.5 15.5h6" {...S} />
    <circle cx="15.5" cy="11.5" r="1.1" {...M(1)} />
  </>,

  // ─── Generales ───
  chat: <>
    <path d="M4.5 6a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9.5L5 19v-4h-.5V6z" {...M(f)} />
    <path d="M19.5 6a2 2 0 0 0-2-2h-11a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2H6v4l4-4h7.5a2 2 0 0 0 2-2V6z" {...S} />
    <path d="M8.5 8.5h7M8.5 11.5h4.5" {...S} />
  </>,
  logbook: <>
    <path d="M9 3.5h6v3.5H9V3.5z" {...M(f * 1.7)} />
    <rect x="5" y="4" width="14" height="17" rx="2.5" {...S} />
    <path d="M9 3.5h6V7H9V3.5z" {...S} />
    <path d="M8.5 11.5h7M8.5 15.5h4.5" {...S} />
  </>,
  metricas: <>
    <path d="M9.2 4h1.6v16H9.2V4z" {...M(f * 1.6)} />
    <path d="M4 20v-9M10 20V4M16 20v-6" {...S} />
    <path d="M2.5 20h19" {...S} />
  </>,
  buscar: <>
    <circle cx="11" cy="11" r="7" {...M(f * 0.8)} />
    <circle cx="11" cy="11" r="7" {...S} />
    <path d="M16.2 16.2L20.5 20.5" {...S} />
  </>,
  config: <>
    <circle cx="12" cy="12" r="3.2" {...M(f * 1.5)} />
    <circle cx="12" cy="12" r="3.2" {...S} />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 15H4.5a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1A2 2 0 1 1 8.4 5.4l.1.1a1.6 1.6 0 0 0 2.7-1.1V4.5a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.1a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" {...S} />
  </>,
  notificacion: <>
    <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6z" {...M(f)} />
    <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6z" {...S} />
    <path d="M10 19.5a2 2 0 0 0 4 0" {...S} />
  </>,
  equipo: <>
    <circle cx="8.5" cy="9" r="3" {...M(f)} />
    <path d="M3.5 20c0-3 2-5 5-5s5 2 5 5" {...M(f * 0.55)} />
    <circle cx="8.5" cy="9" r="3" {...S} />
    <path d="M3.5 20c0-3 2-5 5-5s5 2 5 5" {...S} />
    <circle cx="17" cy="8" r="2.3" {...S} />
    <path d="M15.4 14.9c2.8.3 4.6 2.1 4.6 4.6" {...S} />
  </>,
  nuevo: <>
    <circle cx="12" cy="12" r="9" {...M(f)} />
    <circle cx="12" cy="12" r="9" {...S} />
    <path d="M12 8.2v7.6M8.2 12h7.6" {...S} />
  </>,
  mas: <><path d="M12 5v14M5 12h14" {...S} /></>,
  excel: <>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5V7H4V5.5z" {...M(f * 1.5)} />
    <rect x="4" y="3" width="16" height="18" rx="2.5" {...S} />
    <path d="M4 7h16" {...S} />
    <path d="M9 11l6 6.5M15 11l-6 6.5" {...S} />
  </>,
  foto: <>
    <circle cx="12" cy="13.5" r="3.6" {...M(f * 1.4)} />
    <path d="M3 8.5a2 2 0 0 1 2-2h2.2L8.7 4.4h6.6L16.8 6.5H19a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8.5z" {...S} />
    <circle cx="12" cy="13.5" r="3.6" {...S} />
  </>,
  web: <>
    <circle cx="12" cy="12" r="9" {...M(f * 0.7)} />
    <circle cx="12" cy="12" r="9" {...S} />
    <path d="M3 12h18M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18" {...S} />
  </>,
  compartir: <>
    <circle cx="6" cy="12" r="2.6" {...M(f * 1.5)} />
    <circle cx="17" cy="6" r="2.6" {...M(f * 1.5)} />
    <circle cx="17" cy="18" r="2.6" {...M(f * 1.5)} />
    <circle cx="6" cy="12" r="2.6" {...S} />
    <circle cx="17" cy="6" r="2.6" {...S} />
    <circle cx="17" cy="18" r="2.6" {...S} />
    <path d="M8.3 10.8l6.4-3.5M8.3 13.2l6.4 3.5" {...S} />
  </>,
});

// Opacidad de la masa. En reposo es discreta; activa gana peso sin cambiar
// de color, para que la pestaña seleccionada se lea también sin contraste.
const MASA_REPOSO = 0.15;
const MASA_ACTIVA = 0.3;

export function Ico({ name, size = 20, activo = false, style, title, ...rest }) {
  const inner = PATHS(activo ? MASA_ACTIVA : MASA_REPOSO)[name];
  if (!inner) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      style={{ display: "inline-block", verticalAlign: "-0.15em", flexShrink: 0, ...style }}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {inner}
    </svg>
  );
}

export default Ico;

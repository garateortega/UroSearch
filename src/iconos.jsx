// ============================================================
// UroSearch — Set de íconos SVG unificados
// Ubicación sugerida: src/iconos.jsx
//
// Íconos de línea (stroke), 24×24, que heredan el color con currentColor.
// Reemplazan los emojis de submenús/botones para una imagen consistente
// entre Android e iPhone.
//
// Uso:
//   import { Ico } from "./iconos";
//   <Ico name="pacientes" size={18} />
//   <span style={{ color: "var(--primario)" }}><Ico name="recetas" /></span>
//
// Migración incremental (sin romper nada): donde hoy tienes p. ej.
//   ["pacientes", "👥 Pacientes"]
// puedes seguir usando el texto, y en el render anteponer <Ico name="pacientes"/>.
// No hace falta cambiar todo de una vez.
// ============================================================
import React from "react";

const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" };

const PATHS = {
  // Hospital
  pacientes: <><circle cx="9" cy="8" r="3" {...P} /><path d="M4 20c0-3 2-5 5-5s5 2 5 5" {...P} /><path d="M17 11a2.5 2.5 0 1 0 0-5" {...P} /><path d="M15 15.5c3 .3 5 2.2 5 4.5" {...P} /></>,
  tabla: <><rect x="3" y="4" width="18" height="16" rx="2" {...P} /><path d="M3 9h18M3 14h18M9 4v16" {...P} /></>,
  notas: <><path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" {...P} /><path d="M14 3v5h5M8 13h8M8 17h6" {...P} /></>,
  recetas: <><rect x="4" y="3" width="16" height="18" rx="2" {...P} /><path d="M8 8h5.5a2.5 2.5 0 0 1 0 5H8V8zM8 13l4 5" {...P} /></>,
  interconsultas: <><path d="M4 12l16-8-6 16-3.5-6L4 12z" {...P} /></>,
  seguimiento: <><path d="M4 12a8 8 0 0 1 13.7-5.6L20 8" {...P} /><path d="M20 4v4h-4" {...P} /><path d="M20 12a8 8 0 0 1-13.7 5.6L4 16" {...P} /><path d="M4 20v-4h4" {...P} /></>,
  comites: <><circle cx="12" cy="9" r="5" {...P} /><path d="M9 13.5L7 21l5-3 5 3-2-7.5" {...P} /></>,
  ingresos: <><path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" {...P} /><path d="M14 3v5h5M12 11v6M9 14h6" {...P} /></>,
  // Biblioteca
  cirugias: <><path d="M14 4l6 6-9 9-3 1 1-3 5-13z" {...P} /><path d="M12 6l6 6" {...P} /></>,
  videos: <><rect x="3" y="5" width="18" height="14" rx="2" {...P} /><path d="M10 9l5 3-5 3V9z" {...P} /></>,
  preguntas: <><circle cx="12" cy="12" r="9" {...P} /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7" {...P} /><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" /></>,
  medicamentos: <><rect x="3" y="8" width="18" height="8" rx="4" {...P} /><path d="M12 8v8" {...P} /></>,
  protocolos: <><path d="M5 4a2 2 0 0 1 2-2h11v18H7a2 2 0 0 0-2 2V4z" {...P} /><path d="M18 16H7a2 2 0 0 0-2 2" {...P} /><path d="M9 6h6M9 9h5" {...P} /></>,
  scores: <><rect x="4" y="3" width="16" height="18" rx="2" {...P} /><path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M16 15h0" {...P} /></>,
  // Generales
  chat: <><path d="M4 5h16v11H9l-4 3v-3H4a0 0 0 0 1 0 0V5z" {...P} /><path d="M8 9h8M8 12h5" {...P} /></>,
  logbook: <><rect x="5" y="4" width="14" height="17" rx="2" {...P} /><path d="M9 4h6v3H9z" {...P} /><path d="M8 11h8M8 15h5" {...P} /></>,
  metricas: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" {...P} /></>,
  buscar: <><circle cx="11" cy="11" r="7" {...P} /><path d="M20 20l-4-4" {...P} /></>,
  config: <><circle cx="12" cy="12" r="3" {...P} /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 15H4.5a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1A2 2 0 1 1 8.4 5.4l.1.1a1.6 1.6 0 0 0 2.7-1.1V4.5a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.1a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" {...P} /></>,
  notificacion: <><path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6z" {...P} /><path d="M10 20a2 2 0 0 0 4 0" {...P} /></>,
  equipo: <><circle cx="8" cy="9" r="3" {...P} /><path d="M3 20c0-3 2-5 5-5s5 2 5 5" {...P} /><circle cx="17" cy="8" r="2.3" {...P} /><path d="M15 15c3 0 5 1.8 5 4.5" {...P} /></>,
  nuevo: <><circle cx="12" cy="12" r="9" {...P} /><path d="M12 8v8M8 12h8" {...P} /></>,
  mas: <><path d="M12 5v14M5 12h14" {...P} /></>,
  excel: <><rect x="4" y="3" width="16" height="18" rx="2" {...P} /><path d="M9 8l6 8M15 8l-6 8" {...P} /></>,
  foto: <><rect x="3" y="6" width="18" height="14" rx="2" {...P} /><circle cx="12" cy="13" r="3.5" {...P} /><path d="M8 6l1.5-2h5L16 6" {...P} /></>,
  web: <><circle cx="12" cy="12" r="9" {...P} /><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" {...P} /></>,
  compartir: <><circle cx="6" cy="12" r="2.5" {...P} /><circle cx="17" cy="6" r="2.5" {...P} /><circle cx="17" cy="18" r="2.5" {...P} /><path d="M8.2 10.8l6.6-3.6M8.2 13.2l6.6 3.6" {...P} /></>,
};

export function Ico({ name, size = 20, style, ...rest }) {
  const inner = PATHS[name];
  if (!inner) return null;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ display: "inline-block", verticalAlign: "-0.15em", flexShrink: 0, ...style }} {...rest}>
      {inner}
    </svg>
  );
}

export default Ico;

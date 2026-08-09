// ============================================================
// UroSearch — Sistema de diálogos y toasts propios
// Reemplaza alert()/confirm() nativos en TODA la app (App, Logbook, etc.).
// Extraído de App.jsx para que cualquier panel pueda importarlo sin
// duplicar código ni caer en los diálogos del navegador, que en iOS
// muestran el dominio y rompen la sensación de app instalada.
//
// Uso:  import { uroToast, uroConfirm } from "./ui";
//       uroToast("✓ Guardado");
//       if (await uroConfirm("¿Eliminar?")) { ... }
// <UroDialogHost/> debe estar montado una sola vez (lo hace App.jsx).
// ============================================================
import { useState, useEffect } from "react";

// ─── Diálogos y toasts propios (reemplazan alert/confirm nativos) ───
let _mostrarDialogo = null;   // setter registrado por UroDialogHost
let _mostrarToast = null;

export function uroToast(mensaje, tipo) {
  const t = tipo || (/error|no se pudo|falló|fallo|inválid|incorrect/i.test(String(mensaje)) ? "error" : "ok");
  if (_mostrarToast) _mostrarToast({ id: Date.now() + Math.random(), texto: String(mensaje), tipo: t });
  else { try { window.alert(mensaje); } catch {} }
}

export function uroConfirm(mensaje, opciones = {}) {
  if (!_mostrarDialogo) return Promise.resolve(window.confirm(mensaje)); // fallback
  const m = String(mensaje);
  const etiqueta = opciones.confirmar
    || (/expulsar/i.test(m) ? "Expulsar"
    : /¿salir/i.test(m) ? "Salir"
    : /importar/i.test(m) ? "Importar"
    : /restaurar/i.test(m) ? "Restaurar"
    : /borrar/i.test(m) ? "Borrar"
    : /eliminar/i.test(m) ? "Eliminar"
    : "Confirmar");
  const peligro = (opciones.peligro !== undefined)
    ? opciones.peligro
    : /eliminar|borrar|expulsar|no se puede deshacer|se perderán/i.test(m);
  return new Promise((resolve) => {
    _mostrarDialogo({ texto: m, confirmar: etiqueta, cancelar: opciones.cancelar || "Cancelar", peligro, resolve });
  });
}

export function UroDialogHost() {
  const [dialogo, setDialogo] = useState(null);
  const [toasts, setToasts] = useState([]);
  useEffect(() => {
    _mostrarDialogo = setDialogo;
    _mostrarToast = (t) => {
      setToasts(prev => [...prev.slice(-2), t]);
      const dur = Math.min(8000, Math.max(3500, String(t.texto).length * 45));
      setTimeout(() => setToasts(prev => prev.filter(x => x.id !== t.id)), dur);
    };
    return () => { _mostrarDialogo = null; _mostrarToast = null; };
  }, []);
  const responder = (ok) => { if (dialogo) { dialogo.resolve(ok); setDialogo(null); } };
  return (
    <>
      {dialogo && (
        <div onClick={() => responder(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "var(--superficie)", border: "0.5px solid var(--borde)", borderRadius: 14, padding: "20px 18px 16px", width: "min(360px, 100%)", boxShadow: "0 14px 40px rgba(0,0,0,0.35)" }}>
            <div style={{ fontSize: 26, marginBottom: 8, textAlign: "center" }}>{dialogo.peligro ? "⚠️" : "❓"}</div>
            <div style={{ fontSize: "var(--fs-2)", color: "var(--texto)", lineHeight: 1.5, whiteSpace: "pre-line", textAlign: "center", marginBottom: 16 }}>{dialogo.texto}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => responder(false)} style={{ flex: 1, padding: "11px", fontSize: "var(--fs-2)", fontWeight: 600, background: "var(--fondo-suave)", color: "var(--texto)", border: "0.5px solid var(--borde)", borderRadius: 9, cursor: "pointer" }}>{dialogo.cancelar}</button>
              <button onClick={() => responder(true)} autoFocus style={{ flex: 1, padding: "11px", fontSize: "var(--fs-2)", fontWeight: 700, background: dialogo.peligro ? "var(--peligro)" : "var(--primario)", color: "var(--texto-inv)", border: "none", borderRadius: 9, cursor: "pointer" }}>{dialogo.confirmar}</button>
            </div>
          </div>
        </div>
      )}
      {toasts.length > 0 && (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: "calc(18px + env(safe-area-inset-bottom, 0px))", zIndex: 3100, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, pointerEvents: "none", padding: "0 16px" }}>
          {toasts.map(t => (
            <div key={t.id} style={{ maxWidth: 420, background: t.tipo === "error" ? "#9b1c1c" : "#12253b", color: "#ffffff", border: "1px solid " + (t.tipo === "error" ? "#ef4444" : "#2f5f8f"), borderRadius: 10, padding: "11px 16px", fontSize: "var(--fs-1)", fontWeight: 600, lineHeight: 1.45, whiteSpace: "pre-line", boxShadow: "0 6px 20px rgba(0,0,0,0.35)", textAlign: "center" }}>
              {t.tipo === "error" ? "⚠️ " : ""}{t.texto}
            </div>
          ))}
        </div>
      )}
    </>
  );
}


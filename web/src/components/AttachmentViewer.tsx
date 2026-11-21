// El visor de adjuntos, como el de Odoo 20: a pantalla completa, con el documento grande, pasar al
// siguiente (flechas, deslizar o teclado), zoom, girar, descargar y borrar. Un PDF se lee página por
// página (imágenes que hace el servidor, porque el celular no muestra PDFs dentro de la página).
// En el celular, la tira de miniaturas va abajo; en la computadora, la lista va a la izquierda.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { type Attachment, attachmentThumb, attachmentUrl, attachmentView } from "@/api/hooks";
import { shortDate } from "@/lib/dates";

import { Kbd } from "./ShortcutsHelp";
import { ErrorAlert, Icon } from "./ui";

const ZOOMS = [1, 1.5, 2, 3, 4];

// La ayuda de teclas de abajo (caso 8, opción B): cada tecla en su cajita, como en Atajos.
const KEY_HELP: [keys: string[], what: string][] = [[["←", "→"], "Pasar"], [["+", "−"], "Zoom"], [[], "acerca"], [["Esc"], "Cerrar"]];

export function fileSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function kindOf(a: Attachment) {
  return a.mimetype === "application/pdf" ? "PDF" : "foto";
}

export function AttachmentViewer({ list, index, onIndex, onClose, onDelete, deleting, error, onAdd, caption }: {
  list: Attachment[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onDelete: (a: Attachment) => void;
  deleting: boolean;
  error?: string | null;
  onAdd?: () => void;
  caption?: { name: string; amount: string };   // el movimiento al que pertenece
}) {
  const a = list[index]!;
  const [zoom, setZoom] = useState(0);         // índice en ZOOMS
  const [turn, setTurn] = useState(0);         // grados
  const [confirm, setConfirm] = useState(false);
  const [info, setInfo] = useState(false);       // la ficha «Detalles» abierta
  const touch = useRef<number | null>(null);
  const pdf = a.mimetype === "application/pdf";
  const scale = ZOOMS[zoom]!;

  // Al pasar a otro adjunto, vuelve a verse entero y derecho
  useEffect(() => { setZoom(0); setTurn(0); setConfirm(false); }, [a.id]);

  const go = (d: number) => onIndex((index + d + list.length) % list.length);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && list.length > 1) go(1);
      else if (e.key === "ArrowLeft" && list.length > 1) go(-1);
      else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(z + 1, ZOOMS.length - 1));
      else if (e.key === "-") setZoom((z) => Math.max(z - 1, 0));
    };
    window.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = overflow; };
  });

  // Arriba va solo el nombre; lo demás, en la ficha que abre «Detalles» (caso 9, opción E)
  const details: [string, string][] = [
    ...(caption ? [["Movimiento", caption.name], ["Monto", caption.amount]] as [string, string][] : []),
    ["Subido", shortDate(a.create_date.slice(0, 10))], ["Pesa", fileSize(a.file_size)], ["Tipo", pdf ? "PDF" : "Foto"],
    ...(pdf && a.page_count ? [["Páginas", String(a.page_count)]] as [string, string][] : []),
  ];
  const tool = "grid size-10 place-items-center rounded-[10px] hover:bg-white/10";

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={a.name} className="fixed inset-0 z-50 flex flex-col bg-[#0a0a0a] text-[#fafafa]">
      {/* Arriba: qué es, en qué posición y (en la computadora) las acciones */}
      <div className="flex min-h-16 items-center gap-2 border-b border-[#2e2e2e] px-2 lg:px-5">
        <button type="button" aria-label="Cerrar" onClick={onClose} className="grid size-11 place-items-center rounded-full lg:order-last">
          <Icon name="close" className="text-[24px]" />
        </button>
        <span className="flex min-w-0 flex-1 flex-col lg:flex-row lg:items-baseline lg:gap-3">
          <span className="truncate font-semibold">{a.name}</span>
          <button type="button" aria-expanded={info} onClick={() => setInfo(!info)}
            className="flex h-7 items-center gap-1 self-start text-caption text-[#d4d4d4] lg:self-auto">
            <Icon name="info" className="text-[18px]" />Detalles
          </button>
        </span>
        {list.length > 1 && <span className="pr-2 text-caption text-[#a3a3a3] lg:order-first lg:pr-3">{index + 1} de {list.length}</span>}
        <div className="hidden items-center gap-1 lg:flex">
          <button type="button" aria-label="Alejar" onClick={() => setZoom((z) => Math.max(z - 1, 0))} className={tool}><Icon name="zoom_out" /></button>
          <span className="w-12 text-center text-caption text-[#a3a3a3]">{Math.round(scale * 100)} %</span>
          <button type="button" aria-label="Acercar" onClick={() => setZoom((z) => Math.min(z + 1, ZOOMS.length - 1))} className={tool}><Icon name="zoom_in" /></button>
          {!pdf && <button type="button" aria-label="Girar" onClick={() => setTurn((t) => t + 90)} className={tool}><Icon name="rotate_right" /></button>}
          <a href={attachmentUrl(a.id, true)} download={a.name}
            className="ml-2 flex h-10 items-center gap-1.5 rounded-[10px] border border-[#525252] px-3.5 text-[14px] font-semibold">
            <Icon name="download" className="text-[20px]" />Descargar
          </a>
          <button type="button" disabled={deleting} onClick={() => (confirm ? onDelete(a) : setConfirm(true))}
            className={`flex h-10 items-center gap-1.5 rounded-[10px] px-3.5 text-[14px] font-semibold ${confirm ? "bg-[#b42318] text-white" : "border border-[#525252] text-[#ff7b6e]"}`}>
            <Icon name="delete" className="text-[20px]" />{confirm ? "Sí, borrar" : "Borrar"}
          </button>
        </div>
      </div>

      {info && (
        <dl className="flex flex-wrap gap-x-6 gap-y-2 border-b border-[#2e2e2e] px-4 py-3 lg:px-5">
          {details.map(([k, v]) => (
            <div key={k} className="flex flex-col">
              <dt className="text-[10px] leading-[14px] font-semibold tracking-[0.05em] text-[#8a8a8a] uppercase">{k}</dt>
              <dd className="text-caption font-semibold text-[#fafafa] tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex min-h-0 flex-1">
        {/* La lista, en la computadora */}
        <aside aria-label="Adjuntos del movimiento" className="hidden w-72 flex-none flex-col gap-1.5 overflow-y-auto border-r border-[#2e2e2e] p-4 lg:flex">
          <span className="px-1 pb-1.5 text-label text-[#a3a3a3]">{list.length === 1 ? "1 adjunto" : `${list.length} adjuntos`}</span>
          {list.map((x, i) => (
            <button key={x.id} type="button" onClick={() => onIndex(i)} aria-current={i === index}
              className={`flex items-center gap-3 rounded-[10px] p-2.5 text-left ${i === index ? "bg-[#262626]" : "hover:bg-white/5"}`}>
              <Thumb a={x} className="h-[58px] w-11 rounded-md" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[14px] font-semibold">{x.name}</span>
                <span className="text-caption text-[#a3a3a3]">{fileSize(x.file_size)}</span>
              </span>
            </button>
          ))}
          {onAdd && (
            <button type="button" onClick={onAdd}
              className="mt-2 flex h-11 items-center justify-center gap-1.5 rounded-[10px] border-[1.5px] border-dashed border-[#525252] text-[14px] font-semibold">
              <Icon name="add" className="text-[20px]" />Adjuntar
            </button>
          )}
        </aside>

        {/* El documento */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className={`flex-1 overflow-auto ${scale === 1 && !pdf ? "grid place-items-center" : ""} p-4`}
            onTouchStart={(e) => { touch.current = scale === 1 ? e.touches[0]!.clientX : null; }}
            onTouchEnd={(e) => {
              if (touch.current === null || list.length < 2) return;
              const dx = e.changedTouches[0]!.clientX - touch.current;
              if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
            }}>
            {pdf ? (
              <div className="mx-auto flex flex-col items-center gap-4" style={{ width: `${scale * 100}%`, maxWidth: scale === 1 ? 900 : undefined }}>
                {Array.from({ length: a.page_count ?? 1 }, (_, i) => <PdfPage key={`${a.id}-${i}`} a={a} page={i + 1} />)}
              </div>
            ) : (
              <img src={attachmentView(a.id)} alt={a.name} onDoubleClick={() => setZoom((z) => (z === 0 ? 2 : 0))}
                className="max-w-none transition-transform duration-200"
                style={scale === 1
                  ? { maxHeight: "100%", maxWidth: "100%", transform: `rotate(${turn}deg)` }
                  : { width: `${scale * 100}%`, transform: `rotate(${turn}deg)` }} />
            )}
          </div>
          {list.length > 1 && (
            <>
              <button type="button" aria-label="Anterior" onClick={() => go(-1)}
                className="absolute top-1/2 left-2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white ring-1 ring-white/20 backdrop-blur lg:left-6 lg:size-12">
                <Icon name="chevron_left" className="text-[26px]" />
              </button>
              <button type="button" aria-label="Siguiente" onClick={() => go(1)}
                className="absolute top-1/2 right-2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white ring-1 ring-white/20 backdrop-blur lg:right-6 lg:size-12">
                <Icon name="chevron_right" className="text-[26px]" />
              </button>
            </>
          )}
          <span className="hidden flex-wrap justify-center gap-x-5 gap-y-1.5 pb-3 text-caption text-[#a3a3a3] lg:flex">
            {KEY_HELP.map(([keys, what]) => (
              <span key={what} className="flex items-center gap-1.5">
                {keys.length ? keys.map((k) => <Kbd key={k} dark>{k}</Kbd>) : <b className="font-semibold text-[#ddd]">Doble clic</b>}
                {what}
              </span>
            ))}
          </span>
        </div>
      </div>

      {/* Abajo, en el celular: la tira y las acciones */}
      <div className="lg:hidden">
        {list.length > 1 && (
          <div className="flex justify-center gap-2 overflow-x-auto px-4 py-2">
            {list.map((x, i) => (
              <button key={x.id} type="button" aria-label={`Ver ${x.name}`} onClick={() => onIndex(i)}
                className={`flex-none overflow-hidden rounded-md border-2 ${i === index ? "border-[#e8b04b]" : "border-transparent opacity-70"}`}>
                <Thumb a={x} className="h-14 w-11" />
              </button>
            ))}
          </div>
        )}
        {confirm && <p className="px-4 pb-1 text-center text-[#d4d4d4]">¿Borrar este adjunto? El movimiento queda igual.</p>}
        {error && <div className="px-4 pb-2"><ErrorAlert>{error}</ErrorAlert></div>}
        <div className="grid grid-cols-4 border-t border-[#2e2e2e] px-2 pt-1.5 pb-6">
          <Action icon={scale === 1 ? "zoom_in" : "zoom_out"} label={scale === 1 ? "Zoom" : "Ajustar"} onClick={() => setZoom((z) => (z === 0 ? 2 : 0))} />
          <Action icon="rotate_right" label="Girar" onClick={() => setTurn((t) => t + 90)} disabled={pdf} />
          <a href={attachmentUrl(a.id, true)} download={a.name} className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[12px] font-medium">
            <Icon name="download" className="text-[22px]" />Descargar
          </a>
          <Action icon="delete" label={confirm ? "Sí, borrar" : "Borrar"} danger onClick={() => (confirm ? onDelete(a) : setConfirm(true))} disabled={deleting} />
        </div>
      </div>
      {error && <div className="hidden px-5 pb-3 lg:block"><ErrorAlert>{error}</ErrorAlert></div>}
    </div>,
    document.body,
  );
}

function Action({ icon, label, onClick, disabled, danger }: { icon: string; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[12px] font-medium disabled:opacity-40 ${danger ? "text-[#ff7b6e]" : ""}`}>
      <Icon name={icon} className="text-[22px]" />{label}
    </button>
  );
}

/** La miniatura del servidor; si no se puede mostrar, el ícono de su tipo. */
export function Thumb({ a, className }: { a: Attachment; className?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`grid flex-none place-items-center overflow-hidden bg-[#262626] ${className ?? ""}`}>
      {broken
        ? <Icon name={a.mimetype === "application/pdf" ? "picture_as_pdf" : "image"} className="text-[22px] text-[#a3a3a3]" />
        : <img src={attachmentThumb(a.id)} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} className="size-full object-cover" />}
    </span>
  );
}

/** Una página del PDF: ocupa su lugar (A4) desde el principio y, mientras el servidor la prepara la
 *  primera vez, muestra la miniatura (la primera página) o un indicador. */
function PdfPage({ a, page }: { a: Attachment; page: number }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative w-full bg-white shadow-lg" style={loaded ? undefined : { aspectRatio: "1 / 1.414" }}>
      {!loaded && (
        <span className="absolute inset-0 grid place-items-center">
          {page === 1
            ? <img src={attachmentThumb(a.id)} alt="" className="size-full object-contain opacity-60 blur-[2px]" />
            : <Icon name="progress_activity" className="animate-spin text-[28px] text-[#737373]" />}
        </span>
      )}
      <img src={attachmentView(a.id, page)} alt={`${a.name}, página ${page}`} loading={page === 1 ? "eager" : "lazy"}
        onLoad={() => setLoaded(true)} className={`w-full ${loaded ? "" : "opacity-0"}`} />
    </div>
  );
}

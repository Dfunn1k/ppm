// Adjuntos de un movimiento: la boleta, el voucher o el recibo, en foto o PDF de hasta 5 MB.
// En Registrar se eligen antes de guardar y se suben al guardar; en el detalle se ven en miniaturas,
// se abren a pantalla completa y se descargan o borran (pide confirmar).
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { type Attachment, attachmentUrl, useAttachments, useDeleteAttachment, useUploadAttachment } from "@/api/hooks";

import { Sheet } from "./Sheet";
import { ErrorAlert, Icon } from "./ui";

const MAX = 5 * 1024 * 1024;
const OK = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;

export function fileSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Lo que no se puede adjuntar, dicho para la persona; null si se puede. */
export function fileProblem(f: File) {
  if (f.type && !OK.test(f.type)) return `«${f.name}» no es una foto ni un PDF`;
  if (f.size > MAX) return `«${f.name}» pesa más de 5 MB`;
  return null;
}

/** La hoja «Adjuntar»: tomar una foto (la cámara del celular) o elegir un archivo. */
export function AttachSheet({ open, onClose, onFiles }: { open: boolean; onClose: () => void; onFiles: (files: File[]) => void }) {
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const take = (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length) onFiles(files);
    onClose();
  };
  const option = "flex min-h-14 items-center gap-3 rounded-md px-3 text-left";
  return (
    <>
      <input ref={camera} type="file" accept="image/*" capture="environment" aria-label="Tomar una foto" className="sr-only"
        tabIndex={-1} onChange={(e) => take(e.currentTarget)} />
      <input ref={picker} type="file" accept="image/*,application/pdf" multiple aria-label="Elegir un archivo" className="sr-only"
        tabIndex={-1} onChange={(e) => take(e.currentTarget)} />
      <Sheet title="Adjuntar" open={open} onClose={onClose}>
        <button type="button" onClick={() => camera.current?.click()} className={option}>
          <Icon name="photo_camera" className="text-[24px]" />
          <span className="flex flex-col"><span className="font-semibold">Tomar una foto</span>
            <span className="text-caption text-muted-foreground">La boleta, el voucher o el recibo</span></span>
        </button>
        <button type="button" onClick={() => picker.current?.click()} className={option}>
          <Icon name="folder_open" className="text-[24px]" />
          <span className="flex flex-col"><span className="font-semibold">Elegir un archivo</span>
            <span className="text-caption text-muted-foreground">Foto o PDF de hasta 5 MB</span></span>
        </button>
      </Sheet>
    </>
  );
}

/** En Registrar: los archivos elegidos (se suben al guardar), con quitar y «Adjuntar boleta o foto». */
export function PendingFiles({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const add = (more: File[]) => {
    const bad = more.map(fileProblem).find(Boolean) ?? null;
    setProblem(bad);
    onChange([...files, ...more.filter((f) => !fileProblem(f))]);
  };
  return (
    <section aria-label="Adjuntos" className="flex flex-col gap-2 border-b border-border py-2.5">
      {files.map((f, i) => (
        <div key={`${f.name}-${i}`} className="flex min-h-[52px] items-center gap-3 rounded-[12px] bg-muted py-1 pr-1 pl-1.5">
          <span className="grid size-10 flex-none place-items-center rounded-[8px] border border-border bg-card text-muted-foreground">
            <Icon name={f.type === "application/pdf" ? "picture_as_pdf" : "image"} className="text-[22px]" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-semibold">{f.name}</span>
            <span className="text-caption text-muted-foreground">{fileSize(f.size)} · {f.type === "application/pdf" ? "PDF" : "foto"}</span>
          </span>
          <button type="button" aria-label={`Quitar ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))}
            className="grid size-10 place-items-center rounded-full"><Icon name="close" className="text-[20px]" /></button>
        </div>
      ))}
      {problem && <ErrorAlert>{problem}</ErrorAlert>}
      <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}
        className="flex min-h-10 items-center gap-1.5 self-start font-semibold text-primary-strong">
        <Icon name="attach_file" className="text-[22px]" />{files.length ? "Adjuntar otro" : "Adjuntar boleta o foto"}
      </button>
      <AttachSheet open={open} onClose={() => setOpen(false)} onFiles={add} />
    </section>
  );
}

/** En el detalle de un movimiento: miniaturas, «Adjuntar» y el visor a pantalla completa. */
export function MoveAttachments({ moveId }: { moveId: number }) {
  const list = useAttachments(moveId).data ?? [];
  const upload = useUploadAttachment();
  const remove = useDeleteAttachment(moveId);
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [broken, setBroken] = useState<number[]>([]);   // imágenes que el navegador no puede mostrar: ícono y nombre
  const add = async (files: File[]) => {
    setProblem(files.map(fileProblem).find(Boolean) ?? null);
    for (const file of files.filter((f) => !fileProblem(f))) {
      await upload.mutateAsync({ moveId, file }).catch((e: Error) => setProblem(e.message));
    }
  };
  const close = () => { setViewing(null); setConfirm(false); };

  return (
    <section aria-label="Adjuntos" className="mt-6 flex flex-col">
      <span className="border-b border-border pb-1 text-label text-muted-foreground">Adjuntos</span>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {list.map((a) => (
          <button key={a.id} type="button" aria-label={`Ver ${a.name}`} onClick={() => setViewing(a)}
            className="flex aspect-[3/4] flex-col items-center justify-center gap-1.5 overflow-hidden rounded-[12px] border border-border bg-card p-0 text-[12px] leading-4 text-muted-foreground">
            {a.mimetype.startsWith("image/") && a.mimetype !== "image/heic" && !broken.includes(a.id) ? (
              <img src={attachmentUrl(a.id)} alt="" loading="lazy" className="size-full object-cover"
                onError={() => setBroken((b) => [...b, a.id])} />
            ) : (
              <>
                <Icon name={a.mimetype === "application/pdf" ? "picture_as_pdf" : "image"} className="text-[32px]" />
                <span className="max-w-full truncate px-2">{a.name}</span>
              </>
            )}
          </button>
        ))}
        <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} disabled={upload.isPending}
          className="flex aspect-[3/4] flex-col items-center justify-center gap-1.5 rounded-[12px] border-[1.5px] border-dashed border-input-line text-[13px] font-semibold disabled:opacity-60">
          <Icon name={upload.isPending ? "progress_activity" : "add_a_photo"} className={`text-[26px] ${upload.isPending ? "animate-spin" : ""}`} />
          {upload.isPending ? "Subiendo…" : "Adjuntar"}
        </button>
      </div>
      <span className="mt-2 text-caption text-muted-foreground">Foto o PDF de hasta 5 MB. Se guardan en tu carpeta, con el respaldo diario.</span>
      {problem && <div className="mt-2"><ErrorAlert>{problem}</ErrorAlert></div>}
      <AttachSheet open={open} onClose={() => setOpen(false)} onFiles={add} />

      {viewing && createPortal(
        <div role="dialog" aria-modal="true" aria-label={viewing.name} className="fixed inset-0 z-50 flex flex-col bg-[#0a0a0a] px-4 pt-4 pb-6 text-[#fafafa]">
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Cerrar" onClick={close} className="grid size-11 place-items-center rounded-full">
              <Icon name="close" className="text-[24px]" />
            </button>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-semibold">{viewing.name}</span>
              <span className="text-caption text-[#a3a3a3]">{fileSize(viewing.file_size)} · {viewing.mimetype === "application/pdf" ? "PDF" : "foto"}</span>
            </span>
          </div>
          <div className="my-4 flex min-h-0 flex-1 items-center justify-center overflow-auto">
            {viewing.mimetype === "application/pdf" ? (
              <iframe title={viewing.name} src={attachmentUrl(viewing.id)} className="size-full rounded-md bg-white" />
            ) : (
              <img src={attachmentUrl(viewing.id)} alt={viewing.name} className="max-h-full max-w-full object-contain" />
            )}
          </div>
          {confirm && <span className="mb-2.5 text-center text-[#d4d4d4]">¿Borrar este adjunto? El movimiento queda igual.</span>}
          {remove.error && <div className="mb-2"><ErrorAlert>{remove.error.message}</ErrorAlert></div>}
          <div className="grid grid-cols-2 gap-2">
            <a href={attachmentUrl(viewing.id, true)} download={viewing.name}
              className="flex h-12 items-center justify-center gap-1.5 rounded-[14px] border border-[#525252] font-semibold">
              <Icon name="download" className="text-[20px]" />Descargar
            </a>
            <button type="button" disabled={remove.isPending}
              onClick={() => (confirm ? remove.mutate(viewing.id, { onSuccess: close }) : setConfirm(true))}
              className={`flex h-12 items-center justify-center gap-1.5 rounded-[14px] font-semibold ${confirm ? "bg-[#b42318]" : "bg-[#262626]"}`}>
              <Icon name="delete" className="text-[20px]" />{confirm ? "Sí, borrar" : "Borrar"}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}

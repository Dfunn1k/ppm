// Adjuntos de un movimiento: la boleta, el voucher o el recibo, en foto o PDF de hasta 5 MB.
// En Registrar se eligen antes de guardar y se suben al guardar; en el detalle se ven en miniaturas,
// se abren en el visor (AttachmentViewer) y se descargan o borran (pide confirmar).
import { useRef, useState } from "react";

import { type Attachment, useAttachments, useDeleteAttachment, useUploadAttachment } from "@/api/hooks";

import { shortDate } from "@/lib/dates";

import { AttachmentViewer, fileSize, kindOf, Thumb } from "./AttachmentViewer";
import { Sheet } from "./Sheet";
import { ErrorAlert, Icon } from "./ui";
import { Pill } from "@/components/Pill";

const MAX = 5 * 1024 * 1024;
const OK = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;

export { fileSize };

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

/** En el detalle de un movimiento: la tira de miniaturas (la más reciente primero), «Adjuntar» y el visor. */
export function MoveAttachments({ moveId, caption }: { moveId: number; caption?: string }) {
  const list = useAttachments(moveId).data ?? [];
  const upload = useUploadAttachment();
  const remove = useDeleteAttachment(moveId);
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const add = async (files: File[]) => {
    setProblem(files.map(fileProblem).find(Boolean) ?? null);
    for (const file of files.filter((f) => !fileProblem(f))) {
      await upload.mutateAsync({ moveId, file }).catch((e: Error) => setProblem(e.message));
    }
  };
  const del = (a: Attachment) => remove.mutate(a.id, {
    onSuccess: () => setViewing((i) => (list.length <= 1 || i === null ? null : Math.min(i, list.length - 2))),
  });

  return (
    <section aria-label="Adjuntos" className="mt-6 flex flex-col">
      <div className="flex items-baseline justify-between border-b border-border pb-1">
        <span className="flex items-center gap-1.5 text-label text-muted-foreground">Adjuntos{list.length > 0 && <Pill>{list.length}</Pill>}</span>
        {list.length > 1 && <span className="text-caption text-muted-foreground">del más reciente al más antiguo</span>}
      </div>
      <div className="-mx-6 mt-3 flex gap-3 overflow-x-auto px-6 pb-1">
        <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} disabled={upload.isPending}
          className="flex h-[148px] w-28 flex-none flex-col items-center justify-center gap-1.5 rounded-[12px] border-[1.5px] border-dashed border-input-line text-[13px] font-semibold disabled:opacity-60">
          <Icon name={upload.isPending ? "progress_activity" : "add_a_photo"} className={`text-[26px] ${upload.isPending ? "animate-spin" : ""}`} />
          {upload.isPending ? "Subiendo…" : "Adjuntar"}
        </button>
        {list.map((a, i) => (
          <button key={a.id} type="button" aria-label={`Ver ${a.name}`} onClick={() => setViewing(i)}
            className="flex w-28 flex-none flex-col gap-1.5 text-left">
            <span className="relative h-[148px] w-28 overflow-hidden rounded-[12px] border border-border">
              <Thumb a={a} className="size-full" />
              <span className="absolute bottom-1.5 left-1.5 rounded-md bg-[#171717]/80 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                {kindOf(a) === "PDF" ? "PDF" : "FOTO"}
              </span>
            </span>
            <span className="truncate text-[13px] leading-[18px] font-semibold">{a.name}</span>
            <span className="-mt-1.5 text-[12px] leading-4 text-muted-foreground">{shortDate(a.create_date.slice(0, 10))}</span>
          </button>
        ))}
      </div>
      <span className="mt-2 text-caption text-muted-foreground">Foto o PDF de hasta 5 MB. Se guardan en tu carpeta, con el respaldo diario.</span>
      {problem && <div className="mt-2"><ErrorAlert>{problem}</ErrorAlert></div>}
      <AttachSheet open={open} onClose={() => setOpen(false)} onFiles={add} />

      {viewing !== null && list[viewing] && (
        <AttachmentViewer list={list} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} caption={caption}
          onDelete={del} deleting={remove.isPending} error={remove.error?.message} onAdd={() => setOpen(true)} />
      )}
    </section>
  );
}

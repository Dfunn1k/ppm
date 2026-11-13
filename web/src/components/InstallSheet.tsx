// X0 · Instalar PPM: en Android y la computadora abre el instalador del navegador; en iPhone, los
// pasos de Safari. Tus datos siguen en tu servidor: solo cambia cómo se abre.
import { Sheet } from "@/components/Sheet";
import { Icon, PrimaryButton } from "@/components/ui";
import { type InstallState, useInstall } from "@/lib/install";

export function Logo({ size }: { size: number }) {
  return <img src="/logo.svg" alt="" width={size} height={size} className="flex-none" style={{ borderRadius: size * 0.22 }} />;
}

export const INSTALL_HINT: Record<InstallState, string> = {
  installed: "Ya está instalada en este equipo",
  prompt: "Como app en tu celular o tu computadora",
  ios: "Agrégala a tu pantalla de inicio",
  manual: "Como app en tu celular o tu computadora",
};

const IOS_STEPS = [
  ["Toca Compartir abajo en Safari", "ios_share"],
  ["Elige «Agregar a pantalla de inicio»", "add_box"],
  ["Toca «Agregar»", "check"],
] as const;

export function InstallSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, install } = useInstall();
  return (
    <Sheet title="Instalar PPM" open={open} onClose={onClose}>
      <div className="flex flex-col gap-4 px-3">
        <div className="flex items-center gap-3.5">
          <Logo size={56} />
          <span className="text-muted-foreground">Se abre como una app, sin la barra del navegador.</span>
        </div>
        {state === "installed" && <p className="text-muted-foreground">PPM ya está instalada aquí. Ábrela desde tu pantalla de inicio o tus aplicaciones.</p>}
        {state === "prompt" && (
          <>
            <p className="text-[14px] leading-5 text-muted-foreground">
              Queda en tu pantalla de inicio con el ícono de la hogaza. Tus datos siguen en tu servidor: solo cambia cómo la abres.
            </p>
            <PrimaryButton type="button" onClick={async () => { if (await install()) onClose(); }}>Instalar</PrimaryButton>
          </>
        )}
        {state === "ios" && (
          <ol className="flex flex-col gap-3">
            {IOS_STEPS.map(([text, icon], i) => (
              <li key={icon} className="flex items-center gap-3">
                <span className="grid size-7 flex-none place-items-center rounded-full bg-secondary text-[13px] font-semibold">{i + 1}</span>
                <span className="flex-1">{text}</span>
                <Icon name={icon} className="text-[22px]" />
              </li>
            ))}
          </ol>
        )}
        {state === "manual" && (
          <p className="text-[14px] leading-5 text-muted-foreground">
            Abre el menú del navegador (⋮ en Chrome o Edge) y elige «Instalar PPM» o «Agregar a pantalla de inicio».
          </p>
        )}
        {state !== "prompt" && (
          <button type="button" onClick={onClose} className="h-12 rounded-xl border border-input-line font-semibold">Entendido</button>
        )}
      </div>
    </Sheet>
  );
}

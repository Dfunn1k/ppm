// Privacidad: pública, se abre con o sin sesión (Google la pide para verificar la app). Dice lo que
// PPM hace de verdad; si algo de esto cambia en la app, cambia aquí y su fecha.
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { usePrivacy } from "@/api/hooks";
import { Icon, Screen } from "@/components/ui";

const UPDATED = "14 de noviembre de 2026";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-7 flex flex-col gap-2">
      <h2 className="font-display text-[22px] leading-[26px] font-bold">{title}</h2>
      {children}
    </section>
  );
}

function List({ items }: { items: ReactNode[] }) {
  return <ul className="flex list-disc flex-col gap-1.5 pl-5">{items.map((it, i) => <li key={i}>{it}</li>)}</ul>;
}

export function Privacidad() {
  const navigate = useNavigate();
  const first = useLocation().key === "default";   // se abrió directo (desde Google, por ejemplo)
  const contact = usePrivacy().data?.contact_email;

  return (
    <Screen className="pt-4">
      <div className="-mx-2.5 flex items-center">
        {first
          ? <Link to="/" aria-label="Ir a PPM" className="grid size-11 place-items-center rounded-full"><Icon name="arrow_back" className="text-[24px]" /></Link>
          : <button type="button" onClick={() => navigate(-1)} aria-label="Volver" className="grid size-11 place-items-center rounded-full"><Icon name="arrow_back" className="text-[24px]" /></button>}
      </div>
      <span className="mt-3 text-label text-muted-foreground">PPM · PAN PARA MAYO</span>
      <h1 className="mt-2 text-title-hero">Privacidad</h1>
      <span className="mt-2 text-caption text-muted-foreground">Actualizada el {UPDATED}</span>
      <p className="mt-4 text-muted-foreground">
        PPM es una app para llevar tus cuentas personales. Tus datos son tuyos: solo los usas tú, no se venden y no se comparten con nadie.
      </p>

      <Section title="Qué guarda">
        <List items={[
          "Tu nombre y tu correo.",
          "Tu contraseña, nunca tal cual: solo una huella que no se puede revertir.",
          "Si entras con Google: el identificador de esa cuenta y su correo. Nada más.",
          "Lo que tú registras: cuentas, movimientos, categorías, recurrentes y los extractos y comprobantes que adjuntas.",
          "Tus ajustes: país, moneda, formato y tema.",
        ]} />
      </Section>

      <Section title="Qué no hace">
        <List items={[
          "No lee tu Gmail, tu Drive ni tus contactos: a Google solo le pide tu nombre y tu correo.",
          "No se conecta a tu banco: los movimientos los escribes o los importas tú.",
          "No usa publicidad, analítica ni rastreadores. La única cookie es la de tu sesión.",
        ]} />
      </Section>

      <Section title="Con quién se comparte">
        <p>Con nadie. Solo dos servicios intervienen, y no ven tus cuentas:</p>
        <List items={[
          "El servicio de correo, que recibe tu dirección para mandarte «Olvidé mi contraseña».",
          "Google, cuando eliges entrar con Google: sabe que entraste a PPM.",
        ]} />
      </Section>

      <Section title="Dónde está">
        <p>
          En un servidor propio, con conexión cifrada (HTTPS). Cada persona ve solo lo suyo: la base de datos lo impide aunque haya
          un error en la app. Hay un respaldo diario que se guarda 14 días.
        </p>
      </Section>

      <Section title="Borrar tus datos">
        <p>
          Desde Más › Mi cuenta › Eliminar mi cuenta. Se borra al instante todo lo que registraste; las copias de seguridad se
          renuevan solas y en 14 días ya no queda nada tuyo. También puedes desvincular Google ahí mismo.
        </p>
      </Section>

      {contact && (
        <Section title="Contacto">
          <a href={`mailto:${contact}`} className="self-start underline">{contact}</a>
        </Section>
      )}
    </Screen>
  );
}

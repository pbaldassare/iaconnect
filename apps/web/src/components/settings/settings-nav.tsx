import { Tabs } from "@/components/ui/tabs";

export const SETTINGS_SECTIONS = [
  {
    key: "utenti",
    href: "/app/impostazioni/utenti",
    label: "Utenti",
    description: "Chi entra nell'azienda, con quale ruolo.",
  },
  {
    key: "modelli",
    href: "/app/impostazioni/modelli",
    label: "Modelli di messaggio",
    description: "Testi pronti per WhatsApp, mail e SMS, con i valori da riempire.",
  },
  {
    key: "assistente",
    href: "/app/impostazioni/assistente",
    label: "Assistente IA",
    description: "Tono, istruzioni e frasi fisse dell'IA quando risponde ai contatti.",
  },
  {
    key: "marchio",
    href: "/app/impostazioni/marchio",
    label: "Marchio",
    description: "Nome, logo, colore e recapiti del titolare.",
  },
  {
    key: "fasi",
    href: "/app/impostazioni/fasi",
    label: "Fasi delle trattative",
    description: "Le colonne della sezione Trattative e il loro ordine.",
  },
  {
    key: "campi",
    href: "/app/impostazioni/campi",
    label: "Campi delle trattative",
    description: "I dati in più che vuoi registrare su ogni trattativa.",
  },
  {
    key: "registro",
    href: "/app/impostazioni/registro",
    label: "Registro",
    description: "Chi ha fatto cosa nella tua azienda, compresi gli accessi dell'assistenza.",
  },
  {
    key: "privacy",
    href: "/app/impostazioni/privacy",
    label: "Dati e privacy",
    description: "Esportazione dei dati dell'azienda e ruoli nel trattamento.",
  },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["key"];

/** Tabs shared by every settings page. */
export function SettingsNav({ current }: { current: SettingsSection }) {
  return (
    <Tabs
      label="Sezioni delle impostazioni"
      className="mb-5"
      items={SETTINGS_SECTIONS.map((section) => ({
        href: section.href,
        label: section.label,
        current: section.key === current,
      }))}
    />
  );
}

/** Shown to collaborators on pages they can read but not change. */
export const READ_ONLY_NOTE =
  "Puoi vedere queste impostazioni ma non modificarle: servono i permessi di titolare. Chiedi a un titolare della tua azienda.";

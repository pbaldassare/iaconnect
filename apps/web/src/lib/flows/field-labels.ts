/**
 * Italian names for the field keys that appear in flow definitions and step results
 * (`subject`, `full_name`, `data.phone`…), so the readable schema and the run pages never
 * show a raw key when a plain word exists. Pure, unit tested.
 */
const FIELDS: Record<string, string> = {
  subject: "oggetto",
  from: "mittente",
  to: "destinatario",
  text: "testo",
  body: "testo",
  content: "testo",
  message: "messaggio",
  name: "nome",
  full_name: "nome",
  first_name: "nome",
  last_name: "cognome",
  phone: "telefono",
  email: "mail",
  product: "prodotto",
  company: "azienda",
  city: "città",
  address: "indirizzo",
  plate: "targa",
  amount: "importo",
  total: "totale",
  value: "valore",
  title: "titolo",
  url: "indirizzo web",
  link: "link",
  date: "data",
  deadline: "scadenza",
  expires_at: "scadenza",
  notes: "note",
  note: "note",
  id: "codice",
  status: "stato",
  category: "categoria",
  summary: "riassunto",
  reply: "risposta",
  slots: "orari liberi",
  stage: "fase",
  channel: "canale",
  quantity: "quantità",
  price: "prezzo",
  sector: "settore",
  owner_phone: "telefono del titolare",
  owner_email: "mail del titolare",
};

/** Containers that say nothing to the reader: `payload.subject`, `output.data.name`. */
const WRAPPERS = new Set(["payload", "output", "data"]);

/** One key: "full_name" → "nome", "tipo_polizza" → "tipo polizza". */
export function fieldName(key: string): string {
  return FIELDS[key] ?? FIELDS[key.toLowerCase()] ?? key.replace(/_/g, " ");
}

/** A dotted path: "payload.subject" → "oggetto", "data.address.city" → "indirizzo › città". */
export function fieldPathName(path: string): string {
  const parts = path.split(".").filter((part) => part !== "");
  const meaningful = parts.filter((part) => !WRAPPERS.has(part));
  return (meaningful.length > 0 ? meaningful : parts.slice(-1)).map(fieldName).join(" › ");
}

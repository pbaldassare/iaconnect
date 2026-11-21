#!/usr/bin/env python3
"""Build the programmer PDF for the platform read API, and the module the admin download serves.

The text follows the handlers in apps/web/src/lib/platform-api.ts, the route in
apps/web/src/app/api/v1, and the api_* functions in
supabase/migrations/20261120000200_platform_api.sql. It does not add endpoints.
"""

import base64
from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    CondPageBreak,
    Flowable,
    Frame,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

pdfmetrics.registerFont(TTFont("DejaVu", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("DejaVuBold", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))
pdfmetrics.registerFont(TTFont("DejaVuMono", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"))

INK = HexColor("#1c2420")
MUTED = HexColor("#5c6760")
GREEN = HexColor("#1f7a4d")
GREEN_SOFT = HexColor("#e7f3ec")
LINE = HexColor("#d5ddd8")
CODE_BG = HexColor("#f3f6f4")

PAGE_W, PAGE_H = A4
LEFT = 18 * mm
RIGHT = 18 * mm
CONTENT = PAGE_W - LEFT - RIGHT

CHAPTERS = [
    "1    A cosa serve",
    "2    Superficie pubblica",
    "3    Indirizzo e chiave",
    "4    Convenzioni",
    "5    Paginazione e aggiornamento",
    "6    Aziende",
    "7    Conversazioni",
    "8    Messaggi",
    "9    Errori",
    "10   Esempio di integrazione",
    "11   Cosa resta nel prodotto",
]


class Bookmark(Flowable):
    def __init__(self, key: str, title: str, level: int = 0):
        super().__init__()
        self.key = key
        self.title = title
        self.level = level
        self.width = 0
        self.height = 0

    def draw(self):
        self.canv.bookmarkPage(self.key)
        self.canv.addOutlineEntry(self.title, self.key, self.level, 0)


def styles():
    base = dict(fontName="DejaVu", textColor=INK, leading=15, fontSize=10.5)
    return {
        "h1": ParagraphStyle(
            "h1",
            fontName="DejaVuBold",
            fontSize=16,
            textColor=INK,
            leading=20,
            spaceBefore=2,
            spaceAfter=8,
        ),
        "h2": ParagraphStyle(
            "h2",
            fontName="DejaVuBold",
            fontSize=12.5,
            textColor=GREEN,
            leading=16,
            spaceBefore=12,
            spaceAfter=4,
        ),
        "body": ParagraphStyle("body", **base, spaceAfter=8),
        "bullet": ParagraphStyle("bullet", **base, leftIndent=2, spaceAfter=2),
        "th": ParagraphStyle("th", fontName="DejaVuBold", fontSize=8.5, textColor=INK, leading=11),
        "td": ParagraphStyle("td", fontName="DejaVu", fontSize=8.5, textColor=INK, leading=11),
        "td_mono": ParagraphStyle("td_mono", fontName="DejaVuMono", fontSize=8, textColor=INK, leading=11),
        "code": ParagraphStyle("code", fontName="DejaVuMono", fontSize=8, textColor=INK, leading=11.5),
        "label": ParagraphStyle(
            "label",
            fontName="DejaVuBold",
            fontSize=8,
            textColor=GREEN,
            leading=11,
            spaceBefore=8,
            spaceAfter=3,
        ),
        "note": ParagraphStyle("note", fontName="DejaVu", fontSize=9.5, textColor=INK, leading=13),
    }


S = styles()


def xml(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def mono(text: str) -> str:
    return f"<font face='DejaVuMono' size='9'>{xml(text)}</font>"


def P(text, style="body"):
    return Paragraph(text, S[style])


def h1(key, title):
    return KeepTogether([Bookmark(key, title, 0), P(title, "h1")])


def h2(title):
    return P(title, "h2")


def section(key, title):
    return [CondPageBreak(58 * mm), h1(key, title)]


def bullets(items):
    mark = ParagraphStyle("mark", fontName="DejaVuBold", fontSize=11, textColor=GREEN, leading=14)
    data = [[Paragraph("–", mark), Paragraph(item, S["bullet"])] for item in items]
    table = Table(data, colWidths=[6 * mm, CONTENT - 6 * mm])
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 2),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    return table


def code_block(text):
    safe = xml(text).replace("\n", "<br/>")
    table = Table([[Paragraph(safe, S["code"])]], colWidths=[CONTENT])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), CODE_BG),
                ("BOX", (0, 0), (-1, -1), 0.4, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    return table


def grid(headers, rows, widths, mono_cols=()):
    head = [Paragraph(cell, S["th"]) for cell in headers]
    body = []
    for row in rows:
        body.append(
            [
                Paragraph(cell, S["td_mono"] if i in mono_cols else S["td"])
                for i, cell in enumerate(row)
            ]
        )
    table = Table([head, *body], colWidths=widths, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), GREEN_SOFT),
        ("TEXTCOLOR", (0, 0), (-1, -1), INK),
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, GREEN),
        ("LINEBELOW", (0, 1), (-1, -2), 0.3, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, HexColor("#f7faf8")]),
    ]
    table.setStyle(TableStyle(style))
    return table


def note(title, body):
    text = f"<font face='DejaVuBold' size='9.5'>{xml(title)}</font><br/>{body}"
    table = Table([[Paragraph(text, S["note"])]], colWidths=[CONTENT])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), GREEN_SOFT),
                ("LINEBEFORE", (0, 0), (0, -1), 3, GREEN),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    return table


def paint_cover(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(GREEN)
    canvas.rect(0, PAGE_H - 112 * mm, PAGE_W, 112 * mm, fill=1, stroke=0)
    canvas.setFillColor(white)
    canvas.setFont("DejaVuBold", 9)
    canvas.drawString(LEFT, PAGE_H - 24 * mm, "VERSIONE 1  ·  21 NOVEMBRE 2026")
    canvas.setFont("DejaVuBold", 26)
    canvas.drawString(LEFT, PAGE_H - 42 * mm, "API di piattaforma")
    canvas.setFont("DejaVu", 11)
    text = canvas.beginText(LEFT, PAGE_H - 56 * mm)
    text.setFont("DejaVu", 11)
    text.setFillColor(HexColor("#e7f3ec"))
    text.setLeading(16)
    text.textLine("Riferimento per chi collega un gestionale, un sito")
    text.textLine("o un altro software a IA Connect.")
    canvas.drawText(text)
    y = PAGE_H - 132 * mm
    facts = [
        ("Sola lettura", "Tre percorsi GET. L'invio resta nell'Inbox e nei flussi."),
        ("Una chiave, un ambito", "Tutte le aziende, oppure una sola azienda."),
        ("Lo stesso storico", "Le righe che il cliente vede nell'Inbox."),
    ]
    for title, body in facts:
        canvas.setFillColor(GREEN)
        canvas.rect(LEFT, y - 1 * mm, 3 * mm, 11 * mm, fill=1, stroke=0)
        canvas.setFillColor(INK)
        canvas.setFont("DejaVuBold", 11)
        canvas.drawString(LEFT + 8 * mm, y + 5.5 * mm, title)
        canvas.setFillColor(MUTED)
        canvas.setFont("DejaVu", 10)
        canvas.drawString(LEFT + 8 * mm, y - 0.2 * mm, body)
        y -= 18 * mm
    y -= 4 * mm
    canvas.setFillColor(INK)
    canvas.setFont("DejaVuBold", 12)
    canvas.drawString(LEFT, y, "In questo documento")
    y -= 7 * mm
    canvas.setFont("DejaVu", 10)
    for chapter in CHAPTERS:
        canvas.drawString(LEFT, y, chapter)
        y -= 5.6 * mm
    canvas.setFillColor(MUTED)
    canvas.setFont("DejaVu", 8)
    canvas.drawString(LEFT, 14 * mm, "IA Connect  ·  https://iaconnect.pages.dev/api/v1")
    canvas.restoreState()


def paint_page(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(GREEN)
    canvas.rect(0, PAGE_H - 7 * mm, PAGE_W, 7 * mm, fill=1, stroke=0)
    canvas.setFillColor(MUTED)
    canvas.setFont("DejaVu", 8)
    canvas.drawString(LEFT, PAGE_H - 13 * mm, "IA Connect  ·  API di piattaforma  ·  versione 1")
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.4)
    canvas.line(LEFT, 12 * mm, PAGE_W - RIGHT, 12 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont("DejaVu", 8)
    canvas.drawString(LEFT, 7 * mm, "Sola lettura  ·  https://iaconnect.pages.dev")
    canvas.drawRightString(PAGE_W - RIGHT, 7 * mm, str(doc.page))
    canvas.restoreState()


def story():
    flow = [NextPageTemplate("body"), PageBreak()]
    w = CONTENT

    flow += section("scopo", "1. A cosa serve")
    flow.append(
        P(
            "Questa API è il contratto stabile per leggere da un altro software lo storico che IA Connect ha già registrato: le aziende visibili alla chiave, le conversazioni di un'azienda e i messaggi di una conversazione."
        )
    )
    flow.append(
        P(
            "Un cliente è un'azienda. Ogni azienda ha lo stesso contratto. Un nome di cliente non compare mai in un percorso."
        )
    )
    flow.append(h2("Dove stanno gli stessi dati"))
    flow.append(
        grid(
            ["Chi", "Dove li vede"],
            [
                ["Il cliente", "Area /app, nella Inbox."],
                ["L'amministratore della piattaforma", "Area /admin, scheda azienda, sezione Conversazioni."],
                ["Un altro software", "I tre percorsi di questo documento, con la chiave Bearer."],
            ],
            [62 * mm, w - 62 * mm],
        )
    )
    flow.append(Spacer(1, 3 * mm))
    flow.append(h2("Quali messaggi entrano nello storico"))
    flow.append(
        bullets(
            [
                "Quelli arrivati da un collegamento, per esempio il webhook di WhatsApp.",
                "Quelli inviati dall'Inbox.",
                "Quelli inviati da un flusso, compresi gli invii di prova con stato <font face='DejaVuMono' size='9'>simulated</font>.",
            ]
        )
    )
    flow.append(
        P(
            "Un invio fatto sul pannello del fornitore, fuori da IA Connect, non passa da queste tabelle e non compare qui."
        )
    )
    flow.append(h2("Come si ottiene una chiave"))
    flow.append(
        bullets(
            [
                "Un amministratore della piattaforma apre <font face='DejaVuMono' size='9'>/admin/api</font>.",
                "Crea una chiave, le dà un nome (da 1 a 80 caratteri) e sceglie l'ambito: tutti i clienti, oppure una sola azienda.",
                "Copia la chiave intera in quel momento. IA Connect non la mostra una seconda volta.",
                "Il software esterno la manda nell'intestazione <font face='DejaVuMono' size='9'>Authorization</font> a ogni chiamata.",
            ]
        )
    )
    flow.append(
        P(
            "Creare e revocare una chiave richiede la sessione dell'amministratore. La chiave Bearer non può creare altre chiavi."
        )
    )

    flow += section("superficie", "2. Superficie pubblica")
    flow.append(
        P(
            "La versione 1 espone solo questi tre percorsi. Qualsiasi altro percorso sotto <font face='DejaVuMono' size='9'>/api/v1</font> risponde 404."
        )
    )
    flow.append(
        grid(
            ["Metodo e percorso", "Risposta 200"],
            [
                [
                    "GET /api/v1/organizations",
                    "Le aziende visibili alla chiave, in un'unica risposta, in ordine di nome.",
                ],
                [
                    "GET /api/v1/organizations/{organizationId}/conversations",
                    "Le conversazioni di quell'azienda, dalla data di apertura più recente.",
                ],
                [
                    "GET /api/v1/organizations/{organizationId}/conversations/{conversationId}/messages",
                    "I messaggi di quella conversazione, dal più recente.",
                ],
            ],
            [78 * mm, w - 78 * mm],
            mono_cols=(0,),
        )
    )
    flow.append(Spacer(1, 3 * mm))
    flow.append(
        P(
            "Il server risponde a GET, POST, PUT, PATCH e DELETE su questi percorsi. Solo GET restituisce i dati. Gli altri quattro metodi, se il percorso esiste, rispondono 405. Il corpo della richiesta, se c'è, viene ignorato."
        )
    )
    flow.append(
        note(
            "Nessun percorso di scrittura",
            "La versione 1 non crea aziende, non invia messaggi e non modifica conversazioni. L'invio controlla il consenso del contatto, la finestra del canale e la quota dell'azienda, e resta nell'Inbox e nei flussi. Il capitolo 11 dice dove stanno le altre operazioni.",
        )
    )

    flow += section("auth", "3. Indirizzo e chiave")
    flow.append(P("L'indirizzo pubblicato è l'origine del sito. I percorsi di questa guida si aggiungono così come sono."))
    flow.append(code_block("https://iaconnect.pages.dev"))
    flow.append(Spacer(1, 2 * mm))
    flow.append(
        P(
            "Il cookie di accesso dell'interfaccia non autorizza queste chiamate e non serve. La chiamata porta solo la chiave."
        )
    )
    flow.append(code_block("Authorization: Bearer iac_…"))
    flow.append(Spacer(1, 2 * mm))
    flow.append(h2("Forma della chiave"))
    flow.append(
        bullets(
            [
                "La parola <font face='DejaVuMono' size='9'>Bearer</font>, uno spazio, poi la chiave. Maiuscole e minuscole contano su <font face='DejaVuMono' size='9'>Bearer</font>.",
                "La chiave è <font face='DejaVuMono' size='9'>iac_</font> seguito da 64 caratteri esadecimali minuscoli. Lunghezza totale: 68 caratteri. Esempio di forma: <font face='DejaVuMono' size='9'>iac_</font> e poi 64 volte un carattere tra 0-9 e a-f.",
                "Uno spazio in più, un prefisso diverso, lettere maiuscole nell'esadecimale, oppure uno schema diverso da Bearer, rispondono 401. La chiave non viene confrontata con l'archivio.",
                "Gli spazi all'inizio e alla fine dell'intestazione intera sono tollerati. Un tab al posto dello spazio no.",
            ]
        )
    )
    flow.append(h2("Cosa resta in archivio"))
    flow.append(
        grid(
            ["Dato", "Forma", "Uso"],
            [
                ["Chiave intera", "iac_ e 64 esadecimali", "Viaggia solo nella chiamata. Si vede una volta, alla creazione."],
                ["Prefisso", "iac_ e 8 esadecimali", "I primi 12 caratteri. Compare nell'elenco admin, per riconoscere la chiave."],
                ["Impronta", "SHA-256, 64 esadecimali", "È l'unico segreto conservato. Dall'impronta non si ricostruisce la chiave."],
            ],
            [32 * mm, 48 * mm, w - 80 * mm],
        )
    )
    flow.append(Spacer(1, 3 * mm))
    flow.append(
        P(
            "Nel registro delle azioni restano il nome e il prefisso. La chiave intera e l'impronta non ci finiscono. Revocare una chiave la spegne subito: la chiamata successiva riceve 401, lo stesso corpo di una chiave sconosciuta. Una seconda revoca non cambia nulla. Cancellare l'azienda cancella le sue chiavi."
        )
    )
    flow.append(h2("Ambito"))
    flow.append(
        grid(
            ["Scelta in /admin/api", "Cosa legge"],
            [
                [
                    "Tutti i clienti",
                    "Ogni azienda. È un ambito da sistema vostro, non da software consegnato a un cliente.",
                ],
                [
                    "Una azienda",
                    "Solo quell'azienda. Un percorso con un altro id riceve 403, anche se quell'id non esiste.",
                ],
            ],
            [42 * mm, w - 42 * mm],
        )
    )
    flow.append(Spacer(1, 3 * mm))
    flow.append(
        P(
            "Il 403 non rivela se l'altra azienda esiste. Una chiave di un'azienda che chiede una conversazione della propria azienda, quando la conversazione non c'è, riceve 404."
        )
    )
    flow.append(h2("Ultimo uso"))
    flow.append(
        P(
            "Una chiamata che arriva al database con una chiave valida aggiorna la data di ultimo uso, anche se poi la risposta è 403 o 404. Non la aggiornano: una chiave assente, malformata, sconosciuta o revocata (401); una query non valida (400); un metodo diverso da GET (405); un percorso sconosciuto (404); il server che non riesce ad aprire il database (503)."
        )
    )

    flow += section("convenzioni", "4. Convenzioni")
    flow.append(
        bullets(
            [
                "La risposta valida è un oggetto JSON: <font face='DejaVuMono' size='9'>{ \"data\": [ ... ] }</font>. Mai un array nudo.",
                "Un errore è <font face='DejaVuMono' size='9'>{ \"error\": \"codice\" }</font>. Nessun messaggio interno, nessuno stack, nessuna chiave.",
                "Il tipo è <font face='DejaVuMono' size='9'>application/json</font>. Il corpo è UTF-8.",
                "Ogni risposta, anche di errore, porta <font face='DejaVuMono' size='9'>Cache-Control: no-store</font>.",
                "Le date sono istanti ISO 8601 in UTC, per esempio <font face='DejaVuMono' size='9'>2026-11-21T07:30:00.000Z</font>.",
                "Gli identificativi sono UUID. Nel percorso valgono maiuscole e minuscole: il server li normalizza in minuscolo. Un segmento che non ha la forma 8-4-4-4-12 esadecimale rende l'intero percorso sconosciuto (404), non un errore di query.",
                "Una sola barra finale è accettata: <font face='DejaVuMono' size='9'>/api/v1/organizations/</font> equivale al percorso senza barra.",
                "I parametri di query diversi da <font face='DejaVuMono' size='9'>limit</font> e <font face='DejaVuMono' size='9'>before</font> sono ignorati. Se lo stesso parametro è ripetuto, vale il primo.",
                "L'intestazione <font face='DejaVuMono' size='9'>Accept</font> è ignorata. La risposta è sempre JSON.",
            ]
        )
    )
    flow.append(h2("Parametri di query"))
    flow.append(
        P(
            "Conversazioni e messaggi accettano due parametri. Sull'elenco aziende gli stessi parametri, se presenti, sono controllati allo stesso modo, ma non filtrano e non accorciano l'elenco: una <font face='DejaVuMono' size='9'>limit</font> valida viene ignorata e la risposta contiene tutte le aziende visibili."
        )
    )
    flow.append(
        grid(
            ["Parametro", "Se manca", "Regola"],
            [
                [
                    "limit",
                    "50",
                    "Intero da 1 a 100, senza zero iniziale. 0, 01, 101, 1.5 o un testo ricevono 400. Il massimo accettato è 100.",
                ],
                [
                    "before",
                    "nessun filtro",
                    "Istante interpretabile come data, al massimo 40 caratteri. Restano le righe con created_at strettamente precedente. Una stringa vuota vale come parametro assente.",
                ],
            ],
            [28 * mm, 32 * mm, w - 60 * mm],
            mono_cols=(0,),
        )
    )
    flow.append(Spacer(1, 3 * mm))
    flow.append(
        P(
            "Mandate <font face='DejaVuMono' size='9'>before</font> in UTC con il suffisso Z. Un fuso esplicito, per esempio <font face='DejaVuMono' size='9'>+01:00</font>, viene convertito in UTC. Un istante senza fuso è letto nell'orologio del server e poi normalizzato in UTC: per non dipendere da quell'orologio usate sempre la Z. Il valore che il server confronta è quello normalizzato, con i millisecondi."
        )
    )
    flow.append(h2("Ordine di controllo"))
    flow.append(P("Il server decide in quest'ordine. Il primo esito chiude la risposta."))
    flow.append(
        grid(
            ["Passo", "Esito"],
            [
                ["1. Il percorso non è uno dei tre", "404 not_found. La chiave non viene letta."],
                ["2. Il metodo non è GET", "405 method_not_allowed. La chiave non viene letta."],
                ["3. La chiave manca o non ha la forma attesa", "401 unauthorized."],
                ["4. limit o before non rispettano le regole", "400 invalid_query."],
                ["5. La chiave è sconosciuta o revocata", "401 unauthorized."],
                ["6. La chiave è di un'altra azienda", "403 forbidden, anche se l'id non esiste."],
                ["7. L'azienda o la conversazione non ci sono", "404 not_found, se la chiave può vedere quell'azienda."],
                ["8. Il database risponde", "200 con data."],
            ],
            [78 * mm, w - 78 * mm],
        )
    )
    flow.append(Spacer(1, 3 * mm))
    flow.append(
        P(
            "Una POST verso un percorso sconosciuto è quindi 404, non 405. Una POST verso un percorso vero è 405 anche senza chiave. Una query non valida con una chiave malformata è 401, non 400."
        )
    )

    flow += section("pagine", "5. Paginazione e aggiornamento")
    flow.append(
        P(
            "Le aziende arrivano tutte in una risposta, ordinate per nome. Conversazioni e messaggi arrivano a pagine, ordinate per <font face='DejaVuMono' size='9'>created_at</font> decrescente: prima la riga aperta o registrata più di recente."
        )
    )
    flow.append(
        note(
            "L'ordine delle conversazioni è la data di apertura",
            "Il campo last_message_at dice quando è arrivato l'ultimo messaggio, ma non sposta la conversazione in cima all'elenco. Una conversazione vecchia con un messaggio nuovo resta dov'è, secondo created_at.",
        )
    )
    flow.append(Spacer(1, 3 * mm))
    flow.append(h2("Pagina successiva"))
    flow.append(
        bullets(
            [
                "La prima pagina non manda <font face='DejaVuMono' size='9'>before</font>.",
                "Se la pagina contiene righe, la successiva usa come <font face='DejaVuMono' size='9'>before</font> il <font face='DejaVuMono' size='9'>created_at</font> dell'ultima riga ricevuta.",
                "Il confronto è stretto: una riga con lo stesso istante del cursore non torna nella pagina dopo.",
                "Non c'è un secondo campo di ordinamento. Due righe con lo stesso <font face='DejaVuMono' size='9'>created_at</font> possono avere un ordine non stabile. Con un <font face='DejaVuMono' size='9'>limit</font> che taglia in mezzo a quello stesso istante, le righe non ancora lette e con quell'istante non compaiono nella pagina dopo. Gli istanti del prodotto hanno i millisecondi e di solito sono distinti.",
                "Una pagina con meno righe di <font face='DejaVuMono' size='9'>limit</font> è l'ultima. Una pagina piena può esserlo comunque: va chiesta la successiva.",
                "Una pagina con <font face='DejaVuMono' size='9'>data</font> vuoto è la fine. È una risposta 200, non un errore.",
            ]
        )
    )
    flow.append(
        P(
            "La risposta non contiene il totale, un cursore firmato, né un'intestazione <font face='DejaVuMono' size='9'>Link</font>. Il client calcola la pagina dopo dal <font face='DejaVuMono' size='9'>created_at</font> dell'ultima riga."
        )
    )
    flow.append(h2("Leggere le novità"))
    flow.append(
        P(
            "Esiste solo <font face='DejaVuMono' size='9'>before</font>, che cammina verso il passato. Non esiste <font face='DejaVuMono' size='9'>after</font>, né un filtro sulla data di modifica. Le righe nuove stanno sulla prima pagina, perché l'ordine è decrescente."
        )
    )
    flow.append(
        bullets(
            [
                "Per lo storico iniziale, scorrete le conversazioni e, per ciascuna, i messaggi, fino a una pagina vuota.",
                "Per le novità, rileggete la prima pagina. Fermatevi quando incontrate un <font face='DejaVuMono' size='9'>id</font> che avete già. Se le righe nuove sono più di <font face='DejaVuMono' size='9'>limit</font>, continuate con <font face='DejaVuMono' size='9'>before</font> fino a un id noto.",
                "Un messaggio nuovo in una conversazione già nota non sposta la conversazione. Per vederlo, rileggete la prima pagina dei messaggi di quella conversazione, oppure rileggete le conversazioni e confrontate <font face='DejaVuMono' size='9'>last_message_at</font> con il valore che avevate salvato.",
            ]
        )
    )
    flow.append(
        P(
            "La versione 1 non invia webhook al software esterno quando arriva un messaggio. L'integrazione che vuole le novità interroga di nuovo."
        )
    )

    flow += section("organizations", "6. Aziende")
    flow.append(P("GET /api/v1/organizations", "label"))
    flow.append(
        P(
            "Elenco delle aziende visibili alla chiave. Una chiave di piattaforma le riceve tutte, in ordine di nome. Una chiave di un'azienda riceve solo la propria. Non è un elenco paginato."
        )
    )
    flow.append(P("Richiesta", "label"))
    flow.append(
        code_block(
            "GET /api/v1/organizations HTTP/1.1\n"
            "Host: iaconnect.pages.dev\n"
            "Authorization: Bearer iac_…"
        )
    )
    flow.append(P("Risposta 200", "label"))
    flow.append(
        code_block(
            '{\n'
            '  "data": [\n'
            "    {\n"
            '      "id": "11111111-1111-4111-8111-111111111111",\n'
            '      "name": "Pititto Assicurazioni",\n'
            '      "sector": "insurance",\n'
            '      "status": "active",\n'
            '      "created_at": "2026-10-06T08:00:00.000Z"\n'
            "    }\n"
            "  ]\n"
            "}"
        )
    )
    flow.append(Spacer(1, 2 * mm))
    flow.append(
        grid(
            ["Campo", "Tipo", "Valori"],
            [
                ["id", "stringa UUID", "Identificativo da usare nei percorsi successivi."],
                ["name", "stringa", "Nome mostrato in interfaccia."],
                ["sector", "stringa", "insurance, ecommerce, real_estate oppure other. Sono i settori che il prodotto assegna."],
                ["status", "stringa", "active oppure suspended. Un'azienda sospesa resta in elenco e resta leggibile."],
                ["created_at", "stringa data", "Istante di creazione, in UTC."],
            ],
            [32 * mm, 32 * mm, w - 64 * mm],
            mono_cols=(0, 1),
        )
    )
    flow.append(Spacer(1, 3 * mm))
    flow.append(
        P(
            "La risposta non include il piano, il rivenditore, gli utenti né le quote. <font face='DejaVuMono' size='9'>limit</font> e <font face='DejaVuMono' size='9'>before</font>, se li mandate e sono validi, non cambiano questo elenco. Se non sono validi, la risposta è 400 come per gli altri percorsi."
        )
    )

    flow += section("conversations", "7. Conversazioni")
    flow.append(P("GET /api/v1/organizations/{organizationId}/conversations", "label"))
    flow.append(
        P(
            "Le conversazioni di quell'azienda. <font face='DejaVuMono' size='9'>{organizationId}</font> è l'<font face='DejaVuMono' size='9'>id</font> ricevuto dall'elenco aziende. L'ordine è <font face='DejaVuMono' size='9'>created_at</font> decrescente."
        )
    )
    flow.append(P("Richiesta", "label"))
    flow.append(
        code_block(
            "GET /api/v1/organizations/{org}/conversations?limit=20 HTTP/1.1\n"
            "Host: iaconnect.pages.dev\n"
            "Authorization: Bearer iac_…"
        )
    )
    flow.append(P("Risposta 200", "label"))
    flow.append(
        code_block(
            '{\n'
            '  "data": [\n'
            "    {\n"
            '      "id": "22222222-2222-4222-8222-222222222222",\n'
            '      "contact_id": "33333333-3333-4333-8333-333333333333",\n'
            '      "contact_name": "Mario Rossi",\n'
            '      "channel": "whatsapp",\n'
            '      "status": "open",\n'
            '      "last_message_at": "2026-11-21T07:12:00.000Z",\n'
            '      "unread_count": 1,\n'
            '      "created_at": "2026-11-20T16:40:00.000Z"\n'
            "    }\n"
            "  ]\n"
            "}"
        )
    )
    flow.append(Spacer(1, 2 * mm))
    flow.append(
        grid(
            ["Campo", "Tipo", "Valori"],
            [
                ["id", "stringa UUID", "Identificativo da usare per leggere i messaggi."],
                ["contact_id", "stringa UUID", "Contatto dentro l'azienda. Il contatto completo non è in questa API."],
                ["contact_name", "stringa", "Nome del contatto. Può essere una stringa vuota."],
                ["channel", "stringa", "whatsapp, mail, sms oppure social."],
                ["status", "stringa", "open oppure closed. Entrambe compaiono: l'elenco non filtra per stato."],
                ["last_message_at", "stringa data oppure null", "Istante dell'ultimo messaggio. null se non ce n'è ancora uno."],
                ["unread_count", "numero intero", "Messaggi non letti nell'Inbox. Zero se non ce ne sono."],
                ["created_at", "stringa data", "Apertura della conversazione. È il campo di before e dell'ordine."],
            ],
            [36 * mm, 40 * mm, w - 76 * mm],
            mono_cols=(0,),
        )
    )
    flow.append(Spacer(1, 3 * mm))
    flow.append(h2("Casi"))
    flow.append(
        bullets(
            [
                "Chiave dell'azienda A, id dell'azienda B: 403, che l'azienda B esista o no.",
                "Chiave di piattaforma, id inesistente con forma di UUID: 404.",
                "Azienda esistente e visibile, nessuna conversazione: 200 e <font face='DejaVuMono' size='9'>data</font> vuoto.",
                "Query <font face='DejaVuMono' size='9'>?limit=20&amp;before=2026-11-21T07:12:00.000Z</font>: al massimo 20 conversazioni aperte prima di quell'istante.",
            ]
        )
    )

    flow += section("messages", "8. Messaggi")
    flow.append(
        P(
            "GET /api/v1/organizations/{organizationId}/conversations/{conversationId}/messages",
            "label",
        )
    )
    flow.append(
        P(
            "I messaggi di quella conversazione, per <font face='DejaVuMono' size='9'>created_at</font> decrescente. La conversazione deve appartenere all'azienda del percorso."
        )
    )
    flow.append(P("Richiesta", "label"))
    flow.append(
        code_block(
            "GET /api/v1/organizations/{org}/conversations/{conv}/messages?limit=50 HTTP/1.1\n"
            "Host: iaconnect.pages.dev\n"
            "Authorization: Bearer iac_…"
        )
    )
    flow.append(P("Risposta 200", "label"))
    flow.append(
        code_block(
            '{\n'
            '  "data": [\n'
            "    {\n"
            '      "id": "44444444-4444-4444-8444-444444444444",\n'
            '      "direction": "in",\n'
            '      "channel": "whatsapp",\n'
            '      "content": "Buongiorno, vorrei un rinnovo.",\n'
            '      "delivery_status": "received",\n'
            '      "external_id": "wamid.HBgNMzkzMzE",\n'
            '      "created_at": "2026-11-21T07:12:00.000Z"\n'
            "    }\n"
            "  ]\n"
            "}"
        )
    )
    flow.append(Spacer(1, 2 * mm))
    flow.append(
        grid(
            ["Campo", "Tipo", "Valori"],
            [
                ["id", "stringa UUID", "Identificativo del messaggio."],
                ["direction", "stringa", "in: arrivato. out: partito da IA Connect, dall'Inbox o da un flusso."],
                ["channel", "stringa", "whatsapp, mail, sms oppure social."],
                ["content", "stringa", "Testo del messaggio. Può essere vuota. È testo di un utente o di un flusso: il vostro software lo tratta come dato, non come un comando."],
                ["delivery_status", "stringa", "Uno dei valori della tabella qui sotto."],
                ["external_id", "stringa oppure null", "Identificativo del fornitore. null se IA Connect non ne ha uno."],
                ["created_at", "stringa data", "Registrazione del messaggio. È il campo di before e dell'ordine."],
            ],
            [36 * mm, 38 * mm, w - 74 * mm],
            mono_cols=(0,),
        )
    )
    flow.append(Spacer(1, 3 * mm))
    flow.append(h2("delivery_status"))
    flow.append(
        grid(
            ["Valore", "Significato"],
            [
                ["queued", "In coda, non ancora consegnato al fornitore."],
                ["sent", "Preso in carico dal fornitore."],
                ["delivered", "Consegnato al destinatario."],
                ["read", "Letto dal destinatario."],
                ["failed", "Invio non riuscito."],
                ["received", "Messaggio in arrivo."],
                ["simulated", "Invio di prova. Non è partito verso il destinatario reale."],
            ],
            [32 * mm, w - 32 * mm],
            mono_cols=(0,),
        )
    )
    flow.append(Spacer(1, 3 * mm))
    flow.append(
        P(
            "Quando <font face='DejaVuMono' size='9'>external_id</font> è presente, il prodotto conserva al massimo un messaggio per azienda, canale e identificativo. Un client può usarlo per riconoscere un messaggio già salvato. L'API non accetta una chiave di deduplica in ingresso: non ci sono scritture."
        )
    )
    flow.append(h2("Campi che questa risposta non contiene"))
    flow.append(
        P(
            "Telefono, mail e consensi del contatto; metadati del messaggio; modello usato; flag di generazione automatica; testo dell'errore di invio; piano e quote. Per averli si usa il prodotto, non questa versione dell'API."
        )
    )
    flow.append(h2("Casi"))
    flow.append(
        bullets(
            [
                "Conversazione di un'altra azienda, con una chiave limitata a una azienda: 403 se l'id azienda del percorso non è il suo; 404 se l'azienda è la sua ma la conversazione appartiene a un'altra.",
                "Chiave di piattaforma, conversazione inesistente nell'azienda indicata: 404.",
                "Conversazione senza messaggi: 200 e <font face='DejaVuMono' size='9'>data</font> vuoto.",
            ]
        )
    )

    flow += section("errori", "9. Errori")
    flow.append(
        grid(
            ["HTTP", "error", "Quando"],
            [
                ["401", "unauthorized", "Chiave assente, malformata, sconosciuta o revocata. Il corpo è lo stesso nei quattro casi."],
                ["403", "forbidden", "La chiave è di un'azienda e il percorso ne indica un'altra, esistente o no."],
                ["404", "not_found", "Percorso sconosciuto, UUID malformato, azienda inesistente per una chiave che potrebbe vederla, o conversazione assente in quell'azienda."],
                ["400", "invalid_query", "limit o before non rispettano il capitolo 4."],
                ["405", "method_not_allowed", "POST, PUT, PATCH o DELETE su un percorso che esiste."],
                ["503", "unavailable", "Il server non ha il modo di leggere il database. Si può riprovare più tardi."],
                ["500", "internal", "Errore non previsto. Il corpo contiene solo questo codice."],
            ],
            [16 * mm, 40 * mm, w - 56 * mm],
            mono_cols=(0, 1),
        )
    )
    flow.append(Spacer(1, 3 * mm))
    flow.append(P("Esempi", "label"))
    flow.append(code_block('{ "error": "unauthorized" }'))
    flow.append(Spacer(1, 2 * mm))
    flow.append(code_block('{ "error": "invalid_query" }'))
    flow.append(Spacer(1, 3 * mm))
    flow.append(
        P(
            "Non esiste, in questa versione, la risposta 429. Non c'è un'intestazione <font face='DejaVuMono' size='9'>Retry-After</font> e non c'è una quota pubblicata su queste letture. Interrogate con la frequenza che serve all'integrazione, a pagine, senza un ciclo stretto."
        )
    )

    flow += section("esempio", "10. Esempio di integrazione")
    flow.append(
        P(
            "Una chiave di una sola azienda legge solo quell'azienda. Le chiamate sono ripetibili: rifare un GET non crea righe. Può aggiornare la data di ultimo uso. Non esiste un'intestazione <font face='DejaVuMono' size='9'>Idempotency-Key</font>, perché non ci sono scritture."
        )
    )
    flow.append(P("1. Chiede le aziende e tiene l'id.", "label"))
    flow.append(
        code_block(
            "curl -sS \\\n"
            '  -H "Authorization: Bearer iac_…" \\\n'
            "  https://iaconnect.pages.dev/api/v1/organizations"
        )
    )
    flow.append(P("2. Scorre le conversazioni, venti alla volta.", "label"))
    flow.append(
        code_block(
            "curl -sS \\\n"
            '  -H "Authorization: Bearer iac_…" \\\n'
            '  "$BASE/api/v1/organizations/$ORG/conversations?limit=20"'
        )
    )
    flow.append(
        P(
            "Se la risposta ha 20 righe, la chiamata successiva aggiunge <font face='DejaVuMono' size='9'>before</font> con il <font face='DejaVuMono' size='9'>created_at</font> dell'ultima, codificato nella query. Si ripete finché <font face='DejaVuMono' size='9'>data</font> è vuoto o la pagina è più corta del limite."
        )
    )
    flow.append(
        code_block(
            "curl -sS \\\n"
            '  -G \\\n'
            '  -H "Authorization: Bearer iac_…" \\\n'
            "  --data-urlencode \"limit=20\" \\\n"
            "  --data-urlencode \"before=2026-11-20T16:40:00.000Z\" \\\n"
            '  "$BASE/api/v1/organizations/$ORG/conversations"'
        )
    )
    flow.append(P("3. Per ogni conversazione, gli stessi passi sui messaggi.", "label"))
    flow.append(
        code_block(
            "curl -sS \\\n"
            '  -H "Authorization: Bearer iac_…" \\\n'
            '  "$BASE/api/v1/organizations/$ORG/conversations/$CONV/messages?limit=50"'
        )
    )
    flow.append(Spacer(1, 2 * mm))
    flow.append(h2("Da un server, non dal browser di un altro sito"))
    flow.append(
        P(
            "La risposta non manda intestazioni CORS. Un browser su un altro sito non è un client previsto. Chiamate l'API dal vostro server e tenete la chiave fuori dalle pagine e dai repository. Il testo dei messaggi può contenere dati personali: vale il trattamento che avete concordato con l'azienda."
        )
    )
    flow.append(h2("Versione"))
    flow.append(
        P(
            "Questo documento descrive la versione 1 al 21 novembre 2026. I percorsi restano sotto <font face='DejaVuMono' size='9'>/api/v1</font>. Un cambiamento che rompe il significato di questi campi userà un prefisso nuovo."
        )
    )

    flow += section("resto", "11. Cosa resta nel prodotto")
    flow.append(
        P(
            "Queste operazioni esistono in IA Connect e usano una sessione, non la chiave di questa API. Questo documento non ne pubblica il contratto."
        )
    )
    flow.append(
        grid(
            ["Operazione", "Dove sta"],
            [
                ["Creare e revocare chiavi", "Amministratore della piattaforma, pagina /admin/api."],
                ["Inviare un messaggio", "Inbox o flusso. Lì passano consenso, finestra del canale e quota."],
                ["Contatti, trattative, flussi, modelli, consumi", "Area cliente /app. Nessun percorso /api/v1 li espone."],
                ["Collegare una casella o un fornitore (OAuth)", "Percorsi /api/oauth, con la sessione di chi configura il collegamento."],
                ["Webhook dei fornitori", "Li chiama il fornitore verso IA Connect. Non sono un modo per leggere lo storico."],
                ["Pagine di admin e di cliente", "Cookie di sessione. La chiave Bearer non apre quelle pagine."],
            ],
            [62 * mm, w - 62 * mm],
        )
    )
    flow.append(Spacer(1, 4 * mm))
    flow.append(
        P(
            "Il PDF che state leggendo si scarica, da un amministratore della piattaforma già entrato, dalla pagina <font face='DejaVuMono' size='9'>/admin/api</font>. Il file non contiene chiavi."
        )
    )
    return flow


def write_module(path: Path, pdf: bytes) -> None:
    encoded = base64.b64encode(pdf).decode("ascii")
    chunks = [encoded[index : index + 100] for index in range(0, len(encoded), 100)]
    lines = [
        "/** Generated by scripts/build-api-pdf.py. Do not edit. */",
        "export const apiDocumentationPdfBase64 = [",
        *[f'  "{chunk}",' for chunk in chunks],
        '].join("");',
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def main():
    root = Path(__file__).resolve().parents[1]
    target = root / "docs" / "api" / "ia-connect-api-v1.pdf"
    module = root / "apps" / "web" / "src" / "lib" / "api-doc-pdf.gen.ts"
    target.parent.mkdir(parents=True, exist_ok=True)

    doc = BaseDocTemplate(
        str(target),
        pagesize=A4,
        title="IA Connect — API di piattaforma, versione 1",
        author="IA Connect",
        subject="Riferimento per leggere aziende, conversazioni e messaggi.",
        creator="IA Connect",
    )
    cover = PageTemplate(
        id="cover",
        frames=[Frame(LEFT, 16 * mm, CONTENT, PAGE_H - 28 * mm, id="cover", showBoundary=0)],
        onPage=paint_cover,
    )
    body = PageTemplate(
        id="body",
        frames=[Frame(LEFT, 18 * mm, CONTENT, PAGE_H - 36 * mm, id="body", showBoundary=0)],
        onPage=paint_page,
    )
    doc.addPageTemplates([cover, body])
    doc.build(story())
    data = target.read_bytes()
    if not data.startswith(b"%PDF-"):
        raise SystemExit(f"{target} is not a PDF")
    write_module(module, data)
    print(target)
    print(module)


if __name__ == "__main__":
    main()

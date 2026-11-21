#!/usr/bin/env python3
"""Build docs/api/ia-connect-api-v1.pdf from the platform API contract."""

from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_LEFT
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
    ListFlowable,
    ListItem,
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
PAPER = HexColor("#ffffff")
ROW = HexColor("#f7faf8")

PAGE_W, PAGE_H = A4
LEFT = 18 * mm
RIGHT = 18 * mm
CONTENT = PAGE_W - LEFT - RIGHT


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
        "small": ParagraphStyle("small", fontName="DejaVu", fontSize=9, textColor=MUTED, leading=12, spaceAfter=6),
        "bullet": ParagraphStyle("bullet", **base, leftIndent=2, spaceAfter=2),
        "th": ParagraphStyle("th", fontName="DejaVuBold", fontSize=8.5, textColor=INK, leading=11),
        "td": ParagraphStyle("td", fontName="DejaVu", fontSize=8.5, textColor=INK, leading=11),
        "td_mono": ParagraphStyle("td_mono", fontName="DejaVuMono", fontSize=8, textColor=INK, leading=11),
        "code": ParagraphStyle("code", fontName="DejaVuMono", fontSize=8, textColor=INK, leading=11.5),
        "label": ParagraphStyle("label", fontName="DejaVuBold", fontSize=8, textColor=GREEN, leading=11, spaceBefore=8, spaceAfter=3),
    }


S = styles()


def P(text, style="body"):
    return Paragraph(text, S[style])


def h1(key, title):
    return KeepTogether([Bookmark(key, title, 0), P(title, "h1")])


def h2(title):
    return P(title, "h2")


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
    safe = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>")
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


def grid(headers, rows, widths, mono_first=False):
    head = [Paragraph(cell, S["th"]) for cell in headers]
    body = []
    for row in rows:
        body.append(
            [Paragraph(cell, S["td_mono"] if mono_first and i == 0 else S["td"]) for i, cell in enumerate(row)]
        )
    table = Table([head, *body], colWidths=widths, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), GREEN_SOFT),
        ("FONTNAME", (0, 0), (-1, 0), "DejaVuBold"),
        ("TEXTCOLOR", (0, 0), (-1, -1), INK),
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, GREEN),
        ("LINEBELOW", (0, 1), (-1, -2), 0.3, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]
    for index in range(1, len(body) + 1):
        if index % 2 == 0:
            style.append(("BACKGROUND", (0, index), (-1, index), ROW))
    table.setStyle(TableStyle(style))
    return table


def paint_cover(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(GREEN)
    canvas.rect(0, PAGE_H - 118 * mm, PAGE_W, 118 * mm, fill=1, stroke=0)
    canvas.setFillColor(white)
    canvas.setFont("DejaVuBold", 9)
    canvas.drawString(LEFT, PAGE_H - 28 * mm, "VERSIONE 1")
    canvas.setFont("DejaVuBold", 28)
    canvas.drawString(LEFT, PAGE_H - 48 * mm, "API di piattaforma")
    canvas.setFont("DejaVu", 11)
    text = canvas.beginText(LEFT, PAGE_H - 62 * mm)
    text.setFont("DejaVu", 11)
    text.setFillColor(HexColor("#e7f3ec"))
    text.setLeading(16)
    text.textLine("Come un gestionale, un sito o un altro software legge")
    text.textLine("le aziende, le conversazioni e i messaggi di IA Connect.")
    canvas.drawText(text)
    canvas.setFillColor(INK)
    canvas.setFont("DejaVuBold", 11)
    y = PAGE_H - 142 * mm
    facts = [
        ("Sola lettura", "Tre percorsi GET. L'invio resta nell'Inbox e nei flussi."),
        ("Una chiave per ambito", "Tutti i clienti, oppure una sola azienda."),
        ("Lo stesso storico", "Le righe che il cliente vede nell'Inbox."),
    ]
    for title, body in facts:
        canvas.setFillColor(GREEN)
        canvas.rect(LEFT, y - 1 * mm, 3 * mm, 12 * mm, fill=1, stroke=0)
        canvas.setFillColor(INK)
        canvas.setFont("DejaVuBold", 11)
        canvas.drawString(LEFT + 8 * mm, y + 6 * mm, title)
        canvas.setFillColor(MUTED)
        canvas.setFont("DejaVu", 10)
        canvas.drawString(LEFT + 8 * mm, y - 0.5 * mm, body)
        y -= 22 * mm
    canvas.setFillColor(INK)
    canvas.setFont("DejaVuBold", 12)
    canvas.drawString(LEFT, 78 * mm, "In questo documento")
    canvas.setFont("DejaVu", 10)
    canvas.setFillColor(INK)
    chapters = [
        "1    A cosa serve",
        "2    Indirizzo e chiave",
        "3    Convenzioni",
        "4    Aziende",
        "5    Conversazioni",
        "6    Messaggi",
        "7    Errori",
        "8    Esempio di lettura",
    ]
    line_y = 70 * mm
    for chapter in chapters:
        canvas.drawString(LEFT, line_y, chapter)
        line_y -= 6.2 * mm
    canvas.setFillColor(MUTED)
    canvas.setFont("DejaVu", 8)
    canvas.drawString(LEFT, 14 * mm, "IA Connect  ·  21 novembre 2026  ·  https://iaconnect.pages.dev")
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

    flow.append(h1("scopo", "1. A cosa serve"))
    flow.append(
        P(
            "Questa API è il modo stabile per collegare un'altra piattaforma a IA Connect. Legge lo storico già registrato: le aziende visibili alla chiave, le conversazioni di un'azienda e i messaggi di una conversazione."
        )
    )
    flow.append(
        P(
            "Un cliente è un'azienda. Pititto Assicurazioni è una di queste, con lo stesso contratto delle altre. Non esiste un indirizzo o un campo riservato a un cliente."
        )
    )
    flow.append(h2("Due livelli"))
    flow.append(
        grid(
            ["Livello", "Chi entra", "Cosa vede"],
            [
                ["Admin", "Amministratore della piattaforma", "Tutte le aziende, le chiavi, lo storico di ogni cliente. Area /admin."],
                ["Cliente", "Titolare o collaboratore", "Una sola azienda: Inbox, contatti, flussi e collegamenti. Area /app."],
            ],
            [28 * mm, 52 * mm, CONTENT - 80 * mm],
        )
    )
    flow.append(Spacer(1, 3 * mm))
    flow.append(
        P(
            "L'API non sostituisce l'area cliente. Il cliente continua a lavorare nell'Inbox. L'altra piattaforma usa la chiave per leggere gli stessi dati."
        )
    )
    flow.append(h2("Quattro passi"))
    flow.append(
        bullets(
            [
                "Un amministratore della piattaforma apre <font face='DejaVuMono' size='9'>/admin/api</font>.",
                "Crea una chiave, le dà un nome e sceglie l'ambito: tutti i clienti, oppure una sola azienda.",
                "Copia la chiave intera in quel momento. IA Connect non la mostra una seconda volta.",
                "L'altra piattaforma invia la chiave nell'intestazione <font face='DejaVuMono' size='9'>Authorization</font> e legge i tre percorsi di questa guida.",
            ]
        )
    )

    flow.append(h1("auth", "2. Indirizzo e chiave"))
    flow.append(P("L'indirizzo stabile è quello del sito pubblicato."))
    flow.append(code_block("https://iaconnect.pages.dev"))
    flow.append(Spacer(1, 2 * mm))
    flow.append(
        P(
            "Ogni percorso di questa guida si aggiunge a quell'indirizzo. Il cookie di accesso dell'interfaccia non serve. La chiamata porta solo la chiave."
        )
    )
    flow.append(code_block("Authorization: Bearer iac_…"))
    flow.append(Spacer(1, 2 * mm))
    flow.append(
        P(
            "La chiave ha la forma <font face='DejaVuMono' size='9'>iac_</font> seguito da 64 caratteri esadecimali minuscoli. Un valore più corto, con maiuscole, o senza il prefisso <font face='DejaVuMono' size='9'>iac_</font>, riceve 401 e non viene nemmeno confrontato con l'archivio."
        )
    )
    flow.append(h2("Cosa resta in archivio"))
    flow.append(
        grid(
            ["Dato", "Esempio", "Uso"],
            [
                ["Chiave intera", "iac_ e 64 esadecimali", "Viaggia solo nella chiamata. Si vede una volta, alla creazione."],
                ["Prefisso", "iac_ e 8 esadecimali", "I primi 12 caratteri. Compare nell'elenco admin per riconoscere la chiave."],
                ["Impronta", "SHA-256 esadecimale", "È l'unico segreto conservato. Non si può risalire alla chiave."],
            ],
            [32 * mm, 48 * mm, CONTENT - 80 * mm],
        )
    )
    flow.append(Spacer(1, 3 * mm))
    flow.append(
        P(
            "Revocare una chiave la spegne subito. Una seconda revoca non cambia nulla. Cancellare l'azienda cancella le chiavi di quell'azienda. Creare e revocare scrivono il registro con il nome e il prefisso, mai con la chiave."
        )
    )
    flow.append(h2("Ambito"))
    flow.append(
        grid(
            ["Scelta in /admin/api", "Legge"],
            [
                ["Tutti i clienti", "Ogni azienda. Serve a un sistema vostro, non a un software consegnato a un cliente."],
                ["Una azienda", "Solo quell'azienda. Una richiesta verso un altro id riceve 403."],
            ],
            [48 * mm, CONTENT - 48 * mm],
        )
    )
    flow.append(Spacer(1, 3 * mm))
    flow.append(
        P(
            "Il 403 arriva anche se l'altra azienda non esiste. La risposta non rivela quali aziende ci sono."
        )
    )

    flow.append(h1("convenzioni", "3. Convenzioni"))
    flow.append(
        bullets(
            [
                "Solo <font face='DejaVuMono' size='9'>GET</font>. Un altro metodo, sullo stesso percorso, riceve 405.",
                "La risposta valida è <font face='DejaVuMono' size='9'>{ \"data\": [ ... ] }</font>. L'ordine è dal più recente.",
                "Le date sono istanti ISO 8601 in UTC, per esempio <font face='DejaVuMono' size='9'>2026-11-21T07:30:00.000Z</font>.",
                "La risposta porta <font face='DejaVuMono' size='9'>Cache-Control: no-store</font>.",
                "Un errore è <font face='DejaVuMono' size='9'>{ \"error\": \"codice\" }</font>. Il testo interno del database non esce.",
            ]
        )
    )
    flow.append(h2("Pagine"))
    flow.append(P("Le liste di conversazioni e di messaggi accettano due parametri nella query."))
    flow.append(
        grid(
            ["Parametro", "Se manca", "Regola"],
            [
                ["limit", "50", "Intero da 1 a 100. 0, 101 o un testo ricevono 400."],
                ["before", "nessun filtro", "Istante ISO. Restano le righe con created_at strettamente precedente. Oltre 40 caratteri, o un testo che non è una data, ricevono 400."],
            ],
            [28 * mm, 32 * mm, CONTENT - 60 * mm],
        )
    )
    flow.append(Spacer(1, 3 * mm))
    flow.append(
        P(
            "La pagina successiva usa il <font face='DejaVuMono' size='9'>created_at</font> dell'ultima riga già ricevuta come valore di <font face='DejaVuMono' size='9'>before</font>. Una pagina vuota è la fine dell'elenco."
        )
    )

    flow.append(h1("organizations", "4. Aziende"))
    flow.append(P("GET  /api/v1/organizations", "label"))
    flow.append(P("Elenco delle aziende visibili alla chiave. Una chiave di piattaforma le riceve tutte, in ordine di nome. Una chiave di un cliente riceve solo la propria."))
    flow.append(code_block(
        "curl -s https://iaconnect.pages.dev/api/v1/organizations \\\n"
        '  -H "Authorization: Bearer iac_…"'
    ))
    flow.append(Spacer(1, 2 * mm))
    flow.append(P("Risposta 200", "label"))
    flow.append(code_block(
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
    ))
    flow.append(Spacer(1, 2 * mm))
    flow.append(
        grid(
            ["Campo", "Valori"],
            [
                ["id", "Identificativo dell'azienda. Va usato nei percorsi successivi."],
                ["name", "Nome mostrato in interfaccia."],
                ["sector", "insurance, ecommerce, real_estate oppure other."],
                ["status", "active oppure suspended. Un'azienda sospesa resta leggibile."],
                ["created_at", "Istante di creazione."],
            ],
            [32 * mm, CONTENT - 32 * mm],
        )
    )

    flow.append(CondPageBreak(70 * mm))
    flow.append(h1("conversations", "5. Conversazioni"))
    flow.append(P("GET  /api/v1/organizations/{organizationId}/conversations", "label"))
    flow.append(
        P(
            "Le conversazioni di quell'azienda, dalla più recente. <font face='DejaVuMono' size='9'>{organizationId}</font> è un UUID. Un id che non ha la forma di un UUID rende il percorso sconosciuto e riceve 404."
        )
    )
    flow.append(code_block(
        "curl -s \\\n"
        '  "https://iaconnect.pages.dev/api/v1/organizations/ORGANIZATION_ID/conversations?limit=20" \\\n'
        '  -H "Authorization: Bearer iac_…"'
    ))
    flow.append(Spacer(1, 2 * mm))
    flow.append(P("Risposta 200", "label"))
    flow.append(code_block(
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
    ))
    flow.append(Spacer(1, 2 * mm))
    flow.append(
        grid(
            ["Campo", "Valori"],
            [
                ["id", "Identificativo della conversazione. Serve per leggere i messaggi."],
                ["contact_id", "Identificativo del contatto dentro l'azienda."],
                ["contact_name", "Nome del contatto. Può essere una stringa vuota."],
                ["channel", "whatsapp, mail, sms oppure social."],
                ["status", "open oppure closed."],
                ["last_message_at", "Istante dell'ultimo messaggio, oppure null se non ce n'è ancora uno."],
                ["unread_count", "Messaggi non letti nell'Inbox, intero da zero in su."],
                ["created_at", "Istante di apertura. È il campo usato da before."],
            ],
            [38 * mm, CONTENT - 38 * mm],
        )
    )

    flow.append(CondPageBreak(70 * mm))
    flow.append(h1("messages", "6. Messaggi"))
    flow.append(
        P(
            "GET  /api/v1/organizations/{organizationId}/conversations/{conversationId}/messages",
            "label",
        )
    )
    flow.append(
        P(
            "I messaggi di quella conversazione, dal più recente. La conversazione deve appartenere all'azienda indicata nel percorso. Se la chiave può vedere l'azienda ma la conversazione è di un'altra, la risposta è 404."
        )
    )
    flow.append(code_block(
        "curl -s \\\n"
        '  "https://iaconnect.pages.dev/api/v1/organizations/ORGANIZATION_ID/conversations/CONVERSATION_ID/messages?limit=50" \\\n'
        '  -H "Authorization: Bearer iac_…"'
    ))
    flow.append(Spacer(1, 2 * mm))
    flow.append(P("Risposta 200", "label"))
    flow.append(code_block(
        '{\n'
        '  "data": [\n'
        "    {\n"
        '      "id": "44444444-4444-4444-8444-444444444444",\n'
        '      "direction": "in",\n'
        '      "channel": "whatsapp",\n'
        '      "content": "Buongiorno, vorrei un rinnovo.",\n'
        '      "delivery_status": "received",\n'
        '      "external_id": "wamid.HBgNMzkzMzE...",\n'
        '      "created_at": "2026-11-21T07:12:00.000Z"\n'
        "    }\n"
        "  ]\n"
        "}"
    ))
    flow.append(Spacer(1, 2 * mm))
    flow.append(
        grid(
            ["Campo", "Valori"],
            [
                ["id", "Identificativo del messaggio."],
                ["direction", "in per un messaggio arrivato, out per un messaggio partito da IA Connect."],
                ["channel", "whatsapp, mail, sms oppure social."],
                ["content", "Testo del messaggio. Può essere vuoto."],
                ["delivery_status", "queued, sent, delivered, read, failed, received oppure simulated."],
                ["external_id", "Identificativo del fornitore, oppure null se IA Connect non ne ha uno."],
                ["created_at", "Istante di registrazione. È il campo usato da before."],
            ],
            [36 * mm, CONTENT - 36 * mm],
        )
    )
    flow.append(Spacer(1, 3 * mm))
    flow.append(h2("Quali messaggi compaiono"))
    flow.append(
        bullets(
            [
                "Quelli arrivati dal collegamento, per esempio il webhook di WhatsApp.",
                "Quelli inviati dall'Inbox.",
                "Quelli inviati da un flusso.",
            ]
        )
    )
    flow.append(
        P(
            "Un invio fatto sul pannello del fornitore, fuori da IA Connect, non passa da queste tabelle e non compare qui. Lo stesso storico è visibile al cliente in <font face='DejaVuMono' size='9'>/app/inbox</font> e all'amministratore nella scheda azienda, sezione Conversazioni."
        )
    )

    flow.append(h1("errori", "7. Errori"))
    flow.append(
        grid(
            ["HTTP", "error", "Quando"],
            [
                ["401", "unauthorized", "Chiave assente, malformata, sconosciuta o revocata."],
                ["403", "forbidden", "La chiave è di un'azienda e il percorso ne chiede un'altra."],
                ["404", "not_found", "Percorso sconosciuto, azienda inesistente, o conversazione assente in quell'azienda."],
                ["400", "invalid_query", "limit o before non rispettano le regole del capitolo 3."],
                ["405", "method_not_allowed", "Il metodo non è GET."],
                ["503", "unavailable", "Il server non ha la chiave di servizio con cui legge il database."],
                ["500", "internal", "Errore non previsto. Il corpo contiene solo questo codice."],
            ],
            [18 * mm, 42 * mm, CONTENT - 60 * mm],
        )
    )
    flow.append(Spacer(1, 3 * mm))
    flow.append(code_block('{ "error": "unauthorized" }'))

    flow.append(CondPageBreak(80 * mm))
    flow.append(h1("esempio", "8. Esempio di lettura"))
    flow.append(P("Una chiave di Pititto legge solo Pititto. L'altra piattaforma fa tre chiamate."))
    flow.append(P("1. Chiede le aziende e tiene l'id.", "label"))
    flow.append(code_block(
        "curl -s https://iaconnect.pages.dev/api/v1/organizations \\\n"
        '  -H "Authorization: Bearer iac_…"'
    ))
    flow.append(P("2. Chiede le conversazioni di quell'id, venti alla volta.", "label"))
    flow.append(code_block(
        "curl -s \\\n"
        '  "https://iaconnect.pages.dev/api/v1/organizations/ORGANIZATION_ID/conversations?limit=20" \\\n'
        '  -H "Authorization: Bearer iac_…"'
    ))
    flow.append(
        P(
            "Se la risposta contiene 20 righe, la chiamata successiva aggiunge <font face='DejaVuMono' size='9'>before</font> con il <font face='DejaVuMono' size='9'>created_at</font> dell'ultima. Si ripete finché <font face='DejaVuMono' size='9'>data</font> è vuoto."
        )
    )
    flow.append(P("3. Per ogni conversazione chiede i messaggi, allo stesso modo.", "label"))
    flow.append(code_block(
        "curl -s \\\n"
        '  "https://iaconnect.pages.dev/api/v1/organizations/ORGANIZATION_ID/conversations/CONVERSATION_ID/messages?before=2026-11-21T07:12:00.000Z" \\\n'
        '  -H "Authorization: Bearer iac_…"'
    ))
    flow.append(Spacer(1, 2 * mm))
    flow.append(h2("Invio"))
    flow.append(
        P(
            "Questa versione non ha un percorso di invio. Un messaggio in uscita si scrive dall'Inbox o da un flusso: lì IA Connect controlla il consenso del contatto, la finestra del canale e la quota dell'azienda. Un'altra piattaforma che deve far partire un messaggio lo fa fare a una persona nell'Inbox, oppure a un flusso già attivo."
        )
    )
    flow.append(h2("Versione"))
    flow.append(
        P(
            "Questo documento descrive la versione 1, pubblicata il 21 novembre 2026. I percorsi restano sotto <font face='DejaVuMono' size='9'>/api/v1</font>. Una versione successiva avrà un prefisso nuovo e non cambierà il significato dei campi di questa."
        )
    )
    return flow


def main():
    root = Path(__file__).resolve().parents[1]
    target = root / "docs" / "api" / "ia-connect-api-v1.pdf"
    target.parent.mkdir(parents=True, exist_ok=True)

    doc = BaseDocTemplate(
        str(target),
        pagesize=A4,
        title="IA Connect — API di piattaforma, versione 1",
        author="IA Connect",
        subject="Lettura di aziende, conversazioni e messaggi per le piattaforme collegate.",
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
    print(target)


if __name__ == "__main__":
    main()

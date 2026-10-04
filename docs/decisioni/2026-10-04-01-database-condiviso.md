# Database: schema `ia_connect` nel progetto Supabase "alter ego"

Data: 2026-10-04 · Stato: decisa da Paolo

**Decisione.** IA Connect usa lo schema `ia_connect` dentro il progetto Supabase esistente "alter ego" (`ywsolxklcyctrezngclz`, regione eu-west-1), senza creare un progetto dedicato.

**Motivo.** Nessun costo aggiuntivo in questa fase.

**Conseguenze.**
- Gli utenti (Supabase Auth) sono condivisi con alter ego.
- Lo schema va aggiunto agli *Exposed schemas* nelle impostazioni API del progetto perché web ed edge functions possano leggerlo.
- Non attiviamo estensioni a livello di progetto senza consenso (vedi decisione 03).
- Prima dei clienti veri conviene passare a un progetto dedicato: le migrazioni sono già autonome e ripetibili.

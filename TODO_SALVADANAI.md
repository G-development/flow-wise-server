# To-do: salvadanai e spese annuali

Contesto e motivazioni in `PLAN_SALVADANAI.md`. Si spunta una voce solo quando è fatta **e verificata**.
Una voce di una fase si apre solo dopo che la fase precedente è chiusa.

## Fase 0 — Decisioni e verifiche

Decisioni (di Gio):

- [x] D1. Trasferimenti come **nuovo tipo `"T"`** (una transazione con wallet di origine e di destinazione) — deciso il 9/11
- [x] D2. Salvadanai nell'app: **Emergenze, Savings, Annuali** (salvadanai ISP). Trade Republic è un conto a sé, non un salvadanaio — deciso il 9/11
- [x] D3. Trade Republic **a mano** per ora (GoCardless non lo supporta) — deciso il 9/11. Integrazione futura: vedi "Fuori piano"
- [x] D4. Data di taglio: **1° dicembre 2026**, saldi letti dall'app Intesa quel giorno — deciso il 9/11
- [x] D5. La quota di Annuali la decide Gio; l'app **consiglia** quanto versare in base a scadenze future e saldo reale (che sconta i prelievi non previsti), senza muovere soldi — deciso il 9/11
- [x] D6. Il condominio **va nel piano Annuali**; importo e numero di rate cambiano di anno in anno (6, 8…) — deciso il 9/11
- [x] D7. Ogni salvadanaio ha un **tetto massimo** (Emergenze: 1.000 €) — deciso il 9/11
- [x] D7b. Tetti: **Savings 1.000 €**; **Annuali = somma delle spese annuali del piano** (tetto calcolato, non fisso) — deciso il 9/11. Da definire in fase 3: anno solare o prossimi 12 mesi
- [x] D8. La vecchia categoria "Annuali" (id 11) e le sue 31 transazioni **si eliminano**; lo storico, se servirà, si ricarica con una bonifica — deciso il 9/11

Verifiche:

- [x] V1. **No**: la requisition Intesa (stato `LN`) espone **un solo conto**, quello principale (IBAN IT96…3032), lo stesso già salvato in `bank_connections`. I salvadanai non sono conti separati per GoCardless; i loro saldi li tiene l'app — verificato il 9/11. Resta un controllo a costo zero: al ricollegamento (entro il 6/1/2027) guardare se la schermata di consenso Intesa propone altri conti
- [ ] V1b. Nota a margine: `handleGoCardlessCallback` usa solo `accounts[0]`. Oggi va bene (c'è un solo conto); diventerebbe un problema solo se una requisition ne avesse più di uno
- [ ] V2. Saldi reali dei salvadanai alla data di taglio, letti dall'app Intesa
- [x] V3. I bonifici "a favore di Giovanni Cuozzo" vanno a **Trade Republic**: diventano `T` conto ISP → Trade Republic — confermato il 9/11
- [x] V4. I movimenti con Michele, Eduard, Akissi sono **pagamenti tra amici** (bar, uscite, cene) — confermato il 9/11. Non sono giroconti: escono da "Giroconto" e diventano spese e rimborsi (fase 5)
- [x] V4b. Confermato il 9/11: oggi luce, gas e Iliad li paga Michele e Gio gli manda la sua parte; il condominio lo paga Gio e i coinquilini gli rimandano la loro. **Vincolo di Gio: nessuna associazione persona → significato nel codice** (vedi principio in `PLAN_SALVADANAI.md`)

Pulizia (dopo D8):

- [ ] Elenco delle 31 transazioni della categoria "Annuali" (id 11) mostrato a Gio; eliminazione di transazioni e categoria **solo dopo il suo ok su quell'elenco** (non reversibile)

## Fase 1 — Trasferimenti fuori dalle statistiche

- [ ] Censire ogni punto (server e client) che assume `type ∈ {I, E}`: elenco con file e riga, scritto qui
- [ ] Progettare il tipo `T`: colonne (wallet di destinazione), vincoli, categoria sì/no, e scriverlo qui prima di implementare
- [ ] Migrazione `011` + `.down.sql`, provata su una copia
- [ ] Server: saldo dei wallet, Zod, route, import CSV e bancario gestiscono `T`; test
- [ ] Client: inserimento e modifica di una `T`; i widget la ignorano; test
- [ ] Convertire in `T` i movimenti interni oggi in "Giroconto": salvadanai (conto ↔ salvadanaio, dal 1/12) e bonifici a Giovanni Cuozzo (conto ↔ Trade Republic). Elenco mostrato a Gio prima di modificare
- [ ] Spostare i movimenti verso e da persone, oggi in "Giroconto", in una categoria provvisoria "Persone — da classificare" in attesa della fase 5; elenco mostrato a Gio prima
- [ ] Le regole costruite solo sul nome di una persona (`verso michele scaldarella`, `da eduard echimov`…) smettono di categorizzare in automatico: rimangono, ma come suggerimento da confermare
- [ ] Decidere cosa resta della categoria "Giroconto" quando è vuota
- [ ] Controllo: i totali di agosto–ottobre nell'app, senza trasferimenti, confrontati con "Over year" dell'Excel. Le differenze vanno spiegate una per una

## Fase 2 — Salvadanai

- [ ] Progettare `Wallet.kind` (`account` | `pot`) e la modifica al trigger del limite (migrazione `004`)
- [ ] Migrazione + `.down.sql` + test degli invarianti (limite sui soli conti, salvadanaio mai default)
- [ ] Un salvadanaio appartiene a un conto (`parent_wallet_id`): una `T` conto ↔ salvadanaio ammessa solo tra un salvadanaio e il suo conto? Decidere e testare
- [ ] Svuotare le transazioni di prova del wallet Trade Republic (id 11): elenco da approvare prima di cancellare
- [ ] Creare i salvadanai con i saldi di apertura di V2
- [ ] Import: per un movimento "MOVIM. SALVADANAIO" senza abbinamento, l'app chiede a quale salvadanaio va
- [ ] UI per creare un giroconto a mano (conto ↔ salvadanaio)
- [ ] Riconciliazione: saldi dei salvadanai nell'app = saldi dell'app Intesa alla stessa data

## Fase 3 — Piano Annuali

- [ ] Progettare voci e **rate esplicite** (data, importo previsto, importo effettivo) invece di una regola di ricorrenza, perché il condominio cambia importo e numero di rate ogni anno; scriverlo qui
- [ ] "Copia sull'anno successivo": le rate di una voce si duplicano sull'anno dopo e poi si correggono
- [ ] Inserire le voci dall'Excel (assicurazione, bollo, università, TaRi, Spotify, AdE, condominio) e ricontrollarle con Gio
- [ ] Quota consigliata con l'algoritmo del piano (saldo reale, scadenze a 12 mesi); test con casi scritti a mano
- [ ] Tetto del salvadanaio: il consiglio non supera il tetto; avviso se un versamento lo supera
- [ ] Proiezione del fondo a 12 mesi, con avviso dove va sotto zero
- [ ] Segnare una scadenza come pagata collegandola a una transazione (prima a mano)

## Fase 4 — In parallelo con l'Excel

- [ ] Novembre e dicembre 2026 tenuti sia nell'Excel sia nell'app
- [ ] A fine mese: saldi dei salvadanai, spese annuali pagate e totali coincidono, oppure la differenza è spiegata
- [ ] Decidere se l'Excel si può dismettere

## Fase 5 — Rimborsi e spese condivise (da progettare)

- [ ] Progettare i due casi generici del principio "persone" (in `PLAN_SALVADANAI.md`) e scriverli qui prima di implementare:
  - pago io la quota di una spesa anticipata da altri → spesa normale, categoria scelta sul movimento
  - anticipo io e gli altri mi rimborsano → rimborso collegato alla spesa, che diventa netta (oggi nell'Excel: "98,5 − 53,5 Cene", condominio diviso per tre)
- [ ] Le regole possono usare il testo libero del bonifico ("Condominio settembre", "Tari agosto"), che vince su un nome di persona
- [ ] Nessuna voce operativa finché il modello non è deciso

## Fuori piano — da valutare dopo

- [ ] Enable Banking come provider per Trade Republic (piano gratuito "restricted production", solo conti propri). A novembre 2026 l'integrazione TR risulta recente e con problemi segnalati (consenso massimo 90 giorni, movimenti duplicati, limiti di richieste). PSD2 copre il conto di liquidità, **non il valore del portafoglio**. Da verificare sulla documentazione ufficiale prima di qualsiasi lavoro

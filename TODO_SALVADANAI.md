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

- [x] Censire ogni punto (server e client) che assume `type ∈ {I, E}` — fatto il 9/11, elenco sotto

### Censimento `type` (9/11, branch `main` di entrambi i repo)

**Database (letto dallo schema live via PostgREST, sola lettura)**

- `Transaction.type` e `Category.type` sono già un enum Postgres `"I / E / T"`: **il valore `T` è
  ammesso dal database da sempre**. Righe di tipo `T` oggi: 0 transazioni, 0 categorie.
- Manca la colonna del wallet di destinazione: `Transaction` ha solo `wallet_id`.
- `category_rules.type` ha un `CHECK (type IN ('I','E'))` (migrazione 010).
- `Transaction.amount` è `double precision` (non riguarda `T`, da tenere presente).

**Rischio principale: oggi tutto ciò che non è `"I"` viene trattato come spesa.** Una riga `T`
inserita prima di aggiornare il codice scalerebbe il saldo del wallet di origine e non toccherebbe
quello di destinazione, senza errori. Quindi: **prima il codice, poi i dati**.

**Server — calcolo del saldo e importi**

- `utils/amount.js:45` `signedAmountCents`: `type === "I" ? + : −` → `T` diventa spesa
- `utils/walletService.js:121-133` saldo dei wallet: legge solo `wallet_id`, usa `signedAmountCents`
- `migrations/003_wallet_opening_balance.sql:43` stesso `CASE` (solo storico, già applicata)
- `backfill-opening-balance.mjs:61` stesso schema (script una tantum)

**Server — validazione e route**

- `utils/schemas.js:17,26,31` Zod: `type: z.enum(["I","E"])` per transazioni e categorie
- `routes/transaction.js:61,91` create/update: nessun campo per la destinazione
- `routes/expense.js:24` e `routes/income.js:24` filtrano `E` / `I`: una `T` resta fuori **già oggi** (comportamento voluto)
- `routes/agents.js:47` solo `E`: idem
- `routes/wallet.js:205-211` guardia di eliminazione: conta solo `wallet_id`; con `T` va contata anche la destinazione
- `routes/import.js:262` CSV: accetta solo `I`/`E` (da decidere se il CSV supporta `T`)
- `routes/user.js:85` categorie base alla registrazione: solo `I`/`E` (va bene)

**Server — banca e regole**

- `utils/bankAutoImport.js:54` `bankTransactionType`: segno → `I`/`E`
- `utils/bankAutoImport.js:47` categoria di ripiego per tipo `I`/`E`
- `utils/bankService.js:1196` `buildAppTransactionFromBank`: stesso schema (import manuale)
- `utils/categoryRules.js:97,135,185,194` le regole combaciano per `type` e richiedono categoria dello stesso tipo
- `migrations/010_category_rules.sql:24` `CHECK` su `I`/`E`

**Client**

- `lib/amount.ts:33` `signedAmount`: `type === "I" ? + : −` → stesso rischio del server
- `lib/amount.ts:47-52` `totalForType`: filtra per tipo (una `T` resta fuori)
- `lib/hooks/useQueries.ts:54,122` tipi TypeScript `"I" | "E"`
- `components/new-transaction.tsx:35,90,168-180` scelta Income/Expense, categorie filtrate per tipo
- `components/edit-dialog.tsx:52,90,148` stesso schema, `|| "E"` di ripiego
- `components/category-dialog.tsx:47,131,139-140` categorie solo Income/Expense
- `components/movements-list.tsx:114-120` colore del badge dal tipo della categoria
- `app/category/page.tsx:152` raggruppa per `I`
- `app/settings/import/page.tsx:116` CSV solo `I`/`E`
- `app/settings/yourbank/ImportTransactionDialog.tsx:163,184,299,400-403` import manuale per tipo
- `lib/bankCategorySuggestion.ts:4,8,44,52,95` suggerimento categoria per tipo `I`/`E`
- Widget (`income-vs-expenses`, `period-expenses`, `period-incomes`): leggono da `/income` e `/expense`, quindi ignorano `T` senza modifiche

**Domande di progetto aperte dal censimento — chiuse il 9/11**

1. Una `T` ha **una sola categoria di sistema "Trasferimento"** (tipo `T`), creata dall'app e non eliminabile.
2. Un movimento bancario riconosciuto come trasferimento entra come **`T` con il lato mancante "da assegnare"**; il salvadanaio lo sceglie Gio dopo.
3. Il CSV **non** supporta `T`, per ora.

Altri fatti dallo schema live: `Transaction` ha come colonne obbligatorie solo `id` e `date`, quindi
`wallet_id` è già nullable nel database (l'obbligo oggi sta solo in Zod).

- [x] Progettare il tipo `T` — proposta scritta il 9/11, sotto. **Da approvare da Gio prima di implementare**

### Progetto del tipo `T` (proposta)

**Significato.** Una `T` sposta `amount` (sempre ≥ 0) da `wallet_id` (origine) a `to_wallet_id`
(destinazione). Non è né entrata né spesa.

**"Da assegnare".** Dalla banca conosciamo sempre il lato del conto, ma non l'altro, e il lato
mancante può essere l'origine o la destinazione:

- "Accantonamento somma sul Salvadanaio" (−100 sul conto): origine = conto, destinazione = ?
- "Riunione somme dal salvadanaio" (+100 sul conto): origine = ?, destinazione = conto

Quindi una `T` può avere **uno solo dei due lati vuoto**, mai entrambi. "Da assegnare" = una `T`
con un lato vuoto. Il saldo conta solo i lati presenti: il conto è giusto da subito, il salvadanaio
si aggiorna quando assegni.

**Database (migrazione `011`, solo aggiunte):**

- `Transaction.to_wallet_id integer NULL REFERENCES "Wallet"(id)`, senza `ON DELETE`, come `wallet_id`
- `CHECK`: se `type` è `I` o `E` → `wallet_id NOT NULL` e `to_wallet_id IS NULL`
- `CHECK`: se `type = 'T'` → almeno uno dei due lati presente e, se ci sono tutti e due, diversi
- indice su `to_wallet_id`
- categoria "Trasferimento" di tipo `T` per ogni utente esistente (da creare anche alla registrazione,
  in `routes/user.js`)
- `.down.sql`: rimuove vincoli, indice e colonna; fallisce se esistono righe `T` (non le cancella in silenzio)

La migrazione è innocua per il codice attuale: nessuna riga `T` esiste e il codice di oggi non legge
la colonna nuova.

**Saldo** (`utils/walletService.js`, `utils/amount.js`, `lib/amount.ts`): `I` +, `E` −,
`T` − sull'origine e + sulla destinazione. `signedAmountCents` smette di trattare "tutto ciò che
non è `I`" come spesa: un tipo sconosciuto diventa un errore, non una spesa silenziosa.

**Regole e import bancario (resta valido il principio "le persone non hanno un significato fisso"):**

- nessun "salvadanaio" scritto nel codice: una regola che punta alla categoria "Trasferimento"
  trasforma il movimento in `T`; il segno dice quale lato è il conto
- la regola `salvadanaio` di oggi (→ Giroconto) diventa `salvadanaio` → Trasferimento
- estensione facoltativa, da decidere dopo: una regola può indicare anche il wallet dell'altro lato
  (es. "verso giovanni cuozzo" → Trasferimento verso Trade Republic). Per i salvadanai no, perché
  dal movimento non si capisce quale

**Ordine di lavoro** (ogni passo con i suoi test, e nessun dato `T` prima dei passi 1–3):

1. migrazione `011` provata su una copia, poi applicata
2. server: saldo, Zod, route delle transazioni, guardia di eliminazione dei wallet, categoria di sistema protetta
3. client: tipi, saldo, creazione e modifica di una `T`, badge nella lista, elenco "da assegnare"
4. banca: regole verso la categoria Trasferimento producono `T`; endpoint per assegnare il lato mancante
5. dati: conversione dei movimenti oggi in "Giroconto" (elenco mostrato a Gio prima)
- [x] Migrazione `011_transfer_type.sql` + `.down.sql` scritte e provate su una copia — 9/11.
  Copia: Postgres 18.3 locale con lo schema ricostruito da quello live e i dati veri di `Wallet` (5),
  `Category` (47), `Transaction` (1.611), 4 utenti. Esito:
  - up applicata due volte di fila (idempotente); 4 categorie "Trasferimento", una per utente
  - rifiutate: `E` senza wallet, `I` con destinazione, `T` senza lati, `T` con lo stesso wallet sui
    due lati, `T` verso un wallet inesistente, seconda categoria `T` per lo stesso utente,
    eliminazione di un wallet usato come destinazione
  - accettate: `T` completa, `T` senza destinazione, `T` senza origine
  - down bloccata con una `T` presente; senza `T` riporta lo schema com'era (1.611 transazioni
    intatte); up di nuovo dopo down: ok
  - Limite della prova: lo schema locale è ricostruito, non un dump. Non contiene trigger, policy
    RLS e vincoli del live che PostgREST non espone
- [x] `011` applicata sul database live da Gio (SQL editor, "Success. No rows returned") — 9/11.
  Verificato in sola lettura: colonna `to_wallet_id` presente, 4 categorie "Trasferimento" attive
  (una per ciascuno dei 4 utenti), transazioni intatte (223 `I` + 1.388 `E` = 1.611), nessuna `T`.
  Fino alla pubblicazione del codice nuovo l'app attuale mostra "Trasferimento" tra le categorie e
  ne permette l'eliminazione: non eliminarla (rieseguire la `011` la ricreerebbe)
- [x] Server (passo 2) — 9/11, branch `plan/salvadanai-annuali`, non pubblicato:
  - `utils/amount.js`: `walletDeltasCents` (T − origine, + destinazione, lato vuoto ignorato);
    `signedAmountCents` lancia per ogni tipo diverso da `I`/`E`
  - `utils/walletService.js`: il saldo legge `to_wallet_id` e usa `walletDeltasCents`
  - `utils/schemas.js`: Zod per tipo (`I`/`E` con wallet e senza destinazione; `T` con almeno un lato e lati diversi)
  - `routes/transaction.js`: una T usa la categoria `T` dell'utente e wallet dell'utente; un'entrata o una spesa non può usare la categoria `T`
  - `routes/wallet.js`: un wallet usato come destinazione è "in uso"
  - `routes/category.js`: la categoria `T` si rinomina e basta (409 `SYSTEM_CATEGORY` per elimina, disattiva, cambia tipo)
  - `routes/user.js`: la registrazione crea anche "Trasferimento"
  - test: 230/230 (24 nuovi in `routes/transfer.test.js`, `utils/amount.test.js`, `utils/walletService.test.js`, `utils/schemas.test.js`); due test esistenti aggiornati perché ora la guardia fa una query in più
  - **Ordine di rilascio:** questo server legge e scrive `to_wallet_id`, quindi va pubblicato **dopo** aver applicato la `011`
- [ ] Import CSV: resta `I`/`E` (deciso)
- [x] Import bancario → `T` (passo 4) — progetto approvato e implementato il 9/11, branch `plan/salvadanai-annuali`, non pubblicato:
  - `categorizeWithRules` accetta la categoria `T` per entrambi i segni; `learnRuleFromCorrection` impara "Trasferimento" col tipo del segno e senza wallet
  - `buildAppTransactionFromBank` con `categoryType: "T"` produce una `T` da assegnare (conto = origine se uscita, destinazione se entrata); usato da import automatico e manuale
  - client: nella finestra di import manuale si può scegliere "Trasferimento" per qualsiasi movimento
  - test: server 234/234 (4 nuovi), client `tsc` + lint
  - **Effetto solo dopo l'aggiornamento delle 4 regole** (sotto) e la pubblicazione del server
- [x] Regole aggiornate il 9/11, dopo il deploy del server: `salvadanaio` (E 51→54, I 52→54),
  `verso giovanni cuozzo` (51→54), `da giovanni cuozzo` (52→54), `revolut dublin` (51→54).
  Su Giroconto restano solo le 7 regole sulle persone (passo 5)
- [ ] Controllare il primo import automatico dopo il deploy (job delle 06:00): accantonamenti e riunioni somme devono entrare come `T` da assegnare
- [ ] Creare il wallet "Revolut" (conto) — D-R1

### Progetto del passo 4: import bancario dei trasferimenti (proposta, 9/11)

**Fatti verificati (database live, sola lettura, 9/11)**

- 12 regole puntano oggi a "Giroconto" (51 `E`, 52 `I`), tutte `manual`:
  `salvadanaio` (E e I), `verso giovanni cuozzo`, `da giovanni cuozzo`, `revolut dublin`,
  `verso/da michele scaldarella`, `verso/da eduard echimov`, `da akissi sarah`,
  `da antonio costanzo`, `da paypal`
- **C'è anche Revolut**: connessione GoCardless `REVOLUT_REVOLT21`, senza import automatico
  (`import_wallet_id` vuoto). I movimenti tra Intesa e Revolut finiscono in Giroconto:
  - Intesa → Revolut: pagamenti POS "PRESSO Revolut**8371* Dublin" (100, 100, 30, 50 a settembre), regola `revolut dublin`
  - Revolut → Intesa: "Inviato da Revolut … MITT.: Giovanni Cuozzo" (13,10 il 29/08, 8,80 il 24/09), regola `da giovanni cuozzo`
- Uscite "a favore di: Giovanni Cuozzo" (regola `verso giovanni cuozzo`): 150 il 31/07, 30/09 e
  30/10; 100 il 31/08; 2,36 il 26/09 (rientrati 2,36 lo stesso giorno); 80 il 25/10. Per V3 vanno a Trade Republic
- Il nome "Giovanni Cuozzo" compare anche come beneficiario nei bonifici ricevuti dagli amici e
  dentro descrizioni non correlate (es. assicurazione "Barba guido Giovanni Cuozzo"): le regole
  attuali lavorano sul mittente/destinatario estratto (`extractMerchantKey`), non sul testo intero, quindi non li confondono
- Codice: l'import automatico (`utils/bankAutoImport.js`) e quello manuale (`importBankTransactionsToApp`)
  usano lo stesso `buildAppTransactionFromBank`, che produce solo `I`/`E`. `categorizeWithRules`
  accetta una regola solo se la categoria ha lo stesso tipo del movimento, quindi oggi una regola
  verso "Trasferimento" verrebbe scartata

**Proposta**

1. **Una regola verso la categoria "Trasferimento" produce una `T`.** Il segno dice qual è il conto:
   uscita → `wallet_id` = wallet dell'import, `to_wallet_id` = altro lato; entrata → il contrario.
   `categorizeWithRules` accetta la categoria `T` per qualsiasi segno. Nessun testo ("salvadanaio",
   un nome) scritto nel codice: decide la regola, che è un dato modificabile
2. **L'altro lato può essere indicato sulla regola** (nuova colonna facoltativa
   `category_rules.counterpart_wallet_id`, migrazione `012`): es. `verso giovanni cuozzo` → Trade
   Republic. Se manca, la `T` entra "da assegnare". Per `salvadanaio` resta vuoto, perché dal
   movimento non si capisce quale salvadanaio
3. **Le regole imparate dalle correzioni** imparano la categoria "Trasferimento" ma **mai il wallet**:
   altrimenti assegnare un accantonamento a "Emergenze" farebbe finire lì anche tutti i successivi
4. **Import manuale** (finestra "Import" della pagina banca): tra le categorie compare anche
   "Trasferimento"; un movimento importato così entra come `T` da assegnare
5. **Aggiornamento delle regole esistenti** (scrittura sul database, elenco approvato da Gio prima):
   `salvadanaio` (E e I) → Trasferimento, senza wallet; `verso giovanni cuozzo` → Trasferimento verso
   Trade Republic; `revolut dublin` e `da giovanni cuozzo` dipendono da D-R1. Le regole sulle persone
   restano su Giroconto fino al passo 5
6. **Dal giorno della pubblicazione** il job giornaliero importa accantonamenti e riunioni somme come
   `T` da assegnare; finché i salvadanai (fase 2) non esistono restano in /transfers "da assegnare",
   ma il saldo del conto è già giusto e non gonfiano più entrate e spese
7. Test: `categorizeWithRules` con categoria `T`; `buildAppTransactionFromBank` per entrata/uscita
   con e senza wallet sulla regola; import automatico end-to-end; apprendimento senza wallet;
   import manuale con categoria `T`

**Decisioni di Gio**

- [x] D-R1. Revolut diventa un **wallet "conto"** (con Intesa e Trade Republic fa 3, il limite) e i
  movimenti Intesa ↔ Revolut diventano `T` — deciso da Gio il 9/11. Conseguenza: senza import dei
  movimenti Revolut (D-R3) il saldo del wallet Revolut conterebbe solo le ricariche e i rientri, non
  le spese fatte con Revolut, e si allontanerebbe da quello reale
- [x] D-R2. Le uscite "a favore di Giovanni Cuozzo" entrano **da assegnare**: la destinazione la
  sceglie Gio ogni volta — deciso il 9/11
- [x] D-R3. L'import dei movimenti Revolut è un **passo a parte**, da progettare subito dopo il passo 4 — deciso il 9/11

**Conseguenza di D-R2 sulla proposta (punto 2):** con `verso giovanni cuozzo` da assegnare, l'unica
regola con un wallet certo sarebbe `revolut dublin` (le ricariche "PRESSO Revolut Dublin" vanno solo a
Revolut). Una colonna e una migrazione per una regola sola non valgono la complessità adesso: proposta
rivista, **niente `counterpart_wallet_id` per ora**, tutte le `T` dalla banca entrano da assegnare.
Si aggiunge dopo, se l'assegnazione a mano delle ricariche Revolut diventa una seccatura.
Regole da aggiornare (punto 5): `salvadanaio` (E e I), `verso giovanni cuozzo`, `da giovanni cuozzo`,
`revolut dublin` → Trasferimento.
- [ ] Anomalie trovate nei dati live (9/11), da sistemare a parte: 24 transazioni con una categoria di tipo diverso dal loro, 1 con la categoria di un altro utente. Per non bloccarne la modifica, i controlli nuovi valgono solo per le T
- [x] Client (passo 3) — 9/11, branch `plan/salvadanai-annuali` di `flow-wise-client`, non pubblicato:
  - "Add transaction" ha una terza scelta **Transfer**: wallet "From" e "To", categoria di sistema scelta da sola
  - nuova pagina **/transfers** (voce "Transfers" nel menu): in alto i trasferimenti **da assegnare**, ognuno con la scelta del wallet mancante e "Assegna"; sotto l'elenco completo con eliminazione
  - pagina Categorie: "Trasferimento" con badge "Transfer", interruttore disattivato e nessuna azione
  - `lib/transfer.ts` (lato mancante, corpo del PUT di assegnazione) con test; `signedAmount` rifiuta i tipi sconosciuti come nel server
  - widget, liste Incomes/Expenses e import bancario manuale non cambiano: leggono `/income` e `/expense` o filtrano per `I`/`E`, quindi ignorano le `T`
  - verificato: `npm test` (30/30 test, `tsc`, `next build` con la route `/transfers`). **Non verificato nell'app vera**: serve la `011` applicata e il server nuovo in esecuzione
  - Modifica completa di una `T` già assegnata (importo, data): per ora si elimina e si ricrea
- [x] Prova nell'app vera — 9/11, server e client dei branch in locale (porte 5030 e 3000) sul database live, login di Gio:
  - creata da "Add Transfer" la `T` "TEST trasferimento", 1 €, GC Default wallet → Trade Republic:
    saldi da 4.000,00 / −1.248,92 a 4.001,00 / −1.249,92; nel database riga 1880 `type T`,
    `wallet_id 1`, `to_wallet_id 11`, categoria "Trasferimento" (54); nessuna spesa con quella descrizione
  - eliminata da /transfers: lista vuota, saldi di nuovo 4.000,00 / −1.248,92
  - pagina Categorie: "Trasferimento" con badge "Transfer", interruttore bloccato, "Gestita dall'app"
  - **non provato nell'app vera:** l'assegnazione di un trasferimento "da assegnare" (dall'app non se ne crea uno; arriverà dall'import bancario al passo 4). È coperta dai test end-to-end del server
- [x] Difetti di layout visti nella prova, corretti il 9/11 e verificati nel browser a 375 px, ~800 px e 1280 px:
  barra di navigazione in basso a 5 colonne (prima era fissa a 4 e "Wallet" andava a capo); selettore
  Income/Expense/Transfer su una riga sua, griglia a 3 colonne, icone nascoste sotto i 640 px (prima
  "Transfer" usciva dal riquadro, poi le etichette venivano tagliate)
- [x] Branch `plan/salvadanai-annuali` pushati da Gio su GitHub (server e client) — 9/11, con `pre-push` verde
  (server 230/230 + `node --check`; client 30/30 + `tsc` + `next build`). Non ancora su `main`, quindi non pubblicati
- [x] Server su `main` e in produzione — 9/11: push di Gio `3c42005..4748414`, deploy Vercel Production riuscito,
  `flow-wise-server.vercel.app` risponde (`/healthz` 204) e serve la pagina API nuova
- [ ] Client su `main` e in produzione
- [ ] Da capire a parte (non legato alle `T`): il saldo di GC Default wallet nell'app è −1.248,92 € con apertura 13.264,23 €; va confrontato con il saldo reale del conto
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

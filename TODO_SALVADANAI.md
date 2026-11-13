# To-do: salvadanai e spese annuali

Contesto e motivazioni in `PLAN_SALVADANAI.md`. Si spunta una voce solo quando è fatta **e verificata**.
Una voce di una fase si apre solo dopo che la fase precedente è chiusa.

## Richieste di Gio dell'11/11/2026 (sera)

- [x] Barbiere: resta in "Altro", la categoria "Barber" resta disattivata (decisione di Gio)
- [x] I 16 movimenti ancora in "Persone — da classificare": Gio non ricorda cosa siano, restano lì
- [x] Fase 5 nel browser, sul live (11/11 notte, nessun dato scritto): Movements con filtro Expense mostra i rimborsi con
  il badge dopo la categoria; Dashboard con spese nette (Bollette di novembre sparisce perché i rimborsi superano le
  spese), entrate senza rimborsi, Total Balance 6761,23 € con ISP dalla banca (104,08 €, "app says 24,72 €"); pannello
  New con la casella Refund che propone le categorie di spesa; Edit della rata con la casella Paid. Trovata e
  corretta l'ultima parola italiana ("Bilancio" → "Balance"). La 2ª rata dell'assicurazione l'aveva tolta Gio (era sbagliata)
- [x] Sync e import manuale dalla banca (workflow lanciato a mano alle 20:59 UTC): 271 movimenti sincronizzati,
  2 importati con le regole
- [x] **ISP non torna con la banca** (chiuso: non è un errore, sono movimenti in sospeso). App 24,72 €, banca 104,08 € alle 20:59 (195,58 € alle 12:19, senza movimenti
  contabilizzati in mezzo). I movimenti da ottobre coincidono uno per uno: la differenza viene dall'allineamento del
  9/11 (122,37 € letti quel giorno). Il saldo GoCardless si muove prima della lista dei movimenti, quindi si
  riallinea l'apertura di ISP **sul saldo che Gio legge nell'app Intesa**, dopo il suo ok
  - 11/11 sera: Gio legge nell'app Intesa **104,08 €**. Ho riallineato l'apertura a 1.219,88 € e **Gio l'ha corretto:
    era sbagliato**. La differenza sono movimenti **non ancora contabilizzati** che si vedono nell'app Intesa e nel
    saldo della banca, mentre Flow-Wise importa solo i contabilizzati (e GoCardless per Intesa non restituisce i
    movimenti in sospeso: 0 nel sync). Quando arriveranno, il saldo dell'app si allinea da solo; un'apertura
    corretta a mano li conterebbe due volte. **Apertura ripristinata a 1.140,52 €** (ISP nell'app 24,72 €).
    Il saldo vero lo mostra già il Total Balance (saldo della banca). Regola: **mai correggere l'apertura per
    inseguire il saldo della banca**; si confronta solo quando non ci sono movimenti in sospeso
- [x] Badge "Refund" dopo il nome della categoria (client `660eb0c`)
- [x] Total Balance: per i conti collegati il saldo letto dalla banca, con l'ora e "app says …" se diverso
  (client `607c3b3`, `lib/balanceBreakdown.ts` + test)
- [x] Piano annuale: "Paid" da Edit anche senza movimento (migrazione `015`, server `267283e`, client `212de92`).
  **La `015` va applicata sul live prima del push del server**
- [x] Tutta l'app in inglese, compresi landing, changelog (nuova voce di novembre), Privacy e Terms (versione
  dell'11/11), e i messaggi d'errore del server. Multilingua rimandato (decisione di Gio): i testi restano nel codice
- [x] Barra in basso mobile: aggiunto **Your Bank** come ultima voce, dopo Annual plan (5 voci, verificato a 375 px)
- [ ] Idea proposta e messa da parte da Gio: in Your Bank una riga "saldo banca / contabilizzato in Flow-Wise /
  differenza non ancora contabilizzata", con avviso se la differenza resta uguale per alcuni giorni
- [ ] Inserimento manuale del rimborso: resta la casella "Refund" nel pannello di un'entrata (Gio: per ora così)
- [x] 11/11 rilascio: `015` applicata (17 rate, nessuna pagata a mano), server `5442728` e client `1a82fd2` online
  (landing in inglese con la nuova voce del changelog, Privacy in inglese). Nel piano manca la 2ª rata dell'assicurazione
  (3/10/2027): probabilmente eliminata da Gio dall'app, da confermare

## Cosa resta aperto (riepilogo all'11/11/2026)

Le caselle superate sono state chiuse l'11/11 con il motivo accanto. Restano:

- **Da vedere dal vivo:** il primo accantonamento di fine mese deve arrivare dalla banca come trasferimento da assegnare (passo 1)
- **Mai provato sul live:** modifica ed eliminazione di un movimento, creazione ed eliminazione di un wallet (passo 5), "Set cap" (fase 3), fase 5 e "Paid" nel browser
- ~~Da decidere con Gio~~ — decise l'11/11: un salvadanaio scambia soldi solo con il suo conto; entrate e spese con una
  categoria dell'utente e del tipo giusto (entrambe rifiutate dal server con un 400)
- **Nota tecnica:** `handleGoCardlessCallback` usa solo `accounts[0]` (V1b), innocuo finché la banca espone un conto solo
- **Fase 4:** novembre e dicembre in parallelo con l'Excel, confronto a fine mese, decisione sull'Excel
- **Fase 5:** pubblicata l'11/11; 16 movimenti restano in "Persone — da classificare"
- **Fase 6 (backup ed export):** A (backup notturno cifrato), B (ripristino provato) e C (export JSON + CSV in Settings) fatte il 13/11
- **Richieste del 13/11 pomeriggio (R1–R5):** import, X della finestra, annual plan guidato, elimina account, demo — da decidere
- **Revolut:** rinviato per scelta di Gio; **Enable Banking** per Trade Republic: fuori piano

## Piano dal 10/11/2026 (ordine concordato con Gio il 9/11)

Fatti verificati il 9/11 (sola lettura): la connessione Revolut (`REVOLUT_REVOLT21`) è sull'account
`test@test.it`, non su quello di Gio, ma i movimenti sono suoi; prima del 01/06/2026 ci sono 1.282
transazioni su 1.611 (Gio: 1.276 su GC Default wallet dal 2000 ad aprile 2026, 5 di prova su Trade
Republic; account di test: 1); nessuna ha `bank_transaction_id`.

**1. Controllo del primo import automatico** (10/11 mattina)
- [x] 10/11: workflow "Bank auto-import" riuscito (partito alle 13:09 UTC, non alle 06:00: GitHub ritarda i cron), `imported: 4`, `byRule: 2`, `errors: []`. Le regole sulle persone mandano i movimenti in "Persone — da classificare"
- [ ] Nessun movimento di salvadanaio o verso Giovanni Cuozzo era nel lotto: il percorso `T` dall'import automatico è coperto dai test ma non ancora visto dal vivo. Ricontrollare dopo il prossimo accantonamento (di solito a fine mese). 11/11: 8 movimenti importati in automatico dopo il deploy, nessun `T` (nessun accantonamento): ancora da vedere

**2. Pulizia delle transazioni prima del 01/06/2026** (decisa da Gio il 9/11)
- [x] Eliminate le 1.282 transazioni con `date < 2026-06-01` di tutti gli account — 9/11, dopo la conferma finale di Gio, senza backup per sua scelta. Restano 329 transazioni, nessuna prima del 01/06
- [x] Eliminata la categoria "Annuali" (id 11), rimasta senza transazioni né budget (D8)
- [x] Saldo di GC Default wallet allineato al reale: saldo GoCardless 122,37 € (`interimBooked`, 9/11), movimenti rimasti −1.018,15 € → apertura da 13.264,23 € a **1.140,52 €**; saldo nell'app verificato: **122,37 €**. Nota: l'allineamento forza la coincidenza di oggi; eventuali movimenti doppi o mancanti tra giugno e agosto sono assorbiti nell'apertura
- [x] Trade Republic: apertura impostata al **versato totale indicato da Gio, 6.347,15 €** (9/11); saldo nell'app verificato 6.347,15 €.
  **Attenzione al passo 5:** la cifra comprende già i versamenti passati. Se le uscite "a favore di Giovanni Cuozzo" da giugno (oggi in Giroconto) diventano `T` assegnate a Trade Republic, verrebbero contate due volte: in quel caso l'apertura va ridotta della loro somma, oppure quelle `T` vanno assegnate tenendone conto. Da decidere con Gio quando si converte

**3. Passo 5 — conversione dei Giroconti già importati** (elenco approvato da Gio prima di scrivere)
- [x] 9/11, elenco approvato da Gio: 32 movimenti → `T` da assegnare (20 salvadanaio, 5 verso Giovanni Cuozzo, 4 ricariche Revolut, 3 da Giovanni Cuozzo); saldo GC Default wallet invariato (122,37 €)
- [x] 39 movimenti con le persone → "Persone — da classificare" (entrata id 58: 25; spesa id 59: 14); le 7 regole sulle persone spostate lì
- [x] Categorie "Giroconto" (51, 52) eliminate, verificate vuote
- [x] Trade Republic: apertura ridotta dei 5 bonifici a se stesso (482,36 €) → 5.864,79 €; assegnandoli a Trade Republic in /transfers il saldo torna 6.347,15 €
- [x] Trasferimenti assegnati (10/11): i 20 dei salvadanai dopo la fase 2, i bonifici a Trade Republic, il 4,33 € del 29/10 come rientro da Trade Republic; i 6 Revolut chiusi con "Not a transfer". Da assegnare: 0
- [x] Controllo dei totali agosto–ottobre con l'Excel → spostato nella fase 4 (chiuso qui l'11/11)

**4. Revolut — rinviato per scelta di Gio (10/11): per ora Revolut non si collega**
- Nessun wallet Revolut, nessun import dei suoi movimenti. La regola `revolut dublin` punta ancora a Trasferimento
  (il sistema non impara verso "Altro"): le prossime ricariche arrivano **da assegnare** e si chiudono con
  "Not a transfer" (spesa / entrata sul conto). Corretto l'11/11: prima qui c'era scritto che arrivavano già come spesa
  La connessione GoCardless esistente resta sull'account `test@test.it`: non toccarla
- [ ] Solo se Gio cambia idea: ricollegarlo sul **suo** account, wallet "Revolut" (conto), apertura, import (D-R3)

**5. Pagina "Movements"** (sostituisce Incomes, Expenses, Transfers e Wallets) — decisioni di Gio del 9/11
- In alto le **card dei wallet**: logo e nome della banca (logo GoCardless per i conti collegati, icona generica per gli altri), saldo attuale, entrate e spese del periodo, azioni di modifica (nome, saldo di apertura, default, elimina) e "aggiungi wallet". Cliccare una card filtra solo quel wallet
- Sotto la **tabella di tutti i movimenti**, con filtri: checkbox **Income / Expense / Transfer** combinabili, checkbox per **ogni wallet**, intervallo di date
- **Totali della selezione**: entrate, spese, netto (i trasferimenti non entrano nel netto; con un solo wallet anche trasferimenti in entrata / uscita)
- In cima i **trasferimenti da assegnare**, come oggi in /transfers
- Lingua: **inglese**
- Vista iniziale: tutti i tipi e tutti i wallet selezionati, periodo come oggi (confermato da Gio il 10/11)

**Progetto di dettaglio — approvato da Gio il 10/11**

Fatti verificati: il logo della banca c'è già: `GET /bank/institutions` restituisce `logo` per ogni istituto
GoCardless, e `GET /bank/connections` dice a quale wallet importa ogni banca (`autoImport.walletId`); la
pagina Wallets oggi li usa per "Linked to Intesa Sanpaolo". `GET /transaction/all` non accetta date.

Server
- [x] S1. `GET /transaction/all?startDate&endDate` — 10/11, test 235/235 (il fake di Supabase ora conosce `gte`/`lte`); `public/index.html` lo dichiarava già ("optional date filters")

Client — pagina `/movements` (inglese)
- [x] C1–C10 implementati il 10/11 (client `plan/salvadanai-annuali`, non pubblicato): `app/movements/page.tsx`,
  `components/movements/` (card wallet, trasferimenti da assegnare), `lib/movements.ts` (+9 test), un solo
  pannello per creare e modificare (`new-transaction.tsx`), rimandi in `next.config.ts`, menu Dashboard /
  Movements / New, pagine vecchie e `movements-list` / `edit-dialog` eliminati, documentazione aggiornata.
  Client: 39/39 test, `tsc`, `next build`
- [x] Verificato nell'app vera (locale sul database live, login di Gio) a 375 px, ~800 px e 1280 px: card con logo
  Intesa e saldi giusti (GC 80,32 € dopo l'import del 10/11), filtri per tipo e wallet con indirizzo aggiornato e
  totali coerenti, "Transfers in/out" con un solo wallet, modifica precompilata e passaggio a Transfer (annullata,
  nessun dato scritto), `/incomes` → `/movements?types=I`. Corretti durante la prova: elenco da assegnare
  ridotto a 3 con "Show all", descrizioni a due righe, badge Default sotto il nome
- [ ] Non provato nell'app vera: salvataggio di una modifica, eliminazione, creazione / eliminazione di un wallet
  (tutti scrivono dati veri)
- [x] Pubblicato il 10/11: server `4748414..eb2d4e6` su `main` (deploy Production riuscito, `/healthz` 204), poi client
  `b6a18f0..6204ee8` (deploy Production riuscito, `/movements` 200, `/incomes` → 307 verso `/movements?types=I`)
- [x] Nota: il bonifico di 4,33 € del 29/10 ha "BIC. ORD.: TRBKITMMXXX" (Trade Republic Bank): è un rientro da — **chiuso l'11/11:** assegnato come rientro da Trade Republic il 10/11
  Trade Republic, non da Revolut

**6. ~~1° dicembre~~**: superato — la fase 2 è stata anticipata e Gio ha dato i saldi dei salvadanai il 10/11 (V2)

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
- [x] V2. Saldi reali dei salvadanai letti dall'app Intesa il 10/11 (data di taglio anticipata): 100 / 150 / 60 €
- [x] V3. I bonifici "a favore di Giovanni Cuozzo" vanno a **Trade Republic**: diventano `T` conto ISP → Trade Republic — confermato il 9/11
- [x] V4. I movimenti con Michele, Eduard, Akissi sono **pagamenti tra amici** (bar, uscite, cene) — confermato il 9/11. Non sono giroconti: escono da "Giroconto" e diventano spese e rimborsi (fase 5)
- [x] V4b. Confermato il 9/11: oggi luce, gas e Iliad li paga Michele e Gio gli manda la sua parte; il condominio lo paga Gio e i coinquilini gli rimandano la loro. **Vincolo di Gio: nessuna associazione persona → significato nel codice** (vedi principio in `PLAN_SALVADANAI.md`)

Pulizia (dopo D8):

- [x] Superato: le 31 transazioni sono sparite con la pulizia di tutto ciò che precede il 01/06/2026 (ok di Gio, 9/11) e la categoria "Annuali" (id 11) è stata eliminata vuota

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
- [x] Import CSV: resta `I`/`E` (deciso) — **chiuso l'11/11:** era una decisione, non un'azione
- [x] Import bancario → `T` (passo 4) — progetto approvato e implementato il 9/11, branch `plan/salvadanai-annuali`, non pubblicato:
  - `categorizeWithRules` accetta la categoria `T` per entrambi i segni; `learnRuleFromCorrection` impara "Trasferimento" col tipo del segno e senza wallet
  - `buildAppTransactionFromBank` con `categoryType: "T"` produce una `T` da assegnare (conto = origine se uscita, destinazione se entrata); usato da import automatico e manuale
  - client: nella finestra di import manuale si può scegliere "Trasferimento" per qualsiasi movimento
  - test: server 234/234 (4 nuovi), client `tsc` + lint
  - **Effetto solo dopo l'aggiornamento delle 4 regole** (sotto) e la pubblicazione del server
- [x] Regole aggiornate il 9/11, dopo il deploy del server: `salvadanaio` (E 51→54, I 52→54),
  `verso giovanni cuozzo` (51→54), `da giovanni cuozzo` (52→54), `revolut dublin` (51→54).
  Su Giroconto restano solo le 7 regole sulle persone (passo 5)
- [x] Controllare il primo import automatico dopo il deploy (job delle 06:00): accantonamenti e riunioni somme devono entrare come `T` da assegnare — **chiuso l'11/11:** doppione della voce al passo 1, che resta aperta
- [x] Creare il wallet "Revolut" (conto) — D-R1 — **chiuso l'11/11:** superato: Revolut rinviato per scelta di Gio (passo 4)

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
- [x] Anomalie (9/11: 24 transazioni con categoria di tipo diverso, 1 con categoria di un altro utente): ricontrollato il
  10/11, **0 anomalie su 333 transazioni**. Erano tutte prima del 01/06 ed sono sparite con la pulizia
- [x] Ora che i dati sono puliti, il server può pretendere anche per entrate e spese una categoria dell'utente e dello
  stesso tipo (oggi lo controlla solo per le `T`, per non bloccare la modifica di quelle righe) — **deciso da Gio l'11/11: sì.** Categoria inesistente, altrui o di tipo diverso → 400; nessuna delle 341 transazioni live la violava. Server 266 test, client 49
- [x] Revolut: le 6 ricariche/rientri sono in "Altro" via "Not a transfer" (10/11). La regola `revolut dublin` resta su
  Trasferimento perché il sistema non impara verso "Altro": le prossime ricariche arriveranno da assegnare (scelta di Gio)
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
- [x] Client su `main` e in produzione — 9/11: push di Gio `a22bf51..b6a18f0`, deploy Vercel Production riuscito,
  `flow-wise-client.vercel.app/transfers` risponde 200
- [x] Da capire a parte (non legato alle `T`): il saldo di GC Default wallet nell'app è −1.248,92 € con apertura 13.264,23 €; va confrontato con il saldo reale del conto — **chiuso l'11/11:** saldo allineato al reale il 9/11 (passo 2)
- [x] Convertire in `T` i movimenti interni oggi in "Giroconto": salvadanai (conto ↔ salvadanaio, dal 1/12) e bonifici a Giovanni Cuozzo (conto ↔ Trade Republic). Elenco mostrato a Gio prima di modificare — **chiuso l'11/11:** fatto il 9/11 (passo 3), i 32 movimenti assegnati il 10/11
- [x] Spostare i movimenti verso e da persone, oggi in "Giroconto", in una categoria provvisoria "Persone — da classificare" in attesa della fase 5; elenco mostrato a Gio prima — **chiuso l'11/11:** fatto il 9/11 (passo 3: 39 movimenti)
- [x] Le regole costruite solo sul nome di una persona (`verso michele scaldarella`, `da eduard echimov`…) smettono di categorizzare in automatico: rimangono, ma come suggerimento da confermare — **chiuso l'11/11:** superato: le 7 regole sulle persone puntano a "Persone — da classificare" (passo 3); il modello vero è la fase 5
- [x] Decidere cosa resta della categoria "Giroconto" quando è vuota — **chiuso l'11/11:** eliminata vuota il 9/11 (passo 3)
- [x] Controllo: i totali di agosto–ottobre nell'app, senza trasferimenti, confrontati con "Over year" dell'Excel. Le differenze vanno spiegate una per una — **chiuso l'11/11:** spostato nella fase 4

## Fase 2 — Salvadanai (anticipata al 10/11, decisione di Gio)

Stato al 10/11 (sola lettura): 32 `T`, 6 assegnate da Gio (4 bonifici a Trade Republic, 4,33 € da Trade
Republic, e un accantonamento salvadanaio del 30/10 da 150 € assegnato a Trade Republic per errore,
**riportato da assegnare** con il suo ok). Da assegnare: 19 salvadanaio + 7 altri (ricariche / rientri
Revolut e il bonifico di 100 € del 31/08). Trade Republic ora 6.242,82 €: se anche i 100 € del 31/08
vanno lì diventa 6.342,82 €, cioè il versato (6.347,15 €) meno il rientro di 4,33 €.

**Progetto (da approvare prima del codice)**
- [x] Migrazione `012`: `Wallet.kind` (`account` | `pot`, default `account`) e `Wallet.parent_wallet_id`
  (il conto a cui appartiene il salvadanaio); vincoli: un `pot` ha sempre un conto padre di tipo `account`
  dello stesso utente e non è mai default. Il trigger della `004` conta nel limite di 3 **solo** i conti
- [x] Server: creazione di un salvadanaio (`POST /wallet` con `kind: "pot"` e conto padre), `GET /wallet`
  espone `kind` e `parent_wallet_id`; test degli invarianti nuovi
  - 10/11: `012` + `.down.sql` provate su Postgres 18 locale con i dati veri (applicata due volte, 3 salvadanai
    sotto ISP oltre il limite, quarto conto rifiutato, padre non valido rifiutato, default su salvadanaio rifiutato,
    conto con salvadanai non eliminabile, promozione del default su un conto, rollback bloccato con salvadanai e
    pulito senza). Server: `POST /wallet` con `kind`/`parent_wallet_id`, errori 45004/45005, fake e 3 test nuovi:
    238/238. **Non applicata sul live**
- [x] Client: i salvadanai compaiono come card più piccole sotto la card del loro conto; "Add savings pot"
  nel menu della card del conto; il riquadro "da assegnare" li propone come destinazione/origine
- [x] 10/11: sul live la `004` **non era applicata** (funzioni assenti, scoperto dal pre-check della `012`): Gio ha
  applicato `004` e poi `012`. Verificato: `wallet_set_default` risponde, i 5 wallet sono `account`, saldi invariati
- [x] Creati Emergenze (18), Savings (19), Annuali (20) come `pot` sotto ISP, apertura 0
- [x] Pubblicato il 10/11: server `61524d7..f190360` e client `6204ee8..102a1ed`, deploy Production riusciti
- [x] Trade Republic allineato il 10/11 al saldo indicato da Gio, **6.347,15 €**: bonifico di 100 € del 31/08 assegnato
  a Trade Republic (con il suo ok) e apertura da 5.864,79 € a 5.869,12 € (+4,33 €, il rientro del 29/10). Restano da
  assegnare solo i 6 movimenti Revolut
- [x] "Not a transfer" (10/11, deciso da Gio): un trasferimento da assegnare verso/da un conto non tracciato diventa
  spesa (se esce) o entrata (se entra) con una categoria; la correzione riscrive la regola (es. `revolut dublin`),
  quindi i movimenti simili arrivano gia' cosi'. Client `lib/transfer.ts` + riquadro; test client 42, server 239.
  Verificato nel browser locale (modalita' e categorie proposte), nessun dato scritto. Corretto anche il badge
  Default dentro un `<p>` (errore di idratazione). Pubblicato il 10/11 (client `47f78f1`, deploy Production riuscito)
- [x] Wallet Revolut: non si crea, Revolut è rinviato per scelta di Gio (passo 4)
- [x] Saldi reali dei salvadanai dati da Gio il **10/11** (V2): Emergenze **100 €**, Savings **150 €**, Annuali **60 €**
  (coincidono con gli accantonamenti del 30/10: 100, 150, 60, come le assegnazioni di novembre nell'Excel)
- [x] 20 movimenti salvadanaio assegnati il 10/11 su richiesta di Gio, ricostruiti dal foglio "Savings ISP" dell'Excel
  (ottobre e settembre tornano mese per mese; agosto e i due rientri da 100 € del 14 e 16/10 sono una ricostruzione)
- [x] Aperture al 10/08: Emergenze 180 €, Savings 100 €, Annuali 650 € (totale 930 €, coerente con i movimenti
  bancari; nessun salvadanaio sotto zero; tutti a 0 a fine ottobre come nell'Excel). **Saldi verificati nell'app:
  100 / 150 / 60 €**, uguali a Intesa il 10/11. ISP e Trade Republic invariati
- [x] **Saldi di apertura**: Gio legge oggi dall'app Intesa i saldi dei tre salvadanai (data D); apertura
  di ogni salvadanaio = saldo reale a D − somma dei trasferimenti assegnati fino a D. Poi verifica:
  saldi nell'app = saldi Intesa
- Tetti (D7: 1.000 / 1.000 / somma spese annuali) e piano Annuali restano alla fase 3

### Fase 2 — voci originali

- [x] Progettare `Wallet.kind` (`account` | `pot`) e la modifica al trigger del limite (migrazione `004`) — **chiuso l'11/11:** fatto con la migrazione 012
- [x] Migrazione + `.down.sql` + test degli invarianti (limite sui soli conti, salvadanaio mai default) — **chiuso l'11/11:** fatto con la 012 (test 238 → oggi 261)
- [x] Un salvadanaio appartiene a un conto (`parent_wallet_id`): una `T` conto ↔ salvadanaio ammessa solo tra un salvadanaio e il suo conto? Decidere e testare — **deciso da Gio l'11/11: solo il suo conto.** Server (`checkTransactionReferences`) e menu del client (`canTransferBetween`); nessuna delle 341 transazioni live la violava
- [x] Svuotare le transazioni di prova del wallet Trade Republic (id 11): elenco da approvare prima di cancellare — **chiuso l'11/11:** sparite con la pulizia del 9/11: nessuna transazione di Trade Republic prima del 01/06 (verificato l'11/11)
- [x] Creare i salvadanai con i saldi di apertura di V2 — **chiuso l'11/11:** fatto il 10/11 (fase 2)
- [x] Import: per un movimento "MOVIM. SALVADANAIO" senza abbinamento, l'app chiede a quale salvadanaio va — **chiuso l'11/11:** superato: entra come trasferimento da assegnare e si sceglie il salvadanaio in Movements
- [x] UI per creare un giroconto a mano (conto ↔ salvadanaio) — **chiuso l'11/11:** fatto: "Transfer" nel pannello di creazione movimento
- [x] Riconciliazione: saldi dei salvadanai nell'app = saldi dell'app Intesa alla stessa data — **chiuso l'11/11:** fatta il 10/11 (100 / 150 / 60 € come Intesa); il controllo mensile è nella fase 4

## Fase 3 — Piano Annuali

**Decisioni di Gio (10/11):** pagina propria "Annual plan"; tetto di Annuali = somma delle rate dei **prossimi
12 mesi**; regola dei tempi valida per qualsiasi utente: **i versamenti di un mese coprono le rate dei mesi
successivi** (le rate del mese corrente le copre il saldo attuale); le voci partono dall'Excel e Gio le ricontrolla.

**Progetto (da approvare prima del codice)**

*Dati — migrazione `013`*
- `annual_items`: `id`, `user_id`, `name`, `pot_wallet_id` (il salvadanaio che paga, es. Annuali), `active`, `note`
- `annual_installments`: `id`, `item_id`, `user_id`, `due_date`, `amount_cents` (previsto),
  `transaction_id` (facoltativo: il pagamento vero, collegato a mano), `created_at`
- `Wallet.cap_cents` (facoltativo, tetto fisso: Emergenze e Savings 100.000) e `Wallet.cap_from_plan` (booleano:
  per Annuali il tetto è calcolato dal piano). RLS come `category_rules`: solo il server, con filtro per utente

*Calcolo (funzioni pure nel server, con test scritti a mano)*
- Mesi: 0 = mese corrente, 1…12 = i successivi. `C_k` = somma delle rate **non pagate** dal mese 0 al mese k
- Mese 0: se `C_0` > saldo del salvadanaio → **scoperto adesso** (avviso, nessuna quota lo risolve)
- Quota consigliata = max su k = 1…12 di `(C_k − saldo) / k` (k versamenti fatti entro il mese k−1), mai sotto 0
  e mai oltre ciò che porterebbe il salvadanaio sopra il tetto
- Proiezione a 12 mesi: saldo + k × quota − `C_k`, mese per mese, con avviso se va sotto zero
- Tetto di Annuali = somma delle rate dei mesi 1…12

*Server*
- `GET/POST/PUT/DELETE /annual-items` e rate (`/annual-items/:id/installments`), Zod, filtro per utente
- `POST /annual-items/:id/copy-next-year`: duplica le rate di un anno sull'anno dopo, da correggere
- `PUT /annual-installments/:id/payment`: collega o scollega la transazione che l'ha pagata
- `GET /annual-plan?walletId=`: saldo, rate dei prossimi 12 mesi, quota consigliata, proiezione, tetto

*Client*
- Pagina `/annual-plan`: voci con le loro rate (aggiungi, modifica, copia sull'anno dopo), tabella mese per mese
  con la proiezione, stato pagata / da pagare, collegamento manuale al pagamento
- In Movements la card del salvadanaio mostra "suggested X €/month" e il tetto (`100 / 1.000 €`), con link al piano
- Avviso quando un'assegnazione o un trasferimento porterebbe un salvadanaio oltre il tetto (non blocca)

*Voci proposte dall'Excel (solo rate da oggi in avanti; da ricontrollare con Gio prima di scriverle)*
- Assicurazione auto: 477 € ad aprile e ottobre 2027
- Bollo auto: 192 € a maggio 2027
- TaRi: 140 € ad aprile 2027
- Spotify: 36 € a maggio 2027
- AdE (rateizzazione): 127,50 € a gennaio, marzo, maggio, luglio, settembre, novembre 2027 (giorno da confermare)
- Università: 300 € il 3/12/2026, 200 € il 16/12/2026, 300 € il 3/1/2027, 300 € il 3/2/2027 ("Specchietto per uni")
- Condominio: rate a giugno, agosto, ottobre, dicembre, febbraio, aprile; **importi e quota da chiedere a Gio**
  (l'Excel ha "1500/3 circa"; Gio paga l'intero e i coinquilini gli rimborsano la loro parte)
- Palestra: esclusa (nell'Excel è "NA")

- [x] 10/11 server: migrazione `013` (+ `.down.sql`) provata su Postgres locale; calcolo in `utils/annualPlan.js` (10 test
  scritti a mano); route in `routes/annualPlan.js` (8 test e2e); tetto su `PUT /wallet/:id`. "Copia sull'anno dopo"
  ripete gli **ultimi 12 mesi** della voce, non l'anno solare (AdE e università stanno a cavallo di due anni).
  Condominio fuori per ora (Gio: in futuro solo la sua quota). **Non applicata sul live, non pubblicato**
- [x] 10/11 client: pagina `/annual-plan` (selettore salvadanaio, riepilogo, avvisi scoperto/tetto, proiezione,
  voci e rate con aggiungi/modifica/elimina/copia/pagamento); card dei salvadanai con saldo / tetto, quota
  consigliata, "Set cap" e link al piano; avviso non bloccante di tetto superato assegnando o creando un
  trasferimento (`lib/potCap.ts`, 2 test); voce "Annual plan" nella navbar. 44 test, tsc e build ok. Verificato
  nel browser solo il rendering: senza la `013` sul live la pagina mostra "Error loading the plan" e Movements
  regge. **Il funzionamento vero si verifica dopo aver applicato la 013**
- [x] Rate esplicite (data, importo previsto, pagamento collegato) invece di una regola di ricorrenza
- [x] "Copia sull'anno dopo" (ultimi 12 mesi della voce)
- [x] Quota consigliata, tetto (fisso o dal piano), proiezione a 12 mesi, pagamento collegato a mano
- [x] 10/11 rilascio: Gio ha applicato la `013` e pushato server (c05b96a) e client (862d204); pagina verificata sul live
- [x] 10/11 tetti scritti sul DB (wallet 18, 19, 20 dell'utente): Emergenze e Savings 100.000 cent fissi, Annuali
  `cap_from_plan`. "Set cap" provato solo in locale, non sul live
- [x] 10/11 voci inserite in Annuali dopo l'ok di Gio (giorni: assicurazione il 3, le altre il primo del mese,
  universita' con le date dell'Excel; AdE da gennaio 2027). Sul live: tetto 3.187 €, quota consigliata 440 €/mese
  (vincolo: 500 € di universita' a dicembre con 60 € di saldo e un solo versamento utile)
- [x] 10/11 condominio dal bollettino es. 2026/2027 (ui D/12): rate intere 241,10 € l'1/12/2026, 241,10 € l'1/2/2027,
  241,09 € l'1/4/2027; nel piano **solo la quota di Gio, 1/3** (80,37 / 80,37 / 80,36 €), scelta di Gio. Le rate di
  ottobre (saldo prec. 157,67 € l'1/10, rata 3 241,10 € il 5/10) sono passate e non sono nel piano. Dopo: tetto
  3.428,10 €, quota consigliata 520,37 €/mese

- [x] 13/11 versamenti mese per mese (richiesta di Gio): la colonna "Installments" diventa **Due** (quanto si
  paga) e si aggiunge **Deposit**, il versamento consigliato di ogni mese (`depositSchedule` in
  `utils/annualPlan.js`): ogni mese il minimo che copre le scadenze dei 12 mesi successivi dal saldo previsto,
  contando anche le stesse rate dell'anno dopo (`nextYearDues`, massimo fra ripetute e gia' copiate). Sul live
  (Annuali, 60 €): 520,37 a novembre, 427,50 a dicembre, ~401,75 gennaio–marzo, 355,50 ad aprile, poi 245,93
  (media annua). In alto "Deposit this month" = il versamento di questo mese, uguale alla vecchia quota; il
  conflitto col tetto ora si valuta sul piano mese per mese e su Annuali sparisce. Tabella a 4 colonne che
  sta su un telefono. 4 test nuovi
## Ritocchi dell'interfaccia (richiesti da Gio il 10/11, decisioni prese con lui)

Tutti nel client. Nessuno tocca dati o API, salvo dove indicato. Da fare uno alla volta, con verifica a 375 px.

- [x] U1. **Menu laterale mobile**: Main = Dashboard, Movements, Annual plan, **AI Beta**; Management = Categories,
  **Your Bank**; Settings = Import, **Account** (ultima voce). Solo il menu mobile: la barra desktop non cambia
- [x] U2. **Barra in basso mobile**: ordine Dashboard, Movements, **+ New**, Annual plan
- [x] U3. **Movements**: il pulsante "Add transaction" in alto si nasconde **solo su mobile** (c'è il + della barra);
  su desktop resta, perché è l'unico modo per aggiungere un movimento
  - 10/11: U1–U3 fatti e verificati nel browser locale a 375 px (sezioni del menu, barra Dashboard / Movements / New /
    Annual plan, "Add Transaction" nascosto, nessun overflow) e a 1280 px (barra desktop invariata, pulsante presente).
    Corretto anche un errore introdotto col changelog: due voci "Novembre 2026" con la stessa chiave React
- [x] U3b. **Dashboard**: anche qui "Add Transaction" in alto si nasconde solo su mobile (deciso da Gio il 10/11); verificato
  in locale a 375 px (assente, "Edit" resta, nessun overflow) e a 1280 px (presente)
- [x] U4. **Your Bank su mobile**: eliminare gli overflow orizzontali (da misurare elemento per elemento a 375 px,
  prima di correggere)
  - 10/11: misurato a 375 px: l'unico overflow era la tabella dei movimenti (878 px in una card da 307), più la finestra
    Import con la descrizione ridotta a "PAGA…". Scelte di Gio: su mobile **lista a schede** (la tabella resta da `lg`);
    nella finestra Import la categoria va sotto la descrizione (2 righe). Frase della card corretta in "Categoria dalle
    tue regole, altrimenti 'Altro'" (dal 6/11 non c'è AI). Verificato: 375 px nessun elemento che scorre, 1280 px tabella;
    finestra Import aperta e chiusa con Annulla, nessun dato scritto
- [x] U5. **Your Bank — wallet di una banca**: i salvadanai non si possono scegliere né nell'import automatico (card
  della banca, `AutoImportSettings.tsx`) né nella finestra Import manuale (`ImportTransactionDialog.tsx`): una banca
  importa sempre in un conto, i movimenti dei salvadanai arrivano come trasferimenti da assegnare. Valutare se
  rifiutarlo anche sul server (`PUT /bank/connections/:bank/auto-import`, `POST /bank/import`)
  - 10/11: fatto. Client: i due menu filtrano `kind === "pot"`. Server (scelta di Gio): `updateBankAutoImport` e
    `importBankTransactionsToApp` rifiutano un salvadanaio con `400 POT_NOT_ALLOWED`, senza scrivere
    (`routes/bank.pots.test.js`, 4 test; server 261). Verificato in locale: import automatico propone Disattivato / ISP /
    Trade Republic, finestra Import ISP / Trade Republic; nessun dato scritto. Il caso positivo dell'import manuale non è
    testabile end-to-end: il Supabase finto non gestisce l'`upsert` con `onConflict`
- [x] U6. **Dashboard, spese per categoria su mobile**: barre orizzontali (nome, barra proporzionale, importo,
  ordinate dalla più alta) al posto della torta; su desktop resta la torta
  - 10/11: fatto. Soglia 768 px come `dashboard-grid.tsx`; la categoria più alta riempie la riga, stessi colori della
    torta. Verificato in locale a 375 px (8 barre, nessun overflow) e a 1280 px (torta, barre nascoste)
- [x] U7. **Widget Total Balance**: al posto di "5 wallets" una riga piccola tipo "6.427 € in 2 conti · 310 € in 3
  salvadanai"; al tocco un modale con ogni wallet, saldo e percentuale, i salvadanai sotto il loro conto
  - 10/11: fatto (`lib/balanceBreakdown.ts`, 4 test). Testo in inglese come il resto dell'app: "6427,47 € in 2 accounts ·
    310,00 € in 3 pots". Verificato in locale a 375 px (riga e modale, nessun overflow) e a 1280 px (una riga, non tagliata)

## Fase 4 — In parallelo con l'Excel

**Come si confronta (decisioni di Gio, 11/11/2026).** Ogni fine mese un **report** (sola lettura di Excel e database,
nessun codice nei repo):
- **Mese come nell'Excel:** lo stipendio pagato a fine mese conta per il mese dopo (il foglio "Novembre" ha lo stipendio
  del 30/10); le spese per mese di calendario. Cambia solo il confronto, non le date nell'app
- **Rimborsi:** fino alla fase 5 il confronto sottrae dalle spese le entrate di "Persone — da classificare", perché
  nell'Excel le spese sono già nette (es. "27+36+60-36-12", condominio solo la quota di Gio)
- **"Altro":** a novembre 516 € di spese su ~940 € sono in "Altro": propongo io la categoria di ognuno (dalle note
  dell'Excel), li cambio solo dopo l'ok di Gio, e le regole imparano dalle correzioni
- Si confrontano anche i movimenti dei salvadanai (foglio "Savings ISP") e i versamenti a Trade Republic
- Struttura dell'Excel letta l'11/11: fogli mensili Gen…Nov (Entrate, Uscite per voce con note, Avanzo → salvadanai/TR),
  "Over year" (stipendio netto, spese, salvadanai per mese), "Savings ISP" (movimenti mensili dei salvadanai e TR),
  "Overview" (buste paga), "Specchietto per uni", "Med Exp"
- [x] 11/11, ok di Gio: 12 movimenti di novembre da "Altro" alle categorie dell'Excel (Rate 170,82; Casello 43,70;
  Abbonamenti 21,96; Spesa 6,30; Trasporti 1,50; Uscite 14 + 18 + 5 + 15,60 + 3,50 + 27 + 60). Regole imparate (10):
  `pag fin`, `anthropic claude`, `bakery woman` e i 7 locali. **Non** imparate di proposito: `adue cod` (prefisso di
  tutti gli addebiti SEPA, avrebbe mandato ogni addebito in Casello) e `anagnina` (avrebbe preso anche "Tabacchi
  Anagnina"). Dopo: Spesa 72,87, Casello 43,70, Abbonamenti 21,96, Rate 170,82, Affitto 325 = Excel; "Altro" 129,10 €
- [x] 11/11, risposte di Gio: Freni e Frizioni, Mirante Simone, Caffetteria Mirò → Uscite (regole imparate);
  PayPal a Ilenia 20 € = "Regalo Marika" → Straordinarie; PayPal a Marika 36 € = quota di un pranzo → Uscite. Sui due
  PayPal **nessuna regola**, di proposito: sarebbero regole su una persona (principio "persone" del piano).
  SumUp *Luce Srl 17 € = barbiere: resta in "Altro", come "18 Barber" nell'Excel (la categoria Barber è disattivata).
  "Altro" di novembre ora 25,30 € (barbiere + tabacchi)

- [ ] Totali di agosto–ottobre nell'app, senza trasferimenti, confrontati con "Over year" dell'Excel: differenze spiegate una per una
- [ ] Novembre e dicembre 2026 tenuti sia nell'Excel sia nell'app
- [ ] A fine mese: saldi dei salvadanai, spese annuali pagate e totali coincidono, oppure la differenza è spiegata
- [ ] Decidere se l'Excel si può dismettere

## Fase 5 — Rimborsi e spese condivise (da progettare)

**Decisioni di Gio (11/11/2026):** rimborso **per categoria**, non collegato al singolo pagamento; conta **nel mese in
cui arriva**; nelle regole **il testo libero del bonifico vince** sul nome della persona.

**Progetto (da approvare prima del codice)**

*Dati 11/11:* 43 movimenti in "Persone — da classificare" (agosto–novembre), 860,38 € in entrata e 731,91 € in uscita.
Esempi: condominio 132,91 × 2 (5/10), TaRi 28,33 / 30,33 con testo "Tari agosto", "Rata 4 tari", cene e PayPal.

*I due casi*
1. **Pago io la mia quota di una spesa anticipata da altri** (bollette a Michele): spesa normale con la sua categoria
   (Bollette, Uscite…). Non serve niente di nuovo: si sceglie la categoria
2. **Anticipo io e gli altri mi rimborsano** (condominio, cene): l'entrata diventa un **rimborso** di una categoria di
   spesa. Nelle statistiche è una spesa in meno di quella categoria nel mese in cui arriva, mai un'entrata.
   Esempio: ottobre Condominio 398,73 − 132,91 − 132,91 = 132,91, come nell'Excel

*Dati (migrazione `014`)*
- `Transaction.is_refund boolean not null default false`. Un rimborso è una riga `I` (i soldi entrano nel wallet, il
  saldo è giusto senza cambiare `walletDeltasCents`) con `is_refund = true` e una categoria **di tipo `E`**
- Perché una colonna e non un nuovo tipo `R`: `type` è un enum di Postgres e un valore aggiunto non si toglie più
  (nessun `.down.sql` possibile); la colonna si rimuove pulita
- Vincolo: `is_refund` solo su `I`. Il controllo delle categorie (11/11) diventa: entrata → categoria `I`; rimborso →
  categoria `E`; spesa → categoria `E`

*Server*
- Schemi Zod e `checkTransactionReferences` con `is_refund`; test
- `/income/all` esclude i rimborsi; `/expense/all` li include, marcati, così chi somma li sottrae
- Import bancario: una regola di tipo `I` che punta a una categoria `E` crea un rimborso; correggere un'entrata in
  rimborso impara la regola (dal testo se c'è, mai dal solo nome della persona)
- Regole: una parola chiave trovata nel **testo libero** del bonifico vince su una regola costruita sulla controparte
  (`da …` / `verso …`), che resta solo un suggerimento verso "Persone — da classificare"

*Client*
- Pannello del movimento: per un'entrata, "Refund of" + categoria di spesa
- Movements: il rimborso si vede come "Refund · Uscite" e nei totali riduce le spese; Dashboard: spese per categoria e
  totali al netto dei rimborsi, entrate senza rimborsi
- "Transfers to assign" → "Not a transfer": per un'entrata si può scegliere anche "Refund of"

*Dati esistenti:* i 43 movimenti li riclassifico solo dopo, con un elenco proposto a Gio (come per novembre)

*Effetto sulla fase 4:* il confronto con l'Excel non dovrà più sottrarre a mano le entrate dalle persone

- [x] 11/11, progetto approvato da Gio. Migrazione `014` (+ `.down.sql`) provata su Postgres locale (due volte,
  rimborso su `I` ammesso, su `E` rifiutato, rollback pulito). Server: `is_refund` in schemi e controlli, liste,
  import bancario (entrata + categoria di spesa = rimborso), regole sul testo libero che vincono sulla controparte,
  apprendimento dei rimborsi solo dal testo libero (`extractFreeText`, `freeTextKey`). 276 test (+10).
  Client: `isRefund`/`totalForType` (entrate senza rimborsi, spese nette), Movements (filtri, totali, badge
  "Refund"), Dashboard, casella "Refund" nel pannello, "Refund · categoria" in "Not a transfer". 53 test.
  **Non applicata sul live, non pubblicato, non provato nel browser**
- [x] 11/11 rilascio: Gio ha applicato la `014` (341 righe, 0 rimborsi) e pushato server (`2eaa072`) e client (`acab358`); deploy riusciti. **Non provato nel browser** (sessione scaduta sia in locale sia sul live): da guardare Dashboard, Movements e la casella "Refund"
- [x] 11/11, ok di Gio: 27 dei 43 movimenti con le persone riclassificati incrociando le note dei fogli Ago–Nov.
  10 spese (6 a Michele → Bollette; Eduard 310 → Straordinarie, 50 → Viaggi, 20 "cena" → Uscite, 44 → Trasporti) e
  17 rimborsi (TaRi ×4 → Bollette, condominio ×2 → Condominio, Eduard 100 ×2 → Viaggi, 5 + 9 → Asporto, 12 + 11 +
  53,50 + 12 + 36 → Uscite, 3,10 + 12 → Altro). Regole imparate solo dal testo: `tari`, `condominio`, `panciccio`;
  nessuna sui nomi. Controllo: Condominio di ottobre 132,95 € (Excel 132,92). Il proposto diceva "29 sicuri e 14 da
  chiarire": erano 27 e 16, conteggio corretto qui
- [ ] Ancora in "Persone — da classificare", da chiarire con Gio (16): uscite Eduard 40 (3/9) e 35 (26/9), Michele 21
  (9/9), Eduard 100 "Prelievo" (17/9, Prelievi?), Michele 7,35 (9/11, Iliad?); entrate PayPal 12 (20/8), Eduard 5,50
  (9/9), PayPal 3,50 (15/9), Michele 11 (4/10), e il gruppo di fine ottobre (Michele 7,67 + 16,60, Akissi 7,67 + 16,60,
  Eduard 8 + 18,50, PayPal 16,60 = 91,64 €: rimborso Uscite?)
- [ ] L'agente `/ai-beta` legge solo le spese `E`: i rimborsi non entrano nella sua analisi (da valutare)

- [ ] Progettare i due casi generici del principio "persone" (in `PLAN_SALVADANAI.md`) e scriverli qui prima di implementare:
  - pago io la quota di una spesa anticipata da altri → spesa normale, categoria scelta sul movimento
  - anticipo io e gli altri mi rimborsano → rimborso collegato alla spesa, che diventa netta (oggi nell'Excel: "98,5 − 53,5 Cene", condominio diviso per tre)
- [ ] Le regole possono usare il testo libero del bonifico ("Condominio settembre", "Tari agosto"), che vince su un nome di persona
- [ ] Nessuna voce operativa finché il modello non è deciso

## Fase 6 — Backup ed export (progettata il 13/11, da fare)

Nata dai due processi `/court` del 13/11 (11–1 sull'abbandono dell'Excel, 6–0 su "Flow-Wise è un buon
prodotto"): la condizione chiesta da tutti i giurati è un backup automatico, un export per utente e un
ripristino provato. Decisioni di Gio del 13/11: repo privato con dump cifrato, ogni notte, 30 copie,
export JSON + CSV dei movimenti.

Fatti verificati: entrambi i repo sono **pubblici** (log e artifact visibili); sul piano gratuito i backup di
Supabase non sono garantiti né scaricabili, e la stessa documentazione consiglia un dump proprio fuori sede.

**A. Backup notturno cifrato**
- [x] Gio crea il repo **privato** `flow-wise-backups` (il workflow vive lì: log e file mai nei repo pubblici)
- [x] Gio genera una chiave `age` sul suo Mac e tiene la privata al sicuro (fuori dal Mac, es. password manager);
      a me serve solo la **pubblica**
- [x] Gio imposta di persona il segreto `SUPABASE_DB_URL` (stringa del *session pooler*, IPv4: i runner GitHub
      non raggiungono la connessione diretta IPv6). Io non vedo né scrivo la password del DB
- [x] Workflow ogni notte: `pg_dump` dello schema `public` (+ `auth.users` solo id ed email, per poter
      ricollegare gli `userid`), `gzip`, cifratura `age` con la chiave pubblica, file `AAAA-MM-GG.sql.gz.age`
- [x] Tiene le ultime 30 copie su un ramo con un solo commit riscritto ogni notte, così la storia non cresce
- [x] Se fallisce, GitHub manda la mail di default; nei log solo dimensioni e conteggi

- 13/11: parte A in funzione. Primo backup lanciato a mano (run 43399886636): `2026-11-13.tar.gz.age`,
  68.636 byte, 12 tabelle; decifrato da Gio con la sua chiave, manifest letto: server Postgres 17.4, 4 utenti,
  Transaction 345, bank_transactions 390, Category 50, category_rules 42, annual_installments 17, Wallet 8,
  annual_items 7, Profile 3, bank_connections 2, dashboard_layouts 2, Budget 0, Saving 0. Da stanotte gira
  da solo alle 02:30 UTC
- Verificato il 13/11 sul live (sola lettura): `password_reset_tokens` **non esiste** (PostgREST `PGRST205`),
  quindi il "password dimenticata" non può funzionare: la mail parte ma il token non viene salvato.
  La migrazione `002_create_password_reset_tokens.sql` non era mai stata applicata. Resa idempotente e
  provata due volte su un Postgres locale.
  - [x] Gio applica la 002 nel SQL editor di Supabase (13/11)
  - [x] verifica: la tabella risponde sul live con tutte le colonne (200, 0 righe)
  - [x] Gio prova "Forgot password?" con la sua email (13/11): mail arrivata da `gc.dev.app@gmail.com`
    (casella di sistema dedicata, password per le app di Google su Vercel), password reimpostata, accesso ok
  - [x] Pagine forgot/reset con lo stile del login (client `components/auth-shell.tsx`) e mail con lo stile
    di Flow Wise (`utils/emailTemplates.js`: logo, card, pulsante verde, versione testo)
- La tabella `Saving` (0 righe) non è usata dal codice: residuo, si può togliere più avanti con una migrazione

**B. Ripristino provato**
- [x] Script di prova: Gio decifra un backup con la sua chiave, lo script lo carica nel Postgres locale
      (`--no-owner --no-privileges`) e confronta righe per tabella e saldi derivati dei wallet con il live
- [x] Primo ripristino fatto e annotato qui con data ed esito; poi una prova ogni tanto (da decidere)
  - 13/11: `scripts/restore-check.sh` nel repo dei backup. Backup `2026-11-13` caricato in un Postgres 18 locale
    al primo colpo (servono solo ruoli, `auth.users`, `auth.uid()` e `uuid-ossp`, che lo script prepara).
    Righe: tutte le 12 tabelle e i 4 utenti uguali al manifest. Saldi derivati degli 8 wallet calcolati con
    `walletDeltasCents` del server: backup e live identici (345 movimenti, nessuno creato dopo il backup).
    File decifrati e database cancellati alla fine

**C. Export per utente**
- [x] Server `GET /export`: JSON con profilo, wallet e salvadanai, categorie, movimenti, budget, piano annuale,
      regole, layout, connessioni bancarie **senza** token; niente `password_reset_tokens`. Ogni query
      filtrata per `userid`, liste con `fetchAllRows`. Test: un altro utente non esce, i token non escono
- [x] Server `GET /export/transactions.csv`: data, tipo, importo, categoria, wallet, wallet di destinazione,
      descrizione, nota, rimborso; separatore `;` e BOM UTF-8 perché si apra bene nell'Excel italiano
- [x] Client: in Settings una sezione "Your data" con "Download everything (JSON)" e "Download movements (CSV)"
  - 13/11: `utils/exportService.js` + `routes/export.js` (7 test: isolamento anche con `?userid`, nessun token
    o `raw_data` anche se il DB li restituisse, errore invece di export parziale, CSV con BOM, `;`, virgola
    decimale e campi protetti). Client: `components/settings/your-data-card.tsx` in Settings. Esclusi dal JSON
    anche `raw_data` dei movimenti bancari e `balance_raw_data`: payload del fornitore, non dati dell'utente
- [x] Docs: `public/index.html`, README, CODE_MAP, Privacy (oggi la copia si chiede per mail), changelog

Ordine proposto: A, poi B (un backup che non si è mai ripristinato non conta), poi C.

## Richieste del 13/11 pomeriggio (da decidere con Gio, poi da fare)

- [x] R1. **Import bancario, tornare alla categoria suggerita** — deciso: freccia ↺ "Back to suggestion" su ogni riga cambiata.: nella finestra di import di Your Bank, dopo aver
  cambiato la categoria di un movimento, un modo per rimettere quella proposta dalle regole (o "Altro")
- [x] R2. **X per chiudere la finestra** — deciso: e' l'avviso "Create the Altro category?". "in questa fase" dell'import: da capire quale (la finestra di import ha
  gia' la X del componente Dialog; l'avviso "Create the Altro category?" non ce l'ha)
- [x] R3. **Annual plan guidato**: se non c'e' un salvadanaio, crearlo dalla pagina stessa (oggi c'e' solo il testo
  "Movements → account menu → Add savings pot"), poi accompagnare alla prima voce del piano
  - 13/11: R1–R3 nel client (commit dopo b753a4e): ↺ su ogni riga dell'import, X sull'avviso Altro, pagina del piano
    che crea il salvadanaio (tetto dal piano) e apre la prima voce. Non provati nel browser: servono login e, per R3,
    un account senza salvadanai
- [x] R4. **Elimina account** — deciso: subito, con conferma scrivendo la propria email, export proposto prima.: oggi la cancellazione si chiede per mail (Terms §11, Privacy §9). Servono route sul
  server (tutte le tabelle dell'utente + utente di Supabase Auth + connessioni bancarie revocate), conferma forte nel
  client, invito a scaricare prima l'export; i backup cifrati spariscono entro 30 giorni (gia' scritto in Privacy)
  - 13/11: server `DELETE /users/me` (`utils/accountDeletion.js`): conferma con l'email, cancella in ordine rate,
    voci, regole, movimenti, budget, layout, codici di reset, banca, salvadanai, conti, categorie, profilo, foto su
    Cloudinary (al meglio) e infine l'utente di Auth; si ferma al primo errore e si puo' riprovare. 8 test (fake
    esteso con l'Admin API). Client: card "Delete account" in Settings; Terms §7/§11 e Privacy §7/§9 aggiornati.
    Non provato sul live (cancellerebbe un account vero)
- [ ] R5. **Demo al primo accesso** — deciso: tour guidato di 4-5 passaggi, saltabile e rivedibile da Settings.: spiegare come funziona l'app a un utente appena registrato

## Fuori piano — da valutare dopo

- [ ] Enable Banking come provider per Trade Republic (piano gratuito "restricted production", solo conti propri). A novembre 2026 l'integrazione TR risulta recente e con problemi segnalati (consenso massimo 90 giorni, movimenti duplicati, limiti di richieste). PSD2 copre il conto di liquidità, **non il valore del portafoglio**. Da verificare sulla documentazione ufficiale prima di qualsiasi lavoro

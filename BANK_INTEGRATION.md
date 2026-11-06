# Integrazione Bancaria - Flow Wise

L'integrazione bancaria di Flow Wise consente agli utenti di connettere in modo sicuro i propri conti bancari e sincronizzare automaticamente i movimenti finanziari, con la possibilità di filtrarli per periodo e importarli (anche con selezione massiva) nei propri Wallet e Categorie.

---

## Modalità supportate

### 1. Sandbox / Mock (Predefinita per sviluppo e demo)
- Permette di testare l'intero flusso Open Banking (autorizzazione OAuth interattiva tramite `/bank/mock-auth`, sincronizzazione di movimenti realistici degli ultimi 90 giorni, importazione nei wallet dell'app) senza bisogno di credenziali bancarie esterne.
- Cifratura di stato sicura con **AES-256-GCM** per proteggere l'identità dell'utente durante il redirect.
- Istituti simulati: *FlowWise Sandbox Bank, Intesa Sanpaolo, UniCredit, BNL - BNP Paribas, Poste Italiane, Revolut, Fineco Bank, Banco BPM, N26, Credem, Illimity*.

### 2. GoCardless Open Banking PSD2 (Banche Reali)
- Connessione a oltre 2.500 banche europee e italiane con licenza AISP ufficiale (Intesa Sanpaolo, UniCredit, Poste Italiane, Revolut, Fineco, BNL, BPM, N26, Credem, Illimity, ecc.).
- Gestione automatica del ciclo di vita dei token OAuth2 (`POST /token/new/`) con memorizzazione in cache.
- Configura `GOCARDLESS_SECRET_ID` e `GOCARDLESS_SECRET_KEY`: con il mock non abilitato il server è in modalità **live**. `BANK_PROVIDER` (diverso da `mock`, oppure assente) seleziona il live; `BANK_PROVIDER=mock` abilita la sandbox, come documentato qui sotto.

---

## Configurazione Server (.env)

```env
# Modalità: BANK_PROVIDER=mock abilita la sandbox/mock (variabile letta dal codice,
# utils/bankService.js). Qualsiasi altro valore, o l'assenza, lascia il server in
# modalità live, che richiede le credenziali GoCardless.
BANK_PROVIDER=mock

# Override esplicito del mock (true/1/yes/on): da solo abilita la sandbox, a
# prescindere da BANK_PROVIDER.
BANK_MOCK_ENABLED=false

# URI di reindirizzamento OAuth
BANK_REDIRECT_URI=http://localhost:5030/bank/callback
BANK_CLIENT_REDIRECT_URI=http://localhost:3000/settings/yourbank

# Credenziali GoCardless (richieste per la modalità live)
GOCARDLESS_SECRET_ID=il_tuo_secret_id
GOCARDLESS_SECRET_KEY=la_tua_secret_key

# Segreto delle route /bank/scheduler/* (header x-scheduler-secret), usato dal
# workflow giornaliero di GitHub Actions (vedi "Import automatico giornaliero")
BANK_SCHEDULER_SECRET=il_tuo_segreto_scheduler_lungo_e_casuale

# Facoltativo, non su Vercel: scheduler di sincronizzazione dentro il processo.
# Senza valore non parte. Non usare frequenze orarie (limiti PSD2, vedi sotto).
# BANK_SYNC_CRON=0 5 * * *
```

---

## Database Supabase

Assicurati di aver eseguito le seguenti migrazioni SQL nel database Supabase:
1. `migrations/001_create_bank_tables.sql`: creazione tabelle `bank_connections` e `bank_transactions`, con indici e RLS.
2. `migrations/002_scope_bank_transaction_ids.sql`: vincolo di unicità `(user_id, bank_id, account_id, external_id)` per prevenire duplicati nei movimenti.
3. `migrations/008_bank_connection_balance.sql`: colonne `balance_*` su `bank_connections` per l'ultimo saldo del conto (reversibile con `008_bank_connection_balance.down.sql`).
4. `migrations/009_bank_auto_import.sql`: import automatico — `bank_connections.import_wallet_id` e `auto_import_from`, `bank_transactions.booking_status` (`booked` | `pending`), `Transaction.bank_transaction_id` con indice univoco (reversibile con `009_bank_auto_import.down.sql`).
5. `migrations/010_category_rules.sql`: tabella `category_rules` delle regole locali di categoria (reversibile con `010_category_rules.down.sql`).

**Ordine di rilascio:** `008`, `009` e `010` vanno applicate sul database **prima** di pubblicare il codice che le usa. Senza `009` la sincronizzazione fallisce (scrive `booking_status`) e l'import, manuale o automatico, fallisce (scrive `bank_transaction_id`); senza `010` fallisce l'import automatico (legge `category_rules`).

### Struttura Tabelle:
- **`bank_connections`**: memorizza `user_id`, `bank_id`, `account_id`, `access_token`, `refresh_token` (entrambi cifrati at-rest), `token_expires_at`, `last_synced` e l'ultimo saldo letto: `balance_amount`, `balance_currency`, `balance_type`, `balance_reference_date`, `balance_provider_updated_at`, `balance_fetched_at`, `balance_raw_data`.
- **`bank_transactions`**: memorizza `id`, `user_id`, `bank_id`, `account_id`, `external_id`, `amount`, `currency`, `description`, `date`, `counterparty`, `status` (`synced` | `imported`), `raw_data`.

---

## API Endpoints

Tutte le route (tranne `/bank/mock-auth`, `/bank/callback` e scheduler) richiedono Bearer Token Supabase nell'header `Authorization`.

| Metodo | Route | Parametri / Body | Scopo |
| --- | --- | --- | --- |
| `GET` | `/bank/config` | — | Verifica disponibilità provider e tabelle database |
| `GET` | `/bank/institutions` | — | Elenco istituti bancari disponibili con badge Sandbox / Live |
| `GET` | `/bank/authorize` | `?bank=<id>` | Genera URL per l'autorizzazione bancaria (GoCardless requisition o Sandbox) |
| `GET` | `/bank/mock-auth` | `?state=<aes_gcm_token>&bank=<id>` | Pagina web sandbox per autorizzare il conto di test |
| `GET` | `/bank/callback` | `?code=<code>&state=<state>` | Callback OAuth: scambia codice, salva conto e avvia primo sync |
| `GET` | `/bank/status` | `?bank=<id>` | Stato connessione, account ID, timestamp ultimo sync e `balance` (o `null`) |
| `GET` | `/bank/connections` | — | Elenco di tutte le banche connesse dall'utente, ciascuna con il suo `balance` (o `null`) e `autoImport: { enabled, walletId, fromDate }` |
| `PUT` | `/bank/connections/:bank/auto-import` | `{ walletId: number \| null, fromDate?: "YYYY-MM-DD" \| null }` | Attiva (wallet di destinazione + data di partenza) o disattiva (`walletId: null`) l'import automatico della banca |
| `POST` | `/bank/sync` | `?bank=<id>` | Sincronizza manualmente i movimenti del conto |
| `GET` | `/bank/transactions` | `?bank=<id>&startDate=<YYYY-MM-DD>&endDate=<YYYY-MM-DD>` | Elenco movimenti sincronizzati con filtri periodo |
| `POST` | `/bank/import` | `{ transactionIds: string[], walletId: number, categoryId: number, defaultType?: "I" \| "E" }` | Converte transazioni bancarie in entrate/spese nei Wallet |
| `POST` | `/bank/disconnect` | `?bank=<id>` | Disconnette la banca conservando lo storico dei movimenti |
| `GET` | `/bank/scheduler/status` | Header `x-scheduler-secret` | Se lo scheduler interno facoltativo (`BANK_SYNC_CRON`) è attivo |
| `POST` | `/bank/scheduler/sync-now` | Header `x-scheduler-secret` | Sincronizza subito tutte le banche connesse; risponde con soli conteggi ed errori per banca |
| `POST` | `/bank/scheduler/import` | Header `x-scheduler-secret`, `?limit=1-100` (default 50) | Un lotto di import automatico; richiamare finché `remaining` è 0 |

### Sincronizzazione: stato e movimenti in sospeso

- La sincronizzazione legge gli **ultimi 90 giorni** e fa l'upsert su `(user_id, bank_id, account_id, external_id)`.
- Ogni movimento porta `booking_status`: `booked` (contabilizzato) o `pending` (in sospeso), come li separa GoCardless. I movimenti salvati prima della migrazione `009` restano `NULL` finché una sincronizzazione non li riconferma.
- L'upsert **non scrive `status`**: un movimento nuovo nasce `synced` (default del DB), uno già `imported` resta tale. Prima ogni sincronizzazione riportava a `synced` i movimenti già importati.
- Un movimento `pending` mai importato che la banca non restituisce più nella finestra viene eliminato: di solito è stato contabilizzato con un altro id, arrivato nella stessa sincronizzazione.

### Saldo del conto

A ogni sincronizzazione, dopo l'upsert dei movimenti, `syncBankTransactions` legge il saldo del conto (`fetchAccountBalance`, endpoint GoCardless `/accounts/<id>/balances/`) e lo salva nelle colonne `balance_*` di `bank_connections`. Se il provider restituisce più saldi, `normalizeAccountBalance` sceglie in quest'ordine: `available`, `current`, `interimAvailable`, `interimBooked`, `booked`, `closingBooked`. In modalità mock il saldo è fisso (2450,75 EUR, tipo `mock`).

Il saldo è informativo: se la sua lettura fallisce, la sincronizzazione dei movimenti va avanti e resta l'ultimo saldo salvato. `/bank/status` e `/bank/connections` lo espongono come `balance: { amount, currency, type, referenceDate, providerUpdatedAt, fetchedAt }`, oppure `null` se non è mai stato letto.

---

## Import automatico giornaliero

Ogni mattina il workflow `.github/workflows/bank-auto-import.yml` (GitHub Actions, `cron: "0 5 * * *"`: 06:00 ora italiana d'inverno, 07:00 d'estate, con possibili ritardi di GitHub) chiama:

1. `POST /bank/scheduler/sync-now` — scarica i movimenti di tutte le banche connesse;
2. `POST /bank/scheduler/import?limit=50` — più volte, finché `remaining` è 0 (massimo 20 lotti).

Il workflow fallisce, e GitHub lo notifica per email, se la sincronizzazione o l'import riportano errori: per esempio consenso GoCardless scaduto o categoria `Altro` mancante. Si può lanciare a mano dalla scheda **Actions** (`workflow_dispatch`).

**Cosa importa** (`utils/bankAutoImport.js`), per ogni banca con un wallet di destinazione impostato da *Your Bank*:
- solo movimenti mai importati (`status = 'synced'`) e **contabilizzati** (`booking_status = 'booked'`);
- solo con data uguale o successiva a `auto_import_from` (attivando senza data si parte da oggi);
- nel wallet scelto, con importo assoluto e tipo deciso dal segno, collegati al movimento di origine (`Transaction.bank_transaction_id`).

**Categorie: regole locali** (`utils/categoryRules.js`, tabella `category_rules` della migrazione `010`). Nessun servizio esterno: descrizioni e importi non escono da Flow-Wise. *(Fino al 2026-11-06 la categoria la sceglieva un LLM esterno, Groq: tolto per tenere i dati in casa e perché i limiti di richieste del piano gratuito mandavano interi lotti su `Altro`.)*
- Una regola è "parola chiave → categoria" per un tipo (`I`/`E`). Combacia se la parola chiave compare a parole intere nella descrizione o nella controparte normalizzate (minuscole, senza accenti, solo lettere): `conad` trova `PAGAM. TRAMITE POS CONAD SUPERMERCATO`. Tra più regole vince la parola chiave più lunga.
- Una regola verso una categoria disattivata o di un altro tipo viene ignorata.
- Senza regola il movimento va nella categoria `Altro` del suo tipo; senza una `Altro` attiva non viene importato e resta `synced`.
- **Le regole si imparano dalle correzioni:** quando cambi la categoria di un movimento importato dalla banca (`PUT /transaction/:id`), il server ricava il nome del negozio o della controparte dal movimento bancario (`extractMerchantKey`, per esempio `conad supermercato`, `verso mario rossi`) e salva o aggiorna la regola (`source = 'learned'`). Non impara mai `Altro`.
- Le regole iniziali si inseriscono una volta (`source = 'manual'`); non c'è ancora una schermata per gestirle.

**Niente doppioni:** l'indice univoco su `Transaction.bank_transaction_id` fa ignorare (`ON CONFLICT DO NOTHING`) un movimento già importato, anche se import manuale e automatico si sovrappongono. Il conteggio finisce in `alreadyImported`.

**Configurazione richiesta**
- Vercel: `BANK_SCHEDULER_SECRET`, `GOCARDLESS_SECRET_ID`, `GOCARDLESS_SECRET_KEY`.
- GitHub (repo `flow-wise-server`, *Settings → Secrets and variables → Actions*): `BANK_SCHEDULER_SECRET` con lo stesso valore. L'URL del server è scritto nel workflow.

**Limiti noti**
- Il repo è pubblico, quindi i log del workflow sono pubblici: le risposte degli endpoint scheduler contengono solo conteggi ed errori per banca.
- PSD2: senza l'utente presente le banche concedono poche letture al giorno per conto (spesso 4). Ogni giro fa 1 chiamata per i movimenti e 1 per il saldo.
- Il consenso GoCardless scade (90 giorni, `token_expires_at`): da quel momento il workflow fallisce finché la banca non viene ricollegata.
- GitHub disattiva i workflow pianificati dei repo pubblici dopo 60 giorni senza attività sul repo; si riattivano dalla scheda Actions.

## Flusso di Importazione Movimenti in Flow Wise

1. L'utente accede a `/settings/yourbank`.
2. Le transazioni vengono filtrate per periodo (default: dal 1° del mese corrente a oggi).
3. L'utente seleziona una o più transazioni (selezione singola o massiva con checkbox header).
4. Apre il modale di importazione ([ImportTransactionDialog.tsx](../flow-wise-client/app/settings/yourbank/ImportTransactionDialog.tsx)).
5. Sceglie il **Wallet di destinazione** e, **per ogni movimento**, la **Categoria**: un menu filtrato sul tipo atteso dal segno dell'importo, precompilato da un suggerimento calcolato nel client (`lib/bankCategorySuggestion.ts` del client — sul server non esiste codice di categorizzazione):
   - il suggerimento è *sicuro* solo se il nome di **una sola** categoria attiva del tipo giusto (almeno 3 caratteri) compare come parola intera in descrizione + controparte normalizzate;
   - altrimenti (nessuna corrispondenza o pareggio) il movimento è marcato **incerto** (icona di avviso) e precompilato con la categoria `Altro` del suo tipo; se `Altro` non esiste il modale propone di crearla, e se l'utente rifiuta la categoria va scelta a mano.
6. All'invio il client raggruppa i movimenti per categoria e chiama `POST /bank/import` con `{ transactionIds, walletId, categoryId }` **una volta per gruppo**, perché la route accetta un solo `categoryId` per chiamata. Se un gruppo fallisce dopo che altri sono andati a buon fine, l'import è parziale e il modale lo segnala. Per ogni chiamata il server:
   - Crea i record nella tabella `Transaction` di Flow Wise. Il tipo è `defaultType` se il campo opzionale è presente nella richiesta, altrimenti è deciso dal segno dell'importo (`amount >= 0` &rarr; Entrata `"I"`, `amount < 0` &rarr; Spesa `"E"`); l'importo viene salvato in valore assoluto. Il client attuale non invia `defaultType`, quindi per l'import da interfaccia vale sempre il segno.
   - Collega ogni riga al movimento di origine (`bank_transaction_id`) e ignora quelli già importati, che finiscono in `alreadyImportedCount`.
   - Aggiorna lo stato in `bank_transactions` a `"imported"`.
   - Invalida la cache TanStack Query per aggiornare istantaneamente Dashboard, Wallet ed elenchi Entrate/Spese.

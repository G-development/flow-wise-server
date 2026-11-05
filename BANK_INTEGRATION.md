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

# Scheduler sincronizzazione periodica automatica
BANK_SYNC_CRON=0 * * * *
BANK_SCHEDULER_SECRET=il_tuo_segreto_scheduler_lungo_e_casuale
```

---

## Database Supabase

Assicurati di aver eseguito le seguenti migrazioni SQL nel database Supabase:
1. `migrations/001_create_bank_tables.sql`: creazione tabelle `bank_connections` e `bank_transactions`, con indici e RLS.
2. `migrations/002_scope_bank_transaction_ids.sql`: vincolo di unicità `(user_id, bank_id, account_id, external_id)` per prevenire duplicati nei movimenti.
3. `migrations/008_bank_connection_balance.sql`: colonne `balance_*` su `bank_connections` per l'ultimo saldo del conto (reversibile con `008_bank_connection_balance.down.sql`).

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
| `GET` | `/bank/connections` | — | Elenco di tutte le banche connesse dall'utente, ciascuna con il suo `balance` (o `null`) |
| `POST` | `/bank/sync` | `?bank=<id>` | Sincronizza manualmente i movimenti del conto |
| `GET` | `/bank/transactions` | `?bank=<id>&startDate=<YYYY-MM-DD>&endDate=<YYYY-MM-DD>` | Elenco movimenti sincronizzati con filtri periodo |
| `POST` | `/bank/import` | `{ transactionIds: string[], walletId: number, categoryId: number, defaultType?: "I" \| "E" }` | Converte transazioni bancarie in entrate/spese nei Wallet |
| `POST` | `/bank/disconnect` | `?bank=<id>` | Disconnette la banca conservando lo storico dei movimenti |
| `GET` | `/bank/scheduler/status` | Header `x-scheduler-secret` | Stato dello scheduler di sincronizzazione periodica |
| `POST` | `/bank/scheduler/sync-now` | Header `x-scheduler-secret` | Forza sincronizzazione globale per tutti gli utenti connessi |

### Saldo del conto

A ogni sincronizzazione, dopo l'upsert dei movimenti, `syncBankTransactions` legge il saldo del conto (`fetchAccountBalance`, endpoint GoCardless `/accounts/<id>/balances/`) e lo salva nelle colonne `balance_*` di `bank_connections`. Se il provider restituisce più saldi, `normalizeAccountBalance` sceglie in quest'ordine: `available`, `current`, `interimAvailable`, `interimBooked`, `booked`, `closingBooked`. In modalità mock il saldo è fisso (2450,75 EUR, tipo `mock`).

Il saldo è informativo: se la sua lettura fallisce, la sincronizzazione dei movimenti va avanti e resta l'ultimo saldo salvato. `/bank/status` e `/bank/connections` lo espongono come `balance: { amount, currency, type, referenceDate, providerUpdatedAt, fetchedAt }`, oppure `null` se non è mai stato letto.

---

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
   - Aggiorna lo stato in `bank_transactions` a `"imported"`.
   - Invalida la cache TanStack Query per aggiornare istantaneamente Dashboard, Wallet ed elenchi Entrate/Spese.

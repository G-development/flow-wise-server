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
- Configura `BANK_PROVIDER=gocardless`, `GOCARDLESS_SECRET_ID` e `GOCARDLESS_SECRET_KEY`.

---

## Configurazione Server (.env)

```env
# Modalità provider ("mock" per sviluppo locale / "gocardless" per banche reali)
BANK_PROVIDER=mock

# URI di reindirizzamento OAuth
BANK_REDIRECT_URI=http://localhost:5030/bank/callback
BANK_CLIENT_REDIRECT_URI=http://localhost:3000/settings/yourbank

# (Opzionale se BANK_PROVIDER=gocardless)
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

### Struttura Tabelle:
- **`bank_connections`**: memorizza `user_id`, `bank_id`, `account_id`, `access_token`, `refresh_token`, `token_expires_at`, `last_synced`.
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
| `GET` | `/bank/status` | `?bank=<id>` | Stato connessione, account ID e timestamp ultimo sync |
| `GET` | `/bank/connections` | — | Elenco di tutte le banche connesse dall'utente |
| `POST` | `/bank/sync` | `?bank=<id>` | Sincronizza manualmente i movimenti del conto |
| `GET` | `/bank/transactions` | `?bank=<id>&startDate=<YYYY-MM-DD>&endDate=<YYYY-MM-DD>` | Elenco movimenti sincronizzati con filtri periodo |
| `POST` | `/bank/import` | `{ transactionIds: string[], walletId: number, categoryId: number, defaultType?: "I" \| "E" }` | Converte transazioni bancarie in entrate/spese nei Wallet |
| `POST` | `/bank/disconnect` | `?bank=<id>` | Disconnette la banca conservando lo storico dei movimenti |
| `GET` | `/bank/scheduler/status` | Header `x-scheduler-secret` | Stato dello scheduler di sincronizzazione periodica |
| `POST` | `/bank/scheduler/sync-now` | Header `x-scheduler-secret` | Forza sincronizzazione globale per tutti gli utenti connessi |

---

## Flusso di Importazione Movimenti in Flow Wise

1. L'utente accede a `/settings/yourbank`.
2. Le transazioni vengono filtrate per periodo (default: dal 1° del mese corrente a oggi).
3. L'utente seleziona una o più transazioni (selezione singola o massiva con checkbox header).
4. Apre il modale di importazione ([ImportTransactionDialog.tsx](../flow-wise-client/app/settings/yourbank/ImportTransactionDialog.tsx)).
5. Seleziona il **Wallet di destinazione** e la **Categoria**.
6. Il client invia la richiesta a `POST /bank/import`:
   - Crea i record nella tabella `Transaction` di Flow Wise (`amount > 0` &rarr; Entrata `"I"`, `amount < 0` &rarr; Spesa `"E"`).
   - Aggiorna lo stato in `bank_transactions` a `"imported"`.
   - Invalida la cache TanStack Query per aggiornare istantaneamente Dashboard, Wallet ed elenchi Entrate/Spese.

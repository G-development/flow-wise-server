# Flow Wise Server

Backend Express 4 (ESM) per le API di Flow Wise. Usa Supabase per autenticazione
e database; il client server-side usa `SUPABASE_SERVICE_ROLE_KEY`, quindi le
route utente filtrano i dati con l'ID ottenuto dal bearer token.

## Struttura

```text
server.js             bootstrap Express, CORS, statici e route
config/               client Supabase, auth e Cloudinary
routes/               API HTTP
agents/               integrazioni e logica dell'agente AI
utils/                validazione, servizi bancari, saldo wallet e reset password
migrations/           migrazioni SQL presenti nel repository
public/               pagina informativa degli endpoint
```

## Configurazione

Copia `.env.example` in `.env`. In locale servono almeno `SUPABASE_URL` e
`SUPABASE_SERVICE_ROLE_KEY`; `PORT` è opzionale e predefinita a `5030`.
Configura `ALLOWED_ORIGINS` per le origini frontend non incluse nelle
impostazioni di sviluppo. Conserva le chiavi solo nell'ambiente server e non
committare `.env`.

Per l'agente AI configura `LLM_API_KEY`. In assenza di override, usa l'API
compatibile OpenAI di Groq (`LLM_API_BASE_URL=https://api.groq.com/openai/v1`)
e il modello `qwen/qwen3.8-27b`; entrambi possono essere cambiati con
`LLM_API_BASE_URL` e `LLM_MODEL`. Le spese aggregate e alcuni dettagli delle
transazioni vengono inviati al provider AI configurato.

L'integrazione bancaria supporta sia la modalità locale **Sandbox/Mock** (default)
sia l'integrazione **Open Banking PSD2 reale tramite GoCardless** (configurando
`GOCARDLESS_SECRET_ID` e `GOCARDLESS_SECRET_KEY`). Usa inoltre `BANK_REDIRECT_URI`,
`BANK_CLIENT_REDIRECT_URI`, `BANK_SYNC_CRON` e `BANK_SCHEDULER_SECRET`. Il reset
password usa la configurazione SMTP e `FRONTEND_URL`. Consulta `.env.example` per
le altre variabili opzionali Cloudinary e SMTP.

Attenzione a due variabili il cui valore mancante non produce errori evidenti:

- `BANK_PROVIDER` (insieme a `BANK_MOCK_ENABLED`) decide **mock o live** ed è
  letta davvero dal codice in `isMockBankModeEnabled()`
  (`utils/bankService.js`): la sandbox `/bank/mock-auth` e i movimenti simulati
  sono attivi solo con `BANK_MOCK_ENABLED` impostata a `true`/`1`/`yes`/`on`
  oppure con `BANK_PROVIDER=mock`. In ogni altro caso il server è in modalità
  **live**, dove un errore del provider GoCardless risale come errore e non
  diventa mai un movimento finto; il live richiede `GOCARDLESS_SECRET_ID` e
  `GOCARDLESS_SECRET_KEY`.
- senza `BANK_SCHEDULER_SECRET` le route `/bank/scheduler/status` e
  `/bank/scheduler/sync-now` rispondono `503`.

Senza `SMTP_HOST` invece la richiesta di reset fallisce in modo visibile:
`POST /auth/forgot-password` risponde `502` con l'errore reale e non lascia alcun
token in `password_reset_tokens`, perché `requestPasswordReset` salva il token
solo **dopo** che l'email è partita.

## Avvio

```bash
npm install
npm run dev
```

`npm run dev` usa `node --watch server.js`; `npm start` avvia `server.js`.
`GET /healthz` risponde con `204`. Il server avvia lo scheduler di sync
bancario all'avvio (cron configurabile, default ogni ora).

## Route

Tutte le route principali sono montate in `server.js`.

| Prefisso | Funzioni |
| --- | --- |
| `/users` | Registrazione, profilo e avatar |
| `/auth` | Reset password via email, verifica token e aggiornamento password |
| `/transaction` | `GET /all`, `GET /:id`, creazione, modifica ed eliminazione transazioni |
| `/income`, `/expense` | Elenchi filtrabili per data e tipo |
| `/category`, `/wallet` | CRUD categorie e wallet |
| `/dashboard-layout` | Lettura/salvataggio layout dashboard |
| `/import` | Import CSV autenticato |
| `/bank` | Configurazione provider, OAuth PSD2/Sandbox, sincronizzazione movimenti, filtri data e importazione massiva |
| `/agents/analytics` | Analisi AI delle spese |

Le route protette verificano `Authorization: Bearer <supabase_access_token>`
tramite `requireAuth`. L'elenco dettagliato delle route bancarie e le migrazioni
sono in [BANK_INTEGRATION.md](./BANK_INTEGRATION.md).

`GET /wallet`, `POST /wallet` e `PUT /wallet/:id` rispondono sempre con la stessa
forma della risorsa: il `balance` è **derivato dalle transazioni** a ogni lettura
(`utils/walletService.js`, che parte da `Wallet.opening_balance_cents`, pagina le
transazioni perché PostgREST tronca a 1000 righe e somma in centesimi in assenza di
aggregati SQL). La colonna `Wallet.balance` è stata **rimossa** da
`migrations/005_drop_wallet_balance.sql`: nessun percorso la scrive, la legge o la
restituisce, e non va reintrodotta come fonte di verità (il campo `balance` delle
risposte è calcolato, non letto). `PUT /wallet/:id` accetta `name`, `is_default` e
`opening_balance_cents`, mai un `balance` finale.

Gli **invarianti dei wallet** — massimo 3 per utente, esattamente un default — sono
vincoli del DB (migrazione 004): la route non li ricontrolla, traduce l'errore che il
database solleva. `POST /wallet` tenta direttamente l'insert e risponde **409**
(`Max 3 wallets allowed per user`, senza il testo interno del DB) quando il DB rifiuta
il quarto wallet; il primo wallet nasce default per volontà del DB, non della route.
`PUT /wallet/:id` con `is_default: true` esegue la RPC `wallet_set_default` in **una
sola** richiesta — la vecchia coppia di UPDATE ora fallirebbe, perché il primo commit
senza default viene respinto — e risponde **404** se il wallet non esiste o non è
dell'utente, **409** se l'operazione lascerebbe l'utente senza default. Se la 004 non è
applicata la RPC non esiste: la route risponde **503** dicendo quale migrazione manca,
invece di lasciare il cambio di default rotto senza spiegazione.

Le **route di lista** (`GET /income/all`, `/expense/all`, `/transaction/all`,
`/bank/transactions`) non si fermano più al tetto di PostgREST: leggono con
`utils/paginatedSelect.js` (`fetchAllRows`) e rispondono con l'envelope
`{ data, count, truncated, total }` — `{ transactions, count, truncated, total }`
per `/bank/transactions`, che tiene la sua chiave. `count` è il numero di righe
restituite, `total` quello del range secondo il database, e `truncated: true`
dichiara che le righe sono tagliate al tetto di paginazione: il client deve dirlo
invece di presentare le somme come definitive.

## Push gate

Il repo versiona un hook `pre-push` in `.githooks/pre-push`, attivo quando
`git config core.hooksPath .githooks` è impostato. L'hook **rifiuta il push**
finché non esiste un'approvazione per lo **SHA esatto** del commit corrente; il
file di approvazione vive in `.git/` (non tracciato) e si crea con:

```bash
printf '%s' "$(git rev-parse HEAD)" > "$(git rev-parse --git-dir)/hermes-push-approval"
```

L'approvazione vale per un solo commit: appena aggiungi un commit il gate si
richiude da solo. Superato il gate, l'hook esegue `npm test` (`node --test`, gli
invarianti) e poi controlla la sintassi dei file JavaScript con `node --check`
prima di lasciar passare il push (il server non ha un typecheck). L'uscita
consapevole, che salta gate e check, è `HERMES_PUSH_APPROVED=1 git push`. Lo
stesso meccanismo vale per il repo del client, il cui `npm test` esegue
`node --test`, `npx tsc --noEmit` e `next build`.

## Agente di analytics delle spese

`POST /agents/analytics` accetta `question`, `startDate` e `endDate`; le date
usano `YYYY-MM-DD` e, se omesse, coprono il mese corrente fino a oggi. Il
backend recupera solo spese dell'utente autenticato, al massimo 1.000 per
richiesta (`range` di PostgREST è inclusivo, quindi la pagina è
`.range(0, limit - 1)`), e invia al modello un riepilogo aggregato: totale,
media, totali per categoria e mese, e fino a dieci esempi di spesa con
descrizioni limitate. Il totale reale del periodo arriva da una count query
separata, quindi la risposta dichiara sempre la copertura: `analysis` inizia con
"Ho analizzato N movimenti su M del periodo" e, se il periodo contiene più
movimenti del limite, avvisa che l'analisi copre solo i primi N. Gli stessi
numeri sono nel payload in `coverage` (`rowsFetched`, `totalRows`, `limit`,
`truncated`, `notice`) e in `transactionsAnalyzed` / `totalTransactions`. Ogni
richiesta è indipendente; non esiste memoria conversazionale.

```bash
curl -X POST http://localhost:5030/agents/analytics \
  -H "Authorization: Bearer <supabase_access_token>" \
  -H "Content-Type: application/json" \
  -d '{"question":"Quali sono le mie spese principali?","startDate":"2026-05-01","endDate":"2026-05-31"}'
```

Le richieste non valide restituiscono errori HTTP; l'assenza di
`LLM_API_KEY` restituisce `503`, timeout provider `504` e risposta AI non
riuscita `502`. Il codice non salva la conversazione.

## Database e Migrazioni

Le route dati assumono che le tabelle applicative Supabase (`Transaction`,
`Category`, `Wallet`, `Profile`, `dashboard_layouts`, `bank_connections` e
`bank_transactions`) siano già predisposte. Le migrazioni incluse nella cartella
`migrations/` contengono le definizioni SQL per le tabelle bancarie, i token di
reset password, il saldo di apertura dei wallet, gli invarianti dei wallet e la
rimozione della colonna fantasma `Wallet.balance`:

- `003_wallet_opening_balance.sql` — aggiunge `Wallet.opening_balance_cents`
  (integer, NOT NULL, default 0), il punto di partenza della somma derivata in
  `utils/walletService.js`, e fa il backfill dei wallet esistenti con
  `opening_balance_cents = round(balance * 100) - somma_movimenti`, così il saldo
  derivato coincide con il `balance` memorizzato. Il file è idempotente e la sua
  ultima `SELECT` è il log dei wallet toccati; richiede tabelle `Transaction`
  valorizzate (nell'SQL editor di Supabase, oppure
  `node backfill-opening-balance.mjs --apply`).
- `004_wallet_invariants.sql` — rende invarianti del DB il limite di **3 wallet
  per utente** e l'**esattamente-un default**: indice unico parziale
  `wallet_one_default_per_user_idx`, trigger `BEFORE INSERT/UPDATE` (limite +
  primo wallet forzato a default, serializzato da un advisory lock per utente),
  trigger `AFTER DELETE` (eliminando il default ne promuove un altro) e
  constraint trigger `DEFERRABLE INITIALLY DEFERRED` che al commit pretende
  esattamente un default per ogni utente che possiede wallet. Il cambio di
  default diventa la RPC `wallet_set_default(p_userid uuid, p_wallet_id integer)`,
  una sola operazione atomica. Errori riconoscibili: SQLSTATE `45001`
  `wallet_limit_exceeded`, `45002` `wallet_default_missing`, `45003`
  `wallet_not_found`, più `23505` sull'indice unico. La migrazione è idempotente,
  parte da un pre-check che la fa fallire senza applicare nulla se i dati
  esistenti violano già l'invariante, e ha il rollback in
  `004_wallet_invariants.down.sql`. Va applicata **insieme** al refactor di
  `routes/wallet.js`: la vecchia sequenza "azzera tutti + setta quello
  richiesto", fatta di due richieste separate, ora incontra `45002`.
- `005_drop_wallet_balance.sql` — rimuove la colonna fantasma `Wallet.balance`
  (`DROP COLUMN IF EXISTS`, idempotente). Il valore utile è già in
  `opening_balance_cents` dal backfill di `003`, e nessuna view, policy o
  dipendenza Postgres referenzia la colonna, quindi il drop è sicuro anche su dati
  discordanti; da qui in poi il saldo è solo quello derivato. Il rollback di
  struttura è in `005_drop_wallet_balance.down.sql` (ricrea la colonna col suo
  default, **non** i valori). Va eseguita **dopo** `003`: `003` legge
  `Wallet.balance` per il backfill e dopo il drop non è più rieseguibile.

`backfill-opening-balance.mjs` è la versione da terminale della regola di `003`:
dry-run di default, `--apply` per scrivere, rilettura del DB per verificare
`balance == (opening_balance_cents + movimenti) / 100`. È **storico**: dopo
`005_drop_wallet_balance.sql` la colonna `balance` non esiste più, quindi lo script
si ferma con un messaggio esplicito e l'apertura si modifica dalla pagina /wallets
(`PUT /wallet/:id`). I wallet nuovi non richiedono backfill: partono dal default 0.

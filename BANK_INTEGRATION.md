# Integrazione Bancaria - Flow Wise

L'integrazione bancaria di Flow Wise consente agli utenti di connettere in modo sicuro i propri conti bancari e sincronizzare automaticamente i movimenti finanziari.

## Modalità supportate

1. **Sandbox / Mock (Predefinita per sviluppo e demo)**:
   - Permette di testare l'intero flusso Open Banking (autorizzazione OAuth interattiva, sincronizzazione di movimenti realistici negli ultimi 90 giorni, importazione nei wallet dell'app) senza bisogno di credenziali bancarie esterne.
   - Banche simulate: *FlowWise Sandbox Bank, Intesa Sanpaolo, UniCredit, BNL - BNP Paribas, Poste Italiane, Revolut, Fineco Bank*.
   
2. **GoCardless (ex Nordigen) Open Banking PSD2 (Reale)**:
   - Connessione a oltre 2.500 banche europee e italiane con licenza AISP ufficiale.
   - Configura `BANK_PROVIDER=gocardless`, `GOCARDLESS_SECRET_ID` e `GOCARDLESS_SECRET_KEY`.

## Configurazione Server (.env)

```env
# Modalità provider ("mock" per sviluppo / "gocardless" per banche reali)
BANK_PROVIDER=mock

# URI di reindirizzamento
BANK_REDIRECT_URI=http://localhost:5030/bank/callback
BANK_CLIENT_REDIRECT_URI=http://localhost:3000/settings/yourbank

# Scheduler sincronizzazione automatica
BANK_SYNC_CRON=0 * * * *
BANK_SCHEDULER_SECRET=il_tuo_segreto_scheduler
```

## Database Supabase

Assicurati di aver eseguito le migrazioni SQL in ordine:
1. `migrations/001_create_bank_tables.sql`
2. `migrations/002_scope_bank_transaction_ids.sql`

## API Endpoints

Tutte le route (tranne `/bank/mock-auth`, `/bank/callback` e scheduler) richiedono Bearer Token Supabase nell'header `Authorization`.

| Metodo | Route | Scopo |
| --- | --- | --- |
| `GET` | `/bank/config` | Verifica disponibilità provider e tabelle database |
| `GET` | `/bank/institutions` | Elenco istituti bancari disponibili |
| `GET` | `/bank/authorize?bank=<id>` | Genera URL per l'autorizzazione bancaria |
| `GET` | `/bank/mock-auth` | Pagina web sandbox per confermare l'autorizzazione test |
| `GET` | `/bank/callback` | Callback OAuth: scambia codice e salva conto |
| `GET` | `/bank/status?bank=<id>` | Stato connessione e data ultimo sync |
| `GET` | `/bank/connections` | Elenco di tutte le banche connesse dall'utente |
| `POST` | `/bank/sync?bank=<id>` | Sincronizza i movimenti bancari |
| `GET` | `/bank/transactions?bank=<id>` | Elenco movimenti sincronizzati |
| `POST` | `/bank/import` | Converte transazioni bancarie in entrate/spese nei Wallet |
| `POST` | `/bank/disconnect?bank=<id>` | Disconnette la banca |
| `GET` | `/bank/scheduler/status` | Stato dello scheduler (richiede `x-scheduler-secret`) |
| `POST` | `/bank/scheduler/sync-now` | Forza sincronizzazione globale (richiede `x-scheduler-secret`) |

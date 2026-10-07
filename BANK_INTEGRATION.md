# Integrazione bancaria Flow Wise

Il client usa le route `/bank` del server per collegare un istituto, controllare lo
stato della connessione, sincronizzare i movimenti e disconnettere il conto. Le
credenziali OAuth bancarie restano sul server; le route utente richiedono il token
Supabase in `Authorization: Bearer <access_token>`.

## Configurazione

Nel `.env` del server:

```env
BANK_CLIENT_ID=client_id_fornito_dal_provider
BANK_CLIENT_SECRET=secret_fornito_dal_provider
BANK_REDIRECT_URI=https://api.example.com/bank/callback
BANK_CLIENT_REDIRECT_URI=https://app.example.com/settings/yourbank
# Prima del deploy live, sostituire nel codice gli endpoint sandbox con quelli ufficiali
BANK_SYNC_CRON=0 * * * *
BANK_SCHEDULER_SECRET=use_a_long_random_secret
```

Registra `BANK_REDIRECT_URI` nel portale del provider. Configura
`BANK_CLIENT_REDIRECT_URI` con l'URL della pagina bancaria del client per ogni
ambiente. `BANK_CLIENT_SECRET` firma anche lo `state` OAuth, che scade dopo dieci
minuti. Lo state è cifrato e autenticato: l'ID utente non viene esposto nell'URL
di autorizzazione.

Le URL in `utils/bankService.js` sono attualmente endpoint sandbox segnaposto:
prima di usare credenziali reali o distribuire in produzione, sostituiscile con
gli endpoint OAuth/API ufficiali forniti da ciascun istituto.

## Database

Esegui in ordine nel database Supabase:

1. `migrations/001_create_bank_tables.sql`
2. `migrations/002_scope_bank_transaction_ids.sql`

La seconda migrazione sostituisce l'unicità globale degli ID transazione con una
chiave per utente, banca e conto. Le transazioni bancarie restano nella tabella
`bank_transactions`, separate dalle entrate/spese manuali dell'app. La
disconnessione elimina la connessione e i token; mantiene lo storico già
sincronizzato.

## API e flusso OAuth

Tutte le route seguenti, tranne il callback del provider, richiedono un bearer
token Supabase valido.

| Metodo | Route | Funzione |
| --- | --- | --- |
| `GET` | `/bank/config` | Verifica prerequisiti server e migrazioni, senza restituire segreti |
| `GET` | `/bank/institutions` | Elenco degli istituti configurati |
| `GET` | `/bank/authorize?bank=<id>` | Crea l'URL OAuth e lo `state` cifrato |
| `GET` | `/bank/callback` | Scambia il codice, salva il conto, avvia la prima sincronizzazione e reindirizza al client |
| `GET` | `/bank/status?bank=<id>` | Stato del collegamento per l'utente autenticato |
| `POST` | `/bank/sync?bank=<id>` | Rinnova il token se necessario e sincronizza i movimenti |
| `GET` | `/bank/transactions?bank=<id>` | Legge i movimenti sincronizzati |
| `POST` | `/bank/disconnect?bank=<id>` | Rimuove i token e la connessione dell'utente |

Il server genera lo `state` cifrato usando l'ID dell'utente autenticato e l'ID
della banca. Il provider torna direttamente a `BANK_REDIRECT_URI`; il callback
verifica lo `state` senza fidarsi di un `x-user-id` inviato dal browser. A esito
positivo, il server reindirizza il client con `?connected=1&bank=<id>`; in caso
di errore usa `error_description`.

Esempio risposta stato:

```json
{
  "connected": true,
  "bank": "intesa",
  "account": "account_123",
  "lastSynced": "2026-10-05T14:30:00Z"
}
```

La sincronizzazione importa i movimenti degli ultimi 90 giorni e li aggiorna
usando la chiave utente/banca/conto/ID esterno. Il refresh dei token e
`last_synced` vengono aggiornati sul server. La pagina bancaria mostra e aggiorna
questo feed; non crea automaticamente entrate o spese nella tabella `Transaction`,
perché servono wallet e categoria scelti dall'utente.

## Scheduler

Lo scheduler usa `BANK_SYNC_CRON` (default `0 * * * *`). Le route di monitoraggio
e sincronizzazione globale richiedono l'header `x-scheduler-secret` uguale a
`BANK_SCHEDULER_SECRET`; se il segreto non è configurato, restano disabilitate:

```bash
curl http://localhost:5030/bank/scheduler/status \
  -H "x-scheduler-secret: $BANK_SCHEDULER_SECRET"

curl -X POST http://localhost:5030/bank/scheduler/sync-now \
  -H "x-scheduler-secret: $BANK_SCHEDULER_SECRET"
```

## Prima della produzione

- Verifica endpoint, scope e formati OAuth/transazioni con ciascun provider.
- Imposta credenziali e redirect URI di produzione.
- Applica entrambe le migrazioni Supabase.
- Verifica che l'ambiente di deploy mantenga attivo lo scheduler; per runtime
  serverless può essere necessario un cron esterno.
- Prova autorizzazione, callback, primo sync, sync successivo, rinnovo token e
  disconnessione con un account sandbox.

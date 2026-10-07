# Integrazione bancaria

L'integrazione bancaria è una funzionalità prototipale del server Flow Wise.
`routes/bank.js` espone le API; `utils/bankService.js` contiene OAuth, chiamate
al provider e persistenza; `utils/bankSyncScheduler.js` avvia la sincronizzazione
periodica.

## Stato e prerequisiti

Le banche configurate nel codice sono Intesa Sanpaolo, UniCredit e BNL, con URL
di esempio per ambienti sandbox. Questi endpoint sono segnaposto/sandbox e
devono essere sostituiti e verificati con quelli ufficiali prima dell'uso reale
o del deployment di produzione.

Configura sul server:

```env
BANK_CLIENT_ID=...
BANK_CLIENT_SECRET=...
BANK_REDIRECT_URI=http://localhost:5030/bank/callback
BANK_CLIENT_REDIRECT_URI=http://localhost:3000/settings/yourbank
BANK_SYNC_CRON=0 * * * *
BANK_SCHEDULER_SECRET=...
```

`GET /bank/config` controlla che le variabili richieste siano presenti e che le
tabelle bancarie siano interrogabili. Il flusso OAuth crea uno `state` cifrato
e autenticato con scadenza di dieci minuti, contenente utente e banca; il
callback non si fida di un ID utente passato dal browser.

## Database

Applica le migrazioni SQL bancarie nell'ordine:

1. `migrations/001_create_bank_tables.sql`
2. `migrations/002_scope_bank_transaction_ids.sql`

`bank_connections` memorizza i token/account della connessione.
`bank_transactions` conserva i movimenti importati, separati dalla tabella
`Transaction` usata per entrate e spese dell'app. La seconda migrazione porta
l'unicità delle transazioni alla combinazione utente, banca, conto e ID esterno.
La disconnessione elimina la connessione; non elimina i movimenti importati.

`migrations/002_create_password_reset_tokens.sql` è una migrazione separata e
non appartiene al flusso bancario.

## API

Tutte le route elencate richiedono un bearer token Supabase, tranne il callback
OAuth e le route scheduler, che usano rispettivamente lo `state` e il segreto
scheduler.

| Metodo | Route | Scopo |
| --- | --- | --- |
| `GET` | `/bank/config` | Verifica configurazione e tabelle |
| `GET` | `/bank/institutions` | Restituisce gli istituti configurati |
| `GET` | `/bank/authorize?bank=<id>` | Restituisce l'URL OAuth |
| `GET` | `/bank/callback` | Scambia il codice, salva il conto e prova il primo sync |
| `GET` | `/bank/status?bank=<id>` | Stato e data ultima sincronizzazione |
| `POST` | `/bank/sync?bank=<id>` | Aggiorna token scaduto e sincronizza |
| `GET` | `/bank/transactions?bank=<id>` | Elenco movimenti, filtrabile per banca |
| `POST` | `/bank/disconnect?bank=<id>` | Rimuove la connessione dell'utente |
| `GET` | `/bank/scheduler/status` | Stato scheduler, protetto da segreto |
| `POST` | `/bank/scheduler/sync-now` | Avvia sync globale, protetto da segreto |

Il callback reindirizza a `BANK_CLIENT_REDIRECT_URI` con parametri di esito.
Se il salvataggio della connessione riesce ma il primo sync fallisce, il
redirect segnala `sync_error=1`. La sincronizzazione importa gli ultimi 90
giorni e aggiorna i record usando la chiave utente/banca/conto/ID esterno.

## Scheduler

All'avvio, `server.js` avvia lo scheduler con `BANK_SYNC_CRON` (default:
ogni ora). Le route scheduler verificano `x-scheduler-secret` confrontandolo
con `BANK_SCHEDULER_SECRET`; senza segreto configurato sono disabilitate.

```bash
curl http://localhost:5030/bank/scheduler/status \
  -H "x-scheduler-secret: $BANK_SCHEDULER_SECRET"

curl -X POST http://localhost:5030/bank/scheduler/sync-now \
  -H "x-scheduler-secret: $BANK_SCHEDULER_SECRET"
```

La pagina Your Bank mostra i movimenti sincronizzati; il backend non li
converte automaticamente in transazioni dell'app con wallet e categoria.

## Prima dell'uso reale

- Sostituisci URL sandbox e verifica protocollo, scope e formati con ogni banca.
- Configura redirect URI, credenziali e migrazioni per ciascun ambiente.
- Prova OAuth, callback, sync, refresh e disconnessione con account sandbox.
- Per runtime serverless, verifica il ciclo di vita dello scheduler; potrebbe
  essere necessario un servizio cron esterno.

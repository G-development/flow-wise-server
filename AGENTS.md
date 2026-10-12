# flow-wise-server

Backend Express 4 (ESM, **JavaScript puro — questo repo non ha TypeScript**) di Flow-Wise, l'app di
finanza personale di Gio. È una metà di un progetto su due repo: l'altra è `~/Projects/flow-wise-client`.

Questo file viene letto automaticamente quando la sessione gira **dentro** questo repo: la catena è dal
git root fino alla cwd, quindi vale anche da una sottocartella (verificato sul sorgente:
`_agents_md_directory_chain` in `agent/prompt_builder.py`). Per ogni cartella vince il primo nome non
vuoto tra `AGENTS.override.md`, `AGENTS.md` e `agents.md`, e le sezioni si fondono root → cwd.

Hermes carica **un solo tipo** di file di contesto, in quest'ordine di priorità: `.hermes.md` →
`AGENTS.md` → `CLAUDE.md` → `.cursorrules`. Quindi **non aggiungere anche un `.hermes.md`** qui:
vincerebbe lui e questo file diventerebbe peso morto che deriva in silenzio. Per vedere cosa è davvero
caricato c'è `/context` in sessione.

## Dove sta la verità — non duplicarla qui

| Cosa | Dove |
| --- | --- |
| Architettura, data model, limiti noti, stato, workflow multi-agente, push gate | skill **`flow-wise`** — caricala prima di lavorare |
| Indice file-per-file (route, export, migrazioni) | `CODE_MAP.md` in questo repo |
| Setup, variabili d'ambiente, panoramica route | `README.md` |
| Route bancarie, modalità mock/live, migrazioni | `BANK_INTEGRATION.md` |

Se una regola vale per entrambi i repo, sta nella skill; qui solo ciò che è locale a questo.

## Convenzioni del repo

- ESM ovunque (`import` / `export`), nessun `require`.
- Validazione dei body con Zod in `utils/schemas.js`; le route la applicano con `validate(schema)`.
- Handler dentro `asyncHandler(...)`: serve a far arrivare gli errori all'error handler globale.
- Il client Supabase usa la **service-role key**, quindi ogni query filtra esplicitamente per
  `userid` preso dal token (`requireAuth`). Una query nuova senza quel filtro è un bug di isolamento.
- Le route di lista leggono con `utils/paginatedSelect.js` (`fetchAllRows` → envelope
  `{ data, count, truncated, total }`): PostgREST tronca a 1000 righe senza dirlo.
- Le migrazioni in `migrations/` sono numerate e idempotenti; una `.down.sql` accompagna quelle
  reversibili. Il fatto che il file esista **non** dice che sia applicato sul progetto live: l'applicato
  è una proprietà del database.
- I test sono `*.test.js` accanto al modulo, con `node --test` e il client finto in `testutils/`.

## Verifica prima di affermare

```bash
npm test                                                     # node --test, gli invarianti
for f in $(find . -name "*.js" -not -path "./node_modules/*"); do node --check "$f"; done
```

Per qualcosa che il server *serve* (la pagina `public/`, CORS, uno status code) va avviato su una porta
libera e interrogato con curl. **Registra il PID e uccidi quel PID**:

```bash
(PORT=5099 node server.js > /tmp/fw-serve.log 2>&1 & echo $! > /tmp/fw-serve.pid)
sleep 3 && curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5099/healthz
kill "$(cat /tmp/fw-serve.pid)"
```

Mai `pkill -f "node server.js"`: combacia anche con il `npm run dev` di Gio e gli spegne il server.

## Guardrail

- **Push gated**: `.githooks/pre-push` rifiuta il push finché non esiste un'approvazione per lo **SHA
  esatto**. Autorizza Gio; l'agente non approva mai da solo. Un commit nuovo riapre il gate.
- Il `balance` di un wallet è **derivato** dalle transazioni (`utils/walletService.js`, da
  `opening_balance_cents`). La colonna `Wallet.balance` è stata rimossa: non reintrodurla.
- `public/index.html` è la pagina indice delle API (`GET /`): è scritta a mano e va tenuta allineata
  alle route reali — vedi la skill.

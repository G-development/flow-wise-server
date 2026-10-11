/**
 * Lettura paginata delle query Supabase/PostgREST, con flag esplicito di troncamento.
 *
 * ## Perché esiste
 *
 * PostgREST applica un tetto di righe per richiesta (1000 per default su questo
 * progetto). Una `select()` senza `.range()` restituisce quindi al massimo 1000
 * righe **senza errore e senza indicazione nel payload**: le righe oltre il tetto
 * spariscono in silenzio. Verificato sul progetto reale: la tabella `Transaction`
 * ha 1315 righe, una select una-shot ne restituisce esattamente 1000.
 *
 * Questo helper incapsula il ciclo di paginazione già usato da
 * `utils/walletService.js`, con una differenza deliberata: `walletService` somma
 * le righe e preferisce un **errore** se supera il limite di sicurezza (un saldo
 * parziale silenzioso sarebbe peggio di un errore), mentre una lista di righe può
 * legittimamente fermarsi al tetto **purché lo dichiari**. Da qui il flag
 * `truncated` invece di un throw.
 *
 * `walletService.js` è lasciato intatto di proposito: aggrega in una Map invece di
 * raccogliere le righe, e la sua semantica "fail loudly" è la ragione per cui il
 * saldo è corretto. Non unificare i due loop senza rileggere il suo header comment.
 *
 * ## Uso
 *
 * ```js
 * const { rows, truncated, count, total } = await fetchAllRows(() =>
 *   supabase
 *     .from("Transaction")
 *     .select("*", { count: "exact" })   // opzionale: abilita `total`
 *     .eq("userid", userId)
 *     .order("date", { ascending: false })
 *     .order("id", { ascending: false }) // <= tiebreaker, vedi sotto
 * );
 * res.status(200).json(toListResponse({ rows, truncated, count, total }));
 * ```
 *
 * ## Ordine deterministico (importante)
 *
 * `buildQuery` deve produrre un ordinamento **totale**. Con un ordine non univoco
 * (es. solo `date`, che si ripete su molte righe) Postgres non garantisce lo
 * stesso ordine tra una pagina e l'altra: si possono ottenere duplicati o righe
 * saltate. Aggiungere sempre un tiebreaker univoco, tipicamente `.order("id", …)`
 * come ultimo `.order()`. `walletService.js` ordina per `id` — è la ragione per
 * cui il suo totale è affidabile.
 *
 * @module utils/paginatedSelect
 */

/** Righe per richiesta: il massimo che PostgREST restituisce su questo progetto. */
export const DEFAULT_PAGE_SIZE = 1000;

/**
 * Tetto di sicurezza sul numero di pagine. Serve a non trasformare un errore di
 * filtro (es. un `userid` mancante) in un ciclo potenzialmente infinito.
 */
export const DEFAULT_MAX_PAGES = 100;

const assertPositiveInteger = (value, name) => {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(
      `fetchAllRows: ${name} deve essere un intero >= 1 (ricevuto: ${value})`
    );
  }
};

/**
 * Legge tutte le righe di una query Supabase iterando `.range(offset, offset + pageSize - 1)`
 * finché una pagina torna con meno di `pageSize` righe.
 *
 * @param {() => object} buildQuery
 *   Funzione che restituisce una **nuova** query Supabase già filtrata e ordinata
 *   (senza `.range()`: lo applica l'helper). Deve essere una factory, non una query
 *   costruita una volta sola, così ogni pagina è una catena indipendente.
 * @param {object} [options]
 * @param {number} [options.pageSize=1000] Righe per richiesta.
 * @param {number} [options.maxPages=100] Numero massimo di pagine lette.
 * @returns {Promise<{rows: Array<Record<string, unknown>>, truncated: boolean, count: number, total: number|null, pagesFetched: number}>}
 *   - `rows` — tutte le righe raccolte, nell'ordine della query.
 *   - `truncated` — `true` se il set è stato tagliato al tetto `maxPages`
 *     (l'ultima pagina letta era piena). È un **limite superiore**: con un numero
 *     di righe esattamente pari a `maxPages * pageSize` vale `true` anche se in
 *     realtà non c'era altro da leggere. Mai `false` su un set incompleto.
 *   - `count` — righe restituite (`rows.length`).
 *   - `total` — totale delle righe del range dichiarato dal database, oppure
 *     `null` se la query non è stata costruita con `select(..., { count: "exact" })`.
 *   - `pagesFetched` — pagine effettivamente richieste (diagnostica).
 * @throws {TypeError|RangeError} argomenti non validi.
 * @throws {Error} al primo errore PostgREST: una lista parziale silenziosa è peggio
 *   di una richiesta fallita.
 */
export const fetchAllRows = async (
  buildQuery,
  { pageSize = DEFAULT_PAGE_SIZE, maxPages = DEFAULT_MAX_PAGES } = {}
) => {
  if (typeof buildQuery !== "function") {
    throw new TypeError(
      "fetchAllRows: buildQuery deve essere una funzione che restituisce una nuova query Supabase"
    );
  }
  assertPositiveInteger(pageSize, "pageSize");
  assertPositiveInteger(maxPages, "maxPages");

  const rows = [];
  let total = null;
  let pagesFetched = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const to = from + pageSize - 1;

    const { data, error, count } = await buildQuery().range(from, to);

    if (error) {
      throw new Error(error.message);
    }

    pagesFetched += 1;

    // `count` è presente solo se la query usa select(..., { count: "exact" }).
    if (total === null && typeof count === "number") {
      total = count;
    }

    const pageRows = data ?? [];
    rows.push(...pageRows);

    if (pageRows.length < pageSize) {
      return { rows, truncated: false, count: rows.length, total, pagesFetched };
    }
  }

  return { rows, truncated: true, count: rows.length, total, pagesFetched };
};

/**
 * Contratto di risposta per gli endpoint di lista.
 *
 * Ogni lista esposta dall'API usa questo envelope: le route non devono costruire
 * il payload a mano, e il client legge sempre gli stessi campi.
 *
 * ```json
 * {
 *   "data": [ ...righe... ],
 *   "count": 1000,
 *   "truncated": false,
 *   "total": 1315
 * }
 * ```
 *
 * - `data` (o `transactions` per `GET /bank/transactions`, vedi `rowsKey`) — le righe.
 * - `count` — numero di righe presenti nella risposta (`data.length`).
 * - `truncated` — `true` se il set restituito è tagliato al tetto di paginazione:
 *   il client **deve** dirlo all'utente e non presentare le somme come definitive.
 * - `total` — righe totali del range secondo il database, o `null` se non
 *   richiesto/disponibile. `count` e `total` differiscono solo quando `truncated`
 *   è `true`.
 *
 * @param {{rows?: Array<unknown>, truncated?: boolean, count?: number, total?: number|null}} result
 *   Il valore restituito da {@link fetchAllRows} (i campi non presenti sono derivati).
 * @param {object} [options]
 * @param {string} [options.rowsKey="data"] Chiave che contiene le righe. `GET /bank/transactions`
 *   usa `"transactions"` per non cambiare la shape già consumata dal client.
 * @returns {{[key: string]: unknown}} Payload JSON pronto per `res.json(...)`.
 */
export const toListResponse = (
  { rows = [], truncated = false, count, total = null } = {},
  { rowsKey = "data" } = {}
) => ({
  [rowsKey]: rows,
  count: typeof count === "number" ? count : rows.length,
  truncated: Boolean(truncated),
  total: typeof total === "number" ? total : null,
});

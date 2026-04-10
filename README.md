# Flow Wise - Server

Express backend per Flow-Wise, con API REST per transazioni, categorie, wallet e utenti.
Utilizza Supabase per storage, autenticazione e gestione RLS.

## Stack

- Node.js + Express
- Supabase JS SDK
- CORS + dotenv
- Cloudinary + Multer per upload avatar
- Vercel-ready deployment

## Struttura del progetto

```
flow-wise-server/
├── config/             # supabase client, auth middleware, Cloudinary setup
├── routes/             # moduli Express per endpoint
├── utils/              # helper e middleware condivisi
├── server.js           # bootstrap dell'app
└── vercel.json         # configurazione Vercel
```

## Configurazione ambiente

Copia `.env.example` in `.env` e definisci:

- `ALLOWED_ORIGINS`: origini per CORS (es. http://localhost:3000)
- `SUPABASE_URL`: URL del progetto Supabase
- `SUPABASE_SERVICE_ROLE_KEY`: chiave service_role per bypass RLS
- `PORT`: opzionale, default 5030
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`

> Usa la `SUPABASE_SERVICE_ROLE_KEY` solo sul server. Il client deve usare solo la chiave pubblicabile `anon`.

## Avvio locale

```bash
cd flow-wise-server
npm install
npm run dev
```

- `npm run dev` - avvia il server in hot reload
- `npm start` - esegue il server in produzione
- `GET /hello` - risponde con Hello world!
- `GET /healthz` - risponde con 204
- `GET /` - mostra la home con gli endpoint disponibili

## CORS

Configurato con `ALLOWED_ORIGINS` e supporta:
- metodi: GET, POST, PUT, DELETE, OPTIONS
- header: Content-Type, Authorization

## API principali

- /users - login, register, profile, avatar upload
- /transaction - CRUD transazioni
- /income - GET /all con filtri data
- /expense - GET /all con filtri data
- /category - GET /, GET /active, CRUD
- /wallet - CRUD wallet

Tutte le route protette usano il token Supabase in `Authorization: Bearer <token>`.

## Note Supabase

- Il server viene inizializzato con la service role key.
- Le query sono filtrate su `req.user.id` tramite il middleware `requireAuth`.

## Deployment

Il progetto include `vercel.json` per il deploy su Vercel con runtime `@vercel/node`.

## Performance

Per grandi dataset, è consigliato un indice come:

```sql
CREATE INDEX IF NOT EXISTS idx_tx_userid_date ON "Transaction"(userid, date DESC);
```

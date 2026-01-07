# Flow Wise — Server

Express backend for Flow-Wise (money tracker), using Supabase for data and auth.

## Stack
- Node.js + Express
- Supabase (Database + Auth via JWT)
- CORS + dotenv
- Multer + Cloudinary (user avatar upload)

## Project Structure
```
flow-wise-server/
├── config/              # supabase client, auth middleware
├── routes/              # express route modules
├── utils/               # asyncHandler, helpers
├── server.js            # app bootstrap
└── vercel.json          # deployment
```

## Environment
Copy .env.example to .env and set:

- ALLOWED_ORIGINS: comma-separated origins for CORS (e.g. http://localhost:3000)
- SUPABASE_URL: your Supabase project URL
- SUPABASE_SERVICE_ROLE_KEY: service_role key (legacy JWT variant, starts with eyJ…)
- PORT: optional (default 5030)
- Cloudinary keys if using avatar upload

Important: On the server use the legacy service_role key so Supabase bypasses RLS. The client must use only the publishable anon key.

## Running locally
- Install deps: npm install
- Start dev: npm run dev (uses node --watch)
- Start prod: npm start (after building any assets if needed)
- Health checks: GET /hello (200), GET /healthz (204)

Example preflight check (CORS):

```bash
curl -s -X OPTIONS http://localhost:5030/income/all \
	-H "Origin: http://localhost:3000" \
	-H "Access-Control-Request-Method: GET" \
	-H "Access-Control-Request-Headers: Authorization" -i
```

## CORS
Configured via ALLOWED_ORIGINS. Methods include GET, POST, PUT, DELETE, OPTIONS; headers include Content-Type and Authorization. Preflight returns 204.

## Routes (current)
- /users: login/register/profile, avatar upload
- /income: GET /all (filter by optional startDate,endDate)
- /expense: GET /all (filter by optional startDate,endDate)
- /transaction, /category, /wallet: standard CRUD endpoints

All protected endpoints use Supabase JWT via Authorization: Bearer <token>.

Example (authorized) request:

```bash
ACCESS_TOKEN="<paste supabase access token>"
curl -s http://localhost:5030/income/all \
	-H "Authorization: Bearer $ACCESS_TOKEN" | jq '. | length'
```

## Supabase Notes
- Server SDK initialized with service_role key and persists no session.
- Queries filter by req.user.id, set in requireAuth middleware.

## Performance
For large datasets, consider adding this index in your Supabase DB:

CREATE INDEX IF NOT EXISTS idx_tx_userid_date ON "Transaction"(userid, date DESC);

## Deployment
- Vercel-ready setup via vercel.json.
# Integrazione Banche Italiane - Flow Wise

Questa integrazione permette di collegare conti bancari italiani (Intesa San Paolo, UniCredit, BNL, ecc.) tramite **Open Banking API (PSD2)** per sincronizzare automaticamente le transazioni.

## 🏦 Banche Supportate

- **Intesa San Paolo**
- **UniCredit**
- **BNL (Banca Nazionale del Lavoro)**
- Facilmente estendibile ad altre banche

## 🚀 Setup Iniziale

### 1. Configura le Variabili d'Ambiente

Nel tuo `.env`, aggiungi:

```env
# Open Banking Configuration
BANK_CLIENT_ID=your_client_id_here
BANK_CLIENT_SECRET=your_client_secret_here
BANK_REDIRECT_URI=http://localhost:5030/bank/callback
BANK_ENVIRONMENT=sandbox

# Bank Sync Scheduler (Cron pattern)
# Default: "0 * * * *" (ogni ora)
BANK_SYNC_CRON=0 * * * *
```

### 2. Ottieni Credenziali dalla Banca

Per usare le Open Banking API di una banca italiana:

1. Vai al portale developer della banca (es. https://developer.intesasanpaolo.com)
2. Registra un'applicazione
3. Ottieni `client_id` e `client_secret`
4. Configura il redirect URI nel portale banca: `http://localhost:5030/bank/callback`

### 3. Crea le Tabelle nel Database

Esegui il SQL in Supabase:

```sql
-- Vai su SQL Editor di Supabase e copia il contenuto di:
-- migrations/001_create_bank_tables.sql
```

## 📋 API Endpoints

### 1. Genera URL di Autorizzazione

```http
GET /bank/authorize?bank=intesa&state=random_state
```

**Risposta:**
```json
{
  "authUrl": "https://api.sandbox.intesasanpaolo.com/oauth/authorize?..."
}
```

**Uso nel Frontend:**
1. Ottieni l'URL
2. Reindirizza l'utente a quella URL
3. L'utente autorizza l'accesso dal sito della banca
4. La banca reindirizza a `/bank/callback?code=xxx&state=yyy`

### 2. Callback (Automatico)

```http
GET /bank/callback?code=AUTH_CODE&state=random_state&bank=intesa
Header: x-user-id: user_uuid
```

**Cosa fa:**
- Scambia il code con token di accesso
- Ottiene gli account dell'utente
- Salva la connessione nel DB
- Sincronizza le transazioni

**Risposta:**
```json
{
  "success": true,
  "message": "Bank connected and synced",
  "account": {
    "id": "account_123",
    "iban": "IT60X0542811101000000123456",
    "name": "Conto Corrente Principale"
  }
}
```

### 3. Controlla Stato Connessione

```http
GET /bank/status?bank=intesa
Header: x-user-id: user_uuid
```

**Risposta:**
```json
{
  "connected": true,
  "bank": "intesa",
  "account": "account_123",
  "lastSynced": "2026-10-05T14:30:00Z"
}
```

### 4. Sincronizza Transazioni Manualmente

```http
POST /bank/sync?bank=intesa
Header: x-user-id: user_uuid
```

**Risposta:**
```json
{
  "success": true,
  "synced": 42
}
```

### 5. Ottieni Transazioni Sincronizzate

```http
GET /bank/transactions?bank=intesa
Header: x-user-id: user_uuid
```

**Risposta:**
```json
{
  "transactions": [
    {
      "id": "txn_uuid",
      "user_id": "user_uuid",
      "bank_id": "intesa",
      "external_id": "bank_txn_123",
      "amount": -25.50,
      "currency": "EUR",
      "description": "PAGAMENTO NETFLIX",
      "date": "2026-10-05",
      "counterparty": "NETFLIX SVCS",
      "status": "synced",
      "created_at": "2026-10-05T14:30:00Z"
    }
  ],
  "count": 1
}
```

### 6. Disconnetti Account

```http
POST /bank/disconnect?bank=intesa
Header: x-user-id: user_uuid
```

---

## ⏰ Scheduler Automatico

Lo scheduler sincronizza automaticamente le transazioni di tutti gli utenti secondo un pattern Cron configurabile.

### Configurazione

Nel `.env`:

```env
# Sincronizzazione ogni ora (default)
BANK_SYNC_CRON=0 * * * *

# Esempi di altri pattern:
# Ogni 6 ore
BANK_SYNC_CRON=0 */6 * * *

# Ogni giorno a mezzanotte
BANK_SYNC_CRON=0 0 * * *

# Ore 9, 14, 18
BANK_SYNC_CRON=0 9,14,18 * * *

# Ogni 15 minuti
BANK_SYNC_CRON=*/15 * * * *
```

### Come Funziona

1. **Avvio**: Lo scheduler parte automaticamente quando il server si avvia
2. **Sincronizzazione**: A intervalli regolari:
   - Ottiene tutti gli utenti con connessioni bancarie
   - Per ogni utente e banca:
     - Verifica e rinfresca il token se scaduto
     - Scarica le ultime transazioni
     - Salva nel database
3. **Logging**: Tutti gli eventi vengono registrati nei log del server

### Monitoraggio

#### Verifica Stato dello Scheduler

```http
GET /bank/scheduler/status
```

**Risposta:**
```json
{
  "running": true,
  "pattern": "0 * * * *",
  "lastRun": "Check logs for details"
}
```

#### Forza Sincronizzazione Immediata

```http
POST /bank/scheduler/sync-now
```

**Risposta:**
```json
{
  "success": true,
  "message": "Bank sync triggered manually"
}
```

### Esempio di Log

```
📅 Bank sync scheduler starting with pattern: 0 * * * *
✓ Bank sync scheduler is running

🔄 Starting bank transaction sync at 2026-10-05T15:00:00.000Z
Found 3 bank connection(s) to sync
✓ Synced 5 transactions for user user_123 from intesa
✓ Synced 8 transactions for user user_456 from unicredit
✓ Synced 0 transactions for user user_789 from bnl
✓ Bank transaction sync completed at 2026-10-05T15:00:45.123Z
```

---

## 💻 Esempio Frontend (React)

```jsx
import { useState, useEffect } from 'react';

export function BankDashboard() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const userId = 'user_uuid'; // Da sessione auth

  useEffect(() => {
    checkStatus();
    fetchTransactions();
  }, []);

  const checkStatus = async () => {
    try {
      const res = await fetch('/bank/status?bank=intesa', {
        headers: { 'x-user-id': userId }
      });
      const data = await res.json();
      setConnected(data.connected);
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const fetchTransactions = async () => {
    try {
      const res = await fetch('/bank/transactions', {
        headers: { 'x-user-id': userId }
      });
      const data = await res.json();
      setTransactions(data.transactions);
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const handleConnect = async () => {
    setLoading(true);
    try {
      const res = await fetch('/bank/authorize?bank=intesa', {
        headers: { 'x-user-id': userId }
      });
      const { authUrl } = await res.json();
      window.location.href = authUrl;
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setLoading(true);
    try {
      const res = await fetch('/bank/sync?bank=intesa', {
        method: 'POST',
        headers: { 'x-user-id': userId }
      });
      const data = await res.json();
      console.log(`Synced ${data.synced} transactions`);
      await fetchTransactions();
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2>Bank Transactions</h2>
      
      {!connected ? (
        <button onClick={handleConnect} disabled={loading}>
          Connect Bank Account
        </button>
      ) : (
        <>
          <button onClick={handleSync} disabled={loading}>
            Sync Now
          </button>
          
          <div>
            <h3>Transactions ({transactions.length})</h3>
            {transactions.map(txn => (
              <div key={txn.id}>
                <p>{txn.description}</p>
                <p>{txn.amount} {txn.currency}</p>
                <small>{txn.date}</small>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

## 🔄 Flusso Completo

```
1. Utente clicca "Connetti banca"
   ↓
2. Frontend chiama GET /bank/authorize
   ↓
3. Frontend reindirizza a banca per login
   ↓
4. Utente autorizza accesso
   ↓
5. Banca reindirizza a /bank/callback
   ↓
6. Backend scambia code con token
   ↓
7. Backend scarica account e transazioni (PRIMO SYNC)
   ↓
8. Backend salva nel database
   ↓
9. SCHEDULER: ogni ora, sincronizza automaticamente
   ↓
10. Utente vede transazioni aggiornate nel dashboard
```

## 📊 Schema Database

### bank_connections
```
- id (UUID)
- user_id (UUID) → auth.users.id
- bank_id (VARCHAR) → 'intesa', 'unicredit', ecc.
- account_id (VARCHAR) → ID conto dalla banca
- access_token (TEXT) → Token OAuth
- refresh_token (TEXT) → Per rinnovare token
- token_expires_at (TIMESTAMP) → Scadenza token
- last_synced (TIMESTAMP) → Ultima sincronizzazione
```

### bank_transactions
```
- id (UUID)
- user_id (UUID) → auth.users.id
- bank_id (VARCHAR)
- account_id (VARCHAR)
- external_id (VARCHAR) → ID univoco dalla banca
- amount (DECIMAL)
- currency (VARCHAR) → 'EUR', ecc.
- description (TEXT) → Causale
- date (DATE) → Data transazione
- counterparty (VARCHAR) → Chi ha inviato/ricevuto
- status (VARCHAR) → 'synced', ecc.
- raw_data (JSONB) → Dati originali dalla banca
```

## 🔐 Sicurezza

✅ **Token Management:**
- I token scaduti vengono automaticamente rinnovati
- I refresh token sono salvati in modo sicuro
- Sincronizzazione automatica garantisce token sempre validi

✅ **Row Level Security (RLS):**
- Ogni utente vede solo i propri dati
- Non è possibile accedere a transazioni altrui

✅ **CORS:**
- Solo domini autorizzati possono accedere

✅ **Rate Limiting:**
- Sincronizzazione in batch per evitare rate limit delle banche

## 🐛 Debugging

### Verifica che lo Scheduler sia Attivo

```bash
curl http://localhost:5030/bank/scheduler/status
```

### Forza Sincronizzazione Immediata

```bash
curl -X POST http://localhost:5030/bank/scheduler/sync-now
```

### Token Scaduto
Se ricevi errore "Invalid token", il sistema prova automaticamente a rinnovarlo. Se il refresh fallisce, l'utente deve ricollegarsi.

### Transazioni non Sincronizzate
1. Verifica che il token sia valido: `GET /bank/status`
2. Forza una sincronizzazione: `POST /bank/sync`
3. Controlla i log: `GET /bank/transactions`
4. Verifica che lo scheduler sia attivo: `GET /bank/scheduler/status`

### Errore di Autorizzazione
1. Verifica `BANK_CLIENT_ID` e `BANK_CLIENT_SECRET`
2. Verifica che `BANK_REDIRECT_URI` corrisponda nel portale banca
3. Assicurati di essere in sandbox vs production

## 📝 Note Importanti

- **Sandbox vs Production:** Cambia `BANK_ENVIRONMENT` nel `.env`
- **Sincronizzazione:** Per default scarica ultimi 90 giorni
- **Rinnovo Token:** Automatico quando scade (30 giorni tipico)
- **Rate Limiting:** Alcune banche hanno limiti di API call - lo scheduler usa batching
- **Timezone:** Lo scheduler usa UTC, verifica il tuo timezone se necessario

## 🔗 Risorse Utili

- [Cron Pattern Reference](https://crontab.guru/)
- [PSD2 Standard](https://www.eba.europa.eu/regulation-and-policy/payments-security)
- [Intesa San Paolo Open Banking](https://developer.intesasanpaolo.com)
- [UniCredit Open Banking](https://sandbox.unicredit.eu)
- [BNL Open Banking](https://api.sandbox.bnl.it)

## ❓ FAQ

**D: Posso connettere multiple banche?**
R: Sì, ogni banca è salvata separatamente con il suo token. Lo scheduler sincronizza tutte.

**D: Quanto spesso vengono sincronizzate le transazioni?**
R: Dipende da `BANK_SYNC_CRON`. Default è ogni ora. Personalizzabile con pattern Cron.

**D: I token sono salvati in sicurezza?**
R: Sì, sono salvati in Supabase con RLS abilitato. Solo tu vedi i tuoi token.

**D: Cosa succede se disconnetto il conto?**
R: Il token viene invalidato. Lo scheduler non lo sincronizzerà più.

**D: Supportate altre banche?**
R: Sì! Aggiungi semplicemente una nuova entry in `BANK_CONFIGS` in `bankService.js`.

**D: Posso modificare la frequenza di sincronizzazione?**
R: Sì, modifica `BANK_SYNC_CRON` nel `.env`. Usa https://crontab.guru/ per i pattern.

**D: Lo scheduler continua a girare in produzione?**
R: Sì, continua automaticamente. Puoi forza-sincronizzare con `POST /bank/scheduler/sync-now`.

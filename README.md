# Flow Wise - Server 

## Descrizione
Backend part of **Flow-Wise project - Money tracker**. Created with **Express/Node.js + MongoDB**, managed with **Mongoose**.


## Tech
- **Node.js**
- **Express.js**
- **MongoDB**
- **Mongoose**
- **JWT**
- **Dotenv**

## Structure
```
flow-wise-server/
├── db/
├── routes/
└── server.js
```

## Mongoose models schema
##### User
```
name: String, required
email: String, required, unique
password: String, required
```
##### Income (Entrate)
```
user: ref to User
amount: Number
description: String
date: Data, default Date.now
category: ref  Category
```
##### Expense (Spese)
```
user: ref to User
amount: Number
description: String
date: Data, default Date.now
category: ref to Category
```
##### Category
```
user: ref to User
name: String
type: String ("income" or "expense")
```
##### Budget
```
user: ref to User
category: ref to Category
limit: Number
period: String (es. monthly, weekly - TBD)
```

## Env config
Create a `.env.local` in the project root, in which at least you should have this:
```
   PORT=5000
   MONGO_URI=mongodb+srv://user:password@cluster.mongodb.net/database
   JWT_SECRET=supersecret
   ```


## API Structure

### 1️⃣ Entrate (`/income`)

Gestisce le entrate registrate.

| Metodo | Endpoint | Descrizione |
|--------|---------|------------|
| `GET`  | `/income/all` | Ottiene tutte le entrate |
| `GET`  | `/income/:id` | Ottiene una singola entrata |
| `POST` | `/income/new` | Crea una nuova entrata |
| `PUT`  | `/income/:id` | Modifica un'entrata |
| `DELETE` | `/income/delete/:id` | Elimina un'entrata |

---

### 2️⃣ Uscite (`/expense`)

Gestisce le spese effettuate.

| Metodo | Endpoint | Descrizione |
|--------|---------|------------|
| `GET`  | `/expense/all` | Ottiene tutte le uscite |
| `GET`  | `/expense/:id` | Ottiene una singola uscita |
| `POST` | `/expense/new` | Crea una nuova uscita |
| `PUT`  | `/expense/:id` | Modifica un'uscita |
| `DELETE` | `/expense/delete/:id` | Elimina un'uscita |

---

### 3️⃣ Categorie (`/category`) - <span style="color:red">TBD </span>

Gestisce le categorie di entrate/uscite.

| Metodo | Endpoint | Descrizione |
|--------|---------|------------|
| `GET`  | `/category/all` | Ottiene tutte le categorie |
| `POST` | `/category/new` | Crea una nuova categoria |

---

### 4️⃣ Budget (`/budget`) - <span style="color:red">TBD </span>

Gestisce il budget per ogni categoria.

| Metodo | Endpoint | Descrizione |
|--------|---------|------------|
| `GET`  | `/budget/all` | Ottiene il budget per tutte le categorie |
| `GET`  | `/budget/:categoryId` | Ottiene il budget per una singola categoria |
| `POST` | `/budget/new` | Definisce un budget per una categoria |
| `PUT`  | `/budget/:categoryId` | Modifica il budget di una categoria |

---

### 5️⃣ Riepilogo e Statistiche (`/summary`) - <span style="color:red">TBD </span>

Questa API calcola i totali, l'avanzo e genera dati per i grafici.

| Metodo | Endpoint | Descrizione |
|--------|---------|------------|
| `GET`  | `/summary` | Ottiene il riepilogo generale (entrate, uscite, avanzo) |
| `GET`  | `/summary/monthly/:year/:month` | Ottiene il riepilogo mensile |
| `GET`  | `/summary/category/:categoryId` | Ottiene il riepilogo di una categoria |

## Deployment
Deployed using Vercel at [Flow Wise (Server)](https://flow-wise-server.vercel.app/)
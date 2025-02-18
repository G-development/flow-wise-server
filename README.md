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
- **Cloudinary**

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
username: String, required
email: String, required, unique
password: String, required
profilePic: String
currency: String, default "EUR"
notifications: Boolean, default True
authMethod: String, ("credentials", "google", "github"), default "credentials"
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
amount: Number
period: String (es. monthly, weekly - TBD)
```

## Env config
Create a `.env` in the project root, in which at least you should have this:
```
   PORT=5000

   MONGO_URI=mongodb+srv://user:password@cluster.mongodb.net/database

   JWT_SECRET=supersecret

   CLOUDINARY_CLOUD_NAME=HERE
   CLOUDINARY_API_KEY=HERE
   CLOUDINARY_API_SECRET=HERE
   CLOUDINARY_API=CLOUDINARY_URL=HERE
   ```


## API Structure

### 1️⃣ Utenti (`/users`)

| Metodo | Endpoint | Descrizione |
|--------|---------|------------|
| `GET`  | `/users/all` | Ottiene tutti gli utenti (da disabilitare) |
| `POST` | `/users/register` | Crea un nuovo utente |
| `POST` | `/users/login` | Logga un utente |
| `GET`  | `/users/profile` | Ottiene i dati dell'utente loggato |
| `POST` | `/users/profile/photo` | Upload dell'avatar dell'utente <span style="color:red">TBD </span>  |

---

### 2️⃣ Entrate (`/income`)

Gestisce le entrate registrate.

| Metodo | Endpoint | Descrizione |
|--------|---------|------------|
| `GET`  | `/income/all` | Ottiene tutte le entrate |
| `GET`  | `/income/:id` | Ottiene una singola entrata |
| `POST` | `/income/new` | Crea una nuova entrata |
| `PUT`  | `/income/:id` | Modifica un'entrata |
| `DELETE` | `/income/delete/:id` | Elimina un'entrata |

---

### 3️⃣ Uscite (`/expense`)

Gestisce le spese effettuate.

| Metodo | Endpoint | Descrizione |
|--------|---------|------------|
| `GET`  | `/expense/all` | Ottiene tutte le uscite |
| `GET`  | `/expense/:id` | Ottiene una singola uscita |
| `POST` | `/expense/new` | Crea una nuova uscita |
| `PUT`  | `/expense/:id` | Modifica un'uscita |
| `DELETE` | `/expense/delete/:id` | Elimina un'uscita |

---

### 4️⃣ Categorie (`/category`) 

Gestisce le categorie di entrate/uscite.

| Metodo | Endpoint | Descrizione |
|--------|---------|------------|
| `GET`  | `/category/all` | Ottiene tutte le categorie |
| `POST` | `/category/new` | Crea una nuova categoria |

---

### 5️⃣ Budget (`/budget`) 

Gestisce il budget per ogni categoria.

| Metodo | Endpoint | Descrizione |
|--------|---------|------------|
| `GET`  | `/budget/all` | Ottiene il budget per tutte le categorie |
| `POST` | `/budget/new` | Definisce un budget per una categoria |
| `GET`  | `/budget/:categoryId` <span style="color:red">TBD </span> | Ottiene il budget per una singola categoria |
| `PUT`  | `/budget/:categoryId` <span style="color:red">TBD </span> | Modifica il budget di una categoria |

---

### 🔜 Riepilogo e Statistiche (`/summary`) - <span style="color:red">TBD </span>

Questa API calcola i totali, l'avanzo e genera dati per i grafici.

| Metodo | Endpoint | Descrizione |
|--------|---------|------------|
| `GET`  | `/summary` | Ottiene il riepilogo generale (entrate, uscite, avanzo) |
| `GET`  | `/summary/monthly/:year/:month` | Ottiene il riepilogo mensile |
| `GET`  | `/summary/category/:categoryId` | Ottiene il riepilogo di una categoria |

## Deployment
Deployed using Vercel at [Flow Wise (Server)](https://flow-wise-server.vercel.app/)
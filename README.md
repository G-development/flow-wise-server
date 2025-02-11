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


## Endpoints
##### Users
- `GET /users/all`  #to be deactivated
- `POST /users/register`
- `POST /users/login`

##### Income
- `GET /income/all`
- `POST /income/new`
- `GET /income/total`

##### Expense
- `GET /expense/all`
- `POST /expense/new`

##### Category
- `GET /category/all`
- `POST /category/new`

##### Budget
Not yet

## Deployment
Deployed using Vercel at https://flow-wise-server.vercel.app/
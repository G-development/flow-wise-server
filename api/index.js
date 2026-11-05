// Funzione Vercel: tutta l'app Express in una sola funzione. Le richieste arrivano qui
// dal rewrite di vercel.json, con il path originale intatto, quindi le route di app.js
// vedono `/bank/...`, `/wallet/...` come in locale.
import app from "../app.js";

export default app;

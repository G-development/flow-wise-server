import app from "./app.js";
import { startBankSyncScheduler } from "./utils/bankSyncScheduler.js";

// Avvio locale (`npm run dev`, `npm start`). Su Vercel l'app passa da api/index.js.
const PORT = process.env.PORT || 5030;

app.listen(PORT, () => {
  console.log(`\n🚀 Server avviato su PORT:${PORT}\n`);

  // Scheduler interno facoltativo: parte solo con BANK_SYNC_CRON impostata.
  startBankSyncScheduler();
});

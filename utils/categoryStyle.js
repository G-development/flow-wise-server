/**
 * Colori e icone ammessi per le categorie (migrazione 017, 13/11/2026). Stesso elenco del client
 * (`lib/categoryStyle.ts`): se ne aggiungi uno qui, aggiungilo anche li'.
 */
export const CATEGORY_COLORS = ["slate", "red", "orange", "amber", "green", "teal", "sky", "blue", "violet", "pink"];

export const CATEGORY_ICONS = [
  "tag", "shopping-cart", "utensils", "coffee", "car", "fuel", "bus", "plane", "home", "zap",
  "wifi", "phone", "repeat", "heart-pulse", "dumbbell", "shopping-bag", "shirt", "gift", "graduation-cap",
  "briefcase", "wallet", "piggy-bank", "receipt", "landmark", "gamepad-2", "music", "book", "paw-print",
  "baby", "users", "wrench", "sparkles",
];

/** Stile delle categorie di partenza di un account nuovo (routes/user.js). */
export const STARTER_STYLE = {
  Salary: { color: "green", icon: "briefcase" },
  Groceries: { color: "green", icon: "shopping-cart" },
  "Eating out": { color: "orange", icon: "utensils" },
  Transport: { color: "sky", icon: "car" },
  "Home & bills": { color: "amber", icon: "home" },
  Subscriptions: { color: "violet", icon: "repeat" },
  Health: { color: "red", icon: "heart-pulse" },
  Shopping: { color: "pink", icon: "shopping-bag" },
  Travel: { color: "teal", icon: "plane" },
  Other: { color: "slate", icon: "tag" },
  Transfer: { color: "slate", icon: "repeat" },
};

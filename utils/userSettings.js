/**
 * Impostazioni dell'utente salvate nel JSON `Profile.settings` (16/11/2026).
 *
 * `monthStartDay`: il giorno in cui parte il "mese" dell'utente (1–31), scelto al primo accesso e
 * modificabile in Settings. Vale per tutta l'app (dashboard e Movements); il piano annuale resta a
 * mesi di calendario. Nei mesi piu' corti il client usa l'ultimo giorno disponibile.
 * Assente = non ancora scelto: il client chiede una volta e intanto usa il 1°.
 *
 * Nel JSON e non in una colonna: niente migrazione, e le altre chiavi gia' presenti (es.
 * `notifications`) restano com'erano.
 */

/** Il giorno valido (intero 1–31) o null se assente / non valido. */
export function readMonthStartDay(settings) {
  const value = settings && typeof settings === "object" ? settings.monthStartDay : undefined;
  return Number.isInteger(value) && value >= 1 && value <= 31 ? value : null;
}

/** Le impostazioni pubbliche, nella forma della risposta di GET /users/settings. */
export function publicSettings(settings) {
  return { monthStartDay: readMonthStartDay(settings) };
}

/** Unisce le modifiche alle impostazioni gia' salvate senza perdere le altre chiavi. */
export function mergeSettings(current, patch) {
  const base = current && typeof current === "object" && !Array.isArray(current) ? current : {};
  return { ...base, ...patch };
}

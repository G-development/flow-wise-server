/**
 * Cancellazione dell'account (R4, 13/11/2026). Deciso con Gio: subito, senza periodo di ripensamento,
 * con conferma scrivendo la propria email; il client propone prima l'export.
 *
 * Ordine: prima le righe che puntano ad altre (rate -> voci -> regole -> movimenti -> budget ->
 * banca -> salvadanai -> conti -> categorie -> profilo), poi l'utente di Supabase Auth. Ogni passo
 * filtra per l'utente: il client usa la service-role key.
 *
 * Non e' una transazione unica (sono richieste PostgREST separate): se un passo fallisce ci si ferma,
 * si risponde con l'errore e l'utente resta, cosi' puo' riprovare. Ogni passo e' ripetibile senza
 * danni (cancella solo cio' che resta). L'utente di Auth si cancella per ultimo: finche' non sparisce,
 * il login funziona e la richiesta si puo' rifare.
 *
 * La foto profilo su Cloudinary si cancella "al meglio": un errore li' non blocca il resto.
 * I backup notturni cifrati contengono ancora i dati per al massimo 30 giorni (Privacy §7).
 */
import { supabase as defaultClient } from "../config/supabaseClient.js";

/** I passi, in ordine. `filter` restringe ulteriormente (salvadanai prima dei conti). */
export const DELETION_STEPS = [
  { table: "annual_installments", owner: "user_id" },
  { table: "annual_items", owner: "user_id" },
  { table: "category_rules", owner: "user_id" },
  { table: "Transaction", owner: "userid" },
  { table: "Budget", owner: "userid" },
  { table: "dashboard_layouts", owner: "user_id" },
  { table: "password_reset_tokens", owner: "user_id" },
  { table: "bank_transactions", owner: "user_id" },
  { table: "bank_connections", owner: "user_id" },
  { table: "Wallet", owner: "userid", filter: ["kind", "pot"], label: "Wallet (pots)" },
  { table: "Wallet", owner: "userid", label: "Wallet (accounts)" },
  { table: "Category", owner: "userid" },
  { table: "Profile", owner: "id" },
];

/** public_id Cloudinary da un URL di `profile_pics` (es. .../upload/v123/profile_pics/abc.jpg -> profile_pics/abc). */
export const cloudinaryPublicId = (url) => {
  const match = String(url ?? "").match(/\/upload\/(?:v\d+\/)?(profile_pics\/[^/.]+)\.[a-z0-9]+$/i);
  return match ? match[1] : null;
};

/**
 * Le email coincidono? Senza distinguere maiuscole e spazi ai lati.
 * @param {string|undefined} typed
 * @param {string|undefined} actual
 */
export const emailMatches = (typed, actual) =>
  typeof typed === "string" &&
  typeof actual === "string" &&
  actual.trim() !== "" &&
  typed.trim().toLowerCase() === actual.trim().toLowerCase();

/**
 * Cancella tutto cio' che appartiene all'utente e poi l'utente stesso.
 *
 * @param {{id: string}} user
 * @param {{client?: object, cloudinary?: {uploader: {destroy: Function}} | null}} [options]
 * @returns {Promise<{deleted: Record<string, number>, avatarRemoved: boolean}>}
 * @throws {Error} al primo passo fallito (con il nome della tabella)
 */
export const deleteUserAccount = async (user, { client = defaultClient, cloudinary = null } = {}) => {
  if (!user?.id) throw new TypeError("deleteUserAccount: missing user id");

  // La foto va letta prima di cancellare il profilo.
  const { data: profile } = await client.from("Profile").select("avatar_url").eq("id", user.id).maybeSingle();

  const deleted = {};
  for (const step of DELETION_STEPS) {
    let query = client.from(step.table).delete({ count: "exact" }).eq(step.owner, user.id);
    if (step.filter) query = query.eq(step.filter[0], step.filter[1]);
    const { error, count } = await query;
    if (error) throw new Error(`Account deletion stopped at ${step.label ?? step.table}: ${error.message}`);
    deleted[step.label ?? step.table] = count ?? 0;
  }

  let avatarRemoved = false;
  const publicId = cloudinaryPublicId(profile?.avatar_url);
  if (publicId && cloudinary) {
    try {
      await cloudinary.uploader.destroy(publicId);
      avatarRemoved = true;
    } catch (error) {
      console.error("Account deletion: avatar not removed from Cloudinary:", error?.message);
    }
  }

  const { error: authError } = await client.auth.admin.deleteUser(user.id);
  if (authError) throw new Error(`Account deletion stopped at the login: ${authError.message}`);

  return { deleted, avatarRemoved };
};

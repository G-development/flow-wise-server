/**
 * Ciclo di reset password via email.
 *
 * ## Ordine deliberato delle operazioni
 *
 * Il token viene generato **in memoria**, inserito nell'URL inviato per email e
 * salvato in `password_reset_tokens` **solo dopo** che l'invio è riuscito. Il
 * codice precedente faceva il contrario (crea → invia) e con `SMTP_HOST` mancante
 * lasciava un token valido e orfano che nessuno aveva mai ricevuto.
 *
 * Il costo di questo ordine è la finestra opposta: se l'insert fallisse **dopo**
 * l'invio, il link consegnato non sarebbe valido. In quel caso però l'errore
 * risale al chiamante (che risponde 5xx) e l'utente riprova; un token valido ma
 * non consegnato, invece, è un artefatto di sicurezza silenzioso. Da qui la scelta.
 *
 * `requestPasswordReset` non lancia mai: distingue l'esito nel valore di ritorno
 * (`{ success: true }` / `{ success: false, error }`) perché la route possa
 * rispondere con lo stato reale. L'anti-enumerazione resta intatta: un'email
 * sconosciuta **non** produce `success: false`, ma il messaggio neutro di sempre.
 *
 * @module utils/passwordResetService
 */

import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Configura il transporter email
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: process.env.SMTP_SECURE === "true", // true per 465, false per altri
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

/** Righe per pagina della Admin API di GoTrue. */
export const LIST_USERS_PAGE_SIZE = 1000;

/**
 * Tetto di sicurezza sul numero di pagine lette: un filtro sbagliato non deve
 * trasformarsi in un ciclo potenzialmente infinito.
 */
export const LIST_USERS_MAX_PAGES = 100;

/**
 * Genera un token reset univoco
 */
const generateResetToken = () => {
  return crypto.randomBytes(32).toString("hex");
};

/**
 * Invia email di reset password
 */
export const sendPasswordResetEmail = async (email, resetToken, resetUrl) => {
  try {
    // Fail fast con un errore leggibile: senza SMTP_HOST nodemailer proverebbe a
    // connettersi a localhost e il messaggio sarebbe un ECONNREFUSED opaco.
    if (!process.env.SMTP_HOST) {
      throw new Error("SMTP_HOST is not configured");
    }

    const mailOptions = {
      from: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER,
      to: email,
      subject: "Password Reset Request - Flow Wise",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Password Reset Request</h2>
          <p>Hello,</p>
          <p>We received a request to reset your password. Click the button below to reset it:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="
              background-color: #007bff;
              color: white;
              padding: 12px 30px;
              text-decoration: none;
              border-radius: 5px;
              font-weight: bold;
            ">Reset Password</a>
          </div>
          <p>Or copy this link: <a href="${resetUrl}">${resetUrl}</a></p>
          <p style="color: #999; font-size: 12px;">
            This link will expire in 1 hour.
          </p>
          <p style="color: #999; font-size: 12px;">
            If you didn't request this, please ignore this email.
          </p>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Password reset email sent:", info.response);
    return true;
  } catch (error) {
    console.error("Error sending password reset email:", error.message);
    // Il motivo reale resta nel messaggio: con SMTP_HOST mancante il chiamante
    // deve leggere quello, non un generico "invio fallito".
    throw new Error(`Failed to send reset email: ${error.message}`, {
      cause: error,
    });
  }
};

/**
 * Crea un token di reset password nel DB.
 *
 * Il token è accettato dal chiamante perché `requestPasswordReset` lo genera, lo
 * invia per email e **solo dopo** lo persiste: vedi l'header del modulo. Chiamata
 * con due argomenti si comporta come prima e genera il token da sé.
 *
 * @param {string} userId
 * @param {string} email
 * @param {string} [token=generateResetToken()] Token già generato dal chiamante.
 */
export const createPasswordResetToken = async (
  userId,
  email,
  token = generateResetToken()
) => {
  try {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1); // Valido per 1 ora

    const { error } = await supabase.from("password_reset_tokens").insert({
      user_id: userId,
      email,
      token,
      expires_at: expiresAt.toISOString(),
      used: false,
    });

    if (error) throw error;
    return token;
  } catch (error) {
    console.error("Error creating reset token:", error.message);
    throw new Error(`Failed to create reset token: ${error.message}`, {
      cause: error,
    });
  }
};

/**
 * Cerca un utente per email su **tutte** le pagine della Admin API di GoTrue.
 *
 * `supabase.auth.admin.listUsers()` senza `page`/`perPage` legge una sola pagina
 * (1000 utenti per default): chi sta oltre la prima pagina è invisibile e la
 * richiesta di reset fallisce in silenzio. Qui si itera finché la pagina letta
 * non è l'ultima.
 *
 * @param {string} email
 * @param {object} [client=supabase] Client Supabase (iniettabile nei test).
 * @returns {Promise<object|null>} L'utente trovato, oppure `null` se non esiste.
 * @throws {Error} se la Admin API fallisce o se si supera il tetto di pagine:
 *   un errore visibile è meglio di un falso "utente inesistente".
 */
export const findUserByEmail = async (email, client = supabase) => {
  for (let page = 1; page <= LIST_USERS_MAX_PAGES; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage: LIST_USERS_PAGE_SIZE,
    });

    if (error) {
      throw new Error(`Failed to list users: ${error.message}`);
    }

    const users = data?.users ?? [];
    const user = users.find((u) => u.email === email);
    if (user) return user;

    // Una pagina più corta di `perPage` è l'ultima: è l'informazione fisica,
    // più affidabile dei metadati `nextPage`/`lastPage`.
    if (users.length < LIST_USERS_PAGE_SIZE) return null;

    // Nessuna pagina successiva: `nextPage === null` (GoTrue) oppure la pagina
    // corrente è già oltre l'ultima dichiarata.
    if (data?.nextPage === null) return null;
    if (typeof data?.lastPage === "number" && page >= data.lastPage) return null;
  }

  throw new Error("Failed to list users: page limit reached");
};

/**
 * Verifica se un token di reset è valido
 */
export const verifyResetToken = async (token) => {
  try {
    const { data, error } = await supabase
      .from("password_reset_tokens")
      .select("*")
      .eq("token", token)
      .eq("used", false)
      .single();

    if (error || !data) {
      throw new Error("Invalid or expired token");
    }

    const expiresAt = new Date(data.expires_at);
    if (new Date() > expiresAt) {
      throw new Error("Token has expired");
    }

    return data;
  } catch (error) {
    console.error("Error verifying reset token:", error.message);
    throw new Error("Invalid or expired token");
  }
};

/**
 * Resetta la password dell'utente
 */
export const resetUserPassword = async (userId, token, newPassword) => {
  try {
    // Verifica il token
    const tokenData = await verifyResetToken(token);

    if (tokenData.user_id !== userId) {
      throw new Error("Token does not match user");
    }

    // Usa Supabase auth per resettare la password
    const { error } = await supabase.auth.admin.updateUserById(userId, {
      password: newPassword,
    });

    if (error) throw error;

    // Marca il token come usato
    await supabase
      .from("password_reset_tokens")
      .update({ used: true })
      .eq("token", token);

    return true;
  } catch (error) {
    console.error("Error resetting password:", error.message);
    throw error;
  }
};

/**
 * Richiesta di reset password tramite email.
 *
 * Non lancia: l'esito è nel valore di ritorno. `success: false` significa che la
 * richiesta **non** è stata consegnata (invio email o lookup falliti), quindi il
 * chiamante deve rispondere con un errore; un'email sconosciuta resta un
 * `success: true` neutro per non rivelare se l'account esiste.
 *
 * @param {string} email
 * @returns {Promise<{success: true, message: string} | {success: false, error: string}>}
 */
export const requestPasswordReset = async (email) => {
  try {
    // Cerca l'utente per email (su tutte le pagine, non solo la prima)
    const user = await findUserByEmail(email);

    if (!user) {
      // Non rivelare se l'email esiste o no per motivi di sicurezza
      console.log(`Password reset requested for non-existent email: ${email}`);
      return { success: true, message: "If email exists, reset link has been sent" };
    }

    // Il token esiste solo in memoria finché l'email non è partita: se l'invio
    // fallisce non resta alcun token valido in `password_reset_tokens`.
    const resetToken = generateResetToken();

    // Genera URL di reset
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;

    // Invia email
    await sendPasswordResetEmail(email, resetToken, resetUrl);

    // Persistito solo ora: scadenza 1h, uso singolo, come prima.
    await createPasswordResetToken(user.id, email, resetToken);

    return { success: true, message: "Reset link has been sent to your email" };
  } catch (error) {
    console.error("Error in requestPasswordReset:", error.message);
    // L'esito reale non va nascosto: il chiamante deve poter rispondere 5xx.
    return { success: false, error: error.message };
  }
};

/**
 * Verifica se una password è valida
 */
export const isValidPassword = (password) => {
  // Minimo 8 caratteri, almeno una maiuscola, un numero e un carattere speciale
  const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return passwordRegex.test(password);
};

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
    throw new Error("Failed to send reset email");
  }
};

/**
 * Crea un token di reset password nel DB
 */
export const createPasswordResetToken = async (userId, email) => {
  try {
    const token = generateResetToken();
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
    throw new Error("Failed to create reset token");
  }
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
 * Richiesta di reset password tramite email
 */
export const requestPasswordReset = async (email) => {
  try {
    // Cerca l'utente per email
    const { data: userData, error: userError } = await supabase.auth.admin.listUsers();

    const user = userData?.users?.find((u) => u.email === email);

    if (!user) {
      // Non rivelare se l'email esiste o no per motivi di sicurezza
      console.log(`Password reset requested for non-existent email: ${email}`);
      return { success: true, message: "If email exists, reset link has been sent" };
    }

    // Crea token reset
    const resetToken = await createPasswordResetToken(user.id, email);

    // Genera URL di reset
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;

    // Invia email
    await sendPasswordResetEmail(email, resetToken, resetUrl);

    return { success: true, message: "Reset link has been sent to your email" };
  } catch (error) {
    console.error("Error in requestPasswordReset:", error.message);
    // Non rivelare dettagli di errore
    return { success: true, message: "If email exists, reset link has been sent" };
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

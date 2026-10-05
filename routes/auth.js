import express from "express";
import {
  requestPasswordReset,
  resetUserPassword,
  verifyResetToken,
  isValidPassword,
} from "../utils/passwordResetService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = express.Router();

// POST /auth/forgot-password
// Richiesta di reset password
router.post(
  "/forgot-password",
  asyncHandler(async (req, res) => {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Valida formato email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    const result = await requestPasswordReset(email);
    res.json(result);
  })
);

// POST /auth/verify-reset-token
// Verifica se un token di reset è valido
router.post(
  "/verify-reset-token",
  asyncHandler(async (req, res) => {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: "Token is required" });
    }

    try {
      const tokenData = await verifyResetToken(token);
      res.json({
        valid: true,
        email: tokenData.email,
      });
    } catch (error) {
      res.status(401).json({ error: error.message });
    }
  })
);

// POST /auth/reset-password
// Resetta la password
router.post(
  "/reset-password",
  asyncHandler(async (req, res) => {
    const { token, email, password, confirmPassword } = req.body;

    if (!token || !email || !password || !confirmPassword) {
      return res.status(400).json({ error: "All fields are required" });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match" });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({
        error: "Password must be at least 8 characters with uppercase, number, and special character",
      });
    }

    try {
      // Verifica il token prima
      const tokenData = await verifyResetToken(token);

      if (tokenData.email !== email) {
        return res.status(401).json({ error: "Token does not match email" });
      }

      // Resetta la password
      await resetUserPassword(tokenData.user_id, token, password);

      res.json({
        success: true,
        message: "Password has been reset successfully",
      });
    } catch (error) {
      res.status(401).json({ error: error.message });
    }
  })
);

export default router;

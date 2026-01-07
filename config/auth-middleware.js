import { supabase } from "../config/supabaseClient.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const requireAuth = asyncHandler(async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1]; // Bearer 

  if (!token) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  // Verifica il token con supabase
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    console.error("Auth error:", error?.message, "User:", user);
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // salva l'utente in req per usarlo dopo
  req.user = user;
  next();
});

import express from "express";
import { supabase } from "../config/supabaseClient.js";
import { requireAuth } from "../config/auth-middleware.js";
import multer from "multer";
import cloudinary from "../config/cloudinary.js";
import rateLimit from "express-rate-limit";
import { validate } from "../utils/validate.js";
import { userRegisterSchema } from "../utils/schemas.js";

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });

// rate limit register route to prevent abuse
const createAccountLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /register
router.post("/register", createAccountLimiter, validate(userRegisterSchema), async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password)
    return res.status(400).json({ msg: "Missing fields" });

  try {
    // 1. Creazione utente tramite Supabase Auth
    const { data: userData, error: authError } =
      await supabase.auth.admin.createUser({
        email,
        password,
        user_metadata: { name },
        email_confirm: true,
      });

    if (authError) {
      console.error("Supabase error:", authError);
      return res.status(400).json({ msg: authError.message });
    }

    const userId = userData.user.id;

    // 2. Creazione profilo collegato
    const { error: profileError } = await supabase.from("Profile").insert({
      id: userId,
      name: name,
      username: name,
      avatar_url: null,
      email: email,
      currency: "EUR",
      // altri campi default se servono
    });

    if (profileError) {
      console.error("Profile creation error:", profileError);
      return res.status(400).json({ msg: profileError.message });
    }

    // 3. Creazione wallet di default
    // Nessun `balance`: la colonna e' stata rimossa da
    // migrations/005_drop_wallet_balance.sql e non e' mai stata la fonte del saldo
    // (derivato dalle transazioni, utils/walletService.js).
    const { error: walletError } = await supabase.from("Wallet").insert({
      name: "Default wallet",
      userid: userId,
      is_default: true,
    });

    if (walletError) {
      console.error("Wallet creation error:", walletError);
      return res.status(400).json({ msg: walletError.message });
    }

    // 4. Creazione categorie di base (opzionale)
    const incBaseCategories = ["Salary", "Extra"];
    const expBaseCategories = ["Food", "Transport", "Entertainment"];
    const baseCategories = [...incBaseCategories, ...expBaseCategories];

    const categoryInserts = baseCategories.map((name) => ({
      name,
      userid: userId,
      type: incBaseCategories.includes(name) ? "I" : "E",
    }));

    const { error: catError } = await supabase
      .from("Category")
      .insert(categoryInserts);
    if (catError) {
      console.error("Category creation error:", catError);
      return res.status(400).json({ msg: catError.message });
    }

    res.status(201).json({ user: userData.user });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

// GET /users/profile
router.get("/profile", requireAuth, async (req, res) => {
  try {
    // `requireAuth` ha già verificato il token e messo l'utente in `req.user`: rileggere
    // l'header qui era codice morto (la richiesta senza token non arriva a questo handler).
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ message: "User not authenticated" });

    // Query sulla tabella Profile
    const { data, error } = await supabase
      .from("Profile")
      .select("*")
      .eq("id", userId)
      .single(); // per prendere un solo record

    if (error) return res.status(404).json({ message: error.message });

    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /users/profile/photo
router.post(
  "/profile/photo",
  requireAuth,
  upload.single("image"),
  async (req, res) => {
    try {
      // `req.user` è già l'utente verificato da `requireAuth`: la vecchia
      // `supabase.auth.getUser(token)` rileggeva lo stesso token con una seconda chiamata
      // di rete per richiesta, senza aggiungere nulla al controllo d'accesso.
      const userId = req.user.id;

      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: "profile_pics",
          transformation: [{ width: 150, height: 150, crop: "fill" }],
        },
        async (err, result) => {
          if (err)
            return res
              .status(500)
              .json({ message: "Cloudinary upload failed" });

          // salva URL in tabella User su Supabase
          await supabase
            .from("Profile")
            .update({ avatar_url: result.secure_url })
            .eq("id", userId);

          res.json({
            message: "Profile picture updated",
            avatar_url: result.secure_url,
          });
        }
      );

      uploadStream.end(req.file.buffer);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

export default router;

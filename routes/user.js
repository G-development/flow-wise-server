import express from "express";
import { supabase } from "../config/supabaseClient.js";
import { requireAuth } from "../config/auth-middleware.js";
import multer from "multer";
import cloudinary from "../config/cloudinary.js";

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });

// POST /register
router.post("/register", async (req, res) => {
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
      avatar_url: "https://avatar.iran.liara.run/public/",
      email: email,
      currency: "EUR",
      // altri campi default se servono
    });

    if (profileError) {
      console.error("Profile creation error:", profileError);
      return res.status(400).json({ msg: profileError.message });
    }

    // 3. Creazione wallet di default
    const { error: walletError } = await supabase.from("Wallet").insert({
      name: "Default wallet",
      userid: userId,
      is_default: true,
      balance: 0,
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
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ message: "Missing token" });

    // Recupera l'utente loggato dall'header (o dal middleware requireAuth)
    const userId = req.user?.id; // assumendo che requireAuth imposti req.user
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
      const token = req.headers.authorization?.replace("Bearer ", "");
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser(token);
      if (error) return res.status(401).json({ message: error.message });

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
            .eq("id", user.id);

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

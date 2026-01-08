import express from "express";
import { supabase } from "../config/supabaseClient.js";
import { requireAuth } from "../config/auth-middleware.js";

const router = express.Router();

// GET /dashboard-layout - Ottieni layout utente
router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;

    const { data, error } = await supabase
      .from("dashboard_layouts")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (error) {
      // Se non esiste, ritorna layout vuoto (il client userà DEFAULT_LAYOUT)
      if (error.code === "PGRST116") {
        return res.json({ widgets: [] });
      }
      throw error;
    }

    res.json(data);
  } catch (error) {
    console.error("Error fetching dashboard layout:", error);
    res.status(500).json({ error: "Failed to fetch dashboard layout" });
  }
});

// PUT /dashboard-layout - Salva/aggiorna layout utente
router.put("/", requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    const { widgets } = req.body;

    if (!Array.isArray(widgets)) {
      return res.status(400).json({ error: "widgets must be an array" });
    }

    // Upsert: inserisce o aggiorna se esiste già
    const { data, error } = await supabase
      .from("dashboard_layouts")
      .upsert(
        {
          user_id: userId,
          widgets,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "user_id", // Unique constraint
        }
      )
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error("Error saving dashboard layout:", error);
    res.status(500).json({ error: "Failed to save dashboard layout" });
  }
});

export default router;

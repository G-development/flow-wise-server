import express from "express";
import { User } from "./models.mjs";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { authMiddleware } from "./authMiddleware.mjs";
import cloudinary from "../config/cloudinary.js";
import multer from "multer";

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });

const generateToken = (user) => {
  return jwt.sign(
    { id: user._id },
    // { id: User.email, password: User.password },
    process.env.JWT_SECRET,
    {
      expiresIn: "30Days",
    }
  );
};

// GET all users
router.get("/all", async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (error) {
    res.status(500).json({ msg: "users/all", message: error.message });
    console.error(error);
  }
});

// POST create a user
router.post("/register", async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const newUser = new User({ name, email, password });
    await newUser.save();
    res.status(201).json(newUser);
  } catch (error) {
    res.status(400).json({ msg: "users/register", message: error.message });
    console.error(error);
  }
});

// POST login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ msg: "Email o password errati" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(401).json({ msg: "Email o password errati" });

    const token = generateToken(user);

    res.json({
      token,
      user: user,
      // user: user._id
    });
  } catch (error) {
    res.status(500).json({ msg: "users/login", message: error.message });
    console.error(error);
  }
});

// GET profile
router.get("/profile", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password"); // Esclude la password dalla risposta
    if (!user) return res.status(404).json({ msg: "Utente non trovato" });

    res.json(user);
  } catch (error) {
    res
      .status(500)
      .json({ msg: "Errore nel recupero del profilo", error: error.message });
  }
});

// POST /users/profile/photo → Aggiorna la foto profilo
router.post(
  "/profile/photo",
  authMiddleware,
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file)
        return res.status(400).json({ message: "No image uploaded" });
      console.log("reqfile", req.file);

      const uploadStream = cloudinary.uploader
        .upload_stream(
          {
            folder: "profile_pics",
            transformation: [
              { width: 150, height: 150, crop: "fill" },
            ],
          },
          async (error, result) => {
            if (error)
              return res
                .status(500)
                .json({ message: "Cloudinary upload failed" });

            const user = await User.findByIdAndUpdate(
              req.user.id,
              { profilePic: result.secure_url },
              { new: true }
            ).select("-password");
            res.json({
              message: "Profile picture updated",
              profilePic: user.profilePic,
            });
          }
        )
        .end(req.file.buffer);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// GET a single user by ID
// router.get('/:id', async (req, res) => {
//     try {
//         const user = await User.findById(req.params.id);
//         if (!user) return res.status(404).json({ message: 'User not found' });
//         res.json(user);
//     } catch (error) {
//         res.status(500).json({ message: error.message });
//     }
// });

// DELETE a user by ID
// router.delete('/:id', async (req, res) => {
//     try {
//         const user = await User.findByIdAndDelete(req.params.id);
//         if (!user) return res.status(404).json({ message: 'User not found' });
//         res.json({ message: 'User deleted' });
//     } catch (error) {
//         res.status(500).json({ message: error.message });
//     }
// });

export default router;

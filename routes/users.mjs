import express from "express";
import mongoose from "mongoose";
import {User} from "./models.mjs";

const router = express.Router();

// GET all users
router.get("/all", async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
    console.log("getUsers/all ok");
    
  } catch (error) {
    res.status(500).json({ msg: "getUsers/all", message: error.message });
    console.log(error.message);
  }
});

// POST create a user
router.post('/create', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        const newUser = new User({ name, email, password });
        await newUser.save();
        res.status(201).json(newUser);
        console.log("getUsers/create ok");
    } catch (error) {
        res.status(400).json({ message: error.message });
        console.log(error.message);
        
    }
});

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

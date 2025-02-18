// import mongoose from "mongoose";

// const connectMongoDB = async () => {
//   try {
//     await mongoose.connect(process.env.MONGO_URI);
//     console.log("MongoDB Connected\n");
//   } catch (error) {
//     console.error("Error connecting to MongoDB:", error);
//     process.exit(1);
//   }
// };

// export default connectMongoDB;


import mongoose from 'mongoose';

const connectMongoDB = async () => {
  // Verifica se la connessione è già attiva
  if (mongoose.connections[0].readyState) {
    console.log("MongoDB already connected.");
    return;
  }

  try {
    console.log("Attempting to connect to MongoDB...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB Connected!");
  } catch (error) {
    console.error("❌ Error connecting to MongoDB:", error);
    throw new Error("MongoDB connection failed");
  }
};

export default connectMongoDB;

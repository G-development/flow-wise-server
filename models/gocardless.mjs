import mongoose from "mongoose";

const RequisitionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  requisitionId: { type: String, required: true, unique: true },
  institutionId: { type: String, required: true },
  status: { type: String, required: true },
  accounts: [{ type: String }],
  createdAt: { type: Date, default: Date.now },
});

export const Requisition = mongoose.model("Requisition", RequisitionSchema);

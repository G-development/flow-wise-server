import mongoose from "mongoose";
import bcrypt from "bcrypt";

const UserSchema = new mongoose.Schema(
  {
    name: { required: true, type: String },
    email: { required: true, type: String, unique: true },
    password: { required: true, type: String },
  },
  { timestamps: true }
);

UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

UserSchema.methods.comparePassword = async function (password) {
  return bcrypt.compare(password, this.password);
};

const IncomeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    amount: Number,
    description: String,
    date: { type: Date, default: Date.now },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
  },
  { timestamps: true }
);

const ExpenseSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    amount: Number,
    description: String,
    date: { type: Date, default: Date.now },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
  },
  { timestamps: true }
);

const CategorySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    name: String,
    type: { type: String, enum: ["income", "expense"] },
  },
  { timestamps: true }
);

const BudgetSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
    limit: Number,
    period: String, // es. 'monthly', 'weekly'
  },
  { timestamps: true }
);

export const User = mongoose.model("User", UserSchema);
export const Income = mongoose.model("Entry", IncomeSchema);
export const Expense = mongoose.model("Expense", ExpenseSchema);
export const Category = mongoose.model("Category", CategorySchema);
export const Budget = mongoose.model("Budget", BudgetSchema);

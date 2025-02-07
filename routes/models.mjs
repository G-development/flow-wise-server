import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
}, { timestamps: true });

const IncomeSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  amount: Number,
  description: String,
  date: { type: Date, default: Date.now },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
}, { timestamps: true });

const ExpenseSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  amount: Number,
  description: String,
  date: { type: Date, default: Date.now },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
}, { timestamps: true });

const CategorySchema = new mongoose.Schema({
  name: String,
  type: { type: String, enum: ['income', 'expense'] },
}, { timestamps: true });

const BudgetSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  limit: Number,
  period: String, // es. 'monthly', 'weekly'
}, { timestamps: true });

export const User = mongoose.model('User', UserSchema);
export const Income = mongoose.model('Entry', IncomeSchema);
export const Expense = mongoose.model('Expense', ExpenseSchema);
export const Category = mongoose.model('Category', CategorySchema);
export const Budget = mongoose.model('Budget', BudgetSchema);
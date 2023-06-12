import mongoose from "mongoose";

const { Schema } = mongoose;

// creating mongo database schema
const transactionSchema = new Schema(
  {
    userId: { type:Object },
    roomId: { type: Schema.Types.ObjectId, ref: "room", default: null },
    amount: { type: Number },
    prevWallet: { type: Number, default: 0 },
    updatedWallet: { type: Number, default: 0 },
    prevTicket: { type: Number, default: 0 },
    updatedTicket: { type: Number, default: 0 },
    transactionDetails: {},
    tournamentId: { type: String },
    transactionType: { type: String, enum: ["poker", "blackjack", "slot"] },
    status: { type: String },
  },
  { timestamps: true }
);

const transactionModel = mongoose.model("transactions", transactionSchema);

export default transactionModel;

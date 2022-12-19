import mongoose from 'mongoose';

const schema = mongoose.Schema({
  userId: { type: mongoose.Types.ObjectId, ref: 'users' },
  gameName: { type: String, enum: ['poker', 'blackjack', 'slot'] },
  win: { type: Number, default: 0 },
  loss: { type: Number, default: 0 },
  totalWinAmount: { type: Number, default: 0 },
  totalLossAmount: { type: Number, default: 0 },
});

const rankModel = mongoose.model('rank', schema);
export default rankModel;

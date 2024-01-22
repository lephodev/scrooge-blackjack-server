import mongoose from 'mongoose';
const { Schema } = mongoose;

const bonusModel = new mongoose.Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    bonusType: { type: String},
    bonusAmount: { type: String },
    bonusExpirationTime: { type: Date},
    wagerLimit: { type: Number, default: 20 },
    wageredAmount: { type: Number, default: 0 },
    rollOverTimes: { type: Number, default: 0 },
    isExpired: {type: Boolean, default: false},
    subCategory: { type: String },
    restAmount: {  type: Number },
    expiredAmount: {  type: Number },
    executing: {type: Boolean, default: false}
  },
  { timestamps: true }
);

const BonusModel = mongoose.model('bonus', bonusModel);

export default BonusModel;

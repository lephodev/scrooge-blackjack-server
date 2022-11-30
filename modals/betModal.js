import mongoose from "mongoose";

const schema = mongoose.Schema(
  {
    tableId: {
      type: String,
    },
    bet: [
      {
        betBy: {
          name: {
            type: String,
          },
          photoURI: {
            type: String,
          },
          userid: {
            type: String,
          },
        },
        selectedBetPlayer: {
          name: {
            type: String,
          },
          photoURI: {
            type: String,
          },
          id: {
            type: String,
          },
        },
        betType: {
          type: Boolean,
          default: false,
        },
        betAmount: {
          type: Number,
          default: 0.0,
        },
        betAcceptBy: {
          name: {
            type: String,
          },
          photoURI: {
            type: String,
          },
          userid: {
            type: String,
          },
        },
        isAccepted: {
          type: Boolean,
          default: false,
        },
      },
    ],
  },
  { timestamps: true }
);

const BetModal = mongoose.model("betBlackjack", schema);
export default BetModal;

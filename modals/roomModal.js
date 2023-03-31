//imports
import mongoose from "mongoose";

const Schema = mongoose.Schema;

//creating mongo database schema
const roomSchema = new Schema({
  players: [],
  gameName: { type: String },
  gamestart: { type: Boolean, default: false },
  winnerPlayer: [],
  timer: { type: Number, default: 15 },
  hostId: { type: String, default: null },
  handWinner: [],
  firstGameTime: { type: Date },
  finish: { type: Boolean, default: false },
  tableId: { type: String },
  gameType: { type: String },
  invPlayers: [],
  watchers: [],
  public: { type: Boolean, default: false },
  allowWatcher: { type: Boolean, default: false },
  meetingId: { type: String },
  meetingToken: { type: String },
  media: { type: String },
  dealer: { type: Object },
  deck: { type: Array },
  preTimer: { type: Boolean, default: false },
  gameCardStats: { type: Array },
  drawPlayers: { type: Array },
  leaveReq: { type: Array },
  remainingPretimer: { type: Number, default: 5 },
  createdAt: {
    type: Date,
    default: Date.now(),
  },
  chats: [],
  askForInsurance: { type: Boolean, default: false },
  actedForInsurace: { type: Number, default: 0 },
});

roomSchema.pre("save", function (next) {
  this.tableId = this._id.toString();
  next();
});

const roomModel = mongoose.model("blackjackroom", roomSchema);

export default roomModel;

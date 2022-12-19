import mongoose from 'mongoose';

const NotificationSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    message: { type: String },
    isRead: { type: Boolean, default: false },
    url: { type: String },
  },
  { timestamps: true }
);
const Notification = mongoose.model('Notification', NotificationSchema);

export default Notification;

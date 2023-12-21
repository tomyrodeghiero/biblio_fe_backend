import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  requester: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  status: { type: String, default: "pending" },
  type: String,
  message: String,
  book: { type: mongoose.Schema.Types.ObjectId, ref: "Book" },
  status: {
    type: String,
    enum: ["unread", "read"],
    default: "unread",
  },
});

const Notification = mongoose.model("Notification", notificationSchema);

export default Notification;

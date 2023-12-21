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
  message: String,
  bookApproved: { type: Boolean, default: false },
  bookNameApproved: String,
});

const Notification = mongoose.model("Notification", notificationSchema);

export default Notification;

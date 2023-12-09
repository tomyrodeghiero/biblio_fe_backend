import mongoose from "mongoose";

const downloadHistorySchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  bookId: mongoose.Schema.Types.ObjectId,
  downloadDate: Date,
});

const DownloadHistory = mongoose.model(
  "DownloadHistory",
  downloadHistorySchema
);

module.exports = DownloadHistory;

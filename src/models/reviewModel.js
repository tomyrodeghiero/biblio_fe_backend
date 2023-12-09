import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema({
  bookId: mongoose.Schema.Types.ObjectId,
  userId: mongoose.Schema.Types.ObjectId,
  rating: Number,
  comment: String,
  createdAt: Date,
  updatedAt: Date,
});

const Review = mongoose.model("Review", reviewSchema);

module.exports = Review;

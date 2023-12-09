import mongoose from "mongoose";

const bookSchema = new mongoose.Schema({
  title: String,
  author: String,
  createBy: mongoose.Schema.Types.ObjectId,
  description: String,
  pdfUrl: String,
  coverImageUrl: String,
  publishedDate: Date,
  genreIds: [String],
  language: String,
  tags: [String],
  createdAt: Date,
  updatedAt: Date,
  rating: Number,
});

const Book = mongoose.model("Book", bookSchema);

export default Book;

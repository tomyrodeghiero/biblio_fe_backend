import mongoose from "mongoose";

const bookSchema = new mongoose.Schema({
  title: String,
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Author",
  },
  createdBy: String,
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
  review: String,
  category: String,
  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending",
  },
});

const Book = mongoose.model("Book", bookSchema);

export default Book;

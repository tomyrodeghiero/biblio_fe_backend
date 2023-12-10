import mongoose from "mongoose";

const authorSchema = new mongoose.Schema({
  name: String,
  biography: String,
  profilePicture: String,
  nationality: String,
  dateOfBirth: Date,
  dateOfDeath: Date,
  books: [{ type: mongoose.Schema.Types.ObjectId, ref: "Book" }],
});

const Author = mongoose.model("Author", authorSchema);

export default Author;

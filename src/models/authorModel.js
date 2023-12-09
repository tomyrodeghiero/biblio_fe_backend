import mongoose from "mongoose";

const authorSchema = new mongoose.Schema({
  name: String,
  biography: String,
  profilePicture: String,
  nationality: String,
  dateOfBirth: Date,
});

const Author = mongoose.model("Author", authorSchema);

module.exports = Author;

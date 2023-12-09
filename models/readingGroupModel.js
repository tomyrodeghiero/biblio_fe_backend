import mongoose from "mongoose";

const readingGroupSchema = new mongoose.Schema({
  name: String,
  description: String,
  members: [mongoose.Schema.Types.ObjectId],
  currentBook: mongoose.Schema.Types.ObjectId,
});

const ReadingGroup = mongoose.model("ReadingGroup", readingGroupSchema);

module.exports = ReadingGroup;

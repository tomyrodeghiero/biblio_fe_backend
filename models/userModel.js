import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  username: String,
  email: String,
  profile: {
    name: String,
    profilePicture: String,
  },
  favoriteBooks: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Book",
    },
  ],
  createdAt: Date,
  updatedAt: Date,
});

const User = mongoose.model("User", userSchema);

export default User;

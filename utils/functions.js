import fs from "fs";

// Function to delete local files
export const deleteLocalFiles = (files) => {
  for (const file of files) {
    fs.unlink(file.path, (err) => {
      if (err) console.error(`Failed to delete local file: ${file.path}`);
      else console.log(`Successfully deleted local file: ${file.path}`);
    });
  }
};

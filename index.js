import dotenv from "dotenv";
dotenv.config();

import { ObjectId } from "mongodb";

import { google } from "googleapis";
import express from "express";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
mongoose.set("strict", false);
mongoose.connect(process.env.DB_HOST);

import Book from "./models/bookModel.js";
import User from "./models/userModel.js";

import { deleteLocalFiles } from "./utils/functions.js";

const app = express();
app.use(express.json());

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

// Check if credentials are set
try {
  const credentials = {
    access_token: process.env.ACCESS_TOKEN,
    refresh_token: process.env.REFRESH_TOKEN,
    scope: process.env.SCOPE,
    token_type: process.env.TOKEN_TYPE,
    expiry_date: process.env.EXPIRY_DATE,
  };
  oauth2Client.setCredentials(credentials);
} catch (error) {
  console.log("No credentials found", error);
}

app.get("/auth/google", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/drive",
    ],
  });
  res.redirect(url);
});

app.get("/google/redirect", async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  fs.writeFileSync("credentials.json", JSON.stringify(tokens));
  res.send("Authenticated");
});

app.get("/api/books", async (req, res) => {
  try {
    const books = await Book.find();
    const totalBooks = await Book.countDocuments();

    res.status(200).send({
      data: books,
      total: totalBooks,
    });
  } catch (error) {
    res.status(500).send(error);
  }
});

// Create a new book
app.post("/api/books", async (req, res) => {
  const {
    title,
    authorId: author,
    createdBy,
    description,
    pdfBase64,
    coverImageBase64,
    language,
    tags,
  } = req.body;

  if (!title || !pdfBase64 || !coverImageBase64) {
    return res
      .status(400)
      .send("Both PDF and cover image base64 are required.");
  }

  const pdfBuffer = Buffer.from(pdfBase64, "base64");
  const coverImageBuffer = Buffer.from(coverImageBase64, "base64");

  // Configuración de Google Drive
  const drive = google.drive({ version: "v3", auth: oauth2Client });

  // Subir archivo PDF
  let pdfDriveResponse;
  try {
    pdfDriveResponse = await drive.files.create({
      requestBody: {
        name: `${title}.pdf`,
        mimeType: "application/pdf",
        parents: [process.env.DRIVE_FOLDER_ID],
      },
      media: {
        mimeType: "application/pdf",
        body: pdfBuffer,
      },
    });
  } catch (error) {
    return res.status(500).send(error);
  }

  // Subir imagen de portada
  let coverImageDriveResponse;
  try {
    coverImageDriveResponse = await drive.files.create({
      requestBody: {
        name: `${title}-cover.jpg`,
        mimeType: "image/jpeg",
        parents: [process.env.DRIVE_FOLDER_ID],
      },
      media: {
        mimeType: "image/jpeg",
        body: coverImageBuffer,
      },
    });
  } catch (error) {
    return res.status(500).send(error);
  }

  // Crear el objeto libro con URLs de Google Drive
  const newBook = new Book({
    title,
    author: author || "",
    createdBy,
    description,
    pdfUrl: `https://drive.google.com/uc?id=${pdfDriveResponse.data.id}`,
    coverImageUrl: `https://drive.google.com/uc?id=${coverImageDriveResponse.data.id}`,
    publishedDate: new Date(),
    genreIds: [],
    language,
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  try {
    await newBook.save();
    res.status(200).send(newBook);
  } catch (error) {
    res.status(500).send(error);
  }
});

app.post("/api/users", async (req, res) => {
  const { username, email, profilePicture } = req.body;

  try {
    const existingUser = await User.findOne({ email: email });
    if (existingUser) {
      return res.status(200).send(existingUser);
    }

    const newUser = new User({
      username,
      email,
      profile: {
        name: username,
        profilePicture,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await newUser.save();
    res.status(201).send(newUser);
  } catch (error) {
    res.status(500).send(error);
  }
});

app.get("/api/users", async (req, res) => {
  try {
    const users = await User.find();
    res.status(200).send(users);
  } catch (error) {
    res.status(500).send(error);
  }
});

const uploadPath = "./src/POR AUTORES";

const uploadBook = async (filePath, fileName, author) => {
  const existingBook = await Book.findOne({ title: fileName, author: author });
  if (existingBook) {
    console.log(
      `El libro ${fileName} de ${author} ya existe, omitiendo la subida.`
    );
    return;
  }

  const pdfFile = {
    originalname: fileName,
    mimetype: "application/pdf",
    path: filePath,
  };

  const drive = google.drive({ version: "v3", auth: oauth2Client });

  // Upload PDF file to Google Drive
  const pdfFileMetadata = {
    name: pdfFile.originalname,
    mimeType: pdfFile.mimetype,
    parents: [process.env.DRIVE_FOLDER_ID],
  };
  const pdfMedia = {
    mimeType: pdfFile.mimetype,
    body: fs.createReadStream(pdfFile.path),
  };
  let pdfDriveResponse;
  try {
    pdfDriveResponse = await drive.files.create({
      requestBody: pdfFileMetadata,
      media: pdfMedia,
    });
  } catch (error) {
    console.log(`Error al subir el archivo PDF ${fileName}:`, error);
    return;
  }

  const newBook = new Book({
    title: fileName,
    author: author,
    createdBy: new ObjectId("657384bf6e9a75c2d37aa7c9"),
    description: "",
    pdfUrl: `https://drive.google.com/uc?id=${pdfDriveResponse.data.id}`,
    coverImageUrl: "url_de_la_imagen_de_portada",
    publishedDate: new Date(),
    genreIds: [],
    language: "Español",
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    rating: 5.0,
  });

  try {
    await newBook.save();
    console.log(`Libro ${fileName} guardado con éxito`);
  } catch (error) {
    console.log(`Error al guardar el libro ${fileName}:`, error);
  }
};

const processDirectory = async (dirPath, authorName = "") => {
  fs.readdir(dirPath, async (err, files) => {
    if (err) {
      console.log(err);
      return;
    }

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const fileStats = fs.statSync(filePath);

      if (fileStats.isFile() && path.extname(file) === ".pdf") {
        await uploadBook(filePath, file, authorName);
      } else if (fileStats.isDirectory()) {
        await processDirectory(filePath, file);
      }
    }
  });
};

app.get("/api/upload-books", (req, res) => {
  processDirectory(uploadPath);
  res.send("Subiendo libros...");
});

const deleteAllBooks = async () => {
  try {
    const result = await Book.deleteMany({});
    console.log(`Se han borrado ${result.deletedCount} libros`);
    mongoose.disconnect();
  } catch (error) {
    console.error("Error al borrar libros:", error);
    mongoose.disconnect();
  }
};

app.get("/api/delete-books", (req, res) => {
  deleteAllBooks();
  res.send("Borrando libros...");
});

const PORT = 5001;
app.listen(PORT, () => {
  console.log("Server is running on port 5001");
});

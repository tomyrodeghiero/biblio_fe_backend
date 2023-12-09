import dotenv from "dotenv";
dotenv.config();

import { ObjectId } from "mongodb";
import cors from "cors";
import formidable from "formidable";
import { google } from "googleapis";
import express from "express";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import bodyParser from "body-parser";
mongoose.set("strict", false);
mongoose.connect(process.env.DB_HOST);

import Book from "./models/bookModel.js";
import User from "./models/userModel.js";

const app = express();
app.use(
  cors({
    credentials: true,
    origin: ["http://localhost:3000", process.env.FRONTEND_PUBLIC_URL],
  })
);
app.use(express.json());
app.use(bodyParser.json({ limit: "1gb" }));
app.use(bodyParser.urlencoded({ limit: "1gb", extended: true }));

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

const drive = google.drive({ version: "v3", auth: oauth2Client });

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

// Función para subir archivo a Google Drive
const uploadToGoogleDrive = async (file) => {
  console.log("file -------->", file);
  console.log("filepath -------->", file[0].filepath);
  console.log("mimeType -------->", file[0].mimetype);
  if (!file[0] || !file[0].filepath || !file[0].mimetype) {
    throw new Error("Archivo no válido o ruta de archivo faltante");
  }

  try {
    const response = await drive.files.create({
      requestBody: {
        name: file[0].originalFilename,
        mimeType: file[0].mimetype,
        parents: [process.env.DRIVE_FOLDER_ID],
      },
      media: {
        mimeType: file[0].mimetype,
        body: fs.createReadStream(file[0].filepath),
      },
    });
    return `https://drive.google.com/uc?id=${response.data.id}`;
  } catch (error) {
    console.error("Error uploading file to Google Drive", error);
    throw new Error("Error uploading file");
  }
};

app.post("/api/books", (req, res) => {
  const form = formidable();

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error("Error parsing the files", err);
      return res.status(500).send("Error processing the form");
    }

    // Extracción de campos y archivos
    const { author, createdBy, description, language, tags } = fields;
    const title = Array.isArray(fields.title) ? fields.title[0] : fields.title;

    console.log("files", files);
    const { pdfUrl, coverImage } = files;

    console.log("pdfUrl", pdfUrl);
    console.log("coverImage", coverImage);

    try {
      // Validar si los archivos están presentes
      if (!pdfUrl || !coverImage) {
        throw new Error("Archivos PDF o de portada faltantes");
      }

      const pdfUrlGoogleDrive = await uploadToGoogleDrive(
        pdfUrl,
        "application/pdf"
      );
      const coverImageUrl = await uploadToGoogleDrive(coverImage, "image/jpeg");

      // Crear y guardar el nuevo libro
      const newBook = new Book({
        title,
        author: author,
        createdBy: new ObjectId("657384bf6e9a75c2d37aa7c9"),
        description: "",
        pdfUrl: pdfUrlGoogleDrive,
        coverImageUrl,
        language: "",
        tags: [],
        // Otros campos necesarios
      });

      await newBook.save();
      // Enviar respuesta al cliente
      res.status(200).json(newBook);
    } catch (error) {
      console.error("Error creating book", error);
      res.status(500).send("Error creating book");
    }
  });
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

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
import Author from "./models/authorModel.js";
import FriendRequest from "./models/friendRequestModel.js";
import Notification from "./models/notificationModel.js";

const app = express();
app.use(
  cors({
    credentials: true,
    origin: ["http://localhost:3000", process.env.FRONTEND_PUBLIC_URL],
  })
);
app.use(express.json());
app.use(bodyParser.json({ limit: "50mb" }));
app.use(
  bodyParser.urlencoded({
    limit: "50mb",
    extended: true,
    parameterLimit: 50000,
  })
);

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

// Configurar credenciales iniciales
oauth2Client.setCredentials({
  refresh_token: process.env.REFRESH_TOKEN,
});

// Manejar actualizaciones de tokens
oauth2Client.on("tokens", (tokens) => {
  if (tokens.refresh_token) {
    // Guardar el nuevo token de actualización
    console.log(`Nuevo token de actualización: ${tokens.refresh_token}`);
    // Aquí deberías actualizar el token de actualización en tu almacenamiento
  }
  console.log(`Nuevo token de acceso: ${tokens.access_token}`);
  // Actualizar el token de acceso en tu almacenamiento
});

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
  console.error("No credentials found", error);
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

app.get("/api/get-authors", async (req, res) => {
  try {
    const authors = await Author.find().populate("books");
    const totalAuthors = await Author.countDocuments();

    res.status(200).json({
      data: authors,
      total: totalAuthors,
    });
  } catch (error) {
    console.error("Error al obtener los autores", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

app.get("/api/get-author/:id", async (req, res) => {
  try {
    const authorId = req.params.id;
    const author = await Author.findById(authorId).populate("books");

    if (!author) {
      res.status(404).json({ message: "Autor no encontrado" });
    } else {
      res.status(200).json(author);
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error del servidor" });
  }
});

app.post("/api/create-author", async (req, res) => {
  try {
    const {
      name,
      biography,
      profilePicture,
      nationality,
      dateOfBirth,
      dateOfDeath,
    } = req.body;

    const newAuthor = new Author({
      name,
      biography,
      profilePicture,
      nationality,
      dateOfBirth,
      dateOfDeath,
    });

    await newAuthor.save();

    res.status(201).json(newAuthor);
  } catch (error) {
    console.error("Error al crear un nuevo autor", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

app.patch("/api/update-author/:id", (req, res) => {
  const form = formidable();

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error("Error parsing the form", err);
      return res.status(500).send("Error processing the form");
    }

    try {
      const authorId = req.params.id;
      const author = await Author.findById(authorId);
      if (!author) {
        return res.status(404).json({ message: "Autor no encontrado" });
      }

      // Asegúrate de obtener el primer elemento de cada campo si es un array
      const updateFields = {};
      for (const key in fields) {
        updateFields[key] = Array.isArray(fields[key])
          ? fields[key][0]
          : fields[key];
      }

      // Actualiza los campos del autor
      Object.assign(author, updateFields);

      // Subir la imagen de perfil a Google Drive y obtener la URL, si se proporcionó una
      if (files.profilePicture) {
        const profilePictureUrl = await uploadToGoogleDrive(
          files.profilePicture,
          "image/jpeg"
        );
        author.profilePicture = profilePictureUrl;
      }

      await author.save();
      console.log("Autor actualizado con éxito");
      res.status(200).json(author);
    } catch (error) {
      console.error("Error al actualizar el autor", error);
      res.status(500).json({ message: "Error interno del servidor" });
    }
  });
});

app.get("/api/get-books", async (req, res) => {
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

app.get("/api/get-books/:email", async (req, res) => {
  try {
    const email = req.params.email;
    if (!email) {
      return res.status(400).json({ message: "Email no proporcionado" });
    }

    const user = await User.findOne({ email: email });
    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    if (!Array.isArray(user.favoriteBooks)) {
      return res
        .status(500)
        .json({ message: "Estructura de datos de usuario incorrecta" });
    }

    const books = await Book.find().populate("author", "name"); // Asumiendo que 'name' es el campo con el nombre del autor
    if (!books) {
      return res.status(500).json({ message: "Error al recuperar libros" });
    }

    const favoriteBookIds = new Set(
      user.favoriteBooks.map((book) => book.toString())
    );
    const booksWithLikeStatus = books.map((book) => {
      return {
        ...book.toObject(),
        author: book.author ? book.author.name : "Desconocido", // Incluye solo el nombre del autor
        isFavorite: favoriteBookIds.has(book._id.toString()),
      };
    });

    res.status(200).json({
      data: booksWithLikeStatus,
      total: booksWithLikeStatus.length,
    });
  } catch (error) {
    console.error("Error al obtener libros:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

const migrateAuthors = async () => {
  const books = await Book.find({});

  for (const book of books) {
    // Verificar si el campo 'author' es un string
    if (typeof book.author === "string") {
      let author = await Author.findOne({ name: book.author });

      // Si no existe un autor con ese nombre, créalo
      if (!author) {
        author = new Author({ name: book.author });
        await author.save();
      }

      // Actualizar el libro con el ObjectId del autor
      book.author = author._id;
      await book.save();
    }
  }
};

app.get("/api/migrate-authors", (req, res) => {
  migrateAuthors();
  res.send("Migrando autores...");
});

// GET a specific book by id, including author's name
app.get("/api/book/:id", async (req, res) => {
  try {
    // Cambiado para incluir información del autor
    const book = await Book.findById(req.params.id).populate("author", "name");
    console.log("book", book);

    if (!book) {
      res.status(404).json({ message: "Book not found" });
    } else {
      // Crear un objeto de respuesta con el nombre del autor en lugar del ID
      const bookResponse = {
        ...book.toObject(), // Convierte el documento de Mongoose a un objeto JS
        author: book.author ? book.author.name : "Desconocido", // Incluye solo el nombre del autor
      };

      res.json(bookResponse);
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// Actualizar un libro específico por su ID
app.patch("/api/edit-book/:id", (req, res) => {
  const form = formidable();

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error("Error parsing the form", err);
      return res.status(500).send("Error processing the form");
    }

    // Extracción de campos y archivos
    const title = Array.isArray(fields.title) ? fields.title[0] : fields.title;
    const description = Array.isArray(fields.description)
      ? fields.description[0]
      : fields.description;
    const language = Array.isArray(fields.language)
      ? fields.language[0]
      : fields.language;
    const author = Array.isArray(fields.author)
      ? fields.author[0]
      : fields.author;
    const tags = Array.isArray(fields.tags) ? fields.tags[0] : fields.tags;
    const review = Array.isArray(fields.review)
      ? fields.review[0]
      : fields.review;

    const { coverImage } = files;

    try {
      // Subir la imagen de portada a Google Drive y obtener la URL
      let coverImageUrl;
      if (coverImage) {
        coverImageUrl = await uploadToGoogleDrive(coverImage, "image/jpeg");
      }

      console.log("review", review);
      // Encuentra y actualiza el libro
      const bookId = req.params.id;
      const updates = {
        title,
        author,
        description,
        language,
        tags,
        review,
        ...(coverImageUrl && { coverImageUrl }), // Añadir coverImageUrl solo si existe
      };

      const updatedBook = await Book.findByIdAndUpdate(bookId, updates, {
        new: true,
      });

      if (!updatedBook) {
        return res.status(404).json({ message: "Book not found" });
      }

      res.json(updatedBook);
    } catch (error) {
      console.error("Error updating book", error);
      res.status(500).json({ message: "Error updating book" });
    }
  });
});

// Función para subir archivo a Google Drive
const uploadToGoogleDrive = async (file) => {
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
  console.log("books");

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error("Error parsing the files", err);
      return res.status(500).send("Error processing the form");
    }

    const title = Array.isArray(fields.title) ? fields.title[0] : fields.title;
    const author = Array.isArray(fields.author)
      ? fields.author[0]
      : fields.author;
    const createdBy = Array.isArray(fields.createdBy)
      ? fields.createdBy[0]
      : fields.createdBy;
    const description = Array.isArray(fields.description)
      ? fields.description[0]
      : fields.description;
    const language = Array.isArray(fields.language)
      ? fields.language[0]
      : fields.language;
    const tags = Array.isArray(fields.tags) ? fields.tags[0] : fields.tags;
    const review = Array.isArray(fields.review)
      ? fields.review[0]
      : fields.review;

    const { pdfUrl, coverImage } = files;

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
        description: description || "",
        pdfUrl: pdfUrlGoogleDrive,
        coverImageUrl,
        language: language || "",
        tags: tags || [],
        review: review || "",
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

app.patch("/api/update-user-privacy", async (req, res) => {
  try {
    const { email, isPrivate } = req.body;
    const user = await User.findOneAndUpdate(
      { email: email },
      { isPrivate },
      { new: true }
    );
    if (!user) {
      return res.status(404).send("User not found");
    }
    console.log("isprivate", isPrivate);
    res.status(200).json(user);
  } catch (error) {
    res.status(500).send(error);
  }
});

app.get("/api/get-users", async (req, res) => {
  try {
    const users = await User.find();
    res.status(200).send(users);
  } catch (error) {
    res.status(500).send(error);
  }
});

app.get("/api/get-user/:email", async (req, res) => {
  console.log("email", req.params.email);
  const { email } = req.params;

  try {
    const user = await User.findOne({ email: email });
    if (!user) {
      return res.status(404).send("User not found");
    }
    console.log("user", user);
    res.status(200).json(user);
  } catch (error) {
    res.status(500).send(error);
  }
});

app.post("/api/send-friend-request", async (req, res) => {
  const { requesterEmail, recipientEmail } = req.body;
  console.log("requesterEmail", requesterEmail);
  console.log("recipientEmail", recipientEmail);

  try {
    const requester = await User.findOne({ email: requesterEmail });
    const recipient = await User.findOne({ email: recipientEmail });

    if (!requester || !recipient) {
      return res.status(404).json({ message: "User not found" });
    }

    const newRequest = new FriendRequest({
      requester: requester._id,
      recipient: recipient._id,
      status: "pending",
    });
    await newRequest.save();

    const newNotification = new Notification({
      recipient: recipient._id,
      requester: requester._id,
    });
    await newNotification.save();

    res.status(200).json({ message: "Friend request sent" });
  } catch (error) {
    res.status(500).json({ message: "Error sending friend request" });
  }
});

app.get("/api/get-friends/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const user = await User.findOne({ email: email }).populate("friends");

    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    res.status(200).json(user.friends);
  } catch (error) {
    console.error("Error al obtener los amigos", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

// Eliminar todas las notificaciones
app.delete("/api/delete-all-notifications", async (req, res) => {
  try {
    await Notification.deleteMany({}); // Esto borrará todas las notificaciones

    res.status(200).json({ message: "All notifications deleted" });
  } catch (error) {
    console.error("Error deleting notifications", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Listar solicitudes
app.get("/api/friend-requests/:email", async (req, res) => {
  const user = await User.findOne({ email: req.params.email });
  const requests = await FriendRequest.find({
    recipient: user._id,
    status: "pending",
  }).populate("requester");
  res.status(200).json(requests);
});

app.patch("/api/respond-friend-request", async (req, res) => {
  const { recipientId, requesterId, status } = req.body;

  try {
    const request = await FriendRequest.findOneAndUpdate(
      { recipient: recipientId, requester: requesterId, status: "pending" },
      { status: status },
      { new: true }
    );

    if (!request) {
      return res.status(404).json({ message: "Friend request not found" });
    }

    if (status === "accepted") {
      await User.findByIdAndUpdate(recipientId, {
        $addToSet: { friends: requesterId },
      });
      await User.findByIdAndUpdate(requesterId, {
        $addToSet: { friends: recipientId },
      });
    }

    res.status(200).json({ message: "Friend request updated" });
  } catch (error) {
    res.status(500).json({ message: "Error updating friend request" });
  }
});

app.get("/api/get-notifications/:email", async (req, res) => {
  try {
    const user = await User.findOne({ email: req.params.email });
    if (!user) {
      return res.status(404).send("User not found");
    }

    // Incluye información del solicitante en las notificaciones
    const notifications = await Notification.find({ recipient: user._id })
      .populate("requester", "username email")
      .exec();

    res.status(200).json(
      notifications.map((notification) => {
        return {
          id: notification._id,
          read: notification.read,
          createdAt: notification.createdAt,
          requesterId: notification.requester._id,
          recipientId: user._id,
          status: notification.status,
          requesterUsername: notification.requester.username,
        };
      })
    );
  } catch (error) {
    res.status(500).json({ error: "Error al obtener las notificaciones" });
  }
});

app.patch("/api/notifications/read/:notificationId", async (req, res) => {
  try {
    const notification = await Notification.findByIdAndUpdate(
      req.params.notificationId,
      { read: true },
      { new: true }
    );
    if (!notification) {
      return res.status(404).send("Notification not found");
    }
    res.status(200).json(notification);
  } catch (error) {
    res.status(500).send("Error updating notification");
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

// Delete book by ID
app.delete("/api/delete-book/:id", async (req, res) => {
  try {
    console.log("req.params", req.params.id);
    const result = await Book.findOneAndDelete({ _id: req.params.id });
    console.log("result", result);
    if (!result) {
      // Manejar el caso en que no se encuentre el libro
      res.status(404).send("Libro no encontrado");
    } else {
      // Libro eliminado con éxito
      res.status(200).send("Libro eliminado");
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const linkAuthorsToBooks = async () => {
  const books = await Book.find();

  for (const book of books) {
    if (book.author && typeof book.author === "string") {
      let author = await Author.findOne({ name: book.author });

      if (!author) {
        author = new Author({ name: book.author });
        await author.save();
      }

      book.author = author._id;
      await book.save();
    }
  }

  console.log("Proceso completado");
};

app.get("/api/link-authors", (req, res) => {
  linkAuthorsToBooks();
  res.send("Enlazando autores...");
});

const assignBooksToAuthors = async () => {
  try {
    const books = await Book.find();

    const booksByAuthor = books.reduce((acc, book) => {
      if (book.author) {
        if (!acc[book.author]) {
          acc[book.author] = [];
        }
        acc[book.author].push(book._id);
      }
      return acc;
    }, {});

    for (const [authorId, bookIds] of Object.entries(booksByAuthor)) {
      await Author.findByIdAndUpdate(authorId, { $set: { books: bookIds } });
    }

    console.log("Autores actualizados con sus libros");
  } catch (error) {
    console.error("Error al asignar libros a autores:", error);
  }
};

app.get("/api/assign-books-to-authors", (req, res) => {
  assignBooksToAuthors();
  res.send("Asignando libros a autores...");
});

// Endpoint para obtener autores con nombres duplicados
app.get("/api/get-duplicate-authors", async (req, res) => {
  try {
    const duplicateAuthors = await Author.aggregate([
      {
        $group: {
          _id: { name: "$name" }, // Agrupa por el campo 'name'
          count: { $sum: 1 }, // Cuenta cuántos documentos tienen este 'name'
        },
      },
      {
        $match: {
          count: { $gt: 1 }, // Selecciona solo los grupos con más de un documento
        },
      },
    ]);

    if (duplicateAuthors.length === 0) {
      return res
        .status(404)
        .json({ message: "No se encontraron autores duplicados" });
    }

    res.json(duplicateAuthors);
  } catch (error) {
    console.error("Error al buscar autores duplicados", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

app.delete("/api/delete-author/:id", async (req, res) => {
  const authorId = req.params.id;

  try {
    const result = await Author.findByIdAndDelete(authorId);

    if (!result) {
      return res.status(404).json({ message: "Autor no encontrado" });
    }

    res.status(200).json({ message: "Autor eliminado con éxito" });
  } catch (error) {
    console.error("Error al eliminar el autor", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// User endpoint
app.patch("/api/favorite-books-for-user", async (req, res) => {
  try {
    const { email, bookId } = req.body; // Obtiene los parámetros del cuerpo de la solicitud

    const user = await User.findOne({ email: email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Verifica si el libro ya está en la lista de favoritos
    const index = user.favoriteBooks.indexOf(bookId);
    if (index === -1) {
      // Si no está, lo agrega
      user.favoriteBooks.push(bookId);
    } else {
      // Si ya está, lo quita (toggle)
      user.favoriteBooks.splice(index, 1);
    }

    await user.save();
    console.log("Estado de favorito actualizado");
    res.status(200).json({ message: "Estado de favorito actualizado" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

app.get("/api/get-user-favorite-books/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const user = await User.findOne({ email: email })
      .populate("favoriteBooks")
      .exec();

    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    const response = {
      data: user.favoriteBooks,
      total: user.favoriteBooks.length,
    };

    res.status(200).json(response);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

app.get("/api/get-authors-name", async (req, res) => {
  try {
    const authors = await Author.find().select("name"); // Modificado para seleccionar solamente el campo 'name'
    const totalAuthors = await Author.countDocuments();

    res.status(200).json({
      data: authors.map((author) => author.name),
      total: totalAuthors,
    });
  } catch (error) {
    console.error("Error al obtener los autores", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

const PORT = 5001;
app.listen(PORT, () => {
  console.log("Server is running on port 5001");
});

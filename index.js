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

// Importa tus modelos de Mongoose aquí
import Book from "./models/bookModel.js";
import User from "./models/userModel.js";
import Author from "./models/authorModel.js";
import FriendRequest from "./models/friendRequestModel.js";
import Notification from "./models/notificationModel.js";
import Category from "./models/categoryModel.js";
import Token from "./models/tokenModel.js";

mongoose.set("strict", false);
mongoose
  .connect(process.env.DB_HOST)
  .then(() => {
    console.log("Conectado a MongoDB");
    initializeOAuthClient().catch(console.error);
  })
  .catch((err) => console.error("No se pudo conectar a MongoDB", err));

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

oauth2Client.on("tokens", async (tokens) => {
  if (tokens.refresh_token) {
    await storeRefreshToken(tokens.refresh_token);
  }
});

async function initializeOAuthClient() {
  try {
    const storedRefreshToken = await getStoredRefreshToken();
    if (storedRefreshToken) {
      oauth2Client.setCredentials({ refresh_token: storedRefreshToken });
      console.log("OAuth client initialized with stored refresh token.");
    } else {
      console.log("No stored refresh token found.");
    }
  } catch (error) {
    console.error("Error initializing OAuth client", error);
  }
}

const storeRefreshToken = async (refreshToken) => {
  // Puedes decidir actualizar un token existente o crear uno nuevo
  const existingToken = await Token.findOne();
  if (existingToken) {
    existingToken.refreshToken = refreshToken;
    await existingToken.save();
  } else {
    const token = new Token({ refreshToken });
    await token.save();
  }
};

const getStoredRefreshToken = async () => {
  const token = await Token.findOne();
  return token ? token.refreshToken : null;
};

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

// Evento para manejar actualizaciones de tokens
oauth2Client.on("tokens", async (tokens) => {
  if (tokens.refresh_token) {
    // Guardar el nuevo token de actualización
    await storeRefreshToken(tokens.refresh_token);
  }
});

const drive = google.drive({ version: "v3", auth: oauth2Client });

// Ruta de autenticación de Google
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

// Ruta de redirección de Google
app.get("/google/redirect", async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  if (tokens.refresh_token) {
    await storeRefreshToken(tokens.refresh_token);
  }

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
      res.status(200).json(author);
    } catch (error) {
      console.error("Error al actualizar el autor", error);
      res.status(500).json({ message: "Error interno del servidor" });
    }
  });
});

app.post("/api/update-author-books/:authorId", async (req, res) => {
  const authorId = req.params.authorId;
  const { bookId } = req.body;

  try {
    // Verificar si el autor y el libro existen
    const authorExists = await Author.findById(authorId);
    const bookExists = await Book.findById(bookId);

    if (!authorExists || !bookExists) {
      return res.status(404).json({ message: "Author or book not found" });
    }

    // Actualizar la lista de libros del autor
    await Author.findByIdAndUpdate(
      authorId,
      { $addToSet: { books: bookId } }, // Usa $addToSet para evitar duplicados
      { new: true } // Devuelve el documento modificado
    );

    res
      .status(200)
      .json({ message: "Author's book list updated successfully" });
  } catch (error) {
    console.error("Error updating author's book list", error);
    res.status(500).json({ error: "Internal server error" });
  }
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

app.get("/api/get-book-titles", async (req, res) => {
  try {
    const books = await Book.find({}, "title"); // Solo selecciona el campo 'title'
    const titles = books.map((book) => book.title); // Extrae los títulos en un arreglo

    res.status(200).send({
      data: titles,
      total: titles.length,
    });
  } catch (error) {
    res.status(500).send(error);
  }
});

app.get("/api/get-pending-books", async (req, res) => {
  try {
    const pendingBooks = await Book.find({ status: "pending" }).populate(
      "author",
      "name"
    );

    if (!pendingBooks.length) {
      return res.status(404).json({ message: "No pending books found" });
    }

    res.status(200).json({
      data: pendingBooks,
      total: pendingBooks.length,
    });
  } catch (error) {
    console.error("Error al obtener libros pendientes", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

app.get("/api/get-books/:email", async (req, res) => {
  try {
    const email = req.params.email;
    if (!email) {
      return res.status(400).json({ message: "Email not provided" });
    }

    // Find the user by email and populate their favoriteBooks
    const user = await User.findOne({ email: email }).populate("favoriteBooks");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Create a set of favorite book IDs for quick checking
    const favoriteBookIds = new Set(
      user.favoriteBooks.map((book) => book._id.toString())
    );

    console.log("Favorite book IDs:", favoriteBookIds);

    // Find all books in the database and populate their author field
    const books = await Book.find({}).populate("author", "name");

    // Create an array of books with the isFavorite property
    const booksWithFavoriteStatus = books.map((book) => {
      return {
        ...book.toObject(),
        isFavorite: favoriteBookIds.has(book._id.toString()),
        author: book.author ? book.author.name : "Unknown",
      };
    });

    res.status(200).json({
      data: booksWithFavoriteStatus,
      total: booksWithFavoriteStatus.length,
    });
  } catch (error) {
    console.error("Error fetching books:", error);
    res.status(500).json({ message: "Internal server error" });
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
app.get("/api/book", async (req, res) => {
  try {
    // Obtén el ID del libro y el email del usuario desde los parámetros de consulta
    const bookId = req.query.id;
    const email = req.query.email;

    if (!bookId || !email) {
      return res
        .status(400)
        .json({ message: "Book ID and email not provided" });
    }

    // Encuentra el usuario por su email y popula su lista de libros favoritos
    const user = await User.findOne({ email: email }).populate("favoriteBooks");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Crea un conjunto de IDs de libros favoritos para comprobación rápida
    const favoriteBookIds = new Set(
      user.favoriteBooks.map((book) => book._id.toString())
    );

    // Encuentra el libro por su ID y popula el nombre del autor
    const book = await Book.findById(bookId).populate("author", "name");

    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    // Crea un objeto de respuesta con la información del libro y si es favorito o no
    const bookResponse = {
      ...book.toObject(),
      author: book.author ? book.author.name : "Unknown",
      isFavorite: favoriteBookIds.has(book._id.toString()),
    };

    res.json(bookResponse);
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
    const status = Array.isArray(fields.status)
      ? fields.status[0]
      : fields.status;

    const { coverImage } = files;

    try {
      const bookId = req.params.id;

      // Encuentra el libro antes de actualizarlo
      const originalBook = await Book.findById(bookId);
      if (!originalBook) {
        return res.status(404).json({ message: "Book not found" });
      }

      let coverImageUrl;
      if (coverImage) {
        coverImageUrl = await uploadToGoogleDrive(coverImage, "image/jpeg");
      }

      const updates = {
        title,
        author,
        description,
        language,
        tags,
        review,
        status,
        ...(coverImageUrl && { coverImageUrl }),
      };

      const updatedBook = await Book.findByIdAndUpdate(bookId, updates, {
        new: true,
      });

      // Verifica si el estado cambió a 'approved'
      if (
        originalBook.status === "pending" &&
        updatedBook.status === "approved"
      ) {
        // Encontrar el usuario correspondiente a createdBy
        const user = await User.findOne({ email: originalBook.createdBy });

        if (user) {
          // Crear y guardar una notificación
          const newNotification = new Notification({
            recipient: user._id,
            message: `Your book "${updatedBook.title}" has been approved.`,
            bookApproved: true,
            type: "bookApproval",
            bookNameApproved: updatedBook.title,
            book: updatedBook._id,
            status: "pending",
          });
          await newNotification.save();
        }
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

app.post("/api/books", async (req, res) => {
  const form = formidable();

  const refreshToken = await getStoredRefreshToken();
  console.log("Refresh Token:", refreshToken);

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error("Error parsing the files", err);
      return res.status(500).send("Error processing the form");
    }

    const title = Array.isArray(fields.title) ? fields.title[0] : fields.title;
    const author = Array.isArray(fields.author)
      ? fields.author[0]
      : fields.author;
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
    const category = Array.isArray(fields.category)
      ? fields.category[0]
      : fields.category;
    const createdBy = Array.isArray(fields.createdBy)
      ? fields.createdBy[0]
      : fields.createdBy;

    const { pdfUrl, coverImage } = files;

    try {
      // Validar si los archivos están presentes
      if (!pdfUrl) {
        throw new Error("Archivos PDF o de portada faltantes");
      }

      const pdfUrlGoogleDrive = await uploadToGoogleDrive(
        pdfUrl,
        "application/pdf"
      );
      let coverImageUrl;
      if (coverImage) {
        coverImageUrl = await uploadToGoogleDrive(coverImage, "image/jpeg");
      }

      // Crear y guardar el nuevo libro
      const newBook = new Book({
        title,
        author: author,
        createdBy: createdBy,
        description: description || "",
        pdfUrl: pdfUrlGoogleDrive,
        coverImageUrl: coverImageUrl || "",
        language: language || "",
        tags: tags || [],
        review: review || "",
        category: new ObjectId(category),
        rating: 5.0,
      });

      // Crear una notificación
      const newNotification = new Notification({
        type: "newBook",
        message: `Nuevo libro pendiente de aprobación: ${fields.title}`,
        book: newBook._id,
      });

      await newNotification.save();

      await newBook.save();
      res.status(200).json(newBook);
    } catch (error) {
      console.error("Error creating book", error);
      res.status(500).send("Error creating book");
    }
  });
});

app.post("/api/users", async (req, res) => {
  const { username, email, profilePicture, dateOfBirth, nationality, bio } =
    req.body;

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
        dateOfBirth,
        nationality,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      registrationCompleted: false,
    });

    await newUser.save();
    res.status(201).send(newUser);
  } catch (error) {
    res.status(500).send(error);
  }
});

app.patch("/api/update-user/:email", async (req, res) => {
  const { email } = req.params;
  const { username, profilePicture, dateOfBirth, gender, nationality, bio } =
    req.body;

  try {
    const user = await User.findOne({ email: email });

    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    // Actualiza los campos si están presentes en el cuerpo de la solicitud
    if (username) user.profile.name = username;
    if (profilePicture) user.profile.profilePicture = profilePicture;
    if (dateOfBirth) user.profile.dateOfBirth = dateOfBirth;
    if (nationality) user.profile.nationality = nationality;
    if (bio) user.profile.bio = bio;
    if (gender) user.profile.gender = gender;

    // Verifica si la registración está completa
    const isRegistrationComplete =
      user.profile.dateOfBirth && user.profile.nationality;

    user.registrationCompleted = isRegistrationComplete;

    user.updatedAt = new Date(); // Actualiza la fecha de última modificación

    await user.save();
    res.status(200).send(user);
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

app.get("/api/get-users/:email", async (req, res) => {
  try {
    const { email } = req.params;

    const users = await User.find({ email: { $ne: email } });

    res.status(200).send(users);
  } catch (error) {
    res.status(500).send(error);
  }
});

app.get("/api/get-user/:email", async (req, res) => {
  const { email } = req.params;

  try {
    const user = await User.findOne({ email: email });
    if (!user) {
      return res.status(404).send("User not found");
    }

    let isRegistrationComplete;
    if (user.profile.nationality && user.profile.dateOfBirth) {
      isRegistrationComplete = true;
    } else {
      isRegistrationComplete = false;
    }

    res.status(200).json({ ...user.toObject(), isRegistrationComplete });
  } catch (error) {
    res.status(500).send(error);
  }
});

app.post("/api/send-friend-request", async (req, res) => {
  const { requesterEmail, recipientEmail } = req.body;

  try {
    const requester = await User.findOne({ email: requesterEmail });
    const recipient = await User.findOne({ email: recipientEmail });

    if (!requester || !recipient) {
      return res.status(404).json({ message: "User not found" });
    }

    // Comprobar si ya son amigos
    const areAlreadyFriends = requester.friends.includes(recipient._id);
    if (areAlreadyFriends) {
      console.log("Users are already friends");
      return res.status(400).json({ message: "Users are already friends" });
    }

    // Comprobar si ya existe una solicitud pendiente
    const existingRequest = await FriendRequest.findOne({
      requester: requester._id,
      recipient: recipient._id,
      requesterName: requester.profile.name,
      status: "pending",
    });

    if (existingRequest) {
      return res
        .status(400)
        .json({ message: "Friend request already pending" });
    }

    // Crear la solicitud de amistad
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
    console.error("Error sending friend request", error);
    res.status(500).json({ message: "Error sending friend request" });
  }
});

// Endpoint para verificar el estado de una solicitud de amistad
app.post("/api/check-friend-request-status", async (req, res) => {
  const { requesterEmail, recipientEmail } = req.body;

  try {
    const requester = await User.findOne({ email: requesterEmail });
    const recipient = await User.findOne({ email: recipientEmail });

    if (!requester || !recipient) {
      return res.status(404).json({ message: "User not found" });
    }

    // Comprobar si ya existe una solicitud pendiente
    const existingRequest = await FriendRequest.findOne({
      requester: requester._id,
      recipient: recipient._id,
    });

    // Si existe una solicitud, envía el estado de la misma
    if (existingRequest) {
      return res.status(200).json({ status: existingRequest.status });
    }

    // Si no hay solicitud, envía un estado de 'none'
    res.status(200).json({ status: "none" });
  } catch (error) {
    console.error("Error checking friend request status", error);
    res.status(500).json({ message: "Error checking friend request status" });
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
  }).populate("requester");
  res.status(200).json(requests);
});

app.patch("/api/respond-friend-request", async (req, res) => {
  const { recipientId, requesterId, status } = req.body;

  try {
    const request = await FriendRequest.findOneAndUpdate(
      { recipient: recipientId, requester: requesterId },
      { $set: { status: status } },
      { new: true }
    );

    if (!request) {
      return res.status(404).json({ message: "Friend request not found" });
    }

    const notificationUpdate = { read: true, status: status };
    await Notification.findOneAndUpdate(
      { recipient: recipientId, requester: requesterId },
      { $set: notificationUpdate },
      { new: true }
    );

    if (status === "accepted") {
      // Agregar a amigos si la solicitud es aceptada
      await User.findByIdAndUpdate(recipientId, {
        $addToSet: { friends: requesterId },
      });
      await User.findByIdAndUpdate(requesterId, {
        $addToSet: { friends: recipientId },
      });
    }

    res.status(200).json({ message: "Friend request updated" });
  } catch (error) {
    console.error("Error updating friend request", error);
    res.status(500).json({ message: "Error updating friend request" });
  }
});

app.get("/api/get-notifications/:email", async (req, res) => {
  try {
    const user = await User.findOne({ email: req.params.email });
    if (!user) {
      return res.status(404).send("User not found");
    }

    const notifications = await Notification.find({ recipient: user._id })
      .populate("requester", "email profile.name")
      .exec();

    const transformedNotifications = notifications.map((notification) => {
      const {
        _id,
        read,
        createdAt,
        status,
        requester,
        bookApproved,
        bookNameApproved,
      } = notification;

      return {
        id: _id,
        read,
        createdAt,
        requesterId: requester ? requester._id : null,
        recipientId: user._id,
        status,
        requesterEmail: requester ? requester.email : null,
        requesterName: requester ? requester.profile.name : null,
        bookApproved: bookApproved ? bookApproved : null,
        bookNameApproved: bookNameApproved ? bookNameApproved : null,
      };
    });

    res.status(200).json(transformedNotifications);
  } catch (error) {
    console.error("Error al obtener las notificaciones:", error);
    res.status(500).json({ error: "Error interno del servidor" });
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
  } catch (error) {
    console.error("Error al guardar el libro", error);
  }
};

const processDirectory = async (dirPath, authorName = "") => {
  fs.readdir(dirPath, async (err, files) => {
    if (err) {
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
    const result = await Book.findOneAndDelete({ _id: req.params.id });
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
    const { email, bookId } = req.body;

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
      .populate({
        path: "favoriteBooks",
        match: { status: "approved" }, // Filtrar solo libros aprobados
      })
      .exec();

    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    // Filtrar los libros favoritos para excluir los que no han sido cargados debido al filtro de estado
    const approvedFavoriteBooks = user.favoriteBooks.filter((book) => book);

    const response = {
      data: approvedFavoriteBooks,
      total: approvedFavoriteBooks.length,
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

app.delete("/api/delete-user/:email", async (req, res) => {
  try {
    const email = req.params.email;

    const result = await User.findOneAndDelete({ email: email });

    if (!result) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    res.status(200).json({ message: "Usuario eliminado con éxito" });
  } catch (error) {
    console.error("Error al eliminar el usuario", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

app.get("/api/get-categories", async (req, res) => {
  try {
    const categories = await Category.find({});
    res.status(200).json(categories);
  } catch (error) {
    console.error("Error al obtener categorías:", error);
    res.status(500).send("Error interno del servidor");
  }
});

app.get("/api/get-statistics/:email", async (req, res) => {
  const email = req.params.email;

  if (!email) {
    return res.status(400).send("Email es requerido");
  }

  try {
    const user = await User.findOne({ email }).populate("favoriteBooks").lean();

    if (!user) {
      return res.status(404).send("Usuario no encontrado");
    }

    const categoryCount = await Category.countDocuments({});
    const authorCount = await Author.countDocuments({});
    const userCount = await User.countDocuments({});
    const ChristianBooksCount = await Book.countDocuments({}); // Agregar await aquí

    const response = {
      categoryCount,
      authorCount,
      userCount,
      favoriteBooksCount: user.favoriteBooks.length,
      ChristianBooksCount,
    };

    res.json(response);
  } catch (error) {
    console.error("Error al obtener estadísticas:", error);
    res.status(500).send("Error interno del servidor");
  }
});

app.patch("/api/approve-all-books", async (req, res) => {
  try {
    // Actualizar el estado de todos los libros a 'approved'
    const result = await Book.updateMany({}, { status: "approved" });

    if (result.modifiedCount === 0) {
      return res.status(404).json({ message: "No books updated" });
    }

    res.status(200).json({ message: `${result.modifiedCount} books approved` });
  } catch (error) {
    console.error("Error approving books", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const PORT = 5001;
app.listen(PORT, () => {
  console.log("Server is running on port 5001");
});

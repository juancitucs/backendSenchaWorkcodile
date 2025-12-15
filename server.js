// backend/server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();

// -----------------------------------------------------------------
// 1. Configuración General y Middlewares
// -----------------------------------------------------------------
app.use(express.json());
app.use(cors());

// Configuración de Carpeta Pública para Archivos
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
app.use('/uploads', express.static(uploadDir));

// Configuración de Multer (Subida de archivos)
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({
    storage: storage
});

// -----------------------------------------------------------------
// 2. Conexión a Base de Datos
// -----------------------------------------------------------------
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Conectado a MongoDB Atlas'))
    .catch(err => console.error('❌ Error de conexión:', err));

// -----------------------------------------------------------------
// 3. Modelos y Esquemas (Schemas)
// -----------------------------------------------------------------

// Usuario
const UserSchema = new mongoose.Schema({
    fullname: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    avatar: { type: String, default: '' },
    bio: { type: String, default: 'Estudiante de la UNAM' },
    cycle: { type: Number, default: 1 },
    location: { type: String, default: 'Moquegua, Perú' },
    joinedAt: { type: Date, default: Date.now },
    interests: { type: String, default: '' },
    socials: {
        facebook: { type: String, default: '' },
        github: { type: String, default: '' },
        linkedin: { type: String, default: '' }
    }
});
const User = mongoose.model('User', UserSchema);

// Curso
const CourseSchema = new mongoose.Schema({
    id: String,
    name: String,
    cycle: Number
});
const Course = mongoose.model('Course', CourseSchema);

// Adjuntos (Sub-schema)
const AttachmentSchema = new mongoose.Schema({
    originalName: String,
    fileName: String,
    path: String,
    mimeType: String
});

// Publicación (Post)
const PostSchema = new mongoose.Schema({
    title: { type: String, required: true },
    content: { type: String, required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    cycle: { type: Number, required: true },
    attachments: [AttachmentSchema],
    views: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 }
}, {
    timestamps: true
});
const Post = mongoose.model('Post', PostSchema);

// Comentario
const CommentSchema = new mongoose.Schema({
    content: { type: String, required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
    createdAt: { type: Date, default: Date.now }
});
const Comment = mongoose.model('Comment', CommentSchema);


// -----------------------------------------------------------------
// 4. Rutas de la API
// -----------------------------------------------------------------

app.get('/', (req, res) => {
    res.send('Servidor Seguro WorkCodile Activo 🔒');
});

// --- AUTENTICACIÓN ---

// Registro
app.post('/api/register', async (req, res) => {
    try {
        const { fullname, email, password } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ message: 'El correo ya está registrado' });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = new User({ fullname, email, password: hashedPassword });
        await newUser.save();

        res.json({ message: 'Usuario registrado con seguridad' });
    } catch (error) {
        res.status(500).json({ message: 'Error en el servidor', error });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });

        if (!user) return res.status(401).json({ success: false, message: 'Usuario no encontrado' });

        const isMatch = await bcrypt.compare(password, user.password);

        if (isMatch) {
            res.json({
                success: true,
                user: { id: user._id, fullname: user.fullname, email: user.email }
            });
        } else {
            res.status(401).json({ success: false, message: 'Contraseña incorrecta' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Error en el servidor' });
    }
});

// --- USUARIOS ---

// Obtener perfil
app.get('/api/user/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password');
        if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Actualizar perfil
app.put('/api/user/:id', upload.single('avatar'), async (req, res) => {
    try {
        const { fullname, bio, cycle, interests, facebook, github, linkedin } = req.body;

        let updateData = {
            fullname,
            bio,
            cycle,
            interests,
            socials: { facebook, github, linkedin }
        };

        if (req.file) {
            updateData.avatar = 'uploads/' + req.file.filename;
        }

        const updatedUser = await User.findByIdAndUpdate(req.params.id, updateData, { new: true }).select('-password');
        res.json({ success: true, user: updatedUser });
    } catch (error) {
        res.status(500).json({ message: 'Error al actualizar', error });
    }
});

// --- PUBLICACIONES (POSTS) ---

// Crear Post
app.post('/api/posts', upload.array('files', 5), async (req, res) => {
    try {
        const { title, content, cycle, course_id, author_id } = req.body;

        // Buscar el ObjectId del curso usando el string ID (ej: "IS-121")
        const courseDoc = await Course.findOne({ id: course_id });
        if (!courseDoc) {
            return res.status(400).json({ message: 'Curso no encontrado' });
        }

        const attachments = req.files.map(file => ({
            originalName: file.originalname,
            fileName: file.filename,
            path: 'uploads/' + file.filename,
            mimeType: file.mimetype
        }));

        const newPost = new Post({
            title,
            content,
            cycle,
            course: courseDoc._id,
            author: author_id,
            attachments
        });

        await newPost.save();
        res.json({ success: true, message: 'Post publicado', post: newPost });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error al publicar', error });
    }
});

// Obtener Posts (Con filtros y búsquedas)
app.get('/api/posts', async (req, res) => {
    try {
        const { search, sort } = req.query;

        // 1. Filtro de Búsqueda
        let matchStage = {};
        if (search) {
            matchStage = {
                $or: [
                    { title: { $regex: search, $options: 'i' } },
                    { content: { $regex: search, $options: 'i' } }
                ]
            };
        }

        // 2. Ordenamiento
        let sortStage = { createdAt: -1 };
        if (sort === 'oldest') {
            sortStage = { createdAt: 1 };
        } else if (sort === 'popular') {
            sortStage = { views: -1 };
        } else if (sort === 'discussed') {
            sortStage = { commentsCount: -1 };
        }

        const posts = await Post.aggregate([
            { $match: matchStage },
            { $sort: sortStage },
            {
                $lookup: {
                    from: 'users',
                    localField: 'author',
                    foreignField: '_id',
                    as: 'authorData'
                }
            },
            {
                $lookup: {
                    from: 'courses',
                    localField: 'course_id',
                    foreignField: 'id',
                    as: 'courseDetails'
                }
            },
            { $unwind: '$authorData' },
            { $unwind: { path: '$courseDetails', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    title: 1,
                    content: 1,
                    cycle: 1,
                    course_id: 1,
                    createdAt: 1,
                    views: 1,
                    attachments: 1,
                    commentsCount: 1,
                    author: { fullname: '$authorData.fullname', email: '$authorData.email', avatar: '$authorData.avatar' },
                    courseName: { $ifNull: ['$courseDetails.name', 'Curso General'] },
                    course: { $ifNull: ['$courseDetails', null] }
                }
            }
        ]);

        res.json(posts);

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error obteniendo posts' });
    }
});

// --- COMENTARIOS ---

// Obtener comentarios de un post
app.get('/api/posts/:postId/comments', async (req, res) => {
    try {
        const comments = await Comment.find({ post: req.params.postId })
            .sort({ createdAt: 1 })
            .populate('author', 'fullname avatar');
        res.json(comments);
    } catch (error) {
        res.status(500).json({ error: 'Error cargando comentarios' });
    }
});

// Crear comentario (soporta respuestas anidadas)
app.post('/api/comments', async (req, res) => {
    try {
        const { postId, authorId, content, parentId } = req.body;

        const newComment = new Comment({
            post: postId,
            author: authorId,
            content,
            parent: parentId || null
        });
        await newComment.save();

        // Incrementar contador de comentarios en el post
        await Post.findByIdAndUpdate(postId, { $inc: { commentsCount: 1 } });
        await newComment.populate('author', 'fullname avatar');

        res.json({ success: true, comment: newComment });
    } catch (error) {
        res.status(500).json({ error: 'Error al comentar' });
    }
});

// --- CURSOS ---


// EDITAR PUBLICACIÓN
app.put('/api/posts/:id', upload.array('files'), async (req, res) => {
    try {
        const { id } = req.params;
        const { title, content, author_id } = req.body;

        // 1. Buscar el post original
        const post = await Post.findById(id);
        if (!post) {
            return res.status(404).json({ success: false, message: 'Publicación no encontrada' });
        }

        // 2. Verificar que el usuario que edita sea el dueño
        if (post.author.toString() !== author_id) {
            return res.status(403).json({ success: false, message: 'No tienes permiso para editar esto' });
        }

        // 3. Actualizar campos de texto
        post.title = title || post.title;
        post.content = content || post.content;

        // 4. (Opcional) Si suben nuevos archivos, los agregamos a los existentes
        if (req.files && req.files.length > 0) {
            const newAttachments = req.files.map(file => ({
                originalName: file.originalname,
                mimeType: file.mimetype,
                path: file.path
            }));
            post.attachments.push(...newAttachments);
        }

        await post.save();
        res.json({ success: true, post });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Error al actualizar' });
    }
});

app.get('/api/courses', async (req, res) => {
    try {
        const { cycle } = req.query;
        let query = {};
        if (cycle) {
            query.cycle = cycle;
        }
        const courses = await Course.find(query).sort({ cycle: 1, name: 1 });
        res.json(courses);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener cursos', error });
    }
});

// -----------------------------------------------------------------
// 5. Iniciar Servidor
// -----------------------------------------------------------------
const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor Seguro corriendo en el puerto ${PORT}`);
});
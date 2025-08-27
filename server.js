// server.js
const express = require('express');
const cors = require('cors');
const { connectDB } = require('./config/db');

// Connect Database
connectDB();

const app = express();

// Init Middleware
app.use(cors());
app.use(express.json({ extended: false }));

app.get('/', (req, res) => res.send('API Running'));

// Define Routes
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/levels', require('./routes/levelRoutes'));

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
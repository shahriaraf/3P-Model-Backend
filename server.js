const express = require('express');
const cors = require('cors');
const { connectDB } = require('./config/db');
require('dotenv').config();

// Connect to Database
connectDB();

const app = express();

// Initialize Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.get('/', (req, res) => res.send('API Running'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/levels', require('./routes/levelRoutes'));

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
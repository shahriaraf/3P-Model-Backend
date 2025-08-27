// config/db.js
const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');

dotenv.config();

const client = new MongoClient(process.env.MONGO_URI);
let db;

const connectDB = async () => {
    try {
        await client.connect();
        db = client.db(); // ডিফল্ট ডাটাবেস ব্যবহার করবে যা URI-তে দেওয়া আছে
        console.log('MongoDB Connected...');
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
};

const getDB = () => {
    if (!db) {
        throw new Error('Database not initialized! Call connectDB first.');
    }
    return db;
};

module.exports = { connectDB, getDB };
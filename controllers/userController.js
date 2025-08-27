const { getDB } = require('../config/db');
const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { nanoid } = require('nanoid');

exports.registerUser = async (req, res) => {
    const { name, email, password, referralId } = req.body;
    const db = getDB();

    try {
        let user = await db.collection('users').findOne({ email });
        if (user) {
            return res.status(400).json({ msg: 'User already exists' });
        }

        let referrer = null;
        if (referralId) {
            referrer = await db.collection('users').findOne({ uniqueId: referralId });
            if (!referrer) {
                return res.status(400).json({ msg: 'Invalid referral ID' });
            }
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = {
            name,
            email,
            password: hashedPassword,
            uniqueId: nanoid(8).toUpperCase(),
            referredBy: referrer ? referrer.uniqueId : null,
            walletBalance: 0,
            createdAt: new Date(),
        };

        const result = await db.collection('users').insertOne(newUser);

        const payload = { user: { id: result.insertedId.toString() } };
        jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '5h' }, (err, token) => {
            if (err) throw err;
            res.status(201).json({ token });
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

exports.loginUser = async (req, res) => {
    const { email, password } = req.body;
    const db = getDB();

    try {
        const user = await db.collection('users').findOne({ email });
        if (!user) {
            return res.status(400).json({ msg: 'Invalid Credentials' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ msg: 'Invalid Credentials' });
        }

        const payload = { user: { id: user._id.toString() } };
        jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '5h' }, (err, token) => {
            if (err) throw err;
            res.json({ token });
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

exports.getMe = async (req, res) => {
    const db = getDB();
    try {
        const user = await db.collection('users').findOne(
            { _id: new ObjectId(req.user.id) },
            { projection: { password: 0 } }
        );
        res.json(user);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};
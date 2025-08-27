const { getDB } = require('../config/db');
const { ObjectId } = require('mongodb');

// Centralized data for all programs and levels
const levelsData = [
    { packageName: '3p', levelNumber: 1, price: 10, slots: 3, cyclesForNextLevel: 2 },
    { packageName: '3p', levelNumber: 2, price: 20, slots: 3, cyclesForNextLevel: 2 },
    { packageName: '3p', levelNumber: 3, price: 30, slots: 3, cyclesForNextLevel: 2 },
    { packageName: '3p', levelNumber: 4, price: 40, slots: 3, cyclesForNextLevel: 2 },
    { packageName: '3p', levelNumber: 5, price: 50, slots: 3, cyclesForNextLevel: 2 },
    { packageName: '3p', levelNumber: 6, price: 60, slots: 3, cyclesForNextLevel: 2 },

    { packageName: '6p', levelNumber: 1, price: 10, slots: 6, cyclesForNextLevel: 1 },
    { packageName: '6p', levelNumber: 2, price: 40, slots: 6, cyclesForNextLevel: 1 },
    { packageName: '6p', levelNumber: 3, price: 70, slots: 6, cyclesForNextLevel: 1 },
    { packageName: '6p', levelNumber: 4, price: 100, slots: 6, cyclesForNextLevel: 1 },
    { packageName: '6p', levelNumber: 5, price: 130, slots: 6, cyclesForNextLevel: 1 },
    { packageName: '6p', levelNumber: 6, price: 160, slots: 6, cyclesForNextLevel: 1 },
];

// 6P MODEL HELPER: Finds the first available spillover slot in a user's direct downline
const findSpilloverSlot = async (db, upliner, level) => {
    const downline = await db.collection('users').find({ referredBy: upliner.uniqueId }).sort({ createdAt: 1 }).toArray();
    for (const member of downline) {
        const memberActivation = await db.collection('userActivations').findOne({ userId: member._id, packageName: '6p', levelNumber: level.levelNumber, status: 'active', isComplete: false });
        if (memberActivation) {
            const emptySlotIndex = memberActivation.slots.findIndex(s => s.status === 'empty');
            if (emptySlotIndex !== -1) {
                return { activation: memberActivation, slotIndex: emptySlotIndex };
            }
        }
    }
    return null;
};

// 6P MODEL HELPER: Distribution logic based on which slot was filled
const distributeToUpliner6P = async (db, downlineUser, upliner, level, slotIndex) => {
    if (slotIndex === 0 || slotIndex === 1) { // Slots 1 & 2 -> To upline's upline
        await distributeToUpliner(db, upliner, level);
    } else if (slotIndex >= 2 && slotIndex <= 4) { // Slots 3, 4, 5 -> To upliner
        await db.collection('users').updateOne({ _id: upliner._id }, { $inc: { walletBalance: level.price } });
    } else if (slotIndex === 5) { // Slot 6 -> Spillover to downline
        const spilloverSpot = await findSpilloverSlot(db, upliner, level);
        if (spilloverSpot) {
            const targetActivation = spilloverSpot.activation;
            const targetSlotIndex = spilloverSpot.slotIndex;
            const targetUpliner = await db.collection('users').findOne({ _id: targetActivation.userId });
            await db.collection('userActivations').updateOne({ _id: targetActivation._id }, { $set: { [`slots.${targetSlotIndex}`]: { filledBy: downlineUser._id, status: 'paid_spillover' } } });
            await distributeToUpliner6P(db, downlineUser, targetUpliner, level, targetSlotIndex);
        } else {
            console.log(`Spillover from ${upliner.name} for Level ${level.levelNumber} had no recipient.`);
        }
    }
};

// 3P MODEL HELPER: Distribution logic
const distributeToUpliner3P = async (db, upliner, level, slotIndex) => {
    if (slotIndex < 2) { // Slots 1 & 2 -> To upliner
        await db.collection('users').updateOne({ _id: upliner._id }, { $inc: { walletBalance: level.price } });
    } else { // Slot 3 -> To upline's upline
        await distributeToUpliner(db, upliner, level);
    }
};

// GENERIC UPLINE DISTRIBUTION LOGIC (delegates to 3P or 6P helpers)
const distributeToUpliner = async (db, downlineUser, level) => {
    if (!downlineUser.referredBy) return;
    const upliner = await db.collection('users').findOne({ uniqueId: downlineUser.referredBy });
    if (!upliner) return;
    const uplinerActivation = await db.collection('userActivations').findOne({ userId: upliner._id, packageName: level.packageName, levelNumber: level.levelNumber, status: 'active', isComplete: false }, { sort: { cycle: -1 } });
    if (!uplinerActivation) return;

    const emptySlotIndex = uplinerActivation.slots.findIndex(s => s.status === 'empty');
    if (emptySlotIndex === -1) return;

    const slotStatus = level.packageName === '3p' ? (emptySlotIndex < 2 ? 'paid_to_user' : 'paid_to_upliner') : 'processing';
    await db.collection('userActivations').updateOne({ _id: uplinerActivation._id }, { $set: { [`slots.${emptySlotIndex}`]: { filledBy: downlineUser._id, status: slotStatus } } });

    if (level.packageName === '3p') {
        await distributeToUpliner3P(db, upliner, level, emptySlotIndex);
    } else if (level.packageName === '6p') {
        await distributeToUpliner6P(db, downlineUser, upliner, level, emptySlotIndex);
    }

    if (emptySlotIndex === uplinerActivation.slots.length - 1) {
        const completedUpdate = { $set: { isComplete: true } };
        const updatedCompletedCycles = uplinerActivation.completedCycles + 1;
        completedUpdate.$set.completedCycles = updatedCompletedCycles;
        if (updatedCompletedCycles >= level.cyclesForNextLevel) {
            completedUpdate.$set.status = 'frozen';
        } else {
            const newCycle = { userId: upliner._id, packageName: level.packageName, levelNumber: level.levelNumber, cycle: uplinerActivation.cycle + 1, slots: Array(level.slots).fill({ filledBy: null, status: 'empty' }), isComplete: false, status: 'active', completedCycles: updatedCompletedCycles, createdAt: new Date() };
            await db.collection('userActivations').insertOne(newCycle);
        }
        await db.collection('userActivations').updateOne({ _id: uplinerActivation._id }, completedUpdate);
    }
};

// MAIN API CONTROLLERS
exports.buyLevel = async (req, res) => {
    const { levelNumber, packageName } = req.body;
    const userId = new ObjectId(req.user.id);
    const db = getDB();
    const level = levelsData.find(l => l.packageName === packageName && l.levelNumber === levelNumber);
    if (!level) return res.status(404).json({ msg: 'Level not found for this package' });
    try {
        const user = await db.collection('users').findOne({ _id: userId });
        const userActivations = await db.collection('userActivations').find({ userId, packageName }).toArray();
        const highestPurchasedLevel = userActivations.reduce((max, act) => Math.max(max, act.levelNumber), 0);
        if (levelNumber !== highestPurchasedLevel + 1) return res.status(400).json({ msg: `You must purchase Level ${highestPurchasedLevel + 1} of the ${packageName.toUpperCase()} package first.` });
        if (levelNumber > 1) {
            const prevLevelInfo = levelsData.find(l => l.packageName === packageName && l.levelNumber === levelNumber - 1);
            const prevLevelActivation = await db.collection('userActivations').findOne({ userId, packageName, levelNumber: levelNumber - 1 }, { sort: { completedCycles: -1 } });
            if (!prevLevelActivation || prevLevelActivation.completedCycles < prevLevelInfo.cyclesForNextLevel) return res.status(400).json({ msg: `Complete ${prevLevelInfo.cyclesForNextLevel} cycle(s) of Level ${levelNumber - 1} to unlock.` });
        }
        const newActivation = { userId, packageName, levelNumber, cycle: 1, slots: Array(level.slots).fill({ filledBy: null, status: 'empty' }), isComplete: false, status: 'active', completedCycles: 0, createdAt: new Date() };
        await db.collection('userActivations').insertOne(newActivation);
        await distributeToUpliner(db, user, level);
        res.status(200).json({ msg: `${packageName.toUpperCase()} Level ${levelNumber} purchased successfully` });
    } catch (err) { console.error(err.message); res.status(500).send('Server Error'); }
};

exports.recycleLevel = async (req, res) => {
    const { levelNumber, packageName } = req.body;
    const userId = new ObjectId(req.user.id);
    const db = getDB();
    const level = levelsData.find(l => l.packageName === packageName && l.levelNumber === levelNumber);
    if (!level) return res.status(404).json({ msg: 'Level not found' });
    try {
        const lastActivation = await db.collection('userActivations').findOne({ userId: userId, packageName, levelNumber }, { sort: { cycle: -1 } });
        if (!lastActivation || lastActivation.status !== 'frozen') return res.status(400).json({ msg: 'This level is not frozen.' });
        const newCycle = { userId, packageName, levelNumber, cycle: lastActivation.cycle + 1, slots: Array(level.slots).fill({ filledBy: null, status: 'empty' }), isComplete: false, status: 'active', completedCycles: 0, createdAt: new Date() };
        await db.collection('userActivations').insertOne(newCycle);
        res.status(200).json({ msg: `Level ${levelNumber} recycled successfully!` });
    } catch (err) { console.error(err.message); res.status(500).send('Server Error'); }
};

exports.getAvailableLevels = (req, res) => {
    res.json(levelsData);
};

exports.getMyActivations = async (req, res) => {
    const userId = new ObjectId(req.user.id);
    const { package } = req.query; // Expects a query parameter: ?package=3p or ?package=6p
    if (!package) {
        return res.status(400).json({ msg: 'Package name query parameter is required.' });
    }
    const db = getDB();
    try {
        const activations = await db.collection('userActivations').find({ userId, packageName: package }).sort({ levelNumber: 1, cycle: 1 }).toArray();
        res.json(activations);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};
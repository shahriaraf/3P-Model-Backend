const { getDB } = require('../config/db');
const { ObjectId } = require('mongodb');

// Your system's level structure
const levelsData = [
    { levelNumber: 1, price: 10, packageName: '3p' },
    { levelNumber: 2, price: 20, packageName: '3p' },
    { levelNumber: 3, price: 40, packageName: '3p' },
    { levelNumber: 4, price: 80, packageName: '3p' },
    { levelNumber: 5, price: 160, packageName: '3p' },
    { levelNumber: 6, price: 320, packageName: '3p' },
];

// Business Rule: Number of cycles to complete before a level freezes
const MAX_CYCLES_BEFORE_FREEZE = 2;

// Recursive function to handle payment distribution up the referral chain
const distributeToUpliner = async (downlineUser, level) => {
    if (!downlineUser.referredBy) return; // Stop if there's no upliner

    const db = getDB();
    const upliner = await db.collection('users').findOne({ uniqueId: downlineUser.referredBy });
    if (!upliner) return;

    // Find the upliner's currently active, uncompleted cycle for this level
    const uplinerActivation = await db.collection('userActivations').findOne(
        { userId: upliner._id, levelNumber: level.levelNumber, status: 'active', isComplete: false },
        { sort: { cycle: -1 } }
    );

    if (!uplinerActivation) return; // Upliner hasn't bought this level or it's frozen

    const emptySlotIndex = uplinerActivation.slots.findIndex(s => s.status === 'empty');
    if (emptySlotIndex === -1) return; // No empty slots (should not happen in normal flow)

    const updateQuery = { $set: {} };
    updateQuery.$set[`slots.${emptySlotIndex}`] = { filledBy: downlineUser._id, status: '' };

    if (emptySlotIndex < 2) { // Slots 1 and 2: Payment goes to the direct upliner
        updateQuery.$set[`slots.${emptySlotIndex}`].status = 'paid_to_user';
        await db.collection('users').updateOne({ _id: upliner._id }, { $inc: { walletBalance: level.price } });
    } else { // Slot 3: Cycle completes, payment passes up
        updateQuery.$set[`slots.${emptySlotIndex}`].status = 'paid_to_upliner';
        updateQuery.$set.isComplete = true;

        const updatedCompletedCycles = uplinerActivation.completedCycles + 1;

        if (updatedCompletedCycles >= MAX_CYCLES_BEFORE_FREEZE) {
            // Business Rule: Freeze the level after 2 cycles
            updateQuery.$set.status = 'frozen';
        } else {
            // Start a new cycle for the upliner
            const newCycle = { userId: upliner._id, levelNumber: level.levelNumber, cycle: uplinerActivation.cycle + 1, slots: Array(3).fill({ filledBy: null, status: 'empty' }), isComplete: false, status: 'active', completedCycles: updatedCompletedCycles, createdAt: new Date() };
            await db.collection('userActivations').insertOne(newCycle);
        }
        
        updateQuery.$set.completedCycles = updatedCompletedCycles;

        // Recursively call for the upliner's upliner
        await distributeToUpliner(upliner, level);
    }
    await db.collection('userActivations').updateOne({ _id: uplinerActivation._id }, updateQuery);
};

exports.buyLevel = async (req, res) => {
    const { levelNumber } = req.body;
    const userId = new ObjectId(req.user.id);
    const db = getDB();

    const level = levelsData.find(l => l.levelNumber === levelNumber);
    if (!level) return res.status(404).json({ msg: 'Level not found' });

    try {
        const user = await db.collection('users').findOne({ _id: userId });
        const userActivations = await db.collection('userActivations').find({ userId }).toArray();
        const highestPurchasedLevel = userActivations.reduce((max, act) => Math.max(max, act.levelNumber), 0);

        // Business Rule: Must purchase levels sequentially
        if (levelNumber !== highestPurchasedLevel + 1) {
            return res.status(400).json({ msg: `You must purchase Level ${highestPurchasedLevel + 1} first.` });
        }

        // Business Rule: Must complete 2 cycles of previous level
        if (levelNumber > 1) {
            const prevLevelNumber = levelNumber - 1;
            const prevLevelActivation = await db.collection('userActivations').findOne({ userId, levelNumber: prevLevelNumber }, { sort: { completedCycles: -1 } });
            if (!prevLevelActivation || prevLevelActivation.completedCycles < MAX_CYCLES_BEFORE_FREEZE) {
                return res.status(400).json({ msg: `You must complete ${MAX_CYCLES_BEFORE_FREEZE} cycles of Level ${prevLevelNumber} to unlock this level.` });
            }
        }
        
        const newActivation = { userId, levelNumber, cycle: 1, slots: Array(3).fill({ filledBy: null, status: 'empty' }), isComplete: false, status: 'active', completedCycles: 0, createdAt: new Date() };
        await db.collection('userActivations').insertOne(newActivation);

        // Start the referral payment chain
        await distributeToUpliner(user, level);

        res.status(200).json({ msg: `Level ${levelNumber} purchased successfully` });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

exports.recycleLevel = async (req, res) => {
    const { levelNumber } = req.body;
    const userId = new ObjectId(req.user.id);
    const db = getDB();

    const level = levelsData.find(l => l.levelNumber === levelNumber);
    if (!level) return res.status(404).json({ msg: 'Level not found' });

    try {
        const lastActivation = await db.collection('userActivations').findOne({ userId, levelNumber }, { sort: { cycle: -1 } });
        if (!lastActivation || lastActivation.status !== 'frozen') {
            return res.status(400).json({ msg: 'This level is not frozen or does not exist.' });
        }
        
        // Create a new set of cycles for the user
        const newCycle = { userId, levelNumber, cycle: lastActivation.cycle + 1, slots: Array(3).fill({ filledBy: null, status: 'empty' }), isComplete: false, status: 'active', completedCycles: 0, createdAt: new Date() };
        await db.collection('userActivations').insertOne(newCycle);

        res.status(200).json({ msg: `Level ${levelNumber} has been recycled successfully!` });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

exports.getAvailableLevels = (req, res) => { res.json(levelsData); };

exports.getMyActivations = async (req, res) => {
    const userId = new ObjectId(req.user.id);
    const db = getDB();
    try {
        const activations = await db.collection('userActivations').find({ userId }).sort({ levelNumber: 1, cycle: 1 }).toArray();
        res.json(activations);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};
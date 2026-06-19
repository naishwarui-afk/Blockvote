const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('✅ MongoDB Connected Successfully');

    await createGenesisBlock(); // 👈 move INSIDE connection

    const PORT = process.env.PORT || 3000;

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

  })
  .catch(err => {
    console.error('❌ MongoDB Error:', err);
  });

// Schemas
const UserSchema = new mongoose.Schema({
  nationalId: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  fullName: { type: String, required: true },
  hasVoted: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const BlockSchema = new mongoose.Schema({
  index: { type: Number, required: true },
  previousHash: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  data: Object,
  hash: { type: String, required: true }
});

const User = mongoose.model('User', UserSchema);
const Block = mongoose.model('Block', BlockSchema);

// Hash Function
const calculateHash = (index, previousHash, timestamp, data) => {
  return crypto.createHash('sha256')
    .update(index + previousHash + timestamp + JSON.stringify(data))
    .digest('hex');
};

// Create Genesis Block
async function createGenesisBlock() {
  if (await Block.countDocuments() === 0) {
    const genesis = new Block({
      index: 0,
      previousHash: "0",
      timestamp: new Date(),
      data: { message: "Blockchain Voting System - Genesis Block" },
      hash: ""
    });
    genesis.hash = calculateHash(genesis.index, genesis.previousHash, genesis.timestamp, genesis.data);
    await genesis.save();
    console.log("🌍 Genesis Block Created");
  }
}

// Validate Blockchain
async function validateBlockchain() {
  const blocks = await Block.find().sort({ index: 1 });
  for (let i = 1; i < blocks.length; i++) {
    const current = blocks[i];
    const previous = blocks[i - 1];
    const recalculated = calculateHash(current.index, current.previousHash, current.timestamp, current.data);
    if (current.hash !== recalculated || current.previousHash !== previous.hash) {
      return { valid: false, message: "Blockchain has been tampered with!" };
    }
  }
  return { valid: true, message: "✅ Blockchain is valid and secure" };
}

// JWT Middlewares
const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: "Access token required" });
  jwt.verify(token, process.env.JWT_SECRET || 'blockchain-voting-secret', (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid token" });
    req.user = user;
    next();
  });
};

const authenticateAdmin = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: "Admin access required" });
  jwt.verify(token, process.env.JWT_SECRET || 'blockchain-voting-secret', (err, decoded) => {
    if (err || decoded.role !== "admin") return res.status(403).json({ error: "Unauthorized admin access" });
    req.admin = decoded;
    next();
  });
};

// ====================== VOTER ROUTES ======================
app.post('/api/register', async (req, res) => {
  try {
    const { nationalId, fullName, password } = req.body;
    if (!nationalId || !fullName || !password) return res.status(400).json({ error: "All fields required" });
    const hashed = await bcrypt.hash(password, 10);
    const newUser = new User({ nationalId, fullName, password: hashed });
    await newUser.save();
    res.status(201).json({ message: "Registration successful!" });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: "National ID already exists" });
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { nationalId, password } = req.body;
    const user = await User.findOne({ nationalId });
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: "Invalid credentials" });
    const token = jwt.sign({ id: user._id, nationalId: user.nationalId, fullName: user.fullName },
      process.env.JWT_SECRET || 'blockchain-voting-secret', { expiresIn: '24h' });
    res.json({ token, user: { nationalId: user.nationalId, fullName: user.fullName } });
  } catch (err) {
    res.status(500).json({ error: "Login failed" });
  }
});

app.post('/api/vote', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (user.hasVoted) return res.status(400).json({ error: "You have already voted" });
    const lastBlock = await Block.findOne().sort({ index: -1 });
    const newIndex = lastBlock ? lastBlock.index + 1 : 1;
    const voteData = { nationalId: user.nationalId, fullName: user.fullName, candidate: req.body.candidate, timestamp: new Date() };
    const newBlock = new Block({ index: newIndex, previousHash: lastBlock ? lastBlock.hash : "0", timestamp: new Date(), data: voteData, hash: "" });
    newBlock.hash = calculateHash(newBlock.index, newBlock.previousHash, newBlock.timestamp, newBlock.data);
    await newBlock.save();
    user.hasVoted = true;
    await user.save();
    res.json({ success: true, message: "Vote recorded on blockchain!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/results', async (req, res) => {
  const blocks = await Block.find({ index: { $gt: 0 } });
  const votes = {};
  blocks.forEach(b => { if (b.data?.candidate) votes[b.data.candidate] = (votes[b.data.candidate] || 0) + 1; });
  res.json({ votes, totalVotes: blocks.length });
});

app.get('/api/chain', async (req, res) => {
  const blocks = await Block.find().sort({ index: 1 });
  res.json(blocks);
});

// ====================== ADMIN ROUTES ======================
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  if (username === "DIT-02-0260/2025" && password === "Ruthandi23") {
    const adminToken = jwt.sign({ role: "admin", username }, process.env.JWT_SECRET || 'blockchain-voting-secret', { expiresIn: '12h' });
    res.json({ success: true, token: adminToken });
  } else {
    res.status(401).json({ error: "Invalid admin credentials" });
  }
});

app.get('/api/admin/results', authenticateAdmin, async (req, res) => {
  const blocks = await Block.find({ index: { $gt: 0 } });
  const votes = {};
  blocks.forEach(b => { if (b.data?.candidate) votes[b.data.candidate] = (votes[b.data.candidate] || 0) + 1; });
  const totalUsers = await User.countDocuments();
  res.json({ votes, totalVotes: blocks.length, registeredVoters: totalUsers });
});

app.get('/api/admin/chain', authenticateAdmin, async (req, res) => {
  const blocks = await Block.find().sort({ index: 1 });
  res.json(blocks);
});

app.get('/api/admin/validate', authenticateAdmin, async (req, res) => {
  const result = await validateBlockchain();
  res.json(result);
});

app.post('/api/admin/reset', authenticateAdmin, async (req, res) => {
  try {
    await Block.deleteMany({ index: { $gt: 0 } });
    await User.updateMany({}, { $set: { hasVoted: false } });
    res.json({ success: true, message: "All votes have been reset successfully." });
  } catch (err) {
    res.status(500).json({ error: "Reset failed" });
  }
});

app.get('/api/admin/export', authenticateAdmin, async (req, res) => {
  const blocks = await Block.find().sort({ index: 1 });
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename=blockchain-export.json');
  res.json(blocks);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
// server/routes/api.js
const express = require('express');
const Game = require('../models/Game');
const Player = require('../models/Player');
const router = express.Router();

// Get high scores (last 10 finished games)
router.get('/scores', async (req, res) => {
  const games = await Game.find({ started: false })
    .sort({ updatedAt: -1 })
    .limit(10)
    .populate('players');
  res.json(games);
});

// Record game end & cleanup players
router.post('/games/:roomId/end', async (req, res) => {
  const game = await Game.findOne({ roomId: req.params.roomId }).populate('players');
  if (!game) return res.status(404).send('Game not found');
  game.started = false;
  await game.save();
  await Player.deleteMany({ _id: { $in: game.players } });
  res.sendStatus(200);
});

module.exports = router;

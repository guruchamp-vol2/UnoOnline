// server/models/Game.js
const { Schema, model } = require('mongoose');

const GameSchema = new Schema({
  roomId: { type: String, unique: true },
  deck: [{ color: String, value: String }],
  discard: [{ color: String, value: String }],
  players: [{ type: Schema.Types.ObjectId, ref: 'Player' }],
  turnIndex: Number,
  direction: Number,
  started: Boolean
}, { timestamps: true });

module.exports = model('Game', GameSchema);

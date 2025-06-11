// server/models/Player.js
const { Schema, model } = require('mongoose');

const PlayerSchema = new Schema({
  socketId: String,
  name: String,
  avatar: String,
  hand: [{ color: String, value: String }]
});

module.exports = model('Player', PlayerSchema);

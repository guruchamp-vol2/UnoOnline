// server/db/index.js
const mongoose = require('mongoose');
const { MONGODB_URI } = process.env;

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

mongoose.connection.on('connected', () =>
  console.log('✅ MongoDB connected')
);
mongoose.connection.on('error', err =>
  console.error('❌ MongoDB connection error:', err)
);

module.exports = mongoose;

const mongoose = require('mongoose');

const TeamSchema = new mongoose.Schema({
  teamId: String,
  name: String,
  history: Array // Store past matches and results
});

module.exports = mongoose.model('Team', TeamSchema);

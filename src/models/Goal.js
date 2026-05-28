const mongoose = require('mongoose');

const GoalSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: [true, 'Please add a goal name'],
    trim: true
  },
  target: {
    type: Number,
    required: [true, 'Please specify target amount']
  },
  current: {
    type: Number,
    default: 0
  },
  deadline: {
    type: Date
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Goal', GoalSchema);

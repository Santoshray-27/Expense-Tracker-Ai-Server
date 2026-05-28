const express = require('express');
const router = express.Router();
const Goal = require('../models/Goal');
const { protect } = require('../middleware/auth');

// @desc    Get all savings goals for user
// @route   GET /api/goals
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const goals = await Goal.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json({
      success: true,
      count: goals.length,
      data: goals
    });
  } catch (error) {
    console.error('Fetch Goals Error:', error.message);
    res.status(500).json({ success: false, message: 'Server error fetching goals' });
  }
});

// @desc    Create a new savings goal
// @route   POST /api/goals
// @access  Private
router.post('/', protect, async (req, res) => {
  try {
    const { name, target, current, deadline } = req.body;

    if (!name || target === undefined) {
      return res.status(400).json({ success: false, message: 'Goal name and target amount are required' });
    }

    const numericTarget = parseFloat(target);
    const numericCurrent = current !== undefined ? parseFloat(current) : 0;

    if (isNaN(numericTarget) || numericTarget <= 0) {
      return res.status(400).json({ success: false, message: 'Target amount must be a positive number' });
    }

    const goal = await Goal.create({
      user: req.user._id,
      name,
      target: numericTarget,
      current: numericCurrent,
      deadline: deadline || null
    });

    res.status(201).json({
      success: true,
      data: goal,
      message: 'Savings goal created'
    });
  } catch (error) {
    console.error('Create Goal Error:', error.message);
    res.status(500).json({ success: false, message: 'Server error creating goal' });
  }
});

// @desc    Update savings goal progress
// @route   PUT /api/goals/:id
// @access  Private
router.put('/:id', protect, async (req, res) => {
  try {
    let goal = await Goal.findById(req.params.id);

    if (!goal) {
      return res.status(404).json({ success: false, message: 'Savings goal not found' });
    }

    if (goal.user.toString() !== req.user._id.toString()) {
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }

    const { name, target, current, deadline } = req.body;
    const updateData = {};

    if (name) updateData.name = name;
    if (target !== undefined) updateData.target = parseFloat(target);
    if (current !== undefined) updateData.current = parseFloat(current);
    if (deadline !== undefined) updateData.deadline = deadline;

    goal = await Goal.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true
    });

    res.json({
      success: true,
      data: goal,
      message: 'Savings goal updated'
    });
  } catch (error) {
    console.error('Update Goal Error:', error.message);
    res.status(500).json({ success: false, message: 'Server error updating goal' });
  }
});

// @desc    Delete savings goal
// @route   DELETE /api/goals/:id
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const goal = await Goal.findById(req.params.id);

    if (!goal) {
      return res.status(404).json({ success: false, message: 'Savings goal not found' });
    }

    if (goal.user.toString() !== req.user._id.toString()) {
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }

    await goal.deleteOne();

    res.json({
      success: true,
      message: 'Savings goal removed'
    });
  } catch (error) {
    console.error('Delete Goal Error:', error.message);
    res.status(500).json({ success: false, message: 'Server error deleting goal' });
  }
});

module.exports = router;

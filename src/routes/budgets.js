const express = require('express');
const router = express.Router();
const Budget = require('../models/Budget');
const { protect } = require('../middleware/auth');

// @desc    Get all budgets for user
// @route   GET /api/budgets
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const budgets = await Budget.find({ user: req.user._id });
    res.json({
      success: true,
      data: budgets
    });
  } catch (error) {
    console.error('Fetch Budgets Error:', error.message);
    res.status(500).json({ success: false, message: 'Server error fetching budgets' });
  }
});

// @desc    Upsert (Create/Update) a budget for a category
// @route   POST /api/budgets
// @access  Private
router.post('/', protect, async (req, res) => {
  try {
    const { category, limit, period } = req.body;

    if (!category || limit === undefined) {
      return res.status(400).json({ success: false, message: 'Category and limit are required' });
    }

    const numericLimit = parseFloat(limit);
    if (isNaN(numericLimit) || numericLimit < 0) {
      return res.status(400).json({ success: false, message: 'Limit must be a positive number' });
    }

    // Upsert budget: find by user & category, update or insert
    const budget = await Budget.findOneAndUpdate(
      { user: req.user._id, category: category.trim() },
      { limit: numericLimit, period: period || 'monthly' },
      { new: true, upsert: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      data: budget,
      message: 'Budget successfully configured'
    });
  } catch (error) {
    console.error('Upsert Budget Error:', error.message);
    res.status(500).json({ success: false, message: 'Server error configuring budget' });
  }
});

// @desc    Delete a budget
// @route   DELETE /api/budgets/:id
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const budget = await Budget.findById(req.params.id);

    if (!budget) {
      return res.status(404).json({ success: false, message: 'Budget not found' });
    }

    if (budget.user.toString() !== req.user._id.toString()) {
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }

    await budget.deleteOne();

    res.json({
      success: true,
      message: 'Budget limit removed'
    });
  } catch (error) {
    console.error('Delete Budget Error:', error.message);
    res.status(500).json({ success: false, message: 'Server error deleting budget' });
  }
});

module.exports = router;

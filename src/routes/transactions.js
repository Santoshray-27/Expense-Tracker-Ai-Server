const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');
const Budget = require('../models/Budget');
const { protect } = require('../middleware/auth');

// Helper to calculate start of current month
const getStartOfCurrentMonth = () => {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1);
};

// @desc    Get all transactions for logged in user
// @route   GET /api/transactions
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const transactions = await Transaction.find({ user: req.user._id })
      .sort({ date: -1, createdAt: -1 });

    res.json({
      success: true,
      count: transactions.length,
      data: transactions
    });
  } catch (error) {
    console.error('Fetch Transactions Error:', error.message);
    res.status(500).json({ success: false, message: 'Server error fetching transactions' });
  }
});

// @desc    Create a new transaction
// @route   POST /api/transactions
// @access  Private
router.post('/', protect, async (req, res) => {
  try {
    const { type, amount, category, description, date } = req.body;

    if (!type || !amount || !category) {
      return res.status(400).json({ success: false, message: 'Type, amount and category are required' });
    }

    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be a positive number' });
    }

    // Save transaction
    const transaction = await Transaction.create({
      user: req.user._id,
      type,
      amount: numericAmount,
      category,
      description,
      date: date || new Date()
    });

    // Budget check logic for expenses
    let budgetWarning = null;
    if (type === 'expense') {
      const budget = await Budget.findOne({ user: req.user._id, category: { $regex: new RegExp(`^${category}$`, 'i') } });
      
      if (budget) {
        const startOfMonth = getStartOfCurrentMonth();
        
        // Sum all expenses for this category in the current month
        const monthlyExpenses = await Transaction.aggregate([
          {
            $match: {
              user: req.user._id,
              type: 'expense',
              category: { $regex: new RegExp(`^${category}$`, 'i') },
              date: { $gte: startOfMonth }
            }
          },
          {
            $group: {
              _id: null,
              total: { $sum: '$amount' }
            }
          }
        ]);

        const currentSpent = monthlyExpenses.length > 0 ? monthlyExpenses[0].total : 0;
        
        if (currentSpent > budget.limit) {
          budgetWarning = `Budget Exceeded! You spent ${currentSpent.toFixed(2)} in category "${category}" which exceeds your limit of ${budget.limit.toFixed(2)}.`;
        } else if (currentSpent >= budget.limit * 0.9) {
          budgetWarning = `Warning: You have reached ${( (currentSpent / budget.limit) * 100 ).toFixed(0)}% of your "${category}" budget. Spent: ${currentSpent.toFixed(2)} / ${budget.limit.toFixed(2)}.`;
        }
      }
    }

    res.status(201).json({
      success: true,
      data: transaction,
      budgetWarning
    });
  } catch (error) {
    console.error('Create Transaction Error:', error.message);
    res.status(500).json({ success: false, message: 'Server error creating transaction' });
  }
});

// @desc    Update transaction
// @route   PUT /api/transactions/:id
// @access  Private
router.put('/:id', protect, async (req, res) => {
  try {
    let transaction = await Transaction.findById(req.targetId || req.params.id);

    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    // Verify ownership
    if (transaction.user.toString() !== req.user._id.toString()) {
      return res.status(401).json({ success: false, message: 'Not authorized to update this transaction' });
    }

    const { type, amount, category, description, date } = req.body;
    const updateData = {};
    if (type) updateData.type = type;
    if (amount) updateData.amount = parseFloat(amount);
    if (category) updateData.category = category;
    if (description !== undefined) updateData.description = description;
    if (date) updateData.date = date;

    transaction = await Transaction.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      data: transaction
    });
  } catch (error) {
    console.error('Update Transaction Error:', error.message);
    res.status(500).json({ success: false, message: 'Server error updating transaction' });
  }
});

// @desc    Delete transaction
// @route   DELETE /api/transactions/:id
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);

    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    // Verify ownership
    if (transaction.user.toString() !== req.user._id.toString()) {
      return res.status(401).json({ success: false, message: 'Not authorized to delete this transaction' });
    }

    await transaction.deleteOne();

    res.json({
      success: true,
      message: 'Transaction removed'
    });
  } catch (error) {
    console.error('Delete Transaction Error:', error.message);
    res.status(500).json({ success: false, message: 'Server error deleting transaction' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const initGemini = require('../config/gemini');
const Transaction = require('../models/Transaction');
const Budget = require('../models/Budget');
const { protect } = require('../middleware/auth');

// Initialize Gemini Model
const geminiModel = initGemini();

// Helper: call Gemini with retries for transient failures (503)
const callGeminiWithRetries = async (input, maxRetries = 3) => {
  if (!geminiModel) throw new Error('Gemini model not initialized');
  let attempt = 0;
  let lastErr = null;
  while (attempt < maxRetries) {
    try {
      const res = await geminiModel.generateContent(input);
      return res;
    } catch (err) {
      lastErr = err;
      // If service unavailable, retry with backoff
      const status = err && err.status;
      if (status === 503) {
        const backoff = 500 * Math.pow(2, attempt); // 500ms, 1s, 2s
        await new Promise(r => setTimeout(r, backoff));
        attempt += 1;
        continue;
      }
      // For other errors, break and rethrow
      throw err;
    }
  }
  // exhausted retries
  throw lastErr || new Error('Gemini generate failed after retries');
};

// Helper to compile monthly totals
const getStartOfCurrentMonth = () => {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1);
};

// @desc    Get AI Financial Coaching & Suggestions
// @route   GET /api/ai/coach
// @access  Private
router.get('/coach', protect, async (req, res) => {
  try {
    const transactions = await Transaction.find({ user: req.user._id }).sort({ date: -1 });
    const budgets = await Budget.find({ user: req.user._id });

    // Calculate basic statistics for the context
    const startOfMonth = getStartOfCurrentMonth();
    
    let totalIncome = 0;
    let totalExpense = 0;
    const categoryTotals = {};
    const recentTransactions = [];

    transactions.forEach(t => {
      // General statistics
      if (t.type === 'income') {
        totalIncome += t.amount;
      } else {
        totalExpense += t.amount;
        // Group by category for current month
        if (t.date >= startOfMonth) {
          categoryTotals[t.category] = (categoryTotals[t.category] || 0) + t.amount;
        }
      }

      // Keep last 10 transactions for context
      if (recentTransactions.length < 10) {
        recentTransactions.push({
          type: t.type,
          amount: t.amount,
          category: t.category,
          description: t.description || 'No description',
          date: t.date.toISOString().split('T')[0]
        });
      }
    });

    const budgetContext = budgets.map(b => {
      const spent = categoryTotals[b.category] || 0;
      return {
        category: b.category,
        limit: b.limit,
        spent: spent,
        percentUsed: b.limit > 0 ? ((spent / b.limit) * 100).toFixed(1) : 0
      };
    });

    const contextData = {
      username: req.user.username,
      overallStats: {
        totalIncomeLogged: totalIncome,
        totalExpenseLogged: totalExpense,
        currentMonthCategoryExpenses: categoryTotals
      },
      budgets: budgetContext,
      recentTransactions: recentTransactions
    };

    // If Gemini is not configured, send a simulated smart advisory response
    if (!geminiModel) {
      const mockAdvisory = generateMockAdvisory(contextData);
      return res.json({
        success: true,
        mode: 'Simulation Mode (Set GEMINI_API_KEY for live Gemini feedback)',
        analysis: mockAdvisory
      });
    }

    // Build the prompt for Gemini
    const prompt = `
      You are an expert AI Financial Coach named "SmartWealth AI". 
      Your job is to analyze the user's recent financial transactions and budget allocations, and provide:
      1. An encouraging, empathetic assessment of their current spending status.
      2. Clear insights on major spending categories and whether they are sticking to budgets.
      3. Exactly 3 actionable, highly specific tips to optimize their money, save more, or address overspending.
      4. Suggest a realistic monthly savings target.

      User Profile & Data:
      - Name: ${contextData.username}
      - Total Registered Income: $${contextData.overallStats.totalIncomeLogged.toFixed(2)}
      - Total Registered Expense: $${contextData.overallStats.totalExpenseLogged.toFixed(2)}
      
      Current Month Spending per Category:
      ${JSON.stringify(contextData.overallStats.currentMonthCategoryExpenses, null, 2)}
      
      Configured Budgets & Spending:
      ${JSON.stringify(contextData.budgets, null, 2)}
      
      Recent Transactions Context (last 10 items):
      ${JSON.stringify(contextData.recentTransactions, null, 2)}

      Please write a professional, engaging, beautifully-formatted markdown advisory report. Address the user directly by their name. Do not output JSON. Use markdown headers, bold text, bullet points, and clean lists. Keep it comprehensive yet concise.
    `;

    const result = await callGeminiWithRetries(prompt);
    const responseText = result.response.text();

    res.json({
      success: true,
      mode: 'Live Gemini AI',
      analysis: responseText
    });

  } catch (error) {
    console.error('AI Coach Error:', error);
    const fallbackContext = (typeof contextData !== 'undefined' && contextData) ? contextData : {
      username: (req && req.user && req.user.username) ? req.user.username : 'User',
      overallStats: {
        totalIncomeLogged: 0,
        totalExpenseLogged: 0,
        currentMonthCategoryExpenses: {}
      },
      budgets: [],
      recentTransactions: []
    };
    const mockAdvisory = generateMockAdvisory(fallbackContext);
    return res.json({
      success: true,
      mode: 'Simulation Mode (Gemini unavailable)',
      analysis: mockAdvisory,
      warning: error && error.message ? error.message : 'Gemini service unavailable'
    });
  }
});

// @desc    Parse conversational natural text to structured transaction JSON
// @route   POST /api/ai/parse
// @access  Private
router.post('/parse', protect, async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || text.trim() === '') {
      return res.status(400).json({ success: false, message: 'No input text provided' });
    }

    let parsedResult = null;

    if (!geminiModel) {
      // Use standard regex-based smart parser fallback
      parsedResult = parseTextFallback(text);
      return res.json({
        success: true,
        mode: 'Simulation Parsing',
        data: parsedResult
      });
    }

    // Prompt for Gemini to return structured JSON
    const prompt = `
      Extract the transaction details from this sentence: "${text}".
      Identify:
      - Amount (number only, ignore currency symbols but convert if written as text, e.g., "ten" to 10)
      - Type: Must be either "expense" or "income" (default to "expense" unless there is clear phrasing like "earned", "salary", "paycheck", "received", "deposited")
      - Category: Standardize it to exactly one of the following: Food, Shopping, Bills, Transport, Entertainment, Health, Education, Salary, Investment, Other. Use smart mapping. (e.g. "lunch" or "pizza" -> "Food", "uber" or "gas" or "bus" -> "Transport", "netflix" or "movie" -> "Entertainment", "rent" or "electricity" -> "Bills")
      - Description: A short descriptive string representing what was done.
      - Date: Extract if mentioned (e.g., "yesterday", "two days ago", "May 5th"). Otherwise, default to today's date: ${new Date().toISOString().split('T')[0]}.

      Return strictly a valid JSON object without any backticks, markdown wrapping, or explanations.
      The JSON fields MUST be:
      {
        "amount": number,
        "type": "expense" | "income",
        "category": string,
        "description": string,
        "date": "YYYY-MM-DD"
      }
    `;

    const result = await callGeminiWithRetries(prompt);
    let responseText = result.response.text().trim();
    
    // Clean JSON formatting if Gemini wrapped it in markdown codeblocks
    if (responseText.startsWith('```')) {
      responseText = responseText.replace(/^```json/, '').replace(/^```/, '').replace(/```$/, '').trim();
    }

    try {
      parsedResult = JSON.parse(responseText);
      // Validate categories
      const validCategories = ['Food', 'Shopping', 'Bills', 'Transport', 'Entertainment', 'Health', 'Education', 'Salary', 'Investment', 'Other'];
      if (!validCategories.includes(parsedResult.category)) {
        parsedResult.category = 'Other';
      }
    } catch (parseErr) {
      console.warn("Failed to parse Gemini JSON output, falling back to local NLP parser:", responseText);
      parsedResult = parseTextFallback(text);
    }

    res.json({
      success: true,
      mode: 'Live Gemini Parsing',
      data: parsedResult
    });

  } catch (error) {
    console.error('AI Parsing Error:', error);
    const fallbackText = (req && req.body && req.body.text) ? req.body.text : '';
    const fallback = parseTextFallback(fallbackText);
    return res.json({
      success: true,
      mode: 'Simulation Parsing (Gemini unavailable)',
      data: fallback,
      warning: error && error.message ? error.message : 'Gemini service unavailable'
    });
  }
});

// Smart offline Regex fallback parser
const parseTextFallback = (text) => {
  const normalized = text.toLowerCase();
  
  // 1. Identify Type
  let type = 'expense';
  if (
    normalized.includes('earned') ||
    normalized.includes('salary') ||
    normalized.includes('received') ||
    normalized.includes('paycheck') ||
    normalized.includes('income') ||
    normalized.includes('refund') ||
    normalized.includes('got paid')
  ) {
    type = 'income';
  }

  // 2. Identify Amount
  let amount = 0;
  // Match decimals or integers, e.g. 10.5, 1,000, 45, $30
  const cleanText = normalized.replace(/,/g, '');
  const numberMatches = cleanText.match(/\b\d+(\.\d+)?\b/);
  if (numberMatches) {
    amount = parseFloat(numberMatches[0]);
  } else {
    // Basic word mappings for numbers
    if (normalized.includes('ten')) amount = 10;
    else if (normalized.includes('twenty')) amount = 20;
    else if (normalized.includes('fifty')) amount = 50;
    else if (normalized.includes('hundred')) amount = 100;
  }

  // 3. Smart Categorizer mapping
  let category = 'Other';
  
  const foodKeywords = ['pizza', 'burger', 'lunch', 'dinner', 'breakfast', 'starbucks', 'coffee', 'cafe', 'restaurant', 'food', 'groceries', 'supermarket', 'snack', 'eat'];
  const transportKeywords = ['uber', 'lyft', 'taxi', 'bus', 'train', 'flight', 'gas', 'metro', 'subway', 'fuel', 'ticket', 'toll'];
  const billsKeywords = ['rent', 'electric', 'water', 'internet', 'wifi', 'phone', 'bill', 'insurance', 'subscription', 'netflix', 'spotify', 'utility'];
  const entertainmentKeywords = ['movie', 'theater', 'game', 'bar', 'club', 'beer', 'drinks', 'concert', 'museum', 'playstation', 'steam', 'party'];
  const shoppingKeywords = ['amazon', 'walmart', 'clothes', 'shoes', 'gadget', 'phone', 'laptop', 'gift', 'mall', 'shopping', 'target', 'ebay'];
  const healthKeywords = ['doctor', 'dentist', 'medicine', 'pharmacy', 'hospital', 'clinic', 'gym', 'workout', 'fitness'];
  const eduKeywords = ['book', 'course', 'tuition', 'school', 'udemy', 'college', 'stationery'];
  const salaryKeywords = ['salary', 'paycheck', 'freelance', 'wage', 'bonus', 'dividend'];
  const investKeywords = ['crypto', 'stock', 'shares', 'gold', 'bitcoin', 'mutual fund', 'etf'];

  if (foodKeywords.some(keyword => normalized.includes(keyword))) {
    category = 'Food';
  } else if (transportKeywords.some(keyword => normalized.includes(keyword))) {
    category = 'Transport';
  } else if (billsKeywords.some(keyword => normalized.includes(keyword))) {
    // Netflix/Spotify can overlap with entertainment, let's categorize them as Bills or Entertainment
    category = 'Bills';
  } else if (entertainmentKeywords.some(keyword => normalized.includes(keyword))) {
    category = 'Entertainment';
  } else if (shoppingKeywords.some(keyword => normalized.includes(keyword))) {
    category = 'Shopping';
  } else if (healthKeywords.some(keyword => normalized.includes(keyword))) {
    category = 'Health';
  } else if (eduKeywords.some(keyword => normalized.includes(keyword))) {
    category = 'Education';
  } else if (salaryKeywords.some(keyword => normalized.includes(keyword)) || type === 'income') {
    category = type === 'income' ? 'Salary' : 'Other';
  } else if (investKeywords.some(keyword => normalized.includes(keyword))) {
    category = 'Investment';
  }

  // 4. Extract clean description
  // Remove numbers and standard prepositions to leave a clean label
  let description = text;
  // e.g. "spent 15 dollars on pizza at dominos" -> description: "pizza at dominos"
  const stopwords = ['spent', 'received', 'earned', 'for', 'on', 'at', 'dollars', 'bucks', 'rupees', 'euro', 'euros', 'rs', '$', '£', '€', 'today', 'yesterday'];
  let words = text.split(/\s+/);
  words = words.filter(word => {
    const isNumber = /^\d+(\.\d+)?$/.test(word.replace(/[\$,₹,€,£]/g, ''));
    const isStopword = stopwords.includes(word.toLowerCase());
    return !isNumber && !isStopword;
  });
  if (words.length > 0) {
    description = words.join(' ');
    // Capitalize first letter
    description = description.charAt(0).toUpperCase() + description.slice(1);
  }

  // 5. Date
  let date = new Date().toISOString().split('T')[0];
  if (normalized.includes('yesterday')) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    date = yesterday.toISOString().split('T')[0];
  } else if (normalized.includes('two days ago') || normalized.includes('2 days ago')) {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    date = twoDaysAgo.toISOString().split('T')[0];
  }

  return {
    amount,
    type,
    category,
    description: description || text,
    date
  };
};

// Mock Financial Advisor generator if Gemini key is missing
const generateMockAdvisory = (data) => {
  const { username, overallStats, budgets } = data;
  const currentMonthSpent = Object.values(overallStats.currentMonthCategoryExpenses).reduce((a, b) => a + b, 0);
  
  let report = `# SmartWealth AI™ — Personalized Coaching Report\n`;
  report += `### Hello, **${username}**! 👋\n\n`;
  report += `I have conducted a comprehensive audit of your financial registry. Below is your tailored spending analysis.\n\n`;
  
  report += `## 📊 Financial Overview\n`;
  report += `- **Total Logged Income**: $${overallStats.totalIncomeLogged.toFixed(2)}\n`;
  report += `- **Total Logged Expenses**: $${overallStats.totalExpenseLogged.toFixed(2)}\n`;
  report += `- **Current Month Spending**: $${currentMonthSpent.toFixed(2)}\n`;
  
  const netBalance = overallStats.totalIncomeLogged - overallStats.totalExpenseLogged;
  if (netBalance >= 0) {
    report += `- **Net Balance**: $${netBalance.toFixed(2)} (Savings Rate: **${overallStats.totalIncomeLogged > 0 ? ((netBalance / overallStats.totalIncomeLogged) * 100).toFixed(1) : 0}%** 📈)\n\n`;
  } else {
    report += `- **Net Balance**: -$${Math.abs(netBalance).toFixed(2)} (Deficit ⚠️)\n\n`;
  }

  report += `## 🛡️ Budget Limit Auditing\n`;
  if (budgets.length === 0) {
    report += `*You haven't set up any monthly budget categories yet.* Creating specific budget limits helps guard your funds automatically. **I highly recommend setting limits for "Food", "Entertainment", or "Shopping"!**\n\n`;
  } else {
    report += `Here is your status against your active limits:\n`;
    budgets.forEach(b => {
      const parsedSpent = parseFloat(b.spent);
      const limit = parseFloat(b.limit);
      const ratio = parsedSpent / limit;
      if (ratio > 1.0) {
        report += `- **${b.category}**: Limit: $${limit.toFixed(2)} | Spent: $${parsedSpent.toFixed(2)} (**${(ratio * 100).toFixed(0)}% Used** - 🔴 **Overspent!**)\n`;
      } else if (ratio >= 0.8) {
        report += `- **${b.category}**: Limit: $${limit.toFixed(2)} | Spent: $${parsedSpent.toFixed(2)} (**${(ratio * 100).toFixed(0)}% Used** - 🟡 **Warning, near threshold!**)\n`;
      } else {
        report += `- **${b.category}**: Limit: $${limit.toFixed(2)} | Spent: $${parsedSpent.toFixed(2)} (**${(ratio * 100).toFixed(0)}% Used** - 🟢 **On track!**)\n`;
      }
    });
    report += `\n`;
  }

  // Find top categories
  const sortedCategories = Object.entries(overallStats.currentMonthCategoryExpenses)
    .sort((a, b) => b[1] - a[1]);
  
  report += `## 💡 Actionable Financial Tips\n`;
  if (sortedCategories.length > 0) {
    const topCat = sortedCategories[0][0];
    report += `1. **Squeeze Your "${topCat}" Outlays**: This is currently your highest expenditure category ($${sortedCategories[0][1].toFixed(2)}). Try negotiating lower rates, finding alternatives, or preparing meals at home to trim this amount by 10% next month.\n`;
  } else {
    report += `1. **Log More Expenses**: The system works best when you record every coffee, bill, and transfer. Use the smart conversational input to register daily expenses instantly!\n`;
  }

  report += `2. **Build an Emergency Fund**: Based on your logged data, direct 15% of your registered income ($${(overallStats.totalIncomeLogged * 0.15).toFixed(2)}) straight into a high-yield savings account right at the start of the month, before making any other purchases.\n`;
  report += `3. **Utilize Zero-Based Budgeting**: Map every dollar of your income to a category or saving plan. This ensures your hard-earned funds don't slip away on unrecorded micro-transactions.\n\n`;

  report += `--- \n`;
  report += `*💡 Note: This advice is simulated because GEMINI_API_KEY is not defined. Set up your Gemini API key in your server's .env file to activate live, custom artificial intelligence analytics!*`;

  return report;
};

module.exports = router;

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

// Connect to Database
connectDB();

const app = express();

// Middlewares
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    
    // Clean protocols and trailing slashes for comparison
    const cleanOrigin = origin.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const cleanClient = (process.env.CLIENT_URL || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    
    if (
      cleanOrigin === cleanClient || 
      process.env.NODE_ENV !== 'production' || 
      cleanOrigin === 'localhost:3000' || 
      cleanOrigin === '127.0.0.1:3000'
    ) {
      return callback(null, origin); // Reflect origin back (must include protocol like https://)
    }
    
    return callback(new Error('Blocked by CORS policy'), false);
  },
  credentials: true
}));
app.use(express.json());

// Mount Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/budgets', require('./routes/budgets'));
app.use('/api/goals', require('./routes/goals'));
app.use('/api/ai', require('./routes/ai'));

// Serve Static Assets in Production
const fs = require('fs');
const distPath = path.join(__dirname, '../../client/dist');

if (process.env.NODE_ENV === 'production' && fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(distPath, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.send('SmartWealth AI API is running...');
  });
}

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err.stack);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running in development mode on port ${PORT}`);
});

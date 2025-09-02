// Load environment variables
require('dotenv').config();

// Import dependencies
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const http = require('http');
const WebSocket = require('ws');
const cron = require('node-cron');
const path = require('path');

// Environment variables validation
const requiredEnvVars = [
  'MONGO_URI',
  'FOOTBALL_DATA_KEY',
  'API_FOOTBALL_KEY'
];

const missingVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
if (missingVars.length > 0) {
  console.warn(`⚠️ Warning: The following environment variables are not set: ${missingVars.join(', ')}`);
} else {
  console.log('✅ All required environment variables are set');
}

// Routes
const matchRoutes = require('./appRoutes/matchRoutes');
const predictionRoutes = require('./appRoutes/predictionRoutes');
const oddsRoutes = require('./appRoutes/oddsRoutes');
const resultRoutes = require('./appRoutes/resultRoutes');

// Services
const liveUpdateService = require('./appServices/liveUpdateService');
const predictionService = require('./appServices/predictionService');
const resultService = require('./appServices/resultService');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Routes
app.use('/api/matches', matchRoutes);
app.use('/api/predictions', predictionRoutes);
app.use('/api/odds', oddsRoutes);
app.use('/api/results', resultRoutes);

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Prediction backend running',
    liveUpdates: process.env.ENABLE_LIVE_UPDATES === 'true'
  });
});

// WebSocket handling
wss.on('connection', (ws) => {
  console.log('Client connected to WebSocket');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'subscribe' && data.matchId) {
        ws.matchId = data.matchId;
      }
    } catch (e) {
      console.error('WebSocket message error:', e.message);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected from WebSocket');
  });
});

// Broadcast updates to relevant clients
liveUpdateService.on('matchUpdate', (match) => {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && (!client.matchId || client.matchId === match._id.toString())) {
      client.send(JSON.stringify({
        type: 'matchUpdate',
        data: match
      }));
    }
  });
});

// Start live updates if enabled
if (process.env.ENABLE_LIVE_UPDATES === 'true') {
  liveUpdateService.start();
  console.log('🔄 Live updates enabled');
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    status: 'error',
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Handle unhandled routes
app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Route not found'
  });
});

// Cron jobs setup
const cronJobs = {
  // Fetch new matches and refresh predictions every 40 minutes
  matchAndPredictions: cron.schedule('*/40 * * * *', async () => {
    console.log('⏰ Fetching matches and updating predictions...');
    try {
      const matches = await matchService.fetchAndStoreMatches();
      console.log(`📊 Retrieved ${matches.length} matches`);
      
      const predictions = await predictionService.refreshPredictions();
      console.log(`🎯 Updated ${predictions} predictions`);
      
      console.log('✅ Matches and predictions updated successfully');
    } catch (err) {
      console.error('❌ Match/Prediction update failed:', err.message);
    }
  }),

  // Update results after match hours (at minute 15 of hours 0, 4, 8, 12, 16, 20)
  results: cron.schedule('15 0,4,8,12,16,20 * * *', async () => {
    console.log('⏰ Running post-match results update...');
    // Only run frequent updates during typical match hours (12:00 - 23:00)
    if (hour >= 12 && hour <= 23) {
      console.log('⏰ Syncing match results...');
      try {
        const results = await resultService.fetchAndStoreResults();
        console.log(`📊 Updated ${results.length} match results`);
        
        // Update predictions status based on results
        await predictionService.evaluatePendingPredictions();
        console.log('✅ Results synchronized and predictions evaluated');
      } catch (err) {
        console.error('❌ Result sync failed:', err.message);
      }
    }
  }),

  // Daily maintenance job at 03:00
  maintenance: cron.schedule('0 3 * * *', async () => {
    console.log('⏰ Running daily maintenance...');
    try {
      // Archive old matches
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const archived = await Match.updateMany(
        { 
          date: { $lt: thirtyDaysAgo },
          status: 'FINISHED',
          archived: { $ne: true }
        },
        { $set: { archived: true } }
      );

      // Clean up old results
      const cleaned = await Result.deleteMany({
        date: { $lt: thirtyDaysAgo }
      });

      console.log(`✅ Maintenance complete: Archived ${archived.modifiedCount} matches, cleaned ${cleaned.deletedCount} old results`);
    } catch (err) {
      console.error('❌ Maintenance failed:', err.message);
    }
  }),

  // Clean up old data and update stats daily at 03:00
  maintenance: cron.schedule('0 3 * * *', async () => {
    console.log('⏰ Running daily maintenance...');
    try {
      // Archive old matches (keep last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      await Match.updateMany(
        { 
          date: { $lt: thirtyDaysAgo },
          status: 'FINISHED'
        },
        { $set: { archived: true } }
      );

      // Update overall statistics
      await predictionService.updateOverallStats();
      console.log('✅ Daily maintenance completed');
    } catch (err) {
      console.error('❌ Maintenance failed:', err.message);
    }
  })
};

// Handle graceful shutdown of cron jobs
process.on('SIGTERM', () => {
  console.log('🛑 Stopping cron jobs...');
  Object.values(cronJobs).forEach(job => job.stop());
});

// Server configuration
const PORT = process.env.PORT || 10000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI is not set in .env');
  process.exit(1);
}

// MongoDB connection options
const mongooseOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  family: 4,
  retryWrites: true,
  maxPoolSize: 50
};

// Connect to MongoDB with enhanced error handling
async function connectToMongoDB() {
  try {
    await mongoose.connect(MONGO_URI, mongooseOptions);
    console.log('✅ Connected to MongoDB');
    
    // Start server only after successful DB connection
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  }
}

// Handle MongoDB connection events
mongoose.connection.on('error', err => {
  console.error('MongoDB error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected. Attempting to reconnect...');
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected');
});

// Start the application
connectToMongoDB();

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received. Starting graceful shutdown...');
  
  // Stop cron jobs
  Object.values(cronJobs).forEach(job => job.stop());
  
  // Stop live updates
  if (process.env.ENABLE_LIVE_UPDATES === 'true') {
    liveUpdateService.stop();
  }
  
  // Close WebSocket connections
  wss.clients.forEach(client => {
    client.terminate();
  });
  
  // Close HTTP server
  server.close(() => {
    console.log('HTTP server closed');
    
    // Close MongoDB connection
    mongoose.connection.close(false, () => {
      console.log('MongoDB connection closed');
      process.exit(0);
    });
  });
  
  // Force close after 10 seconds
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received. Shutting down...');
  liveUpdateService.stop();
  server.close(() => {
    console.log('Server closed');
    mongoose.connection.close(false, () => {
      console.log('MongoDB connection closed');
      process.exit(0);
    });
  });
});

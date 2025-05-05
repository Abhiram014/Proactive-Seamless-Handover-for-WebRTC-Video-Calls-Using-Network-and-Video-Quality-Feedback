const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Configure Socket.IO with CORS
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Constants
const PORT = 3000;
const LOG_FILE = 'stats_log.csv';

// Middleware setup
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.text());

/**
 * Logs statistics data to a CSV file
 */
app.post('/log', (req, res) => {
  try {
    // Create log file if it doesn't exist
    if (!fs.existsSync(LOG_FILE)) {
      fs.writeFileSync(LOG_FILE, 'timestamp,rtt,bitrateIn,bitrateOut,packetLoss,jitter,frameRate,framesDropped,qualityScore,decision,localEndpoint,remoteEndpoint\n');
    }
    
    fs.appendFileSync(LOG_FILE, req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error('Error writing to log file:', error);
    res.status(500).send('Error saving log data');
  }
});

// Socket.IO event handlers
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // WebRTC signaling events
  socket.on('offer', (data) => {
    socket.broadcast.emit('offer', data);
  });

  socket.on('answer', (data) => {
    socket.broadcast.emit('answer', data);
  });

  socket.on('ice-candidate', (data) => {
    socket.broadcast.emit('ice-candidate', data);
  });

  socket.on('restart-ice-request', () => {
    socket.broadcast.emit('restart-ice-request');
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Error handling
server.on('error', (error) => {
  console.error('Server error:', error);
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebRTC signaling server ready`);
  console.log(`Logging endpoint: http://localhost:${PORT}/log`);
});

// Cleanup on process termination
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
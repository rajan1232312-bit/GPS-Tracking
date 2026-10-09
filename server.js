const net = require('net');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const db = require('./db');

// Utility: Calculate distance between two coordinates in meters (Haversine formula)
function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
    const R = 6371e3; // Radius of the earth in m
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in meters
}
// --- Decimation Cache ---
const deviceStateCache = new Map();

// --- TCP Listener Server ---
const TCP_PORT = process.env.TCP_PORT || 5000;
const tcpServer = net.createServer((socket) => {
    console.log('TCP Client connected:', socket.remoteAddress, socket.remotePort);

    socket.on('data', (data) => {
        const rawPacket = data.toString().trim();
        console.log('Received TCP Data:', rawPacket);
        
        let payload;
        try {
            // Expected JSON format from Hardware Team:
            // { "device_uid": "1234567", "name": "Delivery Van 1", "lat": 13.0827, "lon": 80.2707, "speed": 40, "battery": 85 }
            payload = JSON.parse(rawPacket);
        } catch (e) {
            console.log('Invalid JSON packet format. Waiting for valid JSON payload.');
            return;
        }

        if (payload && payload.device_uid && payload.name) {
            const { device_uid, name, lat, lon, speed, battery } = payload;

            // Strict Validation: Ensure BOTH device_uid and name match the registered database entry
            db.get(`SELECT * FROM devices WHERE device_uid = ? AND name = ? AND status = 'Active'`, [device_uid, name], (err, row) => {
                if (err) {
                    console.error('DB Error:', err);
                    return;
                }

                if (row) {
                    console.log(`Security Validation Passed: Device ${name} (${device_uid}) is valid and matched.`);
                    
                    let latitude = parseFloat(lat);
                    let longitude = parseFloat(lon);
                    const speedVal = parseFloat(speed);
                    const battery_percentage = parseInt(battery, 10);

                    // --- Professional Vehicle & Human Tracking Logic ---
                    // (REMOVED: The user requested that raw data must be saved exactly as received.
                    // The EMA smoothing and stationary drift locks have been disabled.)
                    // --------------------------------------------------

                    // --- Decimation Logic ---
                    // The UI needs 1-sec updates for 60FPS smoothing, but the DB shouldn't be flooded.
                    const now = Date.now();
                    let shouldSaveToDb = false;

                    if (!deviceStateCache.has(device_uid)) {
                        shouldSaveToDb = true;
                    } else {
                        const lastState = deviceStateCache.get(device_uid);
                        const timeDiff = now - lastState.lastSaveTime;
                        const distDiff = getDistanceFromLatLonInMeters(lastState.lat, lastState.lon, latitude, longitude);
                        
                        // Save to DB only if 10 seconds have passed OR vehicle moved > 10 meters
                        if (timeDiff >= 10000 || distDiff >= 10) {
                            shouldSaveToDb = true;
                        }
                    }

                    // 1. ALWAYS emit to WebSocket instantly for perfect frontend smoothing
                    const eventData = {
                        id: device_uid,
                        name: name,
                        lat: latitude,
                        lon: longitude,
                        speed: speedVal,
                        battery: battery_percentage,
                        type: row.type || 'Car',
                        timestamp: new Date().toISOString()
                    };
                    io.emit('device_moved', eventData);

                    // 2. ALWAYS acknowledge hardware instantly
                    socket.write(`ACK,${device_uid}#\n`);

                    // 3. DECIMATE DB Writes
                    if (shouldSaveToDb) {
                        deviceStateCache.set(device_uid, {
                            lat: latitude,
                            lon: longitude,
                            lastSaveTime: now
                        });

                        db.run(`
                            INSERT INTO telemetry_logs (device_uid, latitude, longitude, speed, battery_percentage)
                            VALUES (?, ?, ?, ?, ?)
                        `, [device_uid, latitude, longitude, speedVal, battery_percentage], function(err) {
                            if (err) console.error('Error inserting telemetry log:', err);
                        });

                        db.run(`
                            UPDATE devices SET last_seen = CURRENT_TIMESTAMP, battery_percentage = ?, last_lat = ?, last_lon = ? WHERE device_uid = ?
                        `, [battery_percentage, latitude, longitude, device_uid], function(updateErr) {
                            if (updateErr) console.error('Error updating device last_seen:', updateErr);
                        });
                        console.log(`[DB SAVE] Decimated data saved to disk for ${name}`);
                    }

                } else {
                    console.log(`Security Validation Failed: No active device found matching UID '${device_uid}' and Name '${name}'.`);
                }
            });
        } else {
            console.log('Invalid payload missing device_uid or name.');
        }
    });

    socket.on('error', (err) => {
        console.error('TCP Socket Error:', err);
    });

    socket.on('close', () => {
        console.log('TCP Client disconnected.');
    });
});

tcpServer.listen(TCP_PORT, () => {
    console.log(`TCP Listener Server running on port ${TCP_PORT}`);
});


// --- WebSocket (HTTP) Server ---
const HTTP_PORT = process.env.HTTP_PORT || 5001;
const app = express();
const httpServer = http.createServer(app);

// Enable CORS for WebSocket testing from any origin
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files for the frontend map application
app.use(express.static('public'));
app.use(express.json()); // Enable JSON parsing for API requests

// --- REST API Endpoints ---

// Register a new device
app.post('/api/devices/register', (req, res) => {
    const { device_uid, name, type } = req.body;
    if (!device_uid || !name) {
        return res.status(400).json({ error: 'device_uid and name are required' });
    }
    const deviceType = type || 'Car';
    db.run(`INSERT INTO devices (device_uid, name, type) VALUES (?, ?, ?)`, [device_uid, name, deviceType], function(err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ error: 'Device UID already exists' });
            }
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, id: this.lastID, device_uid, name, type: deviceType });
    });
});

// Get all devices with Online/Offline status
app.get('/api/devices', (req, res) => {
    db.all(`SELECT * FROM devices`, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        // Calculate Online/Offline (Consider offline if not seen for 2 minutes)
        const now = new Date();
        const devices = rows.map(device => {
            let isOnline = false;
            if (device.last_seen) {
                // Ensure last_seen is parsed as UTC since SQLite CURRENT_TIMESTAMP is UTC
                const lastSeenDate = new Date(device.last_seen + 'Z'); 
                const diffMinutes = (now - lastSeenDate) / 1000 / 60;
                if (diffMinutes <= 2) {
                    isOnline = true;
                }
            }
            return {
                ...device,
                isOnline
            };
        });
        res.json(devices);
    });
});

// Delete a device
app.delete('/api/devices/:uid', (req, res) => {
    const uid = req.params.uid;
    db.run(`DELETE FROM devices WHERE device_uid = ?`, [uid], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, deletedCount: this.changes });
    });
});

// Update a device name
app.put('/api/devices/:uid', (req, res) => {
    const uid = req.params.uid;
    const { name, type } = req.body;
    
    if (!name) {
        return res.status(400).json({ error: 'Name is required' });
    }

    let query = `UPDATE devices SET name = ?`;
    let params = [name];

    if (type) {
        query += `, type = ?`;
        params.push(type);
    }
    
    query += ` WHERE device_uid = ?`;
    params.push(uid);

    db.run(query, params, function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, updatedCount: this.changes, name, type });
    });
});

// Get historical telemetry logs for a specific device
app.get('/api/devices/:uid/logs', (req, res) => {
    const { uid } = req.params;
    db.all(`SELECT * FROM telemetry_logs WHERE device_uid = ? ORDER BY timestamp DESC`, [uid], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// Get chronological history with date filters
app.get('/api/devices/:uid/history', (req, res) => {
    const { uid } = req.params;
    const { start, end } = req.query;

    let query = `SELECT * FROM telemetry_logs WHERE device_uid = ?`;
    let params = [uid];

    if (start) {
        query += ` AND timestamp >= ?`;
        params.push(start);
    }
    if (end) {
        query += ` AND timestamp <= ?`;
        params.push(end);
    }

    query += ` ORDER BY timestamp ASC`;

    db.all(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// Get all telemetry logs across all devices combined with device names, with pagination and filtering
app.get('/api/logs/all', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const device_uid = req.query.device_uid;
    const offset = (page - 1) * limit;

    let whereClause = "";
    let params = [];

    if (device_uid && device_uid !== 'all') {
        whereClause = "WHERE t.device_uid = ?";
        params.push(device_uid);
    }

    // Get total count for pagination
    const countQuery = `SELECT COUNT(*) as total FROM telemetry_logs t ${whereClause}`;
    
    db.get(countQuery, params, (err, countResult) => {
        if (err) return res.status(500).json({ error: err.message });
        const total = countResult ? countResult.total : 0;

        const dataQuery = `
            SELECT 
                t.id, 
                t.latitude, 
                t.longitude, 
                t.device_uid, 
                d.name as device_name, 
                t.timestamp 
            FROM telemetry_logs t 
            LEFT JOIN devices d ON t.device_uid = d.device_uid 
            ${whereClause}
            ORDER BY t.timestamp DESC 
            LIMIT ? OFFSET ?
        `;
        
        const dataParams = [...params, limit, offset];

        db.all(dataQuery, dataParams, (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
                data: rows
            });
        });
    });
});

// Fallback endpoint to verify HTTP server is running
app.get('/api/status', (req, res) => {
    res.send('GPS Backend Server is running.');
});

io.on('connection', (socket) => {
    console.log('Frontend WebSocket client connected:', socket.id);
    
    socket.on('disconnect', () => {
        console.log('Frontend WebSocket client disconnected:', socket.id);
    });
});

httpServer.listen(HTTP_PORT, () => {
    console.log(`HTTP/WebSocket Server running on port ${HTTP_PORT}`);
});

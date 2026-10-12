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

// Helper: Parse metric numbers and handle partial / missing data gracefully
function parseNumberOrNull(val) {
    if (val === undefined || val === null || val === '') return null;
    const num = parseFloat(val);
    return isNaN(num) ? null : num;
}

function parseIntOrNull(val) {
    if (val === undefined || val === null || val === '') return null;
    const num = parseInt(val, 10);
    return isNaN(num) ? null : num;
}

// Process and store incoming vitals data (handles partial vitals e.g. missing HR)
function processVitalsPayload(payload, deviceRow) {
    const { device_uid, name } = payload;
    
    // Check if any vitals metric is present in the payload
    const hasVitals = (
        payload.heart_rate !== undefined ||
        payload.blood_pressure !== undefined ||
        payload.bp !== undefined ||
        payload.bp_sys !== undefined ||
        payload.bp_dia !== undefined ||
        payload.spo2 !== undefined ||
        payload.steps !== undefined ||
        payload.step_count !== undefined
    );

    if (!hasVitals) return null;

    const heartRate = parseIntOrNull(payload.heart_rate);
    const spo2 = parseNumberOrNull(payload.spo2);
    const steps = parseIntOrNull(payload.steps !== undefined ? payload.steps : payload.step_count);

    let bpSys = parseIntOrNull(payload.bp_sys);
    let bpDia = parseIntOrNull(payload.bp_dia);
    let bp = null;

    if (payload.blood_pressure || payload.bp) {
        bp = String(payload.blood_pressure || payload.bp).trim();
        // If sys/dia weren't directly provided as fields, extract from formatted string e.g. "120/80"
        if (bpSys === null || bpDia === null) {
            const parts = bp.split('/');
            if (parts.length === 2) {
                bpSys = parseIntOrNull(parts[0]);
                bpDia = parseIntOrNull(parts[1]);
            }
        }
    } else if (bpSys !== null && bpDia !== null) {
        bp = `${bpSys}/${bpDia}`;
    } else if (bpSys !== null) {
        bp = `${bpSys}/—`;
    } else if (bpDia !== null) {
        bp = `—/${bpDia}`;
    }

    const timestamp = new Date().toISOString();

    // 1. Insert into vitals_logs
    db.run(`
        INSERT INTO vitals_logs (device_uid, heart_rate, blood_pressure, blood_pressure_sys, blood_pressure_dia, spo2, step_count)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [device_uid, heartRate, bp, bpSys, bpDia, spo2, steps], function(err) {
        if (err) console.error('Error inserting vitals log:', err);
    });

    // 2. Update device last seen
    db.run(`UPDATE devices SET last_seen = CURRENT_TIMESTAMP WHERE device_uid = ?`, [device_uid], function(err) {
        if (err) console.error('Error updating device last_seen for vitals:', err);
    });

    // 3. Emit real-time WebSocket event
    const vitalsEvent = {
        id: device_uid,
        device_uid: device_uid,
        name: name,
        heart_rate: heartRate,
        blood_pressure: bp,
        bp_sys: bpSys,
        bp_dia: bpDia,
        spo2: spo2,
        steps: steps,
        timestamp: timestamp
    };
    io.emit('vitals_updated', vitalsEvent);
    console.log(`[VITALS RECEIVED] ${name} (${device_uid}) -> HR: ${heartRate ?? '—'}, BP: ${bp ?? '—'}, SpO2: ${spo2 ?? '—'}, Steps: ${steps ?? '—'}`);
    return vitalsEvent;
}

// --- TCP Listener Server ---
const TCP_PORT = process.env.TCP_PORT || 5000;
const tcpServer = net.createServer((socket) => {
    console.log('TCP Client connected:', socket.remoteAddress, socket.remotePort);

    socket.on('data', (data) => {
        const rawPacket = data.toString().trim();

        // Handle cloud health-check probes (e.g. Render prober sending HEAD/GET to all open ports)
        if (rawPacket.startsWith('HEAD ') || rawPacket.startsWith('GET ')) {
            socket.write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            socket.end();
            return;
        }

        console.log('Received TCP Data:', rawPacket);
        
        let payload;
        try {
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
                    
                    // 1. Process Vitals if present
                    processVitalsPayload(payload, row);

                    // 2. Process GPS Telemetry if coordinates are present
                    const hasCoordinates = (lat !== undefined && lon !== undefined && lat !== null && lon !== null);
                    if (hasCoordinates) {
                        let latitude = parseFloat(lat);
                        let longitude = parseFloat(lon);
                        const speedVal = parseFloat(speed || 0);
                        const battery_percentage = battery !== undefined ? parseInt(battery, 10) : (row.battery_percentage || 100);

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

                        // Emit to WebSocket instantly for perfect frontend smoothing
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

                        // Decimate DB Writes for GPS
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
                    }

                    // 3. ALWAYS acknowledge hardware instantly
                    socket.write(`ACK,${device_uid}#\n`);

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
const HTTP_PORT = process.env.PORT || process.env.HTTP_PORT || 5001;
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

// Hardware HTTP Tracker Endpoint (Supports GPS Telemetry + Health Vitals)
app.post('/api/tracker/update', (req, res) => {
    const payload = req.body;
    
    if (payload && payload.device_uid && payload.name) {
        const { device_uid, name, lat, lon, speed, battery } = payload;

        db.get(`SELECT * FROM devices WHERE device_uid = ? AND name = ? AND status = 'Active'`, [device_uid, name], (err, row) => {
            if (err) return res.status(500).json({ error: 'DB Error' });

            if (row) {
                console.log(`Security Validation Passed (HTTP): Device ${name} (${device_uid})`);
                
                // 1. Process Vitals if included
                processVitalsPayload(payload, row);

                // 2. Process GPS Telemetry if coordinates included
                const hasCoordinates = (lat !== undefined && lon !== undefined && lat !== null && lon !== null);
                if (hasCoordinates) {
                    let latitude = parseFloat(lat);
                    let longitude = parseFloat(lon);
                    const speedVal = parseFloat(speed || 0);
                    const battery_percentage = battery !== undefined ? parseInt(battery, 10) : (row.battery_percentage || 100);

                    const now = Date.now();
                    let shouldSaveToDb = false;

                    if (!deviceStateCache.has(device_uid)) {
                        shouldSaveToDb = true;
                    } else {
                        const lastState = deviceStateCache.get(device_uid);
                        const timeDiff = now - lastState.lastSaveTime;
                        const distDiff = getDistanceFromLatLonInMeters(lastState.lat, lastState.lon, latitude, longitude);
                        
                        if (timeDiff >= 10000 || distDiff >= 10) {
                            shouldSaveToDb = true;
                        }
                    }

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

                    if (shouldSaveToDb) {
                        deviceStateCache.set(device_uid, {
                            lat: latitude,
                            lon: longitude,
                            lastSaveTime: now
                        });

                        db.run(`INSERT INTO telemetry_logs (device_uid, latitude, longitude, speed, battery_percentage) VALUES (?, ?, ?, ?, ?)`, 
                            [device_uid, latitude, longitude, speedVal, battery_percentage]);

                        db.run(`UPDATE devices SET last_seen = CURRENT_TIMESTAMP, battery_percentage = ?, last_lat = ?, last_lon = ? WHERE device_uid = ?`, 
                            [battery_percentage, latitude, longitude, device_uid]);
                        
                        console.log(`[DB SAVE] Decimated data saved to disk for ${name} via HTTP`);
                    }
                }

                return res.send(`ACK,${device_uid}#\n`);
            } else {
                return res.status(401).send('Security Validation Failed');
            }
        });
    } else {
        return res.status(400).send('Invalid payload');
    }
});

// Dedicated HTTP Endpoint for Health Vitals updates (BP, SpO2, Heart Rate, Steps)
app.post('/api/vitals/update', (req, res) => {
    const payload = req.body;
    
    if (payload && payload.device_uid && payload.name) {
        const { device_uid, name } = payload;

        db.get(`SELECT * FROM devices WHERE device_uid = ? AND name = ? AND status = 'Active'`, [device_uid, name], (err, row) => {
            if (err) return res.status(500).json({ error: 'DB Error' });

            if (row) {
                console.log(`Security Validation Passed (Vitals HTTP): Device ${name} (${device_uid})`);
                const vitalsResult = processVitalsPayload(payload, row);
                return res.json({ success: true, message: 'Vitals logged successfully', data: vitalsResult });
            } else {
                return res.status(401).json({ error: 'Security Validation Failed: Device not found or inactive' });
            }
        });
    } else {
        return res.status(400).json({ error: 'Invalid payload: device_uid and name are required' });
    }
});

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

// Get all vitals logs across all devices combined with device names, with pagination and filtering
app.get('/api/logs/vitals', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const device_uid = req.query.device_uid;
    const offset = (page - 1) * limit;

    let whereClause = "";
    let params = [];

    if (device_uid && device_uid !== 'all') {
        whereClause = "WHERE v.device_uid = ?";
        params.push(device_uid);
    }

    const countQuery = `SELECT COUNT(*) as total FROM vitals_logs v ${whereClause}`;

    db.get(countQuery, params, (err, countResult) => {
        if (err) return res.status(500).json({ error: err.message });
        const total = countResult ? countResult.total : 0;

        const dataQuery = `
            SELECT 
                v.id, 
                v.device_uid, 
                d.name as device_name, 
                v.heart_rate, 
                v.blood_pressure, 
                v.blood_pressure_sys, 
                v.blood_pressure_dia, 
                v.spo2, 
                v.step_count as steps, 
                v.timestamp 
            FROM vitals_logs v 
            LEFT JOIN devices d ON v.device_uid = d.device_uid 
            ${whereClause} 
            ORDER BY v.timestamp DESC 
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

// Get latest vitals for all devices or a single device
app.get('/api/vitals/latest', (req, res) => {
    const device_uid = req.query.device_uid;
    const query = `
        SELECT 
            v.id, 
            v.device_uid, 
            d.name as device_name, 
            d.type as device_type,
            d.battery_percentage,
            v.heart_rate, 
            v.blood_pressure, 
            v.blood_pressure_sys, 
            v.blood_pressure_dia, 
            v.spo2, 
            v.step_count as steps, 
            v.timestamp 
        FROM vitals_logs v 
        LEFT JOIN devices d ON v.device_uid = d.device_uid 
        ORDER BY v.timestamp DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Group by device_uid to pick the most recent record
        const latestMap = new Map();
        for (const row of rows) {
            if (!latestMap.has(row.device_uid)) {
                latestMap.set(row.device_uid, row);
            }
        }
        
        if (device_uid && device_uid !== 'all') {
            const found = latestMap.get(device_uid) || null;
            return res.json(found);
        }
        res.json(Array.from(latestMap.values()));
    });
});

// Get historical vitals for a specific device
app.get('/api/devices/:uid/vitals', (req, res) => {
    const { uid } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    db.all(`SELECT * FROM vitals_logs WHERE device_uid = ? ORDER BY timestamp DESC LIMIT ?`, [uid, limit], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
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

const net = require('net');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const db = require('./db');

// Utility: Calculate distance between two coordinates in meters (Haversine formula)
function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
    const R = 6371e3;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// --- Decimation Cache ---
const deviceStateCache = new Map();

// Helper: Parse numbers — returns null if absent, empty, NaN, or hardware -1 sentinel
function parseNumberOrNull(val) {
    if (val === undefined || val === null || val === '') return null;
    const num = parseFloat(val);
    if (isNaN(num) || num === -1) return null;
    return num;
}

function parseIntOrNull(val) {
    if (val === undefined || val === null || val === '') return null;
    const num = parseInt(val, 10);
    if (isNaN(num) || num === -1) return null;
    return num;
}

// ─────────────────────────────────────────────────────────────────────────────
// normalisePayload — maps hardware field names to canonical internal names
//   device_id            → device_uid
//   hr                   → heart_rate
//   lat / lon            → latitude / longitude
//   watch_battery_percent→ watch_battery
//   bp "sys/dia" string  → bp_sys + bp_dia
//   speed absent         → 0
// ─────────────────────────────────────────────────────────────────────────────
function normalisePayload(raw) {
    const p = Object.assign({}, raw);
    if (!p.device_uid && p.device_id)              p.device_uid  = p.device_id;
    if (p.heart_rate === undefined && p.hr !== undefined) p.heart_rate = p.hr;
    if (p.latitude  === undefined && p.lat !== undefined) p.latitude   = p.lat;
    if (p.longitude === undefined && p.lon !== undefined) p.longitude  = p.lon;
    if (p.watch_battery === undefined && p.watch_battery_percent !== undefined)
        p.watch_battery = p.watch_battery_percent;
    if (p.speed === undefined || p.speed === null)  p.speed = 0;
    if (p.bp && typeof p.bp === 'string' && p.bp.includes('/')) {
        const parts = p.bp.split('/');
        if (p.bp_sys === undefined) p.bp_sys = parts[0];
        if (p.bp_dia === undefined) p.bp_dia = parts[1];
    }
    return p;
}

// Process and store incoming vitals data
function processVitalsPayload(rawPayload, deviceRow) {
    const payload = normalisePayload(rawPayload);
    const device_uid = (deviceRow && deviceRow.device_uid) || payload.device_uid || payload.id;
    const name = device_uid;

    const hasVitals = (
        payload.heart_rate  !== undefined || payload.blood_pressure !== undefined ||
        payload.bp          !== undefined || payload.bp_sys         !== undefined ||
        payload.bp_dia      !== undefined || payload.spo2           !== undefined ||
        payload.steps       !== undefined || payload.step_count     !== undefined
    );
    if (!hasVitals) return null;

    const heartRate = parseIntOrNull(payload.heart_rate);
    const spo2      = parseNumberOrNull(payload.spo2);
    const steps     = parseIntOrNull(payload.steps !== undefined ? payload.steps : payload.step_count);

    let bpSys = parseIntOrNull(payload.bp_sys);
    let bpDia = parseIntOrNull(payload.bp_dia);
    let bp    = null;

    if (payload.blood_pressure || payload.bp) {
        bp = String(payload.blood_pressure || payload.bp).trim();
        if (bpSys === null || bpDia === null) {
            const parts = bp.split('/');
            if (parts.length === 2) { bpSys = parseIntOrNull(parts[0]); bpDia = parseIntOrNull(parts[1]); }
        }
    } else if (bpSys !== null && bpDia !== null) { bp = `${bpSys}/${bpDia}`; }
    else if (bpSys !== null)  { bp = `${bpSys}/—`; }
    else if (bpDia !== null)  { bp = `—/${bpDia}`; }

    const transport_mode = (payload.transport_mode !== undefined && payload.transport_mode !== null) ? parseInt(payload.transport_mode, 10) : null;
    const gps_status     = (payload.gps_status     !== undefined && payload.gps_status     !== null) ? parseInt(payload.gps_status,     10) : null;
    const watch_status   = (payload.watch_status   !== undefined && payload.watch_status   !== null) ? parseInt(payload.watch_status,   10) : null;
    const watch_battery  = parseNumberOrNull(payload.watch_battery);
    const timestamp = new Date().toISOString();

    db.run(`
        INSERT INTO vitals_logs
            (device_uid, heart_rate, blood_pressure, blood_pressure_sys, blood_pressure_dia,
             spo2, step_count, transport_mode, gps_status, watch_status, watch_battery)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [device_uid, heartRate, bp, bpSys, bpDia, spo2, steps,
        transport_mode, gps_status, watch_status, watch_battery], function(err) {
        if (err) console.error('Error inserting vitals log:', err);
    });

    db.run(`
        UPDATE devices SET last_seen = CURRENT_TIMESTAMP,
            watch_battery  = ?,
            transport_mode = COALESCE(?, transport_mode),
            gps_status     = COALESCE(?, gps_status),
            watch_status   = COALESCE(?, watch_status)
        WHERE device_uid = ?
    `, [watch_battery, transport_mode, gps_status, watch_status, device_uid], function(err) {
        if (err) console.error('Error updating device for vitals:', err);
    });

    const vitalsEvent = {
        id: device_uid, device_uid, name,
        heart_rate: heartRate, blood_pressure: bp, bp_sys: bpSys, bp_dia: bpDia,
        spo2, steps, transport_mode, gps_status, watch_status, watch_battery, timestamp
    };
    io.emit('vitals_updated', vitalsEvent);

    const tm = transport_mode === 0 ? 'LoRa' : transport_mode === 1 ? 'GSM' : transport_mode === 2 ? 'WiFi' : '?';
    console.log(`[VITALS] ${name} via ${tm} | HR:${heartRate??'—'} BP:${bp??'—'} SpO2:${spo2??'—'} Steps:${steps??'—'} WBatt:${watch_battery??'—'}%`);
    return vitalsEvent;
}

// Shared GPS telemetry processing (TCP + HTTP share this)
function processGpsPayload(payload, row) {
    const targetUid = row.device_uid;
    const rawLat = payload.latitude !== undefined ? payload.latitude : payload.lat;
    const rawLon = payload.longitude !== undefined ? payload.longitude : payload.lon;
    const hasCoordinates = (rawLat !== undefined && rawLon !== undefined && rawLat !== null && rawLon !== null);
    if (!hasCoordinates) return;

    const latitude  = parseFloat(rawLat);
    const longitude = parseFloat(rawLon);
    const speedVal  = parseFloat(payload.speed || 0);

    const watch_battery     = parseNumberOrNull(payload.watch_battery !== undefined ? payload.watch_battery : payload.watch_battery_percent);
    const battery_percentage = watch_battery !== null ? Math.round(watch_battery) : (row.battery_percentage || null);

    const transport_mode = (payload.transport_mode !== undefined && payload.transport_mode !== null) ? parseInt(payload.transport_mode, 10) : null;
    const gps_status     = (payload.gps_status     !== undefined && payload.gps_status     !== null) ? parseInt(payload.gps_status,     10) : null;

    const now = Date.now();
    let shouldSaveToDb = false;

    if (!deviceStateCache.has(targetUid)) {
        shouldSaveToDb = true;
    } else {
        const lastState = deviceStateCache.get(targetUid);
        const timeDiff = now - lastState.lastSaveTime;
        const distDiff = getDistanceFromLatLonInMeters(lastState.lat, lastState.lon, latitude, longitude);
        if (timeDiff >= 10000 || distDiff >= 10) shouldSaveToDb = true;
    }

    io.emit('device_moved', {
        id: targetUid, name: targetUid,
        lat: latitude, lon: longitude, speed: speedVal,
        battery: battery_percentage, watch_battery,
        transport_mode, gps_status,
        type: row.type || 'Car',
        timestamp: new Date().toISOString()
    });

    if (shouldSaveToDb) {
        deviceStateCache.set(targetUid, { lat: latitude, lon: longitude, lastSaveTime: now });

        db.run(`
            INSERT INTO telemetry_logs
                (device_uid, latitude, longitude, speed, battery_percentage, transport_mode, gps_status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [targetUid, latitude, longitude, speedVal, battery_percentage, transport_mode, gps_status], function(err) {
            if (err) console.error('Error inserting telemetry log:', err);
        });

        db.run(`
            UPDATE devices SET last_seen = CURRENT_TIMESTAMP,
                battery_percentage = ?, last_lat = ?, last_lon = ?,
                transport_mode = COALESCE(?, transport_mode),
                gps_status     = COALESCE(?, gps_status)
            WHERE device_uid = ?
        `, [battery_percentage, latitude, longitude, transport_mode, gps_status, targetUid], function(err) {
            if (err) console.error('Error updating device for telemetry:', err);
        });

        const tm = transport_mode === 0 ? 'LoRa' : transport_mode === 1 ? 'GSM' : transport_mode === 2 ? 'WiFi' : '?';
        console.log(`[DB SAVE] ${targetUid} via ${tm} | GPS:${gps_status === 1 ? 'Locked' : 'NoSignal'} lat=${latitude} lon=${longitude} spd=${speedVal}`);
    }
}

// --- TCP Listener Server ---
const TCP_PORT = process.env.TCP_PORT || 5000;
const tcpServer = net.createServer((socket) => {
    console.log('TCP Client connected:', socket.remoteAddress, socket.remotePort);

    socket.on('data', (data) => {
        const rawPacket = data.toString().trim();
        if (rawPacket.startsWith('HEAD ') || rawPacket.startsWith('GET ')) {
            socket.write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            socket.end(); return;
        }
        console.log('Received TCP Data:', rawPacket);
        let rawPayload;
        try { rawPayload = JSON.parse(rawPacket); }
        catch (e) { console.log('Invalid JSON packet.'); return; }

        const payload    = normalisePayload(rawPayload);
        const device_uid = payload && (payload.device_uid || payload.id);

        if (payload && device_uid) {
            db.get(`SELECT * FROM devices WHERE (device_uid = ? OR name = ?) AND status = 'Active'`, [device_uid, device_uid], (err, row) => {
                if (err) { console.error('DB Error:', err); return; }
                if (row) {
                    console.log(`Validation Passed: Device ${row.device_uid} is valid.`);
                    processVitalsPayload(payload, row);
                    processGpsPayload(payload, row);
                    socket.write(`ACK,${row.device_uid}#\n`);
                } else {
                    console.log(`Validation Failed: No active device found matching '${device_uid}'.`);
                }
            });
        } else {
            console.log('Invalid payload: missing device identifier.');
        }
    });

    socket.on('error', (err) => console.error('TCP Socket Error:', err));
    socket.on('close', () => console.log('TCP Client disconnected.'));
});

tcpServer.listen(TCP_PORT, () => console.log(`TCP Listener Server running on port ${TCP_PORT}`));


// --- WebSocket (HTTP) Server ---
const HTTP_PORT = process.env.PORT || process.env.HTTP_PORT || 5001;
const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use(express.static('public'));
app.use(express.json());

// Hardware HTTP Tracker Endpoint (Unified GPS + Vitals)
app.post('/api/tracker/update', (req, res) => {
    const payload    = normalisePayload(req.body);
    const device_uid = payload && (payload.device_uid || payload.id);
    if (!payload || !device_uid) return res.status(400).send('Invalid payload: device identifier is required');
    db.get(`SELECT * FROM devices WHERE (device_uid = ? OR name = ?) AND status = 'Active'`, [device_uid, device_uid], (err, row) => {
        if (err) return res.status(500).json({ error: 'DB Error' });
        if (!row) return res.status(401).send('Validation Failed: Device not found or inactive');
        console.log(`Validation Passed (HTTP): Device ${row.device_uid}`);
        processVitalsPayload(payload, row);
        processGpsPayload(payload, row);
        return res.send(`ACK,${row.device_uid}#\n`);
    });
});

// Dedicated Vitals HTTP Endpoint
app.post('/api/vitals/update', (req, res) => {
    const payload    = normalisePayload(req.body);
    const device_uid = payload && (payload.device_uid || payload.id);
    if (!payload || !device_uid) return res.status(400).json({ error: 'Invalid payload: device identifier is required' });
    db.get(`SELECT * FROM devices WHERE (device_uid = ? OR name = ?) AND status = 'Active'`, [device_uid, device_uid], (err, row) => {
        if (err) return res.status(500).json({ error: 'DB Error' });
        if (!row) return res.status(401).json({ error: 'Validation Failed: Device not found or inactive' });
        console.log(`Validation Passed (Vitals HTTP): Device ${row.device_uid}`);
        const vitalsResult = processVitalsPayload(payload, row);
        return res.json({ success: true, message: 'Vitals logged successfully', data: vitalsResult });
    });
});

// Register a new device
app.post('/api/devices/register', (req, res) => {
    const { device_uid, name, type } = req.body;
    const identifier = (device_uid || name || '').trim();
    if (!identifier) return res.status(400).json({ error: 'Device identifier is required' });
    const deviceType = type || 'Car';
    db.run(`INSERT INTO devices (device_uid, name, type) VALUES (?, ?, ?)`, [identifier, identifier, deviceType], function(err) {
        if (err) {
            if (err.message && err.message.includes('UNIQUE constraint failed'))
                return res.status(400).json({ error: 'Device identifier already exists' });
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, id: this.lastID, device_uid: identifier, name: identifier, type: deviceType });
    });
});

// Get all devices with Online/Offline status
app.get('/api/devices', (req, res) => {
    db.all(`SELECT * FROM devices`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const now = new Date();
        const devices = rows.map(device => {
            let isOnline = false;
            if (device.last_seen) {
                const lastSeenDate = new Date(device.last_seen + 'Z');
                if ((now - lastSeenDate) / 1000 / 60 <= 2) isOnline = true;
            }
            return { ...device, isOnline };
        });
        res.json(devices);
    });
});

// Delete a device
app.delete('/api/devices/:uid', (req, res) => {
    db.run(`DELETE FROM devices WHERE device_uid = ?`, [req.params.uid], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, deletedCount: this.changes });
    });
});

// Update a device
app.put('/api/devices/:uid', (req, res) => {
    const uid = req.params.uid;
    const { name, type, device_uid } = req.body;
    const newUid  = (device_uid || uid).trim();
    const newName = (name || newUid).trim();
    const deviceType = type || 'Car';
    let query = `UPDATE devices SET name = ?, type = ?`;
    let params = [newName, deviceType];
    if (newUid !== uid) { query += `, device_uid = ?`; params.push(newUid); }
    query += ` WHERE device_uid = ?`;
    params.push(uid);
    db.run(query, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, updatedCount: this.changes, device_uid: newUid, name: newName, type: deviceType });
    });
});

// Historical telemetry logs for a device
app.get('/api/devices/:uid/logs', (req, res) => {
    db.all(`SELECT * FROM telemetry_logs WHERE device_uid = ? ORDER BY timestamp DESC`, [req.params.uid], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Chronological history with date filters
app.get('/api/devices/:uid/history', (req, res) => {
    const { uid } = req.params; const { start, end } = req.query;
    let query = `SELECT * FROM telemetry_logs WHERE device_uid = ?`;
    let params = [uid];
    if (start) { query += ` AND timestamp >= ?`; params.push(start); }
    if (end)   { query += ` AND timestamp <= ?`; params.push(end); }
    query += ` ORDER BY timestamp ASC`;
    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// All telemetry logs paginated (includes transport_mode + gps_status)
app.get('/api/logs/all', (req, res) => {
    const page   = parseInt(req.query.page)  || 1;
    const limit  = parseInt(req.query.limit) || 50;
    const uid    = req.query.device_uid;
    const offset = (page - 1) * limit;
    let where = ""; let params = [];
    if (uid && uid !== 'all') { where = "WHERE t.device_uid = ?"; params.push(uid); }
    db.get(`SELECT COUNT(*) as total FROM telemetry_logs t ${where}`, params, (err, countResult) => {
        if (err) return res.status(500).json({ error: err.message });
        const total = countResult ? countResult.total : 0;
        const dataQuery = `
            SELECT t.id, t.latitude, t.longitude, t.speed, t.battery_percentage,
                   t.transport_mode, t.gps_status, t.device_uid,
                   d.name as device_name, t.timestamp
            FROM telemetry_logs t
            LEFT JOIN devices d ON t.device_uid = d.device_uid
            ${where} ORDER BY t.timestamp DESC LIMIT ? OFFSET ?
        `;
        db.all(dataQuery, [...params, limit, offset], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ total, page, limit, totalPages: Math.ceil(total / limit), data: rows });
        });
    });
});

// All vitals logs paginated (includes new fields)
app.get('/api/logs/vitals', (req, res) => {
    const page   = parseInt(req.query.page)  || 1;
    const limit  = parseInt(req.query.limit) || 50;
    const uid    = req.query.device_uid;
    const offset = (page - 1) * limit;
    let where = ""; let params = [];
    if (uid && uid !== 'all') { where = "WHERE v.device_uid = ?"; params.push(uid); }
    db.get(`SELECT COUNT(*) as total FROM vitals_logs v ${where}`, params, (err, countResult) => {
        if (err) return res.status(500).json({ error: err.message });
        const total = countResult ? countResult.total : 0;
        const dataQuery = `
            SELECT v.id, v.device_uid, d.name as device_name,
                   v.heart_rate, v.blood_pressure, v.blood_pressure_sys, v.blood_pressure_dia,
                   v.spo2, v.step_count as steps,
                   v.transport_mode, v.gps_status, v.watch_status, v.watch_battery,
                   v.timestamp
            FROM vitals_logs v
            LEFT JOIN devices d ON v.device_uid = d.device_uid
            ${where} ORDER BY v.timestamp DESC LIMIT ? OFFSET ?
        `;
        db.all(dataQuery, [...params, limit, offset], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ total, page, limit, totalPages: Math.ceil(total / limit), data: rows });
        });
    });
});

// Latest vitals per device
app.get('/api/vitals/latest', (req, res) => {
    const uid = req.query.device_uid;
    const query = `
        SELECT v.id, v.device_uid, d.name as device_name, d.type as device_type,
               d.battery_percentage, d.transport_mode as device_transport_mode,
               d.gps_status as device_gps_status, d.watch_status as device_watch_status,
               d.watch_battery as device_watch_battery,
               v.heart_rate, v.blood_pressure, v.blood_pressure_sys, v.blood_pressure_dia,
               v.spo2, v.step_count as steps,
               v.transport_mode, v.gps_status, v.watch_status, v.watch_battery, v.timestamp
        FROM vitals_logs v
        LEFT JOIN devices d ON v.device_uid = d.device_uid
        ORDER BY v.timestamp DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const latestMap = new Map();
        for (const row of rows) { if (!latestMap.has(row.device_uid)) latestMap.set(row.device_uid, row); }
        if (uid && uid !== 'all') return res.json(latestMap.get(uid) || null);
        res.json(Array.from(latestMap.values()));
    });
});

// Historical vitals for a device
app.get('/api/devices/:uid/vitals', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    db.all(`SELECT * FROM vitals_logs WHERE device_uid = ? ORDER BY timestamp DESC LIMIT ?`, [req.params.uid, limit], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/status', (req, res) => res.send('GPS Backend Server is running.'));

io.on('connection', (socket) => {
    console.log('Frontend WebSocket client connected:', socket.id);
    socket.on('disconnect', () => console.log('Frontend WebSocket client disconnected:', socket.id));
});

httpServer.listen(HTTP_PORT, () => console.log(`HTTP/WebSocket Server running on port ${HTTP_PORT}`));

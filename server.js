const net = require('net');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const db = require('./db');
const auth = require('./auth');

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

// Strict transport mode validator: 0 = LoRa (Purple), 1 = GSM (Blue), 2 = Wi-Fi (Green)
// Rejects sentinels like -1, invalid numbers, undefined, or null
function parseTransportMode(val) {
    if (val === undefined || val === null || val === '') return null;
    if (typeof val === 'string') {
        const s = val.trim().toLowerCase();
        if (s === '0' || s === 'lora') return 0;
        if (s === '1' || s === 'gsm' || s === 'cellular') return 1;
        if (s === '2' || s === 'wifi' || s === 'wi-fi') return 2;
    }
    const num = Number(val);
    if (num === 0 || num === 1 || num === 2) return num;
    return null;
}

function normalizeDeviceType(type) {
    if (!type) return 'Person';
    const t = String(type).trim();
    if (t === 'Wearable' || t === 'Health Band' || t.toLowerCase().includes('wearable') || t.toLowerCase().includes('band')) {
        return 'Person';
    }
    return t;
}

function parseLastSeenDate(lastSeen) {
    if (!lastSeen) return null;
    if (lastSeen instanceof Date) return isNaN(lastSeen.getTime()) ? null : lastSeen;
    let str = String(lastSeen).trim();
    while (str.endsWith('ZZ')) str = str.slice(0, -1);
    if (!str.endsWith('Z') && !str.includes('+') && !str.match(/-\d{2}:\d{2}$/)) {
        str = str.replace(' ', 'T') + 'Z';
    }
    const d = new Date(str);
    if (isNaN(d.getTime())) {
        const fallback = new Date(lastSeen);
        return isNaN(fallback.getTime()) ? null : fallback;
    }
    return d;
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
        payload.heart_rate   !== undefined || payload.blood_pressure !== undefined ||
        payload.bp           !== undefined || payload.bp_sys         !== undefined ||
        payload.bp_dia       !== undefined || payload.spo2           !== undefined ||
        payload.steps        !== undefined || payload.step_count     !== undefined ||
        payload.watch_status !== undefined || payload.watch_battery  !== undefined
    );
    if (!hasVitals) return null;

    const heartRate = parseIntOrNull(payload.heart_rate);
    const spo2      = parseNumberOrNull(payload.spo2);
    const steps     = parseIntOrNull(payload.steps !== undefined ? payload.steps : payload.step_count);

    let bpSys = parseIntOrNull(payload.bp_sys);
    let bpDia = parseIntOrNull(payload.bp_dia);
    let bp    = null;

    if (payload.blood_pressure || payload.bp) {
        const rawBp = String(payload.blood_pressure || payload.bp).trim();
        if (rawBp === '-1' || rawBp === '-1/-1') {
            bp = null;
            bpSys = null;
            bpDia = null;
        } else {
            bp = rawBp;
            if (bpSys === null || bpDia === null) {
                const parts = bp.split('/');
                if (parts.length === 2) {
                    bpSys = parseIntOrNull(parts[0]);
                    bpDia = parseIntOrNull(parts[1]);
                }
            }
        }
    } else if (bpSys !== null && bpDia !== null) { bp = `${bpSys}/${bpDia}`; }
    else if (bpSys !== null)  { bp = `${bpSys}/—`; }
    else if (bpDia !== null)  { bp = `—/${bpDia}`; }

    const transport_mode = parseTransportMode(payload.transport_mode);
    const gps_status     = parseIntOrNull(payload.gps_status);
    const watch_status   = parseIntOrNull(payload.watch_status);
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
            watch_battery  = COALESCE(?, watch_battery),
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

    const tm = transport_mode === 0 ? 'LoRa (Purple)' : transport_mode === 1 ? 'GSM (Blue)' : transport_mode === 2 ? 'WiFi (Green)' : 'None';
    console.log(`[VITALS] ${name} via ${tm} | HR:${heartRate??'—'} BP:${bp??'—'} SpO2:${spo2??'—'} Steps:${steps??'—'} WBatt:${watch_battery??'—'}%`);
    return vitalsEvent;
}

// Shared GPS telemetry processing (TCP + HTTP share this)
function processGpsPayload(rawPayload, row, forceSave = false) {
    const payload = normalisePayload(rawPayload);
    const targetUid = row.device_uid;
    const rawLat = payload.latitude !== undefined ? payload.latitude : payload.lat;
    const rawLon = payload.longitude !== undefined ? payload.longitude : payload.lon;
    const hasCoordinates = (rawLat !== undefined && rawLon !== undefined && rawLat !== null && rawLon !== null && rawLat !== -1 && rawLon !== -1 && rawLat !== '-1' && rawLon !== '-1');
    if (!hasCoordinates) return;

    const latitude  = parseFloat(rawLat);
    const longitude = parseFloat(rawLon);
    const speedVal  = parseFloat(payload.speed || 0);

    const watch_status       = parseIntOrNull(payload.watch_status);
    const watch_battery      = parseNumberOrNull(payload.watch_battery !== undefined ? payload.watch_battery : payload.watch_battery_percent);
    const battery_percentage = watch_battery !== null ? Math.round(watch_battery) : (row.battery_percentage || null);

    const transport_mode = parseTransportMode(payload.transport_mode);
    const gps_status     = parseIntOrNull(payload.gps_status);

    const now = Date.now();
    let shouldSaveToDb = false;

    if (!deviceStateCache.has(targetUid) || forceSave) {
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
        battery: battery_percentage, watch_battery, watch_status,
        transport_mode, gps_status,
        type: normalizeDeviceType(row.type),
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
                battery_percentage = COALESCE(?, battery_percentage),
                last_lat = ?, last_lon = ?,
                watch_battery  = COALESCE(?, watch_battery),
                watch_status   = COALESCE(?, watch_status),
                transport_mode = COALESCE(?, transport_mode),
                gps_status     = COALESCE(?, gps_status)
            WHERE device_uid = ?
        `, [battery_percentage, latitude, longitude, watch_battery, watch_status, transport_mode, gps_status, targetUid], function(err) {
            if (err) console.error('Error updating device for telemetry:', err);
        });

        const tm = transport_mode === 0 ? 'LoRa (Purple)' : transport_mode === 1 ? 'GSM (Blue)' : transport_mode === 2 ? 'WiFi (Green)' : 'None';
        console.log(`[DB SAVE] ${targetUid} via ${tm} | GPS:${gps_status === 1 ? 'Locked' : 'NoSignal'} lat=${latitude} lon=${longitude} spd=${speedVal}`);
    } else {
        // Always touch last_seen and update watch/transport/gps if present so stationary active devices remain accurately Online and connected
        db.run(`
            UPDATE devices SET last_seen = CURRENT_TIMESTAMP,
                watch_battery  = COALESCE(?, watch_battery),
                watch_status   = COALESCE(?, watch_status),
                transport_mode = COALESCE(?, transport_mode),
                gps_status     = COALESCE(?, gps_status)
            WHERE device_uid = ?
        `, [watch_battery, watch_status, transport_mode, gps_status, targetUid], function(err) {
            if (err) console.error('Error touching last_seen for telemetry:', err);
        });
    }
}

// --- TCP Listener Server ---
const TCP_PORT = process.env.TCP_PORT || 5000;
const tcpServer = net.createServer((socket) => {
    console.log('TCP Client connected:', socket.remoteAddress, socket.remotePort);

    socket.on('data', (data) => {
        const rawText = data.toString();
        if (rawText.startsWith('HEAD ') || rawText.startsWith('GET ')) {
            socket.write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            socket.end(); return;
        }

        // Handle both single packets and newline-delimited multi-packet streams (e.g. 300 queued packets)
        const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        for (const line of lines) {
            let rawPayload;
            try { rawPayload = JSON.parse(line); }
            catch (e) { console.log('Invalid JSON packet in TCP stream.'); continue; }

            const payload    = normalisePayload(rawPayload);
            const device_uid = payload && (payload.device_uid || payload.id);

            if (payload && device_uid) {
                db.get(`SELECT * FROM devices WHERE (device_uid = ? OR name = ?) AND status = 'Active'`, [device_uid, device_uid], (err, row) => {
                    if (err) { console.error('DB Error:', err); return; }
                    if (!row) {
                        console.log(`Auto-registering TCP device on first transmission: ${device_uid}`);
                        db.run(`INSERT INTO devices (device_uid, name, type, status) VALUES (?, ?, 'Person', 'Active')`, [device_uid, device_uid], () => {});
                        row = { device_uid, name: device_uid, type: 'Person', status: 'Active', last_seen: null, last_lat: 13.0827, last_lon: 80.2707 };
                    }
                    console.log(`Validation Passed: Device ${row.device_uid} is valid.`);
                    processVitalsPayload(payload, row);
                    processGpsPayload(payload, row, lines.length > 1);
                    socket.write(`ACK,${row.device_uid}#\n`);
                });
            } else {
                console.log('Invalid payload: missing device identifier.');
            }
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
// Validate origin against allowed hosts (prevents ZAP "Cross-Domain Misconfiguration" Alert 10098)
function isOriginAllowed(origin) {
    if (!origin) return true; // Direct hardware/microcontroller requests, curl, mobile apps
    try {
        const parsed = new URL(origin);
        if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return true;
        if (parsed.hostname.endsWith('.onrender.com') || parsed.hostname === 'onrender.com') return true;
        if (process.env.ALLOWED_ORIGINS) {
            const list = process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim().toLowerCase());
            if (list.includes(origin.toLowerCase()) || list.includes(parsed.hostname.toLowerCase())) return true;
        }
    } catch {
        return false;
    }
    return false;
}

const io = new Server(httpServer, {
    cors: {
        origin: (origin, callback) => {
            if (isOriginAllowed(origin)) {
                return callback(null, origin || true);
            }
            return callback(null, false);
        },
        methods: ["GET", "POST"]
    }
});

app.disable('x-powered-by');
app.enable('trust proxy');

// --- Force HTTPS Redirection behind Reverse Proxies (Render / Cloudflare) ---
app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
        return res.redirect(301, `https://${req.headers.host || req.hostname}${req.originalUrl}`);
    }
    next();
});

// --- Security & Transport Encryption Middleware (OWASP CSP & HSTS) ---
// Explicitly defines directives that have no fallback (base-uri, form-action, frame-ancestors, object-src),
// prevents "Content Security Policy (CSP) Header Not Set" (OWASP 10038) and "Failure to Define Directive with No Fallback" (OWASP 10055),
// and enforces SSL/TLS transport encryption (HSTS + upgrade-insecure-requests).
const CSP_POLICY = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self' https://dashboard.render.com",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
    "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
    "img-src 'self' data: https://mt0.google.com https://mt1.google.com https://mt2.google.com https://mt3.google.com https://a.tile.openstreetmap.org https://b.tile.openstreetmap.org https://c.tile.openstreetmap.org https://a.tile.openstreetmap.fr https://b.tile.openstreetmap.fr https://c.tile.openstreetmap.fr https://server.arcgisonline.com https://troopcomfortslimited.co.in",
    "connect-src 'self' https://nominatim.openstreetmap.org",
    "upgrade-insecure-requests"
].join('; ');

app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP_POLICY);
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), microphone=(), camera=()');

    // OWASP Cache-Control Policy (CWE-525 / WSTG-ATHN-06)
    // Dynamic APIs, HTML documents, and root routes must not be cached by proxies or browsers
    if (req.path.startsWith('/api/') || req.path.endsWith('.html') || req.path === '/') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
});

// Global Security Response Interceptor (guarantees Socket.IO and proxy edge responses strictly include complete CSP with all no-fallback directives)
const origWriteHead = http.ServerResponse.prototype.writeHead;
http.ServerResponse.prototype.writeHead = function(statusCode, ...args) {
    if (!this.getHeader('X-Content-Type-Options')) this.setHeader('X-Content-Type-Options', 'nosniff');
    if (!this.getHeader('Strict-Transport-Security')) this.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    if (!this.getHeader('X-Frame-Options')) this.setHeader('X-Frame-Options', 'SAMEORIGIN');
    if (!this.getHeader('Referrer-Policy')) this.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Ensure all directives that have no fallback (base-uri, form-action, frame-ancestors) are strictly present
    const existingCsp = this.getHeader('Content-Security-Policy');
    if (!existingCsp || !existingCsp.includes('base-uri') || !existingCsp.includes('form-action')) {
        this.setHeader('Content-Security-Policy', CSP_POLICY);
    }

    if (!this.getHeader('Cache-Control')) {
        this.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        this.setHeader('Pragma', 'no-cache');
        this.setHeader('Expires', '0');
    }
    return origWriteHead.apply(this, [statusCode, ...args]);
};

// Route Guard: Protect authenticated views from unauthenticated direct navigation
const protectedPages = ['/dashboard.html', '/logs.html', '/vitals.html'];
app.use((req, res, next) => {
    if (protectedPages.includes(req.path)) {
        const session = auth.verifySessionFromRequest(req);
        if (!session) {
            return res.redirect('/index.html?error=unauthorized');
        }
    }
    next();
});

app.use(express.static('public', {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        } else {
            // Static assets (CSS, JS, Fonts, Images) safely cached with validation
            res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
        }
    }
}));
app.use(express.json({ limit: '10mb' }));

// ─────────────────────────────────────────────────────────────────────────────
// AUTHENTICATION & SECURITY ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

// 1. Asymmetric Public Key Retrieval for In-Flight Encryption
app.get('/api/auth/public-key', (req, res) => {
    res.json(auth.getPublicKeyInfo());
});

// 2. CAPTCHA Challenge Generation (SVG + Single-Use ID)
app.get('/api/auth/captcha', (req, res) => {
    const captcha = auth.createCaptcha();
    res.json({
        success: true,
        captchaId: captcha.captchaId,
        captchaSvg: captcha.svg
    });
});

// 3. Authenticated Login with RSA-OAEP + AES-256 Decryption, CAPTCHA, and Scrypt
app.post('/api/auth/login', (req, res) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

    if (auth.isIpRateLimited(clientIp)) {
        return res.status(429).json({
            success: false,
            error: 'Too many login attempts. Please wait 5 minutes and try again.',
            code: 'RATE_LIMITED'
        });
    }

    let payload;
    try {
        // Enforce hybrid RSA-OAEP + AES-256-GCM payload decryption with anti-replay validation
        payload = auth.decryptPayload(req.body);
    } catch (err) {
        console.warn(`[Auth Warning] Decryption validation failed from ${clientIp}: ${err.message}`);
        return res.status(400).json({
            success: false,
            error: err.message || 'Cryptographic payload validation failed.',
            code: 'ENCRYPTION_VALIDATION_FAILED'
        });
    }

    const { username, password, captchaId, captchaSolution } = payload;

    // A. Validate CAPTCHA
    const captchaResult = auth.verifyCaptcha(captchaId, captchaSolution);
    if (!captchaResult.valid) {
        return res.status(400).json({
            success: false,
            error: captchaResult.message,
            code: 'INVALID_CAPTCHA'
        });
    }

    // B. Validate credentials format
    if (!username || !password) {
        return res.status(400).json({
            success: false,
            error: 'Username and password are required.',
            code: 'MISSING_CREDENTIALS'
        });
    }

    // C. Check account lockout status
    const lockStatus = auth.isUserLocked(username);
    if (lockStatus.locked) {
        return res.status(423).json({
            success: false,
            error: `Account is temporarily locked due to repeated failed attempts. Please try again in ${lockStatus.remainingMinutes} minute(s).`,
            code: 'ACCOUNT_LOCKED'
        });
    }

    // D. Fetch user from database
    db.get('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [username.trim()], (err, user) => {
        if (err) {
            console.error('[Auth Error] Database error during login:', err);
            return res.status(500).json({ success: false, error: 'Internal authentication error.' });
        }

        if (!user) {
            auth.recordIpAttempt(clientIp, false);
            return res.status(401).json({
                success: false,
                error: 'Invalid username or password.',
                code: 'INVALID_CREDENTIALS'
            });
        }

        // E. Verify password hash using scrypt + salt with constant-time equality
        const isValid = auth.verifyPassword(password, user.password_hash, user.salt);
        if (!isValid) {
            auth.recordIpAttempt(clientIp, false);
            auth.recordUserFailedAttempt(user.username);
            const updatedLock = auth.isUserLocked(user.username);
            if (updatedLock.locked) {
                return res.status(423).json({
                    success: false,
                    error: `Too many failed attempts. Account locked for ${updatedLock.remainingMinutes} minutes.`,
                    code: 'ACCOUNT_LOCKED'
                });
            }
            return res.status(401).json({
                success: false,
                error: 'Invalid username or password.',
                code: 'INVALID_CREDENTIALS'
            });
        }

        // Authentication Success
        auth.recordIpAttempt(clientIp, true);
        auth.clearUserLockout(user.username);

        db.run('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

        const session = auth.createSession(user);

        // Set HttpOnly, SameSite=Strict security cookie
        const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
        const cookieFlags = [
            `auth_session=${encodeURIComponent(session.signedCookie)}`,
            'Path=/',
            'HttpOnly',
            'SameSite=Strict',
            `Max-Age=${24 * 3600}`
        ];
        if (isSecure) cookieFlags.push('Secure');
        res.setHeader('Set-Cookie', cookieFlags.join('; '));

        return res.json({
            success: true,
            message: 'Authentication successful.',
            token: session.signedCookie,
            user: {
                id: user.id,
                username: user.username,
                fullname: user.fullname,
                email: user.email,
                role: user.role
            }
        });
    });
});

// 4. User Registration (Supports Encrypted Payload + Scrypt Hashing)
app.post('/api/auth/register', (req, res) => {
    let payload = req.body;
    if (payload.encryptedKey && payload.iv && payload.ciphertext && payload.tag) {
        try {
            payload = auth.decryptPayload(payload);
        } catch (e) {
            return res.status(400).json({ success: false, error: 'Decryption failed: ' + e.message });
        }
    }

    const { fullname, email, role, userid, username, password } = payload;
    const finalUsername = (userid || username || '').trim();

    if (!finalUsername || finalUsername.length < 3) {
        return res.status(400).json({ success: false, error: 'User ID must be at least 3 characters long.' });
    }
    if (!password || password.length < 8) {
        return res.status(400).json({ success: false, error: 'Password must be at least 8 characters long.' });
    }

    db.get('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [finalUsername], (err, existing) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        if (existing) {
            return res.status(409).json({ success: false, error: 'User ID is already taken. Please choose another.' });
        }

        const { hash, salt } = auth.hashPassword(password);
        const finalRole = ['admin', 'manager', 'user'].includes(String(role).toLowerCase()) ? String(role).toLowerCase() : 'user';

        db.run(
            'INSERT INTO users (username, password_hash, salt, fullname, email, role) VALUES (?, ?, ?, ?, ?, ?)',
            [finalUsername, hash, salt, fullname || finalUsername, email || '', finalRole],
            function(insertErr) {
                if (insertErr) {
                    return res.status(500).json({ success: false, error: 'Database error during registration: ' + insertErr.message });
                }
                res.status(201).json({
                    success: true,
                    message: 'Account successfully registered. You may now log in.'
                });
            }
        );
    });
});

// 5. Current Session Verification
app.get('/api/auth/me', (req, res) => {
    const session = auth.verifySessionFromRequest(req);
    if (!session) {
        return res.json({ authenticated: false });
    }
    res.json({
        authenticated: true,
        user: {
            id: session.userId,
            username: session.username,
            fullname: session.fullname,
            email: session.email,
            role: session.role
        }
    });
});

// 6. Logout and Session Invalidation
app.all('/api/auth/logout', (req, res) => {
    auth.destroySessionFromRequest(req);
    res.setHeader('Set-Cookie', 'auth_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    if (req.method === 'GET' && !req.headers.accept?.includes('application/json')) {
        return res.redirect('/index.html');
    }
    res.json({ success: true, message: 'Logged out successfully.' });
});

// Hardware HTTP Tracker Endpoint (Unified GPS + Vitals) — Supports single packet, single-device batch, or multi-device gateway batch
app.post('/api/tracker/update', (req, res) => {
    const rawData = req.body;
    const isBatch = Array.isArray(rawData);
    const items = isBatch ? rawData : [rawData];
    if (!items || items.length === 0) return res.status(400).send('Invalid payload: body is empty');

    // Group incoming items by device identifier
    const deviceMap = new Map();
    for (const item of items) {
        const p = normalisePayload(item);
        const uid = p && (p.device_uid || p.id);
        if (!uid) continue;
        if (!deviceMap.has(uid)) deviceMap.set(uid, []);
        deviceMap.get(uid).push(p);
    }

    if (deviceMap.size === 0) return res.status(400).send('Invalid payload: device identifier is required');

    // Query active devices matching all unique identifiers in the batch
    const uniqueUids = Array.from(deviceMap.keys());
    const placeholders = uniqueUids.map(() => '?').join(',');
    db.all(`SELECT * FROM devices WHERE (device_uid IN (${placeholders}) OR name IN (${placeholders})) AND status = 'Active'`, [...uniqueUids, ...uniqueUids], (err, rows) => {
        if (err) return res.status(500).json({ error: 'DB Error' });

        const activeRowMap = new Map();
        if (rows) {
            for (const row of rows) {
                activeRowMap.set(row.device_uid, row);
                if (row.name) activeRowMap.set(row.name, row);
            }
        }

        // Auto-register any incoming devices not yet in the database so hardware data is never rejected
        for (const uid of uniqueUids) {
            if (!activeRowMap.has(uid)) {
                console.log(`Auto-registering device on first transmission: ${uid}`);
                db.run(`INSERT INTO devices (device_uid, name, type, status) VALUES (?, ?, 'Person', 'Active')`, [uid, uid], () => {});
                activeRowMap.set(uid, {
                    device_uid: uid,
                    name: uid,
                    type: 'Person',
                    status: 'Active',
                    last_seen: null,
                    last_lat: 13.0827,
                    last_lon: 80.2707
                });
            }
        }

        let processedCount = 0;
        const ackDevices = [];

        for (const [uid, packets] of deviceMap.entries()) {
            const row = activeRowMap.get(uid);
            if (!row) continue;
            ackDevices.push(row.device_uid);
            console.log(`Processing ${packets.length} packet(s) for Device ${row.device_uid}`);
            for (const packet of packets) {
                processVitalsPayload(packet, row);
                processGpsPayload(packet, row, isBatch);
                processedCount++;
            }
        }

        return res.send(`ACK,${ackDevices.join(',')}${isBatch ? `,COUNT:${processedCount}` : ''}#\n`);
    });
});

// Dedicated Vitals HTTP Endpoint — Supports single packet, single-device batch, or multi-device gateway batch
app.post('/api/vitals/update', (req, res) => {
    const rawData = req.body;
    const isBatch = Array.isArray(rawData);
    const items = isBatch ? rawData : [rawData];
    if (!items || items.length === 0) return res.status(400).json({ error: 'Invalid payload: body is empty' });

    // Group incoming items by device identifier
    const deviceMap = new Map();
    for (const item of items) {
        const p = normalisePayload(item);
        const uid = p && (p.device_uid || p.id);
        if (!uid) continue;
        if (!deviceMap.has(uid)) deviceMap.set(uid, []);
        deviceMap.get(uid).push(p);
    }

    if (deviceMap.size === 0) return res.status(400).json({ error: 'Invalid payload: device identifier is required' });

    const uniqueUids = Array.from(deviceMap.keys());
    const placeholders = uniqueUids.map(() => '?').join(',');
    db.all(`SELECT * FROM devices WHERE (device_uid IN (${placeholders}) OR name IN (${placeholders})) AND status = 'Active'`, [...uniqueUids, ...uniqueUids], (err, rows) => {
        if (err) return res.status(500).json({ error: 'DB Error' });

        const activeRowMap = new Map();
        if (rows) {
            for (const row of rows) {
                activeRowMap.set(row.device_uid, row);
                if (row.name) activeRowMap.set(row.name, row);
            }
        }

        // Auto-register any incoming devices not yet in the database
        for (const uid of uniqueUids) {
            if (!activeRowMap.has(uid)) {
                console.log(`Auto-registering vitals device on first transmission: ${uid}`);
                db.run(`INSERT INTO devices (device_uid, name, type, status) VALUES (?, ?, 'Person', 'Active')`, [uid, uid], () => {});
                activeRowMap.set(uid, {
                    device_uid: uid,
                    name: uid,
                    type: 'Person',
                    status: 'Active',
                    last_seen: null
                });
            }
        }

        let processedCount = 0;
        let lastResult = null;

        for (const [uid, packets] of deviceMap.entries()) {
            const row = activeRowMap.get(uid);
            if (!row) continue;
            console.log(`Processing ${packets.length} vitals packet(s) for Device ${row.device_uid}`);
            for (const packet of packets) {
                lastResult = processVitalsPayload(packet, row);
                processGpsPayload(packet, row, isBatch);
                processedCount++;
            }
        }

        return res.json({ success: true, count: processedCount, message: `${processedCount} vitals logged successfully`, data: lastResult });
    });
});

// Register a new device
app.post('/api/devices/register', (req, res) => {
    const { device_uid, name, type } = req.body;
    const identifier = (device_uid || name || '').trim();
    if (!identifier) return res.status(400).json({ error: 'Device identifier is required' });
    const deviceType = normalizeDeviceType(type);
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
        const now = Date.now();
        const devices = rows.map(device => {
            const type = normalizeDeviceType(device.type);
            const validTransport = parseTransportMode(device.transport_mode);
            const isWatchOrPerson = (type === 'Person' || device.watch_status !== null || device.watch_battery !== null);

            // Differentiated Online Threshold:
            // - Watches / Person (5-min reporting cycle): 6 minutes window
            // - GPS Trackers / Vehicles (Car, Bus, Bike): 2 minutes window
            const onlineWindowMs = isWatchOrPerson ? (6 * 60 * 1000) : (2 * 60 * 1000);

            let isOnline = false;
            if (device.last_seen) {
                const lastSeenDate = parseLastSeenDate(device.last_seen);
                if (lastSeenDate && (now - lastSeenDate.getTime()) <= onlineWindowMs) {
                    isOnline = true;
                }
            }
            return { ...device, type, isOnline, transport_mode: validTransport };
        });
        res.json(devices);
    });
});

// Delete a device
app.delete('/api/devices/:uid', (req, res) => {
    const uid = req.params.uid;
    db.run(`DELETE FROM devices WHERE device_uid = ?`, [uid], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        db.run(`DELETE FROM telemetry_logs WHERE device_uid = ?`, [uid], () => {});
        res.json({ success: true, deletedCount: this.changes });
    });
});

// Update a device
app.put('/api/devices/:uid', (req, res) => {
    const uid = req.params.uid;
    const { name, type, device_uid } = req.body;
    const newUid  = (device_uid || uid).trim();
    const newName = (name || newUid).trim();
    const deviceType = normalizeDeviceType(type);
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
    let query = `SELECT * FROM telemetry_logs WHERE device_uid = ? AND (latitude != 0 OR longitude != 0) AND latitude IS NOT NULL AND longitude IS NOT NULL`;
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

// 404 handler — preserves complete CSP directives & security headers across all unmapped routes
app.use((req, res) => {
    res.status(404).send('Not Found');
});

// Centralized error handler — ensures CSP and security headers remain present even on 500 exceptions
app.use((err, req, res, next) => {
    console.error('Unhandled Server Error:', err);
    res.status(500).send('Internal Server Error');
});

io.on('connection', (socket) => {
    console.log('Frontend WebSocket client connected:', socket.id);
    socket.on('disconnect', () => console.log('Frontend WebSocket client disconnected:', socket.id));
});

httpServer.listen(HTTP_PORT, () => console.log(`HTTP/WebSocket Server running on port ${HTTP_PORT}`));

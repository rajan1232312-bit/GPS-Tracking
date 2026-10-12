const { Pool } = require('pg');

// Use the DATABASE_URL environment variable provided by Render/Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
});

// Create tables automatically using PostgreSQL syntax
const initQuery = `
    CREATE TABLE IF NOT EXISTS devices (
        id SERIAL PRIMARY KEY,
        device_uid TEXT UNIQUE NOT NULL,
        name TEXT,
        type TEXT DEFAULT 'Car',
        status TEXT DEFAULT 'Active',
        last_seen TIMESTAMP,
        battery_percentage INTEGER,
        registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_lat REAL DEFAULT 13.0827,
        last_lon REAL DEFAULT 80.2707
    );

    CREATE TABLE IF NOT EXISTS telemetry_logs (
        id SERIAL PRIMARY KEY,
        device_uid TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        speed REAL NOT NULL,
        battery_percentage INTEGER,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(device_uid) REFERENCES devices(device_uid) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS vitals_logs (
        id SERIAL PRIMARY KEY,
        device_uid TEXT NOT NULL,
        heart_rate INTEGER,
        blood_pressure TEXT,
        blood_pressure_sys INTEGER,
        blood_pressure_dia INTEGER,
        spo2 REAL,
        step_count INTEGER DEFAULT 0,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(device_uid) REFERENCES devices(device_uid) ON DELETE CASCADE
    );
`;

if (process.env.DATABASE_URL) {
    pool.query(initQuery).then(() => {
        console.log('Connected to PostgreSQL and tables ensured (including vitals_logs).');
    }).catch(err => {
        console.error('Error initializing PostgreSQL tables:', err);
    });
} else {
    console.log('Notice: DATABASE_URL not set. Running with development in-memory SQLite emulator.');
}

// Helper to convert SQLite '?' placeholders to PostgreSQL '$1, $2' placeholders
const convertQuery = (query) => {
    let index = 1;
    return query.replace(/\?/g, () => `$${index++}`);
};

// In-memory store fallback for local development
const memoryStore = {
    devices: [
        { id: 1, device_uid: '8654020409', name: 'Delivery Van 1', type: 'Car', status: 'Active', last_seen: new Date().toISOString(), battery_percentage: 85, last_lat: 13.0827, last_lon: 80.2707 },
        { id: 2, device_uid: 'ID:001', name: 'Tracker-001', type: 'Health Band', status: 'Active', last_seen: new Date().toISOString(), battery_percentage: 95, last_lat: 13.1166, last_lon: 80.1000 },
        { id: 3, device_uid: 'HEALTH:8801', name: 'Smart Band Pro', type: 'Wearable', status: 'Active', last_seen: new Date().toISOString(), battery_percentage: 90, last_lat: 13.0850, last_lon: 80.2750 }
    ],
    telemetry_logs: [
        { id: 1, device_uid: '8654020409', latitude: 13.0827, longitude: 80.2707, speed: 35.5, battery_percentage: 85, timestamp: new Date().toISOString() }
    ],
    vitals_logs: [
        { id: 1, device_uid: 'HEALTH:8801', heart_rate: 76, blood_pressure: '120/80', blood_pressure_sys: 120, blood_pressure_dia: 80, spo2: 98.5, step_count: 5420, timestamp: new Date(Date.now() - 3600000).toISOString() },
        { id: 2, device_uid: 'ID:001', heart_rate: null, blood_pressure: '125/82', blood_pressure_sys: 125, blood_pressure_dia: 82, spo2: 99.0, step_count: 7850, timestamp: new Date(Date.now() - 1800000).toISOString() },
        { id: 3, device_uid: '8654020409', heart_rate: 72, blood_pressure: '118/78', blood_pressure_sys: 118, blood_pressure_dia: 78, spo2: 98.0, step_count: 3200, timestamp: new Date().toISOString() }
    ],
    nextId: 100
};

// Create a wrapper object that perfectly mimics the old 'sqlite3' library 
// so we don't have to change any code in server.js!
const db = {
    run: (query, params = [], callback) => {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }

        if (process.env.DATABASE_URL) {
            let pgQuery = convertQuery(query);
            if (pgQuery.trim().toUpperCase().startsWith('INSERT') && !pgQuery.toUpperCase().includes('RETURNING')) {
                pgQuery += ' RETURNING id';
            }
            
            pool.query(pgQuery, params, (err, result) => {
                if (callback) {
                    if (err && err.code === '23505') {
                        err.message = 'UNIQUE constraint failed';
                    }
                    const context = {
                        lastID: (result && result.rows && result.rows.length > 0) ? result.rows[0].id : null,
                        changes: (result) ? result.rowCount : 0
                    };
                    callback.call(context, err);
                }
            });
            return;
        }

        // --- In-Memory Fallback Implementation ---
        const cleanQuery = query.trim().toUpperCase();
        let context = { lastID: ++memoryStore.nextId, changes: 1 };

        if (cleanQuery.startsWith('INSERT INTO VITALS_LOGS')) {
            const [device_uid, heart_rate, bp, bp_sys, bp_dia, spo2, steps] = params;
            memoryStore.vitals_logs.unshift({
                id: context.lastID,
                device_uid,
                heart_rate: heart_rate ?? null,
                blood_pressure: bp ?? null,
                blood_pressure_sys: bp_sys ?? null,
                blood_pressure_dia: bp_dia ?? null,
                spo2: spo2 ?? null,
                step_count: steps ?? 0,
                timestamp: new Date().toISOString()
            });
        } else if (cleanQuery.startsWith('INSERT INTO TELEMETRY_LOGS')) {
            const [device_uid, latitude, longitude, speed, battery_percentage] = params;
            memoryStore.telemetry_logs.unshift({
                id: context.lastID,
                device_uid,
                latitude,
                longitude,
                speed,
                battery_percentage,
                timestamp: new Date().toISOString()
            });
        } else if (cleanQuery.startsWith('INSERT INTO DEVICES')) {
            const [device_uid, name, type] = params;
            const exists = memoryStore.devices.some(d => d.device_uid === device_uid);
            if (exists) {
                if (callback) return callback.call(context, new Error('UNIQUE constraint failed'));
                return;
            }
            memoryStore.devices.push({
                id: context.lastID,
                device_uid,
                name,
                type: type || 'Car',
                status: 'Active',
                last_seen: new Date().toISOString(),
                battery_percentage: 100,
                registered_at: new Date().toISOString(),
                last_lat: 13.0827,
                last_lon: 80.2707
            });
        } else if (cleanQuery.startsWith('UPDATE DEVICES')) {
            if (cleanQuery.includes('LAST_SEEN = CURRENT_TIMESTAMP')) {
                // UPDATE devices SET last_seen = CURRENT_TIMESTAMP, battery_percentage = ?, last_lat = ?, last_lon = ? WHERE device_uid = ?
                const uid = params[params.length - 1];
                const dev = memoryStore.devices.find(d => d.device_uid === uid);
                if (dev) {
                    dev.last_seen = new Date().toISOString();
                    if (params.length >= 4) {
                        dev.battery_percentage = params[0];
                        dev.last_lat = params[1];
                        dev.last_lon = params[2];
                    }
                }
            } else if (cleanQuery.includes('SET NAME =')) {
                const uid = params[params.length - 1];
                const dev = memoryStore.devices.find(d => d.device_uid === uid);
                if (dev) {
                    dev.name = params[0];
                    if (params.length > 2) dev.type = params[1];
                }
            }
        } else if (cleanQuery.startsWith('DELETE FROM DEVICES')) {
            const uid = params[0];
            memoryStore.devices = memoryStore.devices.filter(d => d.device_uid !== uid);
        }

        if (callback) callback.call(context, null);
    },
    get: (query, params = [], callback) => {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }

        if (process.env.DATABASE_URL) {
            pool.query(convertQuery(query), params, (err, result) => {
                if (callback) callback(err, (result && result.rows && result.rows.length > 0) ? result.rows[0] : null);
            });
            return;
        }

        // --- In-Memory Fallback Get ---
        const cleanQuery = query.trim().toUpperCase();
        let result = null;

        if (cleanQuery.includes('FROM DEVICES') && cleanQuery.includes('DEVICE_UID = ? AND NAME = ?')) {
            const [uid, name] = params;
            result = memoryStore.devices.find(d => d.device_uid === uid && d.name === name && d.status === 'Active') || null;
        } else if (cleanQuery.includes('COUNT(*)') && cleanQuery.includes('FROM TELEMETRY_LOGS')) {
            const uid = params[0];
            const logs = uid && uid !== 'all' ? memoryStore.telemetry_logs.filter(l => l.device_uid === uid) : memoryStore.telemetry_logs;
            result = { total: logs.length };
        } else if (cleanQuery.includes('COUNT(*)') && cleanQuery.includes('FROM VITALS_LOGS')) {
            const uid = params[0];
            const logs = uid && uid !== 'all' ? memoryStore.vitals_logs.filter(l => l.device_uid === uid) : memoryStore.vitals_logs;
            result = { total: logs.length };
        } else if (cleanQuery.includes('FROM DEVICES') && cleanQuery.includes('LIMIT 1')) {
            result = memoryStore.devices[0] || null;
        }

        if (callback) callback(null, result);
    },
    all: (query, params = [], callback) => {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }

        if (process.env.DATABASE_URL) {
            pool.query(convertQuery(query), params, (err, result) => {
                if (callback) callback(err, (result && result.rows) ? result.rows : []);
            });
            return;
        }

        // --- In-Memory Fallback All ---
        const cleanQuery = query.trim().toUpperCase();
        let rows = [];

        if (cleanQuery.includes('FROM DEVICES') && !cleanQuery.includes('WHERE')) {
            rows = [...memoryStore.devices];
        } else if (cleanQuery.includes('FROM TELEMETRY_LOGS') && cleanQuery.includes('ORDER BY T.TIMESTAMP DESC')) {
            const limit = params[params.length - 2] || 50;
            const offset = params[params.length - 1] || 0;
            const uid = params.length > 2 ? params[0] : null;

            let filtered = memoryStore.telemetry_logs;
            if (uid && uid !== 'all') filtered = filtered.filter(l => l.device_uid === uid);

            rows = filtered.slice(offset, offset + limit).map(l => {
                const dev = memoryStore.devices.find(d => d.device_uid === l.device_uid);
                return {
                    ...l,
                    device_name: dev ? dev.name : 'Unknown Device'
                };
            });
        } else if (cleanQuery.includes('FROM VITALS_LOGS') && cleanQuery.includes('ORDER BY')) {
            const limit = params[params.length - 2] || 50;
            const offset = params[params.length - 1] || 0;
            const uid = params.length > 2 ? params[0] : null;

            let filtered = memoryStore.vitals_logs;
            if (uid && uid !== 'all') filtered = filtered.filter(l => l.device_uid === uid);

            rows = filtered.slice(offset, offset + limit).map(v => {
                const dev = memoryStore.devices.find(d => d.device_uid === v.device_uid);
                return {
                    id: v.id,
                    device_uid: v.device_uid,
                    device_name: dev ? dev.name : 'Unknown Device',
                    heart_rate: v.heart_rate,
                    blood_pressure: v.blood_pressure,
                    blood_pressure_sys: v.blood_pressure_sys,
                    blood_pressure_dia: v.blood_pressure_dia,
                    spo2: v.spo2,
                    steps: v.step_count,
                    timestamp: v.timestamp
                };
            });
        } else if (cleanQuery.includes('FROM TELEMETRY_LOGS') && cleanQuery.includes('WHERE DEVICE_UID = ?')) {
            const uid = params[0];
            rows = memoryStore.telemetry_logs.filter(l => l.device_uid === uid);
        } else if (cleanQuery.includes('FROM VITALS_LOGS') && cleanQuery.includes('WHERE DEVICE_UID = ?')) {
            const uid = params[0];
            rows = memoryStore.vitals_logs.filter(l => l.device_uid === uid);
        } else if (cleanQuery.includes('FROM VITALS_LOGS')) {
            // Latest vitals across devices
            const devMap = new Map();
            for (const v of memoryStore.vitals_logs) {
                if (!devMap.has(v.device_uid)) {
                    const dev = memoryStore.devices.find(d => d.device_uid === v.device_uid);
                    devMap.set(v.device_uid, {
                        ...v,
                        steps: v.step_count,
                        device_name: dev ? dev.name : v.device_uid,
                        device_type: dev ? dev.type : 'Wearable'
                    });
                }
            }
            rows = Array.from(devMap.values());
        }

        if (callback) callback(null, rows);
    }
};

module.exports = db;

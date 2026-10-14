const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 30, // Up to 30 concurrent database workers for high-frequency burst processing (300 simultaneous packets in ~0.10s)
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 3000
});

pool.on('error', (err) => console.error('Unexpected error on idle client', err));

// Create tables with all new hardware fields
const initQuery = `
    CREATE TABLE IF NOT EXISTS devices (
        id SERIAL PRIMARY KEY,
        device_uid TEXT UNIQUE NOT NULL,
        name TEXT,
        type TEXT DEFAULT 'Car',
        status TEXT DEFAULT 'Active',
        last_seen TIMESTAMP,
        battery_percentage INTEGER,
        watch_battery REAL,
        transport_mode INTEGER,
        gps_status INTEGER,
        watch_status INTEGER,
        registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_lat REAL DEFAULT 13.0827,
        last_lon REAL DEFAULT 80.2707
    );

    CREATE TABLE IF NOT EXISTS telemetry_logs (
        id SERIAL PRIMARY KEY,
        device_uid TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        speed REAL NOT NULL DEFAULT 0,
        battery_percentage INTEGER,
        transport_mode INTEGER,
        gps_status INTEGER,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(device_uid) REFERENCES devices(device_uid) ON DELETE CASCADE ON UPDATE CASCADE
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
        transport_mode INTEGER,
        gps_status INTEGER,
        watch_status INTEGER,
        watch_battery REAL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(device_uid) REFERENCES devices(device_uid) ON DELETE CASCADE ON UPDATE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_telemetry_device_time ON telemetry_logs (device_uid, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_vitals_device_time ON vitals_logs (device_uid, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_devices_device_uid ON devices (device_uid);
    CREATE INDEX IF NOT EXISTS idx_devices_status ON devices (status);
`;

if (process.env.DATABASE_URL) {
    pool.query(initQuery).then(() => {
        console.log('Connected to PostgreSQL and tables ensured (including vitals_logs).');
        // Add new columns to existing tables if they don't already exist (migration)
        pool.query(`
            DO $$
            BEGIN
                -- devices table new columns
                BEGIN ALTER TABLE devices ADD COLUMN IF NOT EXISTS watch_battery REAL; EXCEPTION WHEN OTHERS THEN NULL; END;
                BEGIN ALTER TABLE devices ADD COLUMN IF NOT EXISTS transport_mode INTEGER; EXCEPTION WHEN OTHERS THEN NULL; END;
                BEGIN ALTER TABLE devices ADD COLUMN IF NOT EXISTS gps_status INTEGER; EXCEPTION WHEN OTHERS THEN NULL; END;
                BEGIN ALTER TABLE devices ADD COLUMN IF NOT EXISTS watch_status INTEGER; EXCEPTION WHEN OTHERS THEN NULL; END;

                -- telemetry_logs new columns (Gap 3 fix)
                BEGIN ALTER TABLE telemetry_logs ADD COLUMN IF NOT EXISTS transport_mode INTEGER; EXCEPTION WHEN OTHERS THEN NULL; END;
                BEGIN ALTER TABLE telemetry_logs ADD COLUMN IF NOT EXISTS gps_status INTEGER; EXCEPTION WHEN OTHERS THEN NULL; END;

                -- vitals_logs new columns
                BEGIN ALTER TABLE vitals_logs ADD COLUMN IF NOT EXISTS transport_mode INTEGER; EXCEPTION WHEN OTHERS THEN NULL; END;
                BEGIN ALTER TABLE vitals_logs ADD COLUMN IF NOT EXISTS gps_status INTEGER; EXCEPTION WHEN OTHERS THEN NULL; END;
                BEGIN ALTER TABLE vitals_logs ADD COLUMN IF NOT EXISTS watch_status INTEGER; EXCEPTION WHEN OTHERS THEN NULL; END;
                BEGIN ALTER TABLE vitals_logs ADD COLUMN IF NOT EXISTS watch_battery REAL; EXCEPTION WHEN OTHERS THEN NULL; END;

                -- Consolidate Wearable and Health Band categories into Person
                UPDATE devices SET type = 'Person' WHERE type IN ('Wearable', 'Health Band', 'healthband', 'wearable', 'Smartwatch') OR type ILIKE '%wearable%' OR type ILIKE '%health band%';

                -- Clear invalid, sentinel (-1), or unvalidated default transport modes (strictly 0=LoRa, 1=GSM, 2=Wi-Fi)
                UPDATE devices SET transport_mode = NULL WHERE transport_mode NOT IN (0, 1, 2) OR transport_mode = -1;
                UPDATE telemetry_logs SET transport_mode = NULL WHERE transport_mode NOT IN (0, 1, 2) OR transport_mode = -1;
                UPDATE vitals_logs SET transport_mode = NULL WHERE transport_mode NOT IN (0, 1, 2) OR transport_mode = -1;

                -- Ensure FK constraints with CASCADE
                ALTER TABLE telemetry_logs DROP CONSTRAINT IF EXISTS telemetry_logs_device_uid_fkey;
                ALTER TABLE telemetry_logs ADD CONSTRAINT telemetry_logs_device_uid_fkey
                    FOREIGN KEY (device_uid) REFERENCES devices(device_uid) ON DELETE CASCADE ON UPDATE CASCADE;

                ALTER TABLE vitals_logs DROP CONSTRAINT IF EXISTS vitals_logs_device_uid_fkey;
                ALTER TABLE vitals_logs ADD CONSTRAINT vitals_logs_device_uid_fkey
                    FOREIGN KEY (device_uid) REFERENCES devices(device_uid) ON DELETE CASCADE ON UPDATE CASCADE;
            EXCEPTION WHEN OTHERS THEN NULL;
            END $$;
        `).then(() => {
            // Ensure performance indexes exist on existing database instances
            return pool.query(`
                CREATE INDEX IF NOT EXISTS idx_telemetry_device_time ON telemetry_logs (device_uid, timestamp DESC);
                CREATE INDEX IF NOT EXISTS idx_vitals_device_time ON vitals_logs (device_uid, timestamp DESC);
                CREATE INDEX IF NOT EXISTS idx_devices_device_uid ON devices (device_uid);
                CREATE INDEX IF NOT EXISTS idx_devices_status ON devices (status);
            `);
        }).then(() => {
            console.log('PostgreSQL performance indexes verified (idx_telemetry_device_time, idx_vitals_device_time, idx_devices_device_uid, idx_devices_status).');
        }).catch(err => console.error('Migration / index notice:', err));
    }).catch(err => console.error('Error initializing PostgreSQL tables:', err));
} else {
    console.log('Notice: DATABASE_URL not set. Running with development in-memory SQLite emulator.');
}

// Helper: convert SQLite '?' placeholders to PostgreSQL '$1, $2'
const convertQuery = (query) => {
    let index = 1;
    return query.replace(/\?/g, () => `$${index++}`);
};

// In-memory store fallback for local development
const memoryStore = {
    devices: [
        { id: 1, device_uid: '8654020409', name: '8654020409', type: 'Car', status: 'Active',
          last_seen: null, battery_percentage: null, watch_battery: null, transport_mode: null, gps_status: null, watch_status: null,
          last_lat: 13.0827, last_lon: 80.2707 },
        { id: 2, device_uid: 'ID:001', name: 'ID:001', type: 'Person', status: 'Active',
          last_seen: null, battery_percentage: null, watch_battery: null, transport_mode: null, gps_status: null, watch_status: null,
          last_lat: 13.1166, last_lon: 80.1000 },
        { id: 3, device_uid: 'HEALTH:8801', name: 'HEALTH:8801', type: 'Person', status: 'Active',
          last_seen: null, battery_percentage: null, watch_battery: null, transport_mode: null, gps_status: null, watch_status: null,
          last_lat: 13.0850, last_lon: 80.2750 },
        { id: 4, device_uid: 'Node001', name: 'Node001', type: 'Person', status: 'Active',
          last_seen: null, battery_percentage: null, watch_battery: null, transport_mode: null, gps_status: null, watch_status: 0,
          last_lat: 13.0827, last_lon: 80.2707 },
        { id: 5, device_uid: 'DEVICE_001', name: 'DEVICE_001', type: 'Person', status: 'Active',
          last_seen: null, battery_percentage: null, watch_battery: null, transport_mode: null, gps_status: null, watch_status: null,
          last_lat: 13.124505, last_lon: 80.094435 }
    ],
    telemetry_logs: [],
    vitals_logs: [],
    nextId: 100
};

const db = {
    run: (query, params = [], callback) => {
        if (typeof params === 'function') { callback = params; params = []; }

        if (process.env.DATABASE_URL) {
            let pgQuery = convertQuery(query);
            if (pgQuery.trim().toUpperCase().startsWith('INSERT') && !pgQuery.toUpperCase().includes('RETURNING'))
                pgQuery += ' RETURNING id';
            pool.query(pgQuery, params, (err, result) => {
                if (callback) {
                    if (err && err.code === '23505') err.message = 'UNIQUE constraint failed';
                    const context = {
                        lastID: (result && result.rows && result.rows.length > 0) ? result.rows[0].id : null,
                        changes: result ? result.rowCount : 0
                    };
                    callback.call(context, err);
                }
            });
            return;
        }

        // In-Memory Fallback
        const cleanQuery = query.trim().toUpperCase();
        let context = { lastID: ++memoryStore.nextId, changes: 1 };

        if (cleanQuery.startsWith('INSERT INTO VITALS_LOGS')) {
            const [device_uid, heart_rate, bp, bp_sys, bp_dia, spo2, steps,
                   transport_mode, gps_status, watch_status, watch_battery] = params;
            memoryStore.vitals_logs.unshift({
                id: context.lastID, device_uid,
                heart_rate: heart_rate ?? null,
                blood_pressure: bp ?? null,
                blood_pressure_sys: bp_sys ?? null,
                blood_pressure_dia: bp_dia ?? null,
                spo2: spo2 ?? null,
                step_count: steps ?? 0,
                transport_mode: transport_mode ?? null,
                gps_status: gps_status ?? null,
                watch_status: watch_status ?? null,
                watch_battery: watch_battery ?? null,
                timestamp: new Date().toISOString()
            });
        } else if (cleanQuery.startsWith('INSERT INTO TELEMETRY_LOGS')) {
            const [device_uid, latitude, longitude, speed, battery_percentage, transport_mode, gps_status] = params;
            memoryStore.telemetry_logs.unshift({
                id: context.lastID, device_uid, latitude, longitude,
                speed: speed ?? 0, battery_percentage: battery_percentage ?? null,
                transport_mode: transport_mode ?? null, gps_status: gps_status ?? null,
                timestamp: new Date().toISOString()
            });
        } else if (cleanQuery.startsWith('INSERT INTO DEVICES')) {
            const [device_uid, name, type] = params;
            const exists = memoryStore.devices.some(d => d.device_uid === device_uid);
            if (exists) { if (callback) return callback.call(context, new Error('UNIQUE constraint failed')); return; }
            let normType = type || 'Person';
            if (normType === 'Wearable' || normType === 'Health Band' || normType.toLowerCase().includes('wearable') || normType.toLowerCase().includes('band')) {
                normType = 'Person';
            }
            memoryStore.devices.push({
                id: context.lastID, device_uid, name, type: normType,
                status: 'Active',
                last_seen: null, // Default offline until first telemetry or vitals data is received
                battery_percentage: null, watch_battery: null,
                transport_mode: null, gps_status: null, watch_status: null,
                registered_at: new Date().toISOString(), last_lat: 13.0827, last_lon: 80.2707
            });
        } else if (cleanQuery.startsWith('UPDATE DEVICES')) {
            const uid = params[params.length - 1];
            const dev = memoryStore.devices.find(d => d.device_uid === uid);
            if (dev) {
                if (cleanQuery.includes('LAST_SEEN = CURRENT_TIMESTAMP')) {
                    dev.last_seen = new Date().toISOString();
                    if (cleanQuery.includes('LAST_LAT =') || cleanQuery.includes('BATTERY_PERCENTAGE =')) {
                        // Telemetry UPDATE: [battery_percentage, lat, lon, watch_battery, watch_status, transport_mode, gps_status, targetUid]
                        dev.battery_percentage = params[0] ?? dev.battery_percentage;
                        dev.last_lat           = params[1] ?? dev.last_lat;
                        dev.last_lon           = params[2] ?? dev.last_lon;
                        dev.watch_battery      = params[3] ?? dev.watch_battery;
                        dev.watch_status       = params[4] ?? dev.watch_status;
                        dev.transport_mode     = params[5] ?? dev.transport_mode;
                        dev.gps_status         = params[6] ?? dev.gps_status;
                    } else if (cleanQuery.includes('WATCH_BATTERY =') && cleanQuery.includes('WATCH_STATUS =')) {
                        // Vitals UPDATE: [watch_battery, transport_mode, gps_status, watch_status, device_uid]
                        dev.watch_battery  = params[0] ?? dev.watch_battery;
                        dev.transport_mode = params[1] ?? dev.transport_mode;
                        dev.gps_status     = params[2] ?? dev.gps_status;
                        dev.watch_status   = params[3] ?? dev.watch_status;
                    } else if (cleanQuery.includes('TRANSPORT_MODE =')) {
                        // Stationary touch: [watch_battery, watch_status, transport_mode, gps_status, targetUid]
                        dev.watch_battery  = params[0] ?? dev.watch_battery;
                        dev.watch_status   = params[1] ?? dev.watch_status;
                        dev.transport_mode = params[2] ?? dev.transport_mode;
                        dev.gps_status     = params[3] ?? dev.gps_status;
                    }
                } else if (cleanQuery.includes('SET NAME =') || cleanQuery.includes('SET TYPE =')) {
                    dev.name = params[0] || dev.device_uid;
                    if (params.length > 2) dev.type = params[1];
                    else if (cleanQuery.includes('TYPE = ?')) dev.type = params[1] || params[0];
                }
            }
        } else if (cleanQuery.startsWith('DELETE FROM DEVICES')) {
            const uid = params[0];
            memoryStore.devices = memoryStore.devices.filter(d => d.device_uid !== uid);
        }

        if (callback) callback.call(context, null);
    },

    get: (query, params = [], callback) => {
        if (typeof params === 'function') { callback = params; params = []; }

        if (process.env.DATABASE_URL) {
            pool.query(convertQuery(query), params, (err, result) => {
                if (callback) callback(err, (result && result.rows && result.rows.length > 0) ? result.rows[0] : null);
            });
            return;
        }

        const cleanQuery = query.trim().toUpperCase();
        let result = null;

        if (cleanQuery.includes('FROM DEVICES') && (cleanQuery.includes('DEVICE_UID = ?') || cleanQuery.includes('NAME = ?'))) {
            const uid = params[0];
            result = memoryStore.devices.find(d => (d.device_uid === uid || d.name === uid) && d.status === 'Active') || null;
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
        if (typeof params === 'function') { callback = params; params = []; }

        if (process.env.DATABASE_URL) {
            pool.query(convertQuery(query), params, (err, result) => {
                if (callback) callback(err, (result && result.rows) ? result.rows : []);
            });
            return;
        }

        const cleanQuery = query.trim().toUpperCase();
        let rows = [];

        if (cleanQuery.includes('FROM DEVICES') && cleanQuery.includes('WHERE')) {
            rows = memoryStore.devices.filter(d => {
                if (cleanQuery.includes('STATUS =') && d.status !== 'Active') return false;
                if (cleanQuery.includes('IN (')) {
                    return params.includes(d.device_uid) || params.includes(d.name);
                }
                return params.includes(d.device_uid) || params.includes(d.name);
            });
        } else if (cleanQuery.includes('FROM DEVICES')) {
            rows = [...memoryStore.devices];
        } else if (cleanQuery.includes('FROM TELEMETRY_LOGS') && cleanQuery.includes('ORDER BY T.TIMESTAMP DESC')) {
            const limit  = params[params.length - 2] || 50;
            const offset = params[params.length - 1] || 0;
            const uid = params.length > 2 ? params[0] : null;
            let filtered = memoryStore.telemetry_logs;
            if (uid && uid !== 'all') filtered = filtered.filter(l => l.device_uid === uid);
            rows = filtered.slice(offset, offset + limit).map(l => {
                const dev = memoryStore.devices.find(d => d.device_uid === l.device_uid);
                return { ...l, device_name: dev ? dev.name : 'Unknown Device' };
            });
        } else if (cleanQuery.includes('FROM VITALS_LOGS') && cleanQuery.includes('ORDER BY V.TIMESTAMP DESC')) {
            const limit  = params[params.length - 2] || 50;
            const offset = params[params.length - 1] || 0;
            const uid = params.length > 2 ? params[0] : null;
            let filtered = memoryStore.vitals_logs;
            if (uid && uid !== 'all') filtered = filtered.filter(l => l.device_uid === uid);
            rows = filtered.slice(offset, offset + limit).map(v => {
                const dev = memoryStore.devices.find(d => d.device_uid === v.device_uid);
                return {
                    id: v.id, device_uid: v.device_uid,
                    device_name: dev ? dev.name : 'Unknown Device',
                    heart_rate: v.heart_rate, blood_pressure: v.blood_pressure,
                    blood_pressure_sys: v.blood_pressure_sys, blood_pressure_dia: v.blood_pressure_dia,
                    spo2: v.spo2, steps: v.step_count,
                    transport_mode: v.transport_mode, gps_status: v.gps_status,
                    watch_status: v.watch_status, watch_battery: v.watch_battery,
                    timestamp: v.timestamp
                };
            });
        } else if (cleanQuery.includes('FROM TELEMETRY_LOGS') && cleanQuery.includes('WHERE DEVICE_UID = ?')) {
            rows = memoryStore.telemetry_logs.filter(l => l.device_uid === params[0]);
        } else if (cleanQuery.includes('FROM VITALS_LOGS') && cleanQuery.includes('WHERE DEVICE_UID = ?')) {
            rows = memoryStore.vitals_logs.filter(l => l.device_uid === params[0]);
        } else if (cleanQuery.includes('FROM VITALS_LOGS')) {
            // Latest vitals query (no WHERE clause)
            const devMap = new Map();
            for (const v of memoryStore.vitals_logs) {
                if (!devMap.has(v.device_uid)) {
                    const dev = memoryStore.devices.find(d => d.device_uid === v.device_uid);
                    devMap.set(v.device_uid, {
                        ...v,
                        steps: v.step_count,
                        device_name: dev ? dev.name : v.device_uid,
                        device_type: dev ? (dev.type === 'Wearable' || dev.type === 'Health Band' ? 'Person' : dev.type) : 'Person',
                        device_transport_mode: dev ? dev.transport_mode : null,
                        device_gps_status: dev ? dev.gps_status : null,
                        device_watch_status: dev ? dev.watch_status : null,
                        device_watch_battery: dev ? dev.watch_battery : null
                    });
                }
            }
            rows = Array.from(devMap.values());
        }

        if (callback) callback(null, rows);
    }
};

module.exports = db;

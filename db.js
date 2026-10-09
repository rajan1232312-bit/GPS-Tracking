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
pool.query(`
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
`).then(() => {
    console.log('Connected to PostgreSQL and tables ensured.');
}).catch(err => {
    console.error('Error initializing PostgreSQL tables:', err);
});

// Helper to convert SQLite '?' placeholders to PostgreSQL '$1, $2' placeholders
const convertQuery = (query) => {
    let index = 1;
    return query.replace(/\?/g, () => `$${index++}`);
};

// Create a wrapper object that perfectly mimics the old 'sqlite3' library 
// so we don't have to change any code in server.js!
const db = {
    run: (query, params = [], callback) => {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        let pgQuery = convertQuery(query);
        // Automatically append RETURNING id for INSERT statements to mimic this.lastID
        if (pgQuery.trim().toUpperCase().startsWith('INSERT') && !pgQuery.toUpperCase().includes('RETURNING')) {
            pgQuery += ' RETURNING id';
        }
        
        pool.query(pgQuery, params, (err, result) => {
            if (callback) {
                // Map Postgres unique constraint error (23505) to SQLite error message
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
    },
    get: (query, params = [], callback) => {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        pool.query(convertQuery(query), params, (err, result) => {
            if (callback) callback(err, (result && result.rows && result.rows.length > 0) ? result.rows[0] : null);
        });
    },
    all: (query, params = [], callback) => {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        pool.query(convertQuery(query), params, (err, result) => {
            if (callback) callback(err, (result && result.rows) ? result.rows : []);
        });
    }
};

module.exports = db;

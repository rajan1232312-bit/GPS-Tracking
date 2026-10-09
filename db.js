const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'gps_backend.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err);
    } else {
        console.log('Connected to the SQLite database.');
        
        db.serialize(() => {
            // Create devices table
            db.run(`
                CREATE TABLE IF NOT EXISTS devices (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    device_uid TEXT UNIQUE NOT NULL,
                    name TEXT,
                    type TEXT DEFAULT 'Car',
                    status TEXT DEFAULT 'Active',
                    last_seen DATETIME,
                    battery_percentage INTEGER,
                    registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_lat REAL DEFAULT 13.0827,
                    last_lon REAL DEFAULT 80.2707
                )
            `);

            // Create telemetry_logs table
            db.run(`
                CREATE TABLE IF NOT EXISTS telemetry_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    device_uid TEXT NOT NULL,
                    latitude REAL NOT NULL,
                    longitude REAL NOT NULL,
                    speed REAL NOT NULL,
                    battery_percentage INTEGER,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(device_uid) REFERENCES devices(device_uid)
                )
            `);


        });
    }
});

module.exports = db;

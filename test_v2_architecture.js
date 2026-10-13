const http = require('http');
const net = require('net');

// 1. First register DEVICE_001 if not already registered
function registerDevice() {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ device_uid: 'DEVICE_001', type: 'Person' });
        const req = http.request({
            hostname: '127.0.0.1',
            port: 5001,
            path: '/api/devices/register',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                console.log('Registration response:', res.statusCode, body);
                resolve();
            });
        });
        req.on('error', err => {
            console.log('Registration error (may already exist):', err.message);
            resolve();
        });
        req.write(data);
        req.end();
    });
}

// 2. Test HTTP Tracker POST (User's Exact Payload)
function testHttpUpdate() {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            device_id: "DEVICE_001",
            transport_mode: 0,
            gps_status: 1,
            latitude: 13.124505,
            longitude: 80.094435,
            watch_status: 1,
            watch_battery: 50.0,
            hr: 86,
            spo2: 98,
            bp_sys: 125,
            bp_dia: 68,
            steps: 7300
        });

        console.log('\n[TEST 1] Sending User Payload via HTTP POST /api/tracker/update...');
        const req = http.request({
            hostname: '127.0.0.1',
            port: 5001,
            path: '/api/tracker/update',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                console.log('HTTP Response Status:', res.statusCode);
                console.log('HTTP Server ACK:', body.trim());
                resolve();
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

// 3. Test Raw TCP Socket on Port 5000 (LoRa/GSM Emulation) with -1 sentinels
function testTcpSocket() {
    return new Promise((resolve, reject) => {
        console.log('\n[TEST 2] Connecting to Raw TCP Socket on Port 5000...');
        const client = new net.Socket();
        client.connect(5000, '127.0.0.1', () => {
            console.log('Connected to TCP Port 5000.');
            const tcpPayload = JSON.stringify({
                device_id: "DEVICE_001",
                transport_mode: 1,
                gps_status: 0,
                latitude: -1,
                longitude: -1,
                speed: 0,
                watch_status: 0,
                watch_battery: -1,
                hr: -1,
                spo2: -1,
                bp_sys: -1,
                bp_dia: -1,
                steps: -1
            });
            console.log('Sending Sentinel (-1) Packet via TCP:', tcpPayload);
            client.write(tcpPayload + '\n');
        });

        client.on('data', (data) => {
            console.log('TCP Server Response:', data.toString().trim());
            client.destroy();
            resolve();
        });

        client.on('error', (err) => {
            console.error('TCP Error:', err.message);
            reject(err);
        });
    });
}

// 4. Verify Database Records via APIs
function verifyApis() {
    return new Promise((resolve, reject) => {
        console.log('\n[TEST 3] Verifying /api/vitals/latest for DEVICE_001...');
        http.get('http://127.0.0.1:5001/api/vitals/latest?device_uid=DEVICE_001', (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                console.log('Latest Vitals Output:', JSON.parse(body));
                resolve();
            });
        }).on('error', reject);
    });
}

async function run() {
    await registerDevice();
    await testHttpUpdate();
    await testTcpSocket();
    await verifyApis();
    console.log('\n✅ All Tests Completed Successfully!');
    process.exit(0);
}

run().catch(console.error);

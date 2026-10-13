const http = require('http');

// Helper to make HTTP JSON requests
function request(method, path, data) {
    return new Promise((resolve, reject) => {
        const bodyStr = data ? JSON.stringify(data) : '';
        const req = http.request({
            hostname: '127.0.0.1',
            port: process.env.PORT || 5001,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyStr)
            }
        }, (res) => {
            let resData = '';
            res.on('data', chunk => resData += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(resData);
                    resolve({ status: res.statusCode, data: parsed });
                } catch {
                    resolve({ status: res.statusCode, raw: resData });
                }
            });
        });
        req.on('error', reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

async function runTests() {
    console.log('--- 1. Testing Device Registration without name ---');
    const testUid = 'TEST_NODE_' + Date.now();
    const regRes = await request('POST', '/api/devices/register', {
        device_uid: testUid,
        type: 'Wearable'
    });
    console.log('Registration Status:', regRes.status, 'Response:', regRes.data);
    if (regRes.status !== 200 || regRes.data.device_uid !== testUid || regRes.data.type !== 'Person') {
        throw new Error('Registration failed or type was not normalized to Person!');
    }
    console.log('✓ Successfully registered device without specifying name, type normalized to Person!');

    console.log('\n--- 2. Testing Device Edit / Update without name ---');
    const updateRes = await request('PUT', `/api/devices/${testUid}`, {
        type: 'Health Band'
    });
    console.log('Update Status:', updateRes.status, 'Response:', updateRes.data);
    if (updateRes.status !== 200 || updateRes.data.type !== 'Person') {
        throw new Error('Update failed or Health Band was not normalized to Person!');
    }
    console.log('✓ Successfully updated device type without requiring name, type normalized to Person!');

    console.log('\n--- 3. Testing Device List ---');
    const listRes = await request('GET', '/api/devices');
    const found = listRes.data.find(d => d.device_uid === testUid);
    console.log('Found updated device:', found);
    if (!found || found.type !== 'Person' || found.name !== testUid) {
        throw new Error('Device list did not reflect changes or normalized Person type!');
    }
    console.log('✓ Identifier correctly acts as name and category is Person!');

    console.log('\n--- 4. Testing Telemetry Ingestion (No name in payload) ---');
    const telemetryRes = await request('POST', '/api/tracker/update', {
        device_uid: testUid,
        lat: 13.0827,
        lon: 80.2707,
        speed: 25.0,
        battery: 90
    });
    console.log('Telemetry Response Status:', telemetryRes.status, 'Raw:', telemetryRes.raw);
    if (telemetryRes.status !== 200) {
        throw new Error('Telemetry update failed!');
    }
    console.log('✓ Telemetry accepted without name!');

    console.log('\n--- 5. Testing Vitals Ingestion (No name in payload) ---');
    const vitalsRes = await request('POST', '/api/vitals/update', {
        device_uid: testUid,
        heart_rate: 75,
        blood_pressure: '120/80',
        spo2: 99.0,
        steps: 5000
    });
    console.log('Vitals Response Status:', vitalsRes.status, 'Response:', vitalsRes.data);
    if (vitalsRes.status !== 200 || !vitalsRes.data.success) {
        throw new Error('Vitals update failed!');
    }
    console.log('✓ Vitals accepted without name!');

    console.log('\n--- 6. Clean up: Delete test device ---');
    const delRes = await request('DELETE', `/api/devices/${testUid}`);
    console.log('Delete status:', delRes.status);

    console.log('\nALL TESTS PASSED SUCCESSFULLY! 🎉');
    process.exit(0);
}

runTests().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});

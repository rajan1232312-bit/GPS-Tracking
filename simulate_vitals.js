const net = require('net');

const TCP_PORT = process.env.TCP_PORT || 5000;
const HOST = '127.0.0.1';

// Test scenarios for active devices
const testPackets = [
    {
        scenario: "Full Health Vitals from !dc98ca55",
        payload: {
            device_uid: "!dc98ca55",
            battery: 84,
            heart_rate: 78,
            blood_pressure: "122/82",
            spo2: 98.8,
            steps: 4210
        }
    },
    {
        scenario: "Combined GPS + Vitals from DEVICE_001",
        payload: {
            device_uid: "DEVICE_001",
            lat: 13.1245,
            lon: 80.0944,
            speed: 15.0,
            battery: 50,
            heart_rate: 76,
            blood_pressure: "120/80",
            spo2: 98.5,
            steps: 4520
        }
    },
    {
        scenario: "Partial Vitals: Heart Rate is NOT received (omitted)",
        payload: {
            device_uid: "!dc98ca3a",
            battery: 52,
            blood_pressure: "126/82",
            spo2: 99.0,
            steps: 7100
        }
    },
    {
        scenario: "Partial Vitals: BP and SpO2 received, Heart Rate is null, Steps received",
        payload: {
            device_uid: "!dc98ca55",
            battery: 79,
            heart_rate: null,
            blood_pressure: "118/76",
            spo2: 97.8,
            steps: 8940
        }
    }
];

let index = 0;
const client = new net.Socket();

console.log(`Connecting to TCP Server at ${HOST}:${TCP_PORT}...`);

client.connect(TCP_PORT, HOST, () => {
    console.log('Connected to GPS & Vitals TCP Server successfully!');
    
    function sendNext() {
        if (index >= testPackets.length) {
            console.log('\nAll test packets transmitted successfully.');
            setTimeout(() => {
                client.destroy();
                process.exit(0);
            }, 1000);
            return;
        }

        const test = testPackets[index];
        console.log(`\n[Sending Scenario ${index + 1}/${testPackets.length}]: ${test.scenario}`);
        console.log('Payload:', JSON.stringify(test.payload));
        client.write(JSON.stringify(test.payload) + '\n');
        index++;
        setTimeout(sendNext, 2000);
    }

    sendNext();
});

client.on('data', (data) => {
    console.log('-> Server Response:', data.toString().trim());
});

client.on('error', (err) => {
    console.error('Socket error:', err.message);
    process.exit(1);
});

client.on('close', () => {
    console.log('TCP Connection closed.');
});

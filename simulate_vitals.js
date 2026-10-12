const net = require('net');

const TCP_PORT = process.env.TCP_PORT || 5000;
const HOST = '127.0.0.1';

// Test scenarios
const testPackets = [
    {
        scenario: "Full Health Vitals (All metrics present)",
        payload: {
            device_uid: "8654020409",
            name: "Delivery Van 1",
            lat: 13.0827,
            lon: 80.2707,
            speed: 15.0,
            battery: 88,
            heart_rate: 76,
            blood_pressure: "120/80",
            spo2: 98.5,
            steps: 4520
        }
    },
    {
        scenario: "Partial Vitals: Heart Rate is NOT received (omitted)",
        payload: {
            device_uid: "ID:001",
            name: "Tracker-001",
            battery: 92,
            blood_pressure: "126/82",
            spo2: 99.0,
            steps: 7100
            // heart_rate is intentionally NOT provided
        }
    },
    {
        scenario: "Partial Vitals: BP and SpO2 received, Heart Rate is null, Steps received",
        payload: {
            device_uid: "HEALTH:8801",
            name: "Smart Band Pro",
            battery: 79,
            heart_rate: null,
            blood_pressure: "118/76",
            spo2: 97.8,
            steps: 8940
        }
    },
    {
        scenario: "Full Vitals from Health Band with higher pulse",
        payload: {
            device_uid: "8654020409",
            name: "Delivery Van 1",
            battery: 87,
            heart_rate: 82,
            blood_pressure: "122/80",
            spo2: 98.0,
            steps: 5120
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

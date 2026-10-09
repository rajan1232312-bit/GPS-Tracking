const net = require('net');

const TCP_PORT = 5000;
const HOST = '127.0.0.1';

// Avadi coordinates
const startLat = 13.1166;
const startLon = 80.1000;
// Pattabiram coordinates
const endLat = 13.1232;
const endLon = 80.0592;

const STEPS = 30; // 30 steps for a smooth trip
let currentStep = 0;

const client = new net.Socket();

client.connect(TCP_PORT, HOST, () => {
    console.log('Connected to GPS Backend TCP Server.');
    console.log('Starting simulated trip from Avadi to Pattabiram...');
    
    const interval = setInterval(() => {
        if (currentStep > STEPS) {
            clearInterval(interval);
            client.destroy();
            console.log('Simulation complete. Reached Pattabiram.');
            return;
        }

        const progress = currentStep / STEPS;
        const currentLat = startLat + (endLat - startLat) * progress;
        const currentLon = startLon + (endLon - startLon) * progress;

        const payload = {
            device_uid: "ID:001",
            name: "Tracker-001",
            lat: currentLat,
            lon: currentLon,
            speed: 40 + Math.random() * 10,
            battery: 95
        };

        client.write(JSON.stringify(payload) + '\n');
        console.log(`[Step ${currentStep}/${STEPS}] Sent coordinates: ${currentLat.toFixed(5)}, ${currentLon.toFixed(5)}`);

        currentStep++;
    }, 2000); // send data every 2 seconds
});

client.on('data', (data) => {
    console.log('Received ACK:', data.toString().trim());
});

client.on('close', () => {
    console.log('Connection closed');
});

client.on('error', (err) => {
    console.error('Connection error:', err.message);
});

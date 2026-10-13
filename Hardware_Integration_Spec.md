# 📡 GPS & Vitals Hardware Integration Specification

**1. Connection Protocols**
*   **Raw TCP Socket:** Target Port `5000` (e.g. `192.168.1.213:5000`)
*   **HTTP REST Endpoints:** 
    *   GPS + Vitals: `POST /api/tracker/update`
    *   Vitals Only: `POST /api/vitals/update`

**2. Payload Format**
The tracker/node must send data as a **compact JSON string** over TCP or HTTP.

**3. Required JSON Structure**
To keep packet payloads minimal for microcontrollers (ESP32, GSM/GPRS modules, smart bands), only the device identifier (`device_uid`) is required. The `name` field has been **completely removed from the payload and system**, and the `device_uid` (identifier) acts directly as the device's name.

*The identifier does not need to be digits; it can be any string identifier, such as `"Node001"` or an IMEI.*

| Field | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `device_uid` | String | The hardware identifier (or node name). **Required**. | `"Node001"` / `"8654020409"` |
| `lat` | Float/Number | Latitude coordinates (Optional if sending vitals only). | `13.0827` |
| `lon` | Float/Number | Longitude coordinates (Optional if sending vitals only). | `80.2707` |
| `speed` | Float/Number | Current speed in km/h. | `45.5` |
| `battery` | Integer | Battery percentage (0-100). | `85` |
| `heart_rate` | Integer | Pulse / Heart Rate in BPM (Omit or null if not measured). | `76` |
| `blood_pressure` | String | Systolic / Diastolic BP string (e.g., "120/80"). | `"120/80"` |
| `bp_sys` | Integer | Systolic Blood Pressure in mmHg. | `120` |
| `bp_dia` | Integer | Diastolic Blood Pressure in mmHg. | `80` |
| `spo2` | Float/Number | Blood oxygen saturation percentage (50-100). | `98.5` |
| `steps` | Integer | Daily cumulative steps count. | `5420` |

**4. Example Payloads (Shortened & Optimized)**

* **A. Vitals Only Payload (Wearable / Node001):**
```json
{
  "device_uid": "Node001",
  "battery": 92,
  "heart_rate": 74,
  "blood_pressure": "118/76",
  "spo2": 99.0,
  "steps": 6250
}
```

* **B. Combined GPS + Vitals Payload:**
```json
{
  "device_uid": "8654020409",
  "lat": 13.0827,
  "lon": 80.2707,
  "speed": 45.5,
  "battery": 85,
  "heart_rate": 76,
  "blood_pressure": "120/80",
  "spo2": 98.5,
  "steps": 4520
}
```

* **C. Partial Vitals (e.g. Heart Rate sensor unmeasured/omitted):**
```json
{
  "device_uid": "Node001",
  "blood_pressure": "125/82",
  "spo2": 98.0,
  "steps": 3400
}
```
*(Notice: Any metric omitted from the payload is stored as null and presented cleanly as an empty dash `—` in logs and the dashboard.)*

**5. Validation & Device Matching**
The server validates incoming packets against active devices in the database matching `device_uid`. If an active registered device is found, the data is accepted and the identifier directly represents the device in WebSockets and UI logs.

**6. Server Acknowledgment**
Upon successful validation, the server replies over TCP or HTTP:
`ACK,[device_uid]#\n` *(Example: `ACK,Node001#\n`)*



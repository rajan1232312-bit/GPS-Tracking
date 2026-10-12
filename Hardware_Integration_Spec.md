# 📡 GPS Tracker Hardware Integration Specification

**1. Connection Protocol**
*   **Protocol:** Raw TCP Socket
*   **Target Port:** `5000`
*   **Target IP:** `192.168.1.213`

**2. Payload Format**
The tracker must send data as a **raw JSON string** over the TCP connection. 

**3. Required JSON Structure**
Every packet sent to the server **must** contain the following fields:

| Field | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `device_uid` | String | The unique hardware identifier (IMEI/ID). **Required**. | `"8654020409"` |
| `name` | String | The registered alias/name of the tracker. **Required**. | `"Delivery Van 1"` |
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

**4. Example Payloads**

* **A. Combined GPS + Vitals Payload:**
```json
{
  "device_uid": "8654020409",
  "name": "Delivery Van 1",
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

* **B. Vitals Only Payload (Wearables & Smart Bands):**
```json
{
  "device_uid": "HEALTH:8801",
  "name": "Smart Band Pro",
  "battery": 92,
  "heart_rate": 74,
  "blood_pressure": "118/76",
  "spo2": 99.0,
  "steps": 6250
}
```

* **C. Partial Vitals (e.g. Heart Rate sensor off/unmeasured):**
```json
{
  "device_uid": "ID:001",
  "name": "Tracker-001",
  "blood_pressure": "125/82",
  "spo2": 98.0,
  "steps": 3400
}
```
*(Notice: Any metric omitted from the payload will be safely stored as null and presented as an empty dash in the frontend logs and dashboard.)*

**5. Security & Validation Rules (CRITICAL)**
The backend employs a strict security validation process. When the server receives a packet, it checks the database for an active device matching **BOTH** the `device_uid` AND the `name`.
*   If both match exactly: The data is accepted and logged.
*   If there is a mismatch (e.g., the UID is correct but the name is wrong): The server will **reject and drop the payload completely** to prevent unauthorized data spoofing.

**6. Server Acknowledgment**
Upon successfully validating and saving the JSON payload, the server will reply to the tracker over the TCP socket with an acknowledgment string in the following format:
`ACK,[device_uid]#\n` *(Example: `ACK,8654020409#\n`)*


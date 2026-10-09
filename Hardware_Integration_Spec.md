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
| `device_uid` | String | The unique hardware identifier (IMEI/ID). | `"8654020409"` |
| `name` | String | The registered alias/name of the tracker. | `"Delivery Van 1"` |
| `lat` | Float/Number | Latitude coordinates. | `13.0827` |
| `lon` | Float/Number | Longitude coordinates. | `80.2707` |
| `speed` | Float/Number | Current speed of the vehicle in km/h. | `45.5` |
| `battery` | Integer | Current battery percentage (0-100). | `85` |

**4. Example Payload**
```json
{
  "device_uid": "8654020409",
  "name": "Delivery Van 1",
  "lat": 13.0827,
  "lon": 80.2707,
  "speed": 45.5,
  "battery": 85
}
```

**5. Security & Validation Rules (CRITICAL)**
The backend employs a strict security validation process. When the server receives a packet, it checks the database for an active device matching **BOTH** the `device_uid` AND the `name`.
*   If both match exactly: The data is accepted and logged.
*   If there is a mismatch (e.g., the UID is correct but the name is wrong): The server will **reject and drop the payload completely** to prevent unauthorized data spoofing.

**6. Server Acknowledgment**
Upon successfully validating and saving the JSON payload, the server will reply to the tracker over the TCP socket with an acknowledgment string in the following format:
`ACK,[device_uid]#\n` *(Example: `ACK,8654020409#\n`)*

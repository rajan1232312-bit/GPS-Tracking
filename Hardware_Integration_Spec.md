# 📡 GPS & Vitals Hardware Integration Specification (v2.0)

## 1. Network Connection Endpoints

* **Cloud Production Endpoints (Live over Internet):**
  * **Base URL:** `https://gps-tracking-1-1gkx.onrender.com`
  * **Unified GPS + Vitals Update:** `POST https://gps-tracking-1-1gkx.onrender.com/api/tracker/update`
  * **Vitals Only Update:** `POST https://gps-tracking-1-1gkx.onrender.com/api/vitals/update`
  * **Headers:** `Content-Type: application/json`

* **Local LAN / Development Endpoints (On-Premises Wi-Fi):**
  * **Base URL:** `http://192.168.1.213:5001`
  * **Unified GPS + Vitals Update:** `POST http://192.168.1.213:5001/api/tracker/update`
  * **Vitals Only Update:** `POST http://192.168.1.213:5001/api/vitals/update`

* **Raw TCP Socket (Recommended for GSM & LoRa Gateway Bridges):**
  * **Target IP (LAN / Wi-Fi):** `192.168.1.213`
  * **Target Port:** `5000`
  * *Example Socket Endpoint:* `192.168.1.213:5000`
  * *WAN / Remote:* Replace with Public IP or Tunnel Host.

---

## 2. Server Handshake & Acknowledgment

Upon receiving and validating each packet, the server replies immediately:
```text
ACK,[device_id]#\n
```
* **Example:** `ACK,DEVICE_001#\n`
* Microcontrollers can use this acknowledgment to confirm packet delivery and immediately transition into deep sleep.

---

## 3. Unified Hardware JSON Payload Specification

```json
{
  "device_id": "DEVICE_001",
  "transport_mode": 0,
  "gps_status": 1,
  "latitude": 13.124505,
  "longitude": 80.094435,
  "speed": 12.5,
  "watch_status": 1,
  "watch_battery": 50.0,
  "hr": 86,
  "spo2": 98.0,
  "bp_sys": 125,
  "bp_dia": 68,
  "steps": 7300
}
```

### Complete Field Dictionary

| Field | Type | Mandatory? | Allowed Values | Description / Rules |
| :--- | :--- | :--- | :--- | :--- |
| `device_id` | String | **Yes** | Alphanumeric (e.g. `"DEVICE_001"`, IMEI) | Hardware node identifier. Aliased to `device_uid`. |
| `transport_mode`| Integer | **Yes** | `0`, `1`, `2` | `0` = LoRa / Meshtastic<br/>`1` = GSM / Cellular<br/>`2` = Wi-Fi |
| `gps_status` | Integer | **Yes** | `0`, `1` | `0` = Disconnected / Searching for satellites<br/>`1` = Connected / GPS 2D/3D Lock |
| `latitude` / `lat` | Float | Optional | `-90.0` to `+90.0` or `-1` | GPS Latitude in decimal degrees. Send `-1` if no GPS fix. |
| `longitude` / `lon`| Float | Optional | `-180.0` to `+180.0` or `-1`| GPS Longitude in decimal degrees. Send `-1` if no GPS fix. |
| `speed` | Float | Optional | `>= 0.0` | Speed in km/h. Defaults to `0` if omitted. |
| `watch_status` | Integer | **Yes** | `0`, `1` | `0` = Smartwatch Disconnected / Off-wrist<br/>`1` = Smartwatch Connected & Paired |
| `watch_battery` | Float | Optional | `0.0` – `100.0` or `-1` | Smartwatch battery percentage. Send `-1` if unknown. |
| `hr` | Integer | Optional | `30` – `220` or `-1` | Heart rate in BPM. Send `-1` if unmeasured. |
| `spo2` | Float | Optional | `50.0` – `100.0` or `-1` | Blood oxygen level in %. Send `-1` if unmeasured. |
| `bp_sys` | Integer | Optional | `70` – `200` or `-1` | Systolic blood pressure in mmHg. Send `-1` if unmeasured. |
| `bp_dia` | Integer | Optional | `40` – `130` or `-1` | Diastolic blood pressure in mmHg. Send `-1` if unmeasured. |
| `bp` | String | Optional | e.g. `"125/68"` | Optional pre-formatted BP string (parsed automatically). |
| `steps` | Integer | Optional | `>= 0` or `-1` | Cumulative daily steps count. Send `-1` if unavailable. |

---

## 4. Hardware Sentinel Rule (`-1` Standard)

> [!IMPORTANT]
> **Any sensor metric that is disconnected, currently measuring, or unknown MUST be sent as `-1`.**
> * The server automatically sanitizes `-1` into `NULL` in the database.
> * The frontend renders `NULL` cleanly as an empty dash `—` (preventing false readings like `0 BPM` or `-1%`).

---

## 5. Sample Payloads

### Scenario A: Full Telemetry & Vitals via LoRa (Transport 0)
```json
{
  "device_id": "DEVICE_001",
  "transport_mode": 0,
  "gps_status": 1,
  "latitude": 13.124505,
  "longitude": 80.094435,
  "speed": 0.0,
  "watch_status": 1,
  "watch_battery": 82.5,
  "hr": 74,
  "spo2": 99.0,
  "bp_sys": 118,
  "bp_dia": 76,
  "steps": 4820
}
```

### Scenario B: Outdoor GPS Only via GSM (Smartwatch Disconnected)
```json
{
  "device_id": "DEVICE_001",
  "transport_mode": 1,
  "gps_status": 1,
  "latitude": 13.125100,
  "longitude": 80.095200,
  "speed": 34.2,
  "watch_status": 0,
  "watch_battery": -1,
  "hr": -1,
  "spo2": -1,
  "bp_sys": -1,
  "bp_dia": -1,
  "steps": -1
}
```

### Scenario C: Indoor Vitals Only via Wi-Fi (No GPS Fix)
```json
{
  "device_id": "DEVICE_001",
  "transport_mode": 2,
  "gps_status": 0,
  "latitude": -1,
  "longitude": -1,
  "speed": 0.0,
  "watch_status": 1,
  "watch_battery": 65.0,
  "hr": 82,
  "spo2": 97.5,
  "bp_sys": 122,
  "bp_dia": 79,
  "steps": 6120
}
```

---

## 6. Device Registration Requirement

Before sending data, ensure the `device_id` is registered in the system:
* Register via Web UI: `http://192.168.1.213:5001/register.html`
* Or via API:
  ```bash
  curl -X POST http://192.168.1.213:5001/api/devices/register \
       -H "Content-Type: application/json" \
       -d '{"device_uid":"DEVICE_001","type":"Person"}'
  ```
Unregistered devices will be rejected with `Validation Failed: Device not found or inactive`.

---

## 7. Throughput & High-Concurrency Performance

* **Burst Capacity:** The backend is tuned with 30 concurrent database workers and indexed tables to absorb simultaneous bursts of **200–300 device packets in ~0.10 seconds** with zero slowdown.
* **Recommended Reporting Interval:**
  * **Moving Tracker:** 5 to 10 seconds per packet.
  * **Stationary Tracker:** 15 to 30 seconds per packet (the backend automatically filters stationary coordinates to optimize database I/O while keeping the live UI pin active).
* **High-Throughput Gateways:** For LoRa and GSM gateway bridges aggregating many devices, use the **Raw TCP Socket (Port 5000)** for minimal bandwidth and sub-millisecond execution.

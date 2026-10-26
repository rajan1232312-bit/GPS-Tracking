const deviceSelect = document.getElementById('device-select');
        const vitalsStreamBody = document.getElementById('vitals-stream-body');
        
        let devicesList = [];
        let latestVitalsCache = new Map();

        // Format Date to: DD/MMM/YYYY, hh:mm AM/PM
        function formatDateTime(dateString) {
            if (!dateString) return 'Unknown';
            const date = new Date(dateString + (String(dateString).endsWith('Z') ? '' : 'Z'));
            if (isNaN(date.getTime())) {
                const fallbackDate = new Date(dateString);
                if (isNaN(fallbackDate.getTime())) return 'Unknown';
                return formatDirect(fallbackDate);
            }
            return formatDirect(date);
        }

        function formatDirect(date) {
            const day = String(date.getDate()).padStart(2, '0');
            const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            const month = monthNames[date.getMonth()];
            const year = date.getFullYear();
            let hours = date.getHours();
            const minutes = String(date.getMinutes()).padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12;
            return `${day}/${month}/${year}, ${hours}:${minutes} ${ampm}`;
        }

        function escapeHtml(str) {
            if (str == null) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        // Fetch registered devices
        async function loadDevices() {
            try {
                const res = await fetch('/api/devices');
                devicesList = await res.json();
                
                deviceSelect.innerHTML = '<option value="all">All Devices Overview</option>';
                devicesList.forEach(dev => {
                    const opt = document.createElement('option');
                    opt.value = dev.device_uid;
                    opt.textContent = `${dev.name || dev.device_uid} (${dev.device_uid})`;
                    deviceSelect.appendChild(opt);
                });
            } catch (e) {
                console.error("Error loading devices:", e);
            }
        }

        // Fetch latest vitals for cards
        async function fetchLatestVitals() {
            try {
                const selectedUid = deviceSelect.value;
                const url = selectedUid === 'all' ? '/api/vitals/latest' : `/api/vitals/latest?device_uid=${selectedUid}`;
                const res = await fetch(url);
                const data = await res.json();

                if (Array.isArray(data)) {
                    data.forEach(item => latestVitalsCache.set(item.device_uid, item));
                    if (data.length > 0) {
                        updateCardMetrics(data[0]);
                    } else {
                        clearCardMetrics();
                    }
                } else if (data && data.device_uid) {
                    latestVitalsCache.set(data.device_uid, data);
                    updateCardMetrics(data);
                } else {
                    clearCardMetrics();
                }
            } catch (e) {
                console.error("Error loading latest vitals:", e);
            }
        }

        // Fetch recent vitals stream table
        async function fetchVitalsTable() {
            try {
                const selectedUid = deviceSelect.value;
                const url = `/api/logs/vitals?page=1&limit=20&device_uid=${selectedUid}`;
                const res = await fetch(url);
                const json = await res.json();
                const logs = json.data || [];

                if (logs.length > 0) {
                    vitalsStreamBody.innerHTML = logs.map(l => createVitalsRow(l)).join('');
                } else {
                    vitalsStreamBody.innerHTML = `
                        <tr>
                            <td colspan="11" class="empty-state">
                                <i class="fa-solid fa-inbox"></i>
                                <p>No vitals records received yet for this device.</p>
                            </td>
                        </tr>
                    `;
                }
            } catch (e) {
                console.error("Error loading vitals table:", e);
            }
        }

        // Helper badges for hardware status
        function formatTransportBadge(tm) {
            if (tm === 0 || tm === '0') return '<span class="vital-badge-inline badge-lora"><i class="fa-solid fa-tower-broadcast"></i> LoRa</span>';
            if (tm === 1 || tm === '1') return '<span class="vital-badge-inline badge-gsm"><i class="fa-solid fa-signal"></i> GSM</span>';
            if (tm === 2 || tm === '2') return '<span class="vital-badge-inline badge-wifi"><i class="fa-solid fa-wifi"></i> Wi-Fi</span>';
            return '<span class="empty-dash">—</span>';
        }

        function formatGpsBadge(status) {
            if (status === 1 || status === '1') return '<span class="vital-badge-inline badge-gps-on"><i class="fa-solid fa-satellite"></i> Connected</span>';
            if (status === 0 || status === '0') return '<span class="vital-badge-inline badge-gps-off"><i class="fa-solid fa-satellite-dish"></i> Disconnected</span>';
            return '<span class="empty-dash">—</span>';
        }

        function formatWatchBadge(status) {
            if (status === 1 || status === '1') return '<span class="vital-badge-inline badge-watch-on"><i class="fa-solid fa-stopwatch-20"></i> Connected</span>';
            if (status === 0 || status === '0') return '<span class="vital-badge-inline badge-watch-off"><i class="fa-solid fa-slash"></i> Disconnected</span>';
            return '<span class="empty-dash">—</span>';
        }

        function formatWatchBattery(val) {
            if (val == null || val === '' || val === -1 || val === '-1') return '<span class="empty-dash">—</span>';
            const num = parseFloat(val);
            if (isNaN(num) || num < 0) return '<span class="empty-dash">—</span>';
            return `<span class="vital-badge-inline badge-wbatt"><i class="fa-solid fa-bolt"></i> ${num.toFixed(1)}%</span>`;
        }

        // Update 4 KPI Cards
        function updateCardMetrics(vitals) {
            if (!vitals) {
                clearCardMetrics();
                return;
            }

            // Meta Bar Status (if present)
            const statusDot = document.getElementById('meta-status-dot');
            const statusText = document.getElementById('meta-status');
            
            // Check if vitals is recent (within 6 minutes to accommodate the 5-minute watch reporting cycle)
            let isOnline = false;
            if (vitals && vitals.timestamp) {
                const vtDate = new Date(vitals.timestamp + (String(vitals.timestamp).endsWith('Z') ? '' : 'Z'));
                const timeDiff = Date.now() - vtDate.getTime();
                if (!isNaN(vtDate.getTime()) && timeDiff <= 6 * 60 * 1000) {
                    isOnline = true;
                }
            }

            if (isOnline) {
                if (statusDot) statusDot.className = 'pulse-live-dot online';
                if (statusText) {
                    statusText.textContent = 'Online / Active';
                    statusText.style.color = '#34d399';
                }
            } else if (vitals && vitals.timestamp) {
                if (statusDot) statusDot.className = 'pulse-live-dot';
                if (statusText) {
                    statusText.textContent = 'Stream Paused / Last Data';
                    statusText.style.color = '#94a3b8';
                }
            } else {
                clearCardMetrics();
                return;
            }

            const lastSeenElem = document.getElementById('meta-last-seen');
            if (lastSeenElem) lastSeenElem.textContent = formatDateTime(vitals.timestamp);

            // Hardware telemetry metadata (favicons) - ALWAYS display the last received hardware data without defaults
            const transportElem = document.getElementById('meta-transport');
            if (transportElem) {
                const rawTm = vitals.transport_mode !== undefined ? vitals.transport_mode : vitals.device_transport_mode;
                const tm = (rawTm === 0 || rawTm === 1 || rawTm === 2 || rawTm === '0' || rawTm === '1' || rawTm === '2') ? parseInt(rawTm, 10) : null;
                transportElem.innerHTML = formatTransportBadge(tm);
            }

            const gpsElem = document.getElementById('meta-gps');
            if (gpsElem) {
                const gps = vitals.gps_status !== undefined ? vitals.gps_status : vitals.device_gps_status;
                gpsElem.innerHTML = formatGpsBadge(gps);
            }

            const watchElem = document.getElementById('meta-watch');
            if (watchElem) {
                const ws = vitals.watch_status !== undefined ? vitals.watch_status : vitals.device_watch_status;
                watchElem.innerHTML = formatWatchBadge(ws);
            }

            const watchBattElem = document.getElementById('meta-watch-battery');
            if (watchBattElem) {
                const wb = vitals.watch_battery !== undefined ? vitals.watch_battery : vitals.device_watch_battery;
                watchBattElem.innerHTML = formatWatchBattery(wb);
            }

            if (vitals.battery_percentage != null && vitals.battery_percentage !== -1) {
                const battElem = document.getElementById('meta-battery');
                if (battElem) battElem.textContent = `${vitals.battery_percentage}%`;
            }

            // 1. Blood Pressure (BP)
            const bpValElem = document.getElementById('val-bp');
            const bpNotice = document.getElementById('bp-empty-notice');
            const bpStatusBadge = document.getElementById('bp-status-badge');
            const bpSysText = document.getElementById('bp-sys-text');
            const bpDiaText = document.getElementById('bp-dia-text');
            const bpTrack = document.getElementById('bp-progress-track');
            const bpProgress = document.getElementById('bp-progress');

            if (vitals.blood_pressure && vitals.blood_pressure !== '—/—' && vitals.blood_pressure !== '-1/-1') {
                bpValElem.textContent = vitals.blood_pressure;
                bpNotice.style.display = 'none';
                if (isOnline) {
                    bpStatusBadge.className = 'status-pill status-optimal';
                    bpStatusBadge.innerHTML = '<span class="dot"></span> Normal';
                } else {
                    bpStatusBadge.className = 'status-pill status-nodata';
                    bpStatusBadge.innerHTML = '<span class="dot"></span> Last Recorded';
                }

                const sys = vitals.blood_pressure_sys || (vitals.blood_pressure.split('/')[0]);
                const dia = vitals.blood_pressure_dia || (vitals.blood_pressure.split('/')[1]);
                bpSysText.textContent = (sys && sys !== '-1') ? sys : '—';
                bpDiaText.textContent = (dia && dia !== '-1') ? dia : '—';

                bpTrack.style.display = 'block';
                const pct = Math.min(100, Math.max(10, ((parseInt(sys) || 120) / 180) * 100));
                bpProgress.style.width = `${pct}%`;
            } else {
                bpValElem.textContent = '—';
                bpNotice.style.display = 'flex';
                bpStatusBadge.className = 'status-pill status-nodata';
                bpStatusBadge.innerHTML = '<span class="dot"></span> Awaiting Data';
                bpSysText.textContent = '—';
                bpDiaText.textContent = '—';
                bpTrack.style.display = 'none';
            }

            // 2. Heart Rate (HR)
            const hrValElem = document.getElementById('val-hr');
            const hrNotice = document.getElementById('hr-empty-notice');
            const hrStatusBadge = document.getElementById('hr-status-badge');
            const hrTrack = document.getElementById('hr-progress-track');
            const hrProgress = document.getElementById('hr-progress');
            const hrTimeElem = document.getElementById('hr-reading-time');

            if (vitals.heart_rate != null && vitals.heart_rate !== '' && vitals.heart_rate !== -1 && vitals.heart_rate !== '-1') {
                hrValElem.textContent = vitals.heart_rate;
                hrNotice.style.display = 'none';
                const hr = parseInt(vitals.heart_rate, 10);
                if (isOnline) {
                    if (hr < 60) {
                        hrStatusBadge.className = 'status-pill status-warning';
                        hrStatusBadge.innerHTML = '<span class="dot"></span> Low (Bradycardia)';
                    } else if (hr > 100) {
                        hrStatusBadge.className = 'status-pill status-warning';
                        hrStatusBadge.innerHTML = '<span class="dot"></span> High (Tachycardia)';
                    } else {
                        hrStatusBadge.className = 'status-pill status-optimal';
                        hrStatusBadge.innerHTML = '<span class="dot"></span> Normal';
                    }
                    hrTimeElem.textContent = 'Measured live';
                } else {
                    hrStatusBadge.className = 'status-pill status-nodata';
                    hrStatusBadge.innerHTML = '<span class="dot"></span> Last Recorded';
                    hrTimeElem.textContent = 'Last recorded at ' + formatDateTime(vitals.timestamp);
                }
                hrTrack.style.display = 'block';
                const pct = Math.min(100, Math.max(10, (hr / 160) * 100));
                hrProgress.style.width = `${pct}%`;
            } else {
                hrValElem.textContent = '—';
                hrNotice.style.display = 'flex';
                hrStatusBadge.className = 'status-pill status-nodata';
                hrStatusBadge.innerHTML = '<span class="dot"></span> Awaiting Data';
                hrTrack.style.display = 'none';
                hrTimeElem.textContent = 'Awaiting signal';
            }

            // 3. SpO2
            const spo2ValElem = document.getElementById('val-spo2');
            const spo2Notice = document.getElementById('spo2-empty-notice');
            const spo2StatusBadge = document.getElementById('spo2-status-badge');
            const spo2Track = document.getElementById('spo2-progress-track');
            const spo2Progress = document.getElementById('spo2-progress');
            const spo2Grade = document.getElementById('spo2-grade');

            if (vitals.spo2 != null && vitals.spo2 !== '' && vitals.spo2 !== -1 && vitals.spo2 !== '-1') {
                const spo2 = parseFloat(vitals.spo2);
                spo2ValElem.textContent = spo2.toFixed(1);
                spo2Notice.style.display = 'none';
                if (isOnline) {
                    if (spo2 < 95) {
                        spo2StatusBadge.className = 'status-pill status-warning';
                        spo2StatusBadge.innerHTML = '<span class="dot"></span> Below Normal';
                        spo2Grade.textContent = 'Attention';
                    } else {
                        spo2StatusBadge.className = 'status-pill status-optimal';
                        spo2StatusBadge.innerHTML = '<span class="dot"></span> Optimal';
                        spo2Grade.textContent = 'Optimal Range';
                    }
                } else {
                    spo2StatusBadge.className = 'status-pill status-nodata';
                    spo2StatusBadge.innerHTML = '<span class="dot"></span> Last Recorded';
                    spo2Grade.textContent = 'Last recorded: ' + spo2.toFixed(1) + '%';
                }
                spo2Track.style.display = 'block';
                spo2Progress.style.width = `${Math.min(100, spo2)}%`;
            } else {
                spo2ValElem.textContent = '—';
                spo2Notice.style.display = 'flex';
                spo2StatusBadge.className = 'status-pill status-nodata';
                spo2StatusBadge.innerHTML = '<span class="dot"></span> Awaiting Data';
                spo2Track.style.display = 'none';
                spo2Grade.textContent = 'Awaiting signal';
            }

            // 4. Steps Count
            const stepsValElem = document.getElementById('val-steps');
            const stepsNotice = document.getElementById('steps-empty-notice');
            const stepsStatusBadge = document.getElementById('steps-status-badge');
            const stepsTrack = document.getElementById('steps-progress-track');
            const stepsProgress = document.getElementById('steps-progress');
            const stepsDistElem = document.getElementById('steps-distance');

            const rawSteps = vitals.steps !== undefined ? vitals.steps : vitals.step_count;
            if (rawSteps != null && rawSteps !== '' && rawSteps !== -1 && rawSteps !== '-1') {
                const stepsNum = parseInt(rawSteps, 10);
                stepsValElem.textContent = stepsNum.toLocaleString();
                stepsNotice.style.display = 'none';
                if (isOnline) {
                    stepsStatusBadge.className = 'status-pill status-optimal';
                    stepsStatusBadge.innerHTML = '<span class="dot"></span> Active';
                } else {
                    stepsStatusBadge.className = 'status-pill status-nodata';
                    stepsStatusBadge.innerHTML = '<span class="dot"></span> Last Recorded';
                }
                
                stepsTrack.style.display = 'block';
                const pct = Math.min(100, (stepsNum / 10000) * 100);
                stepsProgress.style.width = `${pct}%`;
                
                const km = ((stepsNum * 0.75) / 1000).toFixed(2);
                stepsDistElem.textContent = `${km} km`;
            } else {
                stepsValElem.textContent = '—';
                stepsNotice.style.display = 'flex';
                stepsStatusBadge.className = 'status-pill status-nodata';
                stepsStatusBadge.innerHTML = '<span class="dot"></span> Awaiting Data';
                stepsTrack.style.display = 'none';
                stepsDistElem.textContent = '—';
            }
        }

        function clearCardMetrics() {
            // Reset Meta Bar to Waiting for Data state when no records received
            const statusDot = document.getElementById('meta-status-dot');
            const statusText = document.getElementById('meta-status');
            if (statusDot) {
                statusDot.className = 'pulse-live-dot';
            }
            if (statusText) {
                statusText.textContent = 'Waiting for Data';
                statusText.style.color = '#94a3b8';
            }
            const lastSeenElem = document.getElementById('meta-last-seen');
            if (lastSeenElem) lastSeenElem.textContent = 'Waiting for data...';
            const battElem = document.getElementById('meta-battery');
            if (battElem) battElem.textContent = '--%';
            const transportElem = document.getElementById('meta-transport');
            if (transportElem) transportElem.textContent = '—';
            const gpsElem = document.getElementById('meta-gps');
            if (gpsElem) gpsElem.textContent = '—';
            const watchElem = document.getElementById('meta-watch');
            if (watchElem) watchElem.textContent = '—';
            const watchBattElem = document.getElementById('meta-watch-battery');
            if (watchBattElem) watchBattElem.textContent = '—';

            document.getElementById('val-bp').textContent = '—';
            document.getElementById('bp-empty-notice').style.display = 'flex';
            document.getElementById('bp-status-badge').className = 'status-pill status-nodata';
            document.getElementById('bp-status-badge').innerHTML = '<span class="dot"></span> Awaiting Data';
            document.getElementById('bp-progress-track').style.display = 'none';
            document.getElementById('bp-sys-text').textContent = '—';
            document.getElementById('bp-dia-text').textContent = '—';

            document.getElementById('val-hr').textContent = '—';
            document.getElementById('hr-empty-notice').style.display = 'flex';
            document.getElementById('hr-status-badge').className = 'status-pill status-nodata';
            document.getElementById('hr-status-badge').innerHTML = '<span class="dot"></span> Awaiting Data';
            document.getElementById('hr-progress-track').style.display = 'none';
            document.getElementById('hr-reading-time').textContent = 'Awaiting signal';

            document.getElementById('val-spo2').textContent = '—';
            document.getElementById('spo2-empty-notice').style.display = 'flex';
            document.getElementById('spo2-status-badge').className = 'status-pill status-nodata';
            document.getElementById('spo2-status-badge').innerHTML = '<span class="dot"></span> Awaiting Data';
            document.getElementById('spo2-progress-track').style.display = 'none';
            document.getElementById('spo2-grade').textContent = 'Awaiting signal';

            document.getElementById('val-steps').textContent = '—';
            document.getElementById('steps-empty-notice').style.display = 'flex';
            document.getElementById('steps-status-badge').className = 'status-pill status-nodata';
            document.getElementById('steps-status-badge').innerHTML = '<span class="dot"></span> Awaiting Data';
            document.getElementById('steps-progress-track').style.display = 'none';
            document.getElementById('steps-distance').textContent = '—';
        }

        // Create table row with missing values displayed as dashes
        function createVitalsRow(log, isNew = false) {
            const bpDisplay = (log.blood_pressure && log.blood_pressure !== '—/—' && log.blood_pressure !== '-1/-1')
                ? `<span class="vital-badge-inline badge-bp"><i class="fa-solid fa-gauge-simple-high"></i> ${escapeHtml(log.blood_pressure)}</span>`
                : `<span class="empty-dash">—</span>`;

            const spo2Display = (log.spo2 != null && log.spo2 !== '' && log.spo2 !== -1 && log.spo2 !== '-1')
                ? `<span class="vital-badge-inline badge-spo2"><i class="fa-solid fa-droplet"></i> ${parseFloat(log.spo2).toFixed(1)}%</span>`
                : `<span class="empty-dash">—</span>`;

            const hrDisplay = (log.heart_rate != null && log.heart_rate !== '' && log.heart_rate !== -1 && log.heart_rate !== '-1')
                ? `<span class="vital-badge-inline badge-hr"><i class="fa-solid fa-heart"></i> ${log.heart_rate} bpm</span>`
                : `<span class="empty-dash">—</span>`;

            const rawSteps = log.steps !== undefined ? log.steps : log.step_count;
            const stepsDisplay = (rawSteps != null && rawSteps !== '' && rawSteps !== -1 && rawSteps !== '-1')
                ? `<span class="vital-badge-inline badge-steps"><i class="fa-solid fa-person-walking"></i> ${Number(rawSteps).toLocaleString()}</span>`
                : `<span class="empty-dash">—</span>`;

            const transportBadge = formatTransportBadge(log.transport_mode);
            const gpsBadge = formatGpsBadge(log.gps_status);
            const watchBadge = formatWatchBadge(log.watch_status);
            const watchBatteryDisplay = formatWatchBattery(log.watch_battery);

            return `
                <tr class="${isNew ? 'new-row' : ''}">
                    <td><span class="live-dot" style="display: inline-block;"></span></td>
                    <td><span class="uid-badge">${escapeHtml(log.device_uid)}</span></td>
                    <td>${transportBadge}</td>
                    <td>${gpsBadge}</td>
                    <td>${watchBadge}</td>
                    <td>${watchBatteryDisplay}</td>
                    <td>${bpDisplay}</td>
                    <td>${spo2Display}</td>
                    <td>${hrDisplay}</td>
                    <td>${stepsDisplay}</td>
                    <td style="white-space: nowrap;">${formatDateTime(log.timestamp)}</td>
                </tr>
            `;
        }

        function onDeviceChange() {
            deviceSelect.blur();
            fetchLatestVitals();
            fetchVitalsTable();
        }

        // Initial Page Boot
        loadDevices();
        fetchLatestVitals();
        fetchVitalsTable();

        // --- Socket.IO Real-Time Incoming Vitals Hook ---
        const socket = io();
        socket.on('vitals_updated', (data) => {
            const devUid = data.device_uid || data.id;

            // Dynamically register new device in selector if not present
            if (devUid && !Array.from(deviceSelect.options).some(o => o.value === devUid)) {
                const opt = document.createElement('option');
                opt.value = devUid;
                opt.textContent = `${data.name || devUid} (${devUid})`;
                deviceSelect.appendChild(opt);
            }

            const targetUid = deviceSelect.value;

            if (targetUid === 'all' || targetUid === devUid) {
                // Update KPI Cards
                updateCardMetrics(data);

                // Prepend row to table
                if (vitalsStreamBody.querySelector('.empty-state')) {
                    vitalsStreamBody.innerHTML = '';
                }

                const newRowHtml = createVitalsRow({
                    device_name: data.name,
                    device_uid: devUid,
                    transport_mode: data.transport_mode,
                    gps_status: data.gps_status,
                    watch_status: data.watch_status,
                    watch_battery: data.watch_battery,
                    blood_pressure: data.blood_pressure,
                    spo2: data.spo2,
                    heart_rate: data.heart_rate,
                    steps: data.steps,
                    timestamp: data.timestamp
                }, true);

                vitalsStreamBody.insertAdjacentHTML('afterbegin', newRowHtml);

                if (vitalsStreamBody.children.length > 25) {
                    vitalsStreamBody.removeChild(vitalsStreamBody.lastChild);
                }
            }
        });

        // Also listen to real-time tracker packets (device_moved) to update watch data and favicons live
        socket.on('device_moved', (data) => {
            const devUid = data.id || data.device_uid;

            // Dynamically register new device in selector if not present
            if (devUid && !Array.from(deviceSelect.options).some(o => o.value === devUid)) {
                const opt = document.createElement('option');
                opt.value = devUid;
                opt.textContent = `${data.name || devUid} (${devUid})`;
                deviceSelect.appendChild(opt);
            }

            const targetUid = deviceSelect.value;

            if (targetUid === 'all' || targetUid === devUid) {
                const statusDot = document.getElementById('meta-status-dot');
                if (statusDot) statusDot.className = 'pulse-live-dot online';
                const statusText = document.getElementById('meta-status');
                if (statusText) {
                    statusText.textContent = 'Online / Active';
                    statusText.style.color = '#34d399';
                }
                if (data.timestamp) {
                    const lastSeenElem = document.getElementById('meta-last-seen');
                    if (lastSeenElem) lastSeenElem.textContent = formatDateTime(data.timestamp);
                }
                if (data.watch_battery !== undefined && data.watch_battery !== null && data.watch_battery !== -1) {
                    const wbElem = document.getElementById('meta-watch-battery');
                    if (wbElem) wbElem.innerHTML = formatWatchBattery(data.watch_battery);
                }
                if (data.watch_status !== undefined && data.watch_status !== null && data.watch_status !== -1) {
                    const watchElem = document.getElementById('meta-watch');
                    if (watchElem) watchElem.innerHTML = formatWatchBadge(data.watch_status);
                }
                if (data.transport_mode !== undefined && data.transport_mode !== null) {
                    const transportElem = document.getElementById('meta-transport');
                    if (transportElem) transportElem.innerHTML = formatTransportBadge(data.transport_mode);
                }
                if (data.gps_status !== undefined && data.gps_status !== null) {
                    const gpsElem = document.getElementById('meta-gps');
                    if (gpsElem) gpsElem.innerHTML = formatGpsBadge(data.gps_status);
                }
            }
        });

const logsThead = document.getElementById('logs-thead');
        const logsBody = document.getElementById('logs-body');
        const logTypeFilter = document.getElementById('log-type-filter');
        const deviceFilter = document.getElementById('device-filter');
        const pageTitle = document.getElementById('page-title');

        let currentLogType = 'telemetry'; // 'telemetry' or 'vitals'
        let allLogs = [];
        let currentPage = 1;
        let totalPages = 1;

        // Escape HTML to prevent XSS
        function escapeHtml(str) {
            if (str == null) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        // Format Date to nice readable format: DD/MMM/YYYY, hh:mm AM/PM
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

        const transportFilter = document.getElementById('transport-filter');

        // Helper badges for hardware status
        function formatTransportBadge(tm) {
            if (tm === 0 || tm === '0') return '<span class="badge-lora"><i class="fa-solid fa-tower-broadcast"></i> LoRa</span>';
            if (tm === 1 || tm === '1') return '<span class="badge-gsm"><i class="fa-solid fa-signal"></i> GSM</span>';
            if (tm === 2 || tm === '2') return '<span class="badge-wifi"><i class="fa-solid fa-wifi"></i> Wi-Fi</span>';
            return '<span class="empty-val">—</span>';
        }

        function formatGpsBadge(status) {
            if (status === 1 || status === '1') return '<span class="badge-gps-on"><i class="fa-solid fa-satellite"></i> Locked</span>';
            if (status === 0 || status === '0') return '<span class="badge-gps-off"><i class="fa-solid fa-satellite-dish"></i> No Fix</span>';
            return '<span class="empty-val">—</span>';
        }

        function formatWatchBadge(status) {
            if (status === 1 || status === '1') return '<span class="badge-watch-on"><i class="fa-solid fa-stopwatch-20"></i> Paired</span>';
            if (status === 0 || status === '0') return '<span class="badge-watch-off"><i class="fa-solid fa-slash"></i> Offline</span>';
            return '<span class="empty-val">—</span>';
        }

        function formatSpeedBadge(spd) {
            if (spd == null || spd === '' || spd === -1 || spd === '-1') return '<span class="empty-val">—</span>';
            const num = parseFloat(spd);
            return `<span class="badge-speed"><i class="fa-solid fa-gauge"></i> ${num.toFixed(1)} km/h</span>`;
        }

        function formatBatteryBadge(pct) {
            if (pct == null || pct === '' || pct === -1 || pct === '-1') return '<span class="empty-val">—</span>';
            const num = parseFloat(pct);
            return `<span class="badge-batt"><i class="fa-solid fa-battery-half"></i> ${num.toFixed(0)}%</span>`;
        }

        function formatWatchBatteryBadge(wb) {
            if (wb == null || wb === '' || wb === -1 || wb === '-1') return '<span class="empty-val">—</span>';
            const num = parseFloat(wb);
            return `<span class="badge-wbatt"><i class="fa-solid fa-bolt"></i> ${num.toFixed(1)}%</span>`;
        }

        // Render Adaptive Table Header
        function renderTableHeader() {
            if (currentLogType === 'vitals') {
                pageTitle.innerHTML = `<i class="fa-solid fa-heart-pulse" style="color: #f43f5e;"></i> Health Vitals Logs`;
                logsThead.innerHTML = `
                    <tr>
                        <th style="width: 50px;">Live</th>
                        <th>Device UID</th>
                        <th>Transport</th>
                        <th>GPS Fix</th>
                        <th>Watch</th>
                        <th>Watch Batt</th>
                        <th>Blood Pressure</th>
                        <th>SpO2</th>
                        <th>Heart Rate</th>
                        <th>Steps Count</th>
                        <th>Timestamp</th>
                    </tr>
                `;
            } else {
                pageTitle.innerHTML = `<i class="fa-solid fa-list-ul" style="color: var(--accent);"></i> System Telemetry Logs`;
                logsThead.innerHTML = `
                    <tr>
                        <th style="width: 50px;">Live</th>
                        <th>Device UID</th>
                        <th>Transport</th>
                        <th>GPS Fix</th>
                        <th>Speed</th>
                        <th>Battery</th>
                        <th>Latitude</th>
                        <th>Longitude</th>
                        <th>Timestamp</th>
                    </tr>
                `;
            }
        }

        // Create an adaptive table row
        function createRowHtml(log, isNew = false) {
            const transportBadge = formatTransportBadge(log.transport_mode);
            const gpsBadge = formatGpsBadge(log.gps_status);

            if (currentLogType === 'vitals') {
                // If a vital metric is not received or sentinel -1, render dash
                const bpDisplay = (log.blood_pressure && log.blood_pressure !== '—/—' && log.blood_pressure !== '-1/-1')
                    ? `<span class="bp-badge"><i class="fa-solid fa-heart-pulse"></i> ${escapeHtml(log.blood_pressure)}</span>`
                    : `<span class="empty-val" title="Not Received">—</span>`;

                const spo2Display = (log.spo2 !== null && log.spo2 !== undefined && log.spo2 !== '' && log.spo2 !== -1 && log.spo2 !== '-1')
                    ? `<span class="spo2-badge"><i class="fa-solid fa-droplet"></i> ${parseFloat(log.spo2).toFixed(1)}%</span>`
                    : `<span class="empty-val" title="Not Received">—</span>`;

                const hrDisplay = (log.heart_rate !== null && log.heart_rate !== undefined && log.heart_rate !== '' && log.heart_rate !== -1 && log.heart_rate !== '-1')
                    ? `<span class="hr-badge"><i class="fa-solid fa-heart"></i> ${log.heart_rate} bpm</span>`
                    : `<span class="empty-val" title="Not Received">—</span>`;

                const rawSteps = log.steps !== undefined ? log.steps : log.step_count;
                const stepsDisplay = (rawSteps !== null && rawSteps !== undefined && rawSteps !== '' && rawSteps !== -1 && rawSteps !== '-1')
                    ? `<span class="steps-badge"><i class="fa-solid fa-person-walking"></i> ${Number(rawSteps).toLocaleString()}</span>`
                    : `<span class="empty-val" title="Not Received">—</span>`;

                const watchBadge = formatWatchBadge(log.watch_status);
                const watchBattBadge = formatWatchBatteryBadge(log.watch_battery);

                return `
                    <tr class="${isNew ? 'new-row' : ''}">
                        <td><span class="pulse-dot" style="background-color: #38bdf8; box-shadow: 0 0 8px #38bdf8;"></span></td>
                        <td><span class="uid-badge">${escapeHtml(log.device_uid || log.device_name)}</span></td>
                        <td>${transportBadge}</td>
                        <td>${gpsBadge}</td>
                        <td>${watchBadge}</td>
                        <td>${watchBattBadge}</td>
                        <td>${bpDisplay}</td>
                        <td>${spo2Display}</td>
                        <td>${hrDisplay}</td>
                        <td>${stepsDisplay}</td>
                        <td style="white-space: nowrap;">${formatDateTime(log.timestamp)}</td>
                    </tr>
                `;
            } else {
                const speedBadge = formatSpeedBadge(log.speed);
                const battBadge = formatBatteryBadge(log.battery_percentage);
                const latDisplay = (log.latitude != null && log.latitude !== -1 && log.latitude !== '-1') ? parseFloat(log.latitude).toFixed(5) : '<span class="empty-val">—</span>';
                const lonDisplay = (log.longitude != null && log.longitude !== -1 && log.longitude !== '-1') ? parseFloat(log.longitude).toFixed(5) : '<span class="empty-val">—</span>';

                return `
                    <tr class="${isNew ? 'new-row' : ''}">
                        <td><span class="pulse-dot"></span></td>
                        <td><span class="uid-badge">${escapeHtml(log.device_uid || log.device_name)}</span></td>
                        <td>${transportBadge}</td>
                        <td>${gpsBadge}</td>
                        <td>${speedBadge}</td>
                        <td>${battBadge}</td>
                        <td class="coord">${latDisplay}</td>
                        <td class="coord">${lonDisplay}</td>
                        <td style="white-space: nowrap;">${formatDateTime(log.timestamp)}</td>
                    </tr>
                `;
            }
        }

        async function fetchDeviceList() {
            try {
                const response = await fetch('/api/devices');
                const devices = await response.json();
                devices.forEach(d => {
                    const option = document.createElement('option');
                    option.value = d.device_uid;
                    option.textContent = d.device_uid;
                    deviceFilter.appendChild(option);
                });
            } catch (err) {
                console.error("Failed to load device list for filter", err);
            }
        }

        function renderLogs(logsToRender) {
            const colCount = currentLogType === 'vitals' ? 11 : 9;
            const tFilter = transportFilter ? transportFilter.value : 'all';
            const filtered = (tFilter === 'all')
                ? logsToRender
                : logsToRender.filter(l => String(l.transport_mode) === String(tFilter));

            if (filtered && filtered.length > 0) {
                logsBody.innerHTML = filtered.map(log => createRowHtml(log)).join('');
            } else {
                const typeLabel = currentLogType === 'vitals' ? 'health vitals' : 'telemetry';
                logsBody.innerHTML = `
                    <tr>
                        <td colspan="${colCount}" class="empty-state">
                            <i class="fa-solid fa-inbox"></i>
                            <p>No ${typeLabel} logs found for this selection.</p>
                        </td>
                    </tr>
                `;
            }
        }

        let activeFetchId = 0;

        // Immediately clear old rows and display loading state during type switch or filter
        function showLoadingState() {
            const colCount = currentLogType === 'vitals' ? 11 : 9;
            const typeLabel = currentLogType === 'vitals' ? 'Health Vitals' : 'GPS Telemetry';
            logsBody.innerHTML = `
                <tr>
                    <td colspan="${colCount}" class="empty-state" style="padding: 70px 20px;">
                        <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 2.2rem; color: ${currentLogType === 'vitals' ? '#f43f5e' : 'var(--accent)'}; margin-bottom: 14px; display: inline-block;"></i>
                        <p style="color: #94a3b8; font-size: 0.95rem; font-weight: 500;">Loading ${typeLabel} logs...</p>
                    </td>
                </tr>
            `;
            document.getElementById('pagination-container').style.display = 'none';
        }

        function onLogTypeChange() {
            currentLogType = logTypeFilter.value;
            logTypeFilter.blur();
            currentPage = 1;
            renderTableHeader();
            showLoadingState();
            fetchLogs();
        }

        function applyFilter() {
            if (deviceFilter) deviceFilter.blur();
            if (transportFilter) transportFilter.blur();
            currentPage = 1; // Reset to page 1 when filter changes
            showLoadingState();
            fetchLogs();
        }
        
        function changePage(delta) {
            const newPage = currentPage + delta;
            if (newPage >= 1 && newPage <= totalPages) {
                currentPage = newPage;
                showLoadingState();
                fetchLogs();
            }
        }

        // Fetch logs based on active log type & device filter
        async function fetchLogs() {
            const fetchId = ++activeFetchId;
            const requestedType = currentLogType;

            try {
                const uid = deviceFilter.value || 'all';
                const endpoint = requestedType === 'vitals' ? '/api/logs/vitals' : '/api/logs/all';
                const response = await fetch(`${endpoint}?page=${currentPage}&limit=50&device_uid=${uid}`);
                const result = await response.json();
                
                // Discard stale response if log type changed or a newer request completed
                if (fetchId !== activeFetchId || currentLogType !== requestedType) {
                    return;
                }

                const data = result.data || [];
                currentPage = result.page || 1;
                totalPages = result.totalPages || 1;
                const totalLogs = result.total || 0;
                
                if (data && data.length > 0) {
                    allLogs = data;
                    renderLogs(data);
                    
                    // Show and update pagination UI
                    document.getElementById('pagination-container').style.display = 'flex';
                    document.getElementById('page-indicator').textContent = `Page ${currentPage} of ${totalPages}`;
                    document.getElementById('pagination-info').innerHTML = `Total Logs: <strong style="color: #f8fafc;">${totalLogs}</strong>`;
                    document.getElementById('prev-page-btn').disabled = currentPage <= 1;
                    document.getElementById('next-page-btn').disabled = currentPage >= totalPages;
                } else {
                    renderLogs([]);
                    document.getElementById('pagination-container').style.display = 'none';
                }
            } catch (error) {
                if (fetchId !== activeFetchId) return;
                console.error('Error fetching logs:', error);
                const colCount = currentLogType === 'vitals' ? 11 : 9;
                logsBody.innerHTML = `
                    <tr>
                        <td colspan="${colCount}" class="empty-state" style="color: #ef4444;">
                            <i class="fa-solid fa-triangle-exclamation"></i>
                            <p>Error loading logs. Make sure the backend server is running.</p>
                        </td>
                    </tr>
                `;
            }
        }

        // Initial setup & fetch
        renderTableHeader();
        fetchDeviceList();
        fetchLogs();

        // --- Socket.IO Real-Time Updates ---
        const socket = io();

        // 1. GPS Telemetry Updates
        socket.on('device_moved', (data) => {
            if (currentLogType !== 'telemetry') return;

            const newLog = {
                device_uid: data.id,
                device_name: data.id,
                transport_mode: data.transport_mode,
                gps_status: data.gps_status,
                speed: data.speed,
                battery_percentage: data.battery,
                latitude: data.lat,
                longitude: data.lon,
                timestamp: data.timestamp
            };
            
            const selectedUid = deviceFilter.value;
            const tFilter = transportFilter ? transportFilter.value : 'all';
            const matchesTransport = (tFilter === 'all' || String(newLog.transport_mode) === String(tFilter));
            
            // Only update DOM dynamically if currently on Page 1 and filter matches
            if (currentPage === 1 && (selectedUid === 'all' || selectedUid === newLog.device_uid) && matchesTransport) {
                allLogs.unshift(newLog);
                
                if (logsBody.querySelector('.empty-state')) {
                    logsBody.innerHTML = '';
                    document.getElementById('pagination-container').style.display = 'flex';
                }
                
                logsBody.insertAdjacentHTML('afterbegin', createRowHtml(newLog, true));
                
                // Maintain maximum 50 rows per page
                if (logsBody.children.length > 50) {
                    logsBody.removeChild(logsBody.lastChild);
                    allLogs.pop();
                }
            }
        });

        // 2. Health Vitals Updates (Instant Arrival Animation)
        socket.on('vitals_updated', (data) => {
            if (currentLogType !== 'vitals') return;

            const newLog = {
                device_uid: data.device_uid || data.id,
                device_name: data.device_uid || data.id,
                transport_mode: data.transport_mode,
                gps_status: data.gps_status,
                watch_status: data.watch_status,
                watch_battery: data.watch_battery,
                heart_rate: data.heart_rate,
                blood_pressure: data.blood_pressure,
                blood_pressure_sys: data.bp_sys,
                blood_pressure_dia: data.bp_dia,
                spo2: data.spo2,
                steps: data.steps,
                timestamp: data.timestamp
            };
            
            const selectedUid = deviceFilter.value;
            const tFilter = transportFilter ? transportFilter.value : 'all';
            const matchesTransport = (tFilter === 'all' || String(newLog.transport_mode) === String(tFilter));
            
            // Only update DOM dynamically if currently on Page 1 and filter matches
            if (currentPage === 1 && (selectedUid === 'all' || selectedUid === newLog.device_uid) && matchesTransport) {
                allLogs.unshift(newLog);
                
                if (logsBody.querySelector('.empty-state')) {
                    logsBody.innerHTML = '';
                    document.getElementById('pagination-container').style.display = 'flex';
                }
                
                // Smooth instant arrival animation with highlight fade
                logsBody.insertAdjacentHTML('afterbegin', createRowHtml(newLog, true));
                
                // Maintain maximum 50 rows per page
                if (logsBody.children.length > 50) {
                    logsBody.removeChild(logsBody.lastChild);
                    allLogs.pop();
                }
            }
        });

        // Event listeners (replaces inline HTML event attributes)
        if (logTypeFilter) logTypeFilter.addEventListener('change', onLogTypeChange);
        if (deviceFilter) deviceFilter.addEventListener('change', applyFilter);
        const transportFilterEl = document.getElementById('transport-filter');
        if (transportFilterEl) transportFilterEl.addEventListener('change', applyFilter);

        const refreshBtn = document.getElementById('refresh-logs-btn');
        if (refreshBtn) refreshBtn.addEventListener('click', fetchLogs);

        const prevBtn = document.getElementById('prev-page-btn');
        if (prevBtn) prevBtn.addEventListener('click', () => changePage(-1));

        const nextBtn = document.getElementById('next-page-btn');
        if (nextBtn) nextBtn.addEventListener('click', () => changePage(1));

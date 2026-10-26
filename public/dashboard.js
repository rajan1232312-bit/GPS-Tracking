// Premium Date Formatter
        function formatDatePremium(dateInput) {
            if (!dateInput) return 'Unknown';
            let date;
            if (dateInput instanceof Date) {
                date = dateInput;
            } else {
                let str = String(dateInput).trim();
                while (str.endsWith('ZZ')) str = str.slice(0, -1);
                if (!str.endsWith('Z') && !str.includes('+') && !str.match(/-\d{2}:\d{2}$/)) {
                    str = str.replace(' ', 'T') + 'Z';
                }
                date = new Date(str);
                if (isNaN(date.getTime())) {
                    date = new Date(dateInput);
                }
            }
            if (isNaN(date.getTime())) return 'Unknown';
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

        // Map Layers
        const satelliteLayer = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
            attribution: '&copy; Google Maps',
            maxZoom: 22,
            maxNativeZoom: 20
        });

        const streetLayer = L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
            attribution: '&copy; Google Maps',
            maxZoom: 22,
            maxNativeZoom: 20
        });

        const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles style by <a href="https://www.hotosm.org/" target="_blank">HOT</a>',
            maxZoom: 22,
            maxNativeZoom: 19
        });

        const osmSatLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
            maxZoom: 22,
            maxNativeZoom: 19
        });

        const mapLayers = {
            satellite: satelliteLayer,
            street: streetLayer,
            osm: osmLayer,
            osmsat: osmSatLayer
        };

        // Initialize Map with strict integer zoom snapping
        const map = L.map('map', {
            zoomControl: false,
            maxZoom: 22,
            zoomDelta: 1,
            zoomSnap: 1,
            scrollWheelZoom: false // Controlled by our precision single-step handler below
        }).setView([13.0827, 80.2707], 12);

        // Strict single-step zoom controls (10 -> 11 -> 12 -> 13 -> 14 in correct sequential order)
        map.zoomIn = function(delta) {
            const currentZoom = Math.round(map.getZoom());
            const maxZ = getActiveMaxZoom();
            if (currentZoom < maxZ) {
                map.setZoom(currentZoom + 1);
            }
            return this;
        };

        map.zoomOut = function(delta) {
            const currentZoom = Math.round(map.getZoom());
            const minZ = map.getMinZoom();
            if (currentZoom > minZ) {
                map.setZoom(currentZoom - 1);
            }
            return this;
        };

        // Precision mouse wheel handler: strictly steps 1 level at a time around cursor
        let isWheelZooming = false;
        const mapContainer = document.getElementById('map');
        if (mapContainer) {
            mapContainer.addEventListener('wheel', (e) => {
                e.preventDefault();
                if (isWheelZooming) return;

                const currentZoom = Math.round(map.getZoom());
                const mousePos = map.mouseEventToContainerPoint(e);

                if (e.deltaY < 0) {
                    // Scroll UP -> Zoom IN by strictly +1 (e.g. 10 -> 11 -> 12 -> 13 -> 14)
                    const maxZ = getActiveMaxZoom();
                    if (currentZoom < maxZ) {
                        isWheelZooming = true;
                        map.setZoomAround(mousePos, currentZoom + 1);
                        setTimeout(() => { isWheelZooming = false; }, 140);
                    }
                } else if (e.deltaY > 0) {
                    // Scroll DOWN -> Zoom OUT by strictly -1 (e.g. 14 -> 13 -> 12 -> 11 -> 10)
                    const minZ = map.getMinZoom();
                    if (currentZoom > minZ) {
                        isWheelZooming = true;
                        map.setZoomAround(mousePos, currentZoom - 1);
                        setTimeout(() => { isWheelZooming = false; }, 140);
                    }
                }
            }, { passive: false });
        }

        // Remove hacky slideTo logic, use CSS hardware acceleration instead
        map.on('zoomstart', () => {
            if (window.deviceMarkers) {
                Object.values(window.deviceMarkers).forEach(marker => {
                    if (marker._icon) marker._icon.style.transition = 'none';
                    if (marker._shadow) marker._shadow.style.transition = 'none';
                });
            }
        });

        // Add default OSM layer
        osmLayer.addTo(map);

        L.control.zoom({ position: 'bottomright' }).addTo(map);

        // Position attribution control to bottom-left so bottom-right is exclusive to navigation controls
        if (map.attributionControl) {
            map.attributionControl.setPosition('bottomleft');
        }

        // Custom Premium Zoom Indicator Control
        const ZoomIndicatorControl = L.Control.extend({
            options: { position: 'bottomright' },
            onAdd: function() {
                const div = L.DomUtil.create('div', 'leaflet-control map-zoom-control');
                div.innerHTML = `
                    <div class="map-zoom-badge" id="map-zoom-badge" title="Map Zoom Level (Click to reset)">
                        <div class="zoom-badge-icon-wrap">
                            <i class="fa-solid fa-crosshairs" id="zoom-badge-icon"></i>
                        </div>
                        <div class="zoom-badge-content">
                            <div class="zoom-badge-row">
                                <span class="zoom-badge-label">Zoom</span>
                                <span class="zoom-badge-value" id="zoom-badge-val">12</span>
                                <span class="zoom-badge-max" id="zoom-badge-max">/ 22</span>
                            </div>
                            <div class="zoom-progress-track">
                                <div class="zoom-progress-bar" id="zoom-progress-bar" style="width: 54.5%;"></div>
                            </div>
                            <div class="zoom-badge-descriptor" id="zoom-badge-tag">Metro / City</div>
                        </div>
                    </div>
                `;
                L.DomEvent.disableClickPropagation(div);
                L.DomEvent.disableScrollPropagation(div);

                // Clicking the badge resets to optimal overview zoom (12)
                div.addEventListener('click', (e) => {
                    e.stopPropagation();
                    map.setZoom(12);
                });

                return div;
            }
        });
        new ZoomIndicatorControl().addTo(map);

        function getZoomDescriptor(z) {
            if (z <= 3) return 'Global View';
            if (z <= 6) return 'Regional View';
            if (z <= 9) return 'Sub-Regional';
            if (z <= 12) return 'Metro / City';
            if (z <= 14) return 'District / Town';
            if (z <= 16) return 'Neighborhood';
            if (z <= 18) return 'Street Level';
            if (z <= 20) return 'Block Level';
            return 'High Precision';
        }

        function getActiveMaxZoom() {
            let maxZ = 22;
            map.eachLayer(layer => {
                if (layer instanceof L.TileLayer && layer.options && layer.options.maxZoom) {
                    maxZ = layer.options.maxZoom;
                }
            });
            return maxZ;
        }

        let zoomSettleTimeout = null;
        function updateZoomIndicator(isZooming = false) {
            const valElem = document.getElementById('zoom-badge-val');
            const maxElem = document.getElementById('zoom-badge-max');
            const barElem = document.getElementById('zoom-progress-bar');
            const tagElem = document.getElementById('zoom-badge-tag');
            const badge = document.getElementById('map-zoom-badge');
            if (!valElem || !badge) return;

            // Strict integer zoom level (e.g. 10, 11, 12, 13, 14, 15...)
            const zoom = Math.round(map.getZoom());
            const maxZ = getActiveMaxZoom();

            valElem.textContent = zoom;
            if (maxElem) maxElem.textContent = `/ ${maxZ}`;
            if (tagElem) tagElem.textContent = getZoomDescriptor(zoom);

            const pct = Math.min(100, Math.max(5, (zoom / maxZ) * 100));
            if (barElem) barElem.style.width = `${pct}%`;

            if (isZooming) {
                badge.classList.add('is-zooming');
                clearTimeout(zoomSettleTimeout);
                zoomSettleTimeout = setTimeout(() => {
                    badge.classList.remove('is-zooming');
                }, 300);
            }
        }

        map.on('zoom', () => updateZoomIndicator(true));
        map.on('zoomend', () => updateZoomIndicator(false));
        // Initial sync
        setTimeout(() => updateZoomIndicator(false), 100);

        // Modal Logic
        const addBtn = document.getElementById('add-tracker-btn');
        const modal = document.getElementById('add-tracker-modal');
        const closeBtn = document.getElementById('close-modal-btn');

        if(addBtn && modal && closeBtn) {
            addBtn.addEventListener('click', () => {
                modal.classList.add('active');
            });
            
            closeBtn.addEventListener('click', () => {
                modal.classList.remove('active');
            });

            modal.addEventListener('click', (e) => {
                if(e.target === modal) {
                    modal.classList.remove('active');
                }
            });
        }

        // Layer Switching Logic
        document.querySelectorAll('.layer-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                const layerId = btn.getAttribute('data-layer');
                // Remove all tile layers
                map.eachLayer(layer => {
                    if (layer instanceof L.TileLayer) {
                        map.removeLayer(layer);
                    }
                });
                // Add selected layer
                mapLayers[layerId].addTo(map);
                // Update zoom indicator bounds for newly selected tile layer (OSM, Satellite, etc.)
                updateZoomIndicator(false);
            });
        });

        function getIconClass(type) {
            switch(type) {
                case 'Person':
                case 'Wearable':
                case 'Health Band': return 'fa-person';
                case 'Truck': return 'fa-truck';
                case 'Bike': return 'fa-motorcycle';
                default: return 'fa-car';
            }
        }

        function getMapIcon(isOnline = true) {
            const strokeColor = isOnline ? '#0f172a' : '#450a0a';
            const arrowColor = isOnline ? '#2563eb' : '#dc2626';
            const html = `
                <svg width="46" height="46" viewBox="0 0 46 46" xmlns="http://www.w3.org/2000/svg" style="transform: rotate(0deg); filter: drop-shadow(0px 4px 6px rgba(0,0,0,0.6));" id="car-svg">
                    <circle cx="23" cy="23" r="16" fill="#ffffff" stroke="${strokeColor}" stroke-width="3"/>
                    <path d="M23 13 L31 29 L23 25 L15 29 Z" fill="${arrowColor}" stroke="${strokeColor}" stroke-width="2"/>
                </svg>
            `;
            return L.divIcon({
                html: html,
                className: isOnline ? 'marker-online' : 'marker-offline',
                iconSize: [46, 46],
                iconAnchor: [23, 23]
            });
        }

        let marker = null;
        let lastLat = null;
        let lastLon = null;

        // Helper to calculate bearing/heading

        // Haversine formula to calculate distance between two coordinates in meters
        function getDistanceMeters(lat1, lon1, lat2, lon2) {
            const R = 6371e3; // metres
            const p1 = lat1 * Math.PI/180;
            const p2 = lat2 * Math.PI/180;
            const dp = (lat2-lat1) * Math.PI/180;
            const dl = (lon2-lon1) * Math.PI/180;

            const a = Math.sin(dp/2) * Math.sin(dp/2) +
                      Math.cos(p1) * Math.cos(p2) *
                      Math.sin(dl/2) * Math.sin(dl/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

            return R * c;
        }

        function calculateBearing(lat1, lon1, lat2, lon2) {
            const toRad = (deg) => deg * Math.PI / 180;
            const toDeg = (rad) => rad * 180 / Math.PI;
            
            const dLon = toRad(lon2 - lon1);
            lat1 = toRad(lat1);
            lat2 = toRad(lat2);
            
            const y = Math.sin(dLon) * Math.cos(lat2);
            const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
            const brng = toDeg(Math.atan2(y, x));
            return (brng + 360) % 360;
        }

        // ========================================================
        // Premium Smooth Tracking Architecture (Leaflet Adapted)
        // ========================================================
        
        // 1. Kalman Filter for Predictive GPS Smoothing
        class SimpleKalmanFilter {
            constructor(r = 0.00005, q = 0.00001) {
                this.r = r; // Measurement noise (expected GPS error in degrees, ~5m)
                this.q = q; // Process noise (expected actual movement)
                this.p = 1; // Estimation error covariance
                this.x = null; // Predicted value
            }
            filter(measurement) {
                if (this.x === null) {
                    this.x = measurement;
                } else {
                    // Prediction
                    this.p = this.p + this.q;
                    // Update
                    let k = this.p / (this.p + this.r);
                    this.x = this.x + k * (measurement - this.x);
                    this.p = (1 - k) * this.p;
                }
                return this.x;
            }
        }

        class SmoothLeafletTracker {
            constructor(map, marker) {
                this.map = map;
                this.marker = marker;
                
                // Initialize Independent Kalman Filters for Lat and Lng
                this.kalmanLat = new SimpleKalmanFilter();
                this.kalmanLng = new SimpleKalmanFilter();

                this.lastValidPos = null;
                this.isFirstFix = true;
                this.animationId = null;
                this._currentRotation = 0;

                this.isStationary = false;
                this.stationaryStartTime = null;

                // Base Tunable parameters (will be overwritten by profiles)
                this.MIN_DISTANCE = 4;
                this.STATIONARY_SPEED = 0.4;
                this.STATIONARY_TIME = 3000;
                this.EXIT_STATIONARY_DIST = 10;
                this.MAX_SPEED = 55;
                this.SMOOTHING = 0.32;
                this.ANIMATION_MS = 480;
                this.currentProfile = 'Car';
            }

            applyProfile(type) {
                if (this.currentProfile === type) return;
                this.currentProfile = type || 'Car';

                if (this.currentProfile === 'Person') {
                    // Human Profile: Smooth tracking, ignoring < 2m jitter
                    this.MIN_DISTANCE = 2;             // Ignore noise under 2 meters
                    this.STATIONARY_SPEED = 0.2;       
                    this.STATIONARY_TIME = 5000;       
                    this.EXIT_STATIONARY_DIST = 2;     
                    this.MAX_SPEED = 15;               
                    this.SMOOTHING = 1.0;              // 1.0 = No lagging/drifting behind the raw point
                    this.ANIMATION_MS = 1500;          // Fast, precise snap
                } else {
                    // Vehicle Profile: Smooth tracking, ignoring < 2m jitter
                    this.MIN_DISTANCE = 2;             // Ignore noise under 2 meters
                    this.STATIONARY_SPEED = 0.4;       
                    this.STATIONARY_TIME = 3000;       
                    this.EXIT_STATIONARY_DIST = 5;    
                    this.MAX_SPEED = 55;               
                    this.SMOOTHING = 1.0;              // 1.0 = No lagging/drifting
                    this.ANIMATION_MS = 480;           
                }
            }

            onGpsUpdate(raw) {
                this.applyProfile(raw.type);

                const rawLat = parseFloat(raw.lat);
                const rawLng = parseFloat(raw.lng !== undefined ? raw.lng : raw.lon);
                const accuracy = parseFloat(raw.accuracy || 10);
                const timestamp = raw.timestamp ? new Date(raw.timestamp).getTime() : Date.now();

                if (!this.isValidPoint(rawLat, rawLng, accuracy, timestamp)) return;

                // 2. Apply Kalman Filter to gracefully smooth the raw GPS coordinates
                const lat = this.kalmanLat.filter(rawLat);
                const lng = this.kalmanLng.filter(rawLng);

                const newPos = { lat, lng, timestamp };

                // 1. First valid GPS lock after connection → exact snap (no jump)
                if (this.isFirstFix || !this.lastValidPos) {
                    newPos.heading = 0;
                    this.snapTo(newPos);
                    this.isFirstFix = false;
                    this.isStationary = false;
                    return;
                }

                const dist = this.haversine(this.lastValidPos, newPos);
                const dt = (timestamp - this.lastValidPos.timestamp) / 1000;
                const speed = dt > 0 ? dist / dt : 0;

                // ====================== ADVANCED HEADING LOCK ======================
                // GPS jitter at low speeds causes wild pointer spinning. 
                // We lock the heading if the vehicle is moving slower than 0.8 m/s (~2.8 km/h) to improve responsiveness
                if (speed > 0.8) {
                    newPos.heading = this.calculateBearing(this.lastValidPos, newPos);
                } else {
                    newPos.heading = this.lastValidPos.heading || 0;
                }

                // Reject impossible jumps or huge time gaps (reconnects/GPS loss)
                if (speed > this.MAX_SPEED || dt > 4) {
                    this.snapTo(newPos);
                    return;
                }

                // ====================== STATIONARY LOGIC ======================
                if (this.isStationary) {
                    if (dist >= this.EXIT_STATIONARY_DIST) {
                        this.isStationary = false;
                    } else {
                        return; // stay completely frozen
                    }
                } else {
                    if (speed < this.STATIONARY_SPEED) {
                        if (!this.stationaryStartTime) {
                            this.stationaryStartTime = timestamp;
                        } else if (timestamp - this.stationaryStartTime >= this.STATIONARY_TIME) {
                            this.isStationary = true;
                            this.stationaryStartTime = null;
                            return; // freeze now
                        }
                    } else {
                        this.stationaryStartTime = null;
                    }
                }

                // Ignore tiny movements to prevent micro-stutters
                if (dist < this.MIN_DISTANCE) return;

                // Animate + rotate to exactly the new position (no lagging)
                this.animateTo(newPos);
            }

            snapTo(pos) {
                if (this.marker._icon) this.marker._icon.style.transition = 'none';
                if (this.marker._shadow) this.marker._shadow.style.transition = 'none';
                
                this.marker.setLatLng([pos.lat, pos.lng]);
                this.setMarkerRotation(pos.heading || 0);
                this.lastValidPos = { ...pos };
            }

            animateTo(target) {
                if (this.animationId) cancelAnimationFrame(this.animationId);

                const start = { ...this.lastValidPos };
                const startTime = performance.now();

                let dt_ms = target.timestamp - start.timestamp;
                if (isNaN(dt_ms) || dt_ms <= 0) dt_ms = 1000; 
                
                // Better match the animation duration to the transmission rate for flawless continuous motion
                // Increased max to 5000ms to prevent stop-and-go lag on slower update intervals
                let duration = Math.max(100, Math.min(dt_ms, 5000));

                const animate = (now) => {
                    const progress = Math.min((now - startTime) / duration, 1);
                    
                    // 3. Spline-like trajectory: The Kalman filter above mathematically pulls 
                    // the waypoints into a natural curve. We use linear time interpolation 
                    // so the pointer glides continuously along this curve without stopping.
                    const ease = progress; 

                    const lat = start.lat + (target.lat - start.lat) * ease;
                    const lng = start.lng + (target.lng - start.lng) * ease;
                    
                    if (this.marker._icon) this.marker._icon.style.transition = 'none';
                    if (this.marker._shadow) this.marker._shadow.style.transition = 'none';
                    
                    this.marker.setLatLng([lat, lng]);

                    if (start.heading !== undefined && target.heading !== undefined) {
                        const heading = this.lerpAngle(start.heading, target.heading, ease);
                        this.setMarkerRotation(heading);
                    }

                    if (progress < 1) {
                        this.animationId = requestAnimationFrame(animate);
                    } else {
                        this.lastValidPos = { ...target };
                    }
                };

                this.animationId = requestAnimationFrame(animate);
            }

            setMarkerRotation(targetBearing) {
                let diff = targetBearing - (this._currentRotation % 360);
                if (diff > 180) diff -= 360;
                else if (diff < -180) diff += 360;
                
                this._currentRotation += diff;

                if (this.marker.getElement()) {
                    // Update all possible rotation targets
                    const svg = this.marker.getElement().querySelector('svg');
                    if (svg) {
                        svg.style.transform = `rotate(${this._currentRotation}deg)`;
                        svg.style.transformOrigin = 'center center';
                    }
                }
            }

            isValidPoint(lat, lng, accuracy, timestamp) {
                if (isNaN(lat) || isNaN(lng)) return false;
                if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
                if (accuracy > 25) return false;
                if (this.lastValidPos && timestamp < this.lastValidPos.timestamp) return false;
                return true;
            }

            haversine(p1, p2) {
                const R = 6371000;
                const dLat = (p2.lat - p1.lat) * Math.PI / 180;
                const dLng = (p2.lng - p1.lng) * Math.PI / 180;
                const a =
                    Math.sin(dLat / 2) ** 2 +
                    Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
                    Math.sin(dLng / 2) ** 2;
                return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            }

            calculateBearing(p1, p2) {
                const dLng = (p2.lng - p1.lng) * Math.PI / 180;
                const lat1 = p1.lat * Math.PI / 180;
                const lat2 = p2.lat * Math.PI / 180;
                const y = Math.sin(dLng) * Math.cos(lat2);
                const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
                return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
            }

            angleDiff(a, b) {
                return ((b - a + 540) % 360) - 180;
            }

            lerpAngle(a, b, t) {
                return a + this.angleDiff(a, b) * t;
            }

            onDeviceConnected() {
                this.isFirstFix = true;
                this.isStationary = false;
                this.stationaryStartTime = null;
            }
        }
        // ========================================================

        // Initialize WebSockets safely
        try {
            const socket = io();

        socket.on('device_moved', (data) => {
            console.log('Received real-time update:', data);

            // Update UI Sidebar Status to Online
            let deviceItem = document.getElementById('sidebar-dev-' + data.id);
            if (!deviceItem) {
                const list = document.getElementById('sidebar-device-list');
                const html = `
                    <div class="device-item" id="sidebar-dev-${data.id}" onclick="openDeviceDetails('${data.id}')">
                        <div class="device-icon" style="color: var(--success);"><i class="fa-solid ${getIconClass(data.type)}"></i></div>
                        <div class="device-info">
                            <div class="device-name">${data.id}</div>
                            <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                                <span class="device-status" id="sidebar-dev-time-${data.id}">Online</span>
                            </div>
                        </div>
                    </div>
                `;
                list.insertAdjacentHTML('beforeend', html);
            } else {
                let statusEl = document.getElementById('sidebar-dev-time-' + data.id);
                if (statusEl) {
                    statusEl.innerText = 'Online';
                    statusEl.classList.remove('error');
                }
                let iconEl = deviceItem.querySelector('.device-icon');
                if (iconEl) iconEl.style.color = 'var(--success)';
            }

            // Update Table Status Badge to Online
            const tableStatusBadge = document.getElementById(`table-status-${data.id}`);
            if (tableStatusBadge) {
                tableStatusBadge.className = 'status-badge online';
                tableStatusBadge.textContent = 'Online';
            }

            // Update Table Battery if present
            if (data.battery != null && data.battery !== -1) {
                const tableBatt = document.getElementById(`battery-table-${data.id}`);
                if (tableBatt) tableBatt.textContent = `${Math.round(data.battery)}%`;
            }

            // Setup Marker & Tracker
            if (!window.deviceMarkers) window.deviceMarkers = {};
            if (!window.deviceTrackers) window.deviceTrackers = {};
            
            let deviceMarker = window.deviceMarkers[data.id];
            let tracker = window.deviceTrackers[data.id];

            if (!deviceMarker || !tracker) {
                if (!deviceMarker) {
                    deviceMarker = L.marker([data.lat, data.lon], { icon: getMapIcon() })
                        .bindTooltip(data.name || data.id, { permanent: false, direction: 'top', className: 'professional-tooltip' })
                        .addTo(map);
                    deviceMarker.on('click', (e) => {
                        if (e && e.originalEvent) e.originalEvent.stopPropagation();
                        openDeviceDetails(data.id);
                    });
                    window.deviceMarkers[data.id] = deviceMarker;
                }
                
                if (!tracker) {
                    tracker = new SmoothLeafletTracker(map, deviceMarker);
                    window.deviceTrackers[data.id] = tracker;
                    tracker.onDeviceConnected();
                }
                
                map.panTo([data.lat, data.lon], {animate: true, duration: 1});
            }

            // Route update to the premium tracker
            tracker.onGpsUpdate(data);
            
            // Dynamically update Table and Details if visible
            const lastSeenFormatted = formatDatePremium(data.timestamp);
            
            // 1. Update Table Location (Lat, Lon)
            const tableLocContainer = document.getElementById(`loc-table-container-${data.id}`);
            if(tableLocContainer) {
                tableLocContainer.textContent = `${data.lat.toFixed(5)}, ${data.lon.toFixed(5)}`;
            }
            
            // 2. Update Table Status & Network to Online
            const tableStatus = document.getElementById(`table-status-${data.id}`);
            if(tableStatus) {
                tableStatus.className = 'status-badge online';
                tableStatus.textContent = 'Online';
            }
            const tableNet = document.getElementById(`table-network-${data.id}`);
            if(tableNet) {
                tableNet.innerHTML = formatTransportBadgeSm(data.transport_mode) || '<span style="color: #64748b; font-size: 0.8rem;">—</span>';
            }

            // 3. Update Sidebar Status & Transport
            const sidebarDev = document.getElementById(`sidebar-dev-${data.id}`);
            if(sidebarDev) {
                const sidebarTime = document.getElementById(`sidebar-dev-time-${data.id}`);
                if(sidebarTime) {
                    sidebarTime.innerText = 'Online';
                    sidebarTime.classList.remove('error');
                }
                const iconEl = sidebarDev.querySelector('.device-icon');
                if(iconEl) iconEl.style.color = 'var(--success)';
                const sidebarNet = document.getElementById(`sidebar-dev-transport-${data.id}`);
                if(sidebarNet) {
                    sidebarNet.innerHTML = formatTransportBadgeSm(data.transport_mode);
                }
                const sidebarGps = document.getElementById(`sidebar-dev-gps-${data.id}`);
                if(sidebarGps && data.gps_status !== undefined && data.gps_status !== null) {
                    sidebarGps.innerHTML = formatGpsMini(data.gps_status);
                }
                const sidebarWatch = document.getElementById(`sidebar-dev-watch-${data.id}`);
                if(sidebarWatch && data.watch_status !== undefined && data.watch_status !== null) {
                    sidebarWatch.innerHTML = formatWatchMini(data.watch_status);
                }
            }
            
            // 4. Update Table Last Seen (Address • Time)
            const tableLastSeenTime = document.getElementById(`last-seen-time-${data.id}`);
            if(tableLastSeenTime) tableLastSeenTime.textContent = lastSeenFormatted;
            
            const tableLastSeenLoc = document.getElementById(`last-seen-loc-${data.id}`);
            if(tableLastSeenLoc) {
                tableLastSeenLoc.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Locating...`;
                getAddressFromCoords(data.lat, data.lon, `last-seen-loc-${data.id}`);
            } else {
                const tableLastSeenCell = document.getElementById(`last-seen-table-${data.id}`);
                if(tableLastSeenCell) {
                    tableLastSeenCell.innerHTML = `<span id="last-seen-loc-${data.id}"><i class="fa-solid fa-circle-notch fa-spin"></i> Locating...</span> &bull; <span id="last-seen-time-${data.id}">${lastSeenFormatted}</span>`;
                    getAddressFromCoords(data.lat, data.lon, `last-seen-loc-${data.id}`);
                }
            }
            
            // 5. Update Details Modal if open for this device
            const detailsUid = document.getElementById('details-uid-display');
            if(detailsUid && detailsUid.textContent === data.id) {
                const detailsStatusVal = document.getElementById('details-status-val');
                if (detailsStatusVal) {
                    detailsStatusVal.textContent = 'Online';
                    detailsStatusVal.style.color = 'var(--success)';
                }

                const detailsLoc = document.getElementById('details-location');
                if(detailsLoc) detailsLoc.textContent = `${data.lat.toFixed(5)}, ${data.lon.toFixed(5)}`;
                
                const detailsLastSeenTime = document.getElementById('details-last-seen-time');
                if(detailsLastSeenTime) detailsLastSeenTime.textContent = lastSeenFormatted;
                
                const detailsLastSeenLoc = document.getElementById('details-last-seen-loc');
                if(detailsLastSeenLoc) {
                    detailsLastSeenLoc.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Locating...`;
                    getAddressFromCoords(data.lat, data.lon, 'details-last-seen-loc');
                } else {
                    const detailsLastSeen = document.getElementById('details-last-seen');
                    if(detailsLastSeen) {
                        detailsLastSeen.innerHTML = `<span id="details-last-seen-loc"><i class="fa-solid fa-circle-notch fa-spin"></i> Locating...</span> &bull; <span id="details-last-seen-time">${lastSeenFormatted}</span>`;
                        getAddressFromCoords(data.lat, data.lon, 'details-last-seen-loc');
                    }
                }

                if (data.transport_mode !== undefined) {
                    const transportEl = document.getElementById('details-transport');
                    if (transportEl) transportEl.innerHTML = formatTransportDetails(data.transport_mode, true);
                }
                if (data.gps_status !== undefined) {
                    const gpsEl = document.getElementById('details-gps');
                    if (gpsEl) gpsEl.innerHTML = formatGpsDetails(data.gps_status);
                }
                if (data.watch_status !== undefined && data.watch_status !== null) {
                    const watchEl = document.getElementById('details-watch');
                    if (watchEl) watchEl.innerHTML = formatWatchDetails(data.watch_status);
                }
                if (data.watch_battery !== undefined && data.watch_battery !== null && data.watch_battery !== -1) {
                    const wbEl = document.getElementById('details-watch-batt');
                    if (wbEl) wbEl.textContent = `${Number(data.watch_battery).toFixed(1)}%`;
                }
            }
        });

        // Hook for real-time vitals updates
        socket.on('vitals_updated', (data) => {
            const devId = data.device_uid || data.id;
            if (!devId) return;
            console.log('Received real-time vitals update:', devId, data);

            // 1. Update UI Sidebar Status to Online & Transport
            let deviceItem = document.getElementById('sidebar-dev-' + devId);
            if (deviceItem) {
                let statusEl = document.getElementById('sidebar-dev-time-' + devId);
                if (statusEl) {
                    statusEl.innerText = 'Online';
                    statusEl.classList.remove('error');
                }
                let iconEl = deviceItem.querySelector('.device-icon');
                if (iconEl) iconEl.style.color = 'var(--success)';
                let sidebarNet = document.getElementById('sidebar-dev-transport-' + devId);
                if (sidebarNet) {
                    sidebarNet.innerHTML = formatTransportBadgeSm(data.transport_mode);
                }
                const sidebarGps = document.getElementById('sidebar-dev-gps-' + devId);
                if (sidebarGps && data.gps_status !== undefined && data.gps_status !== null) {
                    sidebarGps.innerHTML = formatGpsMini(data.gps_status);
                }
                const sidebarWatch = document.getElementById('sidebar-dev-watch-' + devId);
                if (sidebarWatch && data.watch_status !== undefined && data.watch_status !== null) {
                    sidebarWatch.innerHTML = formatWatchMini(data.watch_status);
                }
            }

            // 2. Update Table Status Badge & Network to Online
            const tableStatusBadge = document.getElementById(`table-status-${devId}`);
            if (tableStatusBadge) {
                tableStatusBadge.className = 'status-badge online';
                tableStatusBadge.textContent = 'Online';
            }
            const tableNet = document.getElementById(`table-network-${devId}`);
            if (tableNet) {
                tableNet.innerHTML = formatTransportBadgeSm(data.transport_mode) || '<span style="color: #64748b; font-size: 0.8rem;">—</span>';
            }

            // 3. Update Table Last Seen
            const lastSeenFormatted = formatDatePremium(data.timestamp);
            const tableLastSeenTime = document.getElementById(`last-seen-time-${devId}`);
            if (tableLastSeenTime) tableLastSeenTime.textContent = lastSeenFormatted;

            // 4. Update Table Battery
            const wb = data.watch_battery;
            if (wb !== undefined && wb !== null && wb !== -1) {
                const tableBatt = document.getElementById(`battery-table-${devId}`);
                if (tableBatt) tableBatt.textContent = `${Math.round(wb)}%`;
            }

            // 5. Update Details Modal if open for this device
            const detailsUid = document.getElementById('details-uid-display');
            if (detailsUid && detailsUid.textContent === devId) {
                const detailsStatusVal = document.getElementById('details-status-val');
                if (detailsStatusVal) {
                    detailsStatusVal.textContent = 'Online';
                    detailsStatusVal.style.color = 'var(--success)';
                }

                const detailsLastSeenTime = document.getElementById('details-last-seen-time');
                if (detailsLastSeenTime) detailsLastSeenTime.textContent = lastSeenFormatted;

                if (data.transport_mode !== undefined && data.transport_mode !== null) {
                    const transportEl = document.getElementById('details-transport');
                    if (transportEl) transportEl.innerHTML = formatTransportDetails(data.transport_mode, true);
                }
                if (data.gps_status !== undefined && data.gps_status !== null) {
                    const gpsEl = document.getElementById('details-gps');
                    if (gpsEl) gpsEl.innerHTML = formatGpsDetails(data.gps_status);
                }
                if (data.watch_status !== undefined && data.watch_status !== null) {
                    const watchEl = document.getElementById('details-watch');
                    if (watchEl) watchEl.innerHTML = formatWatchDetails(data.watch_status);
                }
                if (wb !== undefined && wb !== null && wb !== -1) {
                    const wbEl = document.getElementById('details-watch-batt');
                    if (wbEl) wbEl.textContent = `${Number(wb).toFixed(1)}%`;
                }
            }
        });
        } catch (e) {
            console.warn("Socket.io could not be initialized. Map will still display.", e);
        }

        // Reverse Geocoding Cache
        const geocodeCache = {};
        
        async function getAddressFromCoords(lat, lon, elementId) {
            const cacheKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
            
            // If cached, wait a tiny bit to ensure DOM is ready before updating
            if (geocodeCache[cacheKey]) {
                setTimeout(() => {
                    const el = document.getElementById(elementId);
                    if(el) el.textContent = geocodeCache[cacheKey];
                }, 50);
                return;
            }
            
            try {
                // Nominatim Reverse Geocoding API
                const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
                const data = await res.json();
                
                // Extract a clean, professional address (City, State/Neighborhood)
                const city = data.address?.city || data.address?.town || data.address?.village || '';
                const neighborhood = data.address?.suburb || data.address?.neighbourhood || data.address?.road || '';
                const displayAddr = [neighborhood, city].filter(Boolean).join(', ') || data.display_name.split(',').slice(0, 2).join(', ');
                
                geocodeCache[cacheKey] = displayAddr;
                const el = document.getElementById(elementId);
                if(el) el.textContent = displayAddr;
            } catch(err) {
                const el = document.getElementById(elementId);
                if(el) el.textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`; // Fallback to raw coords
            }
        }

        // Hardware badges helper for dashboard
        function formatTransportBadgeSm(tm) {
            if (tm === 0 || tm === '0') return '<span class="badge-lora-sm"><i class="fa-solid fa-tower-broadcast"></i> LoRa</span>';
            if (tm === 1 || tm === '1') return '<span class="badge-gsm-sm"><i class="fa-solid fa-signal"></i> GSM</span>';
            if (tm === 2 || tm === '2') return '<span class="badge-wifi-sm"><i class="fa-solid fa-wifi"></i> Wi-Fi</span>';
            return '';
        }

        function formatGpsMini(status) {
            if (status === 1 || status === '1') return '<span class="badge-gps-sm" title="GPS Locked"><i class="fa-solid fa-satellite"></i> Fix</span>';
            if (status === 0 || status === '0') return '<span class="badge-gps-off-sm" title="No GPS Fix"><i class="fa-solid fa-satellite-dish"></i> No Fix</span>';
            return '';
        }

        function formatWatchMini(status) {
            if (status === 1 || status === '1') return '<span class="badge-watch-sm" title="Watch Connected"><i class="fa-solid fa-stopwatch-20"></i> Watch</span>';
            if (status === 0 || status === '0') return '<span class="badge-watch-off-sm" title="Watch Disconnected"><i class="fa-solid fa-stopwatch"></i> Off</span>';
            return '';
        }

        function formatTransportDetails(tm, isOnline = true) {
            if (!isOnline) {
                return '<span style="color: #64748b; font-weight: 500;"><i class="fa-solid fa-power-off"></i> Disconnected (Offline)</span>';
            }
            if (tm === 0 || tm === '0') return '<span style="color: #c084fc; font-weight: 600;"><i class="fa-solid fa-tower-broadcast"></i> LoRa / Meshtastic (0)</span>';
            if (tm === 1 || tm === '1') return '<span style="color: #60a5fa; font-weight: 600;"><i class="fa-solid fa-signal"></i> GSM / Cellular (1)</span>';
            if (tm === 2 || tm === '2') return '<span style="color: #34d399; font-weight: 600;"><i class="fa-solid fa-wifi"></i> Wi-Fi (2)</span>';
            return '<span style="color: #64748b; font-weight: 500;">— Not Connected</span>';
        }

        function formatGpsDetails(status) {
            if (status === 1 || status === '1') return '<span style="color: #34d399; font-weight: 600;"><i class="fa-solid fa-satellite"></i> Connected (Locked)</span>';
            if (status === 0 || status === '0') return '<span style="color: #f87171; font-weight: 600;"><i class="fa-solid fa-satellite-dish"></i> Disconnected (No Fix)</span>';
            return '<span style="color: #94a3b8;">—</span>';
        }

        function formatWatchDetails(status) {
            if (status === 1 || status === '1') return '<span style="color: #38bdf8; font-weight: 600;"><i class="fa-solid fa-stopwatch-20"></i> Paired & Connected</span>';
            if (status === 0 || status === '0') return '<span style="color: #94a3b8; font-weight: 600;"><i class="fa-solid fa-slash"></i> Disconnected / Off</span>';
            return '<span style="color: #94a3b8;">—</span>';
        }

        // Fetch and Render Devices
        async function fetchDevices() {
            try {
                const res = await fetch('/api/devices');
                const devices = await res.json();
                const list = document.getElementById('sidebar-device-list');
                const tableBody = document.getElementById('devices-table-body');
                
                list.innerHTML = '';
                if(tableBody) tableBody.innerHTML = '';
                
                if (!window.deviceMarkers) window.deviceMarkers = {};
                updateMobileTrackerCount(devices.length);

                devices.forEach(device => {
                    const isOnline = !!device.isOnline;
                    // Only display connected transport badge if device is Online and has validated network
                    const transportHtml = (isOnline && device.transport_mode !== null) ? formatTransportBadgeSm(device.transport_mode) : '';
                    const gpsHtml = (isOnline && device.gps_status !== null) ? formatGpsMini(device.gps_status) : '';
                    const watchHtml = (isOnline && device.watch_status !== null) ? formatWatchMini(device.watch_status) : '';

                    // Populate Sidebar List
                    const html = `
                        <div class="device-item" id="sidebar-dev-${device.device_uid}" onclick="openDeviceDetails('${device.device_uid}')">
                            <div class="device-icon" style="color: ${isOnline ? 'var(--success)' : '#ef4444'}">
                                <i class="fa-solid ${getIconClass(device.type)}"></i>
                            </div>
                            <div class="device-info">
                                <div class="device-name">${device.device_uid}</div>
                                <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                                    <span class="device-status ${!isOnline ? 'error' : ''}" id="sidebar-dev-time-${device.device_uid}">
                                        ${isOnline ? 'Online' : 'Offline'}
                                    </span>
                                    <span id="sidebar-dev-transport-${device.device_uid}">${transportHtml}</span>
                                    <span id="sidebar-dev-gps-${device.device_uid}">${gpsHtml}</span>
                                    <span id="sidebar-dev-watch-${device.device_uid}">${watchHtml}</span>
                                </div>
                            </div>
                            <div class="edit-btn" onclick="editDevice(event, '${device.device_uid}', '${device.type || 'Person'}')" title="Edit Tracker">
                                <i class="fa-solid fa-pen"></i>
                            </div>
                            <div class="delete-btn" onclick="deleteDevice(event, '${device.device_uid}')" title="Delete Tracker">
                                <i class="fa-solid fa-trash"></i>
                            </div>
                        </div>
                    `;
                    list.insertAdjacentHTML('beforeend', html);
                    
                    // Populate Devices Table
                    if(tableBody) {
                        const battery = device.battery_percentage || 0;
                        const registeredAt = device.registered_at ? formatDatePremium(device.registered_at) : 'Unknown';
                        const netBadge = (isOnline && device.transport_mode !== null)
                            ? formatTransportBadgeSm(device.transport_mode)
                            : '<span style="color: #64748b; font-size: 0.8rem;">—</span>';
                        
                        let locStr = 'Unknown';
                        let timeStr = device.last_seen ? formatDatePremium(device.last_seen) : '<span style="color: var(--text-secondary); font-style: italic;">Awaiting Data...</span>';
                        let lastSeenContent = `<span id="last-seen-time-${device.device_uid}">${timeStr}</span>`;
                        
                        if(device.last_lat != null && device.last_lon != null) {
                            locStr = `${device.last_lat.toFixed(5)}, ${device.last_lon.toFixed(5)}`;
                            timeStr = device.last_seen ? formatDatePremium(device.last_seen) : '<span style="color: var(--text-secondary); font-style: italic;">Awaiting Data...</span>';
                            lastSeenContent = `<span id="last-seen-loc-${device.device_uid}"><i class="fa-solid fa-circle-notch fa-spin"></i> Locating...</span> &bull; <span id="last-seen-time-${device.device_uid}">${timeStr}</span>`;
                            
                            // Fire off async geocoding
                            getAddressFromCoords(device.last_lat, device.last_lon, `last-seen-loc-${device.device_uid}`);
                        }
                        
                        const tableRow = `
                            <tr style="cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'" onclick="viewLogs('${device.device_uid}')">
                                <td><strong>${device.device_uid}</strong></td>
                                <td><span style="font-size: 13px; color: var(--text-secondary);"><i class="fa-solid ${getIconClass(device.type)}" style="margin-right: 6px; color: var(--accent);"></i>${device.type || 'Person'}</span></td>
                                <td><span class="status-badge ${isOnline ? 'online' : 'offline'}" id="table-status-${device.device_uid}">${isOnline ? 'Online' : 'Offline'}</span></td>
                                <td id="table-network-${device.device_uid}">${netBadge}</td>
                                <td id="battery-table-${device.device_uid}">${battery}%</td>
                                <td id="loc-table-container-${device.device_uid}">${locStr}</td>
                                <td id="last-seen-table-${device.device_uid}">${lastSeenContent}</td>
                                <td>${registeredAt}</td>
                            </tr>
                        `;
                        tableBody.insertAdjacentHTML('beforeend', tableRow);
                    }
                    
                    // Draw markers for all devices
                    if (device.last_lat != null && device.last_lon != null) {
                        
                        // If the device has never sent data (is at the exact default center of Chennai), 
                        // add a tiny microscopic offset based on its UID so they don't perfectly overlap into a single dot!
                        let renderLat = device.last_lat;
                        let renderLon = device.last_lon;
                        if (!device.last_seen && device.last_lat === 13.0827 && device.last_lon === 80.2707) {
                            // Creates a consistent deterministic offset based on UID string length or characters
                            const offsetLat = (device.device_uid.charCodeAt(0) % 10) * 0.0005 - 0.0025;
                            const offsetLon = (device.device_uid.charCodeAt(device.device_uid.length-1) % 10) * 0.0005 - 0.0025;
                            renderLat += offsetLat;
                            renderLon += offsetLon;
                        }

                        if (!window.deviceMarkers[device.device_uid]) {
                            const marker = L.marker([renderLat, renderLon], { icon: getMapIcon(device.isOnline) })
                                .bindTooltip(device.device_uid, { permanent: false, direction: 'top', className: 'professional-tooltip' })
                                .addTo(map);
                            marker.on('click', (e) => {
                                if (e && e.originalEvent) e.originalEvent.stopPropagation();
                                openDeviceDetails(device.device_uid);
                            });
                            window.deviceMarkers[device.device_uid] = marker;
                        } else {
                            window.deviceMarkers[device.device_uid].setLatLng([renderLat, renderLon]);
                            window.deviceMarkers[device.device_uid].setIcon(getMapIcon(device.isOnline));
                        }
                        
                        // Historical track rendering omitted by configuration
                    }
                });
            } catch (err) {
                console.error("Error fetching devices:", err);
            }
        }
        
        let deviceToDelete = null;
        
        function deleteDevice(event, uid) {
            event.stopPropagation();
            deviceToDelete = uid;
            document.getElementById('delete-device-name-display').textContent = uid;
            document.getElementById('delete-confirm-modal').classList.add('active');
        }

        document.getElementById('cancel-delete-btn').addEventListener('click', () => {
            document.getElementById('delete-confirm-modal').classList.remove('active');
            deviceToDelete = null;
        });

        document.getElementById('confirm-delete-btn').addEventListener('click', async () => {
            if(!deviceToDelete) return;
            try {
                const res = await fetch(`/api/devices/${deviceToDelete}`, {
                    method: 'DELETE'
                });
                if (res.ok) {
                    if (window.deviceMarkers && window.deviceMarkers[deviceToDelete]) {
                        map.removeLayer(window.deviceMarkers[deviceToDelete]);
                        delete window.deviceMarkers[deviceToDelete];
                    }
                    if (document.getElementById('device-details-panel').classList.contains('active')) {
                        document.getElementById('device-details-panel').classList.remove('active');
                    }
                    fetchDevices();
                    document.getElementById('delete-confirm-modal').classList.remove('active');
                    deviceToDelete = null;
                } else {
                    const data = await res.json();
                    alert('Error deleting device: ' + data.error);
                }
            } catch(err) {
                console.error('Failed to delete device', err);
                alert('Failed to delete device.');
            }
        });

        async function editDevice(event, uid, currentType) {
            event.stopPropagation(); // Prevent triggering the card click
            const editModal = document.getElementById('edit-tracker-modal');
            document.getElementById('edit-tracker-uid').value = uid;
            document.getElementById('edit-tracker-uid-display').value = uid;
            
            const typeSelect = document.getElementById('edit-tracker-type');
            if (typeSelect) {
                let mappedType = currentType || 'Person';
                if (mappedType === 'Wearable' || mappedType === 'Health Band') mappedType = 'Person';
                typeSelect.value = mappedType;
            }
            
            editModal.classList.add('active');
        }

        const editForm = document.getElementById('edit-tracker-form');
        const closeEditModalBtn = document.getElementById('close-edit-modal-btn');
        const editModal = document.getElementById('edit-tracker-modal');

        if (closeEditModalBtn) {
            closeEditModalBtn.addEventListener('click', (e) => {
                e.preventDefault();
                editModal.classList.remove('active');
            });
        }

        if (editForm) {
            editForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const uid = document.getElementById('edit-tracker-uid').value;
                const typeSelect = document.getElementById('edit-tracker-type');
                const newType = typeSelect ? typeSelect.value : 'Person';
                
                try {
                    const res = await fetch(`/api/devices/${uid}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ type: newType, name: uid })
                    });
                    if (res.ok) {
                        editModal.classList.remove('active');
                        fetchDevices(); // Refresh the list
                        // Also update details panel if it's currently open for this device
                        if (detailsPanel.classList.contains('active')) {
                            openDeviceDetails(uid);
                        }
                    } else {
                        const data = await res.json();
                        alert('Error updating tracker: ' + data.error);
                    }
                } catch(err) {
                    console.error('Failed to update device', err);
                    alert('Failed to update device.');
                }
            });
        }

        // Telemetry Logs Logic
        let currentLogsData = [];
        const logsModal = document.getElementById('logs-modal');
        const closeLogsBtn = document.getElementById('close-logs-modal-btn');
        const downloadCsvBtn = document.getElementById('download-csv-btn');

        if(closeLogsBtn) {
            closeLogsBtn.addEventListener('click', () => {
                logsModal.classList.remove('active');
            });
        }

        async function viewLogs(uid) {
            const tbody = document.getElementById('logs-table-body');
            document.getElementById('logs-device-name').textContent = uid;
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Loading logs...</td></tr>';
            logsModal.classList.add('active');

            try {
                const res = await fetch(`/api/devices/${uid}/logs`);
                currentLogsData = await res.json();
                
                tbody.innerHTML = '';
                if(currentLogsData.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No telemetry data found.</td></tr>';
                    return;
                }

                currentLogsData.forEach(log => {
                    const ts = formatDatePremium(log.timestamp + 'Z');
                    const latVal = log.latitude !== undefined ? log.latitude : log.lat;
                    const lonVal = log.longitude !== undefined ? log.longitude : log.lon;
                    const lat = latVal !== null && latVal !== undefined ? latVal.toFixed(5) : 'N/A';
                    const lon = lonVal !== null && lonVal !== undefined ? lonVal.toFixed(5) : 'N/A';
                    const speed = log.speed !== null ? log.speed : '0';
                    const battery = log.battery_percentage !== null ? log.battery_percentage + '%' : 'N/A';
                    
                    const row = `
                        <tr>
                            <td>${lat}</td>
                            <td>${lon}</td>
                            <td>${speed}</td>
                            <td>${battery}</td>
                            <td>${ts}</td>
                        </tr>
                    `;
                    tbody.insertAdjacentHTML('beforeend', row);
                });
            } catch(err) {
                console.error("Failed to load logs:", err);
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: #ef4444;">Failed to load logs.</td></tr>';
            }
        }

        if(downloadCsvBtn) {
            downloadCsvBtn.addEventListener('click', () => {
                if(currentLogsData.length === 0) return alert('No data to export.');
                
                let csvContent = "data:text/csv;charset=utf-8,";
                csvContent += "Latitude,Longitude,Speed (km/h),Battery (%),Timestamp\n";
                
                currentLogsData.forEach(row => {
                    const ts = new Date(row.timestamp + 'Z').toISOString();
                    const latVal = row.latitude !== undefined ? row.latitude : row.lat;
                    const lonVal = row.longitude !== undefined ? row.longitude : row.lon;
                    csvContent += `${latVal},${lonVal},${row.speed},${row.battery_percentage},${ts}\n`;
                });
                
                const encodedUri = encodeURI(csvContent);
                const link = document.createElement("a");
                link.setAttribute("href", encodedUri);
                link.setAttribute("download", `telemetry_logs_${document.getElementById('logs-device-name').textContent.replace(/ /g, '_')}.csv`);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            });
        }

        const downloadPdfBtn = document.getElementById('download-pdf-btn');
        if(downloadPdfBtn) {
            downloadPdfBtn.addEventListener('click', () => {
                if(currentLogsData.length === 0) return alert('No data to export.');
                
                const { jsPDF } = window.jspdf;
                const doc = new jsPDF();
                
                const deviceName = document.getElementById('logs-device-name').textContent;
                doc.setFontSize(18);
                doc.text(`Telemetry Logs: ${deviceName}`, 14, 22);
                doc.setFontSize(11);
                doc.text(`Exported at: ${formatDatePremium(new Date())}`, 14, 30);
                
                const tableColumn = ["Latitude", "Longitude", "Speed (km/h)", "Battery (%)", "Timestamp"];
                const tableRows = [];

                currentLogsData.forEach(row => {
                    const ts = formatDatePremium(row.timestamp + 'Z');
                    const latVal = row.latitude !== undefined ? row.latitude : row.lat;
                    const lonVal = row.longitude !== undefined ? row.longitude : row.lon;
                    const lat = latVal !== null && latVal !== undefined ? latVal.toFixed(5) : 'N/A';
                    const lon = lonVal !== null && lonVal !== undefined ? lonVal.toFixed(5) : 'N/A';
                    const speed = row.speed !== null ? row.speed : '0';
                    const battery = row.battery_percentage !== null ? row.battery_percentage + '%' : 'N/A';
                    
                    tableRows.push([lat, lon, speed, battery, ts]);
                });

                doc.autoTable({
                    head: [tableColumn],
                    body: tableRows,
                    startY: 36,
                    theme: 'grid',
                    styles: { fontSize: 9 },
                    headStyles: { fillColor: [59, 130, 246] }
                });
                
                doc.save(`telemetry_logs_${deviceName.replace(/ /g, '_')}.pdf`);
            });
        }
        
        // Initial Fetch
        fetchDevices();

        // Device Details Panel Logic
        const detailsPanel = document.getElementById('device-details-panel');
        document.getElementById('close-details-btn').addEventListener('click', () => {
            detailsPanel.classList.remove('active');
        });

        // Clicking anywhere on map dismisses details and history panels to keep map view full and clean
        map.on('click', () => {
            if (detailsPanel && detailsPanel.classList.contains('active')) {
                detailsPanel.classList.remove('active');
            }
            if (typeof historyPanel !== 'undefined' && historyPanel && historyPanel.classList.contains('active')) {
                historyPanel.classList.remove('active');
                const historyNavBtn = document.getElementById('nav-history');
                if (historyNavBtn) historyNavBtn.classList.remove('active');
                const navMap = document.getElementById('nav-map');
                if (navMap) navMap.classList.add('active');
            }
        });

        let activeDeviceUid = null;

        async function openDeviceDetails(uid) {
            activeDeviceUid = uid;
            const hSelect = document.getElementById('history-device-select');
            if (hSelect && uid) hSelect.value = uid;
            try {
                // Auto-close sidebar on mobile/tablet so the camera flies to the pointer and it's 100% visible
                if (window.innerWidth <= 1024 && sidebarEl) {
                    sidebarEl.classList.add('collapsed');
                    if (desktopSidebarToggle) desktopSidebarToggle.style.display = 'flex';
                    if (typeof toggleMobileSidebar === 'function') toggleMobileSidebar(false);
                }

                const res = await fetch('/api/devices');
                const devices = await res.json();
                const device = devices.find(d => d.device_uid === uid);
                
                if(!device) return;

                const content = document.getElementById('details-content');
                const registeredAt = formatDatePremium(device.registered_at);
                let locStr = 'Unknown';
                let timeStr = device.last_seen ? formatDatePremium(device.last_seen) : '<span style="color: var(--text-secondary); font-style: italic;">Awaiting Data...</span>';
                let lastSeenContent = `<span id="details-last-seen-time">${timeStr}</span>`;
                
                if(device.last_lat != null && device.last_lon != null) {
                    locStr = `${device.last_lat.toFixed(5)}, ${device.last_lon.toFixed(5)}`;
                    timeStr = device.last_seen ? formatDatePremium(device.last_seen) : '<span style="color: var(--text-secondary); font-style: italic;">Awaiting Data...</span>';
                    lastSeenContent = `<span id="details-last-seen-loc"><i class="fa-solid fa-circle-notch fa-spin"></i> Locating...</span> &bull; <span id="details-last-seen-time">${timeStr}</span>`;
                }

                const battery = device.battery_percentage || 0;
                let batteryColor = 'var(--success)';
                if(battery < 20) batteryColor = '#ef4444';
                else if (battery < 50) batteryColor = '#f59e0b';

                content.innerHTML = `
                    <div class="detail-card">
                        <div style="display: flex; align-items: center; margin-bottom: 20px;">
                            <div style="background: rgba(59, 130, 246, 0.1); border-radius: 50%; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; margin-right: 15px;">
                                <i class="fa-solid ${getIconClass(device.type)}" style="color: var(--accent); font-size: 24px;"></i>
                            </div>
                            <div>
                                <h3 style="margin: 0; font-size: 18px;">${device.device_uid}</h3>
                                <span style="font-size: 12px; color: var(--text-secondary);">${device.type || 'Person'}</span>
                            </div>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Identifier</span>
                            <span class="detail-val" id="details-uid-display">${device.device_uid}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Status</span>
                            <span class="detail-val" id="details-status-val" style="color: ${device.isOnline ? 'var(--success)' : '#ef4444'}">${device.isOnline ? 'Online' : 'Offline'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Network Transport</span>
                            <span class="detail-val" id="details-transport">${formatTransportDetails(device.transport_mode, device.isOnline)}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">GPS Status</span>
                            <span class="detail-val" id="details-gps">${formatGpsDetails(device.gps_status)}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Smartwatch</span>
                            <span class="detail-val" id="details-watch">${formatWatchDetails(device.watch_status)}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Watch Battery</span>
                            <span class="detail-val" id="details-watch-batt">${(device.watch_battery != null && device.watch_battery !== -1) ? Number(device.watch_battery).toFixed(1) + '%' : '—'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Last Location</span>
                            <span class="detail-val" id="details-location">${locStr}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Registered At</span>
                            <span class="detail-val">${registeredAt}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Last Seen</span>
                            <span class="detail-val" id="details-last-seen">${lastSeenContent}</span>
                        </div>
                    </div>
                    
                    <div class="detail-card">
                        <div class="detail-row" style="margin-bottom: 2px;">
                            <span class="detail-label">Battery Level</span>
                            <span class="detail-val">${battery}%</span>
                        </div>
                        <div class="battery-bar">
                            <div class="battery-fill" style="width: ${battery}%; background: ${batteryColor};"></div>
                        </div>
                    </div>
                `;
                detailsPanel.classList.add('active');
                
                // Fire off geocoding if we have location
                if(device.last_lat != null && device.last_lon != null) {
                    getAddressFromCoords(device.last_lat, device.last_lon, 'details-last-seen-loc');
                    
                    // Professional cinematic fly-to animation for smooth zooming
                    map.flyTo([device.last_lat, device.last_lon], 16, {
                        animate: true,
                        duration: 1.5
                    });
                    
                    // Pop open the tooltip slightly after the flight finishes
                    if (window.deviceMarkers && window.deviceMarkers[uid]) {
                        setTimeout(() => {
                            window.deviceMarkers[uid].openTooltip();
                        }, 1500);
                    }
                }
                
            } catch (err) {
                console.error("Error loading details:", err);
            }
        }
        
        // Handle Tracker Registration Form Submission
        const form = document.getElementById('add-tracker-form');
        if(form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const uidInput = document.getElementById('add-tracker-uid') || form.querySelector('input');
                const select = document.getElementById('add-tracker-type') || form.querySelector('select');
                const uid = (uidInput ? uidInput.value : '').trim();
                const type = select ? select.value : 'Person';
                
                try {
                    const res = await fetch('/api/devices/register', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ device_uid: uid, name: uid, type: type })
                    });
                    if(res.ok) {
                        modal.classList.remove('active');
                        form.reset();
                        fetchDevices(); // Refresh list
                    } else {
                        const data = await res.json();
                        alert('Error: ' + data.error);
                    }
                } catch (err) {
                    console.error(err);
                    alert('Failed to register device.');
                }
            });
        }
        
        // Navigation Logic
        const navMap = document.getElementById('nav-map');
        const navDevices = document.getElementById('nav-devices');
        const devicesPage = document.getElementById('devices-page');

        if(navMap && navDevices && devicesPage) {
            navMap.addEventListener('click', () => {
                if (window.innerWidth <= 768 && typeof toggleMobileSidebar === 'function') toggleMobileSidebar(false);
                navMap.classList.add('active');
                navDevices.classList.remove('active');
                
                const hBtn = document.getElementById('nav-history');
                if(hBtn) hBtn.classList.remove('active');
                
                devicesPage.classList.remove('active');
                
                const hPanel = document.getElementById('history-panel');
                if(hPanel) hPanel.classList.remove('active');

                if(detailsPanel) detailsPanel.classList.remove('active');
                
                if(typeof clearHistoryTrack === 'function') clearHistoryTrack();
            });
            navDevices.addEventListener('click', () => {
                if (window.innerWidth <= 768 && typeof toggleMobileSidebar === 'function') toggleMobileSidebar(false);
                navDevices.classList.add('active');
                navMap.classList.remove('active');
                
                const hBtn = document.getElementById('nav-history');
                if(hBtn) hBtn.classList.remove('active');
                
                devicesPage.classList.add('active');
                detailsPanel.classList.remove('active'); // close side panel if open
                
                const hPanel = document.getElementById('history-panel');
                if(hPanel) hPanel.classList.remove('active');
                
                if(typeof clearHistoryTrack === 'function') clearHistoryTrack();
                fetchDevices(); // refresh data
            });
        }

        // ========================================================
        // PROFESSIONAL TRACKING HISTORY SYSTEM
        // Supports Allocated Dates, Exact Timestamps & Gap-Free Tracks
        // ========================================================
        let currentHistoryPolylines = [];
        let historyStartMarker = null;
        let historyEndMarker = null;
        let historyWaypointMarkers = [];
        let currentHistoryData = null; // Caches full history data for instant client-side date switching

        const historyNavBtn = document.getElementById('nav-history');
        const historyPanel = document.getElementById('history-panel');
        const closeHistoryBtn = document.getElementById('close-history-btn');
        const historyDeviceSelect = document.getElementById('history-device-select');

        // Robust date parser (handles UTC 'Z', SQLite timestamps, and ISO strings)
        function parseLogDate(dateInput) {
            if (!dateInput) return null;
            if (dateInput instanceof Date) return isNaN(dateInput.getTime()) ? null : dateInput;
            let str = String(dateInput).trim();
            while (str.endsWith('ZZ')) str = str.slice(0, -1);
            if (!str.endsWith('Z') && !str.includes('+') && !str.match(/-\d{2}:\d{2}$/)) {
                str = str.replace(' ', 'T') + 'Z';
            }
            const d = new Date(str);
            return isNaN(d.getTime()) ? new Date(dateInput) : d;
        }

        // Returns local calendar date key 'YYYY-MM-DD'
        function getLocalDateKey(dateInput) {
            const d = parseLogDate(dateInput);
            if (!d || isNaN(d.getTime())) return 'Unknown';
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        }

        // Returns friendly local date label (e.g. '21 Oct 2026')
        function formatLocalDateLabel(dateKey) {
            if (!dateKey || dateKey === 'Unknown') return 'Unknown Date';
            const parts = dateKey.split('-');
            if (parts.length !== 3) return dateKey;
            const [y, m, d] = parts;
            const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            const month = monthNames[parseInt(m, 10) - 1] || m;
            return `${parseInt(d, 10)} ${month} ${y}`;
        }

        // Returns local time only (e.g. '10:01 PM')
        function formatLocalTimeOnly(dateInput) {
            const d = parseLogDate(dateInput);
            if (!d || isNaN(d.getTime())) return '';
            let hours = d.getHours();
            const minutes = String(d.getMinutes()).padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12;
            return `${hours}:${minutes} ${ampm}`;
        }

        if(historyNavBtn) {
            historyNavBtn.addEventListener('click', () => {
                // Keep map active, just show history panel
                document.querySelectorAll('.sidebar-footer .nav-item').forEach(el => el.classList.remove('active'));
                historyNavBtn.classList.add('active');
                
                // Switch to map view if not already there
                if(devicesPage) devicesPage.classList.remove('active');
                if(detailsPanel) detailsPanel.classList.remove('active');
                
                historyPanel.classList.add('active');
                
                const currentVal = historyDeviceSelect.value || activeDeviceUid;
                // Populate the dropdown with devices
                historyDeviceSelect.innerHTML = '<option value="">-- Choose a Device --</option>';
                fetch('/api/devices')
                    .then(r => r.json())
                    .then(devices => {
                        devices.forEach(d => {
                            const opt = document.createElement('option');
                            opt.value = d.device_uid;
                            opt.textContent = `${d.device_uid} (${d.name || d.device_uid})`;
                            if (currentVal && d.device_uid === currentVal) opt.selected = true;
                            historyDeviceSelect.appendChild(opt);
                        });
                        if (currentVal) historyDeviceSelect.value = currentVal;
                    });
            });
        }

        if(closeHistoryBtn) {
            closeHistoryBtn.addEventListener('click', () => {
                historyPanel.classList.remove('active');
                historyNavBtn.classList.remove('active');
                if(navMap) navMap.classList.add('active');
            });
        }

        function setHistoryRange(type) {
            const now = new Date();
            let start = new Date();
            if (type === 'today') {
                start.setHours(0,0,0,0);
            } else if (type === 'week') {
                start.setDate(now.getDate() - 7);
            } else if (type === 'month') {
                start.setMonth(now.getMonth() - 1);
            }
            
            // Format for datetime-local: YYYY-MM-DDThh:mm
            const formatTime = (d) => {
                const pad = (n) => n.toString().padStart(2, '0');
                return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
            };
            
            document.getElementById('history-start').value = formatTime(start);
            document.getElementById('history-end').value = formatTime(now);
        }

        // Premium Toast Notification System
        function showPremiumToast(message, type = 'warning') {
            let container = document.getElementById('toast-container');
            if (!container) {
                container = document.createElement('div');
                container.id = 'toast-container';
                container.style.cssText = 'position: fixed; top: 30px; left: 50%; transform: translateX(-50%); z-index: 9999; display: flex; flex-direction: column; gap: 10px; pointer-events: none;';
                document.body.appendChild(container);
            }
            
            const toast = document.createElement('div');
            const borderColor = type === 'error' ? '#ef4444' : (type === 'success' ? '#10b981' : '#f59e0b');
            const iconHtml = type === 'error' ? '<i class="fa-solid fa-circle-exclamation" style="color: #ef4444; font-size: 18px;"></i>' : 
                             (type === 'success' ? '<i class="fa-solid fa-circle-check" style="color: #10b981; font-size: 18px;"></i>' : 
                             '<i class="fa-solid fa-triangle-exclamation" style="color: #f59e0b; font-size: 18px;"></i>');
            
            toast.style.cssText = `background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.1); border-left: 4px solid ${borderColor}; color: white; padding: 16px 24px; border-radius: 12px; font-size: 15px; font-weight: 500; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.7); display: flex; align-items: center; gap: 14px; transform: translateY(-50px); opacity: 0; transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);`;
            
            toast.innerHTML = `${iconHtml} <span style="line-height: 1.4;">${message}</span>`;
            container.appendChild(toast);
            
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    toast.style.transform = 'translateY(0)';
                    toast.style.opacity = '1';
                });
            });
            
            setTimeout(() => {
                toast.style.transform = 'translateY(-50px)';
                toast.style.opacity = '0';
                setTimeout(() => toast.remove(), 400);
            }, 4500);
        }

        async function fetchAndDrawHistory() {
            const uid = historyDeviceSelect.value;
            if (!uid) return showPremiumToast('Please select a device.', 'warning');
            
            const startVal = document.getElementById('history-start').value;
            const endVal = document.getElementById('history-end').value;
            if (!startVal || !endVal) return showPremiumToast('Please select a date range.', 'warning');

            // Convert local time back to UTC strings for DB query
            const startStr = new Date(startVal).toISOString().replace('T', ' ').substring(0, 19);
            const endStr = new Date(endVal).toISOString().replace('T', ' ').substring(0, 19);

            try {
                const res = await fetch(`/api/devices/${encodeURIComponent(uid)}/history?start=${encodeURIComponent(startStr)}&end=${encodeURIComponent(endStr)}`);
                const logs = await res.json();

                if (!logs || logs.length === 0) {
                    showPremiumToast(`No tracking history found for ${uid} in the selected time range.`, 'warning');
                    clearHistoryTrack();
                    return;
                }

                // Filter valid GPS coordinates (latitude & longitude != 0, within valid coordinate limits)
                const validLogs = [];
                logs.forEach((log) => {
                    const lat = log.latitude !== undefined ? Number(log.latitude) : Number(log.lat);
                    const lon = log.longitude !== undefined ? Number(log.longitude) : Number(log.lon);
                    if (!isNaN(lat) && !isNaN(lon) && !(lat === 0 && lon === 0) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
                        const parsedDate = parseLogDate(log.timestamp);
                        validLogs.push({
                            ...log,
                            lat,
                            lon,
                            timeObj: parsedDate,
                            dateKey: getLocalDateKey(parsedDate)
                        });
                    }
                });

                if (validLogs.length === 0) {
                    showPremiumToast(`No valid GPS coordinates found for ${uid} in this period.`, 'warning');
                    clearHistoryTrack();
                    return;
                }

                // Group validLogs by local calendar date (YYYY-MM-DD)
                const groupedByDate = {};
                validLogs.forEach(log => {
                    const dk = log.dateKey;
                    if (!groupedByDate[dk]) {
                        groupedByDate[dk] = {
                            dateKey: dk,
                            dateLabel: formatLocalDateLabel(dk),
                            logs: [],
                            firstTime: log.timestamp,
                            lastTime: log.timestamp,
                            distanceMeters: 0,
                            speeds: []
                        };
                    }
                    const group = groupedByDate[dk];
                    group.logs.push(log);
                    group.lastTime = log.timestamp;
                    if (log.speed != null && !isNaN(Number(log.speed))) group.speeds.push(Number(log.speed));
                });

                // Calculate distance for each allocated date
                Object.values(groupedByDate).forEach(group => {
                    let d = 0;
                    for (let i = 1; i < group.logs.length; i++) {
                        d += getDistanceMeters(group.logs[i-1].lat, group.logs[i-1].lon, group.logs[i].lat, group.logs[i].lon);
                    }
                    group.distanceMeters = d;
                });

                // Calculate calendar days in query range vs active days with recorded data
                const startDateObj = new Date(startVal);
                const endDateObj = new Date(endVal);
                const diffMs = Math.abs(endDateObj.getTime() - startDateObj.getTime());
                const totalQueryDays = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
                const activeDatesCount = Object.keys(groupedByDate).length;
                const inactiveDaysCount = Math.max(0, totalQueryDays - activeDatesCount);

                // Cache data globally for instant date filtering without re-querying
                currentHistoryData = {
                    uid,
                    startDateObj,
                    endDateObj,
                    totalQueryDays,
                    activeDatesCount,
                    inactiveDaysCount,
                    validLogs,
                    groupedByDate,
                    currentDateKey: 'ALL'
                };

                // Hide ALL other device fleet markers so ONLY selected device's history is shown
                if (window.deviceMarkers) {
                    Object.keys(window.deviceMarkers).forEach(deviceId => {
                        if (window.deviceMarkers[deviceId] && map.hasLayer(window.deviceMarkers[deviceId])) {
                            map.removeLayer(window.deviceMarkers[deviceId]);
                        }
                    });
                }

                // Automatically dismiss history panel to expose the map track
                const hPanel = document.getElementById('history-panel');
                if (hPanel) hPanel.classList.remove('active');
                const hNavBtn = document.getElementById('nav-history');
                if (hNavBtn) hNavBtn.classList.remove('active');
                const navMap = document.getElementById('nav-map');
                if (navMap) navMap.classList.add('active');

                // Build date filter chips and render the tracking view
                buildHistoryDateChips();
                renderHistoryTrackForDate('ALL');

                // Populate detailed date breakdown inside #history-stats side panel
                populateHistoryPanelStats();

                showPremiumToast(`${uid}: Loaded ${validLogs.length} points across ${activeDatesCount} active date(s).`, 'success');

            } catch(e) {
                console.error(e);
                showPremiumToast('Error loading tracking history.', 'error');
            }
        }

        function buildHistoryDateChips() {
            const container = document.getElementById('htb-date-chips');
            if (!container || !currentHistoryData) return;
            container.innerHTML = '';

            const { validLogs, groupedByDate, currentDateKey } = currentHistoryData;
            const dateKeys = Object.keys(groupedByDate).sort().reverse(); // Newest first

            // 1. "All Active Dates" chip
            const allChip = document.createElement('div');
            allChip.className = `htb-chip ${currentDateKey === 'ALL' ? 'active' : ''}`;
            allChip.innerHTML = `<i class="fa-solid fa-layer-group"></i> All Active Dates <span class="chip-count">${validLogs.length}</span>`;
            allChip.onclick = () => renderHistoryTrackForDate('ALL');
            container.appendChild(allChip);

            // 2. Individual Active Date chips with allocated timestamps
            dateKeys.forEach(dk => {
                const group = groupedByDate[dk];
                const firstTime = formatLocalTimeOnly(group.firstTime);
                const lastTime = formatLocalTimeOnly(group.lastTime);
                const timeSpanStr = (firstTime && lastTime && firstTime !== lastTime) ? `${firstTime} - ${lastTime}` : firstTime;

                const chip = document.createElement('div');
                chip.className = `htb-chip ${currentDateKey === dk ? 'active' : ''}`;
                chip.innerHTML = `<i class="fa-solid fa-calendar-day"></i> <strong>${group.dateLabel}</strong> <span class="chip-count">${group.logs.length}</span> <small style="opacity:0.85; font-size:0.72rem;">${timeSpanStr}</small>`;
                chip.onclick = () => renderHistoryTrackForDate(dk);
                container.appendChild(chip);
            });
        }

        function renderHistoryTrackForDate(targetDateKey) {
            if (!currentHistoryData) return;
            currentHistoryData.currentDateKey = targetDateKey;

            // Clear previous polylines, start/end markers, and waypoints
            if (currentHistoryPolylines && currentHistoryPolylines.length > 0) {
                currentHistoryPolylines.forEach(p => map.removeLayer(p));
            }
            currentHistoryPolylines = [];
            if (historyStartMarker) map.removeLayer(historyStartMarker);
            if (historyEndMarker) map.removeLayer(historyEndMarker);
            if (historyWaypointMarkers && historyWaypointMarkers.length > 0) {
                historyWaypointMarkers.forEach(m => map.removeLayer(m));
            }
            historyWaypointMarkers = [];
            historyStartMarker = null;
            historyEndMarker = null;

            const { uid, validLogs, groupedByDate, totalQueryDays, activeDatesCount, inactiveDaysCount } = currentHistoryData;

            let logsToDraw = [];
            let isSingleDate = false;

            if (targetDateKey === 'ALL') {
                logsToDraw = validLogs;
            } else if (groupedByDate[targetDateKey]) {
                logsToDraw = groupedByDate[targetDateKey].logs;
                isSingleDate = true;
            }

            if (logsToDraw.length === 0) return;

            // Calculate distance & speeds for the selected track
            let totalDist = 0;
            const speeds = [];
            for (let i = 1; i < logsToDraw.length; i++) {
                totalDist += getDistanceMeters(logsToDraw[i-1].lat, logsToDraw[i-1].lon, logsToDraw[i].lat, logsToDraw[i].lon);
                if (logsToDraw[i].speed != null && !isNaN(Number(logsToDraw[i].speed))) {
                    speeds.push(Number(logsToDraw[i].speed));
                }
            }
            const avgSpeed = speeds.length > 0 ? (speeds.reduce((a,b)=>a+b,0) / speeds.length) : 0;

            const firstLog = logsToDraw[0];
            const lastLog = logsToDraw[logsToDraw.length - 1];
            const firstTimeFormatted = formatDatePremium(firstLog.timestamp);
            const lastTimeFormatted = formatDatePremium(lastLog.timestamp);

            const isStationary = totalDist < 5 || (logsToDraw.length > 1 && logsToDraw.every(p => p.lat === firstLog.lat && p.lon === firstLog.lon));

            // CRITICAL GAP FIX: Segment polyline paths whenever time gap > 2 hours or date changes
            // This guarantees NO artificial line is drawn across inactive dates or multi-hour missing data periods
            const segments = [];
            let currentSegment = [];

            for (let i = 0; i < logsToDraw.length; i++) {
                const pt = logsToDraw[i];
                if (currentSegment.length > 0) {
                    const prevPt = currentSegment[currentSegment.length - 1];
                    const prevTime = prevPt.timeObj.getTime();
                    const currTime = pt.timeObj.getTime();
                    const diffHours = (currTime - prevTime) / (1000 * 60 * 60);

                    // If gap > 2 hours or local date changed, break into a new tracking session
                    if (diffHours > 2 || pt.dateKey !== prevPt.dateKey) {
                        segments.push(currentSegment);
                        currentSegment = [];
                    }
                }
                currentSegment.push(pt);
            }
            if (currentSegment.length > 0) segments.push(currentSegment);

            // Draw polyline segments
            if (!isStationary) {
                segments.forEach(seg => {
                    if (seg.length > 1) {
                        const poly = L.polyline(seg.map(p => [p.lat, p.lon]), {
                            color: '#f59e0b',
                            weight: 5,
                            dashArray: '8, 8',
                            lineCap: 'round',
                            lineJoin: 'round'
                        }).addTo(map);
                        currentHistoryPolylines.push(poly);
                    }
                });

                // Start Marker (Green Play Icon) with exact allocated timestamp
                const startIcon = L.divIcon({
                    className: 'custom-div-icon',
                    html: `<div style="background:#10b981; width:22px; height:22px; border-radius:50%; border:3px solid white; box-shadow:0 0 12px rgba(16,185,129,0.9); display:flex; align-items:center; justify-content:center;"><i class="fa-solid fa-play" style="font-size:9px; color:white; margin-left:1px;"></i></div>`,
                    iconSize: [28, 28],
                    iconAnchor: [14, 14]
                });
                historyStartMarker = L.marker([firstLog.lat, firstLog.lon], { icon: startIcon })
                    .bindPopup(`
                        <div style="font-size:13px; line-height:1.5; min-width:210px;">
                            <div style="font-weight:700; color:#10b981; font-size:14px; margin-bottom:4px;"><i class="fa-solid fa-play"></i> Start Point — ${uid}</div>
                            <div style="color:#e2e8f0;"><b>Allocated Time:</b> ${firstTimeFormatted}</div>
                            <div style="color:#94a3b8; font-size:12px;"><b>Coordinates:</b> ${firstLog.lat.toFixed(5)}, ${firstLog.lon.toFixed(5)}</div>
                            <div style="color:#94a3b8; font-size:12px;"><b>Speed:</b> ${firstLog.speed || 0} km/h • <b>Battery:</b> ${firstLog.battery_percentage != null ? firstLog.battery_percentage + '%' : 'N/A'}</div>
                        </div>
                    `)
                    .bindTooltip(`Start: ${firstTimeFormatted}`, { permanent: false, direction: 'top', className: 'professional-tooltip' })
                    .addTo(map);

                // End Marker (Red Stop Icon) with exact allocated timestamp
                const endIcon = L.divIcon({
                    className: 'custom-div-icon',
                    html: `<div style="background:#ef4444; width:22px; height:22px; border-radius:50%; border:3px solid white; box-shadow:0 0 12px rgba(239,68,68,0.9); display:flex; align-items:center; justify-content:center;"><i class="fa-solid fa-stop" style="font-size:9px; color:white;"></i></div>`,
                    iconSize: [28, 28],
                    iconAnchor: [14, 14]
                });
                historyEndMarker = L.marker([lastLog.lat, lastLog.lon], { icon: endIcon })
                    .bindPopup(`
                        <div style="font-size:13px; line-height:1.5; min-width:210px;">
                            <div style="font-weight:700; color:#ef4444; font-size:14px; margin-bottom:4px;"><i class="fa-solid fa-stop"></i> End Point — ${uid}</div>
                            <div style="color:#e2e8f0;"><b>Allocated Time:</b> ${lastTimeFormatted}</div>
                            <div style="color:#94a3b8; font-size:12px;"><b>Coordinates:</b> ${lastLog.lat.toFixed(5)}, ${lastLog.lon.toFixed(5)}</div>
                            <div style="color:#94a3b8; font-size:12px;"><b>Speed:</b> ${lastLog.speed || 0} km/h • <b>Battery:</b> ${lastLog.battery_percentage != null ? lastLog.battery_percentage + '%' : 'N/A'}</div>
                        </div>
                    `)
                    .bindTooltip(`End: ${lastTimeFormatted}`, { permanent: false, direction: 'top', className: 'professional-tooltip' })
                    .addTo(map);

                // Add Waypoint markers along the route (sampled if large count)
                const step = logsToDraw.length > 150 ? Math.ceil(logsToDraw.length / 60) : 1;
                for (let i = 1; i < logsToDraw.length - 1; i += step) {
                    const wp = logsToDraw[i];
                    const wpMarker = L.circleMarker([wp.lat, wp.lon], {
                        radius: 4,
                        color: '#f59e0b',
                        fillColor: '#fbbf24',
                        fillOpacity: 0.85,
                        weight: 1.5
                    }).bindPopup(`
                        <div style="font-size:12px; line-height:1.4;">
                            <b style="color:#f59e0b;">Recorded Waypoint #${i + 1}</b><br>
                            <b>Allocated Timestamp:</b> ${formatDatePremium(wp.timestamp)}<br>
                            <b>Speed:</b> ${wp.speed || 0} km/h<br>
                            <b>Battery:</b> ${wp.battery_percentage != null ? wp.battery_percentage + '%' : 'N/A'}<br>
                            <span style="color:#94a3b8; font-size:11px;">${wp.lat.toFixed(5)}, ${wp.lon.toFixed(5)}</span>
                        </div>
                    `);
                    wpMarker.addTo(map);
                    historyWaypointMarkers.push(wpMarker);
                }

                // Fit map bounds cleanly with maxZoom capped at 17 to prevent extreme zoom
                const allPoints = logsToDraw.map(p => [p.lat, p.lon]);
                const bounds = L.latLngBounds(allPoints);
                map.fitBounds(bounds, { padding: [70, 70], maxZoom: 17 });

            } else {
                // Stationary location marker
                const stationaryIcon = L.divIcon({
                    className: 'custom-div-icon',
                    html: `<div style="background:#3b82f6; width:24px; height:24px; border-radius:50%; border:3px solid white; box-shadow:0 0 14px rgba(59,130,246,0.9); display:flex; align-items:center; justify-content:center;"><i class="fa-solid fa-location-dot" style="font-size:11px; color:white;"></i></div>`,
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                });
                historyStartMarker = L.marker([firstLog.lat, firstLog.lon], { icon: stationaryIcon })
                    .bindPopup(`
                        <div style="font-size:13px; line-height:1.5; min-width:230px;">
                            <div style="font-weight:700; color:#3b82f6; font-size:14px; margin-bottom:4px;"><i class="fa-solid fa-location-dot"></i> Stationary Location — ${uid}</div>
                            <div style="color:#e2e8f0;"><b>Active Period:</b> ${firstTimeFormatted} — ${lastTimeFormatted}</div>
                            <div style="color:#e2e8f0;"><b>Logged Transmissions:</b> ${logsToDraw.length} points</div>
                            <div style="color:#94a3b8; font-size:12px;"><b>Coordinates:</b> ${firstLog.lat.toFixed(5)}, ${firstLog.lon.toFixed(5)}</div>
                            <div style="color:#38bdf8; font-size:11px; margin-top:4px;"><i class="fa-solid fa-circle-check"></i> Device remained stationary at this exact position</div>
                        </div>
                    `)
                    .bindTooltip(`${uid} — Stationary Location (${logsToDraw.length} logs)`, { permanent: true, direction: 'top', className: 'professional-tooltip' })
                    .addTo(map);

                map.setView([firstLog.lat, firstLog.lon], 16);
            }

            // Update Floating Banner HUD
            const banner = document.getElementById('history-track-banner');
            if (banner) {
                banner.style.display = 'flex';
                document.getElementById('htb-device-name').textContent = uid;
                
                const rangeLabel = isSingleDate ? formatLocalDateLabel(targetDateKey) : (totalQueryDays > 1 ? `${totalQueryDays}-Day Query` : 'Today');
                document.getElementById('htb-range-tag').textContent = rangeLabel;
                
                document.getElementById('htb-first-time').textContent = firstTimeFormatted;
                document.getElementById('htb-last-time').textContent = lastTimeFormatted;
                document.getElementById('htb-distance').textContent = (totalDist / 1000).toFixed(2) + ' km';
                document.getElementById('htb-speed').textContent = avgSpeed.toFixed(1) + ' km/h';

                // Inactive dates / filter status note
                const noteEl = document.getElementById('htb-inactive-note');
                const textEl = document.getElementById('htb-inactive-text');
                if (noteEl && textEl) {
                    noteEl.style.display = 'flex';
                    if (isSingleDate) {
                        textEl.innerHTML = `Displaying strictly <b>${formatLocalDateLabel(targetDateKey)}</b> (${logsToDraw.length} points • ${firstTimeFormatted.split(',')[1]} to ${lastTimeFormatted.split(',')[1]}). Zero data from other dates displayed.`;
                    } else {
                        if (inactiveDaysCount > 0) {
                            textEl.innerHTML = `<b>${activeDatesCount} active dates</b> with recorded data • <b>${inactiveDaysCount} inactive days</b> (zero false lines or interpolations drawn across inactive days).`;
                        } else {
                            textEl.innerHTML = `All ${activeDatesCount} dates in the selected range have active recorded transmissions.`;
                        }
                    }
                }
            }

            // Update active state of date chips
            document.querySelectorAll('#htb-date-chips .htb-chip').forEach(chip => {
                chip.classList.remove('active');
            });
            const activeChip = Array.from(document.querySelectorAll('#htb-date-chips .htb-chip')).find(c => {
                if (targetDateKey === 'ALL') return c.textContent.includes('All Active Dates');
                return c.textContent.includes(formatLocalDateLabel(targetDateKey));
            });
            if (activeChip) activeChip.classList.add('active');
        }

        function populateHistoryPanelStats() {
            if (!currentHistoryData) return;
            const { uid, validLogs, groupedByDate, totalQueryDays, activeDatesCount, inactiveDaysCount } = currentHistoryData;

            let totalDist = 0;
            const speeds = [];
            for (let i = 1; i < validLogs.length; i++) {
                totalDist += getDistanceMeters(validLogs[i-1].lat, validLogs[i-1].lon, validLogs[i].lat, validLogs[i].lon);
                if (validLogs[i].speed != null && !isNaN(Number(validLogs[i].speed))) {
                    speeds.push(Number(validLogs[i].speed));
                }
            }
            const avgSpeed = speeds.length > 0 ? (speeds.reduce((a,b)=>a+b,0) / speeds.length) : 0;

            document.getElementById('hist-points').textContent = validLogs.length;
            document.getElementById('hist-distance').textContent = (totalDist / 1000).toFixed(2) + ' km';
            document.getElementById('hist-speed').textContent = avgSpeed.toFixed(1) + ' km/h';

            // Additional allocated dates container inside #history-stats
            let breakdownContainer = document.getElementById('hist-dates-breakdown');
            if (!breakdownContainer) {
                breakdownContainer = document.createElement('div');
                breakdownContainer.id = 'hist-dates-breakdown';
                breakdownContainer.style.marginTop = '15px';
                document.getElementById('history-stats').appendChild(breakdownContainer);
            }

            const dateKeys = Object.keys(groupedByDate).sort().reverse();
            let breakdownHtml = `
                <div style="border-top: 1px solid rgba(255,255,255,0.08); padding-top: 12px; margin-top: 12px;">
                    <div style="font-size: 0.85rem; font-weight: 700; color: #fbbf24; margin-bottom: 8px; display:flex; align-items:center; gap:6px;">
                        <i class="fa-solid fa-calendar-check"></i> Allocated Transmission Dates (${activeDatesCount})
                    </div>
            `;

            dateKeys.forEach(dk => {
                const grp = groupedByDate[dk];
                const firstTime = formatDatePremium(grp.firstTime);
                const lastTime = formatDatePremium(grp.lastTime);
                breakdownHtml += `
                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 8px 10px; margin-bottom: 6px; font-size: 0.82rem;">
                        <div style="display:flex; justify-content:space-between; font-weight:600; color:#f8fafc; margin-bottom: 2px;">
                            <span>${grp.dateLabel}</span>
                            <span style="color:#10b981;">${grp.logs.length} logs</span>
                        </div>
                        <div style="color:#94a3b8; font-size: 0.75rem;">
                            <span>Start: ${firstTime.split(',')[1]}</span> • 
                            <span>End: ${lastTime.split(',')[1]}</span>
                        </div>
                        <div style="color:#94a3b8; font-size: 0.75rem; margin-top: 2px;">
                            <span>Distance: ${(grp.distanceMeters / 1000).toFixed(2)} km</span>
                        </div>
                    </div>
                `;
            });

            if (inactiveDaysCount > 0) {
                breakdownHtml += `
                    <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 8px; padding: 8px 10px; color: #fca5a5; font-size: 0.78rem; margin-top: 8px; display:flex; align-items:center; gap:6px;">
                        <i class="fa-solid fa-circle-exclamation"></i>
                        <span>${inactiveDaysCount} days in selected range had NO data received. Zero unwanted data shown.</span>
                    </div>
                `;
            }

            breakdownHtml += `</div>`;
            breakdownContainer.innerHTML = breakdownHtml;
            document.getElementById('history-stats').style.display = 'block';
        }

        function toggleHtbCollapse() {
            const body = document.getElementById('htb-body');
            const icon = document.getElementById('htb-toggle-icon');
            if (!body || !icon) return;
            if (body.style.display === 'none') {
                body.style.display = 'flex';
                icon.className = 'fa-solid fa-chevron-up';
            } else {
                body.style.display = 'none';
                icon.className = 'fa-solid fa-chevron-down';
            }
        }

        function clearHistoryTrack() {
            if (currentHistoryPolylines && currentHistoryPolylines.length > 0) {
                currentHistoryPolylines.forEach(p => map.removeLayer(p));
            }
            currentHistoryPolylines = [];

            if (historyStartMarker) map.removeLayer(historyStartMarker);
            if (historyEndMarker) map.removeLayer(historyEndMarker);
            historyStartMarker = null;
            historyEndMarker = null;

            if (historyWaypointMarkers && historyWaypointMarkers.length > 0) {
                historyWaypointMarkers.forEach(m => map.removeLayer(m));
            }
            historyWaypointMarkers = [];
            currentHistoryData = null;

            const banner = document.getElementById('history-track-banner');
            if (banner) banner.style.display = 'none';

            const hStats = document.getElementById('history-stats');
            if (hStats) hStats.style.display = 'none';

            // Restore all device fleet markers on the map
            if (window.deviceMarkers) {
                Object.values(window.deviceMarkers).forEach(marker => {
                    if (marker && !map.hasLayer(marker)) {
                        marker.addTo(map);
                    }
                });
            }
        }

        // ========================================================
        // MOBILE COMMAND CENTER & DRAWER CONTROLLER
        // ========================================================
        const mobileToggleBtn = document.getElementById('mobile-sidebar-toggle');
        const mobileCloseBtn = document.getElementById('mobile-sidebar-close');
        const sidebarEl = document.getElementById('main-sidebar');
        const sidebarBackdrop = document.getElementById('sidebar-backdrop');
        const mobileDeviceCount = document.getElementById('mobile-device-count');

        function toggleMobileSidebar(forceState) {
            if (!sidebarEl) return;
            const isOpen = typeof forceState === 'boolean' ? forceState : !sidebarEl.classList.contains('open');
            if (isOpen) {
                sidebarEl.classList.add('open');
                if (sidebarBackdrop) sidebarBackdrop.classList.add('active');
            } else {
                sidebarEl.classList.remove('open');
                if (sidebarBackdrop) sidebarBackdrop.classList.remove('active');
            }
        }

        if (mobileToggleBtn) {
            mobileToggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleMobileSidebar(true);
            });
        }
        if (mobileCloseBtn) {
            mobileCloseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleMobileSidebar(false);
            });
        }
        if (sidebarBackdrop) {
            sidebarBackdrop.addEventListener('click', () => toggleMobileSidebar(false));
        }

        function updateMobileTrackerCount(count) {
            const num = count !== undefined ? count : (window.deviceMarkers ? Object.keys(window.deviceMarkers).length : 0);
            if (mobileDeviceCount) {
                mobileDeviceCount.textContent = num;
            }
            const desktopCount = document.getElementById('desktop-device-count');
            if (desktopCount) {
                desktopCount.textContent = num;
            }
        }

        // Desktop/Tablet Sidebar Collapse Toggle
        const collapseSidebarBtn = document.getElementById('collapse-sidebar-btn');
        const desktopSidebarToggle = document.getElementById('desktop-sidebar-toggle');

        if (collapseSidebarBtn) {
            collapseSidebarBtn.addEventListener('click', () => {
                sidebarEl.classList.add('collapsed');
                if (desktopSidebarToggle) desktopSidebarToggle.style.display = 'flex';
                setTimeout(() => map.invalidateSize(), 360);
            });
        }

        if (desktopSidebarToggle) {
            desktopSidebarToggle.addEventListener('click', () => {
                sidebarEl.classList.remove('collapsed');
                desktopSidebarToggle.style.display = 'none';
                setTimeout(() => map.invalidateSize(), 360);
            });
        }

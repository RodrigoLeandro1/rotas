// --- CONSTANTES E CONFIGURAÇÕES ---
const CONFIG = {
    MAP_CENTER: { lat: -23.55052, lng: -46.633308 },
    MAP_ZOOM: 12,
    COUNTRY_RESTRICTION: "br",
    API_ENDPOINT: 'http://localhost:3000/api/optimize-route',
    COLORS: {
        PRIMARY: '#667eea',
        SUCCESS: '#10b981',
        DANGER: '#ff6b6b',
        WARNING: '#f59e0b',
        WHITE: '#ffffff',
        CURRENT: '#fbbf24'
    },
    MARKER: {
        SCALE: 10,
        STROKE_WEIGHT: 2,
        FONT_SIZE: '11px'
    },
    POLYLINE: {
        STROKE_WEIGHT: 5,
        STROKE_OPACITY: 0.8
    }
};

// --- ESTILOS DO MAPA ---
const MAP_STYLES = [
    { elementType: "geometry", stylers: [{ color: "#f5f5f5" }] },
    { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#f5f5f5" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#dadada" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#c9c9c9" }] }
];

// --- FUNÇÃO DE NOTIFICAÇÃO ---
function showNotification(message, type = 'danger') {
    let container = document.getElementById('notification-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notification-container';
        container.style.cssText = `position: fixed; top: 20px; right: 20px; z-index: 9999; width: 300px; display: flex; flex-direction: column; gap: 10px;`;
        document.body.appendChild(container);
    }
    const notification = document.createElement('div');
    const color = CONFIG.COLORS[type.toUpperCase()] || CONFIG.COLORS.DANGER;
    notification.style.cssText = `background-color: ${color}; color: white; padding: 15px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); opacity: 0; transform: translateX(100%); transition: all 0.5s; font-family: sans-serif; font-size: 14px;`;
    notification.textContent = message;
    container.appendChild(notification);
    setTimeout(() => {
        notification.style.opacity = '1';
        notification.style.transform = 'translateX(0)';
    }, 10);
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        notification.addEventListener('transitionend', () => notification.remove());
    }, 5000);
}

// --- CLASSE PRINCIPAL PARA GERENCIAR ROTAS ---
class RouteOptimizer {
    constructor() {
        this.map = null;
        this.autocomplete = null;
        this.stops = [];
        this.originalStops = []; // Para manter a ordem original
        this.routePolylines = [];
        this.routeMarkers = [];
        this.elements = {};
        this.directionsService = null;
        this.currentStopIndex = 0;
        this.routeData = null;
        this.isOptimized = false;
        this.init();
    }

    init() {
        this.cacheElements();
        this.initializeMap();
        this.initializeDirectionsService();
        this.initializeAutocomplete();
        this.bindEvents();
        this.updateUI();
    }

    cacheElements() {
        this.elements = {
            map: document.getElementById('map'),
            addressInput: document.getElementById('address-input'),
            optimizeBtn: document.getElementById('optimize-btn'),
            stopList: document.getElementById('stop-list'),
            simpleBtn: document.getElementById('view-simple-route-btn'),
            minStopsMsg: document.getElementById('min-stops-msg'),
            routeInfo: document.getElementById('route-info')
        };
    }

    initializeMap() {
        if (!this.elements.map) throw new Error('Elemento do mapa não encontrado');
        this.map = new google.maps.Map(this.elements.map, {
            zoom: CONFIG.MAP_ZOOM,
            center: CONFIG.MAP_CENTER,
            mapTypeControl: false,
            styles: MAP_STYLES,
            gestureHandling: 'cooperative',
        });
    }

    initializeDirectionsService() {
        this.directionsService = new google.maps.DirectionsService();
    }

    initializeAutocomplete() {
        if (!this.elements.addressInput) return;
        this.autocomplete = new google.maps.places.Autocomplete(this.elements.addressInput, {
            componentRestrictions: { country: CONFIG.COUNTRY_RESTRICTION },
            fields: ["formatted_address"],
        });
        this.autocomplete.addListener('place_changed', () => this.handlePlaceChanged());
    }

    bindEvents() {
        this.elements.optimizeBtn?.addEventListener('click', () => this.optimizeRoute());
        this.elements.simpleBtn?.addEventListener('click', () => this.drawSimpleRoute());
        this.elements.addressInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (!document.querySelector('.pac-item-selected')) this.handleManualAddress();
            }
        });
    }

    handlePlaceChanged() {
        const place = this.autocomplete.getPlace();
        if (place?.formatted_address) {
            this.addStop(place.formatted_address);
            this.clearInput();
        }
    }

    handleManualAddress() {
        const address = this.elements.addressInput.value.trim();
        if (address) {
            this.addStop(address);
            this.clearInput();
        }
    }

    addStop(address) {
        if (!address || this.stops.includes(address)) return;
        this.clearRoute();
        this.stops.push(address);
        this.originalStops = [...this.stops]; // Salva a ordem original
        this.currentStopIndex = 0;
        this.isOptimized = false;
        this.updateUI();
    }

    deleteStop(index) {
        if (index < 0 || index >= this.stops.length) return;
        this.clearRoute();
        this.stops.splice(index, 1);
        this.originalStops = [...this.stops]; // Atualiza a ordem original
        this.currentStopIndex = 0;
        this.isOptimized = false;
        this.updateUI();
    }

    clearInput() {
        if (this.elements.addressInput) this.elements.addressInput.value = "";
    }

    updateUI() {
        this.renderStopList();
        this.updateButtonStates();
        this.renderRouteInfo();
    }

    // --- FUNÇÃO ATUALIZADA ---
    renderStopList() {
        if (!this.elements.stopList) return;
        this.elements.stopList.innerHTML = "";
        if (this.stops.length === 0) {
            this.elements.stopList.innerHTML = '<li class="empty-state">Nenhuma parada adicionada</li>';
            return;
        }

        // Ícones SVG para um visual mais limpo e profissional
        const navIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>`;
        const deleteIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;

        this.stops.forEach((stop, index) => {
            const li = document.createElement("li");
            const isCurrentStop = index === this.currentStopIndex;
            
            li.className = 'stop-item';
            if (isCurrentStop) {
                li.classList.add('current-stop');
            }
            
            // Estrutura HTML aprimorada para melhor alinhamento
            li.innerHTML = `
                <div class="stop-content">
                    <span class="stop-number">${index + 1}</span>
                    <span class="stop-address">${this.escapeHtml(stop)}</span>
                </div>
                <div class="stop-actions">
                    <button class="icon-btn nav-btn-small" data-address="${this.escapeHtml(stop)}" title="Navegar no Google Maps">
                        ${navIcon}
                    </button>
                    <button class="icon-btn delete-btn" data-index="${index}" title="Remover parada">
                        ${deleteIcon}
                    </button>
                </div>
            `;
            this.elements.stopList.appendChild(li);
        });
        
        // Associa eventos aos novos botões
        this.elements.stopList.querySelectorAll('.nav-btn-small').forEach(button => {
            button.addEventListener('click', (e) => {
                const address = e.currentTarget.dataset.address;
                this.openDirectNavigation(address);
            });
        });
        
        this.elements.stopList.querySelectorAll('.delete-btn').forEach(button => {
            button.addEventListener('click', (e) => this.deleteStop(parseInt(e.currentTarget.dataset.index, 10)));
        });
    }

    openDirectNavigation(address) {
        const encodedAddress = encodeURIComponent(address);
        const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodedAddress}&travelmode=driving`;
        window.open(mapsUrl, '_blank');
        showNotification(`Navegando para: ${address}`, 'success');
    }

    renderRouteInfo() {
        if (!this.elements.routeInfo) return;
        
        if (this.stops.length === 0 || !this.routeData) {
            this.elements.routeInfo.innerHTML = '';
            return;
        }

        const currentStop = this.stops[this.currentStopIndex];
        const nextStopIndex = this.currentStopIndex + 1;
        const nextStop = nextStopIndex < this.stops.length ? this.stops[nextStopIndex] : null;
        
        const totalDistance = this.calculateTotalDistance();
        const totalDuration = this.calculateTotalDuration();
        const optimizedLabel = this.isOptimized ? ' (Otimizada)' : '';

        this.elements.routeInfo.innerHTML = `
            <div class="route-summary">
                <h3>📍 Destino Atual: ${currentStop}</h3>
                <div class="route-stats">
                    <span>📏 Distância total: ${totalDistance}</span>
                    <span>⏱️ Tempo total: ${totalDuration}</span>
                    <span>🎯 Parada: ${this.currentStopIndex + 1}/${this.stops.length}${optimizedLabel}</span>
                </div>
                <div class="navigation-buttons">
                    <button id="open-maps-btn" class="nav-btn maps-btn">
                        🗺️ Abrir no Google Maps
                    </button>
                    ${nextStop ? `
                        <button id="next-stop-btn" class="nav-btn next-btn">
                            ➡️ Próximo Destino
                        </button>
                    ` : `
                        <button id="finish-route-btn" class="nav-btn finish-btn">
                            🏁 Rota Finalizada
                        </button>
                    `}
                </div>
                ${nextStop ? `<p class="next-destination">Próximo: ${nextStop}</p>` : ''}
            </div>
        `;

        this.bindNavigationEvents();
    }

    bindNavigationEvents() {
        const openMapsBtn = document.getElementById('open-maps-btn');
        const nextStopBtn = document.getElementById('next-stop-btn');
        const finishRouteBtn = document.getElementById('finish-route-btn');

        if (openMapsBtn) {
            openMapsBtn.addEventListener('click', () => this.openInGoogleMaps());
        }

        if (nextStopBtn) {
            nextStopBtn.addEventListener('click', () => this.goToNextStop());
        }

        if (finishRouteBtn) {
            finishRouteBtn.addEventListener('click', () => this.finishRoute());
        }
    }

    openInGoogleMaps() {
        if (this.stops.length === 0) return;
        
        const currentDestination = encodeURIComponent(this.stops[this.currentStopIndex]);
        const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${currentDestination}&travelmode=driving`;
        
        window.open(mapsUrl, '_blank');
        showNotification(`Abrindo ${this.stops[this.currentStopIndex]} no Google Maps`, 'success');
    }

    goToNextStop() {
        if (this.currentStopIndex < this.stops.length - 1) {
            this.currentStopIndex++;
            this.updateMarkerColors();
            this.updateUI();
            showNotification(`Próximo destino: ${this.stops[this.currentStopIndex]}`, 'warning');
        }
    }

    finishRoute() {
        showNotification('🎉 Rota finalizada com sucesso!', 'success');
        this.currentStopIndex = 0;
        this.updateMarkerColors();
        this.updateUI();
    }

    updateMarkerColors() {
        this.routeMarkers.forEach((marker, index) => {
            let color = CONFIG.COLORS.PRIMARY;
            
            if (index === 0) {
                color = CONFIG.COLORS.SUCCESS; 
            } else if (index === this.routeMarkers.length - 1) {
                color = CONFIG.COLORS.DANGER;
            } else if (index === this.currentStopIndex) {
                color = CONFIG.COLORS.CURRENT; 
            }
            
            marker.setIcon({
                path: google.maps.SymbolPath.CIRCLE,
                scale: CONFIG.MARKER.SCALE,
                fillColor: color,
                fillOpacity: 1,
                strokeWeight: CONFIG.MARKER.STROKE_WEIGHT,
                strokeColor: CONFIG.COLORS.WHITE,
            });
        });
    }

    calculateTotalDistance() {
        if (!this.routeData?.routes?.[0]?.legs) return 'N/A';
        const totalMeters = this.routeData.routes[0].legs.reduce((total, leg) => {
            return total + (leg.distance?.value || 0);
        }, 0);
        return totalMeters > 1000 ? `${(totalMeters / 1000).toFixed(1)} km` : `${totalMeters} m`;
    }

    calculateTotalDuration() {
        if (!this.routeData?.routes?.[0]?.legs) return 'N/A';
        const totalSeconds = this.routeData.routes[0].legs.reduce((total, leg) => {
            return total + (leg.duration?.value || 0);
        }, 0);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        return hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`;
    }

    updateButtonStates() {
        const stopCount = this.stops.length;
        const canProcess = stopCount >= 2;
        if (this.elements.optimizeBtn) this.elements.optimizeBtn.disabled = !canProcess;
        if (this.elements.simpleBtn) this.elements.simpleBtn.disabled = !canProcess;
        if (this.elements.minStopsMsg) {
            this.elements.minStopsMsg.style.display = canProcess ? 'none' : 'block';
            this.elements.optimizeBtn.style.display = canProcess ? 'block' : 'none';
            this.elements.simpleBtn.style.display = canProcess ? 'block' : 'none';
            if (!canProcess) this.elements.minStopsMsg.textContent = `Adicione pelo menos 2 paradas (${stopCount}/2)`;
        }
    }

    async optimizeRoute() {
        if (this.stops.length < 2) return;
        this.clearRoute();
        this.setLoadingState(true);
        try {
            console.log('Endereços antes da otimização:', this.stops);
            
            const response = await fetch(CONFIG.API_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ addresses: this.stops }),
            });
            
            const responseData = await response.json();
            if (!response.ok) throw new Error(responseData.message || `Erro do servidor: ${response.status}`);
            
            console.log('Resposta da API:', responseData);
            
            this.routeData = responseData;
            this.currentStopIndex = 0;
            this.processOptimizedRoute(responseData);
            this.isOptimized = true;
            
            showNotification('Rota otimizada com sucesso!', 'success');
        } catch (error) {
            console.error('Erro detalhado ao otimizar rota:', error);
            showNotification(`Erro ao otimizar: ${error.message}`, 'danger');
        } finally {
            this.setLoadingState(false);
        }
    }

    processOptimizedRoute(routeData) {
        if (!routeData?.routes?.[0]) {
            throw new Error("Resposta da API de rotas é inválida.");
        }
        
        const route = routeData.routes[0];
        console.log('Processando rota otimizada:', route);
        
        if (route.waypoint_order && route.waypoint_order.length > 0 && this.stops.length > 2) {
            const origin = this.stops[0];
            const destination = this.stops[this.stops.length - 1];
            const waypoints = this.stops.slice(1, -1);
            
            console.log('Waypoints originais:', waypoints);
            console.log('Ordem otimizada (índices):', route.waypoint_order);
            
            const optimizedWaypoints = route.waypoint_order.map(index => {
                if (index >= 0 && index < waypoints.length) {
                    return waypoints[index];
                }
                console.warn(`Índice inválido: ${index}`);
                return null;
            }).filter(wp => wp !== null);
            
            console.log('Waypoints otimizados:', optimizedWaypoints);
            
            this.stops = [origin, ...optimizedWaypoints, destination];
            
            console.log('Nova ordem das paradas:', this.stops);
            
            this.calculateOptimizationSavings(route);
            
        } else {
            console.log('Rota simples (apenas origem e destino) ou sem otimização necessária');
        }
        
        this.drawRouteFromAPI(route);
        this.updateUI();
    }

    calculateOptimizationSavings(route) {
        if (!route.legs) return;
        
        const totalDistance = route.legs.reduce((sum, leg) => sum + (leg.distance?.value || 0), 0);
        const totalDuration = route.legs.reduce((sum, leg) => sum + (leg.duration?.value || 0), 0);
        
        console.log(`Rota otimizada: ${(totalDistance/1000).toFixed(1)}km, ${Math.round(totalDuration/60)}min`);
        
        showNotification(
            `🎯 Rota otimizada: ${(totalDistance/1000).toFixed(1)}km em ${Math.round(totalDuration/60)}min`,
            'success'
        );
    }

    drawSimpleRoute() {
        if (this.stops.length < 2) return;
        this.clearRoute();
        this.setLoadingState(true, 'simple');
        
        const request = {
            origin: this.stops[0],
            destination: this.stops[this.stops.length - 1],
            waypoints: this.stops.slice(1, -1).map(address => ({ location: address, stopover: true })),
            travelMode: google.maps.TravelMode.DRIVING,
            optimizeWaypoints: false
        };
        
        this.directionsService.route(request, (result, status) => {
            if (status === 'OK') {
                this.routeData = result;
                this.currentStopIndex = 0;
                this.isOptimized = false;
                this.drawDirectionsRoute(result);
                showNotification('Rota simples calculada!', 'success');
            } else {
                showNotification(`Não foi possível calcular a rota: ${status}`, 'danger');
            }
            this.setLoadingState(false, 'simple');
        });
    }

    drawDirectionsRoute(directionsResult) {
        this.clearRoute();
        const route = directionsResult.routes[0];
        const bounds = new google.maps.LatLngBounds();
        
        const polyline = new google.maps.Polyline({
            path: route.overview_path,
            strokeColor: CONFIG.COLORS.PRIMARY,
            strokeOpacity: CONFIG.POLYLINE.STROKE_OPACITY,
            strokeWeight: CONFIG.POLYLINE.STROKE_WEIGHT,
            map: this.map,
        });
        this.routePolylines.push(polyline);
        route.overview_path.forEach(point => bounds.extend(point));
        
        this.addMarker(route.legs[0].start_location, `1`, CONFIG.COLORS.SUCCESS);
        
        route.legs.forEach((leg, index) => {
            const label = `${index + 2}`;
            const color = (index === route.legs.length - 1) ? CONFIG.COLORS.DANGER : CONFIG.COLORS.PRIMARY;
            this.addMarker(leg.end_location, label, color);
        });

        this.map.fitBounds(bounds);
        this.updateUI();
    }
    
    drawRouteFromAPI(route) {
        this.clearRoute();
        const bounds = new google.maps.LatLngBounds();
        
        if (!google.maps.geometry?.encoding) {
            showNotification("Erro: biblioteca 'geometry' do Google Maps não carregada.", "danger");
            return;
        }
        
        const routePath = google.maps.geometry.encoding.decodePath(route.overview_polyline.points);
        const polyline = new google.maps.Polyline({
            path: routePath,
            strokeColor: CONFIG.COLORS.PRIMARY,
            strokeOpacity: CONFIG.POLYLINE.STROKE_OPACITY,
            strokeWeight: CONFIG.POLYLINE.STROKE_WEIGHT,
            map: this.map,
        });
        this.routePolylines.push(polyline);
        routePath.forEach(point => bounds.extend(point));

        this.addMarker(route.legs[0].start_location, `1`, CONFIG.COLORS.SUCCESS);

        route.legs.forEach((leg, index) => {
            const label = `${index + 2}`;
            const color = (index === route.legs.length - 1) ? CONFIG.COLORS.DANGER : CONFIG.COLORS.PRIMARY;
            this.addMarker(leg.end_location, label, color);
        });
        
        this.map.fitBounds(bounds);
        this.updateMarkerColors();
    }

    addMarker(position, label, color) {
        const marker = new google.maps.Marker({
            position,
            map: this.map,
            label: { 
                text: label, 
                color: CONFIG.COLORS.WHITE, 
                fontSize: CONFIG.MARKER.FONT_SIZE, 
                fontWeight: "bold" 
            },
            icon: { 
                path: google.maps.SymbolPath.CIRCLE, 
                scale: CONFIG.MARKER.SCALE, 
                fillColor: color, 
                fillOpacity: 1, 
                strokeWeight: CONFIG.MARKER.STROKE_WEIGHT, 
                strokeColor: CONFIG.COLORS.WHITE 
            },
        });
        this.routeMarkers.push(marker);
    }

    clearRoute() {
        this.routePolylines.forEach(line => line.setMap(null));
        this.routePolylines = [];
        this.routeMarkers.forEach(marker => marker.setMap(null));
        this.routeMarkers = [];
        this.routeData = null;
        if(this.elements.routeInfo) this.elements.routeInfo.innerHTML = '';
    }

    setLoadingState(isLoading, type = 'optimize') {
        const button = type === 'optimize' ? this.elements.optimizeBtn : this.elements.simpleBtn;
        const text = type === 'optimize' ? 'Otimizar Rota' : 'Ver Rota Simples';
        const loadingText = type === 'optimize' ? 'Otimizando...' : 'Carregando...';
        if (button) {
            button.disabled = isLoading;
            button.innerHTML = isLoading ? `<span class="spinner"></span> ${loadingText}` : text;
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

function initMap() {
    try {
        new RouteOptimizer();
    } catch (error) {
        console.error('Erro ao inicializar o mapa:', error);
        showNotification('Não foi possível carregar a aplicação de rotas.', 'danger');
    }
}
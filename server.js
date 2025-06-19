// 1. IMPORTAÇÕES
const express = require('express');
const cors = require('cors');
const { Client } = require('@googlemaps/google-maps-services-js');
require('dotenv').config();

// 2. CONSTANTES E CONFIGURAÇÕES INICIAIS
const app = express();
const PORT = process.env.PORT || 3000;
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

if (!GOOGLE_MAPS_API_KEY) {
    console.error('❌ CRÍTICO: GOOGLE_MAPS_API_KEY não encontrada no arquivo .env');
    process.exit(1);
}

// 3. CONFIGURAÇÃO DO CORS
const allowedOrigins = [
    'https://rotas0five.onrender.com'
];

const corsOptions = {
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Não permitido pela política de CORS'));
        }
    },
    credentials: true
};

// 4. CONFIGURAÇÃO DOS MIDDLEWARES DO EXPRESS
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 5. FUNÇÕES AUXILIARES (Lógica do Negócio)
const googleMapsClient = new Client({});

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function cleanAddress(address) {
    if (!address || typeof address !== 'string') throw new Error('Endereço inválido');
    return address.trim().replace(/\s+/g, ' ');
}

function validateAddresses(addresses) {
    if (!Array.isArray(addresses)) throw new Error('O corpo da requisição deve conter um array de "addresses"');
    if (addresses.length < 2) throw new Error('São necessários pelo menos 2 endereços');
    if (addresses.length > 25) throw new Error('Máximo de 25 endereços permitidos');
    return addresses.map(addr => {
        const cleaned = cleanAddress(addr);
        if (cleaned.length < 3) throw new Error(`Endereço muito curto: "${addr}"`);
        return cleaned;
    });
}

async function makeDirectionsRequest(params, maxRetries = 3) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🔄 Tentativa ${attempt} - Enviando requisição para Google Maps API`);
            const response = await googleMapsClient.directions({ params: { ...params, key: GOOGLE_MAPS_API_KEY } });
            if (response.data.status === 'OK') {
                return response;
            } else {
                lastError = new Error(response.data.error_message || response.data.status);
                break;
            }
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries) {
                console.log(`⏳ Aguardando ${Math.pow(2, attempt)}s antes da próxima tentativa...`);
                await delay(Math.pow(2, attempt) * 1000);
            }
        }
    }
    throw lastError;
}

// Nova função para obter matriz de distâncias
async function getDistanceMatrix(addresses) {
    try {
        const response = await googleMapsClient.distancematrix({
            params: {
                origins: addresses,
                destinations: addresses,
                units: 'metric',
                mode: 'driving',
                language: 'pt-BR',
                region: 'BR',
                key: GOOGLE_MAPS_API_KEY
            }
        });
        
        if (response.data.status !== 'OK') {
            throw new Error(`Erro na Distance Matrix API: ${response.data.status}`);
        }
        
        return response.data;
    } catch (error) {
        console.error('❌ Erro ao obter matriz de distâncias:', error.message);
        throw error;
    }
}

// Algoritmo para encontrar a rota mais curta (Traveling Salesman Problem - versão simplificada)
function findOptimalRoute(distanceMatrix, addresses) {
    const n = addresses.length;
    
    // Para 2 endereços, retorna a ordem original
    if (n === 2) {
        return { addresses, totalDistance: 0, optimized: false };
    }
    
    console.log('📊 Calculando rota otimizada por distância...');
    
    // Extrai as distâncias da matriz
    const distances = distanceMatrix.rows.map(row => 
        row.elements.map(element => 
            element.status === 'OK' ? element.distance.value : Infinity
        )
    );
    
    // Algoritmo de vizinho mais próximo (Nearest Neighbor)
    function nearestNeighborTSP(distances) {
        const n = distances.length;
        const visited = new Array(n).fill(false);
        const route = [];
        let currentCity = 0; // Sempre começa do primeiro endereço
        let totalDistance = 0;
        
        route.push(currentCity);
        visited[currentCity] = true;
        
        for (let i = 1; i < n; i++) {
            let nearestCity = -1;
            let nearestDistance = Infinity;
            
            for (let j = 0; j < n; j++) {
                if (!visited[j] && distances[currentCity][j] < nearestDistance) {
                    nearestDistance = distances[currentCity][j];
                    nearestCity = j;
                }
            }
            
            if (nearestCity !== -1) {
                route.push(nearestCity);
                visited[nearestCity] = true;
                totalDistance += nearestDistance;
                currentCity = nearestCity;
            }
        }
        
        return { route, totalDistance };
    }
    
    // Para mais de 10 endereços, usa algoritmo mais simples por performance
    if (n > 10) {
        const result = nearestNeighborTSP(distances);
        const optimizedAddresses = result.route.map(index => addresses[index]);
        
        console.log('🎯 Rota otimizada (Nearest Neighbor):', optimizedAddresses.map((addr, i) => `${i+1}. ${addr}`));
        console.log(`📏 Distância total estimada: ${(result.totalDistance / 1000).toFixed(2)} km`);
        
        return {
            addresses: optimizedAddresses,
            totalDistance: result.totalDistance,
            optimized: true
        };
    }
    
    // Para até 10 endereços, tenta algumas permutações para melhor resultado
    let bestRoute = null;
    let bestDistance = Infinity;
    const maxIterations = Math.min(5000, Math.factorial(n - 1)); // Limita iterações
    
    // Gera permutações fixando o primeiro endereço como origem
    function generatePermutations(arr, start = 0) {
        if (start >= arr.length - 1) return [arr.slice()];
        
        const result = [];
        for (let i = start; i < arr.length; i++) {
            [arr[start], arr[i]] = [arr[i], arr[start]];
            result.push(...generatePermutations(arr, start + 1));
            [arr[start], arr[i]] = [arr[i], arr[start]];
        }
        return result;
    }
    
    // Gera algumas permutações dos endereços intermediários (exceto o primeiro)
    const intermediateIndices = Array.from({length: n - 1}, (_, i) => i + 1);
    const permutations = generatePermutations(intermediateIndices).slice(0, maxIterations);
    
    console.log(`🔄 Testando ${permutations.length} combinações de rotas...`);
    
    for (const perm of permutations) {
        const route = [0, ...perm]; // Sempre começa do índice 0
        let totalDistance = 0;
        let valid = true;
        
        for (let i = 0; i < route.length - 1; i++) {
            const dist = distances[route[i]][route[i + 1]];
            if (dist === Infinity) {
                valid = false;
                break;
            }
            totalDistance += dist;
        }
        
        if (valid && totalDistance < bestDistance) {
            bestDistance = totalDistance;
            bestRoute = route.slice();
        }
    }
    
    // Se não encontrou rota válida, usa vizinho mais próximo
    if (!bestRoute) {
        const result = nearestNeighborTSP(distances);
        bestRoute = result.route;
        bestDistance = result.totalDistance;
    }
    
    const optimizedAddresses = bestRoute.map(index => addresses[index]);
    
    console.log('🎯 Rota otimizada por distância:', optimizedAddresses.map((addr, i) => `${i+1}. ${addr}`));
    console.log(`📏 Distância total: ${(bestDistance / 1000).toFixed(2)} km`);
    
    return {
        addresses: optimizedAddresses,
        totalDistance: bestDistance,
        optimized: true
    };
}

// Adiciona função auxiliar para fatorial
Math.factorial = function(n) {
    if (n <= 1) return 1;
    return n * Math.factorial(n - 1);
};

// 6. DEFINIÇÃO DAS ROTAS DA API
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/optimize-route', async (req, res, next) => {
    try {
        const cleanedAddresses = validateAddresses(req.body.addresses);
        console.log('📍 Endereços recebidos:', cleanedAddresses);
        
        // Se apenas 2 endereços, faz rota direta
        if (cleanedAddresses.length === 2) {
            const directionsParams = {
                origin: cleanedAddresses[0],
                destination: cleanedAddresses[1],
                language: 'pt-BR',
                region: 'BR',
                units: 'metric',
                mode: 'driving',
            };
            
            const response = await makeDirectionsRequest(directionsParams);
            console.log('✅ Rota direta calculada com sucesso');
            return res.status(200).json(response.data);
        }
        
        // Para mais de 2 endereços, otimiza por distância
        console.log('🔍 Obtendo matriz de distâncias...');
        const distanceMatrix = await getDistanceMatrix(cleanedAddresses);
        
        console.log('🧮 Calculando rota otimizada...');
        const optimizedRoute = findOptimalRoute(distanceMatrix, cleanedAddresses);
        
        // Agora calcula a rota otimizada usando o Google Directions API
        const origin = optimizedRoute.addresses[0];
        const destination = optimizedRoute.addresses[optimizedRoute.addresses.length - 1];
        const waypoints = optimizedRoute.addresses.slice(1, -1);
        
        const directionsParams = {
            origin: origin,
            destination: destination,
            waypoints: waypoints,
            optimizeWaypoints: false, // Desabilitamos pois já otimizamos manualmente
            language: 'pt-BR',
            region: 'BR',
            units: 'metric',
            mode: 'driving',
        };
        
        console.log('📍 Calculando rota final otimizada...');
        const response = await makeDirectionsRequest(directionsParams);
        
        // Adiciona informações sobre a otimização na resposta
        response.data.optimization_info = {
            original_order: cleanedAddresses,
            optimized_order: optimizedRoute.addresses,
            estimated_distance_saved: optimizedRoute.totalDistance,
            optimization_applied: optimizedRoute.optimized
        };
        
        console.log('✅ Rota otimizada por distância calculada com sucesso');
        console.log('📊 Ordem original:', cleanedAddresses);
        console.log('📊 Ordem otimizada:', optimizedRoute.addresses);
        
        res.status(200).json(response.data);

    } catch (error) {
        next(error);
    }
});

// 7. HANDLERS DE ERRO E 404 (SEMPRE NO FINAL)
app.use((req, res, next) => {
    res.status(404).json({ error: true, message: 'Endpoint não encontrado' });
});

app.use((error, req, res, next) => {
    console.error("❌ Um erro ocorreu:", error.message);

    if (error.message.includes('Não permitido pela política de CORS')) {
        return res.status(403).json({ error: true, message: 'Erro de CORS' });
    }
    if (error.message.includes('endereço') || error.message.includes('array') || error.message.includes('necessários')) {
        return res.status(400).json({ error: true, message: error.message });
    }

    res.status(500).json({ error: true, message: 'Erro interno do servidor.' });
});

// 8. INICIALIZAÇÃO DO SERVIDOR
app.listen(PORT, () => {
    console.log(`\n🚀 Servidor backend iniciado em http://localhost:${PORT}`);
    console.log('🎯 Otimização por distância ativada!');
});

const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3001;

// Enable CORS for your frontend
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true
}));

// Store your API key securely as an environment variable
const FRED_API_KEY = process.env.FRED_API_KEY || 'baf5a172a9b068e621dd4f80fc13dad2';

// Cache to reduce API calls
const cache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Helper function to build cache key
const getCacheKey = (seriesId, startDate, endDate) => {
    return `${seriesId}-${startDate}-${endDate}`;
};

// Main endpoint to fetch FRED data
app.get('/api/fred/:seriesId', async (req, res) => {
    const { seriesId } = req.params;
    const { start_date, end_date, sort_order = 'desc' } = req.query;
    
    if (!seriesId) {
        return res.status(400).json({ error: 'Missing series_id parameter' });
    }
    
    if (!FRED_API_KEY) {
        console.error('FRED_API_KEY is not set on the server.');
        return res.status(500).json({ error: 'Server configuration error' });
    }
    
    // Check cache first
    const cacheKey = getCacheKey(seriesId, start_date, end_date);
    const cachedData = cache.get(cacheKey);
    
    if (cachedData && Date.now() - cachedData.timestamp < CACHE_DURATION) {
        console.log(`Cache hit for ${seriesId}`);
        return res.json(cachedData.data);
    }
    
    // Build FRED API URL
    let fredURL = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=${sort_order}`;
    
    if (start_date) fredURL += `&observation_start=${start_date}`;
    if (end_date) fredURL += `&observation_end=${end_date}`;
    
    try {
        console.log(`Fetching ${seriesId} from FRED API...`);
        const response = await fetch(fredURL);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('FRED API Error:', response.status, errorText);
            return res.status(response.status).json({ 
                error: 'Failed to fetch data from FRED', 
                details: errorText 
            });
        }
        
        const data = await response.json();
        
        // Cache the successful response
        cache.set(cacheKey, {
            data: data,
            timestamp: Date.now()
        });
        
        res.json(data);
    } catch (error) {
        console.error('Error fetching from FRED API:', error);
        res.status(500).json({ 
            error: 'Internal server error when fetching data',
            message: error.message 
        });
    }
});

// Endpoint to fetch multiple series at once (for efficiency)
app.post('/api/fred/multiple', express.json(), async (req, res) => {
    const { series, start_date, end_date } = req.body;
    
    if (!series || !Array.isArray(series)) {
        return res.status(400).json({ error: 'Missing or invalid series array' });
    }
    
    try {
        const results = {};
        const promises = series.map(async (seriesId) => {
            const cacheKey = getCacheKey(seriesId, start_date, end_date);
            const cachedData = cache.get(cacheKey);
            
            if (cachedData && Date.now() - cachedData.timestamp < CACHE_DURATION) {
                results[seriesId] = cachedData.data;
                return;
            }
            
            let fredURL = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc`;
            if (start_date) fredURL += `&observation_start=${start_date}`;
            if (end_date) fredURL += `&observation_end=${end_date}`;
            
            const response = await fetch(fredURL);
            if (response.ok) {
                const data = await response.json();
                cache.set(cacheKey, {
                    data: data,
                    timestamp: Date.now()
                });
                results[seriesId] = data;
            } else {
                results[seriesId] = { error: `Failed to fetch ${seriesId}` };
            }
        });
        
        await Promise.all(promises);
        res.json(results);
    } catch (error) {
        console.error('Error fetching multiple series:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            message: error.message 
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        cache_size: cache.size,
        api_key_configured: !!FRED_API_KEY 
    });
});

// Clear cache endpoint (useful for maintenance)
app.post('/api/cache/clear', (req, res) => {
    cache.clear();
    res.json({ message: 'Cache cleared', cache_size: 0 });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({ 
        message: 'FRED API Proxy Server',
        endpoints: {
            health: '/api/health',
            fred_single: '/api/fred/:seriesId',
            fred_multiple: '/api/fred/multiple',
            cache_clear: '/api/cache/clear'
        }
    });
});

app.listen(port, () => {
    console.log(`FRED proxy server listening at http://localhost:${port}`);
    console.log(`Frontend URL: ${process.env.FRONTEND_URL || '*'}`);
    console.log(`API Key configured: ${!!FRED_API_KEY}`);
});

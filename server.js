const express = require('express');
const cors = require('cors');
// const fetch = require('node-fetch'); // Uncomment if you are using Node.js v16 or earlier and need node-fetch
// For Node.js v18+ (which Vercel typically uses), global fetch is available.

const app = express();
const port = process.env.PORT || 3001;

// Enable CORS for your frontend or all origins if FRONTEND_URL is not set
app.use(cors({
    origin: process.env.FRONTEND_URL || '*', // Be more specific in production if possible
    credentials: true // If your frontend needs to send cookies or authorization headers
}));

// Get the API key from environment variables.
// IMPORTANT: Ensure FRED_API_KEY is set in your Vercel project's environment variables.
const FRED_API_KEY = process.env.FRED_API_KEY;

// Cache to reduce API calls
const cache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Helper function to build cache key
const getCacheKey = (seriesId, startDate, endDate) => {
    return `${seriesId}-${startDate || 'none'}-${endDate || 'none'}`; // Handle undefined dates in key
};

// Main endpoint to fetch FRED data for a single series
app.get('/api/fred/:seriesId', async (req, res) => {
    const { seriesId } = req.params; // This is the seriesId received from your frontend
    const { start_date, end_date, sort_order = 'desc' } = req.query;
    
    console.log(`[BACKEND RECEIVED /api/fred/:seriesId] Request for series_id: "${seriesId}", start: "${start_date}", end: "${end_date}"`);

    if (!seriesId) {
        console.warn('[VALIDATION ERROR] Missing series_id parameter');
        return res.status(400).json({ error: 'Missing series_id parameter' });
    }
    
    // Simplified API Key Check: Just check if it's missing/empty.
    if (!FRED_API_KEY) {
        console.error('[CONFIG ERROR] FRED_API_KEY is not set on the server. Please configure it in Vercel environment variables.');
        return res.status(500).json({ error: 'Server configuration error: FRED API Key is missing.' });
    }
    
    const cacheKey = getCacheKey(seriesId, start_date, end_date);
    const cachedData = cache.get(cacheKey);
    
    if (cachedData && Date.now() - cachedData.timestamp < CACHE_DURATION) {
        console.log(`[CACHE] Cache hit for "${seriesId}"`);
        return res.json(cachedData.data);
    }
    console.log(`[CACHE] Cache miss for "${seriesId}". Fetching from FRED.`);
    
    let fredURL = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(seriesId)}&api_key=${FRED_API_KEY}&file_type=json&sort_order=${encodeURIComponent(sort_order)}`;
    
    if (start_date) fredURL += `&observation_start=${encodeURIComponent(start_date)}`;
    if (end_date) fredURL += `&observation_end=${encodeURIComponent(end_date)}`;
    
    console.log(`[FRED REQUEST URL] Attempting to fetch: ${fredURL}`);
    
    try {
        const response = await fetch(fredURL); 
        
        if (!response.ok) {
            const errorText = await response.text(); 
            console.error(`[FRED ERROR] FRED API Error for series "${seriesId}": ${response.status}`, errorText);
            let errorDetails;
            try {
                errorDetails = JSON.parse(errorText);
            } catch (e) {
                errorDetails = errorText; 
            }
            return res.status(response.status).json({ 
                error: `Failed to fetch data from FRED for series ${seriesId}`, 
                details: errorDetails 
            });
        }
        
        const data = await response.json();
        
        cache.set(cacheKey, {
            data: data,
            timestamp: Date.now()
        });
        console.log(`[CACHE] Cached data for "${seriesId}"`);
        
        res.json(data);
    } catch (error) {
        console.error(`[SERVER ERROR] Error fetching from FRED API for series "${seriesId}":`, error);
        res.status(500).json({ 
            error: 'Internal server error when fetching data',
            message: error.message 
        });
    }
});

// Endpoint to fetch multiple series at once
app.post('/api/fred/multiple', express.json(), async (req, res) => {
    const { series, start_date, end_date } = req.body;
    console.log(`[BACKEND RECEIVED /api/fred/multiple] Request for series: ${series ? series.join(', ') : '[]'}`);
    
    if (!series || !Array.isArray(series) || series.length === 0) {
        return res.status(400).json({ error: 'Missing or invalid series array in request body' });
    }

    if (!FRED_API_KEY) {
        console.error('[CONFIG ERROR] FRED_API_KEY is not set on the server for multiple series request.');
        return res.status(500).json({ error: 'Server configuration error: FRED API Key missing.' });
    }
    
    try {
        const results = {};
        const promises = series.map(async (seriesIdUntrimmed) => {
            const seriesId = seriesIdUntrimmed.trim(); 
            if (!seriesId) return; 

            const cacheKey = getCacheKey(seriesId, start_date, end_date);
            const cachedData = cache.get(cacheKey);
            
            if (cachedData && Date.now() - cachedData.timestamp < CACHE_DURATION) {
                console.log(`[CACHE MULTI] Cache hit for "${seriesId}"`);
                results[seriesId] = cachedData.data;
                return;
            }
            console.log(`[CACHE MULTI] Cache miss for "${seriesId}". Fetching from FRED.`);
            
            let fredURL = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(seriesId)}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc`;
            if (start_date) fredURL += `&observation_start=${encodeURIComponent(start_date)}`;
            if (end_date) fredURL += `&observation_end=${encodeURIComponent(end_date)}`;
            
            console.log(`[FRED REQUEST URL MULTI] Attempting to fetch: ${fredURL}`);

            try {
                const response = await fetch(fredURL);
                if (response.ok) {
                    const data = await response.json();
                    cache.set(cacheKey, { data: data, timestamp: Date.now() });
                    results[seriesId] = data;
                    console.log(`[CACHE MULTI] Cached data for "${seriesId}"`);
                } else {
                    const errorText = await response.text();
                    console.error(`[FRED ERROR MULTI] FRED API Error for series "${seriesId}": ${response.status}`, errorText);
                    results[seriesId] = { error: `Failed to fetch ${seriesId}`, status: response.status, details: errorText };
                }
            } catch (fetchError) {
                 console.error(`[SERVER ERROR MULTI] Error fetching from FRED API for series "${seriesId}":`, fetchError);
                 results[seriesId] = { error: `Internal error fetching ${seriesId}`, message: fetchError.message };
            }
        });
        
        await Promise.all(promises);
        res.json(results);
    } catch (error) {
        console.error('[SERVER ERROR] Error processing multiple series request:', error);
        res.status(500).json({ 
            error: 'Internal server error while processing multiple series',
            message: error.message 
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    const apiKeyOkay = !!FRED_API_KEY; // Simpler check now
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        cache_size: cache.size,
        api_key_configured_properly: apiKeyOkay,
        note: apiKeyOkay ? "API Key is present." : "WARNING: FRED_API_KEY environment variable is not set!"
    });
});

// Clear cache endpoint
app.post('/api/cache/clear', (req, res) => {
    cache.clear();
    console.log('[CACHE] Cache cleared via API call.');
    res.json({ message: 'Cache cleared successfully', cache_size: cache.size });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({ 
        message: 'FRED API Proxy Server is running.',
        status: 'active',
        documentation: 'Provides proxy access to FRED API series observations.',
        endpoints: {
            health: '/api/health',
            fred_single_series: '/api/fred/:seriesId?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD',
            fred_multiple_series_POST: '/api/fred/multiple (body: { series: ["ID1", "ID2"], start_date, end_date })',
            cache_clear_POST: '/api/cache/clear'
        }
    });
});

app.listen(port, () => {
    console.log(`FRED proxy server listening at http://localhost:${port}`);
    console.log(`CORS origin: ${process.env.FRONTEND_URL || '*'}`);
    if (!FRED_API_KEY) { // Simpler check at startup
        console.warn('WARNING: FRED_API_KEY is not configured in environment variables. FRED API calls will fail.');
    } else {
        console.log('FRED_API_KEY is present in environment variables.');
    _}
});

// Export the app for Vercel serverless functions
module.exports = app;

// server.js
const express = require('express');
const fetch = require('node-fetch'); // Vercel will handle installing this
const app = express();

// Your FRED API Key will be set as an environment variable in Vercel
const FRED_API_KEY = process.env.FRED_API_KEY;
// Your Frontend URL (for CORS, if needed, though for Vercel serverless it's often not an issue for same-origin requests from Vercel frontend)
const FRONTEND_URL = process.env.FRONTEND_URL;

// Middleware to enable CORS - good practice, though Vercel might handle some aspects
app.use((req, res, next) => {
  if (FRONTEND_URL) {
    res.setHeader('Access-Control-Allow-Origin', FRONTEND_URL);
  } else {
    // Allow all origins if FRONTEND_URL is not set (less secure for production)
    // Or, you might want to default to a more restrictive policy
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.get('/api/fred-data', async (req, res) => {
    const seriesId = req.query.series_id;
    const fileType = req.query.file_type || 'json';
    // You can add more query parameters here and pass them to the FRED API
    // e.g., observation_start, observation_end, units, frequency, aggregation_method

    if (!seriesId) {
        return res.status(400).json({ error: 'Missing series_id parameter' });
    }

    if (!FRED_API_KEY) {
        console.error('FRED_API_KEY is not set on the server.');
        return res.status(500).json({ error: 'Server configuration error: API key missing' });
    }

    // Construct the FRED API URL
    // Base URL
    let fredURL = `https://api.stlouisfed.org/fred/series/observations?series_id=<span class="math-inline">\{seriesId\}&api\_key\=</span>{FRED_API_KEY}&file_type=${fileType}`;

    // Add any additional parameters passed from the frontend
    const allowedParams = ['observation_start', 'observation_end', 'units', 'frequency', 'aggregation_method', 'limit', 'offset', 'sort_order', 'vintage_dates'];
    for (const param in req.query) {
        if (allowedParams.includes(param) && param !== 'series_id' && param !== 'file_type') {
            fredURL += `&<span class="math-inline">\{param\}\=</span>{req.query[param]}`;
        }
    }

    console.log(`Proxying request to FRED API: ${fredURL.replace(FRED_API_KEY, 'REDACTED_API_KEY')}`); // Log URL without API key

    try {
        const apiResponse = await fetch(fredURL);
        const responseText = await apiResponse.text(); // Get text first to handle non-JSON errors

        if (!apiResponse.ok) {
            console.error('FRED API Error:', apiResponse.status, responseText);
            // Try to parse as JSON if possible, otherwise send text
            let errorDetails = responseText;
            try {
                errorDetails = JSON.parse(responseText);
            } catch (e) { /* ignore if not JSON */ }
            return res.status(apiResponse.status).json({
                error: 'Failed to fetch data from FRED',
                fred_status: apiResponse.status,
                fred_details: errorDetails
            });
        }

        // If response is OK, try to parse as JSON (assuming file_type=json)
        // If you request other file_types (like xml), you'll need to adjust this
        if (fileType === 'json') {
            const data = JSON.parse(responseText);
            res.json(data);
        } else {
            // For non-JSON types, send the raw text and set appropriate content type
            // This example doesn't explicitly set content-type for non-JSON,
            // you might need to add that based on FRED's response headers.
            res.send(responseText);
        }

    } catch (error) {
        console.error('Error fetching from FRED API or processing response:', error);
        res.status(500).json({ error: 'Internal server error when fetching data' });
    }
});

// This is important for Vercel: it needs to export the app
module.exports = app;

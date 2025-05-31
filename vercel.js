{
  "version": 2,
  "builds": [
    {
      "src": "server.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "/server.js"
    }
  ],
  "env": {
    "FRED_API_KEY": "@fred-api-key",
    "FRONTEND_URL": "https://your-frontend-url.com"
  }
}

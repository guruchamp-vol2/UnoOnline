# UNO

## Overview
Online UNO with full rules enforcement, UNO penalties, lobby chat, avatars, animations, and high-score persistence via MongoDB.

## Setup

1. **Server**  
   ```bash
   cd server
   npm install
   cp .env.example .env
   # Edit .env to set MONGODB_URI and PORT
   npm start
   ```
2. **Client**  
   Simply open `client/index.html` in your browser, or deploy the `client/` folder as static files.

## Deployment
- Push to Heroku (it’ll pick up the Procfile), or  
- Deploy `/server` to any Node.js host and `/client` to any static host.

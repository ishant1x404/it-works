# it-works! frontend

A responsive, text-only anonymous room chat frontend prototype.

## Project structure

```text
it-works-frontend/
├── index.html              # App screens and semantic markup
├── assets/
│   ├── css/
│   │   └── styles.css      # Layout, colors, responsive styling
│   └── js/
│       └── app.js          # Navigation and demo interactions
├── .gitignore
└── README.md
```

## Run locally

Open `index.html` in a browser, or serve this folder with a static web server. No build step is required.

## Current limitations

This is a frontend-only prototype. Rooms and messages are held in browser memory; other devices cannot share them. Account handling is demo-only and must not be used for real credentials.

## Backend integration plan

Keep UI and styles separate from backend code. When integrating Supabase, add a dedicated `assets/js/supabase-client.js` for client initialization and `assets/js/services/` modules for authentication, rooms, and messages. Keep authorization, atomic room capacity/color allocation, and validation enforced by database policies and server-side functions. Never put service-role keys or database passwords in frontend files.

# 12DTP Database

## Requirements

- Node.js 22.18+
- npm

## Setup

From the repository root, run:

```sh
npm run setup
```

This installs backend and frontend dependencies and creates `backend/.env` from the example if needed. The app can start without Plex settings, but they are needed to generate the initial database and load artwork. If importing an existing database, place it in `/backend/data`.

## Generating the Database (requires plex token)

Fetch media metadata into the local database:

```sh
npm run fetch
```

## Running the application

Start the API and frontend together:

```sh
npm run dev
```

Open the URL printed by Vite (usually http://localhost:5173). Stop both services with Ctrl+C.

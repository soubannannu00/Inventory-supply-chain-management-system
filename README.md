# Inventory and Supply Chain Management System

A beginner-friendly full-stack web app for managing inventory and supply chain operations.

**Current status:** project folders only. Application code will be added step by step.

## Technology stack

- **Frontend:** HTML, CSS, JavaScript
- **Backend:** Node.js and Express.js
- **Database:** MySQL
- **API:** REST
- **Authentication:** JWT (to be added later)
- **AI:** Python and an AI API (later)

## Project structure

```
Inventory-supply-chain-management-system/
├── frontend/    # What the user sees in the browser
├── backend/     # Server and REST API
├── database/    # MySQL scripts (tables, sample data)
├── ai/          # Future Python / AI features
├── README.md
└── .gitignore
```

### `frontend/`

The user interface: pages, styles, and browser JavaScript.

Later this folder will hold HTML pages (login, dashboard, products, orders), CSS, and JavaScript that calls the backend API.

### `backend/`

The server: Express routes, business logic, and (later) JWT authentication.

The frontend will send HTTP requests here; the backend will talk to MySQL and return JSON.

### `database/`

MySQL setup files only (SQL scripts), not the database engine itself.

Later this folder will hold scripts to create tables (products, suppliers, stock, orders, users) and optional sample data.

### `ai/`

Reserved for later. Python scripts and AI API calls can live here without mixing into the Node.js backend.

For now this folder is empty on purpose.

## How the pieces will connect (later)

1. The browser loads pages from `frontend/`.
2. JavaScript in the frontend calls REST endpoints on `backend/`.
3. The backend reads and writes data in MySQL using scripts from `database/`.
4. Optional AI features in `ai/` can be called by the backend when we add them.

## Next steps

1. Add a simple Express server in `backend/`.
2. Create MySQL tables in `database/`.
3. Build a first HTML page in `frontend/` that talks to the API.

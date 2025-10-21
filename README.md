# WTS (WhatTheStack) Conference 2026

This is the web application for the WhatTheStack conference 2026, built with SolidStart and PocketBase.

## Tech Stack

- Solid.js as the reactive UI framework
- SolidStart as the meta framework
- Tailwind CSS and DaisyUI for styling
- PocketBase for backend services, authentication, and data storage
- TypeScript for type safety

## Two-Tier Architecture

This application implements PocketBase's recommended two-tier architecture:

### Client-Tier (Frontend)
- Client-side SPA that interacts directly with PocketBase Web APIs
- Uses PocketBase JavaScript SDK for authentication and data access
- Collection API rules control access and filtering
- Regular users authenticate directly with the client-tier

### Server-Tier (Backend Operations)
- Server-side operations using superuser/admin credentials
- Isolated operations that require elevated privileges
- Admin API endpoints for sensitive operations
- Server functions for backend-only operations

## PocketBase Integration

This project includes a PocketBase backend setup for both local development and remote deployment.

### Prerequisites

- Node.js >= 22
- pnpm
- PocketBase binary (downloaded automatically)

### Local Development Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Download the PocketBase binary:
   ```bash
   pnpm pocketbase:download
   ```

3. Start the development server (this will start both the application and PocketBase backend):
   ```bash
   pnpm dev
   ```

The application will start on `http://localhost:3000` and connect to the PocketBase instance at `http://localhost:8090`.

> Note: The development command automatically starts both the frontend application and the PocketBase backend server.

For more detailed setup instructions, see [POCKETBASE_SETUP.md](./POCKETBASE_SETUP.md).

### Authentication

The application implements a clear separation between client and admin authentication:

- **Client authentication** is handled through the client-side service in `src/lib/pocketbase-client-service.ts`
- **Admin authentication** is handled server-side using superuser credentials in `src/lib/pocketbase-admin-service.ts`

### Admin Access

After first launch, a superuser account is automatically created with credentials from your environment variables:
- Email: `admin@wts.rs` (or as defined in `POCKETBASE_SUPERUSER_EMAIL`)
- Password: `supersecret` (or as defined in `POCKETBASE_SUPERUSER_PASSWORD`)

Visit `http://localhost:8090/_/` to access the PocketBase admin panel using these credentials.

## API Endpoints

- Client operations: Direct communication with PocketBase API
- Admin operations: `/api/admin` endpoint for server-side operations with superuser privileges
- User data: `/api/user-data` endpoint for server-side data access

## Running in Production

The project includes a `docker-compose.yml` file for easy deployment to Coolify with persistent data storage. The superuser account will be automatically created on first run in the production environment as well.

## Developing

Once you've created a project and installed dependencies with `pnpm install`, start a development server:

```bash
pnpm run dev

# or start the server and open the app in a new browser tab
pnpm run dev -- --open
```

Key authentication files:
- `src/lib/auth-service.ts` - Client-side authentication store
- `src/lib/pocketbase-client-service.ts` - Client-side PocketBase service
- `src/lib/pocketbase-admin-service.ts` - Server-side admin PocketBase service
- `src/lib/admin-actions.ts` - Server functions for admin operations
- `src/routes/api/admin.tsx` - Admin API endpoint
- `src/routes/api/user-data.tsx` - User data API endpoint

## Building

To build the application for production:

```bash
pnpm run build
```

This will generate a Node app that you can run with `pnpm start`.

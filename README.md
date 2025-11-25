# Dashboard Microfrontend

This repo hosts the `dashboardModule` microfrontend: a React + Vite application exposed via Module Federation so it can be consumed by a host container. The module includes Firebase integration for real-time data synchronization and persistence. You can run it standalone for local development or build it to publish `remoteEntry.js` and the bundled assets.

## Prerequisites

- Node.js 22+ (matches the toolchain used in development)
- npm 10+
- Firebase project with Firestore enabled

## Installation

1. **Clone the repository** (if applicable) or navigate to the project directory:
   ```bash
   cd dashboard
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up Firebase configuration**:
   
   Create a `.env` file in the root directory with your Firebase configuration:
   ```env
   VITE_FIREBASE_API_KEY=your-api-key
   VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your-project-id
   VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
   VITE_FIREBASE_APP_ID=your-app-id
   ```
   
   You can find these values in your Firebase Console under Project Settings > General > Your apps.

   **Note**: For production, ensure these environment variables are set in your hosting platform (Vercel, Netlify, etc.).

## Running the Application

### Development Mode

Start the development server:

```bash
npm run dev
```

This will:
- Start Vite dev server on `http://localhost:5173/` (or next available port)
- Enable Hot Module Replacement (HMR)
- Expose the Module Federation remote entry at `http://localhost:5173/remoteEntry.js`
- Serve the standalone dashboard UI

The app will automatically connect to Firebase using the environment variables you configured.

### Production Build

Build the application for production:

```bash
npm run build
```

This command:
- Runs TypeScript type checking (`tsc -b`)
- Builds optimized production assets with Vite
- Outputs to `dist/` directory, including:
  - `remoteEntry.js` – Module Federation manifest for `dashboardModule`
  - `assets/**/*.js|css` – optimized application bundles
  - `index.html` – static entry for standalone hosting

### Preview Production Build

Preview the production build locally:

```bash
npm run preview
```

This serves the `dist/` directory locally so you can test the production build before deployment.

## Firebase Integration

This module is configured to work with Firebase Firestore for:
- Real-time data synchronization across multiple clients
- Persistent storage of application state
- Collaborative features

### Firebase Setup Steps

1. **Create a Firebase project** at [Firebase Console](https://console.firebase.google.com/)

2. **Enable Firestore Database**:
   - Go to Firestore Database in Firebase Console
   - Create database (start in test mode for development)
   - Note your database URL

3. **Get your Firebase config**:
   - Go to Project Settings > General
   - Scroll to "Your apps" section
   - If you haven't added a web app, click "Add app" and select the web icon
   - Copy the Firebase configuration object values

4. **Configure environment variables** as described in the Installation section

5. **Set up Firestore security rules** (for production):
   ```javascript
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       // Add your security rules here
       match /{document=**} {
         allow read, write: if request.auth != null; // Example: require authentication
       }
     }
   }
   ```

## Host Integration

To consume this module in a host application:

1. **Configure the remote** in your host's Module Federation config:
   ```js
   remotes: {
     dashboardModule: 'dashboardModule@http://localhost:5173/remoteEntry.js',
   }
   ```

2. **Import the exposed component**:
   ```js
   import DashboardApp from 'dashboardModule/App';
   ```

3. **Render the component**:
   ```jsx
   <DashboardApp />
   ```

React and React DOM are configured as singletons to avoid version conflicts between host and remote.

## Scripts Reference

| Script          | Description                                          |
| --------------- | ---------------------------------------------------- |
| `npm run dev`   | Start Vite dev server with HMR and remote exposure   |
| `npm run build` | Type-check (tsc) and build production assets         |
| `npm run preview` | Serve the `dist/` build locally for manual testing |
| `npm run lint`  | Run ESLint across the repo                           |

## Troubleshooting

### Port Conflicts
If port 5173 is already in use, Vite will automatically try the next available port. Adjust `server.port` in `vite.config.ts` if you need a specific port, and update the host's remote URL accordingly.

### CORS Issues
The dev server already adds `Access-Control-Allow-Origin: *` headers. For production, configure your hosting layer to do the same if a remote host consumes the module from another origin.

### Firebase Connection Issues
- Verify your `.env` file contains all required Firebase configuration variables
- Check that Firestore is enabled in your Firebase project
- Ensure your Firebase project is active and billing is enabled (if required)
- Check browser console for specific Firebase error messages

### Host Build Errors
- Ensure both host and remote depend on the same major versions of React/React DOM
- Verify the remote URL is reachable during the host build
- Check that `remoteEntry.js` is accessible at the configured URL

### Module Federation Issues
- Clear browser cache and restart the dev server
- Ensure the remote entry URL is correct in the host configuration
- Check that shared dependencies (React, React DOM) versions are compatible

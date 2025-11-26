# Whiteboard Module - Microfrontend

A Module Federation microfrontend module for the ERP dashboard system.

## Overview

This module exposes a collaborative whiteboard component that can be consumed by the ERP host application via Module Federation.

## Module Federation Configuration

- **Module Name**: `whiteboardModule`
- **Remote Entry**: `remoteEntry.js`
- **Exposed Component**: `./App`

## Development

```bash
# Install dependencies
npm install

# Start development server (runs on port 3007)
npm start

# Build for production
npm run build
```

## Deployment

### Build Output

After building, the `dist/` folder will contain:
- `remoteEntry.js` - **This is the main entry point for Module Federation**
- `main.[hash].js` - Main application bundle
- `vendors.[hash].js` - Vendor dependencies (if production build)
- `index.html` - Standalone HTML (for testing)

### Deploy to Static Hosting

1. **Build the module**:
   ```bash
   npm run build
   ```

2. **Set deployment URL** (if deploying to a specific domain):
   ```bash
   PUBLIC_PATH=https://your-deployment-domain.com/ npm run build
   ```

3. **Deploy the `dist/` folder** to your hosting service:
   - Firebase Hosting
   - Vercel
   - Netlify
   - AWS S3 + CloudFront
   - Any static hosting service

### Connecting to Host Application

The host application should configure Module Federation to consume this remote:

```javascript
// In host webpack config
new ModuleFederationPlugin({
  name: 'host',
  remotes: {
    whiteboardModule: 'whiteboardModule@https://your-deployment-domain.com/remoteEntry.js',
  },
  shared: {
    react: { singleton: true, requiredVersion: '^18.2.0' },
    'react-dom': { singleton: true, requiredVersion: '^18.2.0' },
  },
})
```

Then use in host application:
```javascript
const WhiteboardApp = React.lazy(() => import('whiteboardModule/App'));

// In your component
<Suspense fallback={<div>Loading...</div>}>
  <WhiteboardApp />
</Suspense>
```

## Standalone Testing

You can test the module independently by opening `dist/index.html` after building, or by running the development server.

## Requirements

- Node.js 16+
- React 18.2.0 (shared dependency)
- React DOM 18.2.0 (shared dependency)


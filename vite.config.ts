import { federation } from '@module-federation/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    cors: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },
  preview: {
    port: 4173,
  },
  build: {
    target: 'esnext',
  },
  plugins: [
    react(),
    federation({
      name: 'dashboardModule',
      filename: 'remoteEntry.js',
      exposes: {
        './App': './src/App.tsx',
      },
      shared: {
        react: {
          singleton: true,
          requiredVersion: '^19.2.0',
        },
        'react-dom': {
          singleton: true,
          requiredVersion: '^19.2.0',
        },
      },
    }),
  ],
});

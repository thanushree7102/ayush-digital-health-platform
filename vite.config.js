import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev: the React app runs on :5173 and forwards API calls to the backend on :4000, so there is one origin.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/v1': 'http://localhost:4000', '/whatsapp-mock': 'http://localhost:4000', '/health': 'http://localhost:4000' } },
});

import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

// In development, proxy API and WebSocket traffic to the Express server so the
// browser sees a single origin, exactly like production (where Express serves
// the built client). Same-origin means the httpOnly auth cookie just works.
const api = process.env.VITE_API_TARGET ?? 'http://localhost:4000';

// `npm run dev:phone` serves over HTTPS, because phone browsers only allow
// camera access (the door scanner) on secure origins. A certificate made with
// mkcert (client/.cert, trusted by this machine) is used when present; otherwise
// a throwaway self-signed one, which browsers warn about.
const https = process.env.VITE_HTTPS === '1';
const certDir = new URL('./.cert/', import.meta.url);
const trustedCert = https && fs.existsSync(new URL('cert.pem', certDir))
  ? { cert: fs.readFileSync(new URL('cert.pem', certDir)), key: fs.readFileSync(new URL('key.pem', certDir)) }
  : null;

export default defineConfig({
  plugins: [react(), tailwindcss(), https && !trustedCert && basicSsl()],
  server: {
    port: 5173,
    ...(trustedCert && { https: trustedCert }),
    proxy: {
      '/api': api,
      '/socket.io': { target: api, ws: true },
    },
  },
});

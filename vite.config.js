import { defineConfig } from 'vite';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import os from 'node:os';
import fs from 'node:fs';
const ip = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal && /^(192.168|10.|172.)/.test(i.address));
const VERSION = JSON.parse(fs.readFileSync('./package.json', 'utf8')).version;

// npm run dev → https://localhost:8897 (desktop: Quest 3 emulator with a synthetic living room)
//                https://<pc-ip>:8897 on the Quest browser / phones (accept the certificate once)
export default defineConfig({
  base: './',
  define: { __LAN__: JSON.stringify(ip ? `https://${ip.address}:8897` : ''), __VERSION__: JSON.stringify(VERSION) },
  // no hot reload: a reload in the middle of a headset session would throw you out of it. Refresh = newest version.
  server: { host: true, port: 8897, strictPort: true, hmr: false },
  preview: { host: true, port: 8898 },
  plugins: [iwsdkDev({ emulator: { device: 'metaQuest3', environment: 'home_office' } })],
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});

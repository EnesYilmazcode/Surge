import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { surgeApi } from './server/surge-api'

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  return {
    plugins: [react(), surgeApi({ apiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY, model: env.GEMINI_MODEL })],
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  }
})

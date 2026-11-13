import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// __ART_VERSION__ changes on every dev-server start and every build, and is appended to sprite URLs (see src/game/artVersion.ts) so a browser
// can never keep showing an old ship / prop sprite after the art was regenerated.
export default defineConfig({ plugins: [react()], define: { __ART_VERSION__: JSON.stringify(String(Date.now())) } })

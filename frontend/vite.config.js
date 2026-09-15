import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Pinned so the dev server always lands on the port that's whitelisted in
    // Supabase's Auth redirect URLs — a floating port (Vite's default behavior
    // when 5173 is busy) breaks Google login until someone re-adds the new port there.
    port: 5173,
    strictPort: true,
  },
})

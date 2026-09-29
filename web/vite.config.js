import { defineConfig } from 'vite'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// Dev only: /admin would otherwise resolve to admin.js, the script.
const adminShortcut = {
  name: 'admin-shortcut',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url === '/admin' || req.url === '/admin/') {
        res.statusCode = 302
        res.setHeader('Location', '/admin.html')
        res.end()
        return
      }
      next()
    })
  }
}

export default defineConfig({
  root: __dirname,
  plugins: [adminShortcut],
  server: {
    port: 5173,
    proxy: {
      // Forward all /api requests to the backend in dev
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main:  resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html')
      }
    }
  }
})

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
export default defineConfig({plugins:[react(),tailwind()],resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},server:{port:5173,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:4318',changeOrigin:false},'/health':'http://127.0.0.1:4318'}},test:{include:['src/**/*.test.ts'],environment:'node'}})

import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    inspectAttr(), 
    react(),
    {
      name: 'cetus-sdk-compat',
      enforce: 'pre',
      resolveId() {
        return null;
      },
      transform(code, id) {
        // Fix Cetus SDK compatibility issues with newer @mysten/bcs
        if (id.includes('@cetusprotocol') && id.endsWith('.mjs')) {
          return code
            .replace(/fromHEX/g, 'fromHex')
            .replace(/toHEX/g, 'toHex')
            .replace(/fromB64/g, 'fromBase64')
            .replace(/toB64/g, 'toBase64');
        }
        return null;
      }
    }
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

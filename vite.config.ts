import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';

const raiz = import.meta.dirname;
const web = resolve(raiz, 'web');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, raiz);
  return {
    root: web,
    // Rutas relativas: funciona igual en GitHub Pages (/marcador-voleibol/) que en local.
    base: './',
    envDir: raiz,
    server: {
      // En desarrollo el navegador habla con Supabase a través de Vite (/supabase/…).
      // Así basta con exponer el puerto de Vite para probar desde el móvil.
      proxy: {
        '/supabase': {
          target: env.VITE_SUPABASE_URL,
          changeOrigin: true,
          ws: true,
          rewrite: (ruta) => ruta.replace(/^\/supabase/, ''),
        },
      },
    },
    build: {
      outDir: resolve(raiz, 'dist'),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          listado: resolve(web, 'index.html'),
          partido: resolve(web, 'partido.html'),
          nuevo: resolve(web, 'nuevo.html'),
          login: resolve(web, 'login.html'),
        },
      },
    },
  };
});

import { defineConfig, loadEnv } from 'vite';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    server: {
      port: Number(env.PORT) || 8787
    },
    build: {
      rollupOptions: {
        input: {
          main: 'index.html',
          login: 'login.html'
        }
      }
    }
  };
});

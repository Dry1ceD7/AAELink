/**
 * Vite Configuration Fixer Agent
 * Fixes all Vite-related issues
 */

export class ViteFixerAgent {
  private fixes: string[] = [];
  private errors: string[] = [];

  constructor() {
    console.log('🤖 Vite Fixer Agent initialized');
  }

  public async fixViteConfiguration(): Promise<boolean> {
    console.log('🔧 Fixing Vite configuration...');

    try {
      // Fix vite.config.ts
      await this.fixViteConfig();

      // Fix package.json
      await this.fixPackageJson();

      // Fix tsconfig.json
      await this.fixTsConfig();

      // Fix index.html
      await this.fixIndexHtml();

      this.fixes.push('Fixed Vite configuration');
      return true;
    } catch (error) {
      this.errors.push(`Failed to fix Vite: ${error}`);
      return false;
    }
  }

  private async fixViteConfig(): Promise<void> {
    const fs = await import('fs/promises');
    const viteConfigPath = '/Users/d7y1ce/AAELink-new/packages/frontend/vite.config.ts';

    const workingViteConfig = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        secure: false,
      },
      '/ws': {
        target: 'ws://localhost:3002',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          router: ['react-router-dom'],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom'],
  },
  esbuild: {
    logOverride: { 'this-is-undefined-in-esm': 'silent' },
  },
});`;

    await fs.writeFile(viteConfigPath, workingViteConfig);
    this.fixes.push('Fixed vite.config.ts');
  }

  private async fixPackageJson(): Promise<void> {
    const fs = await import('fs/promises');
    const packageJsonPath = '/Users/d7y1ce/AAELink-new/packages/frontend/package.json';

    const packageJson = {
      "name": "@aaelink/frontend",
      "version": "2.0.0",
      "private": true,
      "type": "module",
      "scripts": {
        "dev": "vite --host 0.0.0.0",
        "build": "tsc && vite build",
        "preview": "vite preview",
        "test": "vitest",
        "test:ui": "vitest --ui",
        "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0"
      },
      "dependencies": {
        "react": "^18.2.0",
        "react-dom": "^18.2.0",
        "react-router-dom": "^6.20.0",
        "react-i18next": "^13.5.0",
        "i18next": "^23.7.0",
        "zustand": "^4.4.0",
        "axios": "^1.6.0",
        "clsx": "^2.0.0",
        "tailwind-merge": "^2.0.0"
      },
      "devDependencies": {
        "@types/react": "^18.2.37",
        "@types/react-dom": "^18.2.15",
        "@typescript-eslint/eslint-plugin": "^6.10.0",
        "@typescript-eslint/parser": "^6.10.0",
        "@vitejs/plugin-react": "^4.1.0",
        "autoprefixer": "^10.4.16",
        "eslint": "^8.53.0",
        "eslint-plugin-react-hooks": "^4.6.0",
        "eslint-plugin-react-refresh": "^0.4.4",
        "postcss": "^8.4.31",
        "tailwindcss": "^3.3.5",
        "typescript": "^5.2.2",
        "vite": "^5.0.0",
        "vitest": "^1.0.0",
        "@testing-library/react": "^13.4.0",
        "@testing-library/jest-dom": "^6.1.0",
        "@testing-library/user-event": "^14.5.0"
      }
    };

    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
    this.fixes.push('Fixed package.json');
  }

  private async fixTsConfig(): Promise<void> {
    const fs = await import('fs/promises');
    const tsConfigPath = '/Users/d7y1ce/AAELink-new/packages/frontend/tsconfig.json';

    const tsConfig = {
      "compilerOptions": {
        "target": "ES2020",
        "useDefineForClassFields": true,
        "lib": ["ES2020", "DOM", "DOM.Iterable"],
        "module": "ESNext",
        "skipLibCheck": true,
        "moduleResolution": "bundler",
        "allowImportingTsExtensions": true,
        "resolveJsonModule": true,
        "isolatedModules": true,
        "noEmit": true,
        "jsx": "react-jsx",
        "strict": true,
        "noUnusedLocals": false,
        "noUnusedParameters": false,
        "noFallthroughCasesInSwitch": true,
        "baseUrl": ".",
        "paths": {
          "@/*": ["./src/*"]
        }
      },
      "include": ["src"],
      "references": [{ "path": "./tsconfig.node.json" }]
    };

    await fs.writeFile(tsConfigPath, JSON.stringify(tsConfig, null, 2));
    this.fixes.push('Fixed tsconfig.json');
  }

  private async fixIndexHtml(): Promise<void> {
    const fs = await import('fs/promises');
    const indexHtmlPath = '/Users/d7y1ce/AAELink-new/packages/frontend/index.html';

    const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/logo.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AAELink - Company Workspace</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;

    await fs.writeFile(indexHtmlPath, indexHtml);
    this.fixes.push('Fixed index.html');
  }

  public getReport(): { fixes: string[]; errors: string[] } {
    return {
      fixes: this.fixes,
      errors: this.errors
    };
  }
}

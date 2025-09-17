/**
 * AI Configuration Fixer Agent
 * Specialized in fixing configuration issues
 */

export class ConfigFixerAgent {
  private errors: string[] = [];
  private fixes: string[] = [];

  constructor() {
    console.log('🤖 Configuration Fixer Agent initialized');
  }

  public async fixPackageJson(filePath: string): Promise<boolean> {
    console.log(`🔧 Fixing package.json in: ${filePath}`);

    try {
      const fs = await import('fs/promises');
      const content = await fs.readFile(filePath, 'utf-8');
      const pkg = JSON.parse(content);

      // Ensure all required dependencies are present
      const requiredDeps = {
        'hono': '^4.9.7',
        'bun-types': '^1.0.0',
        'ws': '^8.15.0',
        'minio': '^7.1.0'
      };

      Object.entries(requiredDeps).forEach(([dep, version]) => {
        if (!pkg.dependencies[dep]) {
          pkg.dependencies[dep] = version;
          this.fixes.push(`Added missing dependency: ${dep}`);
        }
      });

      await fs.writeFile(filePath, JSON.stringify(pkg, null, 2));
      this.fixes.push(`Fixed package.json in ${filePath}`);
      return true;
    } catch (error) {
      this.errors.push(`Failed to fix package.json: ${error}`);
      return false;
    }
  }

  public async fixTsConfig(filePath: string): Promise<boolean> {
    console.log(`🔧 Fixing tsconfig.json in: ${filePath}`);

    try {
      const fs = await import('fs/promises');
      const content = await fs.readFile(filePath, 'utf-8');
      const config = JSON.parse(content);

      // Ensure proper TypeScript configuration
      config.compilerOptions = {
        ...config.compilerOptions,
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        types: ['bun-types'],
        paths: {
          '@/*': ['./src/*']
        }
      };

      await fs.writeFile(filePath, JSON.stringify(config, null, 2));
      this.fixes.push(`Fixed tsconfig.json in ${filePath}`);
      return true;
    } catch (error) {
      this.errors.push(`Failed to fix tsconfig.json: ${error}`);
      return false;
    }
  }

  public async fixViteConfig(filePath: string): Promise<boolean> {
    console.log(`🔧 Fixing vite.config.ts in: ${filePath}`);

    try {
      const fs = await import('fs/promises');
      let content = await fs.readFile(filePath, 'utf-8');

      // Ensure proper Vite configuration
      const viteConfig = `import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
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
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});`;

      await fs.writeFile(filePath, viteConfig);
      this.fixes.push(`Fixed vite.config.ts in ${filePath}`);
      return true;
    } catch (error) {
      this.errors.push(`Failed to fix vite.config.ts: ${error}`);
      return false;
    }
  }

  public getReport(): { errors: string[]; fixes: string[] } {
    return {
      errors: this.errors,
      fixes: this.fixes
    };
  }
}

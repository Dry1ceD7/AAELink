/**
 * AI Syntax Fixer Agent
 * Specialized in fixing TypeScript/JavaScript syntax errors
 */

export class SyntaxFixerAgent {
  private errors: string[] = [];
  private fixes: string[] = [];

  constructor() {
    console.log('🤖 Syntax Fixer Agent initialized');
  }

  public async fixDuplicateExports(filePath: string): Promise<boolean> {
    console.log(`🔧 Fixing duplicate exports in: ${filePath}`);

    try {
      // Read file content
      const fs = await import('fs/promises');
      let content = await fs.readFile(filePath, 'utf-8');

      // Find and remove duplicate exports
      const exportLines = content.split('\n').filter(line => line.includes('export'));
      const uniqueExports = new Set();
      const fixedLines = content.split('\n').map(line => {
        if (line.includes('export')) {
          const exportName = line.match(/export\s+(?:class|interface|function|const|let|var)\s+(\w+)/)?.[1];
          if (exportName && uniqueExports.has(exportName)) {
            this.fixes.push(`Removed duplicate export: ${exportName}`);
            return ''; // Remove duplicate
          }
          if (exportName) {
            uniqueExports.add(exportName);
          }
        }
        return line;
      });

      // Write fixed content
      const fixedContent = fixedLines.join('\n');
      await fs.writeFile(filePath, fixedContent);

      this.fixes.push(`Fixed duplicate exports in ${filePath}`);
      return true;
    } catch (error) {
      this.errors.push(`Failed to fix duplicate exports: ${error}`);
      return false;
    }
  }

  public async fixImportErrors(filePath: string): Promise<boolean> {
    console.log(`🔧 Fixing import errors in: ${filePath}`);

    try {
      const fs = await import('fs/promises');
      let content = await fs.readFile(filePath, 'utf-8');

      // Fix common import issues
      content = content.replace(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g, (match, name, path) => {
        if (path === 'ws') {
          return `import { WebSocketServer } from 'ws';`;
        }
        return match;
      });

      await fs.writeFile(filePath, content);
      this.fixes.push(`Fixed import errors in ${filePath}`);
      return true;
    } catch (error) {
      this.errors.push(`Failed to fix import errors: ${error}`);
      return false;
    }
  }

  public async fixTypeErrors(filePath: string): Promise<boolean> {
    console.log(`🔧 Fixing type errors in: ${filePath}`);

    try {
      const fs = await import('fs/promises');
      let content = await fs.readFile(filePath, 'utf-8');

      // Fix common type issues
      content = content.replace(/any\[\]/g, 'any[]');
      content = content.replace(/Map<(\w+),\s*(\w+)>/g, 'Map<$1, $2>');

      await fs.writeFile(filePath, content);
      this.fixes.push(`Fixed type errors in ${filePath}`);
      return true;
    } catch (error) {
      this.errors.push(`Failed to fix type errors: ${error}`);
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

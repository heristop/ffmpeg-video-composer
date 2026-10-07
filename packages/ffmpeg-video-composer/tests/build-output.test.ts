import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { readFile, stat, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '../dist');

function isTsSource(s: string): boolean {
  return s.endsWith('.ts');
}

function instantiateFilesystemNodeAdapter(FilesystemNodeAdapter: new () => unknown): void {
  new FilesystemNodeAdapter();
}

function instantiatePinoLogAdapter(PinoLogAdapter: new () => unknown): void {
  new PinoLogAdapter();
}

function instantiateTemplate(Template: new () => unknown): void {
  new Template();
}

function instantiateProject(Project: new () => unknown): void {
  new Project();
}

// browser.js and every chunk it imports statically, with their code.
async function browserEagerFiles(): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const walk = async (file: string): Promise<void> => {
    if (files.has(file)) return;

    const code = await readFile(path.join(DIST_DIR, file), 'utf-8');

    files.set(file, code);
    const imports = [...code.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*["']\.\/([^"']+)["']/g)];

    await Promise.all(imports.map((match) => walk(match[1])));
  };

  await walk('browser.js');

  return files;
}

describe('Build Output', () => {
  describe('File Existence', () => {
    it('should have index.js in dist', async () => {
      await expect(access(path.join(DIST_DIR, 'index.js'), constants.F_OK)).resolves.toBeUndefined();
    });

    it('should have browser.js in dist', async () => {
      await expect(access(path.join(DIST_DIR, 'browser.js'), constants.F_OK)).resolves.toBeUndefined();
    });

    it('should have index.js.map sourcemap', async () => {
      await expect(access(path.join(DIST_DIR, 'index.js.map'), constants.F_OK)).resolves.toBeUndefined();
    });

    it('should have browser.js.map sourcemap', async () => {
      await expect(access(path.join(DIST_DIR, 'browser.js.map'), constants.F_OK)).resolves.toBeUndefined();
    });
  });

  describe('Valid JavaScript', () => {
    it('index.js should be valid and non-empty JavaScript', async () => {
      const content = await readFile(path.join(DIST_DIR, 'index.js'), 'utf-8');
      expect(content).toBeTruthy();
      expect(content.length).toBeGreaterThan(1000);
      // Should start with valid module syntax
      expect(content).toMatch(/^(import |export |\/\/|\/\*)/);
    });

    it('browser.js should be valid and non-empty JavaScript', async () => {
      const content = await readFile(path.join(DIST_DIR, 'browser.js'), 'utf-8');
      expect(content).toBeTruthy();
      expect(content.length).toBeGreaterThan(1000);
      expect(content).toMatch(/^(import |export |\/\/|\/\*)/);
    });
  });

  describe('Node.js Build Exports', () => {
    it('should export compile function', async () => {
      const mod = await import(path.join(DIST_DIR, 'index.js'));
      expect(mod.compile).toBeTypeOf('function');
    });

    it('should export loadConfig function', async () => {
      const mod = await import(path.join(DIST_DIR, 'index.js'));
      expect(mod.loadConfig).toBeTypeOf('function');
    });

    it('should export TemplateDirector class', async () => {
      const mod = await import(path.join(DIST_DIR, 'index.js'));
      expect(mod.TemplateDirector).toBeDefined();
      expect(mod.TemplateDirector).toBeTypeOf('function');
    });

    it('should export VideoEditor class', async () => {
      const mod = await import(path.join(DIST_DIR, 'index.js'));
      expect(mod.VideoEditor).toBeDefined();
    });

    it('should export container (tsyringe)', async () => {
      const mod = await import(path.join(DIST_DIR, 'index.js'));
      expect(mod.container).toBeDefined();
      expect(mod.container).toBeTypeOf('object');
    });

    it('should export Node-specific adapters', async () => {
      const mod = await import(path.join(DIST_DIR, 'index.js'));
      expect(mod.FFmpegNodeAdapter).toBeDefined();
      expect(mod.FilesystemNodeAdapter).toBeDefined();
      expect(mod.PinoLogAdapter).toBeDefined();
    });

    it('should export AbstractFFmpeg', async () => {
      const mod = await import(path.join(DIST_DIR, 'index.js'));
      expect(mod.AbstractFFmpeg).toBeDefined();
    });

    it('should export AbstractFilesystem', async () => {
      const mod = await import(path.join(DIST_DIR, 'index.js'));
      expect(mod.AbstractFilesystem).toBeDefined();
    });

    it('should export AbstractLogger', async () => {
      const mod = await import(path.join(DIST_DIR, 'index.js'));
      expect(mod.AbstractLogger).toBeDefined();
    });
  });

  describe('Browser Build Exports', () => {
    it('should export compile function (from compileBrowser)', async () => {
      const mod = await import(path.join(DIST_DIR, 'browser.js'));
      expect(mod.compile).toBeTypeOf('function');
    });

    it('should export FFmpegWasmAdapter', async () => {
      const mod = await import(path.join(DIST_DIR, 'browser.js'));
      expect(mod.FFmpegWasmAdapter).toBeDefined();
      expect(mod.FFmpegWasmAdapter).toBeTypeOf('function');
    });

    it('should export BrowserFilesystemAdapter', async () => {
      const mod = await import(path.join(DIST_DIR, 'browser.js'));
      expect(mod.BrowserFilesystemAdapter).toBeDefined();
    });

    it('should export AbstractFFmpeg', async () => {
      const mod = await import(path.join(DIST_DIR, 'browser.js'));
      expect(mod.AbstractFFmpeg).toBeDefined();
    });

    it('should export AbstractFilesystem', async () => {
      const mod = await import(path.join(DIST_DIR, 'browser.js'));
      expect(mod.AbstractFilesystem).toBeDefined();
    });

    it('should export AbstractLogger', async () => {
      const mod = await import(path.join(DIST_DIR, 'browser.js'));
      expect(mod.AbstractLogger).toBeDefined();
    });

    it('should export Template model', async () => {
      const mod = await import(path.join(DIST_DIR, 'browser.js'));
      expect(mod.Template).toBeDefined();
    });

    it('should export Project model', async () => {
      const mod = await import(path.join(DIST_DIR, 'browser.js'));
      expect(mod.Project).toBeDefined();
    });

    it('should export container (tsyringe)', async () => {
      const mod = await import(path.join(DIST_DIR, 'browser.js'));
      expect(mod.container).toBeDefined();
      expect(mod.container).toBeTypeOf('object');
    });
  });

  describe('Browser Build - Platform Isolation', () => {
    it('should NOT contain node:fs imports', async () => {
      const content = await readFile(path.join(DIST_DIR, 'browser.js'), 'utf-8');
      expect(content).not.toMatch(/from\s+["']node:fs["']/);
      expect(content).not.toMatch(/import\s*\(\s*["']node:fs["']\s*\)/);
    });

    it('should NOT contain node:events imports', async () => {
      const content = await readFile(path.join(DIST_DIR, 'browser.js'), 'utf-8');
      expect(content).not.toMatch(/from\s+["']node:events["']/);
      expect(content).not.toMatch(/import\s*\(\s*["']node:events["']\s*\)/);
    });

    it('should NOT contain node:child_process imports', async () => {
      const content = await readFile(path.join(DIST_DIR, 'browser.js'), 'utf-8');
      expect(content).not.toMatch(/from\s+["']node:child_process["']/);
      expect(content).not.toMatch(/from\s+["']child_process["']/);
    });

    it('should NOT contain node:path imports', async () => {
      const content = await readFile(path.join(DIST_DIR, 'browser.js'), 'utf-8');
      expect(content).not.toMatch(/from\s+["']node:path["']/);
      expect(content).not.toMatch(/from\s+["']path["']/);
    });

    it('should NOT contain FFmpegNodeAdapter', async () => {
      const content = await readFile(path.join(DIST_DIR, 'browser.js'), 'utf-8');
      expect(content).not.toMatch(/FFmpegNodeAdapter/);
    });

    it('should NOT contain FilesystemNodeAdapter', async () => {
      const content = await readFile(path.join(DIST_DIR, 'browser.js'), 'utf-8');
      expect(content).not.toMatch(/FilesystemNodeAdapter/);
    });

    it('should NOT contain PinoLogAdapter', async () => {
      const content = await readFile(path.join(DIST_DIR, 'browser.js'), 'utf-8');
      expect(content).not.toMatch(/PinoLogAdapter/);
    });
  });

  // The React-Native entry runs in Hermes and drives the native FFmpeg CLI engine. It must never
  // pull in the WASM adapter: `@ffmpeg/ffmpeg`'s worker uses `import(coreURL)` which Metro can't
  // transform, so a single leaked reference breaks the whole Android/iOS bundle. The leak happens
  // when shared code (e.g. TemplateConcreteBuilder) statically imports FFmpegWasmAdapter just to do
  // an `instanceof` check — branch on the virtual-filesystem capability instead.
  describe('React Native Build - Platform Isolation', () => {
    it('should have reactnative.js in dist', async () => {
      await expect(access(path.join(DIST_DIR, 'reactnative.js'), constants.F_OK)).resolves.toBeUndefined();
    });

    it('should NOT contain @ffmpeg/ffmpeg imports', async () => {
      const content = await readFile(path.join(DIST_DIR, 'reactnative.js'), 'utf-8');
      expect(content).not.toMatch(/@ffmpeg\/ffmpeg/);
      expect(content).not.toMatch(/@ffmpeg\/util/);
    });

    it('should NOT bundle the WASM adapter implementation', async () => {
      // `initializeFFmpeg` is the WASM adapter's constructor-time loader — unique to its runtime
      // code (present in browser.js). A doc comment may still mention "FFmpegWasmAdapter" by name,
      // so assert on this implementation token rather than the class name to avoid false positives.
      const content = await readFile(path.join(DIST_DIR, 'reactnative.js'), 'utf-8');
      expect(content).not.toMatch(/initializeFFmpeg/);
    });
  });

  describe('Sourcemaps', () => {
    it('index.js.map should be valid JSON', async () => {
      const content = await readFile(path.join(DIST_DIR, 'index.js.map'), 'utf-8');
      const sourcemap = JSON.parse(content);
      expect(sourcemap).toBeDefined();
      expect(sourcemap.version).toBe(3);
    });

    it('index.js.map should contain sources array', async () => {
      const content = await readFile(path.join(DIST_DIR, 'index.js.map'), 'utf-8');
      const sourcemap = JSON.parse(content);
      expect(sourcemap.sources).toBeInstanceOf(Array);
      expect(sourcemap.sources.length).toBeGreaterThan(0);
    });

    it('index.js.map should reference TypeScript sources', async () => {
      const content = await readFile(path.join(DIST_DIR, 'index.js.map'), 'utf-8');
      const sourcemap = JSON.parse(content);
      const hasTsSources = sourcemap.sources.some(isTsSource);
      expect(hasTsSources).toBe(true);
    });

    it('browser.js.map should be valid JSON', async () => {
      const content = await readFile(path.join(DIST_DIR, 'browser.js.map'), 'utf-8');
      const sourcemap = JSON.parse(content);
      expect(sourcemap).toBeDefined();
      expect(sourcemap.version).toBe(3);
    });

    it('browser.js.map should contain sources array', async () => {
      const content = await readFile(path.join(DIST_DIR, 'browser.js.map'), 'utf-8');
      const sourcemap = JSON.parse(content);
      expect(sourcemap.sources).toBeInstanceOf(Array);
      expect(sourcemap.sources.length).toBeGreaterThan(0);
    });

    it('browser.js.map should reference TypeScript sources', async () => {
      const content = await readFile(path.join(DIST_DIR, 'browser.js.map'), 'utf-8');
      const sourcemap = JSON.parse(content);
      const hasTsSources = sourcemap.sources.some(isTsSource);
      expect(hasTsSources).toBe(true);
    });
  });

  describe('File Size Constraints', () => {
    it('index.js should be under 1MB', async () => {
      const stats = await stat(path.join(DIST_DIR, 'index.js'));
      const sizeInMB = stats.size / (1024 * 1024);
      expect(stats.size).toBeLessThan(1024 * 1024);
      console.log(`  index.js size: ${sizeInMB.toFixed(2)} MB`);
    });

    it('browser.js should be under 500KB', async () => {
      const stats = await stat(path.join(DIST_DIR, 'browser.js'));
      const sizeInKB = stats.size / 1024;
      expect(stats.size).toBeLessThan(500 * 1024);
      console.log(`  browser.js size: ${sizeInKB.toFixed(2)} KB`);
    });

    // The size a page actually loads before its first compile: browser.js plus every chunk it imports
    // statically (lazy `import()` chunks are fetched later). Guards the shared chunk from regrowing.
    it('browser entry eager load (browser.js + static chunks) should be under 600KB', async () => {
      const files = await browserEagerFiles();
      const sizes = await Promise.all(
        [...files.keys()].map(async (file) => (await stat(path.join(DIST_DIR, file))).size)
      );
      const total = sizes.reduce((a, b) => a + b, 0);

      expect(total).toBeLessThan(600 * 1024);
      console.log(`  browser eager load: ${(total / 1024).toFixed(2)} KB across ${files.size} files`);
    });

    // Validation needs the schemas, not their authoring prose: the fx rows' descriptions and intent
    // (schemas/fx-docs.ts) and the JSON schema built from them (template.schemas.ts) load only where read.
    it('browser entry eager load carries neither the fx prose nor the JSON schema build', async () => {
      const code = [...(await browserEagerFiles()).values()].join('\n');

      expect(code).not.toContain('toJSONSchema(');
      expect(code).not.toContain('Light profile across the band');
    });

    it('sourcemaps should exist and be reasonable size', async () => {
      const indexMapStats = await stat(path.join(DIST_DIR, 'index.js.map'));
      const browserMapStats = await stat(path.join(DIST_DIR, 'browser.js.map'));

      // Sourcemaps should be larger than their source files (they include sourcesContent)
      const indexStats = await stat(path.join(DIST_DIR, 'index.js'));
      const browserStats = await stat(path.join(DIST_DIR, 'browser.js'));

      expect(indexMapStats.size).toBeGreaterThan(0);
      expect(browserMapStats.size).toBeGreaterThan(0);

      // Sourcemaps typically 1-2x the size of the output
      expect(indexMapStats.size).toBeLessThan(indexStats.size * 3);
      expect(browserMapStats.size).toBeLessThan(browserStats.size * 3);
    });
  });

  describe('Build Output Integration', () => {
    it('should import and use exports from dist/index.js', async () => {
      const mod = await import(path.join(DIST_DIR, 'index.js'));

      // Test core exports exist and are the right types
      expect(mod.compile).toBeTypeOf('function');
      expect(mod.loadConfig).toBeTypeOf('function');
      expect(mod.TemplateDirector).toBeDefined();
      expect(mod.VideoEditor).toBeDefined();
      expect(mod.container).toBeDefined();

      // Test that adapters can be instantiated
      const { FilesystemNodeAdapter, PinoLogAdapter, FFmpegNodeAdapter } = mod;

      instantiateFilesystemNodeAdapter(FilesystemNodeAdapter);

      instantiatePinoLogAdapter(PinoLogAdapter);

      // FFmpegNodeAdapter requires constructor params, just verify it's a function
      expect(typeof FFmpegNodeAdapter).toBe('function');

      // Test loadConfig can read a template file
      const templatePath = path.join(__dirname, 'fixtures/picture.json');
      const templateDescriptor = await mod.loadConfig(templatePath);
      expect(templateDescriptor).toBeDefined();
      expect(templateDescriptor.global).toBeDefined();
      expect(templateDescriptor.sections).toBeInstanceOf(Array);
    });

    it('should import and use exports from dist/browser.js', async () => {
      const mod = await import(path.join(DIST_DIR, 'browser.js'));

      // Test browser-specific exports
      expect(mod.compile).toBeTypeOf('function');
      expect(mod.FFmpegWasmAdapter).toBeDefined();
      expect(mod.BrowserFilesystemAdapter).toBeDefined();
      expect(mod.Template).toBeDefined();
      expect(mod.Project).toBeDefined();
      expect(mod.container).toBeDefined();

      // Test that browser classes can be instantiated
      const { Template, Project } = mod;

      instantiateTemplate(Template);

      instantiateProject(Project);

      // BrowserFilesystemAdapter and FFmpegWasmAdapter need browser environment,
      // just verify they're exported as functions
      expect(typeof mod.BrowserFilesystemAdapter).toBe('function');
      expect(typeof mod.FFmpegWasmAdapter).toBe('function');
    });
  });
});

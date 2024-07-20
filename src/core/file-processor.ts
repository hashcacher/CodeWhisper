import os from 'node:os';
import path from 'node:path';
import fastGlob from 'fast-glob';
import fs from 'fs-extra';
import ignore from 'ignore';
import { isBinaryFile } from 'isbinaryfile';
import micromatch from 'micromatch';
import Piscina from 'piscina';
import { FileCache } from '../utils/file-cache';

export interface FileInfo {
  path: string;
  extension: string;
  language: string;
  size: number;
  created: Date;
  modified: Date;
  content: string;
}

interface ProcessOptions {
  path: string;
  gitignorePath?: string;
  filter?: string[];
  exclude?: string[];
  suppressComments?: boolean;
  caseSensitive?: boolean;
  customIgnores?: string[];
  cachePath?: string;
  matchBase?: boolean;
}

const workerFilePath = new URL('../core/file-worker.js', import.meta.url).href;

const pool = new Piscina({
  filename: workerFilePath,
});

const DEFAULT_IGNORES = [
  // Version control
  '**/.git',
  '**/.gitignore',
  '**/.gitattributes',
  '**/.gitmodules',
  '**/.gitkeep',
  '**/.github',
  '**/.svn',
  '**/.hg',
  '**/.hgignore',
  '**/.hgcheck',

  // Package manager directories
  '**/node_modules',
  '**/jspm_packages',
  '**/bower_components',

  // Build outputs and caches
  '**/dist',
  '**/build',
  '**/.cache',
  '**/.output',
  '**/.nuxt',
  '**/.next',
  '**/.vuepress/dist',
  '**/.serverless',
  '**/.fusebox',
  '**/.dynamodb',

  // Package manager files
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/bun.lockb',
  '**/Gemfile.lock',
  '**/Cargo.lock',
  '**/poetry.lock',
  '**/composer.lock',

  // IDE and editor files
  '**/.vscode',
  '**/.idea',
  '**/*.swp',
  '**/*.swo',

  // OS generated files
  '**/.DS_Store',
  '**/.DS_Store?',
  '**/._*',
  '**/.Spotlight-V100',
  '**/.Trashes',
  '**/ehthumbs.db',
  '**/Thumbs.db',

  // Logs
  '**/logs',
  '**/*.log',
  '**/npm-debug.log*',
  '**/yarn-debug.log*',
  '**/yarn-error.log*',

  // Temporary files
  '**/tmp',
  '**/temp',
];

export async function processFiles(
  options: ProcessOptions,
): Promise<FileInfo[]> {
  const {
    path: basePath,
    gitignorePath = '.gitignore',
    filter = [],
    exclude = [],
    suppressComments = false,
    caseSensitive = false,
    customIgnores = [],
    cachePath = path.join(os.tmpdir(), 'codewhisper-cache.json'),
    matchBase = false,
  } = options;

  const fileCache = new FileCache(cachePath);

  const ig = ignore().add(DEFAULT_IGNORES);

  if (await fs.pathExists(gitignorePath)) {
    const gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
    ig.add(gitignoreContent);
  }

  const globOptions: fastGlob.Options = {
    cwd: basePath,
    dot: true,
    absolute: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    caseSensitiveMatch: caseSensitive,
  };

  const fileInfos: FileInfo[] = [];
  const cachePromises: Promise<void>[] = [];

  const normalizedFilters =
    filter.length > 0
      ? filter.map((f) => (path.isAbsolute(f) ? path.relative(basePath, f) : f))
      : ['**/*'];

  const globPattern =
    normalizedFilters.length > 1
      ? `{${normalizedFilters.join(',')}}`
      : normalizedFilters[0];

  const globStream = fastGlob.stream(globPattern, globOptions);

  const matchFile = (relativePath: string, patterns: string[]) => {
    const matchOptions = {
      dot: true,
      nocase: !caseSensitive,
      matchBase,
      bash: true,
    };

    if (matchBase) {
      const basename = path.basename(relativePath);
      return patterns.some(
        (pattern) =>
          micromatch.isMatch(basename, pattern, matchOptions) ||
          micromatch.isMatch(relativePath, pattern, matchOptions),
      );
    }

    return micromatch.isMatch(relativePath, patterns, matchOptions);
  };

  return new Promise((resolve, reject) => {
    globStream.on('data', (filePath) => {
      const filePathStr = path.resolve(filePath.toString());
      const relativePath = path.relative(basePath, filePathStr);

      if (ig.ignores(relativePath)) return;

      if (customIgnores.length > 0 && matchFile(relativePath, customIgnores)) {
        return;
      }

      if (
        normalizedFilters.length > 0 &&
        !matchFile(relativePath, normalizedFilters)
      )
        return;

      if (exclude.length > 0 && matchFile(relativePath, exclude)) return;

      cachePromises.push(
        (async () => {
          try {
            const cached = await fileCache.get(filePath);
            if (cached) {
              fileInfos.push(cached);
              return; // Skip processing and setting cache for cached files
            }

            // Only proceed with file processing if not cached
            const stats = await fs.stat(filePathStr);
            if (!stats.isFile()) return;

            const buffer = await fs.readFile(filePathStr);
            if (await isBinaryFile(buffer)) return;

            const result = await pool.run({
              filePath: filePathStr,
              suppressComments,
            });

            if (result) {
              await fileCache.set(filePathStr, result as FileInfo);
              fileInfos.push(result as FileInfo);
            }
          } catch (error) {
            console.error(`Error processing file ${filePathStr}:`, error);
          }
        })(),
      );
    });

    globStream.on('end', async () => {
      try {
        await Promise.all(cachePromises);
        fileInfos.sort((a, b) => a.path.localeCompare(b.path));
        await fileCache.flush();
        resolve(fileInfos);
      } catch (error) {
        console.error('Error during file processing or cache flushing:', error);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

    globStream.on('error', reject);
  });
}

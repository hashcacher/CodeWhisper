import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'cli/index': 'src/cli/index.ts',
    'core/file-worker': 'src/core/file-worker.js',
    cli: 'cli.js',
  },
  format: ['esm'],
  splitting: false,
  clean: true,
  shims: true,
  name: 'codewhisper',
  tsconfig: 'tsconfig.build.json',
  publicDir: 'src/templates',
  dts: {
    entry: {
      'cli/index': 'src/cli/index.ts',
    },
  },
  esbuildOptions: (options) => {
    options.platform = 'node';
  },
});

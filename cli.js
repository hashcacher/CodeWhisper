#!/usr/bin/env node

import path from 'node:path';
import url from 'node:url';

process.env.CODEWHISPER_CLI = 'true';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cliPath;
if (__dirname.includes(`${path.sep}dist`)) {
  cliPath = path.resolve(__dirname, 'cli', 'index.js');
} else {
  cliPath = path.resolve(__dirname, 'src', 'cli', 'index.ts');
}

function getTemplatesDir() {
  const isCLI = process.env.CODEWHISPER_CLI === 'true';

  if (isCLI) {
    // We're running from CLI (global install or npx)
    return path.resolve(__dirname);
  }

  if (__dirname.includes(`${path.sep}node_modules`)) {
    // We're running in production mode (e.g., programmatic usage of installed package)
    return path.resolve(__dirname, '..', 'dist');
  }

  if (__dirname.includes(`${path.sep}dist`)) {
    // We're running in production mode (e.g., local build)
    return __dirname;
  }

  // We're running in development mode
  return path.resolve(__dirname, 'src', 'templates');
}

// Set the TEMPLATES_DIR environment variable
process.env.TEMPLATES_DIR = getTemplatesDir();

import(url.pathToFileURL(cliPath).href)
  .then((cliModule) => {
    if (cliModule.default) {
      cliModule.default(process.argv.slice(2));
    } else if (cliModule.cli) {
      cliModule.cli(process.argv.slice(2));
    } else {
      console.error('CLI function not found in module');
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

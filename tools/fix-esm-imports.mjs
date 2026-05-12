#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repoRoot, 'dist-ts');
const sourceExts = ['.js', '.d.ts'];
const importRegex = /\b(from\s*['"]|import\s*\(\s*['"])(\.\.?\/[^'"]+)(['"]\s*\)?)/g;

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function hasKnownExtension(specifier) {
  return path.extname(specifier) !== '';
}

function resolveEmittedModule(filePath, specifier) {
  const resolved = path.resolve(path.dirname(filePath), specifier);
  if (existsSync(`${resolved}.js`)) return `${specifier}.js`;
  if (existsSync(path.join(resolved, 'index.js'))) return `${specifier.replace(/\/+$/, '')}/index.js`;
  return specifier;
}

function rewriteSpecifier(filePath, specifier) {
  if (hasKnownExtension(specifier)) {
    return specifier;
  }

  return resolveEmittedModule(filePath, specifier);
}

if (!existsSync(outDir)) {
  throw new Error(`Build output not found: ${outDir}`);
}

for (const filePath of walk(outDir)) {
  if (!sourceExts.some((ext) => filePath.endsWith(ext)) || !statSync(filePath).isFile()) continue;

  const original = readFileSync(filePath, 'utf8');
  const updated = original.replace(importRegex, (match, prefix, specifier, suffix) => {
    return `${prefix}${rewriteSpecifier(filePath, specifier)}${suffix}`;
  });

  if (updated !== original) {
    writeFileSync(filePath, updated);
  }
}

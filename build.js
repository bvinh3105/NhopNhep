#!/usr/bin/env node
// Build script — copies static files to dist/, obfuscates sensitive JS.
// Cloudflare Pages: build command = "npm run build", output dir = "dist"
// functions/ stays at repo root (CF picks it up separately).

const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const SRC = __dirname;
const DIST = path.join(__dirname, 'dist');

const SKIP = new Set([
  'node_modules', 'dist', 'build', '.git', '.cache',
  'functions', 'package.json', 'package-lock.json', 'build.js',
  'PROJECT_HANDOFF.md', 'README.md', '.gitignore',
]);

const OBFUSCATE_FILES = new Set(['gemini.js']);

const OBF_OPTIONS = {
  compact: true,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.8,
  rotateStringArray: true,
  splitStrings: true,
  splitStringsChunkLength: 5,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: true,
  reservedNames: ['^Gemini$', '^normalizeQuanArray$'],
  target: 'browser',
};

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      if (SKIP.has(entry)) continue;
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

// Clean dist
if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true, force: true });

// Copy everything
console.log('Copying files to dist/...');
fs.mkdirSync(DIST, { recursive: true });
for (const entry of fs.readdirSync(SRC)) {
  if (SKIP.has(entry)) continue;
  copyRecursive(path.join(SRC, entry), path.join(DIST, entry));
}

// Obfuscate sensitive JS files
for (const file of OBFUSCATE_FILES) {
  const filePath = path.join(DIST, 'js', file);
  if (!fs.existsSync(filePath)) {
    console.warn(`  SKIP ${file} (not found)`);
    continue;
  }
  console.log(`  Obfuscating js/${file}...`);
  const code = fs.readFileSync(filePath, 'utf8');
  const result = JavaScriptObfuscator.obfuscate(code, OBF_OPTIONS);
  fs.writeFileSync(filePath, result.getObfuscatedCode());
  const origSize = Buffer.byteLength(code);
  const newSize = Buffer.byteLength(result.getObfuscatedCode());
  console.log(`    ${(origSize/1024).toFixed(1)}KB → ${(newSize/1024).toFixed(1)}KB`);
}

console.log('Build complete.');

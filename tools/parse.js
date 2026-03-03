import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';

const targetPath = process.argv[2];

if (!targetPath) {
  console.error('Usage: node tools/parse.js <relative-or-absolute-file-path>');
  process.exit(1);
}

const resolvedPath = path.resolve(process.cwd(), targetPath);

if (!fs.existsSync(resolvedPath)) {
  console.error(`File not found: ${resolvedPath}`);
  process.exit(1);
}

const code = fs.readFileSync(resolvedPath, 'utf8');

try {
  parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  });
  console.log(`Parse success: ${resolvedPath}`);
} catch (error) {
  console.error(`Parse error: ${resolvedPath}`);
  console.error(error.message);
  if (error.loc) {
    console.error(`line ${error.loc.line}, column ${error.loc.column}`);
  }
  process.exit(1);
}


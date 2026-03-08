import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';

export default {
  input: 'src/bin/executable.js',
  output: {
    file: 'package/lib/aux4-browser.mjs',
    format: 'es',
    inlineDynamicImports: true
  },
  plugins: [
    nodeResolve({ preferBuiltins: true }),
    commonjs(),
    json()
  ],
  external: [
    'node:net', 'node:fs', 'node:path', 'node:os', 'node:crypto', 'node:child_process',
    'fs', 'path', 'stream', 'util', 'events', 'buffer', 'string_decoder', 'crypto', 'os',
    'tty', 'process', 'child_process', 'net',
    'playwright',
    '@modelcontextprotocol/sdk/server/mcp.js',
    '@modelcontextprotocol/sdk/server/stdio.js',
    'zod'
  ]
};

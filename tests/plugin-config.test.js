'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

assert.strictEqual(
  fs.existsSync(path.join(root, '.mcp.json')),
  false,
  'root .mcp.json is Claude project configuration; Codex must not create it',
);

const codexManifest = readJson('.codex-plugin/plugin.json');
assert.strictEqual(codexManifest.mcpServers, './.codex.mcp.json');

const codexMarketplace = readJson('.agents/plugins/marketplace.json');
assert.strictEqual(codexMarketplace.name, 'baz');
assert.strictEqual(codexMarketplace.plugins[0].name, 'baz');
assert.strictEqual(codexMarketplace.plugins[0].source, './');

const codex = readJson('.codex.mcp.json');
const claude = readJson('.claude-plugin/plugin.json').mcpServers;
const cursor = readJson('.cursor-plugin/plugin.json').mcpServers;

assert.deepStrictEqual(codex, claude, 'Codex and Claude MCP servers drifted');
assert.deepStrictEqual(codex, cursor, 'Codex and Cursor MCP servers drifted');

console.log('Vendor MCP configuration OK');

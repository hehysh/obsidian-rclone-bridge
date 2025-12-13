#!/usr/bin/env node

/**
 * 本地开发脚本：自动编译并输出到 Obsidian 插件目录
 * 使用环境变量或环境文件配置，避免泄露个人路径
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const OBSIDIAN_PLUGIN_DIR = process.env.OBSIDIAN_PLUGIN_DIR;

if (!OBSIDIAN_PLUGIN_DIR) {
  console.error('❌ 错误: 未设置 OBSIDIAN_PLUGIN_DIR 环境变量');
  console.error('');
  console.error('请创建 .env.local 文件并设置：');
  console.error('  OBSIDIAN_PLUGIN_DIR=/path/to/your/.obsidian/plugins/obsidian-rclone-bridge');
  console.error('');
  console.error('Windows 示例：');
  console.error('  OBSIDIAN_PLUGIN_DIR=C:\\\\Users\\\\YourName\\\\Documents\\\\Obsidian Vault\\\\.obsidian\\\\plugins\\\\obsidian-rclone-bridge');
  console.error('');
  console.error('macOS/Linux 示例：');
  console.error('  OBSIDIAN_PLUGIN_DIR=/Users/YourName/Documents/Obsidian Vault/.obsidian/plugins/obsidian-rclone-bridge');
  process.exit(1);
}

// 确保插件目录存在
if (!fs.existsSync(OBSIDIAN_PLUGIN_DIR)) {
  fs.mkdirSync(OBSIDIAN_PLUGIN_DIR, { recursive: true });
  console.log(`✅ 已创建目录: ${OBSIDIAN_PLUGIN_DIR}`);
}

// 复制 manifest.json
const manifestSrc = path.join(__dirname, '..', 'manifest.json');
const manifestDst = path.join(OBSIDIAN_PLUGIN_DIR, 'manifest.json');
fs.copyFileSync(manifestSrc, manifestDst);
console.log(`✅ 已复制 manifest.json`);

// 启动 esbuild watch
const outfile = path.join(OBSIDIAN_PLUGIN_DIR, 'main.js');
const cmd = `esbuild main.ts --bundle --format=cjs --platform=node --target=es2020 --external:obsidian --sourcemap --outfile="${outfile}" --watch`;

console.log(`\n👀 开始监听文件变更，输出到: ${outfile}\n`);
try {
  execSync(cmd, { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
} catch (err) {
  console.error('构建失败:', err.message);
  process.exit(1);
}

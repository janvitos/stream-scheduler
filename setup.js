#!/usr/bin/env node
/**
 * stream-scheduler setup.js
 * Run once with: node setup.js
 * Creates/updates config.json with hashed password and port.
 */

const readline = require('readline');
const bcrypt   = require('bcryptjs');
const fs       = require('fs');
const path     = require('path');

const CONFIG_PATH = path.join(__dirname, 'data', 'config.json');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

(async () => {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║     Stream Scheduler — Setup         ║');
  console.log('╚══════════════════════════════════════╝\n');

  const port     = await ask('Port to run on [default: 3000]: ');
  const username = await ask('Admin username [default: admin]: ');
  const password = await ask('Admin password: ');
  const confirm  = await ask('Confirm password: ');

  if (password !== confirm) {
    console.error('\n✗ Passwords do not match. Run setup again.');
    process.exit(1);
  }

  if (password.length < 6) {
    console.error('\n✗ Password must be at least 6 characters.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);

  if (!fs.existsSync(path.dirname(CONFIG_PATH))) {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  }

  const config = {
    port:         parseInt(port, 10) || 3000,
    username:     username.trim() || 'admin',
    passwordHash: hash,
    sessionSecret: require('crypto').randomBytes(32).toString('hex')
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

  console.log(`\n✓ Config saved to ${CONFIG_PATH}`);
  console.log(`✓ Run  node server.js  then open  http://localhost:${config.port}\n`);
  rl.close();
})();

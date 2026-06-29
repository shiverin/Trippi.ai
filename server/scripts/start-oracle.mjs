import dotenv from 'dotenv';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const serverEnvPath = path.resolve(__dirname, '../.env');
const oracleEnvPath = process.env.ORACLE_ENV_FILE || path.join(os.homedir(), '.trippi/oracle-autonomous.env');

if (fs.existsSync(serverEnvPath)) {
  dotenv.config({ path: serverEnvPath });
}

if (!fs.existsSync(oracleEnvPath)) {
  console.error(`[start:oracle] Missing Oracle env file: ${oracleEnvPath}`);
  console.error('[start:oracle] Set ORACLE_ENV_FILE or recreate /Users/shizhen/.trippi/oracle-autonomous.env.');
  process.exit(1);
}

dotenv.config({ path: oracleEnvPath, override: true });
process.env.TRIPPI_DB_PROVIDER ||= 'oracle';

console.log(`[start:oracle] Loaded Oracle env from ${oracleEnvPath}`);
console.log(`[start:oracle] Starting backend with TRIPPI_DB_PROVIDER=${process.env.TRIPPI_DB_PROVIDER}`);

require('tsconfig-paths/register');
await import('../dist/index.js');

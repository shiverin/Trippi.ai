import {
  ensureOracleSmokeTable,
  getOracleAutonomousConfigFromEnv,
  openOracleAutonomousConnection,
} from '../src/db/oracleAutonomous';

import oracledb from 'oracledb';

async function main(): Promise<void> {
  const config = getOracleAutonomousConfigFromEnv();
  if (!config) {
    throw new Error(
      [
        'Missing Oracle Autonomous DB environment.',
        'Set ORACLE_DB_USER, ORACLE_DB_PASSWORD, and ORACLE_DB_CONNECT_STRING.',
        'If you use a wallet, also set ORACLE_DB_WALLET_LOCATION or TNS_ADMIN.',
      ].join(' '),
    );
  }

  const connection = await openOracleAutonomousConnection(config);
  try {
    await ensureOracleSmokeTable(connection);

    const payload = {
      app: 'trippi',
      purpose: 'oracle-autonomous-free-tier-smoke',
      timestamp: new Date().toISOString(),
    };

    await connection.execute(
      `INSERT INTO trippi_oracle_smoke (payload) VALUES (:payload)`,
      { payload: { val: JSON.stringify(payload), type: oracledb.DB_TYPE_CLOB } },
      { autoCommit: true },
    );

    const result = await connection.execute<{ ROW_COUNT: number; DB_TIME: Date }>(
      `SELECT COUNT(*) AS row_count, CAST(SYSTIMESTAMP AS TIMESTAMP) AS db_time FROM trippi_oracle_smoke`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = result.rows?.[0];
    console.log(
      JSON.stringify(
        {
          ok: true,
          connectString: config.connectString,
          smokeRows: row?.ROW_COUNT ?? 0,
          dbTime: row?.DB_TIME,
        },
        null,
        2,
      ),
    );
  } finally {
    await connection.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

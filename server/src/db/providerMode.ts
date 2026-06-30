export type TrippiDbProvider = 'sqlite' | 'oracle-backed' | 'oracle-native-blocking' | 'oracle-async';

function providerValue(env: NodeJS.ProcessEnv = process.env): string {
  return (env.TRIPPI_DB_PROVIDER || env.TRIPPI_DB_MODE || '').trim().toLowerCase();
}

export function oracleNativeBlockingAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ORACLE_NATIVE_ALLOW_BLOCKING?.trim().toLowerCase() === 'true';
}

export function requestedOracleNative(env: NodeJS.ProcessEnv = process.env): boolean {
  return providerValue(env) === 'oracle-native';
}

export function sqliteMirrorExplicitlyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TRIPPI_ENABLE_SQLITE_MIRROR?.trim().toLowerCase() === 'true';
}

export function resolveDbProvider(env: NodeJS.ProcessEnv = process.env): TrippiDbProvider {
  const provider = providerValue(env);
  if (provider === 'oracle-async') {
    return 'oracle-async';
  }
  if (provider === 'oracle-native') {
    return oracleNativeBlockingAllowed(env)
      ? 'oracle-native-blocking'
      : sqliteMirrorExplicitlyEnabled(env)
        ? 'oracle-backed'
        : 'oracle-async';
  }
  if (provider === 'oracle' || provider === 'oracle-mirror' || provider === 'oracle-backed') {
    return sqliteMirrorExplicitlyEnabled(env) ? 'oracle-backed' : 'oracle-async';
  }
  return 'sqlite';
}

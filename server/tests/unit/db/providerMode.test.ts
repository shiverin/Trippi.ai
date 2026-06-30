import { resolveDbProvider } from '../../../src/db/providerMode';

import { describe, expect, it } from 'vitest';

describe('providerMode', () => {
  it('keeps default deployments on local SQLite', () => {
    expect(resolveDbProvider({} as NodeJS.ProcessEnv)).toBe('sqlite');
  });

  it('uses direct async Oracle for Oracle provider aliases by default', () => {
    expect(resolveDbProvider({ TRIPPI_DB_PROVIDER: 'oracle' } as NodeJS.ProcessEnv)).toBe('oracle-async');
    expect(resolveDbProvider({ TRIPPI_DB_PROVIDER: 'oracle-mirror' } as NodeJS.ProcessEnv)).toBe('oracle-async');
    expect(resolveDbProvider({ TRIPPI_DB_PROVIDER: 'oracle-backed' } as NodeJS.ProcessEnv)).toBe('oracle-async');
  });

  it('requires an explicit opt-in before enabling the legacy SQLite mirror', () => {
    expect(
      resolveDbProvider({
        TRIPPI_DB_PROVIDER: 'oracle',
        TRIPPI_ENABLE_SQLITE_MIRROR: 'true',
      } as NodeJS.ProcessEnv),
    ).toBe('oracle-backed');
  });

  it('enables the opt-in async Oracle provider without the blocking native bridge', () => {
    expect(resolveDbProvider({ TRIPPI_DB_PROVIDER: 'oracle-async' } as NodeJS.ProcessEnv)).toBe('oracle-async');
  });

  it('downgrades oracle-native unless blocking mode is explicitly allowed', () => {
    expect(resolveDbProvider({ TRIPPI_DB_PROVIDER: 'oracle-native' } as NodeJS.ProcessEnv)).toBe('oracle-async');
    expect(
      resolveDbProvider({
        TRIPPI_DB_PROVIDER: 'oracle-native',
        ORACLE_NATIVE_ALLOW_BLOCKING: 'true',
      } as NodeJS.ProcessEnv),
    ).toBe('oracle-native-blocking');
  });
});

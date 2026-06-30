// @ts-expect-error — plain .mjs script with no .d.ts; import as JS module.
import { checkParity } from '../../scripts/i18n-parity.mjs';

import { describe, it, expect } from 'vitest';

/**
 * Enforces the file-set contract for the i18n migration: every non-en locale
 * dir must contain the exact same domain files as en/.
 *
 * Key-set drift is intentionally NOT enforced here — translation work happens
 * gradually and gating CI on every newly-added EN key would block feature
 * merges. The CLI script still prints the key-drift report so translators can
 * see what they owe; only file-level drift is a structural bug.
 */
describe('i18n parity', () => {
  it('every locale has the same domain files as en', () => {
    const report = checkParity();
    expect(report.fileDrift).toEqual([]);
  });

  it('reports key drift as data (not enforced, used by the CLI tool)', () => {
    const report = checkParity();
    // We do not assert here — translation drift is expected and acceptable.
    // The shape check just confirms the report contract for tooling consumers.
    expect(Array.isArray(report.keyDrift)).toBe(true);
    for (const entry of report.keyDrift) {
      expect(typeof entry.locale).toBe('string');
      expect(typeof entry.file).toBe('string');
      expect(Array.isArray(entry.missing)).toBe(true);
      expect(Array.isArray(entry.extra)).toBe(true);
    }
  });

  it('does not include retired no-subscription promise copy in system notices', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const i18nDir = path.dirname(fileURLToPath(import.meta.url));
    const retiredPromisePattern =
      /\b(always\s+(?:be\s+)?open[- ]source|always\s+self[- ]hosted|no\s+subscriptions|no\s+strings\s+attached)\b/i;
    const offenders = fs
      .readdirSync(i18nDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(i18nDir, entry.name, 'system_notice.ts'))
      .filter((file) => fs.existsSync(file))
      .filter((file) => retiredPromisePattern.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(i18nDir, file));

    expect(offenders).toEqual([]);
  });
});

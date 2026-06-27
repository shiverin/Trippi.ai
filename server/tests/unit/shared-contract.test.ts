import { describe, it, expect } from 'vitest';
// Smoke test: proves the server toolchain (tsx / vitest) resolves @trippi/shared.
import { idParamSchema, paginationQuerySchema } from '@trippi/shared';

describe('@trippi/shared resolves in the server toolchain', () => {
  it('imports and uses a shared schema', () => {
    expect(idParamSchema.parse('7')).toBe(7);
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, perPage: 50 });
  });
});

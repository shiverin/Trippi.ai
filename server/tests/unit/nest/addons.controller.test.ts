import { AddonsController } from '../../../src/nest/addons/addons.controller';
import type { AddonsService } from '../../../src/nest/addons/addons.service';

import { describe, it, expect, vi } from 'vitest';

function makeService(overrides: Partial<AddonsService> = {}): AddonsService {
  return {
    list: vi.fn().mockResolvedValue({ collabFeatures: {}, bagTracking: false, addons: [] }),
    ...overrides,
  } as unknown as AddonsService;
}

describe('AddonsController (parity with the legacy GET /api/addons route)', () => {
  it('GET / delegates straight to the service and returns its feed', async () => {
    const feed = {
      collabFeatures: { comments: true },
      bagTracking: true,
      addons: [{ id: 'atlas', name: 'Atlas', type: 'page', icon: 'globe', enabled: true }],
    };
    const list = vi.fn().mockResolvedValue(feed);
    const svc = makeService({ list } as Partial<AddonsService>);

    await expect(new AddonsController(svc).list()).resolves.toBe(feed);
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith();
  });
});

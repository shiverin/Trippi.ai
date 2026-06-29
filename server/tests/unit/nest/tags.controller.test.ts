import { TagsController } from '../../../src/nest/tags/tags.controller';
import type { TagsService } from '../../../src/nest/tags/tags.service';
import type { User } from '../../../src/types';
import { HttpException } from '@nestjs/common';
import type { Tag } from '@trippi/shared';

import { describe, it, expect, vi } from 'vitest';

const user = { id: 5 } as User;

function makeController(svc: Partial<TagsService>) {
  return new TagsController(svc as TagsService);
}

const tag: Tag = { id: 1, user_id: 5, name: 'Beach', color: '#10b981' };

async function thrown(fn: () => Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpException);
    const e = err as HttpException;
    return { status: e.getStatus(), body: e.getResponse() };
  }
  throw new Error('expected the handler to throw');
}

describe('TagsController (parity with the legacy /api/tags route)', () => {
  it("GET / returns the caller's tags wrapped in { tags }", async () => {
    const list = vi.fn().mockResolvedValue([tag]);
    await expect(makeController({ list }).list(user)).resolves.toEqual({ tags: [tag] });
    expect(list).toHaveBeenCalledWith(5);
  });

  describe('POST /', () => {
    it('400 when name is missing', async () => {
      const create = vi.fn();
      await expect(thrown(() => makeController({ create }).create(user, undefined))).resolves.toEqual({
        status: 400,
        body: { error: 'Tag name is required' },
      });
      expect(create).not.toHaveBeenCalled();
    });

    it('creates a tag for the caller', async () => {
      const create = vi.fn().mockResolvedValue(tag);
      await expect(makeController({ create }).create(user, 'Beach', '#10b981')).resolves.toEqual({ tag });
      expect(create).toHaveBeenCalledWith(5, 'Beach', '#10b981');
    });
  });

  describe('PUT /:id', () => {
    it('404 when the tag is not owned by the caller', async () => {
      const getByIdAndUser = vi.fn().mockResolvedValue(undefined);
      const update = vi.fn();
      await expect(thrown(() => makeController({ getByIdAndUser, update }).update(user, '9', 'X'))).resolves.toEqual({
        status: 404,
        body: { error: 'Tag not found' },
      });
      expect(getByIdAndUser).toHaveBeenCalledWith('9', 5);
      expect(update).not.toHaveBeenCalled();
    });

    it('updates an owned tag', async () => {
      const getByIdAndUser = vi.fn().mockResolvedValue(tag);
      const update = vi.fn().mockResolvedValue({ ...tag, name: 'Hike' });
      await expect(makeController({ getByIdAndUser, update }).update(user, '1', 'Hike')).resolves.toEqual({
        tag: { ...tag, name: 'Hike' },
      });
      expect(update).toHaveBeenCalledWith('1', 'Hike', undefined);
    });
  });

  describe('DELETE /:id', () => {
    it('404 when the tag is not owned by the caller', async () => {
      const getByIdAndUser = vi.fn().mockResolvedValue(undefined);
      const remove = vi.fn();
      await expect(thrown(() => makeController({ getByIdAndUser, remove }).remove(user, '9'))).resolves.toEqual({
        status: 404,
        body: { error: 'Tag not found' },
      });
      expect(remove).not.toHaveBeenCalled();
    });

    it('deletes an owned tag', async () => {
      const getByIdAndUser = vi.fn().mockResolvedValue(tag);
      const remove = vi.fn().mockResolvedValue(undefined);
      await expect(makeController({ getByIdAndUser, remove }).remove(user, '1')).resolves.toEqual({ success: true });
      expect(remove).toHaveBeenCalledWith('1');
    });
  });
});

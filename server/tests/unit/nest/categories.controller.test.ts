import { CategoriesController } from '../../../src/nest/categories/categories.controller';
import type { CategoriesService } from '../../../src/nest/categories/categories.service';
import type { User } from '../../../src/types';
import { HttpException } from '@nestjs/common';
import type { Category } from '@trippi/shared';

import { describe, it, expect, vi } from 'vitest';

const admin = { id: 1, role: 'admin' } as User;

function makeController(svc: Partial<CategoriesService>) {
  return new CategoriesController(svc as CategoriesService);
}

const cat: Category = { id: 1, name: 'Food', color: '#fff', icon: '🍔' };

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

describe('CategoriesController (parity with the legacy /api/categories route)', () => {
  it('GET / returns the category list wrapped in { categories }', async () => {
    const list = vi.fn().mockResolvedValue([cat]);
    await expect(makeController({ list }).list()).resolves.toEqual({ categories: [cat] });
  });

  describe('POST /', () => {
    it('400 when name is missing', async () => {
      const create = vi.fn();
      await expect(thrown(() => makeController({ create }).create(admin, undefined))).resolves.toEqual({
        status: 400,
        body: { error: 'Category name is required' },
      });
      expect(create).not.toHaveBeenCalled();
    });

    it('creates and returns { category }', async () => {
      const create = vi.fn().mockResolvedValue(cat);
      await expect(makeController({ create }).create(admin, 'Food', '#fff', '🍔')).resolves.toEqual({ category: cat });
      expect(create).toHaveBeenCalledWith(1, 'Food', '#fff', '🍔');
    });
  });

  describe('PUT /:id', () => {
    it('404 when the category does not exist', async () => {
      const getById = vi.fn().mockResolvedValue(undefined);
      const update = vi.fn();
      await expect(thrown(() => makeController({ getById, update }).update('9', 'X'))).resolves.toEqual({
        status: 404,
        body: { error: 'Category not found' },
      });
      expect(update).not.toHaveBeenCalled();
    });

    it('updates and returns { category }', async () => {
      const getById = vi.fn().mockResolvedValue(cat);
      const update = vi.fn().mockResolvedValue({ ...cat, name: 'Drinks' });
      await expect(makeController({ getById, update }).update('1', 'Drinks')).resolves.toEqual({
        category: { ...cat, name: 'Drinks' },
      });
      expect(update).toHaveBeenCalledWith('1', 'Drinks', undefined, undefined);
    });
  });

  describe('DELETE /:id', () => {
    it('404 when the category does not exist', async () => {
      const getById = vi.fn().mockResolvedValue(undefined);
      const remove = vi.fn();
      await expect(thrown(() => makeController({ getById, remove }).remove('9'))).resolves.toEqual({
        status: 404,
        body: { error: 'Category not found' },
      });
      expect(remove).not.toHaveBeenCalled();
    });

    it('deletes and returns { success: true }', async () => {
      const getById = vi.fn().mockResolvedValue(cat);
      const remove = vi.fn().mockResolvedValue(undefined);
      await expect(makeController({ getById, remove }).remove('1')).resolves.toEqual({ success: true });
      expect(remove).toHaveBeenCalledWith('1');
    });
  });
});

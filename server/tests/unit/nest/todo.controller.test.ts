import { describe, it, expect, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { PendingTodosController } from '../../../src/nest/todo/pending-todos.controller';
import { TodoController } from '../../../src/nest/todo/todo.controller';
import type { TodoService } from '../../../src/nest/todo/todo.service';
import type { User } from '../../../src/types';

const user = { id: 1, role: 'user', email: 'u@example.test' } as User;
const trip = { id: 5, user_id: 1 };

function makeService(overrides: Partial<TodoService> = {}): TodoService {
  return {
    verifyTripAccess: vi.fn().mockReturnValue(trip),
    canEdit: vi.fn().mockReturnValue(true),
    broadcast: vi.fn(),
    ...overrides,
  } as unknown as TodoService;
}

async function thrown(fn: () => unknown | Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpException);
    const e = err as HttpException;
    return { status: e.getStatus(), body: e.getResponse() };
  }
  throw new Error('expected the handler to throw');
}

describe('TodoController (parity with the legacy /api/trips/:tripId/todo route)', () => {
  it('404 when the trip is not accessible', async () => {
    const svc = makeService({ verifyTripAccess: vi.fn().mockReturnValue(undefined) });
    expect(await thrown(() => new TodoController(svc).list(user, '5'))).toEqual({
      status: 404, body: { error: 'Trip not found' },
    });
  });

  it('GET / returns items', async () => {
    const svc = makeService({ listItems: vi.fn().mockReturnValue([{ id: 1 }]) } as Partial<TodoService>);
    expect(await new TodoController(svc).list(user, '5')).toEqual({ items: [{ id: 1 }] });
  });

  describe('POST /', () => {
    it('403 without permission', async () => {
      const svc = makeService({ canEdit: vi.fn().mockReturnValue(false) });
      expect(await thrown(() => new TodoController(svc).create(user, '5', { name: 'Pack' }))).toEqual({
        status: 403, body: { error: 'No permission' },
      });
    });

    it('400 when name missing', async () => {
      expect(await thrown(() => new TodoController(makeService()).create(user, '5', {}))).toEqual({
        status: 400, body: { error: 'Item name is required' },
      });
    });

    it('creates and broadcasts', async () => {
      const createItem = vi.fn().mockReturnValue({ id: 9, name: 'Pack' });
      const broadcast = vi.fn();
      const svc = makeService({ createItem, broadcast } as Partial<TodoService>);
      expect(await new TodoController(svc).create(user, '5', { name: 'Pack', priority: 2 }, 'sock')).toEqual({ item: { id: 9, name: 'Pack' } });
      expect(broadcast).toHaveBeenCalledWith('5', 'todo:created', { item: { id: 9, name: 'Pack' } }, 'sock');
    });
  });

  describe('PUT /:id', () => {
    it('404 when item missing', async () => {
      const svc = makeService({ updateItem: vi.fn().mockReturnValue(null) } as Partial<TodoService>);
      expect(await thrown(() => new TodoController(svc).update(user, '5', '9', { name: 'X' }))).toEqual({
        status: 404, body: { error: 'Item not found' },
      });
    });

    it('updates, forwards changed keys, broadcasts', async () => {
      const updateItem = vi.fn().mockReturnValue({ id: 9 });
      const broadcast = vi.fn();
      const svc = makeService({ updateItem, broadcast } as Partial<TodoService>);
      await new TodoController(svc).update(user, '5', '9', { checked: true }, 'sock');
      expect(updateItem).toHaveBeenCalledWith('5', '9', expect.objectContaining({ checked: true }), ['checked']);
      expect(broadcast).toHaveBeenCalledWith('5', 'todo:updated', { item: { id: 9 } }, 'sock');
    });
  });

  describe('DELETE /:id', () => {
    it('404 when item missing', async () => {
      const svc = makeService({ deleteItem: vi.fn().mockReturnValue(false) } as Partial<TodoService>);
      expect(await thrown(() => new TodoController(svc).remove(user, '5', '9'))).toEqual({
        status: 404, body: { error: 'Item not found' },
      });
    });

    it('deletes and broadcasts', async () => {
      const deleteItem = vi.fn().mockReturnValue(true);
      const broadcast = vi.fn();
      const svc = makeService({ deleteItem, broadcast } as Partial<TodoService>);
      expect(await new TodoController(svc).remove(user, '5', '9', 'sock')).toEqual({ success: true });
      expect(broadcast).toHaveBeenCalledWith('5', 'todo:deleted', { itemId: 9 }, 'sock');
    });
  });

  it('PUT /reorder succeeds with permission', async () => {
    const reorderItems = vi.fn();
    const svc = makeService({ reorderItems } as Partial<TodoService>);
    expect(await new TodoController(svc).reorder(user, '5', [3, 1, 2])).toEqual({ success: true });
    expect(reorderItems).toHaveBeenCalledWith('5', [3, 1, 2]);
  });

  describe('category assignees', () => {
    it('GET returns assignees', async () => {
      const svc = makeService({ getCategoryAssignees: vi.fn().mockReturnValue([{ user_id: 2 }]) } as Partial<TodoService>);
      expect(await new TodoController(svc).categoryAssignees(user, '5')).toEqual({ assignees: [{ user_id: 2 }] });
    });

    it('PUT updates, decodes the category and broadcasts', async () => {
      const updateCategoryAssignees = vi.fn().mockReturnValue([{ user_id: 2 }]);
      const broadcast = vi.fn();
      const svc = makeService({ updateCategoryAssignees, broadcast } as Partial<TodoService>);
      await new TodoController(svc).updateCategoryAssignees(user, '5', 'To%20Buy', [2], 'sock');
      expect(updateCategoryAssignees).toHaveBeenCalledWith('5', 'To Buy', [2]);
      expect(broadcast).toHaveBeenCalledWith('5', 'todo:assignees', { category: 'To Buy', assignees: [{ user_id: 2 }] }, 'sock');
    });
  });
});

describe('PendingTodosController', () => {
  it('GET /api/todos/pending returns pending todos for the current user', async () => {
    const listPending = vi.fn().mockReturnValue([{ id: 1, name: 'Buy flight' }]);
    const svc = makeService({ listPending } as Partial<TodoService>);

    expect(await new PendingTodosController(svc).pending(user)).toEqual({
      todos: [{ id: 1, name: 'Buy flight' }],
    });
    expect(listPending).toHaveBeenCalledWith(user.id);
  });
});

import { asyncDb } from '../db/asyncDatabase';
import { avatarUrl } from './authService';

const BAG_COLORS = [
  '#6366f1',
  '#ec4899',
  '#f97316',
  '#10b981',
  '#06b6d4',
  '#8b5cf6',
  '#ef4444',
  '#f59e0b',
  '#3b82f6',
  '#84cc16',
  '#d946ef',
  '#14b8a6',
  '#f43f5e',
  '#a855f7',
  '#eab308',
  '#64748b',
];

export { verifyTripAccess } from './tripAccess';

// ── Items ──────────────────────────────────────────────────────────────────

export async function listItems(tripId: string | number) {
  return asyncDb
    .prepare('SELECT * FROM packing_items WHERE trip_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(tripId);
}

export async function createItem(
  tripId: string | number,
  data: { name: string; category?: string; checked?: boolean; quantity?: number },
) {
  const maxOrder = await asyncDb
    .prepare('SELECT MAX(sort_order) as max FROM packing_items WHERE trip_id = ?')
    .get<{ max: number | null }>(tripId);
  const sortOrder = (maxOrder?.max !== null && maxOrder?.max !== undefined ? maxOrder.max : -1) + 1;
  const qty = Math.max(1, Math.min(999, Number(data.quantity) || 1));

  const result = await asyncDb
    .prepare(
      'INSERT INTO packing_items (trip_id, name, checked, category, sort_order, quantity) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(tripId, data.name, data.checked ? 1 : 0, data.category || 'Allgemein', sortOrder, qty);

  return asyncDb.prepare('SELECT * FROM packing_items WHERE id = ?').get(result.lastInsertRowid);
}

export async function updateItem(
  tripId: string | number,
  id: string | number,
  data: {
    name?: string;
    checked?: number;
    category?: string;
    weight_grams?: number | null;
    bag_id?: number | null;
    quantity?: number;
  },
  bodyKeys: string[],
) {
  const item = await asyncDb.prepare('SELECT * FROM packing_items WHERE id = ? AND trip_id = ?').get(id, tripId);
  if (!item) return null;

  await asyncDb.prepare(
    `
    UPDATE packing_items SET
      name = COALESCE(?, name),
      checked = CASE WHEN ? IS NOT NULL THEN ? ELSE checked END,
      category = COALESCE(?, category),
      weight_grams = CASE WHEN ? THEN ? ELSE weight_grams END,
      bag_id = CASE WHEN ? THEN ? ELSE bag_id END,
      quantity = CASE WHEN ? THEN ? ELSE quantity END
    WHERE id = ?
  `,
  ).run(
    data.name || null,
    data.checked !== undefined ? 1 : null,
    data.checked ? 1 : 0,
    data.category || null,
    bodyKeys.includes('weight_grams') ? 1 : 0,
    data.weight_grams ?? null,
    bodyKeys.includes('bag_id') ? 1 : 0,
    data.bag_id ?? null,
    bodyKeys.includes('quantity') ? 1 : 0,
    data.quantity ? Math.max(1, Math.min(999, Number(data.quantity))) : 1,
    id,
  );

  return asyncDb.prepare('SELECT * FROM packing_items WHERE id = ?').get(id);
}

export async function deleteItem(tripId: string | number, id: string | number) {
  const item = await asyncDb.prepare('SELECT id FROM packing_items WHERE id = ? AND trip_id = ?').get(id, tripId);
  if (!item) return false;

  await asyncDb.prepare('DELETE FROM packing_items WHERE id = ?').run(id);
  return true;
}

// ── Bulk Import ────────────────────────────────────────────────────────────

interface ImportItem {
  name?: string;
  checked?: boolean;
  category?: string;
  weight_grams?: string | number;
  bag?: string;
  quantity?: number;
}

export async function bulkImport(tripId: string | number, items: ImportItem[]) {
  const maxOrder = await asyncDb
    .prepare('SELECT MAX(sort_order) as max FROM packing_items WHERE trip_id = ?')
    .get<{ max: number | null }>(tripId);
  let sortOrder = (maxOrder?.max !== null && maxOrder?.max !== undefined ? maxOrder.max : -1) + 1;

  const stmt = asyncDb.prepare(
    'INSERT INTO packing_items (trip_id, name, checked, category, weight_grams, bag_id, sort_order, quantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const created: any[] = [];

  const insertAll = asyncDb.transaction(async () => {
    for (const item of items) {
      if (!item.name?.trim()) continue;
      const checked = item.checked ? 1 : 0;
      const weight = item.weight_grams ? parseInt(String(item.weight_grams)) || null : null;

      // Resolve bag by name if provided
      let bagId = null;
      if (item.bag?.trim()) {
        const bagName = item.bag.trim();
        const existing = await asyncDb
          .prepare('SELECT id FROM packing_bags WHERE trip_id = ? AND name = ?')
          .get<{ id: number }>(tripId, bagName);
        if (existing) {
          bagId = existing.id;
        } else {
          const bagCount = (
            await asyncDb.prepare('SELECT COUNT(*) as c FROM packing_bags WHERE trip_id = ?').get<{ c: number }>(
              tripId,
            )
          )?.c;
          const newBag = await asyncDb
            .prepare('INSERT INTO packing_bags (trip_id, name, color) VALUES (?, ?, ?)')
            .run(tripId, bagName, BAG_COLORS[(bagCount ?? 0) % BAG_COLORS.length]);
          bagId = newBag.lastInsertRowid;
        }
      }

      const qty = Math.max(1, Math.min(999, Number(item.quantity) || 1));
      const result = await stmt.run(
        tripId,
        item.name.trim(),
        checked,
        item.category?.trim() || 'Other',
        weight,
        bagId,
        sortOrder++,
        qty,
      );
      created.push(await asyncDb.prepare('SELECT * FROM packing_items WHERE id = ?').get(result.lastInsertRowid));
    }
  });

  await insertAll();
  return created;
}

// ── Bags ───────────────────────────────────────────────────────────────────

export async function listBags(tripId: string | number) {
  const bags = await asyncDb.prepare('SELECT * FROM packing_bags WHERE trip_id = ? ORDER BY sort_order, id').all<any>(
    tripId,
  );
  const members = await asyncDb
    .prepare(
      `
    SELECT bm.bag_id, bm.user_id, u.username, u.avatar
    FROM packing_bag_members bm
    JOIN users u ON bm.user_id = u.id
    JOIN packing_bags b ON bm.bag_id = b.id
    WHERE b.trip_id = ?
  `,
    )
    .all<{ bag_id: number; user_id: number; username: string; avatar: string | null }>(tripId);
  const membersByBag = new Map<number, typeof members>();
  for (const m of members) {
    if (!membersByBag.has(m.bag_id)) membersByBag.set(m.bag_id, []);
    membersByBag.get(m.bag_id)!.push(m);
  }
  return bags.map((b) => ({
    ...b,
    members: (membersByBag.get(b.id) || []).map((m) => ({ ...m, avatar: avatarUrl(m) })),
  }));
}

export async function setBagMembers(tripId: string | number, bagId: string | number, userIds: number[]) {
  const bag = await asyncDb.prepare('SELECT * FROM packing_bags WHERE id = ? AND trip_id = ?').get(bagId, tripId);
  if (!bag) return null;
  await asyncDb.prepare('DELETE FROM packing_bag_members WHERE bag_id = ?').run(bagId);
  const ins = asyncDb.prepare('INSERT OR IGNORE INTO packing_bag_members (bag_id, user_id) VALUES (?, ?)');
  for (const uid of userIds) await ins.run(bagId, uid);
  const rows = await asyncDb
    .prepare(
      `
    SELECT bm.user_id, u.username, u.avatar
    FROM packing_bag_members bm JOIN users u ON bm.user_id = u.id
    WHERE bm.bag_id = ?
  `,
    )
    .all<{ user_id: number; username: string; avatar: string | null }>(bagId);
  return rows.map((m) => ({ ...m, avatar: avatarUrl(m) }));
}

export async function createBag(tripId: string | number, data: { name: string; color?: string }) {
  const maxOrder = await asyncDb
    .prepare('SELECT MAX(sort_order) as max FROM packing_bags WHERE trip_id = ?')
    .get<{ max: number | null }>(tripId);
  const result = await asyncDb
    .prepare('INSERT INTO packing_bags (trip_id, name, color, sort_order) VALUES (?, ?, ?, ?)')
    .run(tripId, data.name.trim(), data.color || '#6366f1', (maxOrder?.max ?? -1) + 1);
  return asyncDb.prepare('SELECT * FROM packing_bags WHERE id = ?').get(result.lastInsertRowid);
}

export async function updateBag(
  tripId: string | number,
  bagId: string | number,
  data: { name?: string; color?: string; weight_limit_grams?: number | null; user_id?: number | null },
  bodyKeys?: string[],
) {
  const bag = await asyncDb.prepare('SELECT * FROM packing_bags WHERE id = ? AND trip_id = ?').get<any>(bagId, tripId);
  if (!bag) return null;

  await asyncDb.prepare(
    `UPDATE packing_bags SET
    name = COALESCE(?, name),
    color = COALESCE(?, color),
    weight_limit_grams = ?,
    user_id = CASE WHEN ? THEN ? ELSE user_id END
    WHERE id = ?`,
  ).run(
    data.name?.trim() || null,
    data.color || null,
    data.weight_limit_grams ?? (bag as any).weight_limit_grams ?? null,
    bodyKeys?.includes('user_id') ? 1 : 0,
    data.user_id ?? null,
    bagId,
  );
  return asyncDb
    .prepare(
      'SELECT b.*, u.username as assigned_username FROM packing_bags b LEFT JOIN users u ON b.user_id = u.id WHERE b.id = ?',
    )
    .get(bagId);
}

export async function deleteBag(tripId: string | number, bagId: string | number) {
  const bag = await asyncDb.prepare('SELECT * FROM packing_bags WHERE id = ? AND trip_id = ?').get(bagId, tripId);
  if (!bag) return false;

  await asyncDb.prepare('DELETE FROM packing_bags WHERE id = ?').run(bagId);
  return true;
}

// ── List Templates ─────────────────────────────────────────────────────────

/**
 * Read-only template list for trip members (name + item count), so non-admins
 * can pick a template to apply. Management (create/edit/delete) stays admin-only
 * under /api/admin/packing-templates.
 */
export async function listTemplates() {
  return asyncDb
    .prepare(
      `
    SELECT pt.id, pt.name,
      (SELECT COUNT(*) FROM packing_template_items ti JOIN packing_template_categories tc ON ti.category_id = tc.id WHERE tc.template_id = pt.id) as item_count
    FROM packing_templates pt
    ORDER BY pt.created_at DESC
  `,
    )
    .all<{ id: number; name: string; item_count: number }>();
}

// ── Apply Template ─────────────────────────────────────────────────────────

export async function applyTemplate(tripId: string | number, templateId: string | number) {
  const templateItems = await asyncDb
    .prepare(
      `
    SELECT ti.name, tc.name as category
    FROM packing_template_items ti
    JOIN packing_template_categories tc ON ti.category_id = tc.id
    WHERE tc.template_id = ?
    ORDER BY tc.sort_order, ti.sort_order
  `,
    )
    .all<{ name: string; category: string }>(templateId);

  if (templateItems.length === 0) return null;

  const maxOrder = await asyncDb
    .prepare('SELECT MAX(sort_order) as max FROM packing_items WHERE trip_id = ?')
    .get<{ max: number | null }>(tripId);
  let sortOrder = (maxOrder?.max !== null && maxOrder?.max !== undefined ? maxOrder.max : -1) + 1;

  const insert = asyncDb.prepare(
    'INSERT INTO packing_items (trip_id, name, checked, category, sort_order) VALUES (?, ?, 0, ?, ?)',
  );
  const added: any[] = [];
  for (const ti of templateItems) {
    const result = await insert.run(tripId, ti.name, ti.category, sortOrder++);
    const item = await asyncDb.prepare('SELECT * FROM packing_items WHERE id = ?').get(result.lastInsertRowid);
    added.push(item);
  }

  return added;
}

// ── Save as Template ──────────────────────────────────────────────────────

export async function saveAsTemplate(tripId: string | number, userId: number, templateName: string) {
  const items = await asyncDb
    .prepare('SELECT name, category FROM packing_items WHERE trip_id = ? ORDER BY sort_order ASC')
    .all<{ name: string; category: string }>(tripId);

  if (items.length === 0) return null;

  const result = await asyncDb
    .prepare('INSERT INTO packing_templates (name, created_by) VALUES (?, ?)')
    .run(templateName, userId);
  const templateId = Number(result.lastInsertRowid);

  const categories = [...new Set(items.map((i) => i.category || 'Other'))];
  const catIdMap = new Map<string, number>();

  for (let i = 0; i < categories.length; i++) {
    const catResult = await asyncDb
      .prepare('INSERT INTO packing_template_categories (template_id, name, sort_order) VALUES (?, ?, ?)')
      .run(templateId, categories[i], i);
    catIdMap.set(categories[i], Number(catResult.lastInsertRowid));
  }

  const itemsByCategory = new Map<string, number>();
  for (const item of items) {
    const catId = catIdMap.get(item.category || 'Other')!;
    const order = itemsByCategory.get(item.category || 'Other') || 0;
    await asyncDb.prepare('INSERT INTO packing_template_items (category_id, name, sort_order) VALUES (?, ?, ?)').run(
      catId,
      item.name,
      order,
    );
    itemsByCategory.set(item.category || 'Other', order + 1);
  }

  return { id: Number(templateId), name: templateName, categoryCount: categories.length, itemCount: items.length };
}

// ── Category Assignees ─────────────────────────────────────────────────────

export async function getCategoryAssignees(tripId: string | number) {
  const rows = await asyncDb
    .prepare(
      `
    SELECT pca.category_name, pca.user_id, u.username, u.avatar
    FROM packing_category_assignees pca
    JOIN users u ON pca.user_id = u.id
    WHERE pca.trip_id = ?
  `,
    )
    .all(tripId);

  // Group by category
  const assignees: Record<string, { user_id: number; username: string; avatar: string | null }[]> = {};
  for (const row of rows as any[]) {
    if (!assignees[row.category_name]) assignees[row.category_name] = [];
    assignees[row.category_name].push({ user_id: row.user_id, username: row.username, avatar: avatarUrl(row) });
  }

  return assignees;
}

export async function updateCategoryAssignees(
  tripId: string | number,
  categoryName: string,
  userIds: number[] | undefined,
) {
  await asyncDb
    .prepare('DELETE FROM packing_category_assignees WHERE trip_id = ? AND category_name = ?')
    .run(tripId, categoryName);

  if (Array.isArray(userIds) && userIds.length > 0) {
    const insert = asyncDb.prepare(
      'INSERT OR IGNORE INTO packing_category_assignees (trip_id, category_name, user_id) VALUES (?, ?, ?)',
    );
    for (const uid of userIds) await insert.run(tripId, categoryName, uid);
  }

  const updated = await asyncDb
    .prepare(
      `
    SELECT pca.user_id, u.username, u.avatar
    FROM packing_category_assignees pca
    JOIN users u ON pca.user_id = u.id
    WHERE pca.trip_id = ? AND pca.category_name = ?
  `,
    )
    .all<{ user_id: number; username: string; avatar: string | null }>(tripId, categoryName);
  return updated.map((m) => ({ ...m, avatar: avatarUrl(m) }));
}

// ── Reorder ────────────────────────────────────────────────────────────────

export async function reorderItems(tripId: string | number, orderedIds: number[]) {
  const update = asyncDb.prepare('UPDATE packing_items SET sort_order = ? WHERE id = ? AND trip_id = ?');
  const updateMany = asyncDb.transaction(async (ids: number[]) => {
    for (const [index, id] of ids.entries()) {
      await update.run(index, id, tripId);
    }
  });
  await updateMany(orderedIds);
}

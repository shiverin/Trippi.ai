import { describe, expect, it } from 'vitest';
import { buildPackingItem } from '../../tests/helpers/factories';
import type { PackingBag } from '../types';
import {
  buildPackingResponsibilitySummary,
  isCriticalPackingItem,
  isTrackablePackingItem,
  packingResponsibilityLabel,
} from './packingResponsibilities';

describe('packingResponsibilities', () => {
  it('resolves personal, shared, and unassigned packing responsibility', () => {
    const sharedBag: PackingBag = {
      id: 10,
      trip_id: 1,
      name: 'Shared duffel',
      color: '#38bdf8',
      sort_order: 0,
      members: [
        { user_id: 2, username: 'Alice', avatar: null },
        { user_id: 3, username: 'Bob', avatar: null },
      ],
    };
    const passport = buildPackingItem({ id: 1, name: 'Passport', category: 'Documents', checked: 1 });
    const adapter = buildPackingItem({ id: 2, name: 'Adapter', category: 'Electronics', bag_id: sharedBag.id });
    const scarf = buildPackingItem({ id: 3, name: 'Scarf', category: 'Clothing' });

    const summary = buildPackingResponsibilitySummary({
      items: [passport, adapter, scarf],
      bags: [sharedBag],
      categoryAssignees: {
        Documents: [{ user_id: 2, username: 'Alice', avatar: null }],
      },
      defaultCategory: 'Other',
    });

    expect(packingResponsibilityLabel(summary.itemResponsibilities.get(passport.id))).toBe('Alice');
    expect(packingResponsibilityLabel(summary.itemResponsibilities.get(adapter.id))).toBe('Alice + Bob');
    expect(summary.itemResponsibilities.get(adapter.id)?.isShared).toBe(true);
    expect(summary.itemResponsibilities.get(scarf.id)?.isUnassigned).toBe(true);
  });

  it('tracks completion by member and overall trip without double-counting overall progress', () => {
    const sharedBag: PackingBag = {
      id: 10,
      trip_id: 1,
      name: 'Shared duffel',
      color: '#38bdf8',
      sort_order: 0,
      members: [
        { user_id: 2, username: 'Alice', avatar: null },
        { user_id: 3, username: 'Bob', avatar: null },
      ],
    };
    const summary = buildPackingResponsibilitySummary({
      items: [
        buildPackingItem({ id: 1, name: 'Passport', category: 'Documents', checked: 1 }),
        buildPackingItem({ id: 2, name: 'Adapter', category: 'Electronics', checked: 0, bag_id: sharedBag.id }),
        buildPackingItem({ id: 3, name: 'Scarf', category: 'Clothing', checked: 0 }),
      ],
      bags: [sharedBag],
      categoryAssignees: {
        Documents: [{ user_id: 2, username: 'Alice', avatar: null }],
      },
      defaultCategory: 'Other',
    });

    expect(summary.overall).toMatchObject({ packed: 1, total: 3, percent: 33 });
    expect(summary.memberProgress.find((bucket) => bucket.label === 'Alice')).toMatchObject({
      packed: 1,
      total: 2,
      percent: 50,
    });
    expect(summary.memberProgress.find((bucket) => bucket.label === 'Bob')).toMatchObject({
      packed: 0,
      total: 1,
      percent: 0,
    });
    expect(summary.memberProgress.find((bucket) => bucket.label === 'Unassigned')).toMatchObject({
      packed: 0,
      total: 1,
      percent: 0,
    });
  });

  it('ignores empty-category placeholder rows for responsibility progress', () => {
    const placeholder = buildPackingItem({ id: 4, name: '...', category: 'Toiletries', checked: 0 });
    const summary = buildPackingResponsibilitySummary({
      items: [placeholder, buildPackingItem({ id: 5, name: 'Toothbrush', category: 'Toiletries', checked: 1 })],
      bags: [],
      categoryAssignees: {
        Toiletries: [{ user_id: 2, username: 'Alice', avatar: null }],
      },
      defaultCategory: 'Other',
    });

    expect(isTrackablePackingItem(placeholder)).toBe(false);
    expect(summary.itemResponsibilities.has(placeholder.id)).toBe(false);
    expect(summary.overall).toMatchObject({ packed: 1, total: 1, percent: 100 });
    expect(summary.memberProgress).toHaveLength(1);
  });

  it('detects critical travel packing items from item name or category', () => {
    expect(isCriticalPackingItem(buildPackingItem({ name: 'Passport', category: 'Documents' }))).toBe(true);
    expect(isCriticalPackingItem(buildPackingItem({ name: 'Prescription meds', category: 'Health' }))).toBe(true);
    expect(isCriticalPackingItem(buildPackingItem({ name: 'Beach towel', category: 'Pool' }))).toBe(false);
  });
});

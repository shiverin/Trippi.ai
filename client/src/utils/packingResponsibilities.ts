import type { PackingBag, PackingItem } from '../types';

export interface PackingResponsibleMember {
  user_id: number;
  username: string;
  avatar?: string | null;
}

export type PackingResponsibilitySource = 'category' | 'bag' | 'category-bag' | 'unassigned';

export interface PackingItemResponsibility {
  itemId: number;
  category: string;
  bagName: string | null;
  members: PackingResponsibleMember[];
  source: PackingResponsibilitySource;
  isShared: boolean;
  isUnassigned: boolean;
}

export interface PackingProgressBucket {
  key: string;
  label: string;
  packed: number;
  total: number;
  percent: number;
  kind: 'member' | 'unassigned';
}

export interface PackingResponsibilitySummary {
  itemResponsibilities: Map<number, PackingItemResponsibility>;
  overall: PackingProgressBucket;
  memberProgress: PackingProgressBucket[];
}

interface PackingResponsibilityInput {
  items: PackingItem[];
  bags?: PackingBag[];
  categoryAssignees?: Record<string, PackingResponsibleMember[] | undefined>;
  defaultCategory: string;
}

const CRITICAL_PACKING_RE =
  /\b(passports?|visas?|boarding pass(?:es)?|tickets?|identification|identity|driver'?s license|ids?|wallets?|cash|cards?|medic(?:ation|ine|al)|prescriptions?|documents?|insurance|keys?)\b/i;

function isPacked(item: PackingItem): boolean {
  return Number(item.checked) === 1;
}

export function isTrackablePackingItem(item: PackingItem): boolean {
  return item.name.trim() !== '...';
}

function percent(packed: number, total: number): number {
  return total > 0 ? Math.round((packed / total) * 100) : 0;
}

function addUniqueMember(
  membersById: Map<number, PackingResponsibleMember>,
  member: PackingResponsibleMember | null | undefined
) {
  if (!member || !Number.isFinite(member.user_id)) return;
  if (!membersById.has(member.user_id)) {
    membersById.set(member.user_id, {
      user_id: member.user_id,
      username: member.username || `Member ${member.user_id}`,
      avatar: member.avatar ?? null,
    });
  }
}

function bagResponsibleMembers(bag: PackingBag | undefined): PackingResponsibleMember[] {
  if (!bag) return [];
  if (bag.members && bag.members.length > 0) {
    return bag.members.map((member) => ({
      user_id: member.user_id,
      username: member.username,
      avatar: member.avatar ?? null,
    }));
  }
  if (bag.user_id != null) {
    return [
      {
        user_id: bag.user_id,
        username: bag.assigned_username || `Member ${bag.user_id}`,
        avatar: null,
      },
    ];
  }
  return [];
}

function resolvePackingItemResponsibility({
  item,
  bag,
  categoryAssignees,
  defaultCategory,
}: {
  item: PackingItem;
  bag: PackingBag | undefined;
  categoryAssignees: Record<string, PackingResponsibleMember[] | undefined>;
  defaultCategory: string;
}): PackingItemResponsibility {
  const category = item.category || defaultCategory;
  const membersById = new Map<number, PackingResponsibleMember>();
  const categoryMembers = categoryAssignees[category] || [];
  const bagMembers = bagResponsibleMembers(bag);

  for (const member of categoryMembers) addUniqueMember(membersById, member);
  for (const member of bagMembers) addUniqueMember(membersById, member);

  const members = Array.from(membersById.values());
  const hasCategoryMembers = categoryMembers.length > 0;
  const hasBagMembers = bagMembers.length > 0;
  const source: PackingResponsibilitySource =
    members.length === 0
      ? 'unassigned'
      : hasCategoryMembers && hasBagMembers
        ? 'category-bag'
        : hasBagMembers
          ? 'bag'
          : 'category';

  return {
    itemId: item.id,
    category,
    bagName: bag?.name || null,
    members,
    source,
    isShared: members.length > 1,
    isUnassigned: members.length === 0,
  };
}

export function buildPackingResponsibilitySummary({
  items,
  bags = [],
  categoryAssignees = {},
  defaultCategory,
}: PackingResponsibilityInput): PackingResponsibilitySummary {
  const trackedItems = items.filter(isTrackablePackingItem);
  const bagById = new Map(bags.map((bag) => [bag.id, bag]));
  const itemResponsibilities = new Map<number, PackingItemResponsibility>();
  const memberBuckets = new Map<number, PackingProgressBucket>();
  const unassigned: PackingProgressBucket = {
    key: 'unassigned',
    label: 'Unassigned',
    packed: 0,
    total: 0,
    percent: 0,
    kind: 'unassigned',
  };
  let packedTotal = 0;

  for (const item of trackedItems) {
    const packed = isPacked(item);
    if (packed) packedTotal += 1;

    const responsibility = resolvePackingItemResponsibility({
      item,
      bag: item.bag_id != null ? bagById.get(item.bag_id) : undefined,
      categoryAssignees,
      defaultCategory,
    });
    itemResponsibilities.set(item.id, responsibility);

    if (responsibility.members.length === 0) {
      unassigned.total += 1;
      if (packed) unassigned.packed += 1;
      continue;
    }

    for (const member of responsibility.members) {
      const existing =
        memberBuckets.get(member.user_id) ||
        ({
          key: `member-${member.user_id}`,
          label: member.username,
          packed: 0,
          total: 0,
          percent: 0,
          kind: 'member',
        } satisfies PackingProgressBucket);
      existing.total += 1;
      if (packed) existing.packed += 1;
      memberBuckets.set(member.user_id, existing);
    }
  }

  const memberProgress = Array.from(memberBuckets.values())
    .map((bucket) => ({ ...bucket, percent: percent(bucket.packed, bucket.total) }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));

  if (unassigned.total > 0) {
    memberProgress.push({ ...unassigned, percent: percent(unassigned.packed, unassigned.total) });
  }

  return {
    itemResponsibilities,
    overall: {
      key: 'overall',
      label: 'Trip',
      packed: packedTotal,
      total: trackedItems.length,
      percent: percent(packedTotal, trackedItems.length),
      kind: 'member',
    },
    memberProgress,
  };
}

export function packingResponsibilityLabel(responsibility: PackingItemResponsibility | undefined): string {
  if (!responsibility || responsibility.members.length === 0) return 'Unassigned';
  if (responsibility.members.length === 1) return responsibility.members[0].username;
  if (responsibility.members.length === 2) {
    return `${responsibility.members[0].username} + ${responsibility.members[1].username}`;
  }
  return `Shared ${responsibility.members.length}`;
}

export function packingResponsibilityDetail(responsibility: PackingItemResponsibility | undefined): string {
  if (!responsibility || responsibility.members.length === 0) return 'Unassigned';
  return responsibility.members.map((member) => member.username).join(', ');
}

export function isCriticalPackingItem(item: PackingItem): boolean {
  return isTrackablePackingItem(item) && CRITICAL_PACKING_RE.test([item.name, item.category].filter(Boolean).join(' '));
}

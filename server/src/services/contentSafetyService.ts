import { asyncDb } from '../db/asyncDatabase';

export type ContentSafetyCategory = 'adult' | 'violence' | 'hate' | 'drugs' | 'self_harm';

export interface ContentSafetyIssue {
  field: string;
  category: ContentSafetyCategory;
}

interface ContentSafetyRule {
  category: ContentSafetyCategory;
  terms: string[];
}

interface ContentTextField {
  field: string;
  value: unknown;
}

interface TripSharePermissions {
  share_bookings?: boolean;
  share_packing?: boolean;
  share_budget?: boolean;
  share_collab?: boolean;
}

export const CONTENT_SAFETY_BLOCKED_MESSAGE =
  'This trip cannot be shared publicly yet because it contains content that may not be family friendly. Please edit the trip details and try again.';

const DEFAULT_RULES: ContentSafetyRule[] = [
  {
    category: 'adult',
    terms: [
      'porn',
      'pornography',
      'xxx',
      'explicit sex',
      'sex party',
      'strip club',
      'brothel',
      'escort service',
      'adult massage',
      'lap dance',
      'nude show',
      'onlyfans',
    ],
  },
  {
    category: 'violence',
    terms: [
      'graphic violence',
      'gore',
      'torture',
      'beheading',
      'execution video',
      'mass shooting',
      'murder spree',
      'snuff film',
    ],
  },
  {
    category: 'hate',
    terms: ['kill all', 'gas chamber', 'white power', 'race war', 'ethnic cleansing', 'heil hitler', 'nazi rally'],
  },
  {
    category: 'drugs',
    terms: ['cocaine', 'meth', 'heroin', 'fentanyl', 'crack cocaine', 'drug deal', 'buy drugs'],
  },
  {
    category: 'self_harm',
    terms: ['self harm', 'suicide pact', 'kill myself', 'kill yourself'],
  },
];

export class ContentSafetyError extends Error {
  readonly status = 422;
  readonly code = 'CONTENT_SAFETY_BLOCKED';

  constructor(readonly issues: ContentSafetyIssue[]) {
    super(CONTENT_SAFETY_BLOCKED_MESSAGE);
  }
}

export function isContentSafetyError(err: unknown): err is ContentSafetyError {
  return err instanceof ContentSafetyError;
}

function contentFilterEnabled(): boolean {
  return process.env.TRIPPI_PUBLIC_SHARE_CONTENT_FILTER?.toLowerCase() !== 'false';
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function termMatches(text: string, term: string): boolean {
  const normalizedTerm = normalizeText(term);
  if (!normalizedTerm) return false;
  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i').test(text);
}

function customRules(): ContentSafetyRule[] {
  const raw = process.env.TRIPPI_PUBLIC_SHARE_BLOCKLIST || '';
  const terms = raw
    .split(',')
    .map((term) => term.trim())
    .filter(Boolean);
  return terms.length ? [{ category: 'adult', terms }] : [];
}

export function screenTextForFamilySafety(field: string, value: unknown): ContentSafetyIssue[] {
  if (!contentFilterEnabled() || typeof value !== 'string' || !value.trim()) return [];
  const normalized = normalizeText(value);
  const issues: ContentSafetyIssue[] = [];
  const seenCategories = new Set<ContentSafetyCategory>();
  for (const rule of [...DEFAULT_RULES, ...customRules()]) {
    if (seenCategories.has(rule.category)) continue;
    if (rule.terms.some((term) => termMatches(normalized, term))) {
      issues.push({ field, category: rule.category });
      seenCategories.add(rule.category);
    }
  }
  return issues;
}

function collectIssues(fields: ContentTextField[]): ContentSafetyIssue[] {
  const issues: ContentSafetyIssue[] = [];
  const seen = new Set<string>();
  for (const field of fields) {
    for (const issue of screenTextForFamilySafety(field.field, field.value)) {
      const key = `${issue.field}:${issue.category}`;
      if (seen.has(key)) continue;
      issues.push(issue);
      seen.add(key);
      if (issues.length >= 12) return issues;
    }
  }
  return issues;
}

function pushField(fields: ContentTextField[], field: string, value: unknown): void {
  if (typeof value === 'string' && value.trim()) fields.push({ field, value });
}

function pushRows(
  fields: ContentTextField[],
  rows: Array<Record<string, unknown>>,
  prefix: string,
  columns: string[],
): void {
  rows.forEach((row) => {
    columns.forEach((column) => pushField(fields, `${prefix} ${column.replace(/_/g, ' ')}`, row[column]));
  });
}

export async function getTripShareTextFields(
  tripId: string | number,
  permissions: TripSharePermissions,
): Promise<ContentTextField[]> {
  const fields: ContentTextField[] = [];
  const trip = await asyncDb
    .prepare('SELECT title, description FROM trips WHERE id = ?')
    .get<{ title?: string; description?: string | null }>(tripId);
  pushField(fields, 'trip title', trip?.title);
  pushField(fields, 'trip description', trip?.description);

  pushRows(
    fields,
    await asyncDb.prepare('SELECT title FROM days WHERE trip_id = ?').all<Record<string, unknown>>(tripId),
    'day',
    ['title'],
  );
  pushRows(
    fields,
    await asyncDb
      .prepare('SELECT name, description, address, reservation_notes, notes FROM places WHERE trip_id = ?')
      .all<Record<string, unknown>>(tripId),
    'place',
    ['name', 'description', 'address', 'reservation_notes', 'notes'],
  );
  pushRows(
    fields,
    await asyncDb
      .prepare(
        `
        SELECT da.notes, da.reservation_notes
        FROM day_assignments da
        JOIN days d ON d.id = da.day_id
        WHERE d.trip_id = ?
      `,
      )
      .all<Record<string, unknown>>(tripId),
    'assignment',
    ['notes', 'reservation_notes'],
  );
  pushRows(
    fields,
    await asyncDb.prepare('SELECT text FROM day_notes WHERE trip_id = ?').all<Record<string, unknown>>(tripId),
    'day note',
    ['text'],
  );

  if (permissions.share_bookings) {
    pushRows(
      fields,
      await asyncDb
        .prepare('SELECT title, location, notes FROM reservations WHERE trip_id = ?')
        .all<Record<string, unknown>>(tripId),
      'reservation',
      ['title', 'location', 'notes'],
    );
  }

  if (permissions.share_packing) {
    pushRows(
      fields,
      await asyncDb
        .prepare('SELECT name, category FROM packing_items WHERE trip_id = ?')
        .all<Record<string, unknown>>(tripId),
      'packing item',
      ['name', 'category'],
    );
  }

  if (permissions.share_budget) {
    pushRows(
      fields,
      await asyncDb
        .prepare('SELECT name, category, note FROM budget_items WHERE trip_id = ?')
        .all<Record<string, unknown>>(tripId),
      'budget item',
      ['name', 'category', 'note'],
    );
  }

  if (permissions.share_collab) {
    pushRows(
      fields,
      await asyncDb
        .prepare('SELECT text FROM collab_messages WHERE trip_id = ? AND COALESCE(deleted, 0) = 0')
        .all<Record<string, unknown>>(tripId),
      'collab message',
      ['text'],
    );
  }

  return fields;
}

export async function screenTripShareContent(
  tripId: string | number,
  permissions: TripSharePermissions,
): Promise<ContentSafetyIssue[]> {
  if (!contentFilterEnabled()) return [];
  return collectIssues(await getTripShareTextFields(tripId, permissions));
}

export async function assertTripShareContentIsFamilySafe(
  tripId: string | number,
  permissions: TripSharePermissions,
): Promise<void> {
  const issues = await screenTripShareContent(tripId, permissions);
  if (issues.length > 0) throw new ContentSafetyError(issues);
}

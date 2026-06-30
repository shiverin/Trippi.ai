import type {
  Assignment,
  AssignmentsMap,
  BudgetItem,
  Day,
  PackingBag,
  PackingItem,
  Reservation,
  TodoItem,
  Trip,
  TripMember,
} from '../../types';
import {
  buildPackingResponsibilitySummary,
  isCriticalPackingItem,
  isTrackablePackingItem,
  packingResponsibilityLabel,
  type PackingResponsibleMember,
} from '../../utils/packingResponsibilities';

export type CommandCenterAction = 'decisions' | 'bookings' | 'budget' | 'packing' | 'plan' | 'deadlines';
export type CommandCenterStatus = 'empty' | 'good' | 'attention' | 'urgent';
export type TripCommandPhase = 'before' | 'during' | 'after' | 'unscheduled';

export interface CommandCenterItem {
  id: string;
  title: string;
  meta: string;
  tone?: CommandCenterStatus;
}

export interface CommandCenterModule {
  id: CommandCenterAction;
  title: string;
  summary: string;
  status: CommandCenterStatus;
  statusLabel: string;
  count: number;
  actionLabel: string;
  emptyTitle: string;
  emptyText: string;
  items: CommandCenterItem[];
  metric?: string;
  progress?: number;
}

export interface TripCommandCenter {
  title: string;
  subtitle: string;
  phase: TripCommandPhase;
  tripDateLabel: string;
  tripLengthLabel: string;
  travelerLabel: string;
  nextDeadlineLabel: string;
  modules: CommandCenterModule[];
}

interface BuildCommandCenterInput {
  trip: Trip;
  days: Day[];
  assignments: AssignmentsMap;
  reservations: Reservation[];
  budgetItems: BudgetItem[];
  packingItems: PackingItem[];
  packingBags?: PackingBag[];
  packingCategoryAssignees?: Record<string, PackingResponsibleMember[] | undefined>;
  todoItems: TodoItem[];
  tripMembers: TripMember[];
  now?: Date;
}

interface TimelineEntry {
  id: string;
  title: string;
  date: string;
  source: 'todo' | 'booking' | 'trip' | 'budget';
  tone?: CommandCenterStatus;
}

const DAY_MS = 86_400_000;
const DECISION_RE = /\b(decide|decision|choose|pick|vote|poll|approve|approval|finali[sz]e)\b/i;
const BOOKING_RE = /\b(book|booking|reservation|reserve|ticket|flight|hotel|check-?in|visa|passport)\b/i;
const TRANSPORT_TYPES = new Set([
  'flight',
  'train',
  'subway',
  'bus',
  'car',
  'taxi',
  'bicycle',
  'cruise',
  'ferry',
  'transport_other',
]);

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value.includes('T') ? value : `${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function datePart(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.split('T')[0] || null;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS);
}

function daysUntil(date: string | null | undefined, now: Date): number | null {
  const parsed = parseDate(date);
  if (!parsed) return null;
  return daysBetween(now, parsed);
}

function formatRelativeDate(date: string | null | undefined, now: Date): string {
  const delta = daysUntil(date, now);
  if (delta == null) return 'No date';
  if (delta < 0) return `${Math.abs(delta)}d overdue`;
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  return `In ${delta}d`;
}

function displayDate(date: string | null | undefined): string {
  const parsed = parseDate(date);
  if (!parsed) return 'No date';
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: amount >= 1000 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${Math.round(amount)} ${currency}`;
  }
}

function dayName(day: Day, fallbackIndex: number): string {
  const ordinal = day.day_number ?? fallbackIndex + 1;
  return day.title || `Day ${ordinal}`;
}

function sortDays(days: Day[]): Day[] {
  return [...days].sort((a, b) => {
    const byNumber = (a.day_number ?? Number.POSITIVE_INFINITY) - (b.day_number ?? Number.POSITIVE_INFINITY);
    if (byNumber !== 0) return byNumber;
    return (a.date || '').localeCompare(b.date || '');
  });
}

function todoText(todo: TodoItem): string {
  return [todo.name, todo.category, todo.description].filter(Boolean).join(' ');
}

function isOpenTodo(todo: TodoItem): boolean {
  return Number(todo.checked) !== 1;
}

function reservationTitle(reservation: Reservation): string {
  const prefix = TRANSPORT_TYPES.has(reservation.type) ? 'Transport' : 'Booking';
  return reservation.title || `${prefix} ${reservation.id}`;
}

function statusLabel(status: CommandCenterStatus): string {
  if (status === 'urgent') return 'Urgent';
  if (status === 'attention') return 'Needs attention';
  if (status === 'good') return 'On track';
  return 'Empty';
}

function dueTone(isDueOrOverdue: boolean): CommandCenterStatus {
  return isDueOrOverdue ? 'urgent' : 'attention';
}

function parseTimeMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = value.includes('T') ? value.split('T')[1] : value;
  const match = time.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function timeLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0');
  const mins = (minutes % 60).toString().padStart(2, '0');
  return `${hours}:${mins}`;
}

function assignmentInterval(assignment: Assignment, day: Day, dayIndex: number) {
  const place = assignment.place;
  const start = parseTimeMinutes(assignment.assignment_time || place?.place_time);
  if (start == null) return null;
  const explicitEnd = parseTimeMinutes(assignment.assignment_end_time || place?.end_time);
  const duration = Number(place?.duration_minutes || 60);
  const end = explicitEnd != null && explicitEnd > start ? explicitEnd : start + Math.max(duration, 15);
  return {
    id: `assignment-${assignment.id}`,
    dayId: day.id,
    dayName: dayName(day, dayIndex),
    title: place?.name || 'Untitled stop',
    start,
    end,
  };
}

function reservationInterval(reservation: Reservation, dayById: Map<number, { day: Day; index: number }>) {
  const start = parseTimeMinutes(reservation.reservation_time);
  if (start == null || reservation.day_id == null) return null;
  const dayEntry = dayById.get(reservation.day_id);
  if (!dayEntry) return null;
  const explicitEnd = parseTimeMinutes(reservation.reservation_end_time);
  const end = explicitEnd != null && explicitEnd > start ? explicitEnd : start + 60;
  return {
    id: `reservation-${reservation.id}`,
    dayId: reservation.day_id,
    dayName: dayName(dayEntry.day, dayEntry.index),
    title: reservationTitle(reservation),
    start,
    end,
  };
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function buildTripCommandCenter({
  trip,
  days,
  assignments,
  reservations,
  budgetItems,
  packingItems,
  packingBags = [],
  packingCategoryAssignees = {},
  todoItems,
  tripMembers,
  now = new Date(),
}: BuildCommandCenterInput): TripCommandCenter {
  const sortedDays = sortDays(days);
  const openTodos = todoItems.filter(isOpenTodo);
  const tripStartDelta = daysUntil(trip.start_date, now);
  const tripEndDelta = daysUntil(trip.end_date, now);
  const phase: TripCommandPhase =
    tripStartDelta == null
      ? 'unscheduled'
      : tripStartDelta > 0
        ? 'before'
        : tripEndDelta != null && tripEndDelta >= 0
          ? 'during'
          : 'after';
  const phaseCopy =
    phase === 'before'
      ? 'Pre-trip readiness'
      : phase === 'during'
        ? 'Live trip operations'
        : phase === 'after'
          ? 'Wrap-up and settlement'
          : 'Trip setup';

  const tripDateLabel =
    trip.start_date && trip.end_date
      ? `${displayDate(trip.start_date)} - ${displayDate(trip.end_date)}`
      : trip.start_date
        ? `Starts ${displayDate(trip.start_date)}`
        : 'Dates not set';
  const tripDayCount =
    trip.start_date && trip.end_date && parseDate(trip.start_date) && parseDate(trip.end_date)
      ? Math.max(1, daysBetween(parseDate(trip.start_date)!, parseDate(trip.end_date)!) + 1)
      : sortedDays.length;

  const emptyDays = sortedDays
    .map((day, index) => ({ day, index }))
    .filter(({ day }) => (assignments[String(day.id)] || []).length === 0);
  const decisionTodos = openTodos.filter((todo) => DECISION_RE.test(todoText(todo)));
  const decisionItems: CommandCenterItem[] = [
    ...decisionTodos.slice(0, 3).map((todo) => ({
      id: `todo-${todo.id}`,
      title: todo.name,
      meta: todo.due_date ? formatRelativeDate(todo.due_date, now) : 'Decision task',
      tone: dueTone(!!todo.due_date && (daysUntil(todo.due_date, now) ?? 1) <= 0),
    })),
    ...emptyDays.slice(0, Math.max(0, 3 - decisionTodos.length)).map(({ day, index }) => ({
      id: `empty-day-${day.id}`,
      title: `${dayName(day, index)} needs a plan`,
      meta: day.date ? displayDate(day.date) : 'No stops yet',
      tone: 'attention' as const,
    })),
  ];
  const decisionCount = decisionTodos.length + emptyDays.length;

  const unconfirmedReservations = reservations.filter(
    (reservation) => reservation.status !== 'confirmed' || Number(reservation.needs_review || 0) === 1
  );
  const missingConfirmation = reservations.filter(
    (reservation) =>
      ['flight', 'hotel', 'train', 'event', 'tour'].includes(reservation.type) && !reservation.confirmation_number
  );
  const bookingTodos = openTodos.filter((todo) => BOOKING_RE.test(todoText(todo)));
  const bookingItems: CommandCenterItem[] = [
    ...unconfirmedReservations.slice(0, 2).map((reservation) => ({
      id: `booking-status-${reservation.id}`,
      title: reservationTitle(reservation),
      meta: Number(reservation.needs_review || 0) === 1 ? 'Review imported details' : 'Not confirmed',
      tone: 'attention' as const,
    })),
    ...missingConfirmation
      .filter((reservation) => !unconfirmedReservations.some((item) => item.id === reservation.id))
      .slice(0, 2)
      .map((reservation) => ({
        id: `booking-code-${reservation.id}`,
        title: reservationTitle(reservation),
        meta: 'Missing confirmation code',
        tone: 'attention' as const,
      })),
    ...bookingTodos.slice(0, 2).map((todo) => ({
      id: `booking-todo-${todo.id}`,
      title: todo.name,
      meta: todo.due_date ? formatRelativeDate(todo.due_date, now) : 'Booking task',
      tone: dueTone(!!todo.due_date && (daysUntil(todo.due_date, now) ?? 1) <= 0),
    })),
  ].slice(0, 4);
  const bookingReservationIds = new Set([
    ...unconfirmedReservations.map((reservation) => reservation.id),
    ...missingConfirmation.map((reservation) => reservation.id),
  ]);
  const bookingCount = bookingReservationIds.size + bookingTodos.length;

  const tripCurrency = (trip.currency || budgetItems.find((item) => item.currency)?.currency || 'USD').toUpperCase();
  const budgetTotal = budgetItems.reduce(
    (sum, item) => sum + Number(item.total_price || 0) * Number(item.exchange_rate || 1),
    0
  );
  const incompleteSplits = budgetItems.filter((item) => {
    const total = Number(item.total_price || 0);
    if (total <= 0) return false;
    return (item.payers || []).length === 0 || (item.members || []).length === 0;
  });
  const reservationIdsWithCosts = new Set(budgetItems.map((item) => item.reservation_id).filter(Boolean));
  const bookingsWithoutCosts = reservations.filter((reservation) => !reservationIdsWithCosts.has(reservation.id));
  const budgetItemsList: CommandCenterItem[] =
    budgetItems.length === 0
      ? []
      : [
          ...incompleteSplits.slice(0, 2).map((item) => ({
            id: `budget-incomplete-${item.id}`,
            title: item.name,
            meta: (item.payers || []).length === 0 ? 'Needs payer' : 'Needs split',
            tone: 'attention' as const,
          })),
          ...bookingsWithoutCosts.slice(0, 2).map((reservation) => ({
            id: `budget-booking-${reservation.id}`,
            title: reservationTitle(reservation),
            meta: 'No linked cost yet',
            tone: 'attention' as const,
          })),
        ].slice(0, 3);

  const trackedPackingItems = packingItems.filter(isTrackablePackingItem);
  const packingResponsibility = buildPackingResponsibilitySummary({
    items: trackedPackingItems,
    bags: packingBags,
    categoryAssignees: packingCategoryAssignees,
    defaultCategory: 'Other',
  });
  const uncheckedPacking = trackedPackingItems.filter((item) => Number(item.checked) !== 1);
  const criticalPacking = trackedPackingItems.filter(isCriticalPackingItem);
  const unresolvedPacking = trackedPackingItems.filter(
    (item) => packingResponsibility.itemResponsibilities.get(item.id)?.isUnassigned
  );
  const unresolvedPackingIds = new Set(unresolvedPacking.map((item) => item.id));
  const unassignedCriticalPacking = criticalPacking.filter(
    (item) => packingResponsibility.itemResponsibilities.get(item.id)?.isUnassigned
  );
  const blockerPackingIds = new Set([
    ...uncheckedPacking.filter(isCriticalPackingItem).map((item) => item.id),
    ...uncheckedPacking.filter((item) => unresolvedPackingIds.has(item.id)).map((item) => item.id),
    ...unassignedCriticalPacking.map((item) => item.id),
  ]);
  const hasUrgentPackingBlocker = criticalPacking.some(
    (item) => Number(item.checked) !== 1 || packingResponsibility.itemResponsibilities.get(item.id)?.isUnassigned
  );
  const packingProgress =
    trackedPackingItems.length === 0
      ? 0
      : clampProgress(((trackedPackingItems.length - uncheckedPacking.length) / trackedPackingItems.length) * 100);
  const packingItemsList: CommandCenterItem[] = [
    ...packingItems
      .filter((item) => blockerPackingIds.has(item.id))
      .map((item) => {
        const responsibility = packingResponsibility.itemResponsibilities.get(item.id);
        const critical = isCriticalPackingItem(item);
        const open = Number(item.checked) !== 1;
        const ownerLabel = packingResponsibilityLabel(responsibility);
        const meta =
          critical && responsibility?.isUnassigned
            ? open
              ? 'Critical item unpacked and unassigned'
              : 'Critical item needs owner'
            : critical
              ? `Critical item open - ${ownerLabel}`
              : 'Needs owner';
        return {
          id: `packing-blocker-${item.id}`,
          title: item.name,
          meta,
          tone: critical ? ('urgent' as const) : ('attention' as const),
        };
      }),
    ...uncheckedPacking
      .filter((item) => !blockerPackingIds.has(item.id))
      .map((item) => {
        const responsibility = packingResponsibility.itemResponsibilities.get(item.id);
        return {
          id: `packing-open-${item.id}`,
          title: item.name,
          meta: `${packingResponsibilityLabel(responsibility)} - ${item.category || 'Still open'}`,
          tone: 'good' as const,
        };
      }),
  ].slice(0, 4);

  const dayById = new Map(sortedDays.map((day, index) => [day.id, { day, index }]));
  const intervals = [
    ...sortedDays.flatMap((day, dayIndex) =>
      (assignments[String(day.id)] || [])
        .map((assignment) => assignmentInterval(assignment, day, dayIndex))
        .filter(Boolean)
    ),
    ...reservations.map((reservation) => reservationInterval(reservation, dayById)).filter(Boolean),
  ] as NonNullable<ReturnType<typeof assignmentInterval>>[];
  const conflictItems: CommandCenterItem[] = [];
  const byDay = new Map<number, typeof intervals>();
  for (const interval of intervals) {
    const dayIntervals = byDay.get(interval.dayId) || [];
    dayIntervals.push(interval);
    byDay.set(interval.dayId, dayIntervals);
  }
  for (const dayIntervals of byDay.values()) {
    const ordered = [...dayIntervals].sort((a, b) => a.start - b.start);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (current.start < previous.end) {
        conflictItems.push({
          id: `overlap-${previous.id}-${current.id}`,
          title: `${previous.title} overlaps ${current.title}`,
          meta: `${previous.dayName}, ${timeLabel(current.start)}-${timeLabel(Math.min(previous.end, current.end))}`,
          tone: 'urgent',
        });
      }
    }
  }
  for (const reservation of reservations) {
    if (reservation.day_id == null) continue;
    const reservationDate = datePart(reservation.reservation_time);
    const day = dayById.get(reservation.day_id)?.day;
    if (reservationDate && day?.date && reservationDate !== day.date) {
      conflictItems.push({
        id: `date-mismatch-${reservation.id}`,
        title: reservationTitle(reservation),
        meta: `Booking date differs from ${dayName(day, 0)}`,
        tone: 'attention',
      });
    }
  }

  const timelineEntries: TimelineEntry[] = [
    ...openTodos
      .filter((todo) => !!todo.due_date)
      .map((todo) => ({
        id: `todo-${todo.id}`,
        title: todo.name,
        date: todo.due_date!,
        source: 'todo' as const,
        tone: (daysUntil(todo.due_date, now) ?? 1) < 0 ? ('urgent' as const) : ('attention' as const),
      })),
    ...reservations
      .filter((reservation) => !!reservation.reservation_time)
      .map((reservation) => ({
        id: `reservation-${reservation.id}`,
        title: reservationTitle(reservation),
        date: datePart(reservation.reservation_time)!,
        source: 'booking' as const,
        tone: reservation.status !== 'confirmed' ? ('attention' as const) : ('good' as const),
      })),
    ...(trip.start_date
      ? [
          {
            id: 'trip-start',
            title: `${trip.title} starts`,
            date: trip.start_date,
            source: 'trip' as const,
            tone: phase === 'before' ? ('attention' as const) : ('good' as const),
          },
        ]
      : []),
    ...(phase === 'after' && budgetItems.length > 0
      ? [
          {
            id: 'settle-costs',
            title: 'Settle shared costs',
            date: new Date(now.getTime() + DAY_MS).toISOString().slice(0, 10),
            source: 'budget' as const,
            tone: 'attention' as const,
          },
        ]
      : []),
  ]
    .filter((entry) => {
      const delta = daysUntil(entry.date, now);
      return delta != null && delta >= -7 && delta <= 30;
    })
    .sort((a, b) => (daysUntil(a.date, now) ?? 0) - (daysUntil(b.date, now) ?? 0));
  const deadlineItems = timelineEntries.slice(0, 4).map((entry) => ({
    id: entry.id,
    title: entry.title,
    meta: `${formatRelativeDate(entry.date, now)} - ${entry.source}`,
    tone: entry.tone,
  }));

  const modules: CommandCenterModule[] = [
    {
      id: 'decisions',
      title: 'Pending decisions',
      summary:
        decisionCount > 0
          ? `${decisionCount} choice${decisionCount === 1 ? '' : 's'} need organizer input`
          : 'No open decisions',
      status: decisionCount > 0 ? 'attention' : 'empty',
      statusLabel: statusLabel(decisionCount > 0 ? 'attention' : 'empty'),
      count: decisionCount,
      actionLabel: decisionCount > 0 ? 'Open decisions' : 'Add decision task',
      emptyTitle: 'No decisions queued',
      emptyText: 'Add a decision task or start filling empty days so the group knows what to choose next.',
      items: decisionItems,
    },
    {
      id: 'budget',
      title: 'Budget health',
      summary:
        budgetItems.length === 0
          ? 'No costs captured yet'
          : incompleteSplits.length > 0
            ? `${incompleteSplits.length} cost${incompleteSplits.length === 1 ? '' : 's'} need payer or split details`
            : bookingsWithoutCosts.length > 0
              ? `${bookingsWithoutCosts.length} booking${bookingsWithoutCosts.length === 1 ? '' : 's'} without linked costs`
              : 'Costs are recorded',
      status:
        budgetItems.length === 0
          ? 'empty'
          : incompleteSplits.length > 0 || bookingsWithoutCosts.length > 0
            ? 'attention'
            : 'good',
      statusLabel:
        budgetItems.length === 0
          ? statusLabel('empty')
          : statusLabel(incompleteSplits.length > 0 || bookingsWithoutCosts.length > 0 ? 'attention' : 'good'),
      count: incompleteSplits.length + bookingsWithoutCosts.length,
      actionLabel: budgetItems.length === 0 ? 'Start budget' : 'Open costs',
      emptyTitle: 'Budget is blank',
      emptyText: 'Add expected bookings or shared expenses so the group can see spend before checkout day.',
      items: budgetItemsList,
      metric: budgetItems.length > 0 ? formatMoney(budgetTotal, tripCurrency) : undefined,
      progress:
        budgetItems.length > 0
          ? clampProgress(((budgetItems.length - incompleteSplits.length) / budgetItems.length) * 100)
          : 0,
    },
    {
      id: 'bookings',
      title: 'Booking tasks',
      summary:
        bookingCount > 0
          ? `${bookingCount} booking follow-up${bookingCount === 1 ? '' : 's'}`
          : 'Bookings look settled',
      status: bookingCount > 0 ? 'attention' : reservations.length > 0 ? 'good' : 'empty',
      statusLabel: statusLabel(bookingCount > 0 ? 'attention' : reservations.length > 0 ? 'good' : 'empty'),
      count: bookingCount,
      actionLabel: reservations.length === 0 ? 'Add booking intent' : 'Review bookings',
      emptyTitle: 'No booking intents yet',
      emptyText: 'Add flights, stays, events, or booking tasks so confirmations have a home.',
      items: bookingItems,
    },
    {
      id: 'packing',
      title: 'Packing assignments',
      summary:
        trackedPackingItems.length === 0
          ? 'No packing list yet'
          : blockerPackingIds.size > 0
            ? `${blockerPackingIds.size} packing blocker${blockerPackingIds.size === 1 ? '' : 's'}`
            : uncheckedPacking.length > 0
              ? `${uncheckedPacking.length} item${uncheckedPacking.length === 1 ? '' : 's'} still open`
              : 'Everything is checked off',
      status:
        trackedPackingItems.length === 0
          ? 'empty'
          : hasUrgentPackingBlocker
            ? 'urgent'
            : uncheckedPacking.length > 0
              ? 'attention'
              : 'good',
      statusLabel: statusLabel(
        trackedPackingItems.length === 0
          ? 'empty'
          : hasUrgentPackingBlocker
            ? 'urgent'
            : uncheckedPacking.length > 0
              ? 'attention'
              : 'good'
      ),
      count: blockerPackingIds.size || uncheckedPacking.length,
      actionLabel: trackedPackingItems.length === 0 ? 'Create packing list' : 'Open packing',
      emptyTitle: 'Packing is unassigned',
      emptyText: 'Create a packing list or assign bags before the group starts asking who has what.',
      items: packingItemsList,
      metric: trackedPackingItems.length > 0 ? `${packingProgress}% packed` : undefined,
      progress: packingProgress,
    },
    {
      id: 'plan',
      title: 'Itinerary conflicts',
      summary:
        conflictItems.length > 0
          ? `${conflictItems.length} schedule conflict${conflictItems.length === 1 ? '' : 's'}`
          : 'No conflicts detected',
      status: conflictItems.length > 0 ? 'urgent' : 'good',
      statusLabel: statusLabel(conflictItems.length > 0 ? 'urgent' : 'good'),
      count: conflictItems.length,
      actionLabel: conflictItems.length > 0 ? 'Resolve in plan' : 'Review plan',
      emptyTitle: 'No conflicts detected',
      emptyText: 'Timed stops and bookings do not overlap right now.',
      items: conflictItems.slice(0, 4),
    },
    {
      id: 'deadlines',
      title: 'Upcoming deadlines',
      summary:
        deadlineItems.length > 0
          ? `${deadlineItems.length} date${deadlineItems.length === 1 ? '' : 's'} coming up`
          : 'No dated follow-ups',
      status: deadlineItems.some((item) => item.tone === 'urgent')
        ? 'urgent'
        : deadlineItems.length > 0
          ? 'attention'
          : 'empty',
      statusLabel: statusLabel(
        deadlineItems.some((item) => item.tone === 'urgent')
          ? 'urgent'
          : deadlineItems.length > 0
            ? 'attention'
            : 'empty'
      ),
      count: deadlineItems.length,
      actionLabel: deadlineItems.length > 0 ? 'Open deadlines' : 'Add due dates',
      emptyTitle: 'No deadlines on deck',
      emptyText: 'Add due dates to tasks or booking intents so the command center can keep the countdown visible.',
      items: deadlineItems,
    },
  ];

  const nextDeadlineLabel =
    deadlineItems[0]?.meta.split(' - ')[0] ||
    (phase === 'before' && trip.start_date ? formatRelativeDate(trip.start_date, now) : 'No deadlines');

  return {
    title: `${trip.title} command center`,
    subtitle: phaseCopy,
    phase,
    tripDateLabel,
    tripLengthLabel: tripDayCount ? `${tripDayCount} day${tripDayCount === 1 ? '' : 's'}` : 'No days yet',
    travelerLabel: `${Math.max(1, tripMembers.length || 1)} traveler${Math.max(1, tripMembers.length || 1) === 1 ? '' : 's'}`,
    nextDeadlineLabel,
    modules,
  };
}

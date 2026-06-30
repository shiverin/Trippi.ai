import { asyncDb, canAccessTripAsync } from '../../db/asyncDatabase';
import { listBudgetItems } from '../../services/budgetService';
import { listDays } from '../../services/dayService';
import { listFilesAsync } from '../../services/fileService';
import { listBags, getCategoryAssignees, listItems as listPackingItems } from '../../services/packingService';
import { listReservations } from '../../services/reservationService';
import { listItems as listTodoItems } from '../../services/todoService';
import type { BudgetItem, PackingItem, Reservation, TripFile } from '../../types';
import { Injectable } from '@nestjs/common';
import type {
  TripOverview,
  TripOverviewBoard,
  TripOverviewItem,
  TripOverviewReadinessItem,
  TripOverviewStatus,
} from '@trippi/shared';

const DAY_MS = 86_400_000;
const CRITICAL_PACKING_RE =
  /\b(passports?|visas?|boarding pass(?:es)?|tickets?|identification|identity|driver'?s license|ids?|wallets?|cash|cards?|medic(?:ation|ine|al)|prescriptions?|documents?|insurance|keys?)\b/i;
const CONFIRMATION_REQUIRED_TYPES = new Set(['flight', 'hotel', 'train', 'event', 'tour']);
const DOCUMENT_REQUIRED_BOOKING_TYPES = new Set([
  'flight',
  'train',
  'bus',
  'ferry',
  'cruise',
  'hotel',
  'event',
  'tour',
  'car',
  'car-rental',
  'transport_other',
]);
const TERMINAL_BOOKING_INTENT_STATUSES = new Set(['archived', 'booked']);
const CANCELLED_RESERVATION_STATUSES = new Set(['cancelled', 'canceled']);

type TripOverviewPhase = TripOverview['summary']['phase'];

interface TripRow {
  id: number;
  title: string;
  start_date: string | null;
  end_date: string | null;
  currency: string;
}

interface TodoRow {
  id: number;
  trip_id: number;
  name: string;
  checked: number;
  category: string | null;
  due_date: string | null;
  description: string | null;
}

interface DayWithAssignments {
  id: number;
  day_number?: number | null;
  date?: string | null;
  title?: string | null;
  assignments?: AssignmentForOverview[];
}

interface AssignmentForOverview {
  id: number;
  day_id: number;
  assignment_time?: string | null;
  assignment_end_time?: string | null;
  place?: {
    name?: string | null;
    place_time?: string | null;
    end_time?: string | null;
    duration_minutes?: number | null;
  } | null;
}

interface DecisionRow {
  id: number;
  title: string;
  deadline: string | null;
  state: string;
  final_option_id: number | null;
  created_at: string;
  updated_at: string;
}

interface DecisionResponseCount {
  decision_id: number;
  count: number;
}

interface BookingIntentRow {
  id: number;
  type: string;
  origin: string | null;
  destination: string | null;
  status: string;
  watch_status: string | null;
  checkout_url: string | null;
  confirmation_number: string | null;
  updated_at: string;
}

interface TimelineEntry {
  id: string;
  source: TripOverviewItem['source'];
  source_id?: number | null;
  title: string;
  date: string;
  status?: TripOverviewStatus;
}

interface IntervalEntry {
  id: string;
  dayId: number;
  dayName: string;
  title: string;
  start: number;
  end: number;
}

interface ResponsibleMember {
  user_id: number;
  username: string;
  avatar?: string | null;
}

interface PackingBagForOverview {
  id: number;
  user_id?: number | null;
  assigned_username?: string | null;
  members?: ResponsibleMember[];
}

type PackingItemForOverview = PackingItem & {
  bag_id?: number | null;
};

type TripFileForOverview = TripFile & {
  linked_reservation_ids?: (number | null)[];
};

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

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeCategory(value: string | null | undefined): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, ' ');
}

function isOpenTodo(todo: TodoRow): boolean {
  return Number(todo.checked) !== 1;
}

function todoCategoryIs(todo: TodoRow, names: string[]): boolean {
  const normalized = normalizeCategory(todo.category);
  return names.includes(normalized);
}

function isCancelledReservation(reservation: Reservation): boolean {
  return CANCELLED_RESERVATION_STATUSES.has((reservation.status || '').trim().toLowerCase());
}

function reservationTitle(reservation: Reservation): string {
  return reservation.title || `Booking ${reservation.id}`;
}

function bookingIntentTitle(intent: BookingIntentRow): string {
  const type = intent.type.replace(/[_-]+/g, ' ');
  const route = [intent.origin, intent.destination].filter(Boolean).join(' to ');
  return route ? `${type} for ${route}` : `${type} booking intent`;
}

function bookingIntentMeta(intent: BookingIntentRow): string {
  const status = intent.status.replace(/[_-]+/g, ' ');
  if (intent.status === 'pending_checkout' && intent.checkout_url) return 'Checkout handoff ready';
  if (intent.watch_status && intent.watch_status !== 'idle') return `${status} - ${intent.watch_status}`;
  return status;
}

function isActiveFile(file: TripFile): boolean {
  return !file.deleted_at;
}

function linkedReservationIds(file: TripFileForOverview): number[] {
  const ids = [file.reservation_id, ...(file.linked_reservation_ids || [])];
  return ids.flatMap((id) => {
    if (id == null) return [];
    const numeric = Number(id);
    return Number.isFinite(numeric) ? [numeric] : [];
  });
}

function isTrackablePackingItem(item: PackingItemForOverview): boolean {
  return item.name.trim() !== '...';
}

function isCriticalPackingItem(item: PackingItemForOverview): boolean {
  return isTrackablePackingItem(item) && CRITICAL_PACKING_RE.test([item.name, item.category].filter(Boolean).join(' '));
}

function bagResponsibleMembers(bag: PackingBagForOverview | undefined): ResponsibleMember[] {
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

function uniqueResponsibleMembers(members: ResponsibleMember[]): ResponsibleMember[] {
  const byId = new Map<number, ResponsibleMember>();
  for (const member of members) {
    if (!Number.isFinite(member.user_id)) continue;
    if (!byId.has(member.user_id)) {
      byId.set(member.user_id, {
        user_id: member.user_id,
        username: member.username || `Member ${member.user_id}`,
        avatar: member.avatar ?? null,
      });
    }
  }
  return Array.from(byId.values());
}

function responsibilityLabel(members: ResponsibleMember[]): string {
  if (members.length === 0) return 'Unassigned';
  if (members.length === 1) return members[0].username;
  if (members.length === 2) return `${members[0].username} + ${members[1].username}`;
  return `Shared ${members.length}`;
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

function dayName(day: DayWithAssignments, fallbackIndex: number): string {
  const ordinal = day.day_number ?? fallbackIndex + 1;
  return day.title || `Day ${ordinal}`;
}

function assignmentInterval(assignment: AssignmentForOverview, day: DayWithAssignments, dayIndex: number) {
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

function reservationInterval(
  reservation: Reservation,
  dayById: Map<number, { day: DayWithAssignments; index: number }>,
) {
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

function board(input: Omit<TripOverviewBoard, 'items'> & { items?: TripOverviewItem[] }): TripOverviewBoard {
  return { ...input, items: input.items ?? [] };
}

@Injectable()
export class TripsOverviewService {
  async getOverview(tripId: string, userId: number, now = new Date()): Promise<TripOverview | null> {
    const access = await canAccessTripAsync(tripId, userId);
    if (!access) return null;

    const [
      trip,
      daysResult,
      reservations,
      budgetItems,
      packingItems,
      packingBags,
      packingCategoryAssignees,
      todoItems,
      files,
      decisions,
      decisionResponseCounts,
      bookingIntents,
      tripMemberCount,
    ] = await Promise.all([
      this.getTrip(tripId),
      listDays(tripId),
      listReservations(tripId) as Promise<Reservation[]>,
      listBudgetItems(tripId) as Promise<BudgetItem[]>,
      listPackingItems(tripId) as Promise<PackingItemForOverview[]>,
      listBags(tripId) as Promise<PackingBagForOverview[]>,
      getCategoryAssignees(tripId) as Promise<Record<string, ResponsibleMember[] | undefined>>,
      listTodoItems(tripId) as Promise<TodoRow[]>,
      listFilesAsync(tripId, false) as Promise<TripFileForOverview[]>,
      this.listDecisions(tripId),
      this.listDecisionResponseCounts(tripId),
      this.listBookingIntents(tripId),
      this.countTripMembers(tripId),
    ]);

    if (!trip) return null;

    const days = daysResult.days as DayWithAssignments[];
    const openTodos = todoItems.filter(isOpenTodo);
    const decisionTodos = openTodos.filter((todo) => todoCategoryIs(todo, ['decision', 'decisions']));
    const bookingTodos = openTodos.filter((todo) => todoCategoryIs(todo, ['booking', 'bookings']));
    const documentTodos = openTodos.filter((todo) => todoCategoryIs(todo, ['document', 'documents', 'docs']));
    const responseCountByDecision = new Map(decisionResponseCounts.map((row) => [row.decision_id, row.count]));
    const actionableDecisions = decisions.filter(
      (decision) => decision.state === 'open' || decision.state === 'closed',
    );

    const decisionItems: TripOverviewItem[] = [
      ...actionableDecisions.slice(0, 3).map((decision) => ({
        id: `decision-${decision.id}`,
        source: 'decision' as const,
        source_id: decision.id,
        title: decision.title,
        meta:
          decision.state === 'closed'
            ? 'Closed, awaiting final selection'
            : decision.deadline
              ? `${formatRelativeDate(decision.deadline, now)} - ${responseCountByDecision.get(decision.id) ?? 0} responses`
              : `${responseCountByDecision.get(decision.id) ?? 0} responses`,
        status: decision.state === 'closed' ? ('urgent' as const) : ('attention' as const),
      })),
      ...decisionTodos.slice(0, Math.max(0, 3 - actionableDecisions.length)).map((todo) => ({
        id: `todo-${todo.id}`,
        source: 'todo' as const,
        source_id: todo.id,
        title: todo.name,
        meta: todo.due_date ? formatRelativeDate(todo.due_date, now) : 'Decision task',
        status: 'attention' as const,
      })),
    ];
    const decisionCount = actionableDecisions.length + decisionTodos.length;

    const bookingReservationIds = new Set<number>();
    const bookingReservationItems: TripOverviewItem[] = [];
    for (const reservation of reservations) {
      if (isCancelledReservation(reservation)) continue;
      const status = (reservation.status || '').trim().toLowerCase();
      const needsReview = Number(reservation.needs_review || 0) === 1;
      const notConfirmed = status !== 'confirmed';
      const missingConfirmation =
        CONFIRMATION_REQUIRED_TYPES.has(reservation.type) && !reservation.confirmation_number?.trim();
      if (!needsReview && !notConfirmed && !missingConfirmation) continue;
      if (bookingReservationIds.has(reservation.id)) continue;
      bookingReservationIds.add(reservation.id);
      bookingReservationItems.push({
        id: `reservation-${reservation.id}`,
        source: 'reservation',
        source_id: reservation.id,
        title: reservationTitle(reservation),
        meta: needsReview ? 'Review imported details' : missingConfirmation ? 'Missing confirmation code' : status,
        status: needsReview || missingConfirmation ? 'attention' : 'urgent',
      });
    }

    const activeBookingIntents = bookingIntents.filter(
      (intent) => !TERMINAL_BOOKING_INTENT_STATUSES.has(intent.status),
    );
    const bookingIntentItems = activeBookingIntents.slice(0, 3).map((intent) => ({
      id: `booking-intent-${intent.id}`,
      source: 'booking_intent' as const,
      source_id: intent.id,
      title: bookingIntentTitle(intent),
      meta: bookingIntentMeta(intent),
      status: 'attention' as const,
    }));
    const bookingItems = [
      ...bookingReservationItems,
      ...bookingIntentItems,
      ...bookingTodos.map((todo) => ({
        id: `booking-todo-${todo.id}`,
        source: 'todo' as const,
        source_id: todo.id,
        title: todo.name,
        meta: todo.due_date ? formatRelativeDate(todo.due_date, now) : 'Booking task',
        status: 'attention' as const,
      })),
    ].slice(0, 4);
    const bookingCount = bookingReservationIds.size + activeBookingIntents.length + bookingTodos.length;

    const tripCurrency = (trip.currency || budgetItems.find((item) => item.currency)?.currency || 'USD').toUpperCase();
    const budgetTotal = budgetItems.reduce(
      (sum, item) => sum + Number(item.total_price || 0) * Number(item.exchange_rate || 1),
      0,
    );
    const incompleteSplits = budgetItems.filter((item) => {
      const total = Number(item.total_price || 0);
      if (total <= 0) return false;
      return (item.payers || []).length === 0 || (item.members || []).length === 0;
    });
    const unpaidBudgetShares = budgetItems.flatMap((item) =>
      (item.members || []).filter((member) => Number(member.paid) !== 1).map((member) => ({ item, member })),
    );
    const reservationIdsWithCosts = new Set(budgetItems.map((item) => item.reservation_id).filter(Boolean));
    const bookingsWithoutCosts = reservations.filter(
      (reservation) => !isCancelledReservation(reservation) && !reservationIdsWithCosts.has(reservation.id),
    );
    const budgetItemsList: TripOverviewItem[] = [
      ...unpaidBudgetShares.slice(0, 2).map(({ item, member }) => ({
        id: `budget-unpaid-${item.id}-${member.user_id}`,
        source: 'budget' as const,
        source_id: item.id,
        title: item.name,
        meta: `${member.username} unpaid`,
        status: 'attention' as const,
      })),
      ...incompleteSplits.slice(0, 2).map((item) => ({
        id: `budget-incomplete-${item.id}`,
        source: 'budget' as const,
        source_id: item.id,
        title: item.name,
        meta: (item.payers || []).length === 0 ? 'Needs payer' : 'Needs split',
        status: 'attention' as const,
      })),
      ...bookingsWithoutCosts.slice(0, 2).map((reservation) => ({
        id: `budget-booking-${reservation.id}`,
        source: 'reservation' as const,
        source_id: reservation.id,
        title: reservationTitle(reservation),
        meta: 'No linked cost yet',
        status: 'attention' as const,
      })),
    ].slice(0, 4);
    const budgetCount = unpaidBudgetShares.length + incompleteSplits.length + bookingsWithoutCosts.length;

    const packingSummary = this.buildPackingOverview(packingItems, packingBags, packingCategoryAssignees);

    const conflictItems = this.buildConflictItems(days, reservations);
    const deadlineItems = this.buildDeadlineItems({
      trip,
      openTodos,
      reservations,
      decisions: actionableDecisions,
      now,
    });

    const activeFiles = files.filter(isActiveFile);
    const reservationIdsWithFiles = new Set(activeFiles.flatMap(linkedReservationIds));
    const reservationsMissingDocuments = reservations.filter(
      (reservation) =>
        !isCancelledReservation(reservation) &&
        DOCUMENT_REQUIRED_BOOKING_TYPES.has(reservation.type) &&
        !reservationIdsWithFiles.has(reservation.id),
    );
    const documentItems: TripOverviewItem[] = [
      ...documentTodos.slice(0, 2).map((todo) => ({
        id: `document-todo-${todo.id}`,
        source: 'todo' as const,
        source_id: todo.id,
        title: todo.name,
        meta: todo.due_date ? formatRelativeDate(todo.due_date, now) : 'Document task',
        status: 'attention' as const,
      })),
      ...reservationsMissingDocuments.slice(0, 2).map((reservation) => ({
        id: `document-reservation-${reservation.id}`,
        source: 'reservation' as const,
        source_id: reservation.id,
        title: reservationTitle(reservation),
        meta: 'No linked file yet',
        status: 'attention' as const,
      })),
    ];
    const documentCount = documentTodos.length + reservationsMissingDocuments.length;

    const boards: TripOverviewBoard[] = [
      board({
        id: 'decisions',
        title: 'Pending decisions',
        summary:
          decisionCount > 0
            ? `${decisionCount} explicit decision follow-up${decisionCount === 1 ? '' : 's'}`
            : 'No open decisions',
        status: decisionCount > 0 ? 'attention' : 'empty',
        count: decisionCount,
        action: 'decisions',
        action_label: decisionCount > 0 ? 'Open decisions' : 'Add decision',
        empty_title: 'No decisions queued',
        empty_text: 'Open a decision or add a decision-category task when the group needs to choose.',
        items: decisionItems,
      }),
      board({
        id: 'budget',
        title: 'Budget health',
        summary:
          budgetCount > 0
            ? `${budgetCount} cost follow-up${budgetCount === 1 ? '' : 's'}`
            : budgetItems.length > 0
              ? 'Costs are recorded'
              : 'No costs captured yet',
        status: budgetCount > 0 ? 'attention' : budgetItems.length > 0 ? 'good' : 'empty',
        count: budgetCount,
        action: 'budget',
        action_label: budgetItems.length === 0 ? 'Start budget' : 'Open costs',
        empty_title: 'Budget is blank',
        empty_text: 'Add shared expenses or booking-linked costs to track group spend.',
        items: budgetItemsList,
        metric: budgetItems.length > 0 ? formatMoney(budgetTotal, tripCurrency) : undefined,
        progress:
          budgetItems.length > 0
            ? clampProgress(((budgetItems.length - incompleteSplits.length) / budgetItems.length) * 100)
            : 0,
      }),
      board({
        id: 'bookings',
        title: 'Booking tasks',
        summary:
          bookingCount > 0
            ? `${bookingCount} booking follow-up${bookingCount === 1 ? '' : 's'}`
            : 'Bookings look settled',
        status:
          bookingCount > 0 ? 'attention' : reservations.length > 0 || bookingIntents.length > 0 ? 'good' : 'empty',
        count: bookingCount,
        action: 'bookings',
        action_label: reservations.length === 0 && bookingIntents.length === 0 ? 'Add booking' : 'Review bookings',
        empty_title: 'No bookings yet',
        empty_text: 'Add reservations or booking intents so confirmations have a home.',
        items: bookingItems,
      }),
      board({
        id: 'packing',
        title: 'Packing assignments',
        summary: packingSummary.summary,
        status: packingSummary.status,
        count: packingSummary.count,
        action: 'packing',
        action_label: packingItems.length === 0 ? 'Create packing list' : 'Open packing',
        empty_title: 'Packing is empty',
        empty_text: 'Create packing items or assign bags before the group starts packing.',
        items: packingSummary.items,
        metric: packingSummary.metric,
        progress: packingSummary.progress,
      }),
      board({
        id: 'plan',
        title: 'Itinerary conflicts',
        summary:
          conflictItems.length > 0
            ? `${conflictItems.length} schedule conflict${conflictItems.length === 1 ? '' : 's'}`
            : 'No conflicts detected',
        status: conflictItems.length > 0 ? 'urgent' : 'good',
        count: conflictItems.length,
        action: 'plan',
        action_label: conflictItems.length > 0 ? 'Resolve in plan' : 'Review plan',
        empty_title: 'No conflicts detected',
        empty_text: 'Timed stops and bookings do not overlap right now.',
        items: conflictItems,
      }),
      board({
        id: 'deadlines',
        title: 'Upcoming deadlines',
        summary:
          deadlineItems.length > 0
            ? `${deadlineItems.length} date${deadlineItems.length === 1 ? '' : 's'} coming up`
            : 'No dated follow-ups',
        status: deadlineItems.some((item) => item.status === 'urgent')
          ? 'urgent'
          : deadlineItems.length > 0
            ? 'attention'
            : 'empty',
        count: deadlineItems.length,
        action: 'deadlines',
        action_label: deadlineItems.length > 0 ? 'Open deadlines' : 'Add due dates',
        empty_title: 'No deadlines on deck',
        empty_text: 'Add due dates to tasks, decisions, or bookings to make deadlines visible here.',
        items: deadlineItems,
      }),
      board({
        id: 'files',
        title: 'Document follow-ups',
        summary:
          documentCount > 0
            ? `${documentCount} document follow-up${documentCount === 1 ? '' : 's'}`
            : 'No document follow-ups',
        status: documentCount > 0 ? 'attention' : 'good',
        count: documentCount,
        action: 'files',
        action_label: documentCount > 0 ? 'Open files' : 'Review files',
        empty_title: 'No document follow-ups',
        empty_text: 'Document status uses document-category tasks and reservation-linked files.',
        items: documentItems,
      }),
    ];

    const readinessItems = this.buildReadiness({
      decisionCount,
      unpaidBudgetShares: unpaidBudgetShares.length,
      budgetItems: budgetItems.length,
      bookingCount,
      bookingSources: reservations.length + bookingIntents.length,
      packingItems: packingItems.length,
      uncheckedPacking: packingSummary.uncheckedCount,
      documentCount,
    });
    const completedCount = readinessItems.filter((item) => item.status === 'good').length;
    const readinessStatus: TripOverviewStatus = readinessItems.some((item) => item.status === 'urgent')
      ? 'urgent'
      : readinessItems.some((item) => item.status === 'attention' || item.status === 'empty')
        ? 'attention'
        : 'good';

    const phase = this.tripPhase(trip, now);
    const flaggedCount = boards.filter((item) => item.status === 'attention' || item.status === 'urgent').length;
    const clearCount = boards.filter((item) => item.status === 'good').length;

    return {
      generated_at: now.toISOString(),
      trip: {
        id: trip.id,
        title: trip.title,
        start_date: trip.start_date,
        end_date: trip.end_date,
        currency: trip.currency,
      },
      summary: {
        phase,
        subtitle: this.phaseCopy(phase),
        trip_date_label: this.tripDateLabel(trip),
        trip_length_label: this.tripLengthLabel(trip, days.length),
        traveler_label: `${Math.max(1, tripMemberCount)} traveler${Math.max(1, tripMemberCount) === 1 ? '' : 's'}`,
        next_deadline_label:
          deadlineItems[0]?.meta.split(' - ')[0] ||
          (phase === 'before' && trip.start_date ? formatRelativeDate(trip.start_date, now) : 'No deadlines'),
        flagged_count: flaggedCount,
        clear_count: clearCount,
      },
      readiness: {
        title: 'Trip readiness checklist',
        summary: `${completedCount}/${readinessItems.length} checks ready`,
        status: readinessStatus,
        completed_count: completedCount,
        total_count: readinessItems.length,
        caveat: 'Document follow-ups use explicit document tasks and files linked to reservations.',
        items: readinessItems,
      },
      boards,
    };
  }

  private getTrip(tripId: string): Promise<TripRow | undefined> {
    return asyncDb
      .prepare('SELECT id, title, start_date, end_date, currency FROM trips WHERE id = ?')
      .get<TripRow>(tripId);
  }

  private listDecisions(tripId: string): Promise<DecisionRow[]> {
    return asyncDb
      .prepare(
        `
        SELECT id, title, deadline, state, final_option_id, created_at, updated_at
        FROM group_decisions
        WHERE trip_id = ? AND state <> 'cancelled'
        ORDER BY created_at DESC, id DESC
      `,
      )
      .all<DecisionRow>(tripId);
  }

  private listDecisionResponseCounts(tripId: string): Promise<DecisionResponseCount[]> {
    return asyncDb
      .prepare(
        `
        SELECT d.id AS decision_id, COUNT(DISTINCT r.user_id) AS count
        FROM group_decisions d
        LEFT JOIN group_decision_responses r ON r.decision_id = d.id
        WHERE d.trip_id = ?
        GROUP BY d.id
      `,
      )
      .all<DecisionResponseCount>(tripId);
  }

  private listBookingIntents(tripId: string): Promise<BookingIntentRow[]> {
    return asyncDb
      .prepare(
        `
        SELECT id, type, origin, destination, status, watch_status, checkout_url, confirmation_number, updated_at
        FROM booking_intents
        WHERE trip_id = ?
        ORDER BY updated_at DESC, id DESC
      `,
      )
      .all<BookingIntentRow>(tripId);
  }

  private async countTripMembers(tripId: string): Promise<number> {
    const row = await asyncDb
      .prepare('SELECT 1 + COUNT(*) AS count FROM trip_members WHERE trip_id = ?')
      .get<{ count: number }>(tripId);
    return row?.count ?? 1;
  }

  private tripPhase(trip: TripRow, now: Date): TripOverviewPhase {
    const tripStartDelta = daysUntil(trip.start_date, now);
    const tripEndDelta = daysUntil(trip.end_date, now);
    if (tripStartDelta == null) return 'unscheduled';
    if (tripStartDelta > 0) return 'before';
    if (tripEndDelta != null && tripEndDelta >= 0) return 'during';
    return 'after';
  }

  private phaseCopy(phase: TripOverviewPhase): string {
    if (phase === 'before') return 'Pre-trip readiness';
    if (phase === 'during') return 'Live trip operations';
    if (phase === 'after') return 'Wrap-up and settlement';
    return 'Trip setup';
  }

  private tripDateLabel(trip: TripRow): string {
    if (trip.start_date && trip.end_date) return `${displayDate(trip.start_date)} - ${displayDate(trip.end_date)}`;
    if (trip.start_date) return `Starts ${displayDate(trip.start_date)}`;
    return 'Dates not set';
  }

  private tripLengthLabel(trip: TripRow, fallbackDayCount: number): string {
    const start = parseDate(trip.start_date);
    const end = parseDate(trip.end_date);
    const count = start && end ? Math.max(1, daysBetween(start, end) + 1) : fallbackDayCount;
    return count ? `${count} day${count === 1 ? '' : 's'}` : 'No days yet';
  }

  private buildPackingOverview(
    packingItems: PackingItemForOverview[],
    packingBags: PackingBagForOverview[],
    categoryAssignees: Record<string, ResponsibleMember[] | undefined>,
  ): {
    summary: string;
    status: TripOverviewStatus;
    count: number;
    uncheckedCount: number;
    items: TripOverviewItem[];
    metric?: string;
    progress: number;
  } {
    const tracked = packingItems.filter(isTrackablePackingItem);
    const bagById = new Map(packingBags.map((bag) => [bag.id, bag]));
    const unchecked = tracked.filter((item) => Number(item.checked) !== 1);
    const blockerIds = new Set<number>();
    const itemMembers = new Map<number, ResponsibleMember[]>();

    for (const item of tracked) {
      const bag = item.bag_id != null ? bagById.get(item.bag_id) : undefined;
      const members = uniqueResponsibleMembers([
        ...(categoryAssignees[item.category || 'Other'] || []),
        ...bagResponsibleMembers(bag),
      ]);
      itemMembers.set(item.id, members);
      const critical = isCriticalPackingItem(item);
      const uncheckedItem = Number(item.checked) !== 1;
      if (
        (critical && uncheckedItem) ||
        (uncheckedItem && members.length === 0) ||
        (critical && members.length === 0)
      ) {
        blockerIds.add(item.id);
      }
    }

    const hasUrgent = tracked.some((item) => {
      const critical = isCriticalPackingItem(item);
      const members = itemMembers.get(item.id) || [];
      return critical && (Number(item.checked) !== 1 || members.length === 0);
    });
    const progress =
      tracked.length === 0 ? 0 : clampProgress(((tracked.length - unchecked.length) / tracked.length) * 100);
    const items: TripOverviewItem[] = [
      ...tracked
        .filter((item) => blockerIds.has(item.id))
        .map((item) => {
          const members = itemMembers.get(item.id) || [];
          const critical = isCriticalPackingItem(item);
          const open = Number(item.checked) !== 1;
          const label = responsibilityLabel(members);
          return {
            id: `packing-blocker-${item.id}`,
            source: 'packing' as const,
            source_id: item.id,
            title: item.name,
            meta:
              critical && members.length === 0
                ? open
                  ? 'Critical item unpacked and unassigned'
                  : 'Critical item needs owner'
                : critical
                  ? `Critical item open - ${label}`
                  : 'Needs owner',
            status: critical ? ('urgent' as const) : ('attention' as const),
          };
        }),
      ...unchecked
        .filter((item) => !blockerIds.has(item.id))
        .map((item) => ({
          id: `packing-open-${item.id}`,
          source: 'packing' as const,
          source_id: item.id,
          title: item.name,
          meta: `${responsibilityLabel(itemMembers.get(item.id) || [])} - ${item.category || 'Still open'}`,
          status: 'attention' as const,
        })),
    ].slice(0, 4);

    return {
      summary:
        tracked.length === 0
          ? 'No packing list yet'
          : blockerIds.size > 0
            ? `${blockerIds.size} packing blocker${blockerIds.size === 1 ? '' : 's'}`
            : unchecked.length > 0
              ? `${unchecked.length} item${unchecked.length === 1 ? '' : 's'} still open`
              : 'Everything is checked off',
      status: tracked.length === 0 ? 'empty' : hasUrgent ? 'urgent' : unchecked.length > 0 ? 'attention' : 'good',
      count: blockerIds.size || unchecked.length,
      uncheckedCount: unchecked.length,
      items,
      metric: tracked.length > 0 ? `${progress}% packed` : undefined,
      progress,
    };
  }

  private buildConflictItems(days: DayWithAssignments[], reservations: Reservation[]): TripOverviewItem[] {
    const dayById = new Map(days.map((day, index) => [day.id, { day, index }]));
    const intervals = [
      ...days.flatMap((day, dayIndex) =>
        (day.assignments || [])
          .map((assignment) => assignmentInterval(assignment, day, dayIndex))
          .filter((item): item is IntervalEntry => !!item),
      ),
      ...reservations
        .map((reservation) => reservationInterval(reservation, dayById))
        .filter((item): item is IntervalEntry => !!item),
    ];
    const items: TripOverviewItem[] = [];
    const byDay = new Map<number, IntervalEntry[]>();
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
          items.push({
            id: `overlap-${previous.id}-${current.id}`,
            source: 'plan',
            title: `${previous.title} overlaps ${current.title}`,
            meta: `${previous.dayName}, ${timeLabel(current.start)}-${timeLabel(Math.min(previous.end, current.end))}`,
            status: 'urgent',
          });
        }
      }
    }
    for (const reservation of reservations) {
      if (reservation.day_id == null) continue;
      const reservationDate = datePart(reservation.reservation_time);
      const day = dayById.get(reservation.day_id)?.day;
      if (reservationDate && day?.date && reservationDate !== day.date) {
        items.push({
          id: `date-mismatch-${reservation.id}`,
          source: 'reservation',
          source_id: reservation.id,
          title: reservationTitle(reservation),
          meta: `Booking date differs from ${dayName(day, 0)}`,
          status: 'attention',
        });
      }
    }
    return items.slice(0, 4);
  }

  private buildDeadlineItems(input: {
    trip: TripRow;
    openTodos: TodoRow[];
    reservations: Reservation[];
    decisions: DecisionRow[];
    now: Date;
  }): TripOverviewItem[] {
    const entries: TimelineEntry[] = [
      ...input.openTodos
        .filter((todo) => !!todo.due_date)
        .map((todo) => ({
          id: `todo-${todo.id}`,
          source: 'todo' as const,
          source_id: todo.id,
          title: todo.name,
          date: todo.due_date!,
          status: (daysUntil(todo.due_date, input.now) ?? 1) < 0 ? ('urgent' as const) : ('attention' as const),
        })),
      ...input.reservations
        .filter((reservation) => !!reservation.reservation_time && !isCancelledReservation(reservation))
        .map((reservation) => ({
          id: `reservation-${reservation.id}`,
          source: 'reservation' as const,
          source_id: reservation.id,
          title: reservationTitle(reservation),
          date: datePart(reservation.reservation_time)!,
          status: reservation.status !== 'confirmed' ? ('attention' as const) : ('good' as const),
        })),
      ...input.decisions
        .filter((decision) => !!decision.deadline)
        .map((decision) => ({
          id: `decision-${decision.id}`,
          source: 'decision' as const,
          source_id: decision.id,
          title: decision.title,
          date: decision.deadline!,
          status: decision.state === 'closed' ? ('urgent' as const) : ('attention' as const),
        })),
      ...(input.trip.start_date
        ? [
            {
              id: 'trip-start',
              source: 'trip' as const,
              source_id: input.trip.id,
              title: `${input.trip.title} starts`,
              date: input.trip.start_date,
              status: 'attention' as const,
            },
          ]
        : []),
    ]
      .filter((entry) => {
        const delta = daysUntil(entry.date, input.now);
        return delta != null && delta >= -7 && delta <= 30;
      })
      .sort((a, b) => (daysUntil(a.date, input.now) ?? 0) - (daysUntil(b.date, input.now) ?? 0));

    return entries.slice(0, 4).map((entry) => ({
      id: entry.id,
      source: entry.source,
      source_id: entry.source_id,
      title: entry.title,
      meta: `${formatRelativeDate(entry.date, input.now)} - ${entry.source.replace('_', ' ')}`,
      status: entry.status,
    }));
  }

  private buildReadiness(input: {
    decisionCount: number;
    unpaidBudgetShares: number;
    budgetItems: number;
    bookingCount: number;
    bookingSources: number;
    packingItems: number;
    uncheckedPacking: number;
    documentCount: number;
  }): TripOverviewReadinessItem[] {
    return [
      {
        id: 'decisions',
        title: 'Resolve group decisions',
        summary:
          input.decisionCount > 0
            ? `${input.decisionCount} decision follow-up${input.decisionCount === 1 ? '' : 's'}`
            : 'No unresolved decisions',
        status: input.decisionCount > 0 ? 'attention' : 'good',
        count: input.decisionCount,
        action: 'decisions',
        action_label: input.decisionCount > 0 ? 'Open decisions' : 'Review decisions',
      },
      {
        id: 'balances',
        title: 'Settle unpaid balances',
        summary:
          input.unpaidBudgetShares > 0
            ? `${input.unpaidBudgetShares} unpaid share${input.unpaidBudgetShares === 1 ? '' : 's'}`
            : input.budgetItems === 0
              ? 'No shared costs tracked yet'
              : 'All shared balances marked paid',
        status: input.unpaidBudgetShares > 0 ? 'attention' : input.budgetItems === 0 ? 'empty' : 'good',
        count: input.unpaidBudgetShares,
        action: 'budget',
        action_label: input.unpaidBudgetShares > 0 ? 'Open costs' : 'Review costs',
      },
      {
        id: 'bookings',
        title: 'Confirm bookings',
        summary:
          input.bookingCount > 0
            ? `${input.bookingCount} booking follow-up${input.bookingCount === 1 ? '' : 's'}`
            : input.bookingSources === 0
              ? 'No bookings tracked yet'
              : 'Bookings have confirmations and statuses',
        status: input.bookingCount > 0 ? 'attention' : input.bookingSources === 0 ? 'empty' : 'good',
        count: input.bookingCount,
        action: 'bookings',
        action_label: input.bookingCount > 0 ? 'Open bookings' : 'Review bookings',
      },
      {
        id: 'packing',
        title: 'Pack remaining items',
        summary:
          input.packingItems === 0
            ? 'No packing list yet'
            : input.uncheckedPacking > 0
              ? `${input.uncheckedPacking} unpacked item${input.uncheckedPacking === 1 ? '' : 's'}`
              : 'Everything is checked off',
        status: input.packingItems === 0 ? 'empty' : input.uncheckedPacking > 0 ? 'attention' : 'good',
        count: input.uncheckedPacking,
        action: 'packing',
        action_label: input.uncheckedPacking > 0 ? 'Open packing' : 'Review packing',
      },
      {
        id: 'documents',
        title: 'Clear document follow-ups',
        summary:
          input.documentCount > 0
            ? `${input.documentCount} document follow-up${input.documentCount === 1 ? '' : 's'}`
            : 'No document follow-ups',
        status: input.documentCount > 0 ? 'attention' : 'good',
        count: input.documentCount,
        action: 'files',
        action_label: input.documentCount > 0 ? 'Open files' : 'Review files',
      },
    ];
  }
}

import type { TravelSearchParty, TravelSearchRequest, TravelSearchResult } from './types';

export interface BookingOptionRankingWeights {
  price: number;
  scheduleFit: number;
  convenience: number;
  flexibility: number;
  groupFit: number;
  warnings: number;
}

export interface BookingOptionRankingOptions {
  preferredStartsAt?: string | null;
  preferredEndsAt?: string | null;
  scheduleToleranceMinutes?: number;
  weights?: Partial<BookingOptionRankingWeights>;
}

export interface BookingOptionScoreBreakdown {
  price: number;
  scheduleFit: number;
  convenience: number;
  flexibility: number;
  groupFit: number;
  warnings: number;
}

export interface RankedTravelSearchResult {
  rank: number;
  result: TravelSearchResult;
  score: number;
  reasons: string[];
  breakdown: BookingOptionScoreBreakdown;
}

interface PriceStats {
  knownPrices: number[];
  lowestPrice: number | null;
}

interface FactorScore {
  score: number;
  reasons: string[];
}

interface ScoredOption extends Omit<RankedTravelSearchResult, 'rank'> {
  originalIndex: number;
  scheduleDeviationMinutes: number | null;
}

export const DEFAULT_BOOKING_RANKING_WEIGHTS: BookingOptionRankingWeights = {
  price: 30,
  scheduleFit: 25,
  convenience: 20,
  flexibility: 15,
  groupFit: 5,
  warnings: 5,
};

const DEFAULT_SCHEDULE_TOLERANCE_MINUTES = 60;

export function rankTravelSearchResults(
  request: TravelSearchRequest,
  results: TravelSearchResult[],
  options: BookingOptionRankingOptions = {},
): RankedTravelSearchResult[] {
  const weights = { ...DEFAULT_BOOKING_RANKING_WEIGHTS, ...(options.weights ?? {}) };
  const priceStats = buildPriceStats(results);

  return results
    .map((result, originalIndex): ScoredOption => {
      const price = scorePrice(request, result, priceStats);
      const schedule = scoreSchedule(request, result, options);
      const convenience = scoreConvenience(request, result);
      const flexibility = scoreFlexibility(result);
      const groupFit = scoreGroupFit(request.party, result);
      const warnings = scoreWarnings(result);
      const breakdown: BookingOptionScoreBreakdown = {
        price: price.score,
        scheduleFit: schedule.score,
        convenience: convenience.score,
        flexibility: flexibility.score,
        groupFit: groupFit.score,
        warnings: warnings.score,
      };

      return {
        result,
        score: weightedScore(breakdown, weights),
        reasons: [
          ...price.reasons,
          ...schedule.reasons,
          ...convenience.reasons,
          ...flexibility.reasons,
          ...groupFit.reasons,
          ...warnings.reasons,
        ],
        breakdown,
        originalIndex,
        scheduleDeviationMinutes: scheduleDeviationMinutes(request, result, options),
      };
    })
    .sort(compareScoredOptions)
    .map(
      ({ originalIndex: _originalIndex, scheduleDeviationMinutes: _scheduleDeviationMinutes, ...option }, index) => ({
        ...option,
        rank: index + 1,
      }),
    );
}

function buildPriceStats(results: TravelSearchResult[]): PriceStats {
  const knownPrices = results.map((result) => result.price).filter(isFiniteNumber);
  return {
    knownPrices,
    lowestPrice: knownPrices.length > 0 ? Math.min(...knownPrices) : null,
  };
}

function scorePrice(request: TravelSearchRequest, result: TravelSearchResult, stats: PriceStats): FactorScore {
  if (!isFiniteNumber(result.price)) {
    return { score: 45, reasons: ['Price is unavailable, so it is ranked conservatively.'] };
  }

  const price = result.price;
  const currency = result.currency ?? request.budget?.currency ?? null;
  const lowestPrice = stats.lowestPrice;
  let score: number;
  const reasons: string[] = [];

  if (lowestPrice === null || stats.knownPrices.length === 1 || lowestPrice <= 0) {
    score = 90;
    reasons.push(`Price is ${formatMoney(price, currency)}.`);
  } else if (price === lowestPrice) {
    score = 100;
    reasons.push(`Lowest price at ${formatMoney(price, currency)}.`);
  } else {
    const aboveLowest = price - lowestPrice;
    const percentAboveLowest = aboveLowest / lowestPrice;
    score = clamp(100 - percentAboveLowest * 100, 45, 95);
    reasons.push(`${formatMoney(aboveLowest, currency)} more than the cheapest option.`);
  }

  const maxPrice = request.budget?.maxPrice;
  if (isFiniteNumber(maxPrice) && maxPrice > 0) {
    if (price <= maxPrice) {
      reasons.push(`Within the ${formatMoney(maxPrice, currency)} budget.`);
    } else {
      const overBudget = price - maxPrice;
      const budgetPenalty = clamp((overBudget / maxPrice) * 100, 10, 45);
      score = clamp(score - budgetPenalty, 0, 100);
      reasons.push(`Over the ${formatMoney(maxPrice, currency)} budget by ${formatMoney(overBudget, currency)}.`);
    }
  }

  return { score: roundScore(score), reasons };
}

function scoreSchedule(
  request: TravelSearchRequest,
  result: TravelSearchResult,
  options: BookingOptionRankingOptions,
): FactorScore {
  const deviation = scheduleDeviationMinutes(request, result, options);
  const toleranceMinutes = options.scheduleToleranceMinutes ?? DEFAULT_SCHEDULE_TOLERANCE_MINUTES;

  if (deviation === null) {
    return { score: 65, reasons: ['Schedule fit is unknown because timing data is incomplete.'] };
  }

  if (deviation === 0) {
    return { score: 100, reasons: ['Matches the requested schedule.'] };
  }

  if (deviation <= toleranceMinutes) {
    return {
      score: roundScore(clamp(100 - (deviation / toleranceMinutes) * 5, 90, 100)),
      reasons: [`Schedule is within ${formatDuration(toleranceMinutes)} of the requested time.`],
    };
  }

  const score = clamp(90 - (deviation - toleranceMinutes) / 6, 15, 90);
  return {
    score: roundScore(score),
    reasons: [`Schedule is ${formatDuration(deviation)} away from the requested time.`],
  };
}

function scoreConvenience(request: TravelSearchRequest, result: TravelSearchResult): FactorScore {
  const metadataScore = metadataNumber(result.metadata, ['convenienceScore', 'convenience_score']);
  const reasons: string[] = [];
  let score = isFiniteNumber(metadataScore) ? clamp(metadataScore, 0, 100) : 85;
  let hasConvenienceSignal = isFiniteNumber(metadataScore);

  const stopCount = metadataNumber(result.metadata, ['stopCount', 'stops']);
  if (isFiniteNumber(stopCount)) {
    hasConvenienceSignal = true;
    if (stopCount <= 0) {
      score = clamp(score + 5, 0, 100);
      reasons.push('Direct or no-stop option improves convenience.');
    } else {
      score = clamp(score - Math.min(40, stopCount * 12), 0, 100);
      reasons.push(`${stopCount} ${stopCount === 1 ? 'stop' : 'stops'} make this less convenient.`);
    }
  }

  const requestedDuration = durationMinutes(request.startsAt ?? null, request.endsAt ?? null);
  const resultDuration = result.timing.durationMinutes;
  if (isFiniteNumber(requestedDuration) && requestedDuration > 0 && isFiniteNumber(resultDuration)) {
    hasConvenienceSignal = true;
    const extraMinutes = resultDuration - requestedDuration;
    if (extraMinutes <= 0) {
      score = clamp(score + 5, 0, 100);
      reasons.push('Duration is no longer than requested.');
    } else if (extraMinutes >= 30) {
      const durationPenalty = Math.min(35, extraMinutes / 15);
      score = clamp(score - durationPenalty, 0, 100);
      reasons.push(`${formatDuration(extraMinutes)} longer than requested.`);
    }
  }

  const transferMinutes = metadataNumber(result.metadata, ['transferMinutes', 'connectionMinutes']);
  if (isFiniteNumber(transferMinutes) && transferMinutes > 60) {
    hasConvenienceSignal = true;
    score = clamp(score - Math.min(20, (transferMinutes - 60) / 6), 0, 100);
    reasons.push(`${formatDuration(transferMinutes)} transfer time reduces convenience.`);
  }

  const walkingMinutes = metadataNumber(result.metadata, ['walkingMinutes']);
  if (isFiniteNumber(walkingMinutes) && walkingMinutes > 20) {
    hasConvenienceSignal = true;
    score = clamp(score - Math.min(15, (walkingMinutes - 20) / 3), 0, 100);
    reasons.push(`${formatDuration(walkingMinutes)} walking time reduces convenience.`);
  }

  const convenienceWarning = metadataString(result.metadata, ['convenienceWarning', 'convenience_warning']);
  if (convenienceWarning) {
    hasConvenienceSignal = true;
    score = clamp(score - 15, 0, 100);
    reasons.push(convenienceWarning);
  }

  if (!hasConvenienceSignal) {
    return { score: 75, reasons: ['Convenience details are unavailable, so this is treated neutrally.'] };
  }

  if (reasons.length === 0) {
    reasons.push('Convenience signals are favorable.');
  }

  return { score: roundScore(score), reasons };
}

function scoreFlexibility(result: TravelSearchResult): FactorScore {
  const policyText = [result.cancellationHint, result.refundHint].filter(Boolean).join(' ').toLowerCase();
  const metadata = result.metadata;
  const reasons: string[] = [];
  let score = 50;

  const hasPositiveMetadata =
    metadataBoolean(metadata, ['refundable', 'isRefundable', 'freeCancellation', 'flexible']) === true;
  const hasNegativeMetadata =
    metadataBoolean(metadata, ['nonRefundable', 'isNonRefundable', 'strictCancellation']) === true;
  const hasStrictTerms =
    hasNegativeMetadata || /\b(non[- ]?refundable|no refund|no cancellation|strict)\b/.test(policyText);

  if (
    !hasStrictTerms &&
    (hasPositiveMetadata || /\b(fully refundable|free cancellation|free cancel|flexible|changeable)\b/.test(policyText))
  ) {
    score = 90;
    reasons.push('Refundable or flexible policy improves this option.');
  }

  if (!hasStrictTerms && /\b(partial refund|partially refundable|credit)\b/.test(policyText)) {
    score = Math.max(score, 70);
    reasons.push('Partial refund or travel-credit terms add some flexibility.');
  }

  if (hasStrictTerms) {
    score = Math.min(score, 25);
    reasons.push('Strict or non-refundable terms reduce flexibility.');
  }

  if (reasons.length === 0) {
    reasons.push('Cancellation and refund flexibility is unclear.');
  }

  return { score, reasons };
}

function scoreGroupFit(party: TravelSearchParty | null | undefined, result: TravelSearchResult): FactorScore {
  const travelers = travelerCount(party);
  const rooms = party?.rooms;
  const hasTravelerRequirement = travelers !== null && travelers > 1;
  const hasRoomRequirement = isFiniteNumber(rooms) && rooms > 1;

  if (!hasTravelerRequirement && !hasRoomRequirement) {
    return { score: 100, reasons: ['No group-size constraints requested.'] };
  }

  const reasons: string[] = [];
  const scores: number[] = [];
  const capacity = metadataNumber(result.metadata, ['capacity', 'maxGuests', 'availableSeats', 'seatsAvailable']);
  const roomsAvailable = metadataNumber(result.metadata, ['roomsAvailable', 'availableRooms']);

  if (hasTravelerRequirement) {
    if (isFiniteNumber(capacity)) {
      if (capacity >= travelers) {
        scores.push(100);
        reasons.push(`Fits the group of ${travelers} travelers.`);
      } else {
        scores.push(0);
        reasons.push(`Only fits ${capacity} of ${travelers} travelers.`);
      }
    } else {
      scores.push(75);
      reasons.push(`Group fit for ${travelers} travelers is unknown.`);
    }
  }

  if (hasRoomRequirement) {
    if (isFiniteNumber(roomsAvailable)) {
      if (roomsAvailable >= rooms) {
        scores.push(100);
        reasons.push(`Has ${roomsAvailable} rooms available for the requested ${rooms}.`);
      } else {
        scores.push(0);
        reasons.push(`Only ${roomsAvailable} rooms available for the requested ${rooms}.`);
      }
    } else {
      scores.push(75);
      reasons.push(`Room availability for ${rooms} rooms is unknown.`);
    }
  }

  return { score: Math.min(...scores), reasons };
}

function scoreWarnings(result: TravelSearchResult): FactorScore {
  const warnings = extractWarnings(result.metadata);
  if (warnings.length === 0) {
    return { score: 100, reasons: ['No warnings attached.'] };
  }

  const score = clamp(100 - warnings.length * 25, 0, 100);
  return {
    score,
    reasons: warnings.slice(0, 3).map((warning) => `Warning: ${warning}`),
  };
}

function scheduleDeviationMinutes(
  request: TravelSearchRequest,
  result: TravelSearchResult,
  options: BookingOptionRankingOptions,
): number | null {
  const preferredStartsAt = options.preferredStartsAt ?? request.startsAt ?? null;
  const preferredEndsAt = options.preferredEndsAt ?? request.endsAt ?? null;
  const deviations = [
    absoluteMinutesBetween(preferredStartsAt, result.timing.startsAt),
    absoluteMinutesBetween(preferredEndsAt, result.timing.endsAt),
  ].filter(isFiniteNumber);

  if (deviations.length === 0) return null;
  return Math.round(deviations.reduce((sum, deviation) => sum + deviation, 0) / deviations.length);
}

function weightedScore(breakdown: BookingOptionScoreBreakdown, weights: BookingOptionRankingWeights): number {
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (totalWeight <= 0) return 0;

  const weighted =
    breakdown.price * Math.max(0, weights.price) +
    breakdown.scheduleFit * Math.max(0, weights.scheduleFit) +
    breakdown.convenience * Math.max(0, weights.convenience) +
    breakdown.flexibility * Math.max(0, weights.flexibility) +
    breakdown.groupFit * Math.max(0, weights.groupFit) +
    breakdown.warnings * Math.max(0, weights.warnings);

  return roundScore(weighted / totalWeight);
}

function compareScoredOptions(a: ScoredOption, b: ScoredOption): number {
  if (b.score !== a.score) return b.score - a.score;

  const priceCompare = compareNullableNumbers(a.result.price, b.result.price);
  if (priceCompare !== 0) return priceCompare;

  const scheduleCompare = compareNullableNumbers(a.scheduleDeviationMinutes, b.scheduleDeviationMinutes);
  if (scheduleCompare !== 0) return scheduleCompare;

  const providerCompare = a.result.provider.localeCompare(b.result.provider);
  if (providerCompare !== 0) return providerCompare;

  const externalCompare = a.result.externalId.localeCompare(b.result.externalId);
  if (externalCompare !== 0) return externalCompare;

  return a.originalIndex - b.originalIndex;
}

function compareNullableNumbers(a: number | null, b: number | null): number {
  const aKnown = isFiniteNumber(a);
  const bKnown = isFiniteNumber(b);
  if (aKnown && bKnown) return a - b;
  if (aKnown) return -1;
  if (bKnown) return 1;
  return 0;
}

function extractWarnings(metadata: Record<string, unknown>): string[] {
  const values = [
    metadata.warnings,
    metadata.warning,
    metadata.riskWarnings,
    metadata.risk_warning,
    metadata.scheduleWarning,
  ];

  if (metadata.requiresManualConfirmation === true) {
    values.push('Requires manual confirmation before booking');
  }

  return values.flatMap(warningValues).filter((warning): warning is string => warning.length > 0);
}

function warningValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(warningValues);
  if (typeof value === 'string') return [value.trim()].filter(Boolean);
  if (value && typeof value === 'object' && 'message' in value) {
    const message = (value as { message?: unknown }).message;
    return typeof message === 'string' ? [message.trim()].filter(Boolean) : [];
  }
  return [];
}

function travelerCount(party: TravelSearchParty | null | undefined): number | null {
  if (!party) return null;
  const travelers = [party.adults, party.children, party.infants]
    .filter(isFiniteNumber)
    .reduce((sum, count) => sum + count, 0);
  return travelers > 0 ? travelers : null;
}

function metadataNumber(metadata: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = metadata[key];
    if (isFiniteNumber(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function metadataString(metadata: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

function metadataBoolean(metadata: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'boolean') return value;
  }
  return null;
}

function durationMinutes(startsAt: string | null, endsAt: string | null): number | null {
  const start = parseDate(startsAt);
  const end = parseDate(endsAt);
  if (start === null || end === null || end < start) return null;
  return Math.round((end - start) / 60000);
}

function absoluteMinutesBetween(first: string | null, second: string | null): number | null {
  const firstTime = parseDate(first);
  const secondTime = parseDate(second);
  if (firstTime === null || secondTime === null) return null;
  return Math.abs(Math.round((secondTime - firstTime) / 60000));
}

function parseDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMoney(value: number, currency: string | null): string {
  const amount = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return currency ? `${currency} ${amount}` : amount;
}

function formatDuration(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} min`;
  if (rounded % 60 === 0) return `${rounded / 60}h`;
  const hours = Math.floor(rounded / 60);
  return `${hours}h ${rounded % 60}m`;
}

function roundScore(value: number): number {
  return Math.round(clamp(value, 0, 100) * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

import { resolveDbProvider } from '../../db/providerMode';
import type { User } from '../../types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReservationsService } from './reservations.service';
import { Body, Controller, Delete, Get, Headers, HttpException, Param, Post, Put, UseGuards } from '@nestjs/common';

type ReservationBody = Record<string, unknown> & {
  title?: string;
  type?: string;
  create_budget_entry?: { total_price?: number; category?: string };
};

/**
 * /api/trips/:tripId/reservations — trip-scoped bookings.
 *
 * Byte-identical to the legacy Express route (server/src/routes/reservations.ts):
 * trip access (404), 'reservation_edit' permission (403), create 201 / rest 200,
 * the bespoke 400/404 bodies, the accommodation + budget side effects, the
 * booking notifications, and all WebSocket broadcasts with the forwarded
 * X-Socket-Id. /positions is declared before /:id so it wins over the param.
 */
@Controller('api/trips/:tripId/reservations')
@UseGuards(JwtAuthGuard)
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  private async requireTrip(tripId: string, user: User) {
    const trip = await this.reservations.verifyTripAccess(tripId, user.id);
    if (!trip) {
      throw new HttpException({ error: 'Trip not found' }, 404);
    }
    return trip;
  }

  private async requireEdit(
    trip: NonNullable<Awaited<ReturnType<ReservationsService['verifyTripAccess']>>>,
    user: User,
  ): Promise<void> {
    if (!(await this.reservations.canEdit(trip!, user))) {
      throw new HttpException({ error: 'No permission' }, 403);
    }
  }

  @Get()
  async list(@CurrentUser() user: User, @Param('tripId') tripId: string) {
    await this.requireTrip(tripId, user);
    return { reservations: await this.reservations.list(tripId) };
  }

  @Post()
  async create(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Body() body: ReservationBody,
    @Headers('x-socket-id') socketId?: string,
  ) {
    const trip = await this.requireTrip(tripId, user);
    await this.requireEdit(trip, user);
    if (!body.title) {
      throw new HttpException({ error: 'Title is required' }, 400);
    }
    const { reservation, accommodationCreated } = await this.reservations.create(tripId, body as never);
    if (accommodationCreated) {
      this.reservations.broadcast(tripId, 'accommodation:created', {}, socketId);
    }
    await this.reservations.syncBudgetOnCreate(
      tripId,
      reservation.id,
      body.title,
      body.type,
      body.create_budget_entry,
      socketId,
    );
    this.reservations.broadcast(tripId, 'reservation:created', { reservation }, socketId);
    this.reservations.notifyBookingChange(tripId, user, body.title, body.type ?? '');
    return { reservation };
  }

  @Put('positions')
  async updatePositions(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Body() body: { positions?: unknown; day_id?: unknown },
    @Headers('x-socket-id') socketId?: string,
  ) {
    const trip = await this.requireTrip(tripId, user);
    await this.requireEdit(trip, user);
    if (!Array.isArray(body.positions)) {
      throw new HttpException({ error: 'positions must be an array' }, 400);
    }
    const positions = body.positions.map((item) => {
      const row = item as { id?: unknown; day_plan_position?: unknown };
      const id = Number(row.id);
      const dayPlanPosition = Number(row.day_plan_position);
      if (!Number.isFinite(id) || !Number.isFinite(dayPlanPosition)) {
        throw new HttpException({ error: 'positions must contain id and day_plan_position numbers' }, 400);
      }
      return { id, day_plan_position: dayPlanPosition };
    });
    await this.reservations.updatePositions(tripId, positions, body.day_id);
    this.reservations.broadcast(tripId, 'reservation:positions', { positions, day_id: body.day_id }, socketId);
    return { success: true };
  }

  @Put(':id')
  async update(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Param('id') id: string,
    @Body() body: ReservationBody,
    @Headers('x-socket-id') socketId?: string,
  ) {
    const trip = await this.requireTrip(tripId, user);
    await this.requireEdit(trip, user);
    const current = await this.reservations.getReservation(id, tripId);
    if (!current) {
      throw new HttpException({ error: 'Reservation not found' }, 404);
    }
    const { reservation, accommodationChanged } = await this.reservations.update(
      id,
      tripId,
      body as never,
      current as never,
    );
    if (accommodationChanged) {
      this.reservations.broadcast(tripId, 'accommodation:updated', {}, socketId);
    }
    const cur = current as { title: string; type?: string };
    await this.reservations.syncBudgetOnUpdate(
      tripId,
      id,
      body.title ?? '',
      body.type,
      cur.title,
      cur.type,
      body.create_budget_entry,
      socketId,
    );
    this.reservations.broadcast(tripId, 'reservation:updated', { reservation }, socketId);
    // Push a locally-edited AirTrail flight back to AirTrail (fire-and-forget,
    // under the importer's credentials — see airtrailSync). #214
    if ((reservation as any)?.external_source === 'airtrail' && (reservation as any)?.sync_enabled) {
      if (resolveDbProvider() !== 'oracle-async') {
        void import('../../services/airtrail/airtrailSync')
          .then(({ pushReservationToAirtrail }) =>
            pushReservationToAirtrail(Number((reservation as any).id), Number(tripId)),
          )
          .catch(() => {});
      }
    }
    this.reservations.notifyBookingChange(tripId, user, body.title || cur.title, body.type || cur.type || '');
    return { reservation };
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Param('id') id: string,
    @Headers('x-socket-id') socketId?: string,
  ) {
    const trip = await this.requireTrip(tripId, user);
    await this.requireEdit(trip, user);
    const { deleted, accommodationDeleted, deletedBudgetItemId } = await this.reservations.remove(id, tripId);
    if (!deleted) {
      throw new HttpException({ error: 'Reservation not found' }, 404);
    }
    if (accommodationDeleted) {
      this.reservations.broadcast(
        tripId,
        'accommodation:deleted',
        { accommodationId: deleted.accommodation_id },
        socketId,
      );
    }
    if (deletedBudgetItemId) {
      this.reservations.broadcast(tripId, 'budget:deleted', { itemId: deletedBudgetItemId }, socketId);
    }
    this.reservations.broadcast(tripId, 'reservation:deleted', { reservationId: Number(id) }, socketId);
    this.reservations.notifyBookingChange(tripId, user, deleted.title, deleted.type || '');
    return { success: true };
  }
}

import type { User } from '../../types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  BookingIntentBookedInput,
  BookingIntentInput,
  BookingIntentValidationError,
  BookingIntentsService,
} from './booking-intents.service';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

type Trip = NonNullable<Awaited<ReturnType<BookingIntentsService['verifyTripAccess']>>>;

@Controller('api/trips/:tripId/booking-intents')
@UseGuards(JwtAuthGuard)
export class BookingIntentsController {
  constructor(private readonly bookingIntents: BookingIntentsService) {}

  private async requireTrip(tripId: string, user: User): Promise<Trip> {
    const trip = await this.bookingIntents.verifyTripAccess(tripId, user.id);
    if (!trip) {
      throw new HttpException({ error: 'Trip not found' }, 404);
    }
    return trip;
  }

  private async requireEdit(trip: Trip, user: User): Promise<void> {
    if (!(await this.bookingIntents.canEdit(trip, user))) {
      throw new HttpException({ error: 'No permission' }, 403);
    }
  }

  private mapValidation(err: unknown): never {
    if (err instanceof BookingIntentValidationError) {
      throw new HttpException({ error: err.message }, 400);
    }
    throw err;
  }

  @Get()
  async list(@CurrentUser() user: User, @Param('tripId') tripId: string, @Query('status') status?: string) {
    await this.requireTrip(tripId, user);
    try {
      return {
        booking_intents: await this.bookingIntents.list(tripId, status),
      };
    } catch (err) {
      this.mapValidation(err);
    }
  }

  @Post()
  async create(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Body() body: BookingIntentInput,
    @Headers('x-socket-id') socketId?: string,
  ) {
    const trip = await this.requireTrip(tripId, user);
    await this.requireEdit(trip, user);
    try {
      const bookingIntent = await this.bookingIntents.create(tripId, user.id, body);
      this.bookingIntents.broadcast(tripId, 'booking-intent:created', { booking_intent: bookingIntent }, socketId);
      return { booking_intent: bookingIntent };
    } catch (err) {
      this.mapValidation(err);
    }
  }

  @Put(':id')
  async update(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Param('id') id: string,
    @Body() body: BookingIntentInput,
    @Headers('x-socket-id') socketId?: string,
  ) {
    const trip = await this.requireTrip(tripId, user);
    await this.requireEdit(trip, user);
    try {
      const bookingIntent = await this.bookingIntents.update(tripId, id, body);
      if (!bookingIntent) {
        throw new HttpException({ error: 'Booking intent not found' }, 404);
      }
      this.bookingIntents.broadcast(tripId, 'booking-intent:updated', { booking_intent: bookingIntent }, socketId);
      return { booking_intent: bookingIntent };
    } catch (err) {
      this.mapValidation(err);
    }
  }

  @Post(':id/start-watch')
  @HttpCode(200)
  async startWatch(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Param('id') id: string,
    @Headers('x-socket-id') socketId?: string,
  ) {
    const trip = await this.requireTrip(tripId, user);
    await this.requireEdit(trip, user);
    try {
      const result = await this.bookingIntents.startWatch(tripId, id);
      if (!result) {
        throw new HttpException({ error: 'Booking intent not found' }, 404);
      }
      this.bookingIntents.broadcast(
        tripId,
        'booking-intent:watch-started',
        { booking_intent: result.bookingIntent, agent_job: result.agentJob },
        socketId,
      );
      return {
        booking_intent: result.bookingIntent,
        agent_job: result.agentJob,
      };
    } catch (err) {
      this.mapValidation(err);
    }
  }

  @Post(':id/archive')
  @HttpCode(200)
  async archive(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Param('id') id: string,
    @Headers('x-socket-id') socketId?: string,
  ) {
    const trip = await this.requireTrip(tripId, user);
    await this.requireEdit(trip, user);
    const bookingIntent = await this.bookingIntents.archive(tripId, id);
    if (!bookingIntent) {
      throw new HttpException({ error: 'Booking intent not found' }, 404);
    }
    this.bookingIntents.broadcast(tripId, 'booking-intent:archived', { booking_intent: bookingIntent }, socketId);
    return { booking_intent: bookingIntent };
  }

  @Post(':id/checkout-handoff')
  @HttpCode(200)
  async checkoutHandoff(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Param('id') id: string,
    @Headers('x-socket-id') socketId?: string,
  ) {
    const trip = await this.requireTrip(tripId, user);
    await this.requireEdit(trip, user);
    try {
      const result = await this.bookingIntents.prepareCheckoutHandoff(tripId, id);
      if (!result) {
        throw new HttpException({ error: 'Booking intent not found' }, 404);
      }
      this.bookingIntents.broadcast(
        tripId,
        'booking-intent:checkout-started',
        { booking_intent: result.bookingIntent, handoff: result.handoff },
        socketId,
      );
      return {
        booking_intent: result.bookingIntent,
        handoff: result.handoff,
      };
    } catch (err) {
      this.mapValidation(err);
    }
  }

  @Post(':id/mark-booked')
  @HttpCode(200)
  async markBooked(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Param('id') id: string,
    @Body() body: BookingIntentBookedInput,
    @Headers('x-socket-id') socketId?: string,
  ) {
    const trip = await this.requireTrip(tripId, user);
    await this.requireEdit(trip, user);
    try {
      const bookingIntent = await this.bookingIntents.markBooked(tripId, id, body);
      if (!bookingIntent) {
        throw new HttpException({ error: 'Booking intent not found' }, 404);
      }
      this.bookingIntents.broadcast(tripId, 'booking-intent:booked', { booking_intent: bookingIntent }, socketId);
      return { booking_intent: bookingIntent };
    } catch (err) {
      this.mapValidation(err);
    }
  }
}

import type { User } from '../../types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BookingOptionInput, BookingOptionValidationError, BookingOptionsService } from './booking-options.service';
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

type Trip = NonNullable<Awaited<ReturnType<BookingOptionsService['verifyTripAccess']>>>;

@Controller('api/trips/:tripId/booking-intents/:intentId/options')
@UseGuards(JwtAuthGuard)
export class BookingOptionsController {
  constructor(private readonly bookingOptions: BookingOptionsService) {}

  private async requireTrip(tripId: string, user: User): Promise<Trip> {
    const trip = await this.bookingOptions.verifyTripAccess(tripId, user.id);
    if (!trip) {
      throw new HttpException({ error: 'Trip not found' }, 404);
    }
    return trip;
  }

  private async requireEdit(trip: Trip, user: User): Promise<void> {
    if (!(await this.bookingOptions.canEdit(trip, user))) {
      throw new HttpException({ error: 'No permission' }, 403);
    }
  }

  private mapValidation(err: unknown): never {
    if (err instanceof BookingOptionValidationError) {
      throw new HttpException({ error: err.message }, 400);
    }
    throw err;
  }

  @Get()
  async list(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Param('intentId') intentId: string,
    @Query('status') status?: string,
  ) {
    await this.requireTrip(tripId, user);
    try {
      const bookingOptions = await this.bookingOptions.list(tripId, intentId, status);
      if (!bookingOptions) {
        throw new HttpException({ error: 'Booking intent not found' }, 404);
      }
      return { booking_options: bookingOptions };
    } catch (err) {
      this.mapValidation(err);
    }
  }

  @Post()
  @HttpCode(200)
  async upsertFromWorker(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Param('intentId') intentId: string,
    @Body() body: BookingOptionInput,
    @Headers('x-socket-id') socketId?: string,
  ) {
    const trip = await this.requireTrip(tripId, user);
    await this.requireEdit(trip, user);
    try {
      const bookingOption = await this.bookingOptions.upsertFromWorker(tripId, intentId, body);
      if (!bookingOption) {
        throw new HttpException({ error: 'Booking intent not found' }, 404);
      }
      this.bookingOptions.broadcast(tripId, 'booking-option:upserted', { booking_option: bookingOption }, socketId);
      return { booking_option: bookingOption };
    } catch (err) {
      this.mapValidation(err);
    }
  }

  @Put(':optionId')
  async update(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Param('intentId') intentId: string,
    @Param('optionId') optionId: string,
    @Body() body: BookingOptionInput,
    @Headers('x-socket-id') socketId?: string,
  ) {
    const trip = await this.requireTrip(tripId, user);
    await this.requireEdit(trip, user);
    try {
      const bookingOption = await this.bookingOptions.update(tripId, intentId, optionId, body);
      if (!bookingOption) {
        throw new HttpException({ error: 'Booking option not found' }, 404);
      }
      this.bookingOptions.broadcast(tripId, 'booking-option:updated', { booking_option: bookingOption }, socketId);
      return { booking_option: bookingOption };
    } catch (err) {
      this.mapValidation(err);
    }
  }

  @Post(':optionId/archive')
  @HttpCode(200)
  async archive(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Param('intentId') intentId: string,
    @Param('optionId') optionId: string,
    @Headers('x-socket-id') socketId?: string,
  ) {
    const trip = await this.requireTrip(tripId, user);
    await this.requireEdit(trip, user);
    const bookingOption = await this.bookingOptions.archive(tripId, intentId, optionId);
    if (!bookingOption) {
      throw new HttpException({ error: 'Booking option not found' }, 404);
    }
    this.bookingOptions.broadcast(tripId, 'booking-option:archived', { booking_option: bookingOption }, socketId);
    return { booking_option: bookingOption };
  }

  @Post(':optionId/expire')
  @HttpCode(200)
  async expire(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Param('intentId') intentId: string,
    @Param('optionId') optionId: string,
    @Headers('x-socket-id') socketId?: string,
  ) {
    const trip = await this.requireTrip(tripId, user);
    await this.requireEdit(trip, user);
    const bookingOption = await this.bookingOptions.expire(tripId, intentId, optionId);
    if (!bookingOption) {
      throw new HttpException({ error: 'Booking option not found' }, 404);
    }
    this.bookingOptions.broadcast(tripId, 'booking-option:expired', { booking_option: bookingOption }, socketId);
    return { booking_option: bookingOption };
  }
}

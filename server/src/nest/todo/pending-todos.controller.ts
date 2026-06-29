import type { User } from '../../types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TodoService } from './todo.service';
import { Controller, Get, UseGuards } from '@nestjs/common';

/**
 * GET /api/todos/pending — cross-trip pending task feed for the dashboard
 * sidebar. Kept separate from /api/trips/:tripId/todo because the base path is
 * account-scoped rather than trip-scoped.
 */
@Controller('api/todos')
@UseGuards(JwtAuthGuard)
export class PendingTodosController {
  constructor(private readonly todo: TodoService) {}

  @Get('pending')
  pending(@CurrentUser() user: User) {
    return { todos: this.todo.listPending(user.id) };
  }
}

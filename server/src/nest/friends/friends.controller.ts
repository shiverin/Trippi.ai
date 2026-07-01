import { createPerfTrace } from '../../services/perfTrace';
import type { User } from '../../types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FriendsService } from './friends.service';
import { Controller, Delete, Get, HttpException, Param, Post, Query, UseGuards } from '@nestjs/common';

@Controller('api/friends')
@UseGuards(JwtAuthGuard)
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}

  @Get()
  async hub(@CurrentUser() user: User) {
    const trace = createPerfTrace('friends.hub', { userId: user.id });
    try {
      return await trace.measure('loadHub', () => this.friends.hub(user.id));
    } finally {
      trace.finish();
    }
  }

  @Get('search')
  async search(@CurrentUser() user: User, @Query('q') q?: string) {
    const trace = createPerfTrace('friends.search', { userId: user.id, qLength: q?.length ?? 0 });
    try {
      return await trace.measure('searchUsers', () => this.friends.search(user.id, q));
    } finally {
      trace.finish();
    }
  }

  @Get('users/:username')
  async profile(@CurrentUser() user: User, @Param('username') username: string) {
    const trace = createPerfTrace('friends.profile', { userId: user.id });
    try {
      const profile = await trace.measure('loadProfile', () => this.friends.profile(user.id, username));
      if (!profile) throw new HttpException({ error: 'User not found' }, 404);
      return profile;
    } finally {
      trace.finish();
    }
  }

  @Post(':userId/follow')
  async follow(@CurrentUser() user: User, @Param('userId') userIdParam: string) {
    const userId = Number(userIdParam);
    if (!Number.isInteger(userId)) throw new HttpException({ error: 'User not found' }, 404);
    try {
      const followed = await this.friends.follow(user.id, userId);
      if (!followed) throw new HttpException({ error: 'User not found' }, 404);
      return { success: true, user: followed };
    } catch (err) {
      if (err instanceof Error && err.message === 'SELF_FOLLOW') {
        throw new HttpException({ error: 'Cannot follow yourself' }, 400);
      }
      throw err;
    }
  }

  @Delete(':userId/follow')
  async unfollow(@CurrentUser() user: User, @Param('userId') userIdParam: string) {
    const userId = Number(userIdParam);
    if (!Number.isInteger(userId)) return { success: true };
    const unfollowed = await this.friends.unfollow(user.id, userId);
    return unfollowed ? { success: true, user: unfollowed } : { success: true };
  }
}

import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.types';
import { MessagesService } from './messages.service';

@Controller('api/messages')
@UseGuards(AuthGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  list(
    @Req() request: Request,
    @Query('filter') filter?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const parsedLimit = limit === undefined ? 30 : Number.parseInt(limit, 10);
    return this.messages.list(
      request.authUser as AuthUser,
      filter,
      Number.isFinite(parsedLimit) ? parsedLimit : 30,
      cursor,
    );
  }

  @Get('unread-count')
  unreadCount(@Req() request: Request) {
    return this.messages.unreadCount(request.authUser as AuthUser);
  }

  @Patch(':id/read')
  markRead(@Req() request: Request, @Param('id') id: string) {
    return this.messages.markRead(request.authUser as AuthUser, id);
  }

  @Post('read-all')
  markAllRead(@Req() request: Request) {
    return this.messages.markAllRead(request.authUser as AuthUser);
  }

  @Delete('read')
  removeRead(@Req() request: Request) {
    return this.messages.removeRead(request.authUser as AuthUser);
  }

  @Delete(':id')
  remove(@Req() request: Request, @Param('id') id: string) {
    return this.messages.remove(request.authUser as AuthUser, id);
  }
}

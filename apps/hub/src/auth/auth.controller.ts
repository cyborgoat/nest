import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('register') async register(
    @Body() body: { id: string; password: string; name: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.cookies(
      res,
      await this.auth.register(
        body.id ?? '',
        body.password ?? '',
        body.name ?? '',
      ),
    );
  }
  @Post('login') async login(
    @Body() body: { id: string; password: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.cookies(
      res,
      await this.auth.login(body.id ?? '', body.password ?? ''),
    );
  }
  @Post('refresh') refresh(
    @Req() req: Request,
    @Body() body: { refresh_token?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = body.refresh_token || this.cookie(req, 'nest_refresh') || '';
    return this.cookies(res, this.auth.refresh(token));
  }
  @Post('logout') logout(
    @Req() req: Request,
    @Body() body: { refresh_token?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = this.auth.logout(
      body.refresh_token || this.cookie(req, 'nest_refresh') || '',
    );
    res.setHeader('Set-Cookie', [
      'nest_access=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
      'nest_refresh=; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=0',
    ]);
    return result;
  }
  @Get('me') @UseGuards(AuthGuard) me(@Req() request: Request) {
    return request.authUser;
  }
  @Patch('profile')
  @UseGuards(AuthGuard)
  updateProfile(@Req() request: Request, @Body() body: { name: string }) {
    return this.auth.updateProfile(request.authUser!, body.name ?? '');
  }
  @Post('password')
  @UseGuards(AuthGuard)
  async changePassword(
    @Req() request: Request,
    @Body() body: { current_password: string; new_password: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.cookies(
      res,
      await this.auth.changePassword(
        request.authUser!,
        body.current_password ?? '',
        body.new_password ?? '',
      ),
    );
  }

  private cookies(
    res: Response,
    session: { access_token: string; refresh_token: string },
  ) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', [
      `nest_access=${session.access_token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=900${secure}`,
      `nest_refresh=${session.refresh_token}; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=2592000${secure}`,
    ]);
    return session;
  }
  private cookie(req: Request, name: string) {
    return (req.headers.cookie ?? '')
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith(`${name}=`))
      ?.slice(name.length + 1);
  }
}

import { Body, Controller, Post, Req, Res, Ip } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private setCookie(res: Response, token: string) {
    res.cookie('refreshToken', token, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', path: '/api/auth/refresh', maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  @Post('login')
  async login(@Body() dto: LoginDto, @Ip() ip: string, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken } = await this.authService.login(dto, ip);
    this.setCookie(res, refreshToken);
    return { accessToken };
  }

  @Post('refresh')
  async refresh(@Req() req: Request, @Ip() ip: string, @Res({ passthrough: true }) res: Response) {
    const old = req.cookies?.refreshToken;
    if (!old) { res.status(401).json({ message: '缺少 refresh token' }); return; }
    const { accessToken, refreshToken } = await this.authService.refresh(old, ip);
    this.setCookie(res, refreshToken);
    return { accessToken };
  }

  @Post('logout')
  async logout(@Req() req: Request) {
    if (req.cookies?.refreshToken) await this.authService.logout(req.cookies.refreshToken);
    return { message: '已登出' };
  }
}

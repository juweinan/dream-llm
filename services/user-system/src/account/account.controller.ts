import { Controller, Get, UseGuards } from '@nestjs/common';
import { AccountService } from './account.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../common/guards/auth.guard';

@Controller('api/account')
@UseGuards(AuthGuard)
export class AccountController {
  constructor(private readonly accountService: AccountService) {}
  @Get('me')
  getMe(@CurrentUser() user: JwtPayload) { return this.accountService.getMe(user); }
}

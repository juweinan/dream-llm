import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { PermissionsModule } from './permissions/permissions.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { AccountModule } from './account/account.module';

@Module({
  imports: [PrismaModule, AuthModule, UsersModule, RolesModule, PermissionsModule, AuditLogsModule, AccountModule],
})
export class AppModule {}

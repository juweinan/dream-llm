import { SetMetadata } from '@nestjs/common';
export const PERMISSION_KEY = 'permission';
export const Permissions = (code: string) => SetMetadata(PERMISSION_KEY, code);

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 开始初始化 RBAC 数据...\n');

  // 1. super_admin 用户
  const passwordHash = await bcrypt.hash('admin123', 12);
  const superAdmin = await prisma.user.upsert({
    where: { username: 'super_admin' },
    update: {},
    create: { username: 'super_admin', passwordHash, isSuperAdmin: true },
  });
  console.log(`✅ super_admin 用户: ${superAdmin.id}`);

  // 2. 权限 — 5 个模块的页面查看权限
  const pagePerms = ['dashboard', 'user', 'role', 'permission', 'audit'].map((mod) => ({
    name: `${mod} 页面查看`, code: `${mod}:page:view`, type: 'PAGE' as const, module: mod,
  }));

  // 3. 权限 — 用户管理按钮
  const userButtons = [
    { name: '创建用户', code: 'user:button:create', type: 'BUTTON' as const, module: 'user' },
    { name: '编辑用户', code: 'user:button:edit', type: 'BUTTON' as const, module: 'user' },
    { name: '删除用户', code: 'user:button:delete', type: 'BUTTON' as const, module: 'user' },
    { name: '分配角色', code: 'user:button:assign-role', type: 'BUTTON' as const, module: 'user' },
  ];

  // 4. 权限 — 角色管理按钮
  const roleButtons = [
    { name: '创建角色', code: 'role:button:create', type: 'BUTTON' as const, module: 'role' },
    { name: '编辑角色', code: 'role:button:edit', type: 'BUTTON' as const, module: 'role' },
    { name: '删除角色', code: 'role:button:delete', type: 'BUTTON' as const, module: 'role' },
    { name: '分配权限', code: 'role:button:assign-permission', type: 'BUTTON' as const, module: 'role' },
  ];

  const allPerms = [...pagePerms, ...userButtons, ...roleButtons];

  const permMap: Record<string, string> = {};
  for (const p of allPerms) {
    const created = await prisma.permission.upsert({
      where: { code: p.code },
      update: {},
      create: p,
    });
    permMap[p.code] = created.id;
  }
  console.log(`✅ ${allPerms.length} 个权限已创建`);

  // 5. 角色 — 系统管理员（全权）
  const adminRole = await prisma.role.upsert({
    where: { code: 'admin' },
    update: {},
    create: { name: '系统管理员', code: 'admin', description: '拥有所有模块的查看和操作权限' },
  });
  // 绑定所有权限
  await prisma.rolePermission.deleteMany({ where: { roleId: adminRole.id } });
  const allPermIds = Object.values(permMap);
  await prisma.rolePermission.createMany({
    data: allPermIds.map((permissionId) => ({ roleId: adminRole.id, permissionId })),
  });
  console.log(`✅ 角色 "系统管理员" → ${allPermIds.length} 个权限`);

  // 6. 角色 — 普通用户（仅查看）
  const viewerRole = await prisma.role.upsert({
    where: { code: 'viewer' },
    update: {},
    create: { name: '普通用户', code: 'viewer', description: '仅可查看各模块页面，无操作权限' },
  });
  const pagePermIds = pagePerms.map((p) => permMap[p.code]);
  await prisma.rolePermission.deleteMany({ where: { roleId: viewerRole.id } });
  await prisma.rolePermission.createMany({
    data: pagePermIds.map((permissionId) => ({ roleId: viewerRole.id, permissionId })),
  });
  console.log(`✅ 角色 "普通用户" → ${pagePermIds.length} 个查看权限`);

  // 7. 给 super_admin 分配 admin 角色
  await prisma.userRole.deleteMany({ where: { userId: superAdmin.id } });
  await prisma.userRole.create({ data: { userId: superAdmin.id, roleId: adminRole.id } });

  console.log(`\n🎉 RBAC 初始化完成！`);
  console.log(`   super_admin / admin123 (角色: 系统管理员 + 普通用户)`);
  console.log(`   角色: 系统管理员 (全权), 普通用户 (只读)`);
}

main().catch(console.error).finally(() => prisma.$disconnect());

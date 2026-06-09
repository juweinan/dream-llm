import path from 'node:path';
import type { NextConfig } from 'next';

// 在 monorepo 中，Next 需要显式声明 “哪些 workspace 包需要参与编译” 以及 “standalone
// tracing 的根目录“。否则常见的症状是：开发环境能跑，但构建产物缺共享包文件、或类型解析不完整。
const nextConfig: NextConfig = {
  /* config options here */
  transpilePackages: ['@autix/contracts'],
  output: 'standalone',
  // 必须设置：否则在 monorepo 下做 standalone 构建时，仓库外层的共享包可能不会被真正纳入 tracing 范围
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // env: {
  //   // 临时环境变量，后续需要从配置文件中读取配置
  //   NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4001',
  // },
  // 类似于 vite 项目中的 proxy 配置，这样就不会走 CORS 了
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4001'}/:path*`,
      },
    ];
  },
};

export default nextConfig;

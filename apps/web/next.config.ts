import type { NextConfig } from 'next';

/**
 * 同源 API 代理：浏览器只请求同源 /api/*，由 Next 转发到 API。
 * 这与生产反向代理拓扑一致，避免任何 CORS 依赖。
 * 开发模式允许 localhost 与 127.0.0.1 两种访问主机，避免 HMR 被误判跨域。
 */
const nextConfig: NextConfig = {
  allowedDevOrigins: ['localhost', '127.0.0.1'],
  async rewrites() {
    const target = process.env.SKIN_API_PROXY_TARGET ?? 'http://127.0.0.1:4000';
    return [{ source: '/api/:path*', destination: `${target}/:path*` }];
  },
};

export default nextConfig;

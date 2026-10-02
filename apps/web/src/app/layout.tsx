import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MC Plan Skin · Pixel Foundry',
  description: '用 AI 逐像素创作 Minecraft Java 64×64 双层皮肤，并在浏览器中实时 3D 预览。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-theme="foundry">
      <body>{children}</body>
    </html>
  );
}

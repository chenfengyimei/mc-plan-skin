import { ServiceStatus } from '../components/service-status';

export default function HomePage() {
  return (
    <main>
      <h1>MC Plan Skin</h1>
      <p>AI Minecraft 皮肤创作 · Java 64×64 · Steve / Alex · 双层皮肤</p>
      <ServiceStatus />
      <p className="muted">
        创作流程（对话、渲染、候选预览、确认与下载）将在纵向链路工作流中接入。
      </p>
    </main>
  );
}

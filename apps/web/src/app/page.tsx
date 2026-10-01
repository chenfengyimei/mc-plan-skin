import { CreationFlow } from '../components/creation-flow';
import { ServiceStatus } from '../components/service-status';

export default function HomePage() {
  return (
    <main>
      <h1>MC Plan Skin</h1>
      <p>AI Minecraft 皮肤创作 · Java 64×64 · Steve / Alex · 双层皮肤</p>
      <ServiceStatus />
      <CreationFlow />
      <p className="muted">
        当前为 F1 受限 Standalone 准备方向（ADR-0009）：仅确定性 Fake Provider， 不接入 MC Plan
        账号体系。
      </p>
    </main>
  );
}

import { CreationFlow } from '../components/creation-flow';
import { ServiceStatus } from '../components/service-status';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const providerMode =
    process.env.SKIN_PROVIDER === 'llm'
      ? 'real'
      : process.env.SKIN_PROVIDER === 'image'
        ? 'image'
        : 'demo';

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <div>
            <h1>MC Plan Skin</h1>
            <p>Pixel Foundry / 皮肤铸造间</p>
          </div>
        </div>
        <ServiceStatus providerMode={providerMode} />
      </header>

      <section className="hero" aria-labelledby="studio-heading">
        <div className="hero-copy">
          <p className="eyebrow">
            <span /> AI × Minecraft Pixel Craft
          </p>
          <h2 id="studio-heading">
            把想象，锻造成
            <em>每一个像素。</em>
          </h2>
          <p className="hero-description">
            用自然语言设计独一无二的 Java
            版皮肤。真实模型逐像素构图，生成后直接在浏览器里旋转、播放动作并检查双层细节。
          </p>
          <ul className="hero-specs" aria-label="支持能力">
            <li>
              <b>64×64</b>
              <span>Java 标准</span>
            </li>
            <li>
              <b>2 Layers</b>
              <span>完整双层</span>
            </li>
            <li>
              <b>3D Live</b>
              <span>动态预览</span>
            </li>
          </ul>
        </div>
        <div className="hero-signal" aria-hidden="true">
          <span className="signal-orbit signal-orbit-one" />
          <span className="signal-orbit signal-orbit-two" />
          <span className="signal-core">
            <i />
            <i />
            <i />
            <i />
          </span>
          <small>
            PIXEL
            <br />
            FORGE
          </small>
        </div>
      </section>

      <CreationFlow providerMode={providerMode} />

      <footer className="site-footer">
        <span>MC PLAN / SKIN STUDIO</span>
        <p>Standalone 创作链路 · 本地候选保留 24 小时 · 不接入账号体系</p>
        <span>JAVA 64 × 64</span>
      </footer>
    </main>
  );
}

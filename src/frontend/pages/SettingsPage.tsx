import type { CryptoState } from '@shared/types';
import { Icon } from '../components/Icon';
import { CatalogSection } from '../features/settings/CatalogSection';
import { DataSection } from '../features/settings/DataSection';
import { EncryptionSection } from '../features/settings/EncryptionSection';
import type { SettingsPageProps } from '../types/page-props';
import '../styles/settings.css';

interface AboutSectionProps {
  version: string;
  crypto: CryptoState;
}

function AboutSection({ version, crypto }: AboutSectionProps) {
  return (
    <section className="settings-section" aria-labelledby="settings-about-heading">
      <div className="settings-section__head">
        <h2 id="settings-about-heading">关于</h2>
        <span>版本与许可</span>
      </div>
      <div className="settings-card settings-about">
        <dl className="settings-about__list">
          <div className="settings-about__row">
            <dt>版本</dt>
            <dd className="num">{version}</dd>
          </div>
          <div className="settings-about__row">
            <dt>数据存储</dt>
            <dd>
              全部数据保存在当前设备，离线可用，不上传服务器。
              {crypto.enabled ? '已开启本地加密。' : ''}
            </dd>
          </div>
          <div className="settings-about__row">
            <dt>开源许可</dt>
            <dd>MIT License</dd>
          </div>
          <div className="settings-about__row">
            <dt>技术架构</dt>
            <dd>React 19 + TypeScript + Vite 8 前端，Web Worker 内完成加解密与 IndexedDB 存取。</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

export function SettingsPage({
  ledgerId,
  version,
  crypto,
  catalog,
  onCatalogChange,
  onSessionChange,
  onDataChanged,
  onLedgerImported,
  onLock,
}: SettingsPageProps) {
  return (
    <div className="page settings-page">
      <header className="page-heading settings-heading">
        <div>
          <p className="page-heading__eyebrow">偏好与数据</p>
          <h1>设置</h1>
        </div>
        <span className="page-heading__aside settings-heading__aside">
          <Icon name={crypto.enabled ? 'lock' : 'shield'} size={14} />
          {crypto.enabled ? '本地加密已开启' : '数据仅在本机'}
        </span>
      </header>

      <div className="settings-layout">
        <EncryptionSection crypto={crypto} onSessionChange={onSessionChange} onLock={onLock} />
        <DataSection
          ledgerId={ledgerId}
          encrypted={crypto.enabled}
          onSessionChange={onSessionChange}
          onDataChanged={onDataChanged}
          onLedgerImported={onLedgerImported}
        />
        <CatalogSection
          ledgerId={ledgerId}
          catalog={catalog}
          onCatalogChange={onCatalogChange}
        />
        <AboutSection version={version} crypto={crypto} />
      </div>
    </div>
  );
}

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { Catalog, Entry, InitResult } from '@shared/types';
import { currentMonthKey, monthKeyOfIso } from '@shared/date';
import { getLedgerClient } from './api/client';
import { BootScreen } from './components/BootScreen';
import { BrandMark } from './components/BrandMark';
import { Icon } from './components/Icon';
import { LockScreen } from './components/LockScreen';
import { PageSkeleton } from './components/PageSkeleton';
import { ToastProvider, useToast } from './components/ToastProvider';
import { LedgerPage } from './pages/LedgerPage';

type TabId = 'ledger' | 'stats' | 'settings';

interface SheetState {
  entry: Entry | null;
}

const StatsPage = lazy(() =>
  import('./pages/StatsPage').then((module) => ({ default: module.StatsPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })),
);
const EntrySheet = lazy(() =>
  import('./features/entry/EntrySheet').then((module) => ({ default: module.EntrySheet })),
);

const NAV_ITEMS: ReadonlyArray<{ id: TabId; label: string; icon: 'ledger' | 'chart' | 'settings' }> = [
  { id: 'ledger', label: '明细', icon: 'ledger' },
  { id: 'stats', label: '统计', icon: 'chart' },
  { id: 'settings', label: '设置', icon: 'settings' },
];

function App() {
  return (
    <ToastProvider>
      <AppController />
    </ToastProvider>
  );
}

function AppController() {
  const client = useMemo(() => getLedgerClient(), []);
  const { showToast } = useToast();
  const [booted, setBooted] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [session, setSession] = useState<InitResult | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [tab, setTab] = useState<TabId>('ledger');
  const [month, setMonth] = useState(() => currentMonthKey());
  const [revision, setRevision] = useState(0);
  const [sheet, setSheet] = useState<SheetState | null>(null);

  const initialize = useCallback(async () => {
    setBooted(false);
    setBootError(null);
    try {
      const result = await client.call('initialize', undefined);
      setSession(result);
      setCatalog(result.catalog);
    } catch (reason) {
      setBootError(reason instanceof Error ? reason.message : '无法打开本地账本');
    } finally {
      setBooted(true);
    }
  }, [client]);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    if (!session || session.status !== 'ready') return;
    const timer = window.setTimeout(() => {
      void import('./pages/StatsPage');
      void import('./pages/SettingsPage');
      void import('./features/entry/EntrySheet');
    }, 900);
    return () => window.clearTimeout(timer);
  }, [session]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [tab]);

  useEffect(() => {
    if (!session || session.status !== 'ready' || sheet) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }
      if (event.key === 'n' || event.key === 'N') {
        event.preventDefault();
        setSheet({ entry: null });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [session, sheet]);

  const handleUnlock = useCallback(
    async (passphrase: string) => {
      const result = await client.call('unlock', { passphrase });
      if (result.status !== 'ready' || !result.catalog) {
        throw new Error('解锁后未取得账本数据');
      }
      setSession(result);
      setCatalog(result.catalog);
      setBooted(true);
    },
    [client],
  );

  const handleSessionChange = useCallback((next: InitResult) => {
    setSession(next);
    setCatalog(next.catalog);
    if (next.status === 'locked') {
      setSheet(null);
      setTab('ledger');
    }
  }, []);

  const handleSaved = useCallback(
    (entry: Entry) => {
      const wasEditing = sheet?.entry != null;
      setRevision((value) => value + 1);
      setMonth(monthKeyOfIso(entry.occurredAt));
      setSheet(null);
      setTab('ledger');
      window.scrollTo({ top: 0, behavior: 'auto' });
      showToast(wasEditing ? '记录已更新' : '已记一笔', 'success');
    },
    [sheet, showToast],
  );

  const handleDeleted = useCallback(
    (_entry: Entry) => {
      setRevision((value) => value + 1);
      setSheet(null);
      showToast('记录已删除', 'success');
    },
    [showToast],
  );

  const handleLock = useCallback(async () => {
    const result = await client.call('lock', undefined);
    handleSessionChange(result);
    showToast('账本已锁定', 'success');
  }, [client, handleSessionChange, showToast]);

  const handleDataChanged = useCallback(() => {
    setRevision((value) => value + 1);
  }, []);

  const openAdd = useCallback(() => setSheet({ entry: null }), []);
  const openEdit = useCallback((entry: Entry) => setSheet({ entry }), []);

  if (!booted) return <BootScreen />;
  if (bootError) return <BootScreen error={bootError} onRetry={() => window.location.reload()} />;
  if (!session || session.status === 'locked') {
    return <LockScreen onUnlock={handleUnlock} />;
  }
  if (!catalog) return <BootScreen error="账本目录未能载入" onRetry={() => void initialize()} />;

  const renderPage = () => {
    if (tab === 'ledger') {
      return (
        <LedgerPage
          month={month}
          revision={revision}
          catalog={catalog}
          onMonthChange={setMonth}
          onAdd={openAdd}
          onEdit={openEdit}
        />
      );
    }
    if (tab === 'stats') {
      return <StatsPage month={month} revision={revision} onMonthChange={setMonth} />;
    }
    return (
      <SettingsPage
        version={session.version}
        crypto={session.crypto}
        catalog={catalog}
        onCatalogChange={setCatalog}
        onSessionChange={handleSessionChange}
        onDataChanged={handleDataChanged}
        onLock={handleLock}
      />
    );
  };

  return (
    <div className="app">
      <aside className="rail" aria-label="应用导航">
        <div className="rail__brand">
          <BrandMark size={44} />
          <div>
            <div className="rail__name">简账</div>
            <div className="rail__tagline">Local ledger</div>
          </div>
        </div>
        <nav className="rail__nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`rail__tab ${tab === item.id ? 'is-active' : ''}`}
              aria-current={tab === item.id ? 'page' : undefined}
              onClick={() => setTab(item.id)}
            >
              <Icon name={item.icon} size={19} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="rail__spacer" />
        <div className="rail__privacy">
          <Icon name={session.crypto.enabled ? 'lock' : 'shield'} size={16} />
          <span>{session.crypto.enabled ? '账本已加密，数据仅保存在本地。' : '数据仅保存在此设备，不经过网络。'}</span>
        </div>
        <button type="button" className="primary-button rail__add" onClick={openAdd}>
          <Icon name="plus" size={18} />
          记一笔
        </button>
      </aside>

      <div className="app__body">
        <header className="app-header">
          <div className="app-brand">
            <BrandMark size={38} />
            <div className="app-brand__copy">
              <span className="app-brand__name">简账</span>
              <span className="app-brand__tagline">Local ledger</span>
            </div>
          </div>
          <span className="local-badge">
            <Icon name={session.crypto.enabled ? 'lock' : 'shield'} size={13} />
            {session.crypto.enabled ? '本地加密' : '仅本机'}
          </span>
        </header>

        <main className="app-content">
          <div className="page-switch" key={tab}>
            <Suspense fallback={<PageSkeleton />}>{renderPage()}</Suspense>
          </div>
        </main>

        <div className="tabbar-wrap">
          <nav className="tabbar" aria-label="底部导航">
            <button
              type="button"
              className={`tab ${tab === 'ledger' ? 'is-active' : ''}`}
              aria-current={tab === 'ledger' ? 'page' : undefined}
              onClick={() => setTab('ledger')}
            >
              <Icon name="ledger" size={20} />
              <span>明细</span>
            </button>
            <button
              type="button"
              className={`tab ${tab === 'stats' ? 'is-active' : ''}`}
              aria-current={tab === 'stats' ? 'page' : undefined}
              onClick={() => setTab('stats')}
            >
              <Icon name="chart" size={20} />
              <span>统计</span>
            </button>
            <button type="button" className="tab tab--add" aria-label="记一笔" onClick={openAdd}>
              <Icon name="plus" size={23} strokeWidth={2.1} />
            </button>
            <button
              type="button"
              className={`tab ${tab === 'settings' ? 'is-active' : ''}`}
              aria-current={tab === 'settings' ? 'page' : undefined}
              onClick={() => setTab('settings')}
            >
              <Icon name="settings" size={20} />
              <span>设置</span>
            </button>
          </nav>
        </div>
      </div>

      {sheet ? (
        <Suspense fallback={null}>
          <EntrySheet
            key={sheet.entry?.id ?? 'new'}
            entry={sheet.entry}
            catalog={catalog}
            onClose={() => setSheet(null)}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

export default App;

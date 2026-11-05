import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import type { Catalog, Entry, ImportLedgerResult, InitResult, Ledger } from '@shared/types';
import { currentMonthKey, monthKeyOfIso } from '@shared/date';
import { getLedgerClient } from './api/client';
import { BackPreview, type BackPreviewState } from './components/BackPreview';
import { BootScreen } from './components/BootScreen';
import { BrandMark } from './components/BrandMark';
import { Icon } from './components/Icon';
import { LockScreen } from './components/LockScreen';
import { PageSkeleton } from './components/PageSkeleton';
import { QuickAddFab } from './components/QuickAddFab';
import { ToastProvider, useToast } from './components/ToastProvider';
import { LedgerSheet, LedgerTrigger } from './features/ledger/LedgerSwitcher';
import { getTopBackHandler, runTopBackHandler } from './features/settings/overlay';
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

const ACTIVE_LEDGER_KEY = 'ledgerlite.ui.activeLedgerId';

function readActiveLedgerId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_LEDGER_KEY);
  } catch {
    return null;
  }
}

function rememberActiveLedger(id: string): void {
  try {
    window.localStorage.setItem(ACTIVE_LEDGER_KEY, id);
  } catch {
    // Remembering the last ledger is optional.
  }
}

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
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [activeLedger, setActiveLedger] = useState<Ledger | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [ledgerSheetOpen, setLedgerSheetOpen] = useState(false);
  const [fabDocked, setFabDocked] = useState(false);
  const [tab, setTab] = useState<TabId>('ledger');
  const [month, setMonth] = useState(() => currentMonthKey());
  const [revision, setRevision] = useState(0);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [backPreview, setBackPreview] = useState<BackPreviewState | null>(null);
  const backPreviewTimer = useRef<number | null>(null);
  const backActionTimer = useRef<number | null>(null);
  const exitArmed = useRef(false);
  const exitArmTimer = useRef<number | null>(null);

  const showBackPreview = useCallback((label: string, duration = 1000) => {
    if (backPreviewTimer.current !== null) window.clearTimeout(backPreviewTimer.current);
    setBackPreview({ label, icon: 'chevron-left' });
    backPreviewTimer.current = window.setTimeout(() => {
      backPreviewTimer.current = null;
      setBackPreview(null);
    }, duration);
  }, []);

  const runBackAction = useCallback(
    (label: string, action: () => void) => {
      if (backActionTimer.current !== null) return;
      showBackPreview(label);
      backActionTimer.current = window.setTimeout(() => {
        backActionTimer.current = null;
        action();
      }, 160);
    },
    [showBackPreview],
  );

  const handleSystemBack = useCallback(() => {
    const topOverlay = getTopBackHandler();
    if (topOverlay) {
      runBackAction(topOverlay.label, () => {
        runTopBackHandler();
      });
      return;
    }
    if (tab !== 'ledger') {
      runBackAction('返回明细', () => setTab('ledger'));
      return;
    }
    if (!exitArmed.current) {
      exitArmed.current = true;
      showBackPreview('再返回一次退出简账', 1800);
      if (exitArmTimer.current !== null) window.clearTimeout(exitArmTimer.current);
      exitArmTimer.current = window.setTimeout(() => {
        exitArmTimer.current = null;
        exitArmed.current = false;
      }, 1800);
      return;
    }
    exitArmed.current = false;
    showBackPreview('正在退出简账', 600);
    backActionTimer.current = window.setTimeout(() => {
      backActionTimer.current = null;
      if (Capacitor.isNativePlatform()) {
        void CapacitorApp.exitApp();
      } else {
        window.history.back();
      }
    }, 120);
  }, [runBackAction, showBackPreview, tab]);

  useEffect(() => {
    let removeListener: (() => Promise<void>) | null = null;
    let cancelled = false;
    void CapacitorApp.addListener('backButton', handleSystemBack)
      .then((handle) => {
        removeListener = () => handle.remove();
        if (cancelled) void removeListener();
      })
      .catch(() => {
        // The native App plugin is unavailable in a plain browser preview.
      });
    return () => {
      cancelled = true;
      void removeListener?.();
    };
  }, [handleSystemBack]);

  useEffect(
    () => () => {
      if (backPreviewTimer.current !== null) window.clearTimeout(backPreviewTimer.current);
      if (backActionTimer.current !== null) window.clearTimeout(backActionTimer.current);
      if (exitArmTimer.current !== null) window.clearTimeout(exitArmTimer.current);
    },
    [],
  );

  const applyLedgerSession = useCallback(
    async (result: InitResult, preferredLedgerId: string | null = readActiveLedgerId()) => {
      setSession(result);
      setLedgers(result.ledgers);
      if (result.status !== 'ready' || !result.ledger || !result.catalog) {
        setActiveLedger(null);
        setCatalog(null);
        return;
      }

      const preferred = preferredLedgerId
        ? result.ledgers.find((ledger) => ledger.id === preferredLedgerId)
        : undefined;
      if (preferred && preferred.id !== result.ledger.id) {
        const data = await client.call('openLedger', { ledgerId: preferred.id });
        setActiveLedger(data.ledger);
        setCatalog(data.catalog);
        rememberActiveLedger(data.ledger.id);
        return;
      }

      setActiveLedger(result.ledger);
      setCatalog(result.catalog);
      rememberActiveLedger(result.ledger.id);
    },
    [client],
  );

  const initialize = useCallback(async () => {
    setBooted(false);
    setBootError(null);
    try {
      const result = await client.call('initialize', undefined);
      await applyLedgerSession(result);
    } catch (reason) {
      setBootError(reason instanceof Error ? reason.message : '无法打开本地账本');
    } finally {
      setBooted(true);
    }
  }, [applyLedgerSession, client]);

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
    if (!session || session.status !== 'ready' || sheet || ledgerSheetOpen) return;
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
  }, [session, sheet, ledgerSheetOpen]);

  const handleUnlock = useCallback(
    async (passphrase: string) => {
      const result = await client.call('unlock', { passphrase });
      if (result.status !== 'ready') {
        throw new Error('解锁后未取得账本数据');
      }
      await applyLedgerSession(result);
      setBooted(true);
    },
    [applyLedgerSession, client],
  );

  const handleSessionChange = useCallback(
    (next: InitResult) => {
      void applyLedgerSession(next, activeLedger?.id ?? readActiveLedgerId());
      if (next.status === 'locked') {
        setSheet(null);
        setLedgerSheetOpen(false);
        setTab('ledger');
      }
    },
    [activeLedger?.id, applyLedgerSession],
  );

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

  const handleSelectLedger = useCallback(
    async (ledger: Ledger) => {
      if (ledger.id === activeLedger?.id) return;
      const data = await client.call('openLedger', { ledgerId: ledger.id });
      setActiveLedger(data.ledger);
      setCatalog(data.catalog);
      rememberActiveLedger(data.ledger.id);
      setMonth(currentMonthKey());
      setRevision((value) => value + 1);
      setSheet(null);
      setTab('ledger');
      showToast(`已切换到「${data.ledger.name}」`, 'success');
    },
    [activeLedger?.id, client, showToast],
  );

  const handleCreateLedger = useCallback(
    async (name: string) => {
      const result = await client.call('createLedger', { name });
      setSession(result);
      setLedgers(result.ledgers);
      setActiveLedger(result.ledger);
      setCatalog(result.catalog);
      rememberActiveLedger(result.ledger.id);
      setMonth(currentMonthKey());
      setRevision((value) => value + 1);
      setSheet(null);
      setTab('ledger');
      showToast(`已创建「${result.ledger.name}」`, 'success');
    },
    [client, showToast],
  );

  const handleImportedLedger = useCallback((result: ImportLedgerResult) => {
    setSession((current) =>
      current ? { ...current, ledgers: result.ledgers, ledger: result.ledger, catalog: result.catalog } : current,
    );
    setLedgers(result.ledgers);
    setActiveLedger(result.ledger);
    setCatalog(result.catalog);
    rememberActiveLedger(result.ledger.id);
    setMonth(result.latestMonth ?? currentMonthKey());
    setRevision((value) => value + 1);
    setSheet(null);
    setLedgerSheetOpen(false);
    setTab('ledger');
  }, []);

  const handleRenameLedger = useCallback(
    async (ledger: Ledger, name: string) => {
      const updated = await client.call('updateLedger', { id: ledger.id, name });
      setLedgers((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      if (activeLedger?.id === updated.id) setActiveLedger(updated);
      showToast('账本名称已更新', 'success');
    },
    [activeLedger?.id, client, showToast],
  );

  const handleDeleteLedger = useCallback(
    async (ledger: Ledger) => {
      const result = await client.call('deleteLedger', { id: ledger.id });
      setLedgers(result.ledgers);
      if (activeLedger?.id === ledger.id) {
        const next = result.ledgers[0];
        if (next) {
          const data = await client.call('openLedger', { ledgerId: next.id });
          setActiveLedger(data.ledger);
          setCatalog(data.catalog);
          rememberActiveLedger(data.ledger.id);
        } else {
          setActiveLedger(null);
          setCatalog(null);
        }
        setRevision((value) => value + 1);
        setTab('ledger');
      }
      showToast(`已删除「${ledger.name}」`, 'success');
    },
    [activeLedger?.id, client, showToast],
  );

  const openAdd = useCallback(() => setSheet({ entry: null }), []);
  const openEdit = useCallback((entry: Entry) => setSheet({ entry }), []);

  if (!booted) return <BootScreen />;
  if (bootError) return <BootScreen error={bootError} onRetry={() => window.location.reload()} />;
  if (!session || session.status === 'locked') {
    return <LockScreen onUnlock={handleUnlock} />;
  }
  if (!activeLedger || !catalog) {
    return <BootScreen error="账本未能载入" onRetry={() => window.location.reload()} />;
  }

  const renderPage = () => {
    if (tab === 'ledger') {
      return (
        <LedgerPage
          key={`ledger-${activeLedger.id}`}
          ledgerId={activeLedger.id}
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
      return (
        <StatsPage
          key={`stats-${activeLedger.id}`}
          ledgerId={activeLedger.id}
          month={month}
          revision={revision}
          catalog={catalog}
          onMonthChange={setMonth}
        />
      );
    }
    return (
      <SettingsPage
        key={`settings-${activeLedger.id}`}
        ledgerId={activeLedger.id}
        version={session.version}
        crypto={session.crypto}
        catalog={catalog}
        onCatalogChange={setCatalog}
        onSessionChange={handleSessionChange}
        onDataChanged={handleDataChanged}
        onLedgerImported={handleImportedLedger}
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
        <div className="rail__ledger">
          <LedgerTrigger
            ledger={activeLedger}
            ledgerCount={ledgers.length}
            onOpen={() => setLedgerSheetOpen(true)}
          />
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
          <div className="app-header__actions">
            <LedgerTrigger
              ledger={activeLedger}
              ledgerCount={ledgers.length}
              onOpen={() => setLedgerSheetOpen(true)}
            />
            <span
              className="local-badge local-badge--compact"
              title={session.crypto.enabled ? '本地加密' : '仅本机'}
            >
              <Icon name={session.crypto.enabled ? 'lock' : 'shield'} size={13} />
              <span className="local-badge__text">{session.crypto.enabled ? '本地加密' : '仅本机'}</span>
            </span>
          </div>
        </header>

        <main className="app-content">
          <div className="page-switch" key={tab}>
            <Suspense fallback={<PageSkeleton />}>{renderPage()}</Suspense>
          </div>
        </main>

        <div className="tabbar-wrap">
          <QuickAddFab docked={fabDocked} onDockChange={setFabDocked} onAdd={openAdd} />
          <nav className={`tabbar${fabDocked ? ' tabbar--fab-docked' : ''}`} aria-label="底部导航">
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

      {ledgerSheetOpen ? (
        <LedgerSheet
          ledgers={ledgers}
          activeLedgerId={activeLedger.id}
          onClose={() => setLedgerSheetOpen(false)}
          onSelect={handleSelectLedger}
          onCreate={handleCreateLedger}
          onRename={handleRenameLedger}
          onDelete={handleDeleteLedger}
        />
      ) : null}

      {sheet ? (
        <Suspense fallback={null}>
          <EntrySheet
            key={sheet.entry?.id ?? 'new'}
            ledgerId={activeLedger.id}
            entry={sheet.entry}
            catalog={catalog}
            onClose={() => setSheet(null)}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
          />
        </Suspense>
      ) : null}

      <BackPreview preview={backPreview} />
    </div>
  );
}

export default App;

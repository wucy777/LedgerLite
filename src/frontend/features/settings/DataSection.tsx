import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { Catalog, InitResult } from '@shared/types';
import { getLedgerClient } from '../../api/client';
import { Icon, type UIIconName } from '../../components/Icon';
import { useToast } from '../../components/ToastProvider';
import {
  backupFileName,
  buildCsv,
  csvFileName,
  formatBackupMoment,
  formatBytes,
  readBackupFile,
  saveExportFile,
  type BackupPreview,
} from './backup';
import { Dialog } from './Dialog';
import { friendlyError } from './errors';

interface DataSectionProps {
  ledgerId: string;
  encrypted: boolean;
  onCatalogChange: (catalog: Catalog) => void;
  onSessionChange: (session: InitResult) => void;
  onDataChanged: () => void;
}

interface StorageUsage {
  usage: number;
  quota: number;
}

interface DataRowProps {
  icon: UIIconName;
  title: string;
  description: string;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  trail?: ReactNode;
}

function DataRow({ icon, title, description, busy, disabled, onClick, trail }: DataRowProps) {
  return (
    <button type="button" className="settings-row" onClick={onClick} disabled={disabled || busy}>
      <span className="settings-row__icon" aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <span className="settings-row__copy">
        <span className="settings-row__title">{title}</span>
        <span className="settings-row__desc">{description}</span>
      </span>
      <span className="settings-row__trail" aria-hidden={busy ? undefined : true}>
        {busy ? <Icon name="refresh" size={16} className="spin" /> : (trail ?? <Icon name="chevron-right" size={16} />)}
      </span>
    </button>
  );
}

export function DataSection({ ledgerId, encrypted, onCatalogChange, onSessionChange, onDataChanged }: DataSectionProps) {
  const client = useMemo(() => getLedgerClient(), []);
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [exporting, setExporting] = useState<'json' | 'csv' | null>(null);
  const [fileError, setFileError] = useState('');
  const [importPreview, setImportPreview] = useState<BackupPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPhrase, setResetPhrase] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetting, setResetting] = useState(false);
  const [storage, setStorage] = useState<StorageUsage | null>(null);
  const [storageTick, setStorageTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    try {
      const storageManager = navigator.storage;
      if (!storageManager || typeof storageManager.estimate !== 'function') return;
      storageManager
        .estimate()
        .then((estimate) => {
          if (cancelled) return;
          const usage = typeof estimate.usage === 'number' ? estimate.usage : null;
          if (usage === null) return;
          setStorage({
            usage,
            quota: typeof estimate.quota === 'number' ? estimate.quota : 0,
          });
        })
        .catch(() => {
          // Storage estimate is optional; keep the row hidden when unavailable.
        });
    } catch {
      // Access to the Storage API can be denied; treat it as unavailable.
    }
    return () => {
      cancelled = true;
    };
  }, [storageTick]);

  async function handleExportJson() {
    if (exporting) return;
    setExporting('json');
    try {
      const payload = await client.call('exportBackup', { ledgerId });
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      const outcome = await saveExportFile(blob, backupFileName());
      showToast(outcome === 'shared' ? '备份已生成，请选择保存位置' : 'JSON 备份已导出', 'success');
    } catch (reason) {
      showToast(friendlyError(reason, '导出失败，请重试'), 'error');
    } finally {
      setExporting(null);
    }
  }

  async function handleExportCsv() {
    if (exporting) return;
    setExporting('csv');
    try {
      const payload = await client.call('exportBackup', { ledgerId });
      const blob = new Blob([buildCsv(payload)], { type: 'text/csv;charset=utf-8' });
      const outcome = await saveExportFile(blob, csvFileName());
      showToast(outcome === 'shared' ? '表格已生成，请选择保存位置' : 'CSV 表格已导出', 'success');
    } catch (reason) {
      showToast(friendlyError(reason, '导出失败，请重试'), 'error');
    } finally {
      setExporting(null);
    }
  }

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setFileError('');
    setImportError('');
    try {
      const preview = await readBackupFile(file);
      setImportPreview(preview);
    } catch (reason) {
      setFileError(reason instanceof Error ? reason.message : '无法读取备份文件');
    }
  }

  function closeImportDialog() {
    setImportPreview(null);
    setImportError('');
  }

  async function handleImport() {
    if (!importPreview || importing) return;
    setImporting(true);
    setImportError('');
    try {
      const result = await client.call('importBackup', { ledgerId, backup: importPreview.backup });
      onCatalogChange(result.catalog);
      onDataChanged();
      setStorageTick((value) => value + 1);
      showToast(`已导入 ${result.entryCount} 条记录`, 'success');
      closeImportDialog();
    } catch (reason) {
      setImportError(friendlyError(reason, '导入失败，请检查备份文件'));
    } finally {
      setImporting(false);
    }
  }

  function closeResetDialog() {
    setResetOpen(false);
    setResetPhrase('');
    setResetError('');
  }

  async function handleReset(event: FormEvent) {
    event.preventDefault();
    if (resetting) return;
    if (resetPhrase.trim() !== '清空') {
      setResetError('请输入“清空”以确认');
      return;
    }
    setResetting(true);
    setResetError('');
    try {
      const result = await client.call('resetAll', undefined);
      onSessionChange(result);
      onDataChanged();
      setStorageTick((value) => value + 1);
      showToast('已清空全部数据', 'success');
      closeResetDialog();
    } catch (reason) {
      setResetError(friendlyError(reason, '清空失败，请重试'));
    } finally {
      setResetting(false);
    }
  }

  const usagePercent =
    storage && storage.quota > 0 ? Math.min(100, Math.max(0, (storage.usage / storage.quota) * 100)) : null;

  return (
    <section className="settings-section" aria-labelledby="settings-data-heading">
      <div className="settings-section__head">
        <h2 id="settings-data-heading">数据管理</h2>
        <span>备份与恢复</span>
      </div>

      <div className="settings-card">
        <div className="settings-rows">
          <DataRow
            icon="download"
            title="导出 JSON 备份"
            description="当前账本的完整记录、分类与账户"
            busy={exporting === 'json'}
            disabled={exporting !== null}
            onClick={() => void handleExportJson()}
          />
          <DataRow
            icon="download"
            title="导出 CSV 表格"
            description="当前账本记录，可用表格软件打开"
            busy={exporting === 'csv'}
            disabled={exporting !== null}
            onClick={() => void handleExportCsv()}
          />
          <DataRow
            icon="upload"
            title="导入 JSON 备份"
            description="从备份文件恢复，覆盖当前账本"
            disabled={importing || exporting !== null}
            onClick={() => fileInputRef.current?.click()}
          />
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => void handleFileSelected(event)}
        />

        {fileError ? (
          <p className="settings-inline-error" role="alert">
            <Icon name="alert" size={14} />
            {fileError}
          </p>
        ) : null}

        {encrypted ? (
          <p className="settings-export-note">
            <Icon name="info" size={13} />
            加密账本导出的 JSON 与 CSV 备份为明文文件，请妥善保管。
          </p>
        ) : null}

        {storage ? (
          <div className="settings-storage">
            <div className="settings-storage__top">
              <span>本地存储占用</span>
              <span className="num">{formatBytes(storage.usage)}</span>
            </div>
            {usagePercent !== null ? (
              <div className="settings-storage__track" aria-hidden="true">
                <span style={{ width: `${usagePercent}%` }} />
              </div>
            ) : null}
            <p className="settings-storage__caption">
              {storage.quota > 0
                ? `浏览器可用配额 ${formatBytes(storage.quota)}`
                : '由浏览器管理存储空间'}
            </p>
          </div>
        ) : null}

        <div className="settings-danger">
          <div className="settings-danger__copy">
            <span className="settings-danger__title">清空全部数据</span>
            <span className="settings-danger__desc">删除所有记录与自定义分类、账户，并关闭加密。</span>
          </div>
          <button type="button" className="settings-danger__button" onClick={() => setResetOpen(true)}>
            清空全部数据
          </button>
        </div>
      </div>

      {importPreview ? (
        <Dialog
          title="导入备份"
          eyebrow="将覆盖当前数据"
          icon="upload"
          size="md"
          dismissOnBackdrop={!importing}
          onClose={closeImportDialog}
          footer={
            <>
              <button
                type="button"
                className="secondary-button"
                onClick={closeImportDialog}
                disabled={importing}
                data-autofocus
              >
                取消
              </button>
              <button type="button" className="primary-button" onClick={() => void handleImport()} disabled={importing}>
                {importing ? (
                  <>
                    <Icon name="refresh" size={16} className="spin" />
                    正在导入
                  </>
                ) : (
                  '导入并覆盖'
                )}
              </button>
            </>
          }
        >
          <dl className="settings-import-summary">
            <div>
              <dt>记录</dt>
              <dd className="num">{importPreview.entryCount}</dd>
            </div>
            <div>
              <dt>分类</dt>
              <dd className="num">{importPreview.categoryCount}</dd>
            </div>
            <div>
              <dt>账户</dt>
              <dd className="num">{importPreview.accountCount}</dd>
            </div>
          </dl>
          {importPreview.exportedAt ? (
            <p className="settings-meta">
              导出时间：{formatBackupMoment(importPreview.exportedAt)}
              {importPreview.version ? ` · 版本 ${importPreview.version}` : ''}
            </p>
          ) : null}
          <div className="settings-warning">
            <Icon name="alert" size={16} />
            <p>导入会替换当前账本的全部记录、分类与账户，且无法撤销。其他账本不受影响；建议先导出当前账本备份。</p>
          </div>
          {importError ? (
            <p className="settings-field__error" role="alert">
              {importError}
            </p>
          ) : null}
        </Dialog>
      ) : null}

      {resetOpen ? (
        <Dialog
          title="清空全部数据"
          eyebrow="不可撤销"
          tone="danger"
          icon="alert"
          dismissOnBackdrop={!resetting}
          onClose={closeResetDialog}
          footer={
            <>
              <button type="button" className="secondary-button" onClick={closeResetDialog} disabled={resetting}>
                取消
              </button>
              <button
                type="submit"
                form="settings-reset-all"
                className="danger-button"
                disabled={resetting || resetPhrase.trim() !== '清空'}
              >
                {resetting ? (
                  <>
                    <Icon name="refresh" size={16} className="spin" />
                    正在清空
                  </>
                ) : (
                  '确认清空'
                )}
              </button>
            </>
          }
        >
          <div className="settings-warning">
            <Icon name="alert" size={16} />
            <p>
              将删除所有记账记录、自定义分类与账户，并关闭加密。此操作无法撤销，建议先导出备份。
            </p>
          </div>
          <form id="settings-reset-all" onSubmit={handleReset}>
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="settings-reset-confirmation">
                输入“清空”以确认
              </label>
              <span className={`settings-input${resetError ? ' has-error' : ''}`}>
                <Icon name="trash" size={16} />
                <input
                  id="settings-reset-confirmation"
                  type="text"
                  value={resetPhrase}
                  onChange={(event) => {
                    setResetPhrase(event.target.value);
                    if (resetError) setResetError('');
                  }}
                  placeholder="清空"
                  autoComplete="off"
                  data-autofocus
                />
              </span>
            </div>
            {resetError ? (
              <p className="settings-field__error" role="alert">
                {resetError}
              </p>
            ) : null}
          </form>
        </Dialog>
      ) : null}
    </section>
  );
}

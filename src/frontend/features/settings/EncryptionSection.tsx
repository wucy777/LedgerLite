import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import type { CryptoState, InitResult } from '@shared/types';
import { getLedgerClient } from '../../api/client';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/ToastProvider';
import { Dialog } from './Dialog';
import { friendlyError } from './errors';

interface EncryptionSectionProps {
  crypto: CryptoState;
  onSessionChange: (session: InitResult) => void;
  onLock: () => Promise<void>;
}

export function EncryptionSection({ crypto, onSessionChange, onLock }: EncryptionSectionProps) {
  const client = useMemo(() => getLedgerClient(), []);
  const { showToast } = useToast();
  const enabled = crypto.enabled;
  const enablePassId = useId();
  const confirmPassId = useId();
  const disablePassId = useId();

  const [mode, setMode] = useState<'idle' | 'enable'>('idle');
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [locking, setLocking] = useState(false);
  const [lockError, setLockError] = useState('');

  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassphrase, setDisablePassphrase] = useState('');
  const [disableVisible, setDisableVisible] = useState(false);
  const [disableError, setDisableError] = useState('');
  const [disabling, setDisabling] = useState(false);

  useEffect(() => {
    if (enabled) {
      setMode('idle');
      setPassphrase('');
      setConfirmation('');
      setFormError('');
      setVisible(false);
      setConfirmationVisible(false);
    } else {
      setDisableOpen(false);
      setDisablePassphrase('');
      setDisableError('');
    }
  }, [enabled]);

  function resetEnableForm() {
    setMode('idle');
    setPassphrase('');
    setConfirmation('');
    setFormError('');
    setVisible(false);
    setConfirmationVisible(false);
  }

  async function handleEnable(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    if (Array.from(passphrase).length < 8) {
      setFormError('口令至少需要 8 个字符');
      return;
    }
    if (!passphrase.trim()) {
      setFormError('口令不能只包含空格');
      return;
    }
    if (passphrase !== confirmation) {
      setFormError('两次输入的口令不一致');
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      const result = await client.call('enableEncryption', { passphrase });
      onSessionChange(result);
      showToast('已启用本地加密', 'success');
      resetEnableForm();
    } catch (reason) {
      setFormError(friendlyError(reason, '启用加密失败，请重试'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLock() {
    if (locking) return;
    setLocking(true);
    setLockError('');
    try {
      await onLock();
    } catch (reason) {
      const message = friendlyError(reason, '锁定失败，请重试');
      setLockError(message);
      showToast(message, 'error');
      setLocking(false);
    }
  }

  function closeDisableDialog() {
    setDisableOpen(false);
    setDisablePassphrase('');
    setDisableError('');
    setDisableVisible(false);
  }

  async function handleDisable(event: FormEvent) {
    event.preventDefault();
    if (disabling) return;
    if (!disablePassphrase) {
      setDisableError('请输入当前口令');
      return;
    }
    setDisabling(true);
    setDisableError('');
    try {
      const result = await client.call('disableEncryption', { passphrase: disablePassphrase });
      onSessionChange(result);
      showToast('已关闭加密，数据改为明文保存', 'success');
      closeDisableDialog();
    } catch (reason) {
      setDisableError(friendlyError(reason, '关闭加密失败，请重试'));
    } finally {
      setDisabling(false);
    }
  }

  return (
    <section className="settings-section" aria-labelledby="settings-security-heading">
      <div className="settings-section__head">
        <h2 id="settings-security-heading">数据安全</h2>
        <span>加密与访问</span>
      </div>

      <div className={`settings-vault${enabled ? ' is-encrypted' : ''}`}>
        <div className="settings-vault__glow" aria-hidden="true" />
        <div className="settings-vault__head">
          <span className="settings-vault__icon" aria-hidden="true">
            <Icon name={enabled ? 'lock' : 'unlock'} size={21} />
          </span>
          <div className="settings-vault__copy">
            <p className="settings-vault__eyebrow">本地加密</p>
            <h3>{enabled ? '加密已开启' : '加密未开启'}</h3>
            <p className="settings-vault__lead">
              {enabled
                ? '账本数据以密文保存在本机。锁定后需要输入口令才能再次打开。'
                : '开启后，账本数据将以密文保存在本机，只有输入口令才能读取。'}
            </p>
          </div>
          <span className="settings-vault__status">
            <span className="settings-vault__dot" aria-hidden="true" />
            {enabled ? '已加密' : '未加密'}
          </span>
        </div>

        {!enabled && mode === 'enable' ? (
          <form className="settings-vault__form" onSubmit={handleEnable} aria-label="启用本地加密">
            <div className="settings-vault__fields">
              <div className="settings-vault__field">
                <label className="settings-vault__label" htmlFor={enablePassId}>
                  设置口令
                </label>
                <span className="settings-vault__input">
                  <Icon name="lock" size={16} />
                  <input
                    id={enablePassId}
                    type={visible ? 'text' : 'password'}
                    value={passphrase}
                    onChange={(event) => {
                      setPassphrase(event.target.value);
                      if (formError) setFormError('');
                    }}
                    autoComplete="new-password"
                    placeholder="至少 8 个字符"
                    maxLength={128}
                    data-autofocus
                  />
                  <button
                    type="button"
                    className="settings-vault__reveal"
                    aria-label={visible ? '隐藏口令' : '显示口令'}
                    onClick={() => setVisible((current) => !current)}
                  >
                    <Icon name={visible ? 'eye-off' : 'eye'} size={17} />
                  </button>
                </span>
              </div>
              <div className="settings-vault__field">
                <label className="settings-vault__label" htmlFor={confirmPassId}>
                  确认口令
                </label>
                <span className="settings-vault__input">
                  <Icon name="shield" size={16} />
                  <input
                    id={confirmPassId}
                    type={confirmationVisible ? 'text' : 'password'}
                    value={confirmation}
                    onChange={(event) => {
                      setConfirmation(event.target.value);
                      if (formError) setFormError('');
                    }}
                    autoComplete="new-password"
                    placeholder="再次输入口令"
                    maxLength={128}
                  />
                  <button
                    type="button"
                    className="settings-vault__reveal"
                    aria-label={confirmationVisible ? '隐藏确认口令' : '显示确认口令'}
                    onClick={() => setConfirmationVisible((current) => !current)}
                  >
                    <Icon name={confirmationVisible ? 'eye-off' : 'eye'} size={17} />
                  </button>
                </span>
              </div>
            </div>
            {formError ? (
              <p className="settings-vault__error" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="settings-vault__actions">
              <button type="submit" className="settings-vault__primary" disabled={submitting}>
                {submitting ? (
                  <>
                    <Icon name="refresh" size={16} className="spin" />
                    正在启用
                  </>
                ) : (
                  '启用加密'
                )}
              </button>
              <button type="button" className="settings-vault__ghost" onClick={resetEnableForm} disabled={submitting}>
                取消
              </button>
            </div>
            <p className="settings-vault__hint">
              <Icon name="info" size={13} />
              口令至少 8 个字符，且无法找回。忘记口令将无法解密本机数据，请妥善保管。
            </p>
          </form>
        ) : (
          <>
            <div className="settings-vault__actions">
              {enabled ? (
                <button type="button" className="settings-vault__primary" onClick={() => void handleLock()} disabled={locking}>
                  {locking ? (
                    <>
                      <Icon name="refresh" size={16} className="spin" />
                      正在锁定
                    </>
                  ) : (
                    <>
                      <Icon name="lock" size={16} />
                      立即锁定
                    </>
                  )}
                </button>
              ) : (
                <button type="button" className="settings-vault__primary" onClick={() => setMode('enable')}>
                  <Icon name="lock" size={16} />
                  启用加密
                </button>
              )}
              {enabled ? (
                <button type="button" className="settings-vault__ghost" onClick={() => setDisableOpen(true)}>
                  关闭加密
                </button>
              ) : null}
            </div>
            {lockError ? (
              <p className="settings-vault__error" role="alert">
                {lockError}
              </p>
            ) : null}
            <p className="settings-vault__hint">
              <Icon name="info" size={13} />
              {enabled
                ? '口令只在本机用于派生密钥，不会离开设备。'
                : '数据只写入本机存储，不会同步或上传。'}
            </p>
          </>
        )}
      </div>

      {disableOpen ? (
        <Dialog
          title="关闭加密"
          eyebrow="安全状态变更"
          tone="danger"
          icon="unlock"
          onClose={closeDisableDialog}
          dismissOnBackdrop={!disabling}
          footer={
            <>
              <button type="button" className="secondary-button" onClick={closeDisableDialog} disabled={disabling}>
                取消
              </button>
              <button
                type="submit"
                form="settings-disable-encryption"
                className="danger-button"
                disabled={disabling || !disablePassphrase}
              >
                {disabling ? (
                  <>
                    <Icon name="refresh" size={16} className="spin" />
                    正在关闭
                  </>
                ) : (
                  '关闭加密'
                )}
              </button>
            </>
          }
        >
          <div className="settings-warning">
            <Icon name="alert" size={16} />
            <p>
              关闭后，全部账本数据将以<strong>明文</strong>保存在本机。任何能访问此设备存储的人都可以读取数据。
            </p>
          </div>
          <form id="settings-disable-encryption" onSubmit={handleDisable}>
            <div className="settings-field">
              <label className="settings-field__label" htmlFor={disablePassId}>
                当前口令
              </label>
              <span className={`settings-input${disableError ? ' has-error' : ''}`}>
                <Icon name="lock" size={16} />
                <input
                  id={disablePassId}
                  type={disableVisible ? 'text' : 'password'}
                  value={disablePassphrase}
                  onChange={(event) => {
                    setDisablePassphrase(event.target.value);
                    if (disableError) setDisableError('');
                  }}
                  autoComplete="current-password"
                  placeholder="输入当前加密口令"
                  maxLength={128}
                  data-autofocus
                />
                <button
                  type="button"
                  className="settings-input__action"
                  aria-label={disableVisible ? '隐藏口令' : '显示口令'}
                  onClick={() => setDisableVisible((current) => !current)}
                >
                  <Icon name={disableVisible ? 'eye-off' : 'eye'} size={17} />
                </button>
              </span>
            </div>
            {disableError ? (
              <p className="settings-field__error" role="alert">
                {disableError}
              </p>
            ) : null}
          </form>
          <p className="settings-note">
            <Icon name="info" size={14} />
            关闭加密不会删除任何记录，可随时重新启用。
          </p>
        </Dialog>
      ) : null}
    </section>
  );
}

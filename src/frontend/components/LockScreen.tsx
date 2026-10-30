import { useState, type FormEvent } from 'react';
import { BrandMark } from './BrandMark';
import { Icon } from './Icon';

interface LockScreenProps {
  onUnlock: (passphrase: string) => Promise<void>;
}

export function LockScreen({ onUnlock }: LockScreenProps) {
  const [passphrase, setPassphrase] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!passphrase.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await onUnlock(passphrase);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '解锁失败');
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-screen__halo" aria-hidden="true" />
      <div className="auth-panel page-switch">
        <div className="auth-panel__brand">
          <BrandMark size={58} />
          <div>
            <div className="auth-panel__name">简账</div>
            <div className="auth-panel__eyebrow">本地加密账本</div>
          </div>
        </div>
        <div className="auth-panel__icon">
          <Icon name="lock" size={22} />
        </div>
        <h1>账本已锁定</h1>
        <p className="auth-panel__lead">
          数据只保存在当前设备。输入口令后在本地解密，口令不会离开设备。
        </p>
        <form onSubmit={handleSubmit} className="auth-form">
          <label className="field-label" htmlFor="unlock-passphrase">
            解锁口令
          </label>
          <div className={`input-shell ${error ? 'has-error' : ''}`}>
            <Icon name="shield" size={18} />
            <input
              id="unlock-passphrase"
              type={visible ? 'text' : 'password'}
              value={passphrase}
              onChange={(event) => {
                setPassphrase(event.target.value);
                if (error) setError('');
              }}
              autoComplete="current-password"
              placeholder="输入加密口令"
              autoFocus
            />
            <button
              type="button"
              className="input-shell__action"
              aria-label={visible ? '隐藏口令' : '显示口令'}
              onClick={() => setVisible((current) => !current)}
            >
              <Icon name={visible ? 'eye-off' : 'eye'} size={18} />
            </button>
          </div>
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="primary-button auth-form__submit" disabled={submitting || !passphrase.trim()}>
            {submitting ? (
              <>
                <Icon name="refresh" size={17} className="spin" />
                正在解密
              </>
            ) : (
              '解锁账本'
            )}
          </button>
        </form>
        <p className="auth-panel__note">
          <Icon name="info" size={14} />
          口令无法找回。请妥善保存；忘记口令将无法读取本机数据。
        </p>
      </div>
    </div>
  );
}

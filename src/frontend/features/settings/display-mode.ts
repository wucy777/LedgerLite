import { useCallback, useEffect, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';

interface DisplayModePlugin {
  setHighRefreshRate(options: { enabled: boolean }): Promise<{ refreshRate?: number; supported?: boolean }>;
}

const DisplayMode = registerPlugin<DisplayModePlugin>('DisplayMode');

const STORAGE_KEY = 'ledgerlite.ui.highRefresh';
const ROOT_CLASS = 'is-high-refresh';

function readPreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function applyClass(enabled: boolean): void {
  document.documentElement.classList.toggle(ROOT_CLASS, enabled);
}

/** Applies the motion profile on boot so the first paint already matches the setting. */
export function bootstrapHighRefresh(): void {
  applyClass(readPreference());
}

/**
 * Prefers the display's fastest mode on supported Android devices and switches
 * the CSS motion profile so transitions stay smooth on 120 Hz panels.
 */
export function useHighRefreshPreference() {
  const [enabled, setEnabled] = useState(readPreference);
  const [supported, setSupported] = useState(Capacitor.isNativePlatform());

  useEffect(() => {
    applyClass(enabled);
    try {
      window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    } catch {
      /* The preference is optional when storage is unavailable. */
    }
    if (!Capacitor.isNativePlatform()) return;
    void DisplayMode.setHighRefreshRate({ enabled })
      .then((result) => {
        if (result && typeof result.supported === 'boolean') setSupported(result.supported);
      })
      .catch(() => {
        // Older builds without the native plugin keep the CSS-only profile.
      });
  }, [enabled]);

  const toggle = useCallback(() => setEnabled((current) => !current), []);

  return { enabled, supported, toggle };
}

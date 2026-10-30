import { useCallback, useEffect, useRef, useState } from 'react';

export type AsyncStatus = 'loading' | 'ready' | 'error';

export interface AsyncResource<T> {
  data: T | null;
  status: AsyncStatus;
  error: string | null;
  reload: () => void;
}

/**
 * Runs a request whenever dependencies change, ignoring stale completions.
 * The previous value stays visible while a new request is in flight.
 */
export function useAsyncResource<T>(
  load: () => Promise<T>,
  deps: ReadonlyArray<unknown>,
): AsyncResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<AsyncStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const requestId = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const current = ++requestId.current;
    setStatus('loading');
    setError(null);
    loadRef
      .current()
      .then((result) => {
        if (current !== requestId.current) return;
        setData(result);
        setStatus('ready');
      })
      .catch((reason: unknown) => {
        if (current !== requestId.current) return;
        setError(reason instanceof Error ? reason.message : '加载失败');
        setStatus('error');
      });
    return () => {
      requestId.current += 1;
    };
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { data, status, error, reload };
}

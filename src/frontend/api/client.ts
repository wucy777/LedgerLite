import {
  LedgerError,
  type RpcRequest,
  type RpcResponse,
  type StorageApi,
  type StorageMethod,
} from '@shared/types';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export class LedgerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private disposed = false;
  private workerFailure: LedgerError | null = null;

  constructor() {
    this.worker = new Worker(new URL('../../backend/storage.worker.ts', import.meta.url), {
      type: 'module',
      name: 'ledger-storage',
    });
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleWorkerError);
  }

  call<K extends StorageMethod>(
    method: K,
    params: StorageApi[K]['params'],
  ): Promise<StorageApi[K]['result']> {
    if (this.disposed) {
      return Promise.reject(new LedgerError('INTERNAL', '数据服务已关闭'));
    }
    if (this.workerFailure) {
      return Promise.reject(this.workerFailure);
    }

    const id = this.nextId++;
    return new Promise<StorageApi[K]['result']>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      const request = { id, method, params } as RpcRequest;
      try {
        this.worker.postMessage(request);
      } catch (error) {
        this.pending.delete(id);
        reject(new LedgerError('INTERNAL', error instanceof Error ? error.message : '数据服务不可用'));
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.removeEventListener('message', this.handleMessage);
    this.worker.removeEventListener('error', this.handleWorkerError);
    this.worker.terminate();
    for (const request of this.pending.values()) {
      request.reject(new LedgerError('INTERNAL', '数据服务已关闭'));
    }
    this.pending.clear();
  }

  private readonly handleMessage = (event: MessageEvent<RpcResponse>): void => {
    const response = event.data;
    if (!response || typeof response.id !== 'number') return;
    const request = this.pending.get(response.id);
    if (!request) return;
    this.pending.delete(response.id);

    if (response.ok) {
      request.resolve(response.result);
    } else {
      request.reject(new LedgerError(response.error.code, response.error.message));
    }
  };

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    const error = new LedgerError('INTERNAL', event.message || '本地数据服务意外停止');
    this.workerFailure = error;
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  };
}

let sharedClient: LedgerClient | null = null;

export function getLedgerClient(): LedgerClient {
  sharedClient ??= new LedgerClient();
  return sharedClient;
}

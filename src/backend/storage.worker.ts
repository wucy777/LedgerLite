import { LedgerError, type RpcRequest, type RpcResponse, type SerializedError } from '../shared/types';
import { LedgerEngine } from './engine';

const engine = new LedgerEngine();
const scope = self as unknown as DedicatedWorkerGlobalScope;

function serializeError(error: unknown): SerializedError {
  if (error instanceof LedgerError) return { code: error.code, message: error.message };
  return { code: 'INTERNAL', message: '服务内部错误' };
}

async function dispatch(request: RpcRequest): Promise<unknown> {
  switch (request.method) {
    case 'initialize':
      return engine.initialize();
    case 'unlock':
      return engine.unlock(request.params.passphrase);
    case 'lock':
      return engine.lock();
    case 'enableEncryption':
      return engine.enableEncryption(request.params.passphrase);
    case 'disableEncryption':
      return engine.disableEncryption(request.params.passphrase);
    case 'listMonth':
      return engine.listMonth(request.params);
    case 'getStats':
      return engine.getStats(request.params.month);
    case 'saveEntry':
      return engine.saveEntry(request.params);
    case 'deleteEntry':
      return engine.deleteEntry(request.params.id);
    case 'addCategory':
      return engine.addCategory(request.params);
    case 'updateCategory':
      return engine.updateCategory(request.params.id, request.params.patch);
    case 'addAccount':
      return engine.addAccount(request.params);
    case 'updateAccount':
      return engine.updateAccount(request.params.id, request.params.patch);
    case 'exportBackup':
      return engine.exportBackup();
    case 'importBackup':
      return engine.importBackup(request.params.backup);
    case 'resetAll':
      return engine.resetAll();
    default:
      throw new LedgerError('UNSUPPORTED', '不支持的操作');
  }
}

async function handle(request: RpcRequest): Promise<void> {
  try {
    const result = await dispatch(request);
    scope.postMessage({ id: request.id, ok: true, result } satisfies RpcResponse);
  } catch (error) {
    scope.postMessage({ id: request.id, ok: false, error: serializeError(error) } satisfies RpcResponse);
  }
}

scope.onmessage = (event: MessageEvent<RpcRequest>) => {
  void handle(event.data);
};

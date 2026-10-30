import { LedgerError } from '../shared/types';

export const PBKDF2_ITERATIONS = 310_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;

export const CATALOG_AAD = 'ledgerlite.catalog.v1';
export const ENCRYPTED_BACKUP_AAD = 'ledgerlite.encrypted-backup.v1';
const VERIFIER_AAD = 'ledgerlite.verifier.v1';
const VERIFIER_PLAINTEXT = 'ledgerlite.verifier.v1';
const AES_INFO = 'ledgerlite/aes-gcm-256/v1';
const MAC_INFO = 'ledgerlite/hmac-sha256/v1';

export interface CryptoKeys {
  aesKey: CryptoKey;
  macKey: CryptoKey;
}

export interface EncryptedBlob {
  iv: ArrayBuffer;
  data: ArrayBuffer;
}

export interface Verifier {
  iv: ArrayBuffer;
  data: ArrayBuffer;
}

function getCrypto(): Crypto {
  const webCrypto = globalThis.crypto;
  if (!webCrypto || !webCrypto.subtle) {
    throw new LedgerError('CRYPTO_UNAVAILABLE', '当前环境不支持加密');
  }
  return webCrypto;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeText(text: string): ArrayBuffer {
  return encoder.encode(text).buffer;
}

export function randomBytes(length: number): ArrayBuffer {
  const bytes = new Uint8Array(length);
  getCrypto().getRandomValues(bytes);
  return bytes.buffer;
}

export function randomHex(byteLength: number): string {
  let hex = '';
  for (const byte of new Uint8Array(randomBytes(byteLength))) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Base64 helpers are only used by the portable encrypted-backup envelope. */
export function bytesToBase64(value: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(value)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function base64ToBytes(value: unknown): ArrayBuffer {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    throw new LedgerError('IMPORT_INVALID', '备份文件格式无效');
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new LedgerError('IMPORT_INVALID', '备份文件格式无效');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

/** PBKDF2-SHA256 stretches the passphrase, HKDF splits it into independent AES and MAC keys. */
export async function deriveKeys(passphrase: string, salt: ArrayBuffer): Promise<CryptoKeys> {
  const subtle = getCrypto().subtle;
  const passwordKey = await subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  const masterBits = await subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    passwordKey,
    256,
  );
  const masterKey = await subtle.importKey('raw', masterBits, 'HKDF', false, ['deriveBits']);
  const [aesBits, macBits] = await Promise.all([
    subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode(AES_INFO) },
      masterKey,
      256,
    ),
    subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode(MAC_INFO) },
      masterKey,
      256,
    ),
  ]);
  const [aesKey, macKey] = await Promise.all([
    subtle.importKey('raw', aesBits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']),
    subtle.importKey('raw', macBits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
  ]);
  return { aesKey, macKey };
}

export async function hmacHex(keys: CryptoKeys, value: string): Promise<string> {
  const signature = await getCrypto().subtle.sign('HMAC', keys.macKey, encoder.encode(value));
  let hex = '';
  for (const byte of new Uint8Array(signature)) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

export async function encryptBlob(keys: CryptoKeys, plaintext: ArrayBuffer, aad: string): Promise<EncryptedBlob> {
  const iv = randomBytes(IV_BYTES);
  const data = await getCrypto().subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(aad) },
    keys.aesKey,
    plaintext,
  );
  return { iv, data };
}

export async function decryptBlob(keys: CryptoKeys, blob: EncryptedBlob, aad: string): Promise<ArrayBuffer> {
  const subtle = getCrypto().subtle;
  try {
    return await subtle.decrypt(
      { name: 'AES-GCM', iv: blob.iv, additionalData: encoder.encode(aad) },
      keys.aesKey,
      blob.data,
    );
  } catch {
    throw new LedgerError('INVALID_PASSPHRASE', '口令错误或数据已损坏');
  }
}

export function entryAad(id: string, monthTag: string): string {
  return `ledgerlite.entry.v1|${id}|${monthTag}`;
}

export async function encryptJson(keys: CryptoKeys, value: unknown, aad: string): Promise<EncryptedBlob> {
  return encryptBlob(keys, encodeText(JSON.stringify(value)), aad);
}

export async function decryptJson<T>(keys: CryptoKeys, blob: EncryptedBlob, aad: string): Promise<T> {
  const plaintext = await decryptBlob(keys, blob, aad);
  try {
    return JSON.parse(decoder.decode(plaintext)) as T;
  } catch {
    throw new LedgerError('INVALID_PASSPHRASE', '口令错误或数据已损坏');
  }
}

export async function createVerifier(keys: CryptoKeys): Promise<Verifier> {
  return encryptBlob(keys, encodeText(VERIFIER_PLAINTEXT), VERIFIER_AAD);
}

export async function verifyVerifier(keys: CryptoKeys, verifier: Verifier): Promise<boolean> {
  try {
    const plaintext = await decryptBlob(keys, verifier, VERIFIER_AAD);
    return decoder.decode(plaintext) === VERIFIER_PLAINTEXT;
  } catch {
    return false;
  }
}

import { app, safeStorage } from 'electron';
import ConfigService from 'config/ConfigService';
import { planTokenRead, planTokenWrite, TokenCrypto } from './secretLogic';

/**
 * [RoomFortyRecorder] The one place the Discord session token is read or
 * written. Encrypted at rest with Electron safeStorage (DPAPI on Windows);
 * falls back to the plain config key if encryption isn't available.
 * safeStorage needs the app to be ready, so every call waits for that.
 */

const crypto: TokenCrypto = {
  encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
  decrypt: (base64) => safeStorage.decryptString(Buffer.from(base64, 'base64')),
};

let warnedUnavailable = false;

const available = (): boolean => {
  let ok = false;
  try {
    ok = safeStorage.isEncryptionAvailable();
  } catch {
    ok = false;
  }
  if (!ok && !warnedUnavailable) {
    warnedUnavailable = true;
    console.warn(
      '[SecretStore] Encryption is not available; the session is stored unencrypted',
    );
  }
  return ok;
};

export const getSessionToken = async (): Promise<string> => {
  await app.whenReady();
  const cfg = ConfigService.getInstance();
  const plan = planTokenRead(
    {
      plain: cfg.get<string>('cloudSessionToken') || '',
      enc: cfg.get<string>('cloudSessionTokenEnc') || '',
    },
    available(),
    crypto,
  );

  if (plan.note) console.warn(`[SecretStore] ${plan.note}`);

  if (plan.write) {
    Object.entries(plan.write).forEach(([key, value]) => {
      cfg.set(key as 'cloudSessionToken' | 'cloudSessionTokenEnc', value);
    });
    console.info('[SecretStore] Session token storage updated');
  }

  return plan.token;
};

export const setSessionToken = async (token: string): Promise<void> => {
  await app.whenReady();
  const cfg = ConfigService.getInstance();
  const values = planTokenWrite(token, token ? available() : true, crypto);
  cfg.set('cloudSessionToken', values.cloudSessionToken);
  cfg.set('cloudSessionTokenEnc', values.cloudSessionTokenEnc);
};

export const clearSessionToken = (): Promise<void> => setSessionToken('');

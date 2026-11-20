/**
 * [RoomFortyRecorder] Pure decisions for storing the Discord session token
 * encrypted at rest (Electron safeStorage). The Electron calls live in
 * secretStore.ts; this has no Electron imports so it can be unit tested.
 */

export type TokenFields = {
  /** Legacy plain-text value (`cloudSessionToken`). */
  plain: string;
  /** base64 of safeStorage.encryptString (`cloudSessionTokenEnc`). */
  enc: string;
};

export type TokenCrypto = {
  encrypt: (text: string) => string; // returns base64
  decrypt: (base64: string) => string; // throws if it can't
};

export type TokenReadPlan = {
  token: string;
  /** Config values to write back, if any. */
  write?: Partial<{ cloudSessionToken: string; cloudSessionTokenEnc: string }>;
  /** Something worth logging (never the token). */
  note?: string;
};

/**
 * What to return for a read, and what to store. Migrates a plain token to
 * the encrypted key the first time encryption is available.
 */
export const planTokenRead = (
  fields: TokenFields,
  available: boolean,
  crypto: TokenCrypto,
): TokenReadPlan => {
  const { plain, enc } = fields;

  if (!available) {
    return {
      token: plain,
      note: enc
        ? 'Encryption is not available; the stored session cannot be read.'
        : undefined,
    };
  }

  let note: string | undefined;

  if (enc) {
    try {
      const token = crypto.decrypt(enc);
      if (token) {
        // Drop any leftover plain copy.
        return plain ? { token, write: { cloudSessionToken: '' } } : { token };
      }
    } catch {
      note = 'The stored session could not be decrypted.';
    }
  }

  if (plain) {
    try {
      return {
        token: plain,
        write: {
          cloudSessionTokenEnc: crypto.encrypt(plain),
          cloudSessionToken: '',
        },
        note,
      };
    } catch {
      return { token: plain, note: 'Could not encrypt the session token.' };
    }
  }

  return { token: '', note };
};

/** What to store when the token is set (or cleared with an empty string). */
export const planTokenWrite = (
  token: string,
  available: boolean,
  crypto: TokenCrypto,
): { cloudSessionToken: string; cloudSessionTokenEnc: string } => {
  if (!token) return { cloudSessionToken: '', cloudSessionTokenEnc: '' };

  if (available) {
    try {
      return {
        cloudSessionToken: '',
        cloudSessionTokenEnc: crypto.encrypt(token),
      };
    } catch {
      // fall through to plain
    }
  }

  return { cloudSessionToken: token, cloudSessionTokenEnc: '' };
};

import {
  isSecretKey,
  redactForLog,
  rendererMayWrite,
  valueForRenderer,
} from '../../config/secretKeys';
import { planTokenRead, planTokenWrite } from '../../main/secretLogic';

const crypto = {
  encrypt: (t: string) => `enc(${t})`,
  decrypt: (b: string) => {
    if (!b.startsWith('enc(')) throw new Error('bad');
    return b.slice(4, -1);
  },
};

describe('secret keys', () => {
  it('flags both token keys only', () => {
    expect(isSecretKey('cloudSessionToken')).toBe(true);
    expect(isSecretKey('cloudSessionTokenEnc')).toBe(true);
    expect(isSecretKey('cloudDiscordName')).toBe(false);
    expect(isSecretKey(undefined)).toBe(false);
  });

  it('hides values and blocks writes from the renderer', () => {
    expect(valueForRenderer('cloudSessionToken', 'abc')).toBe('');
    expect(valueForRenderer('storagePath', 'C:\\x')).toBe('C:\\x');
    expect(rendererMayWrite('cloudSessionTokenEnc')).toBe(false);
    expect(rendererMayWrite('storagePath')).toBe(true);
  });

  it('redacts for logs without mutating', () => {
    const cfg = { cloudSessionToken: 'abc', cloudSessionTokenEnc: '', a: 1 };
    expect(redactForLog(cfg)).toEqual({
      cloudSessionToken: '**********',
      cloudSessionTokenEnc: '',
      a: 1,
    });
    expect(cfg.cloudSessionToken).toBe('abc');
  });
});

describe('planTokenRead', () => {
  it('migrates a plain token', () => {
    const plan = planTokenRead({ plain: 'tok', enc: '' }, true, crypto);
    expect(plan.token).toBe('tok');
    expect(plan.write).toEqual({
      cloudSessionTokenEnc: 'enc(tok)',
      cloudSessionToken: '',
    });
  });

  it('reads the encrypted token with nothing to write', () => {
    const plan = planTokenRead({ plain: '', enc: 'enc(tok)' }, true, crypto);
    expect(plan).toEqual({ token: 'tok' });
  });

  it('clears a leftover plain copy', () => {
    const plan = planTokenRead({ plain: 'old', enc: 'enc(tok)' }, true, crypto);
    expect(plan.token).toBe('tok');
    expect(plan.write).toEqual({ cloudSessionToken: '' });
  });

  it('falls back to plain when decrypting fails', () => {
    const plan = planTokenRead({ plain: 'tok', enc: 'junk' }, true, crypto);
    expect(plan.token).toBe('tok');
    expect(plan.write?.cloudSessionTokenEnc).toBe('enc(tok)');
  });

  it('signs out when only an undecryptable value exists', () => {
    const plan = planTokenRead({ plain: '', enc: 'junk' }, true, crypto);
    expect(plan.token).toBe('');
    expect(plan.note).toBeTruthy();
  });

  it('uses plain when encryption is unavailable', () => {
    const plan = planTokenRead({ plain: 'tok', enc: '' }, false, crypto);
    expect(plan).toEqual({ token: 'tok', note: undefined });
  });

  it('returns empty when nothing is stored', () => {
    expect(planTokenRead({ plain: '', enc: '' }, true, crypto).token).toBe('');
  });
});

describe('planTokenWrite', () => {
  it('encrypts when available', () => {
    expect(planTokenWrite('tok', true, crypto)).toEqual({
      cloudSessionToken: '',
      cloudSessionTokenEnc: 'enc(tok)',
    });
  });

  it('stores plain when not available', () => {
    expect(planTokenWrite('tok', false, crypto)).toEqual({
      cloudSessionToken: 'tok',
      cloudSessionTokenEnc: '',
    });
  });

  it('clears both on empty', () => {
    expect(planTokenWrite('', true, crypto)).toEqual({
      cloudSessionToken: '',
      cloudSessionTokenEnc: '',
    });
  });
});

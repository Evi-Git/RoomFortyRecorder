import { isSafeExternalUrl } from '../../main/externalUrl';
import {
  nearestExistingDirectory,
  validateExplorerPath,
} from '../../main/explorerPath';

describe('isSafeExternalUrl', () => {
  it.each([
    'https://www.wowhead.com/spell=123',
    'https://discord.com/oauth2/authorize?x=1',
    'http://localhost:3000/a',
    'http://127.0.0.1:8080',
    'http://192.168.1.20/x',
  ])('allows %s', (u) => expect(isSafeExternalUrl(u)).toBe(true));

  it.each([
    'file:///C:/Windows/System32/calc.exe',
    'javascript:alert(1)',
    'ms-msdt:/id',
    'mailto:a@b.c',
    '\\\\server\\share\\x',
    'http://example.com',
    'http://10.0.0.1',
    'https://user:pw@example.com',
    'not a url',
    '',
    undefined,
    42,
    'https://' + 'a'.repeat(3000),
  ])('rejects %s', (u) => expect(isSafeExternalUrl(u)).toBe(false));
});

describe('validateExplorerPath', () => {
  it('accepts and normalises absolute paths', () => {
    expect(validateExplorerPath('/a/b/../c.mp4')).toBe('/a/c.mp4');
  });

  it.each([
    '',
    'relative/x',
    '/a\0b',
    '//server/share',
    '\\\\server\\x',
    5,
    null,
  ])('rejects %p', (p) => expect(validateExplorerPath(p)).toBeNull());
});

describe('validateExplorerPath UNC roots', () => {
  const roots = ['\\\\NAS\\share\\Recordings\\', 'C:\\local'];

  it('allows UNC paths inside a configured root, case-insensitively', () => {
    expect(
      validateExplorerPath('\\\\nas\\SHARE\\recordings\\a\\b.mp4', roots),
    ).toBe('\\\\nas\\SHARE\\recordings\\a\\b.mp4');
    expect(
      validateExplorerPath('\\\\NAS\\share\\Recordings', roots),
    ).not.toBeNull();
  });

  it('rejects other UNC paths', () => {
    expect(validateExplorerPath('\\\\NAS\\share2\\x', roots)).toBeNull();
    expect(
      validateExplorerPath('\\\\NAS\\share\\Recordings2\\x', roots),
    ).toBeNull();
    expect(
      validateExplorerPath('\\\\NAS\\share\\Recordings\\..\\x', roots),
    ).toBeNull();
    expect(validateExplorerPath('\\\\evil\\x', roots)).toBeNull();
    expect(validateExplorerPath('\\\\evil\\x')).toBeNull();
  });
});

describe('nearestExistingDirectory', () => {
  it('skips files and missing folders', () => {
    const dirs = new Set(['/rec']);
    const isDir = (p: string) => dirs.has(p);
    expect(nearestExistingDirectory('/rec/a/b.mp4', isDir)).toBe('/rec');
    // /rec/evil.exe exists as a file (not a directory), so it is skipped.
    expect(nearestExistingDirectory('/rec/evil.exe/x', isDir)).toBe('/rec');
  });

  it('returns null when nothing is a directory', () => {
    expect(nearestExistingDirectory('/a/b', () => false)).toBeNull();
  });
});

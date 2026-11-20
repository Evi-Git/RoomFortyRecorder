import { isSafeExternalUrl } from '../../main/externalUrl';
import { validateExplorerPath } from '../../main/explorerPath';

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

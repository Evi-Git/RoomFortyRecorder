import { contentSecurityPolicy } from '../../renderer/csp';

const directives = (csp: string) =>
  Object.fromEntries(
    csp.split('; ').map((d) => {
      const [name, ...sources] = d.split(' ');
      return [name, sources];
    }),
  );

describe('contentSecurityPolicy', () => {
  const prod = directives(contentSecurityPolicy());

  it('never allows eval or inline scripts in the packaged build', () => {
    expect(prod['script-src']).toEqual(["'self'"]);
    expect(contentSecurityPolicy()).not.toContain('unsafe-eval');
  });

  it('shuts the doors the app never uses', () => {
    expect(prod['object-src']).toEqual(["'none'"]);
    expect(prod['base-uri']).toEqual(["'none'"]);
    expect(prod['form-action']).toEqual(["'none'"]);
    expect(prod['default-src']).toEqual(["'self'"]);
  });

  it('lets local recordings, icons and cloud videos load', () => {
    expect(prod['media-src']).toEqual(
      expect.arrayContaining(['vod:', 'https:', 'blob:']),
    );
    expect(prod['img-src']).toEqual(
      expect.arrayContaining(['rficon:', 'data:', 'https:']),
    );
    expect(prod['connect-src']).toEqual(
      expect.arrayContaining(['https:', 'wss:']),
    );
  });

  it('only the dev build gets eval and the local dev server', () => {
    const dev = directives(contentSecurityPolicy({ development: true }));
    expect(dev['script-src']).toContain("'unsafe-eval'");
    expect(dev['connect-src']).toContain('ws://localhost:*');
    expect(prod['connect-src']).not.toContain('ws://localhost:*');
  });

  it('is valid inside an HTML attribute', () => {
    expect(contentSecurityPolicy()).not.toMatch(/["<>]/);
  });
});

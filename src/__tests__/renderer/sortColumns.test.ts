import fs from 'fs';
import path from 'path';

/**
 * Two sortable headers with the same column key both light up their arrow
 * (the Casts table showed two). Within one <thead>, every literal
 * column="..." must be unique.
 */
test('no table header repeats a sort column key', () => {
  const dir = path.join(__dirname, '../../renderer/logs');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.tsx'));
  expect(files.length).toBeGreaterThan(5);
  files.forEach((file) => {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    text
      .split('<thead')
      .slice(1)
      .forEach((chunk) => {
        const head = chunk.split('</thead>')[0];
        const keys = [...head.matchAll(/column="([^"]+)"/g)].map((m) => m[1]);
        expect({
          file,
          dupes: keys.filter((k, i) => keys.indexOf(k) !== i),
        }).toEqual({ file, dupes: [] });
      });
  });
});

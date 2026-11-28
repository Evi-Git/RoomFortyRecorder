import { currentKey, nextByArrow, Box } from '../../renderer/roving';

// A 3 x 2 grid of 10 px boxes, 20 px apart: indexes 0 1 2 / 3 4 5.
const grid: Box[] = [0, 1, 2, 3, 4, 5].map((i) => ({
  x: (i % 3) * 20,
  y: Math.floor(i / 3) * 20,
  w: 10,
  h: 10,
}));

test('arrows move to the neighbour that way, and stop at the edge', () => {
  expect(nextByArrow(grid, 0, 'ArrowRight')).toBe(1);
  expect(nextByArrow(grid, 1, 'ArrowDown')).toBe(4);
  expect(nextByArrow(grid, 4, 'ArrowLeft')).toBe(3);
  expect(nextByArrow(grid, 4, 'ArrowUp')).toBe(1);
  expect(nextByArrow(grid, 0, 'ArrowLeft')).toBeNull();
  expect(nextByArrow(grid, 2, 'ArrowUp')).toBeNull();
  expect(nextByArrow(grid, 5, 'ArrowDown')).toBeNull();
});

test('a list in one column: up and down, sideways does nothing', () => {
  const list: Box[] = [0, 1, 2].map((i) => ({
    x: 0,
    y: i * 20,
    w: 100,
    h: 12,
  }));
  expect(nextByArrow(list, 0, 'ArrowDown')).toBe(1);
  expect(nextByArrow(list, 2, 'ArrowUp')).toBe(1);
  expect(nextByArrow(list, 1, 'ArrowRight')).toBeNull();
});

test('a ragged tree: down goes to the nearest column, skipping gaps', () => {
  const nodes: Box[] = [
    { x: 0, y: 0, w: 10, h: 10 },
    { x: 40, y: 0, w: 10, h: 10 },
    { x: 40, y: 40, w: 10, h: 10 },
    { x: 0, y: 60, w: 10, h: 10 },
  ];
  expect(nextByArrow(nodes, 0, 'ArrowDown')).toBe(3);
  expect(nextByArrow(nodes, 1, 'ArrowDown')).toBe(2);
});

test('the current item survives a changed list only if still there', () => {
  expect(currentKey(['a', 'b'], null)).toBe('a');
  expect(currentKey(['a', 'b'], 'b')).toBe('b');
  expect(currentKey(['a', 'b'], 'gone')).toBe('a');
  expect(currentKey([], 'x')).toBeNull();
});

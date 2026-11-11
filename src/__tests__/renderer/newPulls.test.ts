import { countNew } from '../../renderer/newPulls';

test('counts pulls created after the Dashboard was last open', () => {
  const pulls = [
    { id: 'a', createdAt: 100 },
    { id: 'b', createdAt: 200 },
    { id: 'c', createdAt: 300 },
  ];
  expect(countNew(pulls, 150)).toBe(2);
  expect(countNew(pulls, 300)).toBe(0);
  // Never opened: nothing is "new".
  expect(countNew(pulls, 0)).toBe(0);
});

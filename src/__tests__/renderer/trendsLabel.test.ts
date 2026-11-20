import { nightHeading, nightKind } from '../../renderer/trendsLabel';

test('a progression night without a kill is not the first kill', () => {
  expect(nightKind({ phase: 'first', kills: 1 })).toBe('First kill');
  expect(nightKind({ phase: 'first', kills: 0 })).toBe('Progression');
  expect(nightKind({ phase: 'kills', kills: 2 })).toBe('Reclear');
  expect(nightHeading({ phase: 'first', kills: 0 })).toBe('progression');
  expect(nightHeading({ phase: 'first', kills: 1 })).toBe('first kill');
  expect(nightHeading({ phase: 'kills', kills: 2 })).toBe('2 kills');
});

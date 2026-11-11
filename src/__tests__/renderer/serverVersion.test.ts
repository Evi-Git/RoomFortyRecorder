import {
  checkServer,
  parseVersion,
  SERVER_CHANGED_IN,
} from '../../renderer/serverVersion';

test('reads release tags and plain versions', () => {
  expect(parseVersion('v1.9.112')).toEqual([1, 9, 112]);
  expect(parseVersion('1.9.7')).toEqual([1, 9, 7]);
  expect(parseVersion(null)).toBeNull();
  expect(parseVersion('unknown version')).toBeNull();
});

test('a server older than the last server change is behind', () => {
  expect(checkServer('v1.9.108', '1.9.112')).toEqual({
    state: 'behind',
    server: '1.9.108',
    needed: '1.9.112',
  });
  // Numbers, not text: 1.9.99 is older than 1.9.112.
  expect(checkServer('v1.9.99', '1.9.112').state).toBe('behind');
});

test('the same or a newer server is current', () => {
  expect(checkServer('v1.9.112', '1.9.112').state).toBe('current');
  expect(checkServer('v1.9.113', '1.9.112').state).toBe('current');
  expect(checkServer('v1.10.0', '1.9.112').state).toBe('current');
});

test('no version to go by says nothing', () => {
  expect(checkServer(null).state).toBe('unknown');
  expect(checkServer('').state).toBe('unknown');
});

test('the constant is a version', () => {
  expect(parseVersion(SERVER_CHANGED_IN)).not.toBeNull();
});

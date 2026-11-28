import {
  nameAndReason,
  reasonText,
} from '../../renderer/components/Tooltip/reason';

describe('nameAndReason', () => {
  test('a normal tooltip is the name, nothing described', () => {
    expect(nameAndReason('Delete', 'Delete', 'why')).toEqual({
      'aria-label': 'Delete',
    });
    expect(reasonText('Delete', 'Delete')).toBeNull();
  });
  test("a reason tooltip never becomes the name; it's described", () => {
    const reason = "You don't have permission.";
    expect(nameAndReason('Delete', reason, 'why')).toEqual({
      'aria-label': 'Delete',
      'aria-describedby': 'why',
    });
    expect(reasonText('Delete', reason)).toBe(reason);
  });
  test('an empty tooltip describes nothing', () => {
    expect(nameAndReason('Lock', '', 'why')).toEqual({ 'aria-label': 'Lock' });
  });
});

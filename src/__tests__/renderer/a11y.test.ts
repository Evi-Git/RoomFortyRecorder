import {
  activateOnKey,
  clickableProps,
  focusableProps,
  isActivation,
} from '../../renderer/a11y';

const key = (k: string, same = true) => {
  const el = {} as HTMLElement;
  return {
    key: k,
    target: same ? el : ({} as HTMLElement),
    currentTarget: el,
    preventDefault: jest.fn(),
  } as unknown as React.KeyboardEvent<HTMLElement>;
};

describe('activateOnKey', () => {
  it('runs on Enter and Space and stops Space scrolling the page', () => {
    const fn = jest.fn();
    const on = activateOnKey(fn);
    const enter = key('Enter');
    const space = key(' ');
    on(enter);
    on(space);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(enter.preventDefault).toHaveBeenCalled();
    expect(space.preventDefault).toHaveBeenCalled();
  });

  it('ignores other keys', () => {
    const fn = jest.fn();
    const e = key('a');
    activateOnKey(fn)(e);
    activateOnKey(fn)(key('Tab'));
    expect(fn).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores keys that came from a button inside the element', () => {
    const fn = jest.fn();
    const e = key('Enter', false);
    activateOnKey(fn)(e);
    expect(fn).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});

describe('clickableProps', () => {
  it('gives role, tabIndex, click and key handlers', () => {
    const fn = jest.fn();
    const p = clickableProps(fn, 'Open it');
    expect(p.role).toBe('button');
    expect(p.tabIndex).toBe(0);
    expect(p['aria-label']).toBe('Open it');
    p.onKeyDown?.(key('Enter'));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives nothing when there is no handler', () => {
    expect(clickableProps(undefined)).toEqual({});
  });

  it('leaves out the label when none is given', () => {
    expect('aria-label' in clickableProps(() => {})).toBe(false);
  });
});

describe('focusableProps', () => {
  it('adds tabIndex and keys but no role', () => {
    const fn = jest.fn();
    const p = focusableProps(fn);
    expect(p.tabIndex).toBe(0);
    expect('role' in p).toBe(false);
    p.onKeyDown?.(key(' '));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives nothing when there is no handler', () => {
    expect(focusableProps(undefined)).toEqual({});
  });
});

describe('isActivation', () => {
  it('is true for Enter and Space from the element itself', () => {
    expect(isActivation(key('Enter'))).toBe(true);
    expect(isActivation(key(' '))).toBe(true);
  });
  it('is false for other keys and for keys from inside', () => {
    expect(isActivation(key('x'))).toBe(false);
    expect(isActivation(key('Enter', false))).toBe(false);
  });
});

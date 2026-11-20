import { StallDetector, startStallWatch } from '../../main/stallTimer';

describe('StallDetector', () => {
  it('is stalled only after stallMs with no new bytes', () => {
    let t = 0;
    const d = new StallDetector(60_000, () => t);
    t = 59_000;
    expect(d.isStalled()).toBe(false);
    t = 60_000;
    expect(d.isStalled()).toBe(true);
  });

  it('progress resets the clock; the same byte count does not', () => {
    let t = 0;
    const d = new StallDetector(10_000, () => t);
    t = 9_000;
    d.record(100);
    t = 18_000;
    expect(d.isStalled()).toBe(false);
    d.record(100); // nothing new
    t = 19_000;
    expect(d.isStalled()).toBe(true);
    d.record(101);
    expect(d.isStalled()).toBe(false);
  });

  it('ignores junk byte counts', () => {
    let t = 0;
    const d = new StallDetector(10, () => t);
    t = 10;
    d.record(NaN);
    expect(d.isStalled()).toBe(true);
  });
});

describe('startStallWatch', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('fires once when the transfer goes quiet', () => {
    const onStall = jest.fn();
    const watch = startStallWatch({ onStall, stallMs: 60_000, checkMs: 5_000 });
    jest.advanceTimersByTime(30_000);
    watch.record(10);
    jest.advanceTimersByTime(50_000);
    expect(onStall).not.toHaveBeenCalled();
    jest.advanceTimersByTime(20_000);
    expect(onStall).toHaveBeenCalledTimes(1);
    expect(watch.stalled).toBe(true);
    jest.advanceTimersByTime(120_000);
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it('never fires after stop', () => {
    const onStall = jest.fn();
    const watch = startStallWatch({ onStall, stallMs: 1_000, checkMs: 500 });
    watch.stop();
    jest.advanceTimersByTime(10_000);
    expect(onStall).not.toHaveBeenCalled();
    expect(watch.stalled).toBe(false);
  });
});

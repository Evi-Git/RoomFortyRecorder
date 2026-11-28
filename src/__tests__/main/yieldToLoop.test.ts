import { createYielder } from '../../main/yieldToLoop';

describe('createYielder', () => {
  it('only takes a turn once the budget has passed, and only looks every N calls', async () => {
    let clock = 0;
    let turns = 0;
    const yieldNow = createYielder({
      budgetMs: 10,
      every: 4,
      now: () => clock,
      turn: async () => {
        turns += 1;
      },
    });

    // 3 calls: the clock isn't even read.
    clock = 100;
    for (let i = 0; i < 3; i += 1) await yieldNow();
    expect(turns).toBe(0);

    // 4th call: 100 ms of work since the start, so it yields.
    await yieldNow();
    expect(turns).toBe(1);

    // Next 4 calls: only 5 ms since the last turn, so no yield.
    clock += 5;
    for (let i = 0; i < 4; i += 1) await yieldNow();
    expect(turns).toBe(1);

    // Another 10 ms pass: yields at the next look.
    clock += 10;
    for (let i = 0; i < 4; i += 1) await yieldNow();
    expect(turns).toBe(2);
  });

  it('really lets the event loop run (default turn)', async () => {
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 1);
    const yieldNow = createYielder({ budgetMs: 0, every: 1 });
    const end = Date.now() + 30;
    while (Date.now() < end) await yieldNow();
    clearInterval(timer);
    expect(ticks).toBeGreaterThan(0);
  });
});

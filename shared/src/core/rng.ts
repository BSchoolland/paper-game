export class Rng {
  private state: number;

  private constructor(seed: number) {
    this.state = seed;
  }

  static seeded(x: number, y: number): Rng {
    const seed = (x * 7919 + y * 104729 + 5381) & 0x7fffffff;
    return new Rng(seed);
  }

  static perRun(runId: number, x: number, y: number): Rng {
    const seed = (runId * 48271 + x * 7919 + y * 104729 + 91831) & 0x7fffffff;
    return new Rng(seed);
  }

  next(): number {
    // eslint-disable-next-line no-restricted-syntax -- core LCG implementation
    this.state = (this.state * 1664525 + 1013904223) & 0xffffffff;
    return (this.state >>> 0) / 0xffffffff;
  }

  symmetric(): number {
    return (this.next() - 0.5) * 2;
  }
}

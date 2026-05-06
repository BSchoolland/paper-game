export class Rng {
  private state: number;

  private constructor(seed: number) {
    this.state = seed;
  }

  static seeded(x: number, y: number): Rng {
    const seed = (x * 7919 + y * 104729 + 5381) & 0x7fffffff;
    return new Rng(seed);
  }

  static trueRandom(): Rng {
    // eslint-disable-next-line no-restricted-syntax -- Rng implementation seeding from Math.random
    return new Rng((Math.random() * 0x7fffffff) | 0);
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

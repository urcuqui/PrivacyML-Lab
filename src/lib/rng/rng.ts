/**
 * Generadores de números aleatorios.
 *
 * IMPORTANTE: `createSeededRng` (Mulberry32) es un PRNG determinista pensado para
 * REPRODUCIBILIDAD EXPERIMENTAL. No es criptográficamente seguro y NO debe usarse
 * para desplegar mecanismos de privacidad diferencial reales.
 * `createCryptoRng` usa `crypto.getRandomValues`, más apropiado (aunque un despliegue
 * real además debe evitar las vulnerabilidades de punto flotante; ver README).
 */
export interface RNG {
  /** Uniforme en [0, 1). */
  next(): number;
  uniform(a: number, b: number): number;
  /** Normal N(mean, sd^2) mediante Box–Muller. */
  normal(mean?: number, sd?: number): number;
  /** Laplace(0, b) mediante inversión de la CDF. */
  laplace(b: number): number;
  /** Entero uniforme en [0, n). */
  int(n: number): number;
  /** Mezcla de Fisher–Yates (devuelve copia). */
  shuffle<T>(arr: readonly T[]): T[];
  readonly kind: 'seeded' | 'crypto';
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash FNV-1a de 32 bits para derivar sub-semillas reproducibles. */
export function deriveSeed(seed: number, ...labels: (string | number)[]): number {
  let h = 0x811c9dc5 ^ (seed >>> 0);
  const s = labels.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // mezcla final
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

function buildRng(source: () => number, kind: RNG['kind']): RNG {
  let spare: number | null = null;
  const rng: RNG = {
    kind,
    next: source,
    uniform(a, b) {
      return a + (b - a) * source();
    },
    normal(mean = 0, sd = 1) {
      if (spare !== null) {
        const z = spare;
        spare = null;
        return mean + sd * z;
      }
      let u = 0;
      while (u === 0) u = source();
      const v = source();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return mean + sd * r * Math.cos(2 * Math.PI * v);
    },
    laplace(b) {
      if (!(b > 0) || !Number.isFinite(b)) throw new RangeError('La escala de Laplace debe ser positiva y finita');
      // u ~ U(-1/2, 1/2); X = -b·sign(u)·ln(1 - 2|u|)
      let u: number;
      let w: number;
      do {
        u = source() - 0.5;
        w = 1 - 2 * Math.abs(u);
      } while (w <= 0);
      return -b * Math.sign(u) * Math.log(w);
    },
    int(n) {
      return Math.floor(source() * n);
    },
    shuffle<T>(arr: readonly T[]): T[] {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(source() * (i + 1));
        const tmp = a[i];
        a[i] = a[j];
        a[j] = tmp;
      }
      return a;
    },
  };
  return rng;
}

export function createSeededRng(seed: number): RNG {
  return buildRng(mulberry32(seed), 'seeded');
}

/** RNG basado en crypto.getRandomValues (no reproducible). */
export function createCryptoRng(): RNG {
  const buf = new Uint32Array(2);
  const source = () => {
    crypto.getRandomValues(buf);
    // 53 bits de mantisa
    return ((buf[0] >>> 5) * 67108864 + (buf[1] >>> 6)) / 9007199254740992;
  };
  return buildRng(source, 'crypto');
}

export function normalizeSeed(input: unknown, fallback = 42): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.abs(Math.trunc(n)) >>> 0;
}

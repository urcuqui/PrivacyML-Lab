import { describe, expect, it } from 'vitest';
import { QUESTIONS, scoreQuiz } from './questions';
import { SCENARIOS, verdict, DEFAULT_CHOICE, type ChallengeChoice } from './challenge';

describe('Cuestionarios', () => {
  for (const [mod, qs] of Object.entries(QUESTIONS)) {
    it(`${mod}: 4–5 preguntas, una sola correcta y explicación en cada opción`, () => {
      expect(qs.length).toBeGreaterThanOrEqual(4);
      expect(qs.length).toBeLessThanOrEqual(5);
      for (const q of qs) {
        expect(q.options.filter((o) => o.correct)).toHaveLength(1);
        for (const o of q.options) expect(o.explanation.length).toBeGreaterThan(20);
        expect(new Set(q.options.map((o) => o.text)).size).toBe(q.options.length);
      }
    });
  }
  it('puntúa correctamente', () => {
    const q = QUESTIONS.dp[0];
    const right = q.options.find((o) => o.correct)!.id;
    expect(scoreQuiz('dp', { answers: { [q.id]: right } })).toEqual({ correct: 1, answered: 1, total: QUESTIONS.dp.length });
  });
});

describe('Reto final', () => {
  const ref: Record<string, ChallengeChoice> = {
    hospitals: { architecture: 'fldpsa', unit: 'record', noise: 'medium', participation: 'full', epochs: 'moderate' },
    keyboard: { architecture: 'fldpsa', unit: 'client', noise: 'medium', participation: 'low', epochs: 'moderate' },
    agency: { architecture: 'dpstats', unit: 'record', noise: 'medium', participation: 'full', epochs: 'moderate' },
  };
  for (const s of SCENARIOS) {
    it(`${s.id}: la respuesta de referencia cumple todos los requisitos`, () => {
      expect(verdict(s.evaluate(ref[s.id])).status).toBe('meets');
    });
    it(`${s.id}: centralizado sin DP no cumple`, () => {
      expect(verdict(s.evaluate({ ...DEFAULT_CHOICE, architecture: 'central' })).status).toBe('fails');
    });
  }
});

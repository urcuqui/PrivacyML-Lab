import { describe, expect, it } from 'vitest';
import { simulateMemory, simulateToolScenario, singleControlMatrix, PATIENTS, type ToolControls, type MemoryPolicy } from './simulation';

const allCombos = (): ToolControls[] => {
  const out: ToolControls[] = [];
  for (let m = 0; m < 32; m++)
    out.push({ leastPrivilege: !!(m & 1), trustBoundary: !!(m & 2), egressControl: !!(m & 4), memoryIsolation: !!(m & 8), modelTrainedWithDP: !!(m & 16) });
  return out;
};

describe('Escenario 3: herramientas', () => {
  it('sin controles se exfiltran todos los registros', () => {
    const o = simulateToolScenario({ leastPrivilege: false, trustBoundary: false, egressControl: false, memoryIsolation: false, modelTrainedWithDP: false });
    expect(o.exfiltrated).toHaveLength(PATIENTS.length);
    expect(o.injectionPersisted).toBe(true);
  });
  it('entrenar el modelo con DP NUNCA cambia el resultado de exfiltración', () => {
    for (const c of allCombos().filter((x) => !x.modelTrainedWithDP)) {
      const a = simulateToolScenario(c);
      const b = simulateToolScenario({ ...c, modelTrainedWithDP: true });
      expect(b.exfiltrated).toEqual(a.exfiltrated);
      expect(b.overCollected).toEqual(a.overCollected);
      expect(b.injectionPersisted).toBe(a.injectionPersisted);
    }
  });
  it('mínimo privilegio reduce el alcance pero no evita por sí solo la exfiltración', () => {
    const o = simulateToolScenario({ leastPrivilege: true, trustBoundary: false, egressControl: false, memoryIsolation: false, modelTrainedWithDP: false });
    expect(o.exfiltrated.sort()).toEqual(['P-201', 'P-202']);
  });
  it('el control de salida evita el envío pero los datos ya entraron en el contexto', () => {
    const o = simulateToolScenario({ leastPrivilege: false, trustBoundary: false, egressControl: true, memoryIsolation: true, modelTrainedWithDP: false });
    expect(o.exfiltrated).toHaveLength(0);
    expect(o.overCollected.length).toBeGreaterThan(0);
  });
  it('la matriz de controles individuales coincide con la simulación', () => {
    const m = singleControlMatrix();
    expect(m[0].outcome.exfiltrated.length).toBe(PATIENTS.length);
    const dpRow = m.find((r) => r.controls.modelTrainedWithDP && !r.controls.trustBoundary)!;
    expect(dpRow.outcome.exfiltrated.length).toBe(PATIENTS.length);
  });
});

describe('Escenario 2: memoria', () => {
  const base: MemoryPolicy = { perUserIsolation: false, noSensitivePersistence: false, limitedRetention: false, retentionDays: 30, elapsedDays: 10, modelTrainedWithDP: false };
  it('memoria compartida filtra datos de A a B', () => {
    const o = simulateMemory(base);
    expect(o.leaked).toBe(true);
    expect(o.leakedFacts).toContain('estado serológico (VIH)');
  });
  it('DP en el modelo no cambia la fuga de memoria', () => {
    expect(simulateMemory({ ...base, modelTrainedWithDP: true }).leaked).toBe(true);
  });
  it('aislamiento, no persistencia o caducidad evitan la fuga', () => {
    expect(simulateMemory({ ...base, perUserIsolation: true }).leaked).toBe(false);
    expect(simulateMemory({ ...base, noSensitivePersistence: true }).leaked).toBe(false);
    expect(simulateMemory({ ...base, limitedRetention: true, elapsedDays: 40 }).leaked).toBe(false);
    expect(simulateMemory({ ...base, limitedRetention: true, elapsedDays: 20 }).leaked).toBe(true);
  });
});

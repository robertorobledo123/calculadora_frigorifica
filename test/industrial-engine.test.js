const assert = require('node:assert/strict');
const core = require('../calc-engine');
const industrial = require('../industrial-engine');

function approx(actual, expected, tolerance = 1e-6, message = '') {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message} expected ${expected}, got ${actual}`);
}

function run(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function baseProduct(overrides = {}) {
  return {
    massKg: 100,
    initialTemp: 5,
    finalTemp: -10,
    initialFreezingPoint: -2,
    cpAbove: 3.6,
    cpBelow: 1.8,
    latentHeat: 250,
    initialFrozenFraction: 0,
    finalFrozenFraction: 50,
    ...overrides
  };
}

run('congelacion parcial 25%, 50% y 90% usa latente proporcional', () => {
  [25, 50, 90].forEach(pct => {
    const result = industrial.partialFreezingEnergy(baseProduct({ finalFrozenFraction: pct }));
    const sensibleAbove = 100 * 3.6 * (5 - (-2));
    const latent = 100 * 250 * (pct / 100);
    const sensibleBelow = 100 * 1.8 * ((-2) - (-10));
    approx(result.totalKwh, (sensibleAbove + latent + sensibleBelow) / 3600, 1e-12, `${pct}% kWh`);
  });
});

run('aumentar fraccion congelada nunca reduce calor latente', () => {
  const a = industrial.partialFreezingEnergy(baseProduct({ finalFrozenFraction: 25 })).latentKwh;
  const b = industrial.partialFreezingEnergy(baseProduct({ finalFrozenFraction: 50 })).latentKwh;
  const c = industrial.partialFreezingEnergy(baseProduct({ finalFrozenFraction: 90 })).latentKwh;
  assert.ok(a <= b && b <= c);
});

run('continuidad al cambiar ligeramente temperatura sin salto latente', () => {
  const a = industrial.partialFreezingEnergy(baseProduct({ finalTemp: -2.01, finalFrozenFraction: 50 }));
  const b = industrial.partialFreezingEnergy(baseProduct({ finalTemp: -2.02, finalFrozenFraction: 50 }));
  assert.ok(Math.abs(a.totalKwh - b.totalKwh) < 0.001);
  approx(a.latentKwh, b.latentKwh, 1e-12, 'latente manual constante');
});

run('blast freezer por lote y varios lotes diarios', () => {
  const data = {
    ...baseProduct({ massKg: undefined }),
    batchMassKg: 1000, batchesPerDay: 3, pullDownHours: 4, loadingHours: 0.5, recoveryHours: 0.25,
    packagingPct: 10, packagingCp: 1.5, fanKw: 12, fanHeatFraction: 100, processAuxKw: 2, processAuxHeatFraction: 50,
    additionalLossesKw: 1, availableHours: 20, designMarginPct: 10,
    defrostKw: 8, defrostCount: 2, defrostMinutes: 20, dripMinutes: 10, fanDelayMinutes: 5, defrostHeatFraction: 50
  };
  const result = industrial.blastFreezer(data);
  const productKwhBatch = (1000 * 3.6 * 7 + 1000 * 250 * 0.5 + 1000 * 1.8 * 8) / 3600;
  const packagingKwhBatch = (1000 * 0.10) * 1.5 * 15 / 3600;
  const fanThermalDaily = 12 * 4 * 3;
  const auxThermalDaily = 2 * 4 * 3 * 0.5;
  const lossesDaily = 1 * 20;
  const defrostThermal = 8 * 2 * 20 / 60 * 0.5;
  const daily = (productKwhBatch + packagingKwhBatch) * 3 + fanThermalDaily + auxThermalDaily + lossesDaily + defrostThermal;
  const processKw = (productKwhBatch + packagingKwhBatch) / 4 + 12 + 1 + 1;
  approx(result.energyPerBatchKwh, productKwhBatch + packagingKwhBatch, 1e-9, 'energia lote');
  approx(result.thermalEnergyDailyKwh, daily, 1e-9, 'energia diaria');
  approx(result.processCapacityKw, processKw, 1e-9, 'capacidad abatimiento');
  assert.equal(result.maxBatchesPerDay, Math.floor((20 - 70 / 60) / 4.75));
});

run('IQF calcula por kg/h y duplicar flujo duplica capacidad de producto', () => {
  const data = { ...baseProduct(), flowKgH: 1000, operationHours: 10, packagingPct: 0, fanKw: 0, beltKw: 0, vibratorKw: 0, auxiliaryKw: 0, additionalLossesKw: 0, defrostCount: 0, designMarginPct: 0 };
  const a = industrial.iqf(data);
  const b = industrial.iqf({ ...data, flowKgH: 2000 });
  approx(a.productKw, 1000 * a.product.specificKwhKg, 1e-12, 'producto IQF kW');
  approx(b.productKw / a.productKw, 2, 1e-12, 'doble flujo');
});

run('agua de glaseado suma sensible, latente y subenfriamiento de hielo', () => {
  const result = industrial.glazingLoad({ glazingWaterKgH: 100, glazingWaterTempC: 5, glazingFrozenPct: 80, finalTemp: -10 });
  const sensible = 100 * 4.186 * 5 / 3600;
  const latent = 100 * 333.55 * 0.8 / 3600;
  const ice = 100 * 2.05 * 10 * 0.8 / 3600;
  approx(result.totalKw, sensible + latent + ice, 1e-12, 'glaseado kW');
});

run('ventiladores del proceso, banda y vibradores separan calor y consumo', () => {
  const fan = industrial.motorLoad(10, 12, 100);
  const belt = industrial.motorLoad(3, 12, 50);
  const vib = industrial.motorLoad(2, 12, 25);
  assert.deepEqual(fan, { electricKwh: 120, thermalKwh: 120, thermalKw: 10 });
  assert.deepEqual(belt, { electricKwh: 36, thermalKwh: 18, thermalKw: 1.5 });
  assert.deepEqual(vib, { electricKwh: 24, thermalKwh: 6, thermalKw: 0.5 });
});

run('tiempo fuera de servicio por deshielo reduce horas netas', () => {
  const result = industrial.defrostAvailability({ operationHours: 16, defrostCount: 2, defrostMinutes: 20, dripMinutes: 10, fanDelayMinutes: 5, defrostKw: 6, defrostHeatFraction: 50 });
  approx(result.unavailableHours, 70 / 60, 1e-12, 'no disponible h');
  approx(result.availableHours, 16 - 70 / 60, 1e-12, 'disponible h');
  approx(result.electricKwh, 6 * 2 * 20 / 60, 1e-12, 'deshielo electrico');
  approx(result.thermalKwh, 6 * 2 * 20 / 60 * 0.5, 1e-12, 'deshielo termico');
});

run('infiltracion por puerta, renovaciones, volumen medido y puertas simultaneas', () => {
  const common = { insideTemp: 0, outsideTemp: 20, insideRH: 80, outsideRH: 50, atmosphericPressureKPa: 101.325, length: 10, width: 5, height: 4 };
  const door = core.infiltrationLoad({ ...common, doors: [{ width: 1, height: 2, openingsPerDay: 10, minutesOpen: 1, protectionFactor: 1 }, { width: 1, height: 2, openingsPerDay: 10, minutesOpen: 1, protectionFactor: 1 }], maxSimultaneousDoors: 1 });
  const both = core.infiltrationLoad({ ...common, doors: [{ width: 1, height: 2, openingsPerDay: 10, minutesOpen: 1, protectionFactor: 1 }, { width: 1, height: 2, openingsPerDay: 10, minutesOpen: 1, protectionFactor: 1 }], maxSimultaneousDoors: 2 });
  approx(both.infiltratedVolume / door.infiltratedVolume, 2, 1e-12, 'puertas simultaneas');
  const ach = core.infiltrationLoad({ ...common, infiltrationMethod: 'airChanges', airChangesPerDay: 3 });
  approx(ach.infiltratedVolume, 10 * 5 * 4 * 3, 1e-12, 'renovaciones m3/dia');
  const measured = core.infiltrationLoad({ ...common, infiltrationMethod: 'measuredVolume', measuredInfiltrationM3Day: 1234 });
  approx(measured.infiltratedVolume, 1234, 1e-12, 'medido m3/dia');
});

run('potencia hidraulica, calor de bomba y capacidad transportada por glicol', () => {
  const result = industrial.secondaryFluid({ flowM3H: 20, pressureDropKPa: 120, pumpEfficiencyPct: 60, motorEfficiencyPct: 90, operationHours: 10, heatToColdPct: 80, densityKgM3: 1040, cpKjKgK: 3.6, supplyTempC: -8, returnTempC: -4, requiredCapacityKw: 100 });
  const hydraulic = (20 / 3600) * (120000) / 1000;
  const electric = hydraulic / (0.6 * 0.9);
  const transported = (20 / 3600 * 1040) * 3.6 * 4;
  approx(result.hydraulicKw, hydraulic, 1e-12, 'hidraulica kW');
  approx(result.electricKw, electric, 1e-12, 'electrica kW');
  approx(result.heatToColdKw, electric * 0.8, 1e-12, 'calor bomba kW');
  approx(result.transportedCapacityKw, transported, 1e-12, 'capacidad fluido kW');
});

run('cero caudal produce cero potencia hidraulica', () => {
  const result = industrial.secondaryFluid({ flowM3H: 0, pressureDropKPa: 120, pumpEfficiencyPct: 60, motorEfficiencyPct: 90 });
  approx(result.hydraulicKw, 0, 1e-12, 'cero hidraulica');
});

run('amoniaco bombeado calcula recirculacion y advierte flujo insuficiente', () => {
  const result = industrial.pumpedAmmonia({ evaporatorCapacityKw: 100, refrigerationEffectKjKg: 1000, recirculationRatio: 4, liquidDensityKgM3: 650, selectedPumpFlowM3H: 1, pressureDropKPa: 100, pumpEfficiencyPct: 50, motorEfficiencyPct: 90, operationHours: 10, heatToRefrigerantPct: 80, evaporatorCount: 2, simultaneityPct: 50 });
  const vapor = 100 / 1000;
  const circ = vapor * 4;
  const flow = circ / 650 * 3600;
  approx(result.vaporMassFlowKgS, vapor, 1e-12, 'vapor kg/s');
  approx(result.circulatedMassFlowKgS, circ, 1e-12, 'circulado kg/s');
  approx(result.requiredFlowM3H, flow, 1e-12, 'flujo requerido');
  assert.ok(result.warnings.length > 0);
});

run('COP fabricante, capacidad/potencia y metodo por entalpias', () => {
  approx(industrial.performanceFromData({ performanceMethod: 'manufacturerCop', certifiedCop: 2, requiredCapacityKw: 100, operationHours: 10 }).compressorKw, 50, 1e-12, 'fabricante');
  approx(industrial.performanceFromData({ performanceMethod: 'nominalCapacityPower', nominalCapacityKw: 120, nominalPowerKw: 60, requiredCapacityKw: 100 }).cop, 2, 1e-12, 'nominal');
  approx(industrial.performanceFromData({ performanceMethod: 'specificEnthalpy', refrigerationEffectKjKg: 160, specificWorkKjKg: 80, requiredCapacityKw: 100 }).cop, 2, 1e-12, 'entalpias');
});

run('CO2 transcritico rechaza Carnot y calcula rechazo con datos validos', () => {
  const rejected = industrial.transcriticalCo2({ performanceMethod: 'carnot', requiredCapacityKw: 100 });
  assert.ok(rejected.warnings.join(' ').includes('no acepta'));
  const ok = industrial.transcriticalCo2({ performanceMethod: 'manufacturerCop', certifiedCop: 1.5, requiredCapacityKw: 90, operationHours: 10 });
  approx(ok.performance.compressorKw, 60, 1e-12, 'compresor co2');
  approx(ok.performance.rejectionHeatKw, 150, 1e-12, 'rechazo co2');
});

run('dos etapas usa datos de fabricante o potencia de etapas sin factor arbitrario', () => {
  const result = industrial.twoStagePerformance({ requiredCapacityKw: 100, totalCapacityKw: 120, lowStagePowerKw: 30, highStagePowerKw: 30, operationHours: 10 });
  approx(result.cop, 2, 1e-12, 'COP dos etapas');
  approx(result.compressorKw, 50, 1e-12, 'compresor dos etapas');
});

run('validacion T_evaporacion menor que T_interior y resultados finitos', () => {
  const errors = industrial.validateIndustrial({ scenario: 'co2', performanceMethod: 'manufacturerCop', certifiedCop: 1.5, requiredCapacityKw: 100, evapTemp: -10, insideTemp: -18 });
  assert.ok(errors.includes('La temperatura de evaporación debe ser menor que la temperatura interior.'));
  const result = industrial.calculateIndustrial({ scenario: 'iqf', ...baseProduct(), flowKgH: 1000, operationHours: 10, packagingPct: 0, fanKw: 1, fanHeatFraction: 100, beltKw: 1, beltHeatFraction: 100, vibratorKw: 0, auxiliaryKw: 0, additionalLossesKw: 0, defrostCount: 0, designMarginPct: 10 });
  assert.deepEqual(industrial.ensureFiniteObject(result), []);
});

run('no duplicacion de cargas electricas y termicas en IQF', () => {
  const result = industrial.iqf({ ...baseProduct(), flowKgH: 1000, operationHours: 10, packagingPct: 0, fanKw: 2, fanHeatFraction: 100, beltKw: 3, beltHeatFraction: 50, vibratorKw: 1, vibratorHeatFraction: 25, auxiliaryKw: 4, auxiliaryHeatFraction: 0, additionalLossesKw: 0, defrostCount: 0, designMarginPct: 0 });
  approx(result.directElectricKwhDay, 2 * 10 + 3 * 10 + 1 * 10 + 4 * 10, 1e-12, 'electrico directo total');
  approx(result.loads.fanKw + result.loads.beltKw + result.loads.vibratorKw + result.loads.auxiliaryKw, 2 + 1.5 + 0.25 + 0, 1e-12, 'termico motores');
});

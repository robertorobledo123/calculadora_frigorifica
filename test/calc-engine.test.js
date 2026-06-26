const assert = require('node:assert/strict');
const engine = require('../calc-engine');

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

function satBuckKPa(tempC) {
  if (tempC >= 0) return 0.61121 * Math.exp((18.678 - tempC / 234.5) * (tempC / (257.14 + tempC)));
  return 0.61115 * Math.exp((23.036 - tempC / 333.7) * (tempC / (279.82 + tempC)));
}

function humidityRatio(tempC, rhPct, pressureKPa) {
  const pv = Math.max(0, Math.min(100, rhPct)) / 100 * satBuckKPa(tempC);
  return 0.62198 * pv / Math.max(0.1, pressureKPa - pv);
}

function enthalpy(tempC, rhPct, pressureKPa) {
  const w = humidityRatio(tempC, rhPct, pressureKPa);
  return 1.006 * tempC + w * (2501 + 1.86 * tempC);
}

function dryDensity(tempC, rhPct, pressureKPa) {
  const w = humidityRatio(tempC, rhPct, pressureKPa);
  return pressureKPa * 1000 / (287.055 * (tempC + 273.15) * (1 + 1.6078 * w));
}

function baseData() {
  return {
    length: 10, width: 6, height: 4,
    insideTemp: -18, outsideTemp: 35, soilTemp: 18, insideRH: 85, outsideRH: 55,
    solarCorrection: 3, wallU: 0.24, roofU: 0.24, floorU: 0.30, doorU: 1.8,
    doorWidth: 1.2, doorHeight: 2.2, doorOpenings: 30, doorMinutes: 1, doorProtection: 1,
    altitudeM: 0, atmosphericPressureKPa: 0, infiltrationMethod: 'door', maxSimultaneousDoors: 1, trafficMultiplier: 1,
    dailyProductMass: 1000, inventoryMass: 5000, productInTemp: 5, productOutTemp: -18, productHours: 18,
    packagingPct: 8, packagingCp: 1.8, cpAbove: 3.31, cpBelow: 1.67, latentHeat: 247, freezingPoint: -2.2, respiration: 0,
    peopleCount: 2, peopleHours: 4, peopleWatts: 350, lightingDensity: 8, lightingHours: 6,
    fanWatts: 900, fanHours: 20, fanHeatFraction: 100, pumpWatts: 300, pumpHours: 12, pumpHeatFraction: 0,
    auxiliaryWatts: 500, auxiliaryHours: 4, auxiliaryHeatFraction: 100,
    defrostKw: 6, defrostCount: 3, defrostMinutes: 25, dripMinutes: 0, fanDelayMinutes: 0, defrostFraction: 60,
    runtimeHours: 18, safetyMargin: 10, evapTemp: -25, condTemp: 45, carnotEfficiency: 38, electricRate: 2.65,
    refrigerant: 'R404A', systemType: 'Expansion directa'
  };
}

run('psicrometria usa Buck sobre agua y sobre hielo', () => {
  approx(engine.saturationPressureKPa(20), satBuckKPa(20), 1e-12, 'presion saturacion agua kPa');
  approx(engine.saturationPressureKPa(-10), satBuckKPa(-10), 1e-12, 'presion saturacion hielo kPa');
});

run('transmision resta puertas, usa U por puerta y temperatura de suelo', () => {
  const data = {
    length: 10, width: 5, height: 4,
    insideTemp: -5, outsideTemp: 35, solarCorrection: 2, soilTemp: 15,
    wallU: 0.25, roofU: 0.20, floorU: 0.30,
    doors: [
      { width: 2, height: 2, uValue: 1.6 },
      { width: 1, height: 2, uValue: 2.0 }
    ]
  };
  const result = engine.transmissionLoad(data);
  const floorAreaM2 = 10 * 5;
  const grossWallAreaM2 = 2 * (10 * 4 + 5 * 4);
  const doorAreaM2 = 2 * 2 + 1 * 2;
  const netWallAreaM2 = grossWallAreaM2 - doorAreaM2;
  const deltaWallK = 35 + 2 - (-5);
  const deltaFloorK = 15 - (-5);
  const wallsKwhDay = 0.25 * netWallAreaM2 * deltaWallK * 24 / 1000;
  const roofKwhDay = 0.20 * floorAreaM2 * deltaWallK * 24 / 1000;
  const floorKwhDay = 0.30 * floorAreaM2 * deltaFloorK * 24 / 1000;
  const doorKwhDay = (1.6 * 4 + 2.0 * 2) * deltaWallK * 24 / 1000;
  approx(result.walls, wallsKwhDay, 1e-9, 'muros kWh/dia');
  approx(result.door, doorKwhDay, 1e-9, 'puertas kWh/dia');
  approx(result.energy, wallsKwhDay + roofKwhDay + floorKwhDay + doorKwhDay, 1e-9, 'transmision total kWh/dia');
});

run('duplicar area duplica transmision de muros si todo lo demas es igual', () => {
  const a = engine.transmissionLoad({ length: 10, width: 5, height: 4, insideTemp: 0, outsideTemp: 30, solarCorrection: 0, soilTemp: 0, wallU: 0.2, roofU: 0, floorU: 0, doorWidth: 0, doorHeight: 0, doorU: 0 });
  const b = engine.transmissionLoad({ length: 20, width: 10, height: 4, insideTemp: 0, outsideTemp: 30, solarCorrection: 0, soilTemp: 0, wallU: 0.2, roofU: 0, floorU: 0, doorWidth: 0, doorHeight: 0, doorU: 0 });
  approx(b.walls / a.walls, 2, 1e-12, 'relacion area muros');
});

run('producto sensible sobre congelacion usa kg kJ/kgK K dividido entre 3600', () => {
  const result = engine.productThermalEnergy({ dailyProductMass: 100, productInTemp: 10, productOutTemp: 2, freezingPoint: -1, cpAbove: 3.8, cpBelow: 1.8, latentHeat: 250 });
  approx(result.totalKwh, 100 * 3.8 * 8 / 3600, 1e-12, 'producto sensible kWh/dia');
  approx(result.latent, 0, 1e-12, 'latente kJ');
});

run('congelacion completa suma sensible superior, latente completo y sensible inferior', () => {
  const result = engine.productThermalEnergy({ dailyProductMass: 100, productInTemp: 5, productOutTemp: -10, freezingPoint: -2, cpAbove: 3.6, cpBelow: 1.8, latentHeat: 250 });
  const expectedKwh = (100 * 3.6 * 7 + 100 * 250 + 100 * 1.8 * 8) / 3600;
  approx(result.totalKwh, expectedKwh, 1e-12, 'congelacion completa kWh/dia');
});

run('duplicar masa duplica carga de producto y masa cero produce cero', () => {
  const data = { dailyProductMass: 100, productInTemp: 5, productOutTemp: -10, freezingPoint: -2, cpAbove: 3.6, cpBelow: 1.8, latentHeat: 250 };
  const a = engine.productThermalEnergy(data).totalKwh;
  const b = engine.productThermalEnergy({ ...data, dailyProductMass: 200 }).totalKwh;
  approx(b / a, 2, 1e-12, 'doble masa');
  approx(engine.productThermalEnergy({ ...data, dailyProductMass: 0 }).totalKwh, 0, 1e-12, 'cero masa');
});

run('empaque usa masa diaria entrante y Cp del empaque', () => {
  const result = engine.packagingEnergy({ dailyProductMass: 1000, packagingPct: 10, packagingCp: 1.5, productInTemp: 25, productOutTemp: 0 });
  approx(result.packagingMass, 100, 1e-12, 'masa empaque kg/dia');
  approx(result.energy, 100 * 1.5 * 25 / 3600, 1e-12, 'empaque kWh/dia');
});

run('respiracion usa inventario almacenado', () => {
  const result = engine.respirationEnergy({ inventoryMass: 5000, respiration: 20 });
  approx(result.energy, 20 * 5 * 24 / 1000, 1e-12, 'respiracion kWh/dia');
});

run('infiltracion por puerta reporta volumen, masa, entalpia, sensible y latente', () => {
  const data = { doorWidth: 1, doorHeight: 2, doorOpenings: 10, doorMinutes: 1, doorProtection: 0.5, maxSimultaneousDoors: 1, trafficMultiplier: 1, insideTemp: 0, outsideTemp: 30, insideRH: 80, outsideRH: 50, atmosphericPressureKPa: 101.325 };
  const result = engine.infiltrationLoad(data);
  const velocityMS = 0.5 * Math.sqrt(2 * 9.81 * 2 * 30 / 273.15);
  const volumeM3Day = 2 * velocityMS * 600 * 0.5;
  const massKgDay = volumeM3Day * dryDensity(30, 50, 101.325);
  const expected = massKgDay * Math.max(0, enthalpy(30, 50, 101.325) - enthalpy(0, 80, 101.325)) / 3600;
  approx(result.infiltratedVolume, volumeM3Day, 1e-9, 'volumen m3/dia');
  approx(result.massDryAir, massKgDay, 1e-9, 'masa aire seco kg/dia');
  approx(result.energy, expected, 1e-9, 'infiltracion kWh/dia');
});

run('cero diferencia de entalpia produce cero infiltracion', () => {
  const result = engine.infiltrationLoad({ infiltrationMethod: 'measuredVolume', measuredInfiltrationM3Day: 100, insideTemp: 10, outsideTemp: 10, insideRH: 50, outsideRH: 50, atmosphericPressureKPa: 101.325 });
  approx(result.energy, 0, 1e-12, 'infiltracion cero');
});

run('personas, iluminacion, ventiladores, bombas, auxiliares y deshielo separan termico y electrico', () => {
  approx(engine.peopleLoad({ peopleCount: 3, peopleWatts: 400, peopleHours: 2 }), 3 * 400 * 2 / 1000, 1e-12, 'personas kWh/dia');
  approx(engine.lightingLoad({ length: 10, width: 5, lightingDensity: 8, lightingHours: 6 }), 10 * 5 * 8 * 6 / 1000, 1e-12, 'iluminacion kWh/dia');
  assert.deepEqual(engine.fanLoad({ fanWatts: 900, fanHours: 20, fanHeatFraction: 100 }), { thermal: 18, electric: 18 });
  assert.deepEqual(engine.pumpLoad({ pumpWatts: 1000, pumpHours: 10, pumpHeatFraction: 25 }), { thermal: 2.5, electric: 10 });
  assert.deepEqual(engine.auxiliaryLoad({ auxiliaryWatts: 500, auxiliaryHours: 4, auxiliaryHeatFraction: 50 }), { thermal: 1, electric: 2 });
  assert.deepEqual(engine.defrostLoad({ defrostKw: 6, defrostCount: 3, defrostMinutes: 20, defrostFraction: 50 }), { thermal: 3, electric: 6 });
});

run('deshielo reduce disponibilidad neta', () => {
  const result = engine.defrostAvailability({ runtimeHours: 20, defrostCount: 2, defrostMinutes: 20, dripMinutes: 10, fanDelayMinutes: 5 });
  approx(result.unavailableHours, 2 * 35 / 60, 1e-12, 'horas no disponibles');
  approx(result.availableHours, 20 - 70 / 60, 1e-12, 'horas netas');
});

run('margen, conversiones y consumo mensual', () => {
  approx(engine.applyDesignMargin(10, 10), 11, 1e-12, 'margen 10%');
  const conv = engine.convertCapacity(10);
  approx(conv.btu, 10 * 3412.142, 1e-9, 'BTU/h');
  approx(conv.tr, 10 / 3.5168525, 1e-9, 'TR');
  const monthly = engine.monthlyConsumption(120, 2.4, 26, 30);
  approx(monthly.monthlyKwh, (120 / 2.4 + 26) * 30, 1e-12, 'kWh/mes');
});

run('validaciones obligatorias incluyen T_evaporacion menor que T_interior', () => {
  assert.deepEqual(engine.validateData(baseData()), []);
  const errors = engine.validateData({ ...baseData(), evapTemp: -10 });
  assert.ok(errors.includes('La temperatura de evaporación debe ser menor que la temperatura interior.'));
  const doorErrors = engine.validateData({ ...baseData(), doors: [{ name: 'Puerta imposible', width: 100, height: 100, uValue: 2 }] });
  assert.ok(doorErrors.includes('El área de puertas no puede exceder el área total de muros.'));
});

run('cambiar refrigerante no modifica carga termica y cambiar COP modifica consumo', () => {
  const a = engine.calculate(baseData());
  const b = engine.calculate({ ...baseData(), refrigerant: 'R717', systemType: 'Dos etapas' });
  approx(a.totalEnergy, b.totalEnergy, 1e-9, 'carga independiente de refrigerante');
  const c = engine.calculate({ ...baseData(), explicitCop: 3 });
  approx(a.totalEnergy, c.totalEnergy, 1e-9, 'carga independiente de COP');
  assert.notEqual(a.monthlyConsumption, c.monthlyConsumption);
});

run('ningun resultado principal es NaN, infinito o negativo', () => {
  const result = engine.calculate(baseData());
  assert.deepEqual(result.validationProblems, []);
});

run('migracion conserva proyectos anteriores', () => {
  const old = { data: { productMass: 1000, outsideTemp: 30, wallU: 0.3, otherWatts: 100, otherHours: 2 }, result: { data: { productMass: 1000 } } };
  const migrated = engine.migrateProjectRecord(old);
  assert.equal(migrated.schemaVersion, engine.SCHEMA_VERSION);
  assert.equal(migrated.data.dailyProductMass, 1000);
  assert.equal(migrated.data.inventoryMass, 1000);
  assert.equal(migrated.data.auxiliaryWatts, 100);
});

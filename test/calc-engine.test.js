const assert = require('node:assert/strict');
const engine = require('../calc-engine');

function approx(actual, expected, tolerance = 1e-6, message = '') {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message} expected ${expected}, got ${actual}`);
}

function saturationPressureKPa(tempC) {
  return 0.61078 * Math.exp((17.2694 * tempC) / (tempC + 237.29));
}

function humidityRatio(tempC, rhPct, pressureKPa) {
  const pv = Math.max(0, Math.min(100, rhPct)) / 100 * saturationPressureKPa(tempC);
  return 0.62198 * pv / Math.max(0.1, pressureKPa - pv);
}

function moistAirEnthalpy(tempC, rhPct, pressureKPa) {
  const w = humidityRatio(tempC, rhPct, pressureKPa);
  return 1.006 * tempC + w * (2501 + 1.86 * tempC);
}

function dryAirDensity(tempC, rhPct, pressureKPa) {
  const w = humidityRatio(tempC, rhPct, pressureKPa);
  return (pressureKPa * 1000) / (287.055 * (tempC + 273.15) * (1 + 1.6078 * w));
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

run('transmisión resta puerta, usa U de puerta y temperatura de suelo', () => {
  const data = {
    length: 10, width: 5, height: 4,
    insideTemp: -5, outsideTemp: 35, solarCorrection: 2, soilTemp: 15,
    wallU: 0.25, roofU: 0.20, floorU: 0.30, doorU: 1.60,
    doorWidth: 2, doorHeight: 2
  };
  const result = engine.transmissionLoad(data);
  const floorAreaM2 = 10 * 5;
  const grossWallAreaM2 = 2 * (10 * 4 + 5 * 4);
  const doorAreaM2 = 2 * 2;
  const netWallAreaM2 = grossWallAreaM2 - doorAreaM2;
  const deltaWallK = 35 + 2 - (-5);
  const deltaFloorK = 15 - (-5);
  const wallsKwhDay = 0.25 * netWallAreaM2 * deltaWallK * 24 / 1000;
  const roofKwhDay = 0.20 * floorAreaM2 * deltaWallK * 24 / 1000;
  const floorKwhDay = 0.30 * floorAreaM2 * deltaFloorK * 24 / 1000;
  const doorKwhDay = 1.60 * doorAreaM2 * deltaWallK * 24 / 1000;
  approx(result.walls, wallsKwhDay, 1e-9, 'muros kWh/día');
  approx(result.door, doorKwhDay, 1e-9, 'puerta kWh/día');
  approx(result.energy, wallsKwhDay + roofKwhDay + floorKwhDay + doorKwhDay, 1e-9, 'transmisión kWh/día');
});

run('producto sobre congelación usa solo calor sensible superior', () => {
  const data = { dailyProductMass: 100, productInTemp: 10, productOutTemp: 2, freezingPoint: -1, cpAbove: 3.8, cpBelow: 1.8, latentHeat: 250 };
  const result = engine.productThermalEnergy(data);
  const expectedKwh = 100 * 3.8 * (10 - 2) / 3600; // kg * kJ/kgK * K = kJ; /3600 = kWh
  approx(result.totalKwh, expectedKwh, 1e-9, 'producto sensible kWh/día');
  approx(result.latent, 0, 1e-12, 'latente kJ');
});

run('producto cruzando congelación suma sensible superior, latente y sensible inferior', () => {
  const data = { dailyProductMass: 100, productInTemp: 5, productOutTemp: -10, freezingPoint: -2, cpAbove: 3.6, cpBelow: 1.8, latentHeat: 250 };
  const result = engine.productThermalEnergy(data);
  const sensibleAboveKJ = 100 * 3.6 * (5 - (-2));
  const latentKJ = 100 * 250;
  const sensibleBelowKJ = 100 * 1.8 * ((-2) - (-10));
  const expectedKwh = (sensibleAboveKJ + latentKJ + sensibleBelowKJ) / 3600;
  approx(result.totalKwh, expectedKwh, 1e-9, 'producto cruzando congelación kWh/día');
  approx(result.sensibleAbove, sensibleAboveKJ, 1e-9, 'sensible superior kJ');
  approx(result.latent, latentKJ, 1e-9, 'latente kJ');
  approx(result.sensibleBelow, sensibleBelowKJ, 1e-9, 'sensible inferior kJ');
});

run('empaque usa masa diaria entrante y Cp del empaque', () => {
  const data = { dailyProductMass: 1000, packagingPct: 10, packagingCp: 1.5, productInTemp: 25, productOutTemp: 0 };
  const result = engine.packagingEnergy(data);
  const packagingMassKg = 1000 * 0.10;
  const expectedKwh = packagingMassKg * 1.5 * 25 / 3600;
  approx(result.packagingMass, packagingMassKg, 1e-9, 'masa empaque kg/día');
  approx(result.energy, expectedKwh, 1e-9, 'empaque kWh/día');
});

run('respiración usa inventario almacenado, no masa entrante diaria', () => {
  const result = engine.respirationEnergy({ inventoryMass: 5000, respiration: 20 });
  const expectedKwh = 20 * (5000 / 1000) * 24 / 1000; // W/t * t * h /1000 = kWh/día
  approx(result.energy, expectedKwh, 1e-9, 'respiración kWh/día');
});

run('infiltración usa presión atmosférica y entalpía de aire húmedo', () => {
  const data = {
    doorWidth: 1, doorHeight: 2, doorOpenings: 10, doorMinutes: 1, doorProtection: 0.5,
    insideTemp: 0, outsideTemp: 30, insideRH: 80, outsideRH: 50, atmosphericPressureKPa: 101.325
  };
  const result = engine.infiltrationLoad(data);
  const areaM2 = 1 * 2;
  const velocityMS = 0.5 * Math.sqrt(2 * 9.81 * 2 * Math.abs(30 - 0) / (0 + 273.15));
  const volumeM3Day = areaM2 * velocityMS * (10 * 1 * 60) * 0.5;
  const massDryAirKgDay = volumeM3Day * dryAirDensity(30, 50, 101.325);
  const deltaHKJkg = Math.max(0, moistAirEnthalpy(30, 50, 101.325) - moistAirEnthalpy(0, 80, 101.325));
  const expectedKwh = massDryAirKgDay * deltaHKJkg / 3600;
  approx(result.infiltratedVolume, volumeM3Day, 1e-9, 'volumen infiltrado m³/día');
  approx(result.energy, expectedKwh, 1e-9, 'infiltración kWh/día');
});

run('personas convierten W por horas a kWh/día', () => {
  const expectedKwh = 3 * 400 * 2 / 1000;
  approx(engine.peopleLoad({ peopleCount: 3, peopleWatts: 400, peopleHours: 2 }), expectedKwh, 1e-12, 'personas kWh/día');
});

run('iluminación usa área de piso por densidad y horas', () => {
  const expectedKwh = (10 * 5) * 8 * 6 / 1000;
  approx(engine.lightingLoad({ length: 10, width: 5, height: 4, lightingDensity: 8, lightingHours: 6 }), expectedKwh, 1e-12, 'iluminación kWh/día');
});

run('ventiladores reportan carga térmica y consumo eléctrico directo', () => {
  const result = engine.fanLoad({ fanWatts: 900, fanHours: 20 });
  const expectedKwh = 900 * 20 / 1000;
  approx(result.thermal, expectedKwh, 1e-12, 'ventiladores térmico kWh/día');
  approx(result.electric, expectedKwh, 1e-12, 'ventiladores eléctrico directo kWh/día');
});

run('deshielo separa energía eléctrica total y fracción liberada al recinto', () => {
  const result = engine.defrostLoad({ defrostKw: 6, defrostCount: 3, defrostMinutes: 20, defrostFraction: 50 });
  const electricKwh = 6 * 3 * 20 / 60;
  const thermalKwh = electricKwh * 0.50;
  approx(result.electric, electricKwh, 1e-12, 'deshielo eléctrico kWh/día');
  approx(result.thermal, thermalKwh, 1e-12, 'deshielo térmico kWh/día');
});

run('margen de diseño se aplica explícitamente a la capacidad base', () => {
  approx(engine.applyDesignMargin(10, 15), 11.5, 1e-12, 'capacidad con margen kW');
});

run('conversiones kW, BTU/h y TR', () => {
  const result = engine.convertCapacity(10);
  approx(result.kw, 10, 1e-12, 'kW');
  approx(result.btu, 10 * 3412.142, 1e-9, 'BTU/h');
  approx(result.tr, 10 / 3.5168525, 1e-9, 'TR');
});

run('consumo mensual usa energía frigorífica diaria, COP y eléctricos directos', () => {
  const result = engine.monthlyConsumption(120, 2.4, 26, 30);
  const compressorKwhDay = 120 / 2.4;
  const totalKwhDay = compressorKwhDay + 26;
  approx(result.compressorKwhDay, compressorKwhDay, 1e-12, 'compresor kWh/día');
  approx(result.totalKwhDay, totalKwhDay, 1e-12, 'total eléctrico kWh/día');
  approx(result.monthlyKwh, totalKwhDay * 30, 1e-12, 'consumo mensual kWh/mes');
});

run('refrigerante, sistema y lift no modifican la carga térmica ni la capacidad de selección', () => {
  const base = {
    length: 10, width: 6, height: 4,
    insideTemp: -18, outsideTemp: 35, soilTemp: 18, insideRH: 85, outsideRH: 55,
    solarCorrection: 3, wallU: 0.24, roofU: 0.24, floorU: 0.30, doorU: 1.8,
    doorWidth: 1.2, doorHeight: 2.2, doorOpenings: 30, doorMinutes: 1, doorProtection: 1,
    altitudeM: 0, atmosphericPressureKPa: 0,
    dailyProductMass: 1000, inventoryMass: 5000, productInTemp: 5, productOutTemp: -18, productHours: 18,
    packagingPct: 8, packagingCp: 1.8, cpAbove: 3.31, cpBelow: 1.67, latentHeat: 247, freezingPoint: -2.2, respiration: 0,
    peopleCount: 2, peopleHours: 4, peopleWatts: 350, lightingDensity: 8, lightingHours: 6,
    fanWatts: 900, fanHours: 20, pumpWatts: 300, pumpHours: 12, otherWatts: 500, otherHours: 4,
    defrostKw: 6, defrostCount: 3, defrostMinutes: 25, defrostFraction: 60,
    runtimeHours: 18, safetyMargin: 10, evapTemp: -25, condTemp: 45, carnotEfficiency: 38, electricRate: 2.65,
    refrigerant: 'R404A', systemType: 'Expansión directa'
  };
  const a = engine.calculate(base);
  const b = engine.calculate({ ...base, refrigerant: 'R717 (NH₃)', systemType: 'Dos etapas', evapTemp: -35, condTemp: 55 });
  approx(a.totalEnergy, b.totalEnergy, 1e-9, 'carga térmica kWh/día');
  approx(a.requiredCapacity, b.requiredCapacity, 1e-9, 'capacidad de selección kW');
  assert.notEqual(a.estimatedCop, b.estimatedCop, 'el lift solo debe reflejarse en desempeño/COP');
});

run('validaciones rechazan rangos imposibles y aceptan un caso completo', () => {
  const valid = {
    length: 10, width: 6, height: 4,
    insideTemp: -18, outsideTemp: 35, soilTemp: 18, insideRH: 85, outsideRH: 55,
    solarCorrection: 3, wallU: 0.24, roofU: 0.24, floorU: 0.30, doorU: 1.8,
    doorWidth: 1.2, doorHeight: 2.2, doorOpenings: 30, doorMinutes: 1, doorProtection: 0.5,
    altitudeM: 0, atmosphericPressureKPa: 0,
    dailyProductMass: 1000, inventoryMass: 5000, productInTemp: 5, productOutTemp: -18, productHours: 18,
    packagingPct: 8, packagingCp: 1.8, cpAbove: 3.31, cpBelow: 1.67, latentHeat: 247, freezingPoint: -2.2, respiration: 0,
    peopleCount: 2, peopleHours: 4, peopleWatts: 350, lightingDensity: 8, lightingHours: 6,
    fanWatts: 900, fanHours: 20, pumpWatts: 300, pumpHours: 12, auxiliaryWatts: 500, auxiliaryHours: 4,
    defrostKw: 6, defrostCount: 3, defrostMinutes: 25, defrostFraction: 60,
    runtimeHours: 18, safetyMargin: 10, evapTemp: -25, condTemp: 45, carnotEfficiency: 38, electricRate: 2.65
  };
  assert.deepEqual(engine.validateData(valid), []);

  const errors = engine.validateData({
    ...valid,
    length: 0,
    doorWidth: 100,
    atmosphericPressureKPa: 40,
    altitudeM: 7000,
    defrostFraction: 120,
    productInTemp: -300,
    auxiliaryWatts: -1,
    fanHours: 25
  });
  assert.ok(errors.includes('El largo debe ser mayor a cero.'));
  assert.ok(errors.includes('El área de puerta no puede exceder el área total de muros.'));
  assert.ok(errors.includes('La presión atmosférica debe estar entre 50 y 110 kPa, o dejarse en 0 para calcularla por altitud.'));
  assert.ok(errors.includes('La altitud debe estar entre -500 y 6000 m.'));
  assert.ok(errors.includes('La fracción de deshielo liberada al recinto debe estar entre 0 y 100%.'));
  assert.ok(errors.includes('Las temperaturas deben ser finitas y estar sobre el cero absoluto.'));
  assert.ok(errors.includes('Las cargas internas, ventiladores, bombas y deshielo no pueden ser negativos.'));
  assert.ok(errors.includes('Las horas diarias de operación no pueden exceder 24 h.'));
});

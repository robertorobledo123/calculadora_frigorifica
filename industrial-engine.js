(function (root, factory) {
  let engine;
  if (typeof module === 'object' && module.exports) {
    engine = factory(require('./calc-engine'));
    module.exports = engine;
  } else {
    engine = factory(root.FrigoCalcEngine);
  }
  root.FrigoIndustrialEngine = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  const ENGINE_VERSION = '2026.06-industrial-ready';
  const WATER_CP_KJ_KG_K = core?.WATER_CP_KJ_KG_K || 4.186;
  const ICE_CP_KJ_KG_K = core?.ICE_CP_KJ_KG_K || 2.05;
  const WATER_LATENT_KJ_KG = core?.WATER_LATENT_KJ_KG || 333.55;

  function finite(value, fallback = 0) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function positive(value, fallback = 0) {
    return Math.max(0, finite(value, fallback));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function fraction(value, fallback = 0) {
    return clamp(finite(value, fallback), 0, 100) / 100;
  }

  function convertCapacity(kw) {
    return core.convertCapacity(kw);
  }

  function applyMargin(kw, marginPct) {
    return core.applyDesignMargin(kw, marginPct);
  }

  function ensureFiniteObject(object, path = 'resultado', errors = []) {
    Object.entries(object || {}).forEach(([key, value]) => {
      const name = `${path}.${key}`;
      if (typeof value === 'number' && !Number.isFinite(value)) errors.push(`${name} no es finito.`);
      if (value && typeof value === 'object' && !Array.isArray(value)) ensureFiniteObject(value, name, errors);
    });
    return errors;
  }

  function partialFreezingEnergy(data) {
    return core.partialFreezingEnergy({
      mass: data.massKg ?? data.mass ?? data.dailyProductMass,
      initialTemp: data.initialTemp ?? data.productInTemp,
      finalTemp: data.finalTemp ?? data.productOutTemp,
      initialFreezingPoint: data.initialFreezingPoint ?? data.freezingPoint,
      cpAbove: data.cpAbove,
      cpBelow: data.cpBelow,
      latentHeat: data.latentHeat,
      initialFrozenFraction: data.initialFrozenFraction,
      finalFrozenFraction: data.finalFrozenFraction
    });
  }

  function packagingLoad(data) {
    const packagingMass = positive(data.productMassKg ?? data.massKg ?? data.batchMassKg ?? data.flowKgH) * fraction(data.packagingPct);
    const deltaT = Math.abs(finite(data.initialTemp) - finite(data.finalTemp));
    const energyKwh = packagingMass * positive(data.packagingCp) * deltaT / 3600;
    return { packagingMass, deltaT, energyKwh };
  }

  function motorLoad(powerKw, hours, heatFractionPct = 100) {
    const electricKwh = positive(powerKw) * positive(hours);
    return {
      electricKwh,
      thermalKwh: electricKwh * fraction(heatFractionPct, 100),
      thermalKw: positive(powerKw) * fraction(heatFractionPct, 100)
    };
  }

  function defrostAvailability(data) {
    const events = positive(data.defrostCount);
    const minutesPerEvent = positive(data.defrostMinutes) + positive(data.dripMinutes) + positive(data.fanDelayMinutes);
    const unavailableHours = events * minutesPerEvent / 60 + positive(data.extraDowntimeHours);
    const availableHours = Math.max(0, positive(data.availableHours ?? data.operationHours ?? data.runtimeHours, 24) - unavailableHours);
    const electricKwh = positive(data.defrostKw) * events * positive(data.defrostMinutes) / 60;
    const thermalKwh = electricKwh * fraction(data.defrostHeatFraction);
    const recoveryCapacityKw = positive(data.recoveryLoadKw);
    return { events, minutesPerEvent, unavailableHours, availableHours, electricKwh, thermalKwh, recoveryCapacityKw };
  }

  function blastFreezer(data) {
    const batchMassKg = positive(data.batchMassKg);
    const batchesPerDay = positive(data.batchesPerDay);
    const pullDownHours = Math.max(0.01, positive(data.pullDownHours));
    const loadingHours = positive(data.loadingHours);
    const recoveryHours = positive(data.recoveryHours);
    const cycleHours = pullDownHours + loadingHours + recoveryHours;
    const availability = defrostAvailability(data);
    const maxBatchesPerDay = cycleHours > 0 ? Math.floor(availability.availableHours / cycleHours) : 0;
    const product = partialFreezingEnergy({ ...data, massKg: batchMassKg });
    const packaging = packagingLoad({ ...data, productMassKg: batchMassKg });
    const fan = motorLoad(data.fanKw, pullDownHours * batchesPerDay, data.fanHeatFraction);
    const processAux = motorLoad(data.processAuxKw, pullDownHours * batchesPerDay, data.processAuxHeatFraction);
    const lossesDailyKwh = positive(data.additionalLossesKw) * positive(data.availableHours ?? 24);
    const energyPerBatchKwh = product.totalKwh + packaging.energyKwh;
    const processThermalDailyKwh = fan.thermalKwh + processAux.thermalKwh + lossesDailyKwh + availability.thermalKwh;
    const thermalEnergyDailyKwh = energyPerBatchKwh * batchesPerDay + processThermalDailyKwh;
    const processCapacityKw = energyPerBatchKwh / pullDownHours + fan.thermalKw + processAux.thermalKw + positive(data.additionalLossesKw);
    const averageCapacityKw = availability.availableHours > 0 ? thermalEnergyDailyKwh / availability.availableHours : Infinity;
    const recoveryCapacityKw = availability.recoveryCapacityKw;
    const baseCapacityKw = Math.max(averageCapacityKw, processCapacityKw, recoveryCapacityKw);
    const selectionCapacityKw = applyMargin(baseCapacityKw, data.designMarginPct);
    const directElectricKwhDay = fan.electricKwh + processAux.electricKwh + availability.electricKwh;
    return {
      scenario: 'blast',
      engineVersion: ENGINE_VERSION,
      product,
      packaging,
      energyPerBatchKwh,
      thermalEnergyDailyKwh,
      averageCapacityKw,
      processCapacityKw,
      recoveryCapacityKw,
      baseCapacityKw,
      selectionCapacityKw,
      conversions: convertCapacity(selectionCapacityKw),
      maxBatchesPerDay,
      cycleHours,
      availability,
      directElectricKwhDay,
      loads: {
        productKwhDay: product.totalKwh * batchesPerDay,
        packagingKwhDay: packaging.energyKwh * batchesPerDay,
        fanThermalKwhDay: fan.thermalKwh,
        processAuxThermalKwhDay: processAux.thermalKwh,
        defrostThermalKwhDay: availability.thermalKwh,
        lossesDailyKwh
      },
      electric: {
        fanKwhDay: fan.electricKwh,
        processAuxKwhDay: processAux.electricKwh,
        defrostKwhDay: availability.electricKwh,
        totalKwhDay: directElectricKwhDay
      },
      warnings: maxBatchesPerDay < batchesPerDay ? ['Los lotes diarios solicitados exceden el máximo por disponibilidad.'] : []
    };
  }

  function glazingLoad(data) {
    const waterKgH = positive(data.glazingWaterKgH);
    const waterTemp = finite(data.glazingWaterTempC);
    const finalTemp = finite(data.finalTemp);
    const frozenFraction = fraction(data.glazingFrozenPct);
    const sensibleWaterKw = waterKgH * WATER_CP_KJ_KG_K * Math.max(0, waterTemp - 0) / 3600;
    const latentWaterKw = waterKgH * WATER_LATENT_KJ_KG * frozenFraction / 3600;
    const iceCoolingKw = waterKgH * ICE_CP_KJ_KG_K * Math.max(0, -finalTemp) * frozenFraction / 3600;
    return {
      sensibleWaterKw,
      latentWaterKw,
      iceCoolingKw,
      totalKw: sensibleWaterKw + latentWaterKw + iceCoolingKw
    };
  }

  function iqf(data) {
    const flowKgH = positive(data.flowKgH);
    const operationHours = positive(data.operationHours);
    const product = partialFreezingEnergy({ ...data, massKg: flowKgH });
    const packaging = packagingLoad({ ...data, productMassKg: flowKgH });
    const glazing = glazingLoad(data);
    const fan = motorLoad(data.fanKw, operationHours, data.fanHeatFraction);
    const belt = motorLoad(data.beltKw, operationHours, data.beltHeatFraction);
    const vibrator = motorLoad(data.vibratorKw, operationHours, data.vibratorHeatFraction);
    const auxiliary = motorLoad(data.auxiliaryKw, operationHours, data.auxiliaryHeatFraction);
    const availability = defrostAvailability({ ...data, availableHours: operationHours });
    const productKw = flowKgH * product.specificKwhKg;
    const packagingKw = packaging.energyKwh;
    const processCapacityKw = productKw + packagingKw + glazing.totalKw + fan.thermalKw + belt.thermalKw + vibrator.thermalKw + auxiliary.thermalKw + positive(data.additionalLossesKw);
    const thermalEnergyDailyKwh = processCapacityKw * operationHours + availability.thermalKwh;
    const availableHours = Math.max(0.01, operationHours - availability.unavailableHours);
    const averageCapacityKw = thermalEnergyDailyKwh / availableHours;
    const baseCapacityKw = Math.max(processCapacityKw, averageCapacityKw, availability.recoveryCapacityKw);
    const selectionCapacityKw = applyMargin(baseCapacityKw, data.designMarginPct);
    const directElectricKwhDay = fan.electricKwh + belt.electricKwh + vibrator.electricKwh + auxiliary.electricKwh + availability.electricKwh;
    return {
      scenario: 'iqf',
      engineVersion: ENGINE_VERSION,
      product,
      packaging,
      glazing,
      productKw,
      packagingKw,
      processCapacityKw,
      thermalEnergyDailyKwh,
      averageCapacityKw,
      baseCapacityKw,
      selectionCapacityKw,
      conversions: convertCapacity(selectionCapacityKw),
      availability,
      directElectricKwhDay,
      rejectionHeatKw: data.cop > 0 ? selectionCapacityKw + selectionCapacityKw / positive(data.cop) : null,
      loads: {
        productKw,
        packagingKw,
        glazingKw: glazing.totalKw,
        fanKw: fan.thermalKw,
        beltKw: belt.thermalKw,
        vibratorKw: vibrator.thermalKw,
        auxiliaryKw: auxiliary.thermalKw,
        lossesKw: positive(data.additionalLossesKw),
        defrostThermalKwhDay: availability.thermalKwh
      },
      electric: {
        fanKwhDay: fan.electricKwh,
        beltKwhDay: belt.electricKwh,
        vibratorKwhDay: vibrator.electricKwh,
        auxiliaryKwhDay: auxiliary.electricKwh,
        defrostKwhDay: availability.electricKwh,
        totalKwhDay: directElectricKwhDay
      },
      warnings: availability.availableHours <= 0 ? ['Las horas netas no pueden ser menores o iguales a cero.'] : []
    };
  }

  function secondaryFluid(data) {
    const flowM3H = positive(data.flowM3H);
    const pressureDropKPa = positive(data.pressureDropKPa);
    const pumpEfficiency = Math.max(0.01, fraction(data.pumpEfficiencyPct, 60));
    const motorEfficiency = Math.max(0.01, fraction(data.motorEfficiencyPct, 90));
    const hydraulicKw = (flowM3H / 3600) * (pressureDropKPa * 1000) / 1000;
    const electricKw = hydraulicKw / (pumpEfficiency * motorEfficiency);
    const heatToColdKw = electricKw * fraction(data.heatToColdPct);
    const pumpEnergyKwhDay = electricKw * positive(data.operationHours);
    const density = positive(data.densityKgM3);
    const cp = positive(data.cpKjKgK);
    const deltaT = Math.max(0, finite(data.returnTempC) - finite(data.supplyTempC));
    const massFlowKgS = flowM3H / 3600 * density;
    const transportedCapacityKw = density > 0 && cp > 0 ? massFlowKgS * cp * deltaT : 0;
    const requiredCapacityKw = positive(data.requiredCapacityKw);
    const gainsKw = positive(data.pipeGainKw) + positive(data.tankGainKw);
    const deficitKw = Math.max(0, requiredCapacityKw - transportedCapacityKw);
    return {
      scenario: 'secondary',
      hydraulicKw,
      electricKw,
      heatToColdKw,
      pumpEnergyKwhDay,
      transportedCapacityKw,
      gainsKw,
      deficitKw,
      warnings: deficitKw > 0 ? ['El flujo secundario es insuficiente para la capacidad requerida.'] : []
    };
  }

  function pumpedAmmonia(data) {
    const evaporatorCapacityKw = positive(data.evaporatorCapacityKw) * positive(data.evaporatorCount, 1) * fraction(data.simultaneityPct, 100);
    const refrigerationEffectKjKg = Math.max(0.01, positive(data.refrigerationEffectKjKg));
    const recirculationRatio = positive(data.recirculationRatio, 1);
    const liquidDensityKgM3 = Math.max(0.01, positive(data.liquidDensityKgM3));
    const vaporMassFlowKgS = evaporatorCapacityKw / refrigerationEffectKjKg;
    const circulatedMassFlowKgS = vaporMassFlowKgS * recirculationRatio;
    const requiredFlowM3H = circulatedMassFlowKgS / liquidDensityKgM3 * 3600;
    const selectedFlowM3H = positive(data.selectedPumpFlowM3H);
    const selectedToRequiredRatio = requiredFlowM3H > 0 ? selectedFlowM3H / requiredFlowM3H : 0;
    const pump = secondaryFluid({
      flowM3H: selectedFlowM3H,
      pressureDropKPa: data.pressureDropKPa,
      pumpEfficiencyPct: data.pumpEfficiencyPct,
      motorEfficiencyPct: data.motorEfficiencyPct,
      heatToColdPct: data.heatToRefrigerantPct,
      operationHours: data.operationHours,
      densityKgM3: liquidDensityKgM3,
      cpKjKgK: 0,
      supplyTempC: 0,
      returnTempC: 0,
      requiredCapacityKw: 0
    });
    return {
      scenario: 'ammonia',
      evaporatorCapacityKw,
      vaporMassFlowKgS,
      circulatedMassFlowKgS,
      requiredFlowM3H,
      selectedFlowM3H,
      selectedToRequiredRatio,
      pumpElectricKw: pump.electricKw,
      pumpHeatKw: pump.heatToColdKw,
      pumpEnergyKwhDay: pump.pumpEnergyKwhDay,
      warnings: selectedToRequiredRatio < 1 ? ['El flujo seleccionado de bomba no cubre el flujo requerido.'] : ['Módulo preliminar; no sustituye diseño de tuberías, recipientes ni seguridad de R717.']
    };
  }

  function performanceFromData(data) {
    const method = data.performanceMethod || 'manufacturerCop';
    let cop = 0;
    const warnings = [];
    if (method === 'carnot') {
      return { method, cop: 0, compressorKw: 0, rejectionHeatKw: 0, warnings: ['CO2 transcrítico no acepta método Carnot ni temperatura de condensación ficticia.'] };
    }
    if (method === 'manufacturerCop') {
      cop = positive(data.certifiedCop);
      if (!cop) warnings.push('Falta COP certificado del fabricante.');
    } else if (method === 'nominalCapacityPower') {
      cop = positive(data.nominalCapacityKw) / Math.max(0.01, positive(data.nominalPowerKw));
    } else if (method === 'specificEnthalpy') {
      cop = positive(data.refrigerationEffectKjKg) / Math.max(0.01, positive(data.specificWorkKjKg));
    } else if (method === 'performanceTable') {
      cop = positive(data.tableCapacityKw) / Math.max(0.01, positive(data.tablePowerKw));
      if (!data.catalogConditions || !data.dataSource) warnings.push('La tabla importada debe conservar condiciones y fuente del punto.');
    }
    const requiredCapacityKw = positive(data.requiredCapacityKw);
    const compressorKw = cop > 0 ? requiredCapacityKw / cop : 0;
    return {
      method,
      cop,
      compressorKw,
      compressorKwhDay: compressorKw * positive(data.operationHours, 24),
      rejectionHeatKw: requiredCapacityKw + compressorKw,
      source: data.dataSource || 'Dato introducido por el usuario',
      catalogConditions: data.catalogConditions || '',
      warnings
    };
  }

  function transcriticalCo2(data) {
    const perf = performanceFromData(data);
    const warnings = [
      'El resultado depende del punto real de gas cooler y del control de presión de alta.',
      ...perf.warnings
    ];
    return {
      scenario: 'co2',
      highPressureBar: positive(data.highPressureBar),
      gasCoolerOutletTempC: finite(data.gasCoolerOutletTempC),
      evaporatingTempC: finite(data.evaporatingTempC),
      superheatK: positive(data.superheatK),
      performance: perf,
      warnings
    };
  }

  function twoStagePerformance(data) {
    const perf = performanceFromData(data);
    const lowStageKw = positive(data.lowStagePowerKw);
    const highStageKw = positive(data.highStagePowerKw);
    const totalCatalogPowerKw = lowStageKw + highStageKw;
    const requiredCapacityKw = positive(data.requiredCapacityKw);
    const catalogCop = totalCatalogPowerKw > 0 ? positive(data.totalCapacityKw || requiredCapacityKw) / totalCatalogPowerKw : 0;
    const cop = catalogCop || perf.cop;
    const compressorKw = cop > 0 ? requiredCapacityKw / cop : 0;
    const warnings = [];
    if (!catalogCop && !perf.cop) warnings.push('Faltan datos de fabricante; se requiere COP explícito o potencia/capacidad de catálogo.');
    return {
      scenario: 'two-stage',
      cop,
      compressorKw,
      compressorKwhDay: compressorKw * positive(data.operationHours, 24),
      rejectionHeatKw: requiredCapacityKw + compressorKw,
      intermediateTempC: data.intermediateTempC,
      lowStagePowerKw: lowStageKw,
      highStagePowerKw: highStageKw,
      intercooling: Boolean(data.intercooling),
      economizer: Boolean(data.economizer),
      warnings
    };
  }

  function calculateIndustrial(data) {
    const scenario = data.scenario || data.scenarioType || 'blast';
    if (scenario === 'iqf') return iqf(data);
    if (scenario === 'secondary') return secondaryFluid(data);
    if (scenario === 'ammonia') return pumpedAmmonia(data);
    if (scenario === 'co2') return transcriticalCo2(data);
    if (scenario === 'two-stage') return twoStagePerformance(data);
    return blastFreezer(data);
  }

  function validateIndustrial(data) {
    const errors = [];
    const scenario = data.scenario || data.scenarioType || 'blast';
    ['initialFrozenFraction', 'finalFrozenFraction', 'fanHeatFraction', 'processAuxHeatFraction', 'beltHeatFraction', 'vibratorHeatFraction', 'auxiliaryHeatFraction', 'defrostHeatFraction', 'heatToColdPct', 'heatToRefrigerantPct', 'pumpEfficiencyPct', 'motorEfficiencyPct'].forEach(key => {
      if (data[key] == null) return;
      const value = Number(data[key]);
      if (!Number.isFinite(value) || value < 0 || value > 100) errors.push('Las fracciones y eficiencias deben estar entre 0 y 100%.');
    });
    if (Number(data.finalFrozenFraction ?? 0) < Number(data.initialFrozenFraction ?? 0)) errors.push('La fracción congelada final debe ser mayor o igual que la inicial.');
    if (scenario === 'blast' && positive(data.pullDownHours) <= 0) errors.push('El tiempo de abatimiento por lote debe ser mayor a cero.');
    if (scenario === 'iqf' && positive(data.flowKgH) < 0) errors.push('El flujo IQF no puede ser negativo.');
    if (scenario === 'secondary' && positive(data.flowM3H) === 0 && positive(data.pressureDropKPa) > 0) errors.push('El caudal secundario debe ser mayor a cero para calcular potencia hidráulica.');
    if ((scenario === 'co2' || scenario === 'two-stage') && (data.performanceMethod || '') === 'carnot') errors.push('Este escenario no permite desempeño por Carnot.');
    if (data.evapTemp != null && data.insideTemp != null && finite(data.evapTemp) >= finite(data.insideTemp)) errors.push('La temperatura de evaporación debe ser menor que la temperatura interior.');
    const result = calculateIndustrial(data);
    ensureFiniteObject(result).forEach(error => errors.push(error));
    return [...new Set(errors)];
  }

  return {
    ENGINE_VERSION,
    finite,
    positive,
    clamp,
    fraction,
    convertCapacity,
    applyMargin,
    ensureFiniteObject,
    partialFreezingEnergy,
    packagingLoad,
    motorLoad,
    defrostAvailability,
    blastFreezer,
    glazingLoad,
    iqf,
    secondaryFluid,
    pumpedAmmonia,
    performanceFromData,
    transcriticalCo2,
    twoStagePerformance,
    calculateIndustrial,
    validateIndustrial
  };
});

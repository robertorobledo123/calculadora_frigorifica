(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FrigoCalcEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const KW_TO_BTUH = 3412.142;
  const KW_PER_TR = 3.5168525;
  const STANDARD_PRESSURE_KPA = 101.325;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function finite(value, fallback = 0) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function positive(value, fallback = 0) {
    return Math.max(0, finite(value, fallback));
  }

  function pressureFromAltitude(altitudeM = 0) {
    const altitude = finite(altitudeM, 0);
    return STANDARD_PRESSURE_KPA * Math.pow(Math.max(0.01, 1 - 2.25577e-5 * altitude), 5.25588);
  }

  function pressureKPa(data = {}) {
    const pressure = finite(data.atmosphericPressureKPa, 0);
    if (pressure > 0) return pressure;
    return pressureFromAltitude(data.altitudeM || 0);
  }

  function saturationPressureKPa(tempC) {
    return 0.61078 * Math.exp((17.2694 * tempC) / (tempC + 237.29));
  }

  function humidityRatio(tempC, rhPct, pressure = STANDARD_PRESSURE_KPA) {
    const pv = clamp(finite(rhPct, 0), 0, 100) / 100 * saturationPressureKPa(tempC);
    return 0.62198 * pv / Math.max(0.1, pressure - pv);
  }

  function moistAirEnthalpy(tempC, rhPct, pressure = STANDARD_PRESSURE_KPA) {
    const w = humidityRatio(tempC, rhPct, pressure);
    return 1.006 * tempC + w * (2501 + 1.86 * tempC);
  }

  function dryAirDensity(tempC, rhPct, pressure = STANDARD_PRESSURE_KPA) {
    const w = humidityRatio(tempC, rhPct, pressure);
    return (pressure * 1000) / (287.055 * (tempC + 273.15) * (1 + 1.6078 * w));
  }

  function geometry(data) {
    const length = positive(data.length);
    const width = positive(data.width);
    const height = positive(data.height);
    const floorArea = length * width;
    const grossWallArea = 2 * (length * height + width * height);
    const doorArea = Math.min(grossWallArea, positive(data.doorWidth) * positive(data.doorHeight));
    const netWallArea = Math.max(0, grossWallArea - doorArea);
    const roofArea = floorArea;
    return {
      length,
      width,
      height,
      floorArea,
      grossWallArea,
      wallArea: netWallArea,
      netWallArea,
      doorArea,
      roofArea,
      volume: floorArea * height,
      totalArea: netWallArea + doorArea + roofArea + floorArea
    };
  }

  function transmissionLoad(data) {
    const g = geometry(data);
    const insideTemp = finite(data.insideTemp);
    const wallOutdoorTemp = finite(data.outsideTemp) + positive(data.solarCorrection);
    const soilTemp = Number.isFinite(Number(data.soilTemp)) ? Number(data.soilTemp) : Math.min(finite(data.outsideTemp), 24);
    const deltaWall = Math.max(0, wallOutdoorTemp - insideTemp);
    const deltaFloor = Math.max(0, soilTemp - insideTemp);
    const walls = positive(data.wallU) * g.netWallArea * deltaWall * 24 / 1000;
    const roof = positive(data.roofU) * g.roofArea * deltaWall * 24 / 1000;
    const floor = positive(data.floorU) * g.floorArea * deltaFloor * 24 / 1000;
    const door = positive(data.doorU) * g.doorArea * deltaWall * 24 / 1000;
    return {
      energy: walls + roof + floor + door,
      walls,
      roof,
      floor,
      door,
      deltaWall,
      deltaFloor,
      geometry: g
    };
  }

  function infiltrationLoad(data) {
    const doorArea = positive(data.doorWidth) * positive(data.doorHeight);
    const doorHeight = Math.max(positive(data.doorHeight), 0.1);
    const deltaT = Math.abs(finite(data.outsideTemp) - finite(data.insideTemp));
    const insideK = Math.max(finite(data.insideTemp) + 273.15, 180);
    const dischargeCoefficient = Number.isFinite(Number(data.infiltrationCoefficient)) ? Number(data.infiltrationCoefficient) : 0.5;
    const pressure = pressureKPa(data);
    const stackVelocity = doorArea > 0 ? dischargeCoefficient * Math.sqrt(2 * 9.81 * doorHeight * deltaT / insideK) : 0;
    const openSeconds = positive(data.doorOpenings) * positive(data.doorMinutes) * 60;
    const protection = clamp(finite(data.doorProtection, 1), 0, 1);
    const infiltratedVolume = doorArea * stackVelocity * openSeconds * protection;
    const massDryAir = infiltratedVolume * dryAirDensity(finite(data.outsideTemp), finite(data.outsideRH), pressure);
    const outsideEnthalpy = moistAirEnthalpy(finite(data.outsideTemp), finite(data.outsideRH), pressure);
    const insideEnthalpy = moistAirEnthalpy(finite(data.insideTemp), finite(data.insideRH), pressure);
    const enthalpyDifference = Math.max(0, outsideEnthalpy - insideEnthalpy);
    const energy = massDryAir * enthalpyDifference / 3600;
    return { energy, infiltratedVolume, massDryAir, enthalpyDifference, stackVelocity, pressureKPa: pressure };
  }

  function dailyProductMass(data) {
    return positive(data.dailyProductMass ?? data.productMass);
  }

  function productThermalEnergy(data) {
    const mass = dailyProductMass(data);
    const ti = finite(data.productInTemp);
    const tf = finite(data.productOutTemp);
    const fp = finite(data.freezingPoint);
    let sensibleAboveKJ = 0;
    let latentKJ = 0;
    let sensibleBelowKJ = 0;

    if (mass <= 0 || ti <= tf) {
      return { energy: 0, totalKwh: 0, sensibleAbove: 0, latent: 0, sensibleBelow: 0, sensibleAboveKJ, latentKJ, sensibleBelowKJ };
    }

    if (tf >= fp) {
      sensibleAboveKJ = mass * positive(data.cpAbove) * (ti - tf);
    } else if (ti <= fp) {
      sensibleBelowKJ = mass * positive(data.cpBelow) * (ti - tf);
    } else {
      sensibleAboveKJ = mass * positive(data.cpAbove) * (ti - fp);
      latentKJ = mass * positive(data.latentHeat);
      sensibleBelowKJ = mass * positive(data.cpBelow) * (fp - tf);
    }

    const totalKwh = (sensibleAboveKJ + latentKJ + sensibleBelowKJ) / 3600;
    return {
      energy: totalKwh,
      totalKwh,
      sensibleAbove: sensibleAboveKJ,
      latent: latentKJ,
      sensibleBelow: sensibleBelowKJ,
      sensibleAboveKJ,
      latentKJ,
      sensibleBelowKJ
    };
  }

  function packagingEnergy(data) {
    const packagingMass = dailyProductMass(data) * positive(data.packagingPct) / 100;
    const deltaT = Math.abs(finite(data.productInTemp) - finite(data.productOutTemp));
    const energy = packagingMass * positive(data.packagingCp) * deltaT / 3600;
    return { energy, packagingMass, deltaT };
  }

  function respirationEnergy(data) {
    const inventoryTonnes = positive(data.inventoryMass) / 1000;
    const energy = positive(data.respiration) * inventoryTonnes * 24 / 1000;
    return { energy, inventoryTonnes };
  }

  function peopleLoad(data) {
    return positive(data.peopleCount) * positive(data.peopleWatts) * positive(data.peopleHours) / 1000;
  }

  function lightingLoad(data) {
    const floorArea = geometry(data).floorArea;
    return floorArea * positive(data.lightingDensity) * positive(data.lightingHours) / 1000;
  }

  function fanLoad(data) {
    const electric = positive(data.fanWatts) * positive(data.fanHours) / 1000;
    return { thermal: electric, electric };
  }

  function defrostLoad(data) {
    const electric = positive(data.defrostKw) * positive(data.defrostCount) * positive(data.defrostMinutes) / 60;
    const thermal = electric * clamp(finite(data.defrostFraction, 0), 0, 100) / 100;
    return { thermal, electric };
  }

  function pumpLoad(data) {
    const electric = positive(data.pumpWatts) * positive(data.pumpHours) / 1000;
    return { thermal: 0, electric };
  }

  function auxiliaryLoad(data) {
    const watts = data.auxiliaryWatts ?? data.otherWatts;
    const hours = data.auxiliaryHours ?? data.otherHours;
    const electric = positive(watts) * positive(hours) / 1000;
    return { thermal: electric, electric };
  }

  function applyDesignMargin(capacityKw, marginPct) {
    return positive(capacityKw) * (1 + positive(marginPct) / 100);
  }

  function convertCapacity(capacityKw) {
    const kw = positive(capacityKw);
    return { kw, btu: kw * KW_TO_BTUH, tr: kw / KW_PER_TR };
  }

  function estimatedCop(data) {
    const te = finite(data.evapTemp) + 273.15;
    const tc = finite(data.condTemp) + 273.15;
    const carnotCop = tc > te && te > 0 ? te / (tc - te) : 0;
    return clamp(carnotCop * positive(data.carnotEfficiency) / 100, 0.5, 8);
  }

  function monthlyConsumption(thermalEnergyKwhDay, cop, directElectricKwhDay, days = 30) {
    const validCop = Math.max(0.1, finite(cop, 0));
    const compressorKwhDay = positive(thermalEnergyKwhDay) / validCop;
    const totalKwhDay = compressorKwhDay + positive(directElectricKwhDay);
    return {
      compressorKwhDay,
      directElectricKwhDay: positive(directElectricKwhDay),
      totalKwhDay,
      monthlyKwh: totalKwhDay * positive(days, 30)
    };
  }

  function performanceFactors(data) {
    const lift = Math.max(0, finite(data.condTemp) - finite(data.evapTemp));
    return {
      capacity: 1,
      cop: 1,
      lift,
      liftCapacity: 1,
      refrigerant: data.refrigerant || '',
      system: data.systemType || ''
    };
  }

  function calculate(data) {
    const g = geometry(data);
    const transmission = transmissionLoad(data);
    const infiltration = infiltrationLoad(data);
    const productDetail = productThermalEnergy(data);
    const packaging = packagingEnergy(data);
    const respiration = respirationEnergy(data);
    const productCooling = productDetail.totalKwh + packaging.energy;
    const people = peopleLoad(data);
    const lighting = lightingLoad(data);
    const auxiliary = auxiliaryLoad(data);
    const internal = people + lighting + auxiliary.thermal;
    const fans = fanLoad(data);
    const defrost = defrostLoad(data);
    const pumps = pumpLoad(data);
    const equipmentThermal = fans.thermal + defrost.thermal;
    const equipmentDirectElectric = fans.electric + defrost.electric + pumps.electric + auxiliary.electric;

    const loads = [
      { key: 'transmission', label: 'Transmisión', energy: transmission.energy, detail: transmission },
      { key: 'infiltration', label: 'Infiltración', energy: infiltration.energy, detail: infiltration },
      { key: 'product', label: 'Producto entrante', energy: productCooling, detail: { ...productDetail, packaging: packaging.energy, packagingMass: packaging.packagingMass } },
      { key: 'respiration', label: 'Respiración', energy: respiration.energy, detail: respiration },
      { key: 'internal', label: 'Cargas internas', energy: internal, detail: { people, lighting, auxiliary: auxiliary.thermal } },
      { key: 'equipment', label: 'Ventiladores y deshielo', energy: equipmentThermal, detail: { fans: fans.thermal, defrost: defrost.thermal } }
    ];

    const totalEnergy = loads.reduce((sum, item) => sum + item.energy, 0);
    const runtime = clamp(finite(data.runtimeHours, 1), 1, 24);
    const productWindow = clamp(finite(data.productHours, runtime), 0.1, 24);
    const energyCapacity = totalEnergy / runtime;
    const processCapacity = productCooling / productWindow + (totalEnergy - productCooling) / runtime;
    const capacityBeforeMargin = Math.max(energyCapacity, processCapacity);
    const requiredCapacity = applyDesignMargin(capacityBeforeMargin, data.safetyMargin);
    const conversions = convertCapacity(requiredCapacity);
    const cop = estimatedCop(data);
    const consumption = monthlyConsumption(totalEnergy, cop, equipmentDirectElectric, 30);
    const monthlyCost = consumption.monthlyKwh * positive(data.electricRate);

    loads.forEach(item => {
      item.percent = totalEnergy > 0 ? item.energy / totalEnergy * 100 : 0;
    });
    const dominant = [...loads].sort((a, b) => b.energy - a.energy)[0] || loads[0];

    return {
      timestamp: new Date().toISOString(),
      data,
      loads,
      totalEnergy,
      requiredCapacity,
      selectionCapacity: requiredCapacity,
      capacityBeforeMargin,
      energyCapacity,
      processCapacity,
      averageLoad: totalEnergy / 24,
      btu: conversions.btu,
      tr: conversions.tr,
      estimatedCop: cop,
      compressorInput: consumption.compressorKwhDay / runtime,
      compressorKwhDay: consumption.compressorKwhDay,
      directElectricKwhDay: consumption.directElectricKwhDay,
      totalElectricKwhDay: consumption.totalKwhDay,
      monthlyConsumption: consumption.monthlyKwh,
      monthlyCost,
      dominant,
      factors: performanceFactors(data),
      geometry: g,
      air: infiltration,
      directElectric: {
        fans: fans.electric,
        defrost: defrost.electric,
        pumps: pumps.electric,
        auxiliary: auxiliary.electric,
        total: equipmentDirectElectric
      },
      thermalBreakdown: {
        productCooling,
        packaging: packaging.energy,
        respiration: respiration.energy,
        people,
        lighting,
        fans: fans.thermal,
        defrost: defrost.thermal,
        pumps: pumps.thermal,
        auxiliary: auxiliary.thermal
      }
    };
  }

  function validateData(data) {
    const errors = [];
    const checks = [
      ['length', 'El largo debe ser mayor a cero.', value => value > 0],
      ['width', 'El ancho debe ser mayor a cero.', value => value > 0],
      ['height', 'El alto debe ser mayor a cero.', value => value > 0],
      ['solarCorrection', 'La corrección solar no puede ser negativa.', value => value >= 0],
      ['wallU', 'El valor U de muros no puede ser negativo.', value => value >= 0],
      ['roofU', 'El valor U de techo no puede ser negativo.', value => value >= 0],
      ['floorU', 'El valor U de piso no puede ser negativo.', value => value >= 0],
      ['doorU', 'El valor U de puerta no puede ser negativo.', value => value >= 0],
      ['doorWidth', 'El ancho de puerta no puede ser negativo.', value => value >= 0],
      ['doorHeight', 'El alto de puerta no puede ser negativo.', value => value >= 0],
      ['doorOpenings', 'Las aperturas de puerta no pueden ser negativas.', value => value >= 0],
      ['doorMinutes', 'La duración de apertura no puede ser negativa.', value => value >= 0],
      ['doorProtection', 'La protección de puerta debe estar entre 0 y 1.', value => value >= 0 && value <= 1],
      ['dailyProductMass', 'La masa diaria entrante no puede ser negativa.', value => value >= 0],
      ['inventoryMass', 'El inventario almacenado no puede ser negativo.', value => value >= 0],
      ['cpAbove', 'El Cp sobre congelación no puede ser negativo.', value => value >= 0],
      ['cpBelow', 'El Cp bajo congelación no puede ser negativo.', value => value >= 0],
      ['latentHeat', 'El calor latente no puede ser negativo.', value => value >= 0],
      ['respiration', 'La respiración no puede ser negativa.', value => value >= 0],
      ['packagingPct', 'El porcentaje de empaque debe estar entre 0 y 100.', value => value >= 0 && value <= 100],
      ['packagingCp', 'El Cp de empaque no puede ser negativo.', value => value >= 0],
      ['runtimeHours', 'Las horas de refrigeración deben estar entre 1 y 24.', value => value >= 1 && value <= 24],
      ['productHours', 'El tiempo objetivo de producto debe estar entre 0.1 y 24 h.', value => value >= 0.1 && value <= 24],
      ['safetyMargin', 'El margen de diseño debe estar entre 0 y 100%.', value => value >= 0 && value <= 100],
      ['carnotEfficiency', 'La eficiencia vs. Carnot debe estar entre 10 y 80%.', value => value >= 10 && value <= 80],
      ['electricRate', 'La tarifa eléctrica no puede ser negativa.', value => value >= 0]
    ];

    checks.forEach(([key, message, test]) => {
      const rawValue = key === 'dailyProductMass' ? (data.dailyProductMass ?? data.productMass) : data[key];
      const value = Number(rawValue);
      if (!Number.isFinite(value) || !test(value)) errors.push(message);
    });

    ['insideRH', 'outsideRH'].forEach(key => {
      const value = Number(data[key]);
      if (!Number.isFinite(value) || value < 0 || value > 100) errors.push('La humedad relativa debe estar entre 0 y 100%.');
    });

    ['peopleCount', 'peopleHours', 'peopleWatts', 'lightingDensity', 'lightingHours', 'fanWatts', 'fanHours', 'defrostKw', 'defrostCount', 'defrostMinutes', 'pumpWatts', 'pumpHours', 'auxiliaryWatts', 'auxiliaryHours', 'otherWatts', 'otherHours'].forEach(key => {
      const value = Number(data[key] ?? 0);
      if (!Number.isFinite(value) || value < 0) errors.push('Las cargas internas, ventiladores, bombas y deshielo no pueden ser negativos.');
    });

    ['peopleHours', 'lightingHours', 'fanHours', 'pumpHours', 'auxiliaryHours', 'otherHours'].forEach(key => {
      if (data[key] == null) return;
      const value = Number(data[key]);
      if (!Number.isFinite(value) || value > 24) errors.push('Las horas diarias de operación no pueden exceder 24 h.');
    });

    const defrostFraction = Number(data.defrostFraction ?? 0);
    if (!Number.isFinite(defrostFraction) || defrostFraction < 0 || defrostFraction > 100) errors.push('La fracción de deshielo liberada al recinto debe estar entre 0 y 100%.');
    ['insideTemp', 'outsideTemp', 'soilTemp', 'productInTemp', 'productOutTemp', 'freezingPoint', 'evapTemp', 'condTemp'].forEach(key => {
      const value = Number(data[key]);
      if (!Number.isFinite(value) || value <= -273.15) errors.push('Las temperaturas deben ser finitas y estar sobre el cero absoluto.');
    });

    const doorArea = positive(data.doorWidth) * positive(data.doorHeight);
    const grossWallArea = 2 * (positive(data.length) * positive(data.height) + positive(data.width) * positive(data.height));
    if (doorArea > grossWallArea) errors.push('El área de puerta no puede exceder el área total de muros.');
    if (finite(data.productInTemp) < finite(data.productOutTemp) && dailyProductMass(data) > 0) errors.push('La temperatura de entrada del producto debe ser mayor o igual a la temperatura final.');
    if (finite(data.evapTemp) >= finite(data.condTemp)) errors.push('La temperatura de condensación debe ser mayor que la de evaporación.');
    if (finite(data.evapTemp) <= -273.15 || finite(data.condTemp) <= -273.15) errors.push('Las temperaturas del sistema deben estar sobre el cero absoluto.');
    if (Number(data.atmosphericPressureKPa) < 50 || Number(data.atmosphericPressureKPa) > 110) {
      if (Number(data.atmosphericPressureKPa) !== 0) errors.push('La presión atmosférica debe estar entre 50 y 110 kPa, o dejarse en 0 para calcularla por altitud.');
    }
    if (Number(data.altitudeM) < -500 || Number(data.altitudeM) > 6000) errors.push('La altitud debe estar entre -500 y 6000 m.');

    return [...new Set(errors)];
  }

  return {
    KW_TO_BTUH,
    KW_PER_TR,
    STANDARD_PRESSURE_KPA,
    clamp,
    finite,
    pressureFromAltitude,
    pressureKPa,
    saturationPressureKPa,
    humidityRatio,
    moistAirEnthalpy,
    dryAirDensity,
    geometry,
    transmissionLoad,
    infiltrationLoad,
    productThermalEnergy,
    packagingEnergy,
    respirationEnergy,
    peopleLoad,
    lightingLoad,
    fanLoad,
    defrostLoad,
    pumpLoad,
    auxiliaryLoad,
    applyDesignMargin,
    convertCapacity,
    estimatedCop,
    monthlyConsumption,
    performanceFactors,
    calculate,
    validateData
  };
});

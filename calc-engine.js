(function (root, factory) {
  const engine = factory();
  if (typeof module === 'object' && module.exports) module.exports = engine;
  root.FrigoCalcEngine = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ENGINE_VERSION = '2026.06-industrial-ready';
  const SCHEMA_VERSION = 2;
  const KW_TO_BTUH = 3412.142;
  const KW_PER_TR = 3.5168525;
  const STANDARD_PRESSURE_KPA = 101.325;
  const WATER_CP_KJ_KG_K = 4.186;
  const ICE_CP_KJ_KG_K = 2.05;
  const WATER_LATENT_KJ_KG = 333.55;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function finite(value, fallback = 0) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function positive(value, fallback = 0) {
    return Math.max(0, finite(value, fallback));
  }

  function percentFraction(value, fallback = 0) {
    return clamp(finite(value, fallback), 0, 100) / 100;
  }

  function isFiniteNonNegative(value) {
    return Number.isFinite(value) && value >= 0;
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

  // Buck equations, kPa. Water is used at and above 0 C; ice is used below 0 C.
  function saturationPressureKPa(tempC) {
    const t = finite(tempC, 0);
    if (t >= 0) {
      return 0.61121 * Math.exp((18.678 - t / 234.5) * (t / (257.14 + t)));
    }
    return 0.61115 * Math.exp((23.036 - t / 333.7) * (t / (279.82 + t)));
  }

  function humidityRatio(tempC, rhPct, pressure = STANDARD_PRESSURE_KPA) {
    const pv = clamp(finite(rhPct, 0), 0, 100) / 100 * saturationPressureKPa(tempC);
    return 0.62198 * pv / Math.max(0.1, pressure - pv);
  }

  function moistAirEnthalpy(tempC, rhPct, pressure = STANDARD_PRESSURE_KPA) {
    const w = humidityRatio(tempC, rhPct, pressure);
    return 1.006 * finite(tempC) + w * (2501 + 1.86 * finite(tempC));
  }

  function dryAirDensity(tempC, rhPct, pressure = STANDARD_PRESSURE_KPA) {
    const w = humidityRatio(tempC, rhPct, pressure);
    return (pressure * 1000) / (287.055 * (finite(tempC) + 273.15) * (1 + 1.6078 * w));
  }

  function normalizeDoors(data = {}) {
    if (Array.isArray(data.doors) && data.doors.length) {
      return data.doors.map((door, index) => ({
        id: door.id || `door-${index + 1}`,
        name: door.name || `Puerta ${index + 1}`,
        width: positive(door.width ?? door.doorWidth ?? data.doorWidth),
        height: positive(door.height ?? door.doorHeight ?? data.doorHeight),
        uValue: positive(door.uValue ?? door.doorU ?? data.doorU ?? data.wallU),
        openingsPerDay: positive(door.openingsPerDay ?? door.doorOpenings ?? data.doorOpenings),
        minutesOpen: positive(door.minutesOpen ?? door.doorMinutes ?? data.doorMinutes),
        protectionFactor: clamp(finite(door.protectionFactor ?? door.doorProtection ?? data.doorProtection, 1), 0, 1),
        trafficMultiplier: positive(door.trafficMultiplier ?? data.trafficMultiplier, 1) || 1
      }));
    }
    return [{
      id: 'door-1',
      name: 'Puerta 1',
      width: positive(data.doorWidth),
      height: positive(data.doorHeight),
      uValue: positive(data.doorU ?? data.wallU),
      openingsPerDay: positive(data.doorOpenings),
      minutesOpen: positive(data.doorMinutes),
      protectionFactor: clamp(finite(data.doorProtection, 1), 0, 1),
      trafficMultiplier: positive(data.trafficMultiplier, 1) || 1
    }];
  }

  function geometry(data) {
    const length = positive(data.length);
    const width = positive(data.width);
    const height = positive(data.height);
    const doors = normalizeDoors(data);
    const floorArea = length * width;
    const grossWallArea = 2 * (length * height + width * height);
    const rawDoorArea = doors.reduce((sum, door) => sum + door.width * door.height, 0);
    const doorArea = Math.min(grossWallArea, rawDoorArea);
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
      totalArea: netWallArea + doorArea + roofArea + floorArea,
      doors
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
    const doorDetails = g.doors.map(door => {
      const area = door.width * door.height;
      const energy = door.uValue * area * deltaWall * 24 / 1000;
      return { ...door, area, energy };
    });
    const door = doorDetails.reduce((sum, item) => sum + item.energy, 0);
    return {
      energy: walls + roof + floor + door,
      walls,
      roof,
      floor,
      door,
      doors: doorDetails,
      deltaWall,
      deltaFloor,
      geometry: g
    };
  }

  function airState(data, prefix, pressure) {
    const temp = finite(data[`${prefix}Temp`]);
    const rh = finite(data[`${prefix}RH`]);
    const w = humidityRatio(temp, rh, pressure);
    const h = moistAirEnthalpy(temp, rh, pressure);
    return { temp, rh, w, h };
  }

  function infiltrationVolumeByDoor(data) {
    const doors = normalizeDoors(data);
    const insideK = Math.max(finite(data.insideTemp) + 273.15, 180);
    const deltaT = Math.abs(finite(data.outsideTemp) - finite(data.insideTemp));
    const dischargeCoefficient = Number.isFinite(Number(data.infiltrationCoefficient)) ? Number(data.infiltrationCoefficient) : 0.5;
    const maxSimultaneous = Math.max(1, Math.min(positive(data.maxSimultaneousDoors, 1), doors.length || 1));
    const simultaneousFactor = doors.length ? maxSimultaneous / doors.length : 1;
    const trafficMultiplier = positive(data.trafficMultiplier, 1) || 1;
    const details = doors.map(door => {
      const area = door.width * door.height;
      const stackVelocity = area > 0 ? dischargeCoefficient * Math.sqrt(2 * 9.81 * Math.max(door.height, 0.1) * deltaT / insideK) : 0;
      const openSeconds = door.openingsPerDay * door.minutesOpen * 60;
      const volume = area * stackVelocity * openSeconds * door.protectionFactor * door.trafficMultiplier * simultaneousFactor;
      return { ...door, area, stackVelocity, openSeconds, volume };
    });
    return {
      method: 'door',
      volume: details.reduce((sum, item) => sum + item.volume, 0) * trafficMultiplier,
      doors: details,
      simultaneousFactor,
      trafficMultiplier
    };
  }

  function infiltrationVolume(data) {
    const method = data.infiltrationMethod || 'door';
    if (method === 'airChanges') {
      const g = geometry(data);
      return {
        method,
        volume: g.volume * positive(data.airChangesPerDay) * (positive(data.trafficMultiplier, 1) || 1),
        airChangesPerDay: positive(data.airChangesPerDay),
        trafficMultiplier: positive(data.trafficMultiplier, 1) || 1
      };
    }
    if (method === 'measuredVolume') {
      return {
        method,
        volume: positive(data.measuredInfiltrationM3Day) * (positive(data.trafficMultiplier, 1) || 1),
        measuredInfiltrationM3Day: positive(data.measuredInfiltrationM3Day),
        trafficMultiplier: positive(data.trafficMultiplier, 1) || 1
      };
    }
    return infiltrationVolumeByDoor(data);
  }

  function infiltrationLoad(data) {
    const pressure = pressureKPa(data);
    const volumeInfo = infiltrationVolume(data);
    const outside = airState(data, 'outside', pressure);
    const inside = airState(data, 'inside', pressure);
    const massDryAir = volumeInfo.volume * dryAirDensity(outside.temp, outside.rh, pressure);
    const sensibleKJkg = Math.max(0, 1.006 * (outside.temp - inside.temp));
    const latentKJkg = Math.max(0, (outside.w - inside.w) * (2501 + 1.86 * outside.temp));
    const enthalpyDifference = Math.max(0, outside.h - inside.h);
    const sensible = massDryAir * sensibleKJkg / 3600;
    const latent = massDryAir * latentKJkg / 3600;
    const energy = massDryAir * enthalpyDifference / 3600;
    return {
      energy,
      sensible,
      latent: Math.max(0, energy - sensible, latent),
      infiltratedVolume: volumeInfo.volume,
      massDryAir,
      enthalpyDifference,
      pressureKPa: pressure,
      method: volumeInfo.method,
      volumeDetail: volumeInfo,
      outside,
      inside
    };
  }

  function dailyProductMass(data) {
    return positive(data.dailyProductMass ?? data.productMass);
  }

  function partialFreezingEnergy(data) {
    const mass = positive(data.mass ?? data.dailyProductMass ?? data.productMass);
    const ti = finite(data.initialTemp ?? data.productInTemp);
    const tf = finite(data.finalTemp ?? data.productOutTemp);
    const fp = finite(data.initialFreezingPoint ?? data.freezingPoint);
    const cpAbove = positive(data.cpAbove);
    const cpBelow = positive(data.cpBelow);
    const latentHeat = positive(data.latentHeat ?? data.latent);
    const initialFraction = percentFraction(data.initialFrozenFraction ?? data.freezeFractionInitial, 0);
    const finalFraction = percentFraction(data.finalFrozenFraction ?? data.freezeFractionFinal, initialFraction * 100);
    const appliedFraction = Math.max(0, finalFraction - initialFraction);
    const sensibleAboveKJ = mass * cpAbove * Math.max(0, ti - Math.max(tf, fp));
    const latentKJ = mass * latentHeat * appliedFraction;
    const sensibleBelowKJ = mass * cpBelow * Math.max(0, Math.min(fp, ti) - tf);
    const totalKwh = (sensibleAboveKJ + latentKJ + sensibleBelowKJ) / 3600;
    return {
      energy: totalKwh,
      totalKwh,
      sensibleAboveKwh: sensibleAboveKJ / 3600,
      latentKwh: latentKJ / 3600,
      sensibleBelowKwh: sensibleBelowKJ / 3600,
      sensibleAbove: sensibleAboveKJ,
      latent: latentKJ,
      sensibleBelow: sensibleBelowKJ,
      sensibleAboveKJ,
      latentKJ,
      sensibleBelowKJ,
      initialFraction,
      finalFraction,
      appliedFraction,
      specificKwhKg: mass > 0 ? totalKwh / mass : 0
    };
  }

  function productThermalEnergy(data) {
    if (data.usePartialFreezing || data.initialFrozenFraction != null || data.finalFrozenFraction != null || data.freezeFractionInitial != null || data.freezeFractionFinal != null) {
      return partialFreezingEnergy({ ...data, mass: dailyProductMass(data) });
    }

    const mass = dailyProductMass(data);
    const ti = finite(data.productInTemp);
    const tf = finite(data.productOutTemp);
    const fp = finite(data.freezingPoint);
    let sensibleAboveKJ = 0;
    let latentKJ = 0;
    let sensibleBelowKJ = 0;

    if (mass <= 0 || ti <= tf) {
      return { energy: 0, totalKwh: 0, sensibleAbove: 0, latent: 0, sensibleBelow: 0, sensibleAboveKJ, latentKJ, sensibleBelowKJ, specificKwhKg: 0 };
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
      sensibleBelowKJ,
      specificKwhKg: mass > 0 ? totalKwh / mass : 0
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
    const thermal = electric * percentFraction(data.fanHeatFraction, 100);
    return { thermal, electric };
  }

  function defrostLoad(data) {
    const electric = positive(data.defrostKw) * positive(data.defrostCount) * positive(data.defrostMinutes) / 60;
    const thermal = electric * percentFraction(data.defrostFraction, 0);
    return { thermal, electric };
  }

  function defrostAvailability(data) {
    const defrostMinutes = positive(data.defrostCount) * (positive(data.defrostMinutes) + positive(data.dripMinutes) + positive(data.fanDelayMinutes));
    const unavailableHours = defrostMinutes / 60 + positive(data.extraDowntimeHours);
    const availableHours = Math.max(0, positive(data.runtimeHours, 24) - unavailableHours);
    return {
      defrostMinutes,
      unavailableHours,
      availableHours,
      recoveryLoadKw: positive(data.recoveryLoadKw)
    };
  }

  function pumpLoad(data) {
    const electric = positive(data.pumpWatts) * positive(data.pumpHours) / 1000;
    const thermal = electric * percentFraction(data.pumpHeatFraction, 0);
    return { thermal, electric };
  }

  function auxiliaryLoad(data) {
    const watts = data.auxiliaryWatts ?? data.otherWatts;
    const hours = data.auxiliaryHours ?? data.otherHours;
    const electric = positive(watts) * positive(hours) / 1000;
    const thermal = electric * percentFraction(data.auxiliaryHeatFraction, 100);
    return { thermal, electric };
  }

  function applyDesignMargin(capacityKw, marginPct) {
    return positive(capacityKw) * (1 + positive(marginPct) / 100);
  }

  function convertCapacity(capacityKw) {
    const kw = positive(capacityKw);
    return { kw, btu: kw * KW_TO_BTUH, tr: kw / KW_PER_TR };
  }

  function estimatedCop(data) {
    if (Number.isFinite(Number(data.explicitCop)) && Number(data.explicitCop) > 0) return Number(data.explicitCop);
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
      system: data.systemType || '',
      method: data.explicitCop ? 'COP introducido' : 'Carnot preliminar para sistema convencional'
    };
  }

  function assertResultShape(result) {
    const problems = [];
    ['totalEnergy', 'requiredCapacity', 'capacityBeforeMargin', 'energyCapacity', 'processCapacity', 'averageLoad', 'monthlyConsumption', 'monthlyCost'].forEach(key => {
      if (!isFiniteNonNegative(result[key])) problems.push(`Resultado inválido en ${key}.`);
    });
    result.loads.forEach(load => {
      if (!isFiniteNonNegative(load.energy) || !Number.isFinite(load.percent)) problems.push(`Carga inválida en ${load.label}.`);
    });
    return problems;
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
    const equipmentThermal = fans.thermal + defrost.thermal + pumps.thermal;
    const equipmentDirectElectric = fans.electric + defrost.electric + pumps.electric + auxiliary.electric;
    const availability = defrostAvailability(data);

    const loads = [
      { key: 'transmission', label: 'Transmisión', energy: transmission.energy, detail: transmission },
      { key: 'infiltration', label: 'Infiltración', energy: infiltration.energy, detail: infiltration },
      { key: 'product', label: 'Producto entrante', energy: productCooling, detail: { ...productDetail, packaging: packaging.energy, packagingMass: packaging.packagingMass } },
      { key: 'respiration', label: 'Respiración', energy: respiration.energy, detail: respiration },
      { key: 'internal', label: 'Cargas internas', energy: internal, detail: { people, lighting, auxiliary: auxiliary.thermal } },
      { key: 'equipment', label: 'Ventiladores, bombas y deshielo', energy: equipmentThermal, detail: { fans: fans.thermal, defrost: defrost.thermal, pumps: pumps.thermal } }
    ];

    const totalEnergy = loads.reduce((sum, item) => sum + item.energy, 0);
    const runtime = clamp(finite(data.runtimeHours, 1), 1, 24);
    const netRuntime = availability.availableHours > 0 ? Math.min(runtime, availability.availableHours) : runtime;
    const productWindow = clamp(finite(data.productHours, netRuntime), 0.1, 24);
    const energyCapacity = totalEnergy / netRuntime;
    const processCapacity = productCooling / productWindow + (totalEnergy - productCooling) / netRuntime;
    const recoveryCapacity = availability.recoveryLoadKw;
    const capacityBeforeMargin = Math.max(energyCapacity, processCapacity, recoveryCapacity);
    const requiredCapacity = applyDesignMargin(capacityBeforeMargin, data.safetyMargin);
    const conversions = convertCapacity(requiredCapacity);
    const cop = estimatedCop(data);
    const consumption = monthlyConsumption(totalEnergy, cop, equipmentDirectElectric, 30);
    const monthlyCost = consumption.monthlyKwh * positive(data.electricRate);

    loads.forEach(item => {
      item.percent = totalEnergy > 0 ? item.energy / totalEnergy * 100 : 0;
    });
    const dominant = [...loads].sort((a, b) => b.energy - a.energy)[0] || loads[0];

    const result = {
      engineVersion: ENGINE_VERSION,
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      data,
      loads,
      totalEnergy,
      requiredCapacity,
      selectionCapacity: requiredCapacity,
      capacityBeforeMargin,
      energyCapacity,
      processCapacity,
      recoveryCapacity,
      averageLoad: totalEnergy / 24,
      btu: conversions.btu,
      tr: conversions.tr,
      estimatedCop: cop,
      compressorInput: consumption.compressorKwhDay / netRuntime,
      compressorKwhDay: consumption.compressorKwhDay,
      directElectricKwhDay: consumption.directElectricKwhDay,
      totalElectricKwhDay: consumption.totalKwhDay,
      monthlyConsumption: consumption.monthlyKwh,
      monthlyCost,
      dominant,
      factors: performanceFactors(data),
      geometry: g,
      air: infiltration,
      availability,
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
      },
      warnings: []
    };
    result.validationProblems = assertResultShape(result);
    return result;
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

    normalizeDoors(data).forEach((door, index) => {
      if (door.width < 0 || door.height < 0) errors.push(`La puerta ${index + 1} no puede tener dimensiones negativas.`);
      if (door.uValue < 0) errors.push(`El valor U de la puerta ${index + 1} no puede ser negativo.`);
      if (door.openingsPerDay < 0 || door.minutesOpen < 0) errors.push(`Las aperturas de la puerta ${index + 1} no pueden ser negativas.`);
      if (door.protectionFactor < 0 || door.protectionFactor > 1) errors.push(`El factor de protección de la puerta ${index + 1} debe estar entre 0 y 1.`);
    });

    ['insideRH', 'outsideRH'].forEach(key => {
      const value = Number(data[key]);
      if (!Number.isFinite(value) || value < 0 || value > 100) errors.push('La humedad relativa debe estar entre 0 y 100%.');
    });

    ['peopleCount', 'peopleHours', 'peopleWatts', 'lightingDensity', 'lightingHours', 'fanWatts', 'fanHours', 'defrostKw', 'defrostCount', 'defrostMinutes', 'dripMinutes', 'fanDelayMinutes', 'pumpWatts', 'pumpHours', 'auxiliaryWatts', 'auxiliaryHours', 'otherWatts', 'otherHours'].forEach(key => {
      const value = Number(data[key] ?? 0);
      if (!Number.isFinite(value) || value < 0) errors.push('Las cargas internas, ventiladores, bombas y deshielo no pueden ser negativos.');
    });

    ['peopleHours', 'lightingHours', 'fanHours', 'pumpHours', 'auxiliaryHours', 'otherHours'].forEach(key => {
      if (data[key] == null) return;
      const value = Number(data[key]);
      if (!Number.isFinite(value) || value < 0 || value > 24) errors.push('Las horas diarias de operación deben estar entre 0 y 24 h.');
    });

    ['defrostFraction', 'fanHeatFraction', 'pumpHeatFraction', 'auxiliaryHeatFraction', 'initialFrozenFraction', 'finalFrozenFraction'].forEach(key => {
      if (data[key] == null) return;
      const value = Number(data[key]);
      if (!Number.isFinite(value) || value < 0 || value > 100) errors.push('Las fracciones deben estar entre 0 y 100%.');
    });
    if (Number(data.finalFrozenFraction ?? data.freezeFractionFinal ?? 0) < Number(data.initialFrozenFraction ?? data.freezeFractionInitial ?? 0)) {
      errors.push('La fracción congelada final debe ser mayor o igual que la inicial.');
    }

    ['insideTemp', 'outsideTemp', 'soilTemp', 'productInTemp', 'productOutTemp', 'freezingPoint', 'evapTemp', 'condTemp'].forEach(key => {
      const value = Number(data[key]);
      if (!Number.isFinite(value) || value <= -273.15) errors.push('Las temperaturas deben ser finitas y estar sobre el cero absoluto.');
    });

    const geom = geometry(data);
    const rawDoorArea = normalizeDoors(data).reduce((sum, door) => sum + door.width * door.height, 0);
    if (rawDoorArea > geom.grossWallArea) errors.push('El área de puertas no puede exceder el área total de muros.');
    if (finite(data.productInTemp) < finite(data.productOutTemp) && dailyProductMass(data) > 0) errors.push('La temperatura de entrada del producto debe ser mayor o igual a la temperatura final.');
    if (finite(data.evapTemp) >= finite(data.insideTemp)) errors.push('La temperatura de evaporación debe ser menor que la temperatura interior.');
    if (finite(data.evapTemp) >= finite(data.condTemp)) errors.push('La temperatura de condensación debe ser mayor que la de evaporación.');
    if (finite(data.evapTemp) <= -273.15 || finite(data.condTemp) <= -273.15) errors.push('Las temperaturas del sistema deben estar sobre el cero absoluto.');
    if (Number(data.atmosphericPressureKPa) < 50 || Number(data.atmosphericPressureKPa) > 110) {
      if (Number(data.atmosphericPressureKPa) !== 0) errors.push('La presión atmosférica debe estar entre 50 y 110 kPa, o dejarse en 0 para calcularla por altitud.');
    }
    if (Number(data.altitudeM) < -500 || Number(data.altitudeM) > 6000) errors.push('La altitud debe estar entre -500 y 6000 m.');
    if (data.infiltrationMethod === 'airChanges' && positive(data.airChangesPerDay) === 0) errors.push('Las renovaciones de aire deben ser mayores a cero para ese método.');
    if (data.infiltrationMethod === 'measuredVolume' && positive(data.measuredInfiltrationM3Day) === 0) errors.push('El volumen infiltrado medido debe ser mayor a cero para ese método.');

    return [...new Set(errors)];
  }

  function migrateData(data = {}) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ...data,
      dailyProductMass: data.dailyProductMass ?? data.productMass ?? 0,
      inventoryMass: data.inventoryMass ?? data.productMass ?? 0,
      soilTemp: data.soilTemp ?? Math.min(Number(data.outsideTemp) || 24, 24),
      doorU: data.doorU ?? data.wallU ?? 0,
      auxiliaryWatts: data.auxiliaryWatts ?? data.otherWatts ?? 0,
      auxiliaryHours: data.auxiliaryHours ?? data.otherHours ?? 0,
      infiltrationMethod: data.infiltrationMethod || 'door',
      maxSimultaneousDoors: data.maxSimultaneousDoors ?? 1,
      trafficMultiplier: data.trafficMultiplier ?? 1,
      trafficType: data.trafficType || 'personas'
    };
  }

  function migrateProjectRecord(record = {}) {
    const migrated = {
      schemaVersion: SCHEMA_VERSION,
      ...record,
      data: migrateData(record.data || record)
    };
    if (record.result?.data) migrated.result = { ...record.result, data: migrateData(record.result.data), schemaVersion: SCHEMA_VERSION };
    return migrated;
  }

  return {
    ENGINE_VERSION,
    SCHEMA_VERSION,
    KW_TO_BTUH,
    KW_PER_TR,
    STANDARD_PRESSURE_KPA,
    WATER_CP_KJ_KG_K,
    ICE_CP_KJ_KG_K,
    WATER_LATENT_KJ_KG,
    clamp,
    finite,
    positive,
    percentFraction,
    pressureFromAltitude,
    pressureKPa,
    saturationPressureKPa,
    humidityRatio,
    moistAirEnthalpy,
    dryAirDensity,
    normalizeDoors,
    geometry,
    transmissionLoad,
    airState,
    infiltrationVolumeByDoor,
    infiltrationVolume,
    infiltrationLoad,
    dailyProductMass,
    partialFreezingEnergy,
    productThermalEnergy,
    packagingEnergy,
    respirationEnergy,
    peopleLoad,
    lightingLoad,
    fanLoad,
    defrostLoad,
    defrostAvailability,
    pumpLoad,
    auxiliaryLoad,
    applyDesignMargin,
    convertCapacity,
    estimatedCop,
    monthlyConsumption,
    performanceFactors,
    assertResultShape,
    calculate,
    validateData,
    migrateData,
    migrateProjectRecord
  };
});

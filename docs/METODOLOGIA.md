# Metodología

Versión del motor: `2026.06-industrial-ready`.

Esta aplicación entrega cálculos preliminares. La selección final de equipos requiere software o datos certificados del fabricante.

## Convencional

### Transmisión

Formula:

`Q = U x A x DeltaT x horas / 1000`

Variables:

- `U`: transmitancia, `W/m2 K`.
- `A`: área, `m2`.
- `DeltaT`: diferencia de temperatura, `K`.
- Resultado: `kWh/dia`.

Supuestos:

- Muros y techo usan temperatura exterior más corrección solar.
- Piso usa temperatura de suelo independiente.
- El área de puertas se resta del área bruta de muros.
- Cada puerta puede tener su propio valor `U`.

Ejemplo:

`U=0.25 W/m2K`, `A=100 m2`, `DeltaT=40 K`:

`Q = 0.25 x 100 x 40 x 24 / 1000 = 24 kWh/dia`.

### Psicrometría

Presión de saturación Buck, `kPa`:

- Sobre agua, `T >= 0 C`:
  `pws = 0.61121 exp((18.678 - T/234.5)(T/(257.14 + T)))`
- Sobre hielo, `T < 0 C`:
  `pws = 0.61115 exp((23.036 - T/333.7)(T/(279.82 + T)))`

Relación de humedad:

`W = 0.62198 pv / (P - pv)`

Entalpía de aire húmedo:

`h = 1.006 T + W(2501 + 1.86 T)`, `kJ/kg aire seco`.

Presión:

- La presión introducida directamente en `kPa` tiene prioridad.
- Si no se introduce, se estima por altitud con atmósfera estándar.

### Infiltración

Métodos:

1. Puerta y flotación:
   `V = A v segundos_abierta factor_proteccion multiplicador_trafico`
2. Renovaciones:
   `V = volumen_recinto x renovaciones_dia`
3. Volumen medido:
   `V = m3/dia introducidos`

Energía:

`Q = masa_aire_seco x (h_exterior - h_interior) / 3600`

Se reportan volumen, masa de aire seco, diferencia de entalpía, energía sensible, latente y total.

### Producto

Sobre congelación:

`Q = m Cp_superior (Tin - Tout) / 3600`

Cruzando congelación completa:

`Q = Q_sensible_superior + m L + Q_sensible_inferior`

Congelación parcial:

`Q_latente = m L (fraccion_final - fraccion_inicial)`

El modo parcial evita saltos al cruzar mínimamente el punto de congelación.

### Empaque

`Q = masa_producto_diaria x porcentaje_empaque x Cp_empaque x DeltaT / 3600`

### Respiración

`Q = tasa_W_t x inventario_t x 24 / 1000`

Usa inventario promedio almacenado, no masa entrante diaria.

### Cargas internas

- Personas: `personas x W/persona x h / 1000`
- Iluminación: `area_piso x W/m2 x h / 1000`
- Ventiladores: consumo eléctrico completo; fracción configurable como calor al recinto.
- Bombas: consumo eléctrico completo; fracción configurable como calor al lado frío.
- Deshielo: energía eléctrica completa al consumo; solo la fracción térmica entra a la carga.

### Capacidad y consumo

- Energía térmica diaria: suma de cargas, `kWh/dia`.
- Carga promedio: `energia / 24`, `kW`.
- Capacidad por energía diaria: `energia / horas_netas`.
- Capacidad de proceso: carga del producto en su ventana objetivo más el resto en horas netas.
- Capacidad de selección: máximo de capacidad diaria, proceso y recuperación, con margen explícito.
- Consumo mensual: `(energia_termica_diaria / COP + electricos_directos) x 30`.

## Industrial

### Blast freezer

Entradas principales: masa por lote, lotes diarios, tiempo de abatimiento, empaque, motores, pérdidas y deshielo.

Formula:

`capacidad_proceso = energia_lote / horas_abatimiento + cargas_proceso_kW`

La capacidad de selección toma el mayor valor entre energía diaria, proceso instantáneo y recuperación.

### IQF

`Q_producto = flujo_kg_h x energia_especifica_kWh_kg`

Incluye producto, empaque, agua de glaseado, ventiladores, banda, vibradores, auxiliares, pérdidas y deshielo.

### Glaseado

`Q = m_agua Cp_agua (Tin - 0) + m_agua L fraccion_congelada + m_agua Cp_hielo (0 - Tout) fraccion_congelada`

### Sistemas secundarios

`P_hidraulica = caudal_m3_s x DeltaP_Pa / 1000`

`P_electrica = P_hidraulica / (ef_bomba x ef_motor)`

`Q_bomba = P_electrica x fraccion_lado_frio`

Capacidad transportada:

`Q_fluido = flujo_masico x Cp x DeltaT`

### Amoníaco bombeado

`m_vapor = Q_evaporador / efecto_frigorifico`

`m_circulado = m_vapor x relacion_recirculacion`

`flujo_requerido = m_circulado / densidad`

El resultado es preliminar y no sustituye diseño de tuberías, recipientes ni seguridad.

### CO2 transcrítico

No usa temperatura de condensación ficticia. Métodos válidos:

- COP certificado.
- Capacidad nominal / potencia nominal.
- Efecto frigorífico / trabajo específico.
- Tabla de desempeño ingresada por usuario.

`P_compresor = capacidad_requerida / COP`

`Q_rechazo = capacidad_requerida + P_compresor`

### Dos etapas

No usa factores arbitrarios. Usa COP introducido, capacidad/potencia de catálogo o datos de etapas alta/baja.


# Frigo Espacios - Calculadora frigorífica

Aplicación web estática para cálculos preliminares de cargas frigoríficas convencionales e industriales.

## URLs

- Convencional: `https://robertorobledo123.github.io/calculadora_frigorifica/`
- Industrial: `https://robertorobledo123.github.io/calculadora_frigorifica/industrial.html`

## Uso local

Abrir `index.html` o `industrial.html` directamente, o servir la carpeta:

```bash
python -m http.server 8773
```

## Pruebas

```bash
npm test
```

El comando ejecuta:

- `test/calc-engine.test.js`
- `test/industrial-engine.test.js`

## Arquitectura

- `index.html`: calculadora convencional y reporte imprimible.
- `calc-engine.js`: motor matemático convencional, psicrometría, infiltración, migración y utilidades.
- `industrial.html`: interfaz avanzada para blast freezer, IQF, sistemas secundarios, R717 bombeado, CO2 transcrítico y dos etapas.
- `industrial-engine.js`: funciones puras para escenarios industriales.
- `docs/`: metodología, fuentes de datos y limitaciones.

## Alcance

La calculadora distingue:

- energía térmica diaria, `kWh/día`;
- carga promedio, `kW`;
- capacidad máxima de proceso, `kW`;
- capacidad de selección con margen explícito, `kW`;
- consumo eléctrico directo, `kWh/día` y `kWh/mes`;
- potencia eléctrica instantánea, `kW`.

## Advertencias

- No hay factores arbitrarios por refrigerante.
- El refrigerante no modifica la carga térmica.
- CO2 transcrítico requiere datos de desempeño ingresados por el usuario.
- Dos etapas requiere COP o datos de catálogo/etapas.
- Los datos de productos sin fuente aparecen como preliminares.
- La selección final requiere verificación con software o información certificada del fabricante.

## GitHub Pages

El proyecto no requiere build. Para publicar, hacer push a la rama configurada en GitHub Pages. Los archivos estáticos requeridos son:

- `index.html`
- `industrial.html`
- `calc-engine.js`
- `industrial-engine.js`
- `docs/*`

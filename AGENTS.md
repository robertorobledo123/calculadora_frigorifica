# AGENTS.md

Reglas para agentes o mantenedores de este repositorio:

- Ejecutar `npm test` después de cualquier cambio matemático.
- No introducir constantes de ingeniería sin documentar fuente, unidad y rango de uso.
- No mezclar energía (`kWh`), potencia (`kW`) y capacidad frigorífica (`kW`, `BTU/h`, `TR`).
- No modificar fórmulas sin actualizar `docs/METODOLOGIA.md` y las pruebas correspondientes.
- Mantener compatibilidad con GitHub Pages: sin servidor, build step obligatorio ni dependencias remotas inestables.
- Mantener toda la interfaz visible en español.
- No usar factores arbitrarios por refrigerante, sistema o lift para modificar la carga térmica.
- CO2 transcrítico y dos etapas deben usar datos de fabricante, capacidad/potencia o entalpías introducidas por el usuario.
- Preservar compatibilidad con proyectos anteriores mediante `schemaVersion` y migraciones.

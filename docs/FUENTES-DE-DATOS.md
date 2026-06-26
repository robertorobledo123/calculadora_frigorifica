# Fuentes de datos

## Propiedades de productos

La base incluida conserva valores existentes para compatibilidad con proyectos previos. Esos valores se marcan como:

`Dato preliminar sin fuente verificada`

No deben presentarse como datos certificados. El usuario puede editar o importar productos personalizados con:

- fuente;
- edición o año;
- página o tabla;
- rango válido;
- fecha de revisión;
- notas.

## Constantes incluidas

- Calor específico del agua: `4.186 kJ/kg K`.
- Calor específico del hielo: `2.05 kJ/kg K`.
- Calor latente del agua: `333.55 kJ/kg`.
- Conversión: `1 kW = 3412.142 BTU/h`.
- Conversión: `1 TR = 3.5168525 kW`.
- Presión atmosférica estándar: `101.325 kPa`.

## Psicrometría

Se usan ecuaciones Buck para presión de saturación sobre agua y sobre hielo. La implementación está documentada en `docs/METODOLOGIA.md` y cubierta por pruebas.

## Desempeño de equipos

La aplicación no incluye catálogos de compresores. Para CO2 transcrítico, dos etapas y sistemas específicos se requiere que el usuario introduzca COP, capacidad/potencia, entalpías o tabla de desempeño con fuente.

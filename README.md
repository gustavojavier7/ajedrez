# ajedrez
Versión simplificada del analizador de ajedrez basada en Stockfish.

## K_GUARD infinito

Si `K_GUARD` es `∞`, el `NODE_GUARD` queda desactivado: no hay tope
operacional de nodos. El análisis continúa hasta forzar mate, agotar la
frontera de pulso o hasta que el usuario detenga el worker.

## Aislamiento de scope (identidad de evidencia)

El scope de una búsqueda PCA es una **identidad derivada** (dominio + versión de
reglas + versión de semántica + versión de descriptores + horizonte + color),
nunca una afirmación confiable del llamador. Reglas vigentes:

- `scopeKey` se recomputa siempre desde `evidenceScope`; `options.scopeKey` se ignora.
- `classCache`, `descriptorClassStore` y `collisionMap` incluyen el scope en su
  clave: ninguna lectura ni escritura fusiona, muta ni reetiqueta entradas de otro
  scope. Un acierto foráneo se rechaza y suma a `evidenceTelemetry.scopeMismatches`.
- `pcaAppendEvidenceRecord` rechaza registros con `scopeKey` foráneo.
- La telemetría de evidencia (`classesObserved`, `counterexamples`,
  `evidenceRecords`) y los metrics de colisiones (`collisions`, `collisionLog`)
  cuentan sólo el scope propio, incluso si los stores se comparten entre búsquedas.
- `exactCache` es la única autoridad exacta e incluye la identidad de
  reglas/semántica en su clave: un certificado nunca se reutiliza entre versiones.

# ajedrez
Versión simplificada del analizador de ajedrez basada en Stockfish.

## PCA MODE (política telescópica)

El panel PCA expone un selector compacto `PCA MODE: DISABLED | SHADOW | ACTIVE`.
El valor elegido viaja **explícito** por el camino UI → Worker → núcleo:

```
analyzePCAChess() → pcaReadTelescopicMode() → pcaCreateWorkerStartMessage()
   → worker: message.telescopicPolicy → pcaAnalyzePositionCore(fen, kGuard, { telescopicPolicy })
```

- `disabled`: sin telescopía (comportamiento previo, por defecto).
- `shadow`: observa y produce propuestas; **nunca** reordena candidatos.
- `active`: sólo puede permutar el universo existente mediante
  `ActiveTelescopicPolicy` + `pcaValidatePermutation` (π(C)); nunca poda,
  agrega, duplica ni certifica. Una propuesta inválida cae al orden semántico
  seguro ya existente.

Un valor desconocido o no textual se normaliza a `disabled` (fail-closed).
La telemetría visible (modo, `activeInvocations`, `reordersApplied`,
`reordersRejected`, `orderFallbacks`, `rootReorders`, `internalReorders`)
muestra `—` mientras el dato no exista; nunca se inventa.

Invariante: para una misma FEN, K y reglas, la verdad exacta
(`status`, `move`, `depth`, `stopReason`, conjunto `forcedMateTargets` y
`survivors`) es idéntica en los tres modos. Sólo pueden diferir nodos, tiempo,
orden, trazas y cortes. `exactCache` y el solver AND/OR siguen siendo la única
autoridad exacta.

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

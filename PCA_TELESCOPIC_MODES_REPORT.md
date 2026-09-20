# PCA MODE: DISABLED | SHADOW | ACTIVE — entrega

Tarea de **observabilidad y control experimental** de la política telescópica ya
existente. No se añadió ningún algoritmo nuevo de búsqueda, ranking, verificación
ni compresión.

---

## 1. Archivos modificados

| Archivo | Cambio |
| --- | --- |
| `index.html` | selector `PCA MODE`, transporte UI → Worker → core, telemetría telescópica viva, panel compacto, helpers puros (`pcaNormalizeTelescopicMode`, `pcaCreateWorkerStartMessage`, `pcaReadTelescopicMode`, `pcaUpdateTelescopicTelemetry`) |
| `test/pca-telescopic-mode.test.cjs` | **nuevo**: 12 pruebas de transporte, contrato de modos e invariante exacto |
| `tools/pca-telescopic-compare.cjs` | **nuevo**: experimento reproducible (misma FEN + K en los tres modos, por core y por Worker real) |
| `README.md` | sección `PCA MODE` con el camino del valor y el invariante |

Nada se eliminó: `PCA SCORE`, K, nodos, NPS, tiempo, H, contracción, colisiones,
STOP_REASON y el resto del panel siguen presentes.

---

## 2. Punto exacto donde UI/Worker transmite `telescopicPolicy`

Cadena completa (un solo salto de transporte, un solo punto de uso en el core):

```text
# UI (index.html, analyzePCAChess)
const telescopicPolicy = pcaReadTelescopicMode();              // <select id="pcaTelescopicMode">
window.updatePCAMetrics({ ... telescopicMode: telescopicPolicy });
pcaWorker.postMessage(pcaCreateWorkerStartMessage({            // ← ÚNICO punto de transporte
    runId, fen: rootFen, kGuard: guard, telescopicPolicy
}));

# Worker (pcaCreateWorkerSource → workerHandler, rama START)
const telescopicPolicy = pcaNormalizeTelescopicMode(message.telescopicPolicy);  // fail-closed
...
const pcaResult = pcaAnalyzePositionCore(message.fen, kGuard, {                 // ← ÚNICO punto de uso
    telescopicPolicy: telescopicPolicy,
    onProgress: ...
});
```

`pcaCreateWorkerStartMessage()` devuelve exactamente
`{ type:'START', runId, fen, kGuard, telescopicPolicy }`, con el modo ya
normalizado (`disabled` | `shadow` | `active`); un valor desconocido cae a
`disabled`. No hay ningún otro camino que lleve el modo al Worker, y
`pcaResolveTelescopicMode()` (ya existente) sigue siendo la única autoridad de
interpretación dentro del core.

---

## 3. «Fallar primero»: qué había en `main`

1. **`pcaAnalyzePosition(fen, kGuard)`** → `return pcaAnalyzePositionCore(fen, kGuard)`
   sin opciones: la ruta pública de conveniencia **nunca** podía habilitar telescopía.
2. **`pcaResolveTelescopicMode(options)`** interpretaba: `null/false/'disabled'` →
   `disabled`; `'active'` → `active`; `true/'shadow'` → `shadow`; objeto con
   `mode`/`rank` → ese modo (`rank` concede autoridad activa); cualquier otra cosa →
   `disabled`. `pcaResolveTelescopicPolicy()` devuelve `ActiveTelescopicPolicy` por
   defecto en modo `active`.
3. **Transporte de opciones al Worker: no existía.** `analyzePCAChess()` enviaba
   `{ type:'START', runId, fen, kGuard }` y el handler del Worker llamaba
   `pcaAnalyzePositionCore(message.fen, kGuard, { onProgress })`. Verificado
   empíricamente con el Worker real: un `START` con `telescopicPolicy:'active'`
   devolvía `telescopicMode:'disabled'` y `activeInvocations:0`. Los modos `shadow`
   y `active` **no eran alcanzables** desde la interfaz.
4. **Métricas de Fase 2 ya existentes**: `activeInvocations`, `reordersApplied`,
   `reordersRejected`, `orderFallbacks`, `rootReorders`, `internalReorders` (más
   `shadowInvocations`, `proposalCount`, `proposalKinds`, `proposals`) se
   calculaban en `pcaApplyActiveTelescopicRanking` / `pcaObserveTelescopicContext`,
   se acumulaban con `pcaMergeTelescopicTelemetry` y se publicaban **sólo en el
   resultado final** (`pcaResultMetrics`). Durante `PROGRESS` no se emitían.
5. **`exactCache` y el solver AND/OR siguen siendo la única autoridad exacta**:
   `pcaCanForceMate` (AND/OR + `exactCache` + `pcaPositionKey`) no fue tocado; el
   modo telescópico sólo reordena la lista de candidatos antes del bucle.

**Divergencia encontrada entre arquitectura prevista y código real:** la
arquitectura suponía que el modo podía viajar como opción al core desde la UI; en
el código real el Worker descartaba cualquier campo extra del mensaje `START`, de
modo que `shadow`/`active` sólo eran alcanzables llamando al core directamente
(como hacen los tests). No se encontró ningún defecto que comprometiera el
invariante exacto: no hubo que parchear lógica de certificación (ver §6).

---

## 4. Cambio implementado

### Selector (panel PCA, junto a `K_GUARD`)

```html
<label for="pcaTelescopicMode" title="...">PCA MODE
  <select id="pcaTelescopicMode" aria-label="Política telescópica PCA">
    <option value="disabled" selected>DISABLED</option>
    <option value="shadow">SHADOW</option>
    <option value="active">ACTIVE</option>
  </select>
</label>
```

- `DISABLED` (por defecto): comportamiento previo, sin telescopía.
- `SHADOW`: observa/propone (`propose()`), nunca reordena.
- `ACTIVE`: sólo permuta mediante `ActiveTelescopicPolicy` + `pcaValidatePermutation`;
  si la permutación no es válida (o la política lanza), se conserva el orden
  semántico seguro y se incrementan `reordersRejected` / `orderFallbacks`.

### Telemetría viva

- El core añade a su snapshot de `PROGRESS` los contadores telescópicos
  (sólo lectura; no participan en orden, corte, cache ni certificación).
- El panel muestra: **modo actual** (`PCA MODE`), `ACTIVE_INV`, `REORDERS_APPL`,
  `REORDERS_REJ`, `FALLBACKS`, `ROOT_REORD`, `INT_REORD`, y en la línea inferior
  `shadow=<n> · propuestas=<n>`. Junto a ellos siguen `PCA SCORE`, K, nodos, NPS,
  tiempo, H, contracción, colisiones y `STOP_REASON`.
- Si un dato no existe todavía (p. ej. `PROGRESS` previo, run cancelado o modo
  `disabled` sin invocaciones), se muestra `—`/`0` real, **nunca** un valor
  inventado: la UI sólo publica campos que llegan y `updatePCAMetrics` formatea
  `—` para lo ausente.

---

## 5. Prueba manual principal (invariante)

Fixture y K suficiente (a `K=4` la posición sigue `UNRESOLVED`; `K=5` resuelve):

```text
FEN = 7k/8/8/4K3/8/8/8/1Q6 w - - 0 1
K   = 5
```

Ejecutable con `node tools/pca-telescopic-compare.cjs` (por core y por el Worker real):

| modo | status | depth | stopReason | survivors | forcedMateTargets (conjunto) |
| --- | --- | --- | --- | --- | --- |
| DISABLED | DECIDED_MULTIPLE | 5 | MULTIPLE_SHORTEST_FORCED_MATES | 3 | {Kf6, Qb7, Qg1} |
| SHADOW | DECIDED_MULTIPLE | 5 | MULTIPLE_SHORTEST_FORCED_MATES | 3 | {Kf6, Qb7, Qg1} |
| ACTIVE | DECIDED_MULTIPLE | 5 | MULTIPLE_SHORTEST_FORCED_MATES | 3 | {Kf6, Qb7, Qg1} |

`RESULT(DISABLED) = RESULT(SHADOW) = RESULT(ACTIVE)` en verdad exacta. El camino
por el Worker real reprodujo exactamente la misma verdad en los tres modos.

### Nodos y métricas de reorder observadas

| modo | nodos | tiempo core | activeInvocations | reordersApplied | reordersRejected | orderFallbacks | rootReorders | internalReorders | shadowInvocations |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DISABLED | 10 602 | 17.0 s | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| SHADOW | 10 602 | 17.6 s | 0 | 0 | 0 | 0 | 0 | 0 | 1 242 |
| ACTIVE | 11 219 | 20.5 s | 1 281 | 884 | 0 | 0 | 5 | 879 | 0 |

Observaciones:

- **SHADOW**: nodos idénticos a DISABLED (10 602), sin reorders. Sólo observa
  (1 242 invocaciones registradas en `shadowInvocations`); el `proposalCount` es 0
  porque la política shadow por defecto no propone nada.
- **ACTIVE**: más nodos que DISABLED (+617) y más tiempo (+3.5 s) en esta
  posición. El reordenamiento por defecto **no** acelera este benchmark; no se
  optimizó nada para ello, sólo se midió el comportamiento real.
- El orden de `forcedMateTargets` puede diferir entre modos (en ACTIVE aparece
  como `Qg1, Qb7, Kf6`), lo cual es legítimo porque la invariante habla del
  **conjunto**; se compara siempre ordenado.
- `reordersRejected = orderFallbacks = 0`: la política activa por defecto produjo
  permutaciones válidas en todas las 1 281 invocaciones de esta corrida.

---

## 6. Búsqueda de defectos que comprometieran el invariante

Antes de implementar se verificó por ejecución directa (no sólo lectura):

- **Fuzz de invariancia**: 14 FEN (mates en 1/2/3, `UNRESOLVED`, negras a mover,
  tablas) × K ∈ 1..4 × `semanticOrdering` on/off × 7 políticas
  (`disabled`, `shadow`, `active`, `active-reverse`, `active-rotate`,
  `active-throw`, `active-null`) → **196 comparaciones, 0 divergencias** en
  `status`, `move`, `depth`, `stopReason`, `survivors` y conjunto
  `forcedMateTargets`.
- **SHADOW**: 20 comparaciones → nodos idénticos a DISABLED en el 100 %.
- **Transporte por el Worker real**: 15 corridas (5 FEN × 3 modos, incluyendo la
  fase `PULSE_EVALUATION` en posiciones no resueltas) → modo preservado y verdad
  idéntica al core en todas.

**No se encontró ningún defecto que comprometiera el invariante exacto**, por lo
que no hubo parche de lógica exacta que aplicar. El único defecto real hallado fue
el de **transporte** (§3.3): el Worker ignoraba `telescopicPolicy`, dejando
`shadow`/`active` inalcanzables desde la UI; los modos existentes nunca se habían
acoplado a la interfaz, por lo que ninguna corrida previa quedó afectada.

Garantías verificadas por tests de que ACTIVE no puede: eliminar, agregar ni
duplicar candidatos; podar por confianza; escribir verdad exacta desde
memoria/evidencia; convertir `EMPIRICALLY_PURE` en certificado; ni usar NPS/tiempo
como señal semántica (p. ej. el solver es bit a bit determinista con
`Date.now`/`performance.now` alterados).

---

## 7. Tests

Archivo nuevo `test/pca-telescopic-mode.test.cjs` (12 pruebas):

1. la UI normaliza el modo y lo transporta explícito en el mensaje `START`;
1b. el modo llega al Worker y cambia la política realmente usada por el core
   (incluye el Worker real ejecutado en sandbox);
2. DISABLED es idéntico al comportamiento previo (sin opción telescópica);
3. SHADOW no altera resultado ni nodos respecto de DISABLED;
3b. SHADOW transporta sus contadores al PROGRESS pero nunca certifica verdad;
4. ACTIVE conserva la verdad exacta (fixture principal, K=5);
4b. ACTIVE por el Worker (transporte real) mantiene la verdad exacta;
5. política ACTIVE inválida falla cerrada al orden semántico;
5b. un modo inválido del selector cae a `disabled` de punta a punta;
6. NPS/tiempo no influyen en la selección del modo;
6b. el ranking ACTIVE ignora NPS/tiempo y el solver es determinista ante el reloj;
7. el panel PCA expone modo y contadores de reorder (`—` cuando no hay dato) sin
   perder `PCA SCORE`, K, nodos ni status.

Resultado de `npm test` (54 pruebas previas + 12 nuevas): **66/66 `pass`, 0 `fail`**.

---

## 8. Fuera de alcance (no implementado)

`RepresentationVerifier`, `RepresentationBuilder`, `REPLACE_REGION`, saltos
telescópicos, `statesAvoidedVerified`, compresión AND/OR, integración Collatz,
nuevos descriptores y `findBestDiscriminant()` siguen sin existir. El ranking
semántico y la fórmula de `PCA SCORE` no se modificaron.

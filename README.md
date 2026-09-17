# ajedrez
Versión simplificada del analizador de ajedrez basada en Stockfish.

## Modo adaptativo

El motor ahora incluye un sistema de análisis adaptativo que ajusta la
profundidad y selecciona movimientos según la evaluación actual. Utiliza
múltiples líneas de análisis (MultiPV) para buscar jugadas que mantengan o
recuperen el equilibrio dependiendo de la situación del tablero.

## K_GUARD infinito

Si `K_GUARD` es `∞`, el `NODE_GUARD` queda desactivado: no hay tope
operacional de nodos. El análisis continúa hasta forzar mate, agotar la
frontera de pulso o hasta que el usuario detenga el worker.

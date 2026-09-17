# ajedrez
Versión simplificada del analizador de ajedrez basada en Stockfish.

## K_GUARD infinito

Si `K_GUARD` es `∞`, el `NODE_GUARD` queda desactivado: no hay tope
operacional de nodos. El análisis continúa hasta forzar mate, agotar la
frontera de pulso o hasta que el usuario detenga el worker.

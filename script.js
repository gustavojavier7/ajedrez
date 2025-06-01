/**
 * Analizador de Ajedrez con Motor Fractal
 * Sistema híbrido que combina Stockfish con algoritmos fractales
 * para análisis adaptativos de posiciones de ajedrez
 */

(function () {
    'use strict';

    /* ===================== VARIABLES GLOBALES PRINCIPALES ===================== */
    let chess; // Instancia principal de Chess.js - ÚNICA DECLARACIÓN
    let board = [];
    let lastMove = null;
    let stockfish = null;
    let blobURL = null;
    let isEngineConnected = false;
    let isAnalyzing = false;
    let analysisInterval = null;
    let pvObserver = null;
    let fractalEngine = null;
    let fractalAnalysisActive = true;
    let fractalDimension = 1.247;
    let fractalIntensity = 0.6;
    let currentComplexity = 0;
    
    let lastStats = {
        nps: 0,
        pv: '',
        evaluation: null,
        depth: 0,
        bestMove: '',
        bestMoveSan: '',
        fractalComplexity: 0,
        optimalDepth: 0,
        fractalConfidence: 0,
        searchEfficiency: 0
    };

    /* ===================== CONSTANTES Y CONFIGURACIÓN ===================== */
    const PIECE_SYMBOLS = {
        'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
        'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟'
    };
    
    const BOARD_CONFIG = {
        squareSize: 65,
        get boardSize() { return this.squareSize * 8; }
    };

    const STOCKFISH_URL = 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js';

    /**
     * Verifica si Chess.js está disponible y espera si es necesario
     */
    function checkChessAvailability() {
        return new Promise((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 100;
            const interval = 100;
            
            function check() {
                attempts++;
                console.log(`Verificando Chess.js... intento ${attempts}/${maxAttempts}`);
                
                if (typeof Chess !== 'undefined') {
                    console.log('✅ Chess.js está disponible');
                    resolve();
                } else if (attempts >= maxAttempts) {
                    console.error('❌ Chess.js no disponible después de', attempts, 'intentos');
                    reject(new Error('Chess.js no se cargó'));
                } else {
                    setTimeout(check, interval);
                }
            }
            
            if (typeof Chess !== 'undefined') {
                console.log('✅ Chess.js ya está disponible');
                resolve();
            } else {
                console.log('⏳ Esperando Chess.js...');
                setTimeout(check, interval);
            }
        });
    }

    /**
     * Muestra error si Chess.js no se puede cargar
     */
    function showChessJsError() {
        const chessboard = document.getElementById('chessboard');
        if (chessboard) {
            chessboard.innerHTML = `
                <div class="loading">
                    <i class="fas fa-exclamation-triangle" style="color: #ef4444;"></i>
                    <p><strong>Error: Chess.js no disponible</strong></p>
                    <p style="font-size: 0.8rem; color: #6b7280; margin: 10px 0;">
                        Posibles soluciones:<br>
                        • Verifica tu conexión a internet<br>
                        • Desactiva bloqueadores de contenido<br>
                        • Intenta recargar la página
                    </p>
                    <button onclick="location.reload()" style="
                        padding: 10px 20px;
                        background: linear-gradient(135deg, #3b82f6, #1d4ed8);
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        font-weight: 600;
                        transition: transform 0.2s;
                    " onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
                        🔄 Reintentar
                    </button>
                </div>
            `;
        }
    }

    /**
     * Función principal que inicializa la aplicación
     */
    async function initializeChessApp() {
        try {
            // Esperar a que Chess.js esté disponible
            await checkChessAvailability();
            
            console.log('🚀 Iniciando Analizador de Ajedrez Fractal...');
            
            // Inicializar la instancia principal de Chess.js - ÚNICA INICIALIZACIÓN
            chess = new Chess();
            console.log('✅ Chess.js inicializado correctamente');
            
            // Continuar con la inicialización
            startChessApplication();
            
            // Exponer API pública después de la inicialización
            exposePublicAPI();
            console.log('🔌 API pública expuesta correctamente');
            
        } catch (error) {
            console.error('💥 Error al inicializar:', error);
            showChessJsError();
        }
    }

    /* ===================== CLASE MOTOR FRACTAL ===================== */
    class FractalChessEngine {
        constructor(dimension = 1.247) {
            this.D = dimension;
            this.cache = new Map();
            this.pieceValues = {
                'p': 100, 'n': 320, 'b': 330, 'r': 500, 'q': 900, 'k': 20000,
                'P': 100, 'N': 320, 'B': 330, 'R': 500, 'Q': 900, 'K': 20000
            };
            this.complexityThreshold = 12.0;
            this.maxCacheSize = 1000;
        }

        /**
         * Calcula la complejidad fractal de una posición FEN
         */
        calculateFractalComplexity(fen) {
            if (this.cache.has(fen)) {
                return this.cache.get(fen);
            }
            
            try {
                const pieces = this.countPieces(fen);
                const mobility = this.estimateMobility(fen);
                const centerControl = this.evaluateCenterControl(fen);
                const kingSafety = this.evaluateKingSafety(fen);

                const complexity = Math.pow(pieces, 1/this.D) *
                                  Math.pow(Math.max(mobility, 1), 1/this.D) *
                                  Math.pow(Math.max(Math.abs(centerControl) + 1, 1), 1/this.D) *
                                  Math.pow(Math.max(kingSafety + 1, 1), 1/this.D);

                const result = Math.max(1.0, Math.min(50.0, complexity));
                
                if (this.cache.size >= this.maxCacheSize) {
                    const firstKey = this.cache.keys().next().value;
                    this.cache.delete(firstKey);
                }
                this.cache.set(fen, result);
                
                return result;
            } catch (error) {
                console.warn('Error calculating fractal complexity:', error);
                return 10.0;
            }
        }

        /**
         * Cuenta el número total de piezas en el tablero
         */
        countPieces(fen) {
            const position = fen.split(' ')[0];
            return position.replace(/[0-8\/]/g, '').length;
        }

        /**
         * Estima la movilidad de la posición actual
         */
        estimateMobility(fen) {
            try {
                const tempChess = new Chess(fen);
                return tempChess.moves().length;
            } catch (e) {
                return 20;
            }
        }

        /**
         * Evalúa el control del centro del tablero
         */
        evaluateCenterControl(fen) {
            try {
                const tempChess = new Chess(fen);
                const centerSquares = ['d4', 'd5', 'e4', 'e5'];
                let control = 0;
                
                centerSquares.forEach(square => {
                    const piece = tempChess.get(square);
                    if (piece) {
                        control += piece.color === 'w' ? 10 : -10;
                    }
                });
                
                return control;
            } catch (e) {
                return 0;
            }
        }

        /**
         * Evalúa la seguridad del rey
         */
        evaluateKingSafety(fen) {
            try {
                const tempChess = new Chess(fen);
                let safety = 10;
                
                if (tempChess.in_check()) {
                    safety -= 50;
                }
                
                return safety;
            } catch (e) {
                return 10;
            }
        }

        /**
         * Calcula la profundidad óptima basada en la complejidad
         */
        calculateOptimalDepth(complexity) {
            const baseDepth = 12;
            const complexityFactor = Math.pow(complexity / 10, 1/this.D);
            const optimalDepth = Math.round(baseDepth + complexityFactor * 6);
            return Math.min(Math.max(optimalDepth, 8), 22);
        }

        /**
         * Actualiza la dimensión fractal y limpia el cache
         */
        updateDimension(newDimension) {
            this.D = Math.max(1.0, Math.min(2.0, newDimension));
            this.cache.clear();
        }

        /**
         * Limpia el cache de complejidad
         */
        clearCache() {
            this.cache.clear();
        }
    }

    /* ===================== FUNCIONES UTILITARIAS ===================== */
    
    /**
     * Parsea una posición FEN y actualiza el estado del tablero
     */
    function parseFEN(fen) {
        if (!fen || typeof fen !== 'string' || fen.length > 100) {
            throw new Error('FEN inválido: vacío, muy largo o no es string');
        }
        
        const validation = chess.validate_fen(fen);
        if (!validation.valid) {
            throw new Error(`FEN inválido: ${validation.error}`);
        }
        
        chess.load(fen);
        const position = fen.split(' ')[0];
        const rows = position.split('/');
        
        if (rows.length !== 8) {
            throw new Error('FEN inválido: número incorrecto de filas');
        }
        
        board = Array(8).fill().map(() => Array(8).fill(null));
        
        for (let row = 0; row < 8; row++) {
            let col = 0;
            const actualRow = 7 - row;
            
            for (let char of rows[row]) {
                if (/\d/.test(char)) {
                    col += parseInt(char);
                } else if (col < 8) {
                    board[actualRow][col] = char;
                    col++;
                } else {
                    throw new Error('FEN inválido: demasiadas piezas en fila');
                }
            }
            
            if (col !== 8) {
                throw new Error(`FEN inválido: fila ${8 - row} tiene número incorrecto de casillas`);
            }
        }
    }

    /**
     * Convierte un movimiento UCI a notación algebraica estándar
     */
    function uciToSan(uciMove) {
        if (!uciMove || uciMove.length < 4) return uciMove;
        
        try {
            const from = uciMove.substring(0, 2);
            const to = uciMove.substring(2, 4);
            const promotion = uciMove.length > 4 ? uciMove[4] : undefined;
            
            const tempChess = new Chess(chess.fen()); // Usar FEN de la instancia global
            const move = tempChess.move({ from, to, promotion });
            return move ? move.san : uciMove;
        } catch (e) {
            return uciMove;
        }
    }

    /**
     * Formatea la evaluación para mostrar
     */
    function formatEvaluation(score, isMate) {
        if (isMate) {
            return score > 0 ? `+M${Math.abs(score)}` : `-M${Math.abs(score)}`;
        }
        const pawns = score / 100;
        return pawns > 0 ? `+${pawns.toFixed(2)}` : pawns.toFixed(2);
    }

    /**
     * Genera el SVG del tablero de ajedrez
     */
    function generateChessboardSVG() {
        const { squareSize, boardSize } = BOARD_CONFIG;
        const svgParts = [
            `<svg width="${boardSize + 40}" height="${boardSize + 40}" xmlns="http://www.w3.org/2000/svg" role="grid" aria-label="Tablero de ajedrez">`
        ];
        
        // Dibujar casillas
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const x = col * squareSize + 20;
                const y = row * squareSize + 20;
                const fill = (row + col) % 2 === 0 ? '#F5F5DC' : '#C19A6B';
                const squareName = String.fromCharCode(97 + col) + (8 - row);
                
                svgParts.push(
                    `<rect x="${x}" y="${y}" width="${squareSize}" height="${squareSize}" ` +
                    `fill="${fill}" data-square="${squareName}" ` +
                    `role="gridcell" aria-label="Casilla ${squareName}" />`
                );
            }
        }
        
        // Resaltar último movimiento
        if (lastMove && chess.history({ verbose: true }).length > 0) {
            const history = chess.history({ verbose: true });
            const move = history[history.length - 1];
            
            const fromCol = move.from.charCodeAt(0) - 97;
            const fromRow = 8 - parseInt(move.from[1]);
            const toCol = move.to.charCodeAt(0) - 97;
            const toRow = 8 - parseInt(move.to[1]);
            
            const fromX = fromCol * squareSize + 20;
            const fromY = fromRow * squareSize + 20;
            const toX = toCol * squareSize + 20;
            const toY = toRow * squareSize + 20;
            
            svgParts.push(
                `<rect x="${fromX}" y="${fromY}" width="${squareSize}" height="${squareSize}" fill="rgba(255, 255, 0, 0.5)" />`,
                `<rect x="${toX}" y="${toY}" width="${squareSize}" height="${squareSize}" fill="rgba(255, 255, 0, 0.5)" />`
            );
        }
        
        // Dibujar flecha del mejor movimiento
        if (lastStats.bestMove && lastStats.bestMove.length >= 4) {
            const from = lastStats.bestMove.substring(0, 2);
            const to = lastStats.bestMove.substring(2, 4);
            
            const fromCol = from.charCodeAt(0) - 97;
            const fromRow = 8 - parseInt(from[1]);
            const toCol = to.charCodeAt(0) - 97;
            const toRow = 8 - parseInt(to[1]);
            
            const fromX = (fromCol * squareSize) + squareSize/2 + 20;
            const fromY = (fromRow * squareSize) + squareSize/2 + 20;
            const toX = (toCol * squareSize) + squareSize/2 + 20;
            const toY = (toRow * squareSize) + squareSize/2 + 20;
            
            const arrowColor = fractalAnalysisActive ? "#8b5cf6" : "#3B82F6";
            
            svgParts.push(
                `<defs>
                    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                        <polygon points="0 0, 10 3.5, 0 7" fill="${arrowColor}" />
                    </marker>
                </defs>
                <line x1="${fromX}" y1="${fromY}" x2="${toX}" y2="${toY}" ` +
                `stroke="${arrowColor}" stroke-width="4" opacity="0.8" marker-end="url(#arrowhead)" />`
            );
        }
        
        // Dibujar piezas
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = board[7 - row][col];
                if (piece) {
                    const x = col * squareSize + squareSize / 2 + 20;
                    const y = row * squareSize + squareSize / 2 + squareSize / 4 + 20;
                    const symbol = PIECE_SYMBOLS[piece] || '';
                    
                    svgParts.push(
                        `<text x="${x}" y="${y}" font-size="48" text-anchor="middle" ` +
                        `fill="#000" aria-label="Pieza ${piece}">${symbol}</text>`
                    );
                }
            }
        }
        
        // Dibujar coordenadas
        for (let i = 0; i < 8; i++) {
            svgParts.push(
                `<text x="10" y="${i * squareSize + squareSize / 1.5 + 20}" ` +
                `font-size="16" text-anchor="middle" fill="#666">${8 - i}</text>`,
                `<text x="${i * squareSize + squareSize / 2 + 20}" y="${boardSize + 35}" ` +
                `font-size="16" text-anchor="middle" fill="#666">${String.fromCharCode(97 + i)}</text>`
            );
        }
        
        svgParts.push('</svg>');
        return svgParts.join('');
    }

    /**
     * Muestra el estado actual del juego
     */
    function showGameStatus() {
        const statusElement = document.getElementById('gameStatus');
        if (!statusElement) return;
        
        let status = "";
        let iconClass = "fas fa-info-circle";
        let statusClass = "status-info";
        
        if (chess.in_checkmate()) {
            status = "¡Jaque mate!";
            iconClass = "fas fa-crown";
            statusClass = "status-danger";
        } else if (chess.in_stalemate()) {
            status = "Tablas por ahogado";
            iconClass = "fas fa-handshake";
            statusClass = "status-warning";
        } else if (chess.in_draw()) {
            if (chess.in_threefold_repetition()) {
                status = "Tablas por repetición";
            } else if (chess.insufficient_material()) {
                status = "Tablas por material insuficiente";
            } else {
                status = "Tablas por regla de 50 movimientos";
            }
            iconClass = "fas fa-handshake";
            statusClass = "status-warning";
        } else if (chess.in_check()) {
            status = "¡Jaque!";
            iconClass = "fas fa-exclamation-triangle";
            statusClass = "status-warning";
        } else {
            status = chess.turn() === 'w' ? "Turno: Blancas" : "Turno: Negras";
            iconClass = "fas fa-chess";
            statusClass = "status-success";
        }
        
        statusElement.className = `game-status-compact ${statusClass}`;
        statusElement.innerHTML = `<i class="${iconClass}"></i><span>${status}</span>`;
    }

    /* ===================== FUNCIONES DE ACTUALIZACIÓN DE UI ===================== */
    
    /**
     * Actualiza las estadísticas de memoria
     */
    function updateMemoryStats() {
        const memoryStats = document.getElementById('memoryStats');
        if (!memoryStats) return;

        if (window.performance && window.performance.memory) {
            const memory = window.performance.memory;
            const memoryMB = Math.round(memory.usedJSHeapSize / (1024 * 1024));
            memoryStats.textContent = `Memoria: ${memoryMB}MB`;
        } else {
            memoryStats.textContent = 'Memoria: N/A';
        }
    }

    /**
     * Actualiza la pantalla de métricas fractales
     */
    function updateFractalDisplay() {
        const complexityEl = document.getElementById('fractalComplexity');
        const depthEl = document.getElementById('optimalDepth');
        const confidenceEl = document.getElementById('fractalConfidence');
        const efficiencyEl = document.getElementById('searchEfficiency');
        
        if (!fractalAnalysisActive || !fractalEngine) {
            if (complexityEl) complexityEl.textContent = '--';
            if (depthEl) depthEl.textContent = '--';
            if (confidenceEl) confidenceEl.textContent = '--';
            if (efficiencyEl) efficiencyEl.textContent = '--';
            return;
        }
        
        try {
            const fen = chess.fen();
            const complexity = fractalEngine.calculateFractalComplexity(fen);
            const optimalDepth = fractalEngine.calculateOptimalDepth(complexity);
            currentComplexity = complexity;
            
            if (complexityEl) complexityEl.textContent = complexity.toFixed(2);
            if (depthEl) depthEl.textContent = optimalDepth.toString();
            
            const confidenceValue = Math.min(95, 60 + (complexity / 20 * 35));
            if (confidenceEl) confidenceEl.textContent = confidenceValue.toFixed(1) + '%';
            
            if (isAnalyzing && lastStats.nps > 0) {
                const efficiencyValue = Math.min(100, (lastStats.nps / 1000000) * 100);
                if (efficiencyEl) efficiencyEl.textContent = efficiencyValue.toFixed(1) + '%';
            }
        } catch (error) {
            console.warn('Error updating fractal display:', error);
        }
    }

    /**
     * Actualiza los estados de los botones
     */
    function updateButtonStates() {
        const engineBtn = document.getElementById('engineToggleBtn');
        const analysisBtn = document.getElementById('analysisToggleBtn');
        const showMovesBtn = document.getElementById('showMovesBtn');

        if (engineBtn) {
            if (isEngineConnected) {
                engineBtn.innerHTML = '<i class="fas fa-power-off"></i>Desconectar Motor';
                engineBtn.className = 'btn btn-warning';
            } else {
                engineBtn.innerHTML = '<i class="fas fa-plug"></i>Conectar Motor';
                engineBtn.className = 'btn btn-purple';
            }
        }

        if (analysisBtn) {
            if (isAnalyzing) {
                analysisBtn.innerHTML = '<i class="fas fa-stop"></i>Detener Análisis';
                analysisBtn.className = 'btn btn-danger';
                analysisBtn.disabled = false;
            } else {
                analysisBtn.innerHTML = '<i class="fas fa-play"></i>Analizar';
                analysisBtn.className = 'btn btn-success';
                analysisBtn.disabled = !isEngineConnected || chess.game_over();
            }
        }

        if (showMovesBtn) {
            showMovesBtn.disabled = chess.game_over();
        }
    }

    /* ===================== GESTIÓN DEL MOTOR STOCKFISH ===================== */
    
    /**
     * Conecta al motor Stockfish
     */
    function connectEngine() {
        if (isEngineConnected) return;

        const engineStatus = document.getElementById('engineStatus');
        if (!engineStatus) return;
        
        engineStatus.textContent = 'Conectando motor...';

        fetch(STOCKFISH_URL)
            .then(response => {
                if (!response.ok) {
                    throw new Error('Error al descargar Stockfish');
                }
                return response.text();
            })
            .then(code => {
                blobURL = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
                stockfish = new Worker(blobURL);
                
                stockfish.onmessage = e => handleEngineMessage(e.data);
                stockfish.onerror = err => {
                    console.error('Error en Stockfish:', err);
                    engineStatus.textContent = 'Error en el motor';
                    disconnectEngine();
                };
                
                // Inicializar motor
                stockfish.postMessage('uci');
                stockfish.postMessage('setoption name MultiPV value 1');
                stockfish.postMessage('setoption name Hash value 128');
                stockfish.postMessage('isready');
                
                isEngineConnected = true;
                engineStatus.textContent = 'Motor conectado y listo';
                updateButtonStates();
                
                // Iniciar análisis automáticamente si hay una posición válida
                if (!chess.game_over()) {
                    setTimeout(startAnalysis, 500);
                }
            })
            .catch(err => {
                console.error('Error conectando motor:', err);
                engineStatus.textContent = `Error: ${err.message}`;
                isEngineConnected = false;
                updateButtonStates();
            });
    }

    /**
     * Desconecta el motor Stockfish
     */
    function disconnectEngine() {
        if (!isEngineConnected) return;
        
        if (isAnalyzing) {
            stopAnalysis();
        }
        
        if (stockfish) {
            stockfish.terminate();
            stockfish = null;
        }
        
        if (blobURL) {
            URL.revokeObjectURL(blobURL);
            blobURL = null;
        }
        
        isEngineConnected = false;
        const engineStatus = document.getElementById('engineStatus');
        if (engineStatus) engineStatus.textContent = 'Motor desconectado';
        
        // Limpiar displays
        resetAnalysisDisplay();
        updateButtonStates();
    }

    /**
     * Inicia el análisis de la posición actual
     */
    function startAnalysis() {
        if (!isEngineConnected || isAnalyzing || chess.game_over()) return;

        const engineStatus = document.getElementById('engineStatus');
        if (!engineStatus) return;
        
        const fen = chess.fen();
        let searchCommand = 'go infinite';
        
        // Configurar análisis fractal si está activo
        if (fractalAnalysisActive && fractalEngine) {
            try {
                const complexity = fractalEngine.calculateFractalComplexity(fen);
                const depth = fractalEngine.calculateOptimalDepth(complexity);
                searchCommand = `go depth ${depth}`;
                engineStatus.textContent = `Analizando con profundidad fractal (D=${depth})...`;
            } catch (error) {
                console.warn('Error en análisis fractal:', error);
                engineStatus.textContent = 'Analizando...';
            }
        } else {
            engineStatus.textContent = 'Analizando...';
        }

        // Enviar comandos al motor
        stockfish.postMessage(`position fen ${fen}`);
        stockfish.postMessage(searchCommand);
        
        isAnalyzing = true;
        updateButtonStates();
        
        const pvLine = document.getElementById('pvLine');
        if (pvLine) pvLine.textContent = 'Analizando...';
        
        // Intervalo para actualizar estadísticas
        analysisInterval = setInterval(() => {
            updateMemoryStats();
            updateFractalDisplay();
        }, 1000);
    }

    /**
     * Detiene el análisis actual
     */
    function stopAnalysis() {
        if (!isAnalyzing) return;
        
        if (stockfish) {
            stockfish.postMessage('stop');
        }
        
        if (analysisInterval) {
            clearInterval(analysisInterval);
            analysisInterval = null;
        }
        
        isAnalyzing = false;
        const engineStatus = document.getElementById('engineStatus');
        if (engineStatus) {
            const statusText = fractalAnalysisActive ? 
                'Motor conectado - Análisis fractal detenido' : 
                'Motor conectado - Análisis detenido';
            engineStatus.textContent = statusText;
        }
        updateButtonStates();
    }

    /* ===================== PROCESAMIENTO DE MENSAJES UCI ===================== */
    
    /**
     * Maneja los mensajes del motor Stockfish
     */
    function handleEngineMessage(line) {
        if (typeof line !== 'string') return;

        if (line.startsWith('bestmove')) {
            processBestMove(line);
        } else if (line.startsWith('info')) {
            parseInfoLine(line);
        }
    }

    /**
     * Procesa el mensaje de mejor movimiento
     */
    function processBestMove(line) {
        const parts = line.split(' ');
        const bestMove = parts[1];
        
        if (bestMove && bestMove !== '(none)') {
            lastStats.bestMove = bestMove;
            lastStats.bestMoveSan = uciToSan(bestMove);
            
            const moveText = fractalAnalysisActive ? 
                `🌀 Mejor: ${lastStats.bestMoveSan}` : 
                `Mejor: ${lastStats.bestMoveSan}`;
            
            const bestMoveEl = document.getElementById('bestMove');
            if (bestMoveEl) bestMoveEl.textContent = moveText;
            
            // Redibujar tablero con flecha
            const chessboard = document.getElementById('chessboard');
            if (chessboard) chessboard.innerHTML = generateChessboardSVG();
        }
    }

    /**
     * Parsea la línea de información del motor
     */
    function parseInfoLine(line) {
        const parts = line.split(' ');
        
        // Obtener nodos y tiempo para calcular NPS
        const nodesIndex = parts.indexOf('nodes');
        const timeIndex = parts.indexOf('time');
        if (nodesIndex !== -1 && timeIndex !== -1) {
            const nodes = parseInt(parts[nodesIndex + 1]);
            const time = parseInt(parts[timeIndex + 1]) / 1000;
            if (time > 0) {
                lastStats.nps = Math.round(nodes / time);
            }
        }
        
        // Obtener profundidad
        const depthIndex = parts.indexOf('depth');
        if (depthIndex !== -1) {
            lastStats.depth = parseInt(parts[depthIndex + 1]);
        }

        // Obtener evaluación
        const scoreIndex = parts.indexOf('score');
        if (scoreIndex !== -1) {
            parseScore(parts, scoreIndex);
        }

        // Obtener variante principal
        const pvIndex = parts.indexOf('pv');
        if (pvIndex !== -1 && parts.length > pvIndex + 1) {
            const pvMoves = parts.slice(pvIndex + 1, pvIndex + 10);
            lastStats.pv = convertPVToSAN(pvMoves);
        }

        updateEvaluationDisplay();
    }

    /**
     * Parsea la puntuación del motor
     */
    function parseScore(parts, scoreIndex) {
        const type = parts[scoreIndex + 1];
        const value = parseInt(parts[scoreIndex + 2]);
        
        if (type === 'cp') {
            let adjustedEval = chess.turn() === 'w' ? value : -value;
            
            // Aplicar ajuste fractal
            if (fractalAnalysisActive && currentComplexity > 0) {
                const fractalAdjustment = Math.min(0.1, 
                    Math.max(0, Math.pow(currentComplexity / 10, 1/fractalDimension) * 0.05)
                );
                adjustedEval *= (1 + fractalAdjustment);
            }
            
            lastStats.evaluation = { value: adjustedEval, type: 'cp' };
        } else if (type === 'mate') {
            const adjustedMate = chess.turn() === 'w' ? value : -value;
            lastStats.evaluation = { value: adjustedMate, type: 'mate' };
        }
    }

    /**
     * Actualiza la pantalla de evaluación
     */
    function updateEvaluationDisplay() {
        const evalEl = document.getElementById('evaluation');
        const engineStatsEl = document.getElementById('engineStats');
        const pvLineEl = document.getElementById('pvLine');

        // Actualizar evaluación
        if (lastStats.evaluation !== null && evalEl) {
            const evalData = lastStats.evaluation;
            const isMate = evalData.type === 'mate';
            const score = evalData.value;
            
            evalEl.textContent = formatEvaluation(score, isMate);
            evalEl.className = 'evaluation';
            
            if (isMate) {
                evalEl.classList.add(score > 0 ? 'eval-positive' : 'eval-negative');
            } else {
                if (score > 50) {
                    evalEl.classList.add('eval-positive');
                } else if (score < -50) {
                    evalEl.classList.add('eval-negative');
                } else {
                    evalEl.classList.add('eval-neutral');
                }
            }
        }

        // Actualizar variante principal
        if (lastStats.pv && pvLineEl) {
            pvLineEl.textContent = lastStats.pv;
        }

        // Actualizar estadísticas del motor
        if (engineStatsEl) {
            const depthText = fractalAnalysisActive && fractalEngine ?
                `Profundidad: ${lastStats.depth}/${fractalEngine.calculateOptimalDepth(currentComplexity)}` :
                `Profundidad: ${lastStats.depth}`;
            
            const npsText = lastStats.nps > 0 ? ` | ${lastStats.nps.toLocaleString()} nodos/s` : '';
            engineStatsEl.textContent = depthText + npsText;
        }
    }

    /**
     * Resetea los displays de análisis
     */
    function resetAnalysisDisplay() {
        const evaluation = document.getElementById('evaluation');
        const bestMove = document.getElementById('bestMove');
        const engineStats = document.getElementById('engineStats');
        const pvLine = document.getElementById('pvLine');
        
        if (evaluation) evaluation.textContent = '--';
        if (bestMove) bestMove.textContent = '--';
        if (engineStats) engineStats.textContent = '--';
        if (pvLine) pvLine.textContent = 'Motor desconectado';
    }

    /* ===================== GESTIÓN DE MOVIMIENTOS ===================== */
    
    /**
     * Muestra los movimientos legales de la posición actual
     */
    function showLegalMoves() {
        if (chess.game_over()) return;
        
        const listEl = document.getElementById('legalMovesList');
        const panel = document.getElementById('legalMoves');
        const headerEl = document.getElementById('legalMovesHeader');
        
        if (!listEl || !panel || !headerEl) return;
        
        const moves = chess.moves({ verbose: true });
        
        headerEl.innerHTML = `<i class="fas fa-chess-knight"></i> Movimientos Legales (${moves.length})`;
        
        if (moves.length === 0) {
            listEl.innerHTML = '<div style="text-align: center; padding: 20px; color: #9ca3af;">No hay movimientos legales</div>';
        } else {
            listEl.innerHTML = moves.map(move => {
                return `<div class="move-item" onclick="window.chessApp.makeMove('${move.san}')">
                    <span class="move-notation">${move.san}</span>
                    <span class="move-coords">${move.from}-${move.to}</span>
                </div>`;
            }).join('');
        }
        
        panel.style.display = 'block';
    }

    /**
     * Oculta el panel de movimientos legales
     */
    function hideLegalMoves() {
        const panel = document.getElementById('legalMoves');
        if (panel) panel.style.display = 'none';
    }

    /**
     * Ejecuta un movimiento en el tablero
     */
    function makeMove(moveStr) {
        try {
            const moveResult = chess.move(moveStr);
            if (!moveResult) {
                console.warn('Movimiento inválido:', moveStr);
                return;
            }
            
            lastMove = moveResult;
            
            // Actualizar FEN input
            const fenInput = document.getElementById('fenInput');
            if (fenInput) fenInput.value = chess.fen();
            
            // Redibujar tablero y actualizar estado
            drawBoard();
            showLegalMoves();
            
            // Reiniciar análisis si está conectado
            if (isAnalyzing) {
                stopAnalysis();
            }
            
            // Reiniciar estadísticas
            resetStats();
            resetAnalysisDisplay();
            
            // Reanudar análisis automáticamente
            if (isEngineConnected && !chess.game_over()) {
                setTimeout(startAnalysis, 500);
            }
            
        } catch (error) {
            console.error('Error al hacer movimiento:', error);
        }
    }

    /**
     * Reinicia las estadísticas de análisis
     */
    function resetStats() {
        lastStats = {
            nps: 0,
            pv: '',
            evaluation: null,
            depth: 0,
            bestMove: '',
            bestMoveSan: '',
            fractalComplexity: 0,
            optimalDepth: 0,
            fractalConfidence: 0,
            searchEfficiency: 0
        };
    }

    /* ===================== FUNCIONES PRINCIPALES DEL TABLERO ===================== */
    
    /**
     * Dibuja el tablero con la posición actual
     */
    function drawBoard() {
        const fenInput = document.getElementById('fenInput');
        if (!fenInput) return;
        
        const fen = fenInput.value.trim();
        if (!fen || fen.length > 100) {
            alert('Por favor, ingresa una posición FEN válida.');
            return;
        }
        
        try {
            parseFEN(fen);
            
            const chessboard = document.getElementById('chessboard');
            if (chessboard) chessboard.innerHTML = generateChessboardSVG();
            
            const legalMoves = document.getElementById('legalMoves');
            if (legalMoves) legalMoves.style.display = 'none';
            
            showGameStatus();
            updateButtonStates();
            updateMemoryStats();
            updateFractalDisplay();
            
            // Reiniciar análisis si ya estaba corriendo
            if (isAnalyzing) {
                stopAnalysis();
            }
            
            resetStats();
            resetAnalysisDisplay();
            
        } catch (error) {
            alert(error.message);
        }
    }

    /* ===================== CONTROLES FRACTALES ===================== */
    
    /**
     * Configura los controles de la sección fractal
     */
    function setupFractalControls() {
        fractalEngine = new FractalChessEngine(fractalDimension);

        const dimSlider = document.getElementById('dimensionSlider');
        const intSlider = document.getElementById('intensitySlider');
        const dimVal = document.getElementById('dimensionValue');
        const intVal = document.getElementById('intensityValue');
        const enableChk = document.getElementById('enableFractal');

        // Control de dimensión fractal
        if (dimSlider && dimVal) {
            dimSlider.addEventListener('input', e => {
                fractalDimension = parseFloat(e.target.value);
                dimVal.textContent = fractalDimension.toFixed(3);
                if (fractalEngine) fractalEngine.updateDimension(fractalDimension);
                updateFractalDisplay();
            });
        }

        // Control de intensidad fractal
        if (intSlider && intVal) {
            intSlider.addEventListener('input', e => {
                fractalIntensity = parseInt(e.target.value, 10) / 100;
                intVal.textContent = `${e.target.value}%`;
                updateFractalDisplay();
            });
        }

        // Toggle de análisis fractal
        if (enableChk) {
            enableChk.addEventListener('change', e => {
                fractalAnalysisActive = e.target.checked;
                const fractalSection = document.querySelector('.fractal-section');
                if (fractalSection) {
                    if (fractalAnalysisActive) {
                        fractalSection.classList.add('fractal-active');
                    } else {
                        fractalSection.classList.remove('fractal-active');
                    }
                }
                updateFractalDisplay();
                
                // Si está analizando, reiniciar con nueva configuración
                if (isAnalyzing) {
                    stopAnalysis();
                    setTimeout(startAnalysis, 300);
                }
            });
        }
    }

    /* ===================== FUNCIONES DE TOGGLE ===================== */
    
    /**
     * Toggle del motor de ajedrez
     */
    function toggleEngine() {
        if (isEngineConnected) {
            disconnectEngine();
        } else {
            connectEngine();
        }
    }

    /**
     * Toggle del análisis
     */
    function toggleAnalysis() {
        if (isAnalyzing) {
            stopAnalysis();
        } else {
            startAnalysis();
        }
    }

    /* ===================== FUNCIONES DE ANIMACIÓN Y GESTIÓN ===================== */
    
    /**
     * Gestiona las animaciones de la sección fractal
     */
    function manageFractalAnimations() {
        setInterval(() => {
            const fractalSection = document.querySelector('.fractal-section');
            if (fractalSection) {
                if (fractalAnalysisActive && isAnalyzing) {
                    fractalSection.classList.add('fractal-active');
                } else if (!fractalAnalysisActive) {
                    fractalSection.classList.remove('fractal-active');
                }
            }
        }, 100);
    }/**
 * Analizador de Ajedrez con Motor Fractal
 * Sistema híbrido que combina Stockfish con algoritmos fractales
 * para análisis adaptativos de posiciones de ajedrez
 */

(function () {
    'use strict';

    /**
     * Verifica si Chess.js está disponible y espera si es necesario
     */
    function checkChessAvailability() {
        return new Promise((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 100; // Aumentar intentos
            const interval = 100; // ms entre intentos
            
            function check() {
                attempts++;
                console.log(`Verificando Chess.js... intento ${attempts}/${maxAttempts}`);
                
                if (typeof Chess !== 'undefined') {
                    console.log('✅ Chess.js está disponible');
                    resolve();
                } else if (attempts >= maxAttempts) {
                    console.error('❌ Chess.js no disponible después de', attempts, 'intentos');
                    reject(new Error('Chess.js no se cargó'));
                } else {
                    setTimeout(check, interval);
                }
            }
            
            // Verificación inmediata
            if (typeof Chess !== 'undefined') {
                console.log('✅ Chess.js ya está disponible');
                resolve();
            } else {
                console.log('⏳ Esperando Chess.js...');
                setTimeout(check, interval);
            }
        });
    }

    /**
     * Muestra error si Chess.js no se puede cargar
     */
    function showChessJsError() {
        const chessboard = document.getElementById('chessboard');
        if (chessboard) {
            chessboard.innerHTML = `
                <div class="loading">
                    <i class="fas fa-exclamation-triangle" style="color: #ef4444;"></i>
                    <p><strong>Error: Chess.js no disponible</strong></p>
                    <p style="font-size: 0.8rem; color: #6b7280; margin: 10px 0;">
                        Posibles soluciones:<br>
                        • Verifica tu conexión a internet<br>
                        • Desactiva bloqueadores de contenido<br>
                        • Intenta recargar la página
                    </p>
                    <button onclick="location.reload()" style="
                        padding: 10px 20px;
                        background: linear-gradient(135deg, #3b82f6, #1d4ed8);
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        font-weight: 600;
                        transition: transform 0.2s;
                    " onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
                        🔄 Reintentar
                    </button>
                </div>
            `;
        }
    }

    /**
     * Función principal que inicializa la aplicación
     */
    async function initializeChessApp() {
        try {
            // Esperar a que Chess.js esté disponible
            await checkChessAvailability();
            
            console.log('🚀 Iniciando Analizador de Ajedrez Fractal...');
            
            // Ahora sí podemos inicializar Chess.js
            const chess = new Chess();
            console.log('✅ Chess.js inicializado correctamente');
            
            // Continuar con la inicialización
            startChessApplication(chess);
            
        } catch (error) {
            console.error('💥 Error al inicializar:', error);
            showChessJsError();
        }
    }

    /**
     * Inicia la aplicación principal de ajedrez
     */
    function startChessApplication(chess) {

        /* ===================== CONSTANTES Y CONFIGURACIÓN ===================== */
        const PIECE_SYMBOLS = {
            'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
            'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟'
        };
        
        const BOARD_CONFIG = {
            squareSize: 65,
            get boardSize() { return this.squareSize * 8; }
        };

        const STOCKFISH_URL = 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js';

        /* ===================== VARIABLES DE ESTADO ===================== */
        let board = [];
        let chess = new Chess();
        let lastMove = null;
        let stockfish = null;
        let blobURL = null;
        let isEngineConnected = false;
        let isAnalyzing = false;
        let analysisInterval = null;
        let pvObserver = null;
        let fractalEngine = null;
        let fractalAnalysisActive = true;
        let fractalDimension = 1.247;
        let fractalIntensity = 0.6;
        let currentComplexity = 0;
        
        let lastStats = {
            nps: 0,
            pv: '',
            evaluation: null,
            depth: 0,
            bestMove: '',
            bestMoveSan: '',
            fractalComplexity: 0,
            optimalDepth: 0,
            fractalConfidence: 0,
            searchEfficiency: 0
        };

    /* ===================== CLASE MOTOR FRACTAL ===================== */
    class FractalChessEngine {
        constructor(dimension = 1.247) {
            this.D = dimension;
            this.cache = new Map();
            this.pieceValues = {
                'p': 100, 'n': 320, 'b': 330, 'r': 500, 'q': 900, 'k': 20000,
                'P': 100, 'N': 320, 'B': 330, 'R': 500, 'Q': 900, 'K': 20000
            };
            this.complexityThreshold = 12.0;
            this.maxCacheSize = 1000;
        }

        /**
         * Calcula la complejidad fractal de una posición FEN
         */
        calculateFractalComplexity(fen) {
            if (this.cache.has(fen)) {
                return this.cache.get(fen);
            }
            
            try {
                const pieces = this.countPieces(fen);
                const mobility = this.estimateMobility(fen);
                const centerControl = this.evaluateCenterControl(fen);
                const kingSafety = this.evaluateKingSafety(fen);

                const complexity = Math.pow(pieces, 1/this.D) *
                                  Math.pow(Math.max(mobility, 1), 1/this.D) *
                                  Math.pow(Math.max(Math.abs(centerControl) + 1, 1), 1/this.D) *
                                  Math.pow(Math.max(kingSafety + 1, 1), 1/this.D);

                const result = Math.max(1.0, Math.min(50.0, complexity));
                
                if (this.cache.size >= this.maxCacheSize) {
                    const firstKey = this.cache.keys().next().value;
                    this.cache.delete(firstKey);
                }
                this.cache.set(fen, result);
                
                return result;
            } catch (error) {
                console.warn('Error calculating fractal complexity:', error);
                return 10.0;
            }
        }

        /**
         * Cuenta el número total de piezas en el tablero
         */
        countPieces(fen) {
            const position = fen.split(' ')[0];
            return position.replace(/[0-8\/]/g, '').length;
        }

        /**
         * Estima la movilidad de la posición actual
         */
        estimateMobility(fen) {
            try {
                const tempChess = new Chess(fen);
                return tempChess.moves().length;
            } catch (e) {
                return 20;
            }
        }

        /**
         * Evalúa el control del centro del tablero
         */
        evaluateCenterControl(fen) {
            try {
                const tempChess = new Chess(fen);
                const centerSquares = ['d4', 'd5', 'e4', 'e5'];
                let control = 0;
                
                centerSquares.forEach(square => {
                    const piece = tempChess.get(square);
                    if (piece) {
                        control += piece.color === 'w' ? 10 : -10;
                    }
                });
                
                return control;
            } catch (e) {
                return 0;
            }
        }

        /**
         * Evalúa la seguridad del rey
         */
        evaluateKingSafety(fen) {
            try {
                const tempChess = new Chess(fen);
                let safety = 10;
                
                if (tempChess.in_check()) {
                    safety -= 50;
                }
                
                return safety;
            } catch (e) {
                return 10;
            }
        }

        /**
         * Calcula la profundidad óptima basada en la complejidad
         */
        calculateOptimalDepth(complexity) {
            const baseDepth = 12;
            const complexityFactor = Math.pow(complexity / 10, 1/this.D);
            const optimalDepth = Math.round(baseDepth + complexityFactor * 6);
            return Math.min(Math.max(optimalDepth, 8), 22);
        }

        /**
         * Actualiza la dimensión fractal y limpia el cache
         */
        updateDimension(newDimension) {
            this.D = Math.max(1.0, Math.min(2.0, newDimension));
            this.cache.clear();
        }

        /**
         * Limpia el cache de complejidad
         */
        clearCache() {
            this.cache.clear();
        }
    }

    /* ===================== FUNCIONES UTILITARIAS ===================== */
    
    /**
     * Parsea una posición FEN y actualiza el estado del tablero
     */
    function parseFEN(fen) {
        if (!fen || typeof fen !== 'string' || fen.length > 100) {
            throw new Error('FEN inválido: vacío, muy largo o no es string');
        }
        
        const validation = chess.validate_fen(fen);
        if (!validation.valid) {
            throw new Error(`FEN inválido: ${validation.error}`);
        }
        
        chess.load(fen);
        const position = fen.split(' ')[0];
        const rows = position.split('/');
        
        if (rows.length !== 8) {
            throw new Error('FEN inválido: número incorrecto de filas');
        }
        
        board = Array(8).fill().map(() => Array(8).fill(null));
        
        for (let row = 0; row < 8; row++) {
            let col = 0;
            const actualRow = 7 - row;
            
            for (let char of rows[row]) {
                if (/\d/.test(char)) {
                    col += parseInt(char);
                } else if (col < 8) {
                    board[actualRow][col] = char;
                    col++;
                } else {
                    throw new Error('FEN inválido: demasiadas piezas en fila');
                }
            }
            
            if (col !== 8) {
                throw new Error(`FEN inválido: fila ${8 - row} tiene número incorrecto de casillas`);
            }
        }
    }

    /**
     * Formatea la evaluación para mostrar
     */
    function formatEvaluation(score, isMate) {
        if (isMate) {
            return score > 0 ? `+M${Math.abs(score)}` : `-M${Math.abs(score)}`;
        }
        const pawns = score / 100;
        return pawns > 0 ? `+${pawns.toFixed(2)}` : pawns.toFixed(2);
    }

    /**
     * Genera el SVG del tablero de ajedrez
     */
    function generateChessboardSVG() {
        const { squareSize, boardSize } = BOARD_CONFIG;
        const svgParts = [
            `<svg width="${boardSize + 40}" height="${boardSize + 40}" xmlns="http://www.w3.org/2000/svg" role="grid" aria-label="Tablero de ajedrez">`
        ];
        
        // Dibujar casillas
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const x = col * squareSize + 20;
                const y = row * squareSize + 20;
                const fill = (row + col) % 2 === 0 ? '#F5F5DC' : '#C19A6B';
                const squareName = String.fromCharCode(97 + col) + (8 - row);
                
                svgParts.push(
                    `<rect x="${x}" y="${y}" width="${squareSize}" height="${squareSize}" ` +
                    `fill="${fill}" data-square="${squareName}" ` +
                    `role="gridcell" aria-label="Casilla ${squareName}" />`
                );
            }
        }
        
        // Resaltar último movimiento
        if (lastMove && chess.history({ verbose: true }).length > 0) {
            const history = chess.history({ verbose: true });
            const move = history[history.length - 1];
            
            const fromCol = move.from.charCodeAt(0) - 97;
            const fromRow = 8 - parseInt(move.from[1]);
            const toCol = move.to.charCodeAt(0) - 97;
            const toRow = 8 - parseInt(move.to[1]);
            
            const fromX = fromCol * squareSize + 20;
            const fromY = fromRow * squareSize + 20;
            const toX = toCol * squareSize + 20;
            const toY = toRow * squareSize + 20;
            
            svgParts.push(
                `<rect x="${fromX}" y="${fromY}" width="${squareSize}" height="${squareSize}" fill="rgba(255, 255, 0, 0.5)" />`,
                `<rect x="${toX}" y="${toY}" width="${squareSize}" height="${squareSize}" fill="rgba(255, 255, 0, 0.5)" />`
            );
        }
        
        // Dibujar flecha del mejor movimiento
        if (lastStats.bestMove && lastStats.bestMove.length >= 4) {
            const from = lastStats.bestMove.substring(0, 2);
            const to = lastStats.bestMove.substring(2, 4);
            
            const fromCol = from.charCodeAt(0) - 97;
            const fromRow = 8 - parseInt(from[1]);
            const toCol = to.charCodeAt(0) - 97;
            const toRow = 8 - parseInt(to[1]);
            
            const fromX = (fromCol * squareSize) + squareSize/2 + 20;
            const fromY = (fromRow * squareSize) + squareSize/2 + 20;
            const toX = (toCol * squareSize) + squareSize/2 + 20;
            const toY = (toRow * squareSize) + squareSize/2 + 20;
            
            const arrowColor = fractalAnalysisActive ? "#8b5cf6" : "#3B82F6";
            
            svgParts.push(
                `<defs>
                    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                        <polygon points="0 0, 10 3.5, 0 7" fill="${arrowColor}" />
                    </marker>
                </defs>
                <line x1="${fromX}" y1="${fromY}" x2="${toX}" y2="${toY}" ` +
                `stroke="${arrowColor}" stroke-width="4" opacity="0.8" marker-end="url(#arrowhead)" />`
            );
        }
        
        // Dibujar piezas
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = board[7 - row][col];
                if (piece) {
                    const x = col * squareSize + squareSize / 2 + 20;
                    const y = row * squareSize + squareSize / 2 + squareSize / 4 + 20;
                    const symbol = PIECE_SYMBOLS[piece] || '';
                    
                    svgParts.push(
                        `<text x="${x}" y="${y}" font-size="48" text-anchor="middle" ` +
                        `fill="#000" aria-label="Pieza ${piece}">${symbol}</text>`
                    );
                }
            }
        }
        
        // Dibujar coordenadas
        for (let i = 0; i < 8; i++) {
            svgParts.push(
                `<text x="10" y="${i * squareSize + squareSize / 1.5 + 20}" ` +
                `font-size="16" text-anchor="middle" fill="#666">${8 - i}</text>`,
                `<text x="${i * squareSize + squareSize / 2 + 20}" y="${boardSize + 35}" ` +
                `font-size="16" text-anchor="middle" fill="#666">${String.fromCharCode(97 + i)}</text>`
            );
        }
        
        svgParts.push('</svg>');
        return svgParts.join('');
    }

    /**
     * Muestra el estado actual del juego
     */
    function showGameStatus() {
        const statusElement = document.getElementById('gameStatus');
        if (!statusElement) return;
        
        let status = "";
        let iconClass = "fas fa-info-circle";
        let statusClass = "status-info";
        
        if (chess.in_checkmate()) {
            status = "¡Jaque mate!";
            iconClass = "fas fa-crown";
            statusClass = "status-danger";
        } else if (chess.in_stalemate()) {
            status = "Tablas por ahogado";
            iconClass = "fas fa-handshake";
            statusClass = "status-warning";
        } else if (chess.in_draw()) {
            if (chess.in_threefold_repetition()) {
                status = "Tablas por repetición";
            } else if (chess.insufficient_material()) {
                status = "Tablas por material insuficiente";
            } else {
                status = "Tablas por regla de 50 movimientos";
            }
            iconClass = "fas fa-handshake";
            statusClass = "status-warning";
        } else if (chess.in_check()) {
            status = "¡Jaque!";
            iconClass = "fas fa-exclamation-triangle";
            statusClass = "status-warning";
        } else {
            status = chess.turn() === 'w' ? "Turno: Blancas" : "Turno: Negras";
            iconClass = "fas fa-chess";
            statusClass = "status-success";
        }
        
        statusElement.className = `game-status-compact ${statusClass}`;
        statusElement.innerHTML = `<i class="${iconClass}"></i><span>${status}</span>`;
    }

    /* ===================== FUNCIONES DE ACTUALIZACIÓN DE UI ===================== */
    
    /**
     * Actualiza las estadísticas de memoria
     */
    function updateMemoryStats() {
        const memoryStats = document.getElementById('memoryStats');
        if (!memoryStats) return;

        if (window.performance && window.performance.memory) {
            const memory = window.performance.memory;
            const memoryMB = Math.round(memory.usedJSHeapSize / (1024 * 1024));
            memoryStats.textContent = `Memoria: ${memoryMB}MB`;
        } else {
            memoryStats.textContent = 'Memoria: N/A';
        }
    }

    /**
     * Actualiza la pantalla de métricas fractales
     */
    function updateFractalDisplay() {
        const complexityEl = document.getElementById('fractalComplexity');
        const depthEl = document.getElementById('optimalDepth');
        const confidenceEl = document.getElementById('fractalConfidence');
        const efficiencyEl = document.getElementById('searchEfficiency');
        
        if (!fractalAnalysisActive || !fractalEngine) {
            if (complexityEl) complexityEl.textContent = '--';
            if (depthEl) depthEl.textContent = '--';
            if (confidenceEl) confidenceEl.textContent = '--';
            if (efficiencyEl) efficiencyEl.textContent = '--';
            return;
        }
        
        try {
            const fen = chess.fen();
            const complexity = fractalEngine.calculateFractalComplexity(fen);
            const optimalDepth = fractalEngine.calculateOptimalDepth(complexity);
            currentComplexity = complexity;
            
            if (complexityEl) complexityEl.textContent = complexity.toFixed(2);
            if (depthEl) depthEl.textContent = optimalDepth.toString();
            
            const confidenceValue = Math.min(95, 60 + (complexity / 20 * 35));
            if (confidenceEl) confidenceEl.textContent = confidenceValue.toFixed(1) + '%';
            
            if (isAnalyzing && lastStats.nps > 0) {
                const efficiencyValue = Math.min(100, (lastStats.nps / 1000000) * 100);
                if (efficiencyEl) efficiencyEl.textContent = efficiencyValue.toFixed(1) + '%';
            }
        } catch (error) {
            console.warn('Error updating fractal display:', error);
        }
    }

    /**
     * Actualiza los estados de los botones
     */
    function updateButtonStates() {
        const engineBtn = document.getElementById('engineToggleBtn');
        const analysisBtn = document.getElementById('analysisToggleBtn');
        const showMovesBtn = document.getElementById('showMovesBtn');

        if (engineBtn) {
            if (isEngineConnected) {
                engineBtn.innerHTML = '<i class="fas fa-power-off"></i>Desconectar Motor';
                engineBtn.className = 'btn btn-warning';
            } else {
                engineBtn.innerHTML = '<i class="fas fa-plug"></i>Conectar Motor';
                engineBtn.className = 'btn btn-purple';
            }
        }

        if (analysisBtn) {
            if (isAnalyzing) {
                analysisBtn.innerHTML = '<i class="fas fa-stop"></i>Detener Análisis';
                analysisBtn.className = 'btn btn-danger';
                analysisBtn.disabled = false;
            } else {
                analysisBtn.innerHTML = '<i class="fas fa-play"></i>Analizar';
                analysisBtn.className = 'btn btn-success';
                analysisBtn.disabled = !isEngineConnected || chess.game_over();
            }
        }

        if (showMovesBtn) {
            showMovesBtn.disabled = chess.game_over();
        }
    }

    /* ===================== FUNCIONES UTILITARIAS ===================== */
    
    /**
     * Parsea una posición FEN y actualiza el estado del tablero
     */
    function parseFEN(fen) {
        if (!fen || typeof fen !== 'string' || fen.length > 100) {
            throw new Error('FEN inválido: vacío, muy largo o no es string');
        }
        
        const validation = chess.validate_fen(fen);
        if (!validation.valid) {
            throw new Error(`FEN inválido: ${validation.error}`);
        }
        
        chess.load(fen);
        const position = fen.split(' ')[0];
        const rows = position.split('/');
        
        if (rows.length !== 8) {
            throw new Error('FEN inválido: número incorrecto de filas');
        }
        
        board = Array(8).fill().map(() => Array(8).fill(null));
        
        for (let row = 0; row < 8; row++) {
            let col = 0;
            const actualRow = 7 - row;
            
            for (let char of rows[row]) {
                if (/\d/.test(char)) {
                    col += parseInt(char);
                } else if (col < 8) {
                    board[actualRow][col] = char;
                    col++;
                } else {
                    throw new Error('FEN inválido: demasiadas piezas en fila');
                }
            }
            
            if (col !== 8) {
                throw new Error(`FEN inválido: fila ${8 - row} tiene número incorrecto de casillas`);
            }
        }
    }

    /**
     * Convierte un movimiento UCI a notación algebraica estándar
     */
    function uciToSan(uciMove) {
        if (!uciMove || uciMove.length < 4) return uciMove;
        
        try {
            const from = uciMove.substring(0, 2);
            const to = uciMove.substring(2, 4);
            const promotion = uciMove.length > 4 ? uciMove[4] : undefined;
            
            const tempChess = new Chess(chess.fen()); // Usar FEN de la instancia global
            const move = tempChess.move({ from, to, promotion });
            return move ? move.san : uciMove;
        } catch (e) {
            return uciMove;
        }
    }

    /**
     * Formatea la evaluación para mostrar
     */
    function formatEvaluation(score, isMate) {
        if (isMate) {
            return score > 0 ? `+M${Math.abs(score)}` : `-M${Math.abs(score)}`;
        }
        const pawns = score / 100;
        return pawns > 0 ? `+${pawns.toFixed(2)}` : pawns.toFixed(2);
    }

    /**
     * Genera el SVG del tablero de ajedrez
     */
    function generateChessboardSVG() {
        const { squareSize, boardSize } = BOARD_CONFIG;
        const svgParts = [
            `<svg width="${boardSize + 40}" height="${boardSize + 40}" xmlns="http://www.w3.org/2000/svg" role="grid" aria-label="Tablero de ajedrez">`
        ];
        
        // Dibujar casillas
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const x = col * squareSize + 20;
                const y = row * squareSize + 20;
                const fill = (row + col) % 2 === 0 ? '#F5F5DC' : '#C19A6B';
                const squareName = String.fromCharCode(97 + col) + (8 - row);
                
                svgParts.push(
                    `<rect x="${x}" y="${y}" width="${squareSize}" height="${squareSize}" ` +
                    `fill="${fill}" data-square="${squareName}" ` +
                    `role="gridcell" aria-label="Casilla ${squareName}" />`
                );
            }
        }
        
        // Resaltar último movimiento
        if (lastMove && chess.history({ verbose: true }).length > 0) {
            const history = chess.history({ verbose: true });
            const move = history[history.length - 1];
            
            const fromCol = move.from.charCodeAt(0) - 97;
            const fromRow = 8 - parseInt(move.from[1]);
            const toCol = move.to.charCodeAt(0) - 97;
            const toRow = 8 - parseInt(move.to[1]);
            
            const fromX = fromCol * squareSize + 20;
            const fromY = fromRow * squareSize + 20;
            const toX = toCol * squareSize + 20;
            const toY = toRow * squareSize + 20;
            
            svgParts.push(
                `<rect x="${fromX}" y="${fromY}" width="${squareSize}" height="${squareSize}" fill="rgba(255, 255, 0, 0.5)" />`,
                `<rect x="${toX}" y="${toY}" width="${squareSize}" height="${squareSize}" fill="rgba(255, 255, 0, 0.5)" />`
            );
        }
        
        // Dibujar flecha del mejor movimiento
        if (lastStats.bestMove && lastStats.bestMove.length >= 4) {
            const from = lastStats.bestMove.substring(0, 2);
            const to = lastStats.bestMove.substring(2, 4);
            
            const fromCol = from.charCodeAt(0) - 97;
            const fromRow = 8 - parseInt(from[1]);
            const toCol = to.charCodeAt(0) - 97;
            const toRow = 8 - parseInt(to[1]);
            
            const fromX = (fromCol * squareSize) + squareSize/2 + 20;
            const fromY = (fromRow * squareSize) + squareSize/2 + 20;
            const toX = (toCol * squareSize) + squareSize/2 + 20;
            const toY = (toRow * squareSize) + squareSize/2 + 20;
            
            const arrowColor = fractalAnalysisActive ? "#8b5cf6" : "#3B82F6";
            
            svgParts.push(
                `<defs>
                    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                        <polygon points="0 0, 10 3.5, 0 7" fill="${arrowColor}" />
                    </marker>
                </defs>
                <line x1="${fromX}" y1="${fromY}" x2="${toX}" y2="${toY}" ` +
                `stroke="${arrowColor}" stroke-width="4" opacity="0.8" marker-end="url(#arrowhead)" />`
            );
        }
        
        // Dibujar piezas
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = board[7 - row][col];
                if (piece) {
                    const x = col * squareSize + squareSize / 2 + 20;
                    const y = row * squareSize + squareSize / 2 + squareSize / 4 + 20;
                    const symbol = PIECE_SYMBOLS[piece] || '';
                    
                    svgParts.push(
                        `<text x="${x}" y="${y}" font-size="48" text-anchor="middle" ` +
                        `fill="#000" aria-label="Pieza ${piece}">${symbol}</text>`
                    );
                }
            }
        }
        
        // Dibujar coordenadas
        for (let i = 0; i < 8; i++) {
            svgParts.push(
                `<text x="10" y="${i * squareSize + squareSize / 1.5 + 20}" ` +
                `font-size="16" text-anchor="middle" fill="#666">${8 - i}</text>`,
                `<text x="${i * squareSize + squareSize / 2 + 20}" y="${boardSize + 35}" ` +
                `font-size="16" text-anchor="middle" fill="#666">${String.fromCharCode(97 + i)}</text>`
            );
        }
        
        svgParts.push('</svg>');
        return svgParts.join('');
    }

    /**
     * Muestra el estado actual del juego
     */
    function showGameStatus() {
        const statusElement = document.getElementById('gameStatus');
        if (!statusElement) return;
        
        let status = "";
        let iconClass = "fas fa-info-circle";
        let statusClass = "status-info";
        
        if (chess.in_checkmate()) {
            status = "¡Jaque mate!";
            iconClass = "fas fa-crown";
            statusClass = "status-danger";
        } else if (chess.in_stalemate()) {
            status = "Tablas por ahogado";
            iconClass = "fas fa-handshake";
            statusClass = "status-warning";
        } else if (chess.in_draw()) {
            if (chess.in_threefold_repetition()) {
                status = "Tablas por repetición";
            } else if (chess.insufficient_material()) {
                status = "Tablas por material insuficiente";
            } else {
                status = "Tablas por regla de 50 movimientos";
            }
            iconClass = "fas fa-handshake";
            statusClass = "status-warning";
        } else if (chess.in_check()) {
            status = "¡Jaque!";
            iconClass = "fas fa-exclamation-triangle";
            statusClass = "status-warning";
        } else {
            status = chess.turn() === 'w' ? "Turno: Blancas" : "Turno: Negras";
            iconClass = "fas fa-chess";
            statusClass = "status-success";
        }
        
        statusElement.className = `game-status-compact ${statusClass}`;
        statusElement.innerHTML = `<i class="${iconClass}"></i><span>${status}</span>`;
    }

    /* ===================== FUNCIONES DE ACTUALIZACIÓN DE UI ===================== */
    
    /**
     * Actualiza las estadísticas de memoria
     */
    function updateMemoryStats() {
        const memoryStats = document.getElementById('memoryStats');
        if (!memoryStats) return;

        if (window.performance && window.performance.memory) {
            const memory = window.performance.memory;
            const memoryMB = Math.round(memory.usedJSHeapSize / (1024 * 1024));
            memoryStats.textContent = `Memoria: ${memoryMB}MB`;
        } else {
            memoryStats.textContent = 'Memoria: N/A';
        }
    }

    /**
     * Actualiza la pantalla de métricas fractales
     */
    function updateFractalDisplay() {
        const complexityEl = document.getElementById('fractalComplexity');
        const depthEl = document.getElementById('optimalDepth');
        const confidenceEl = document.getElementById('fractalConfidence');
        const efficiencyEl = document.getElementById('searchEfficiency');
        
        if (!fractalAnalysisActive || !fractalEngine) {
            if (complexityEl) complexityEl.textContent = '--';
            if (depthEl) depthEl.textContent = '--';
            if (confidenceEl) confidenceEl.textContent = '--';
            if (efficiencyEl) efficiencyEl.textContent = '--';
            return;
        }
        
        try {
            const fen = chess.fen();
            const complexity = fractalEngine.calculateFractalComplexity(fen);
            const optimalDepth = fractalEngine.calculateOptimalDepth(complexity);
            currentComplexity = complexity;
            
            if (complexityEl) complexityEl.textContent = complexity.toFixed(2);
            if (depthEl) depthEl.textContent = optimalDepth.toString();
            
            const confidenceValue = Math.min(95, 60 + (complexity / 20 * 35));
            if (confidenceEl) confidenceEl.textContent = confidenceValue.toFixed(1) + '%';
            
            if (isAnalyzing && lastStats.nps > 0) {
                const efficiencyValue = Math.min(100, (lastStats.nps / 1000000) * 100);
                if (efficiencyEl) efficiencyEl.textContent = efficiencyValue.toFixed(1) + '%';
            }
        } catch (error) {
            console.warn('Error updating fractal display:', error);
        }
    }

    /**
     * Actualiza los estados de los botones
     */
    function updateButtonStates() {
        const engineBtn = document.getElementById('engineToggleBtn');
        const analysisBtn = document.getElementById('analysisToggleBtn');
        const showMovesBtn = document.getElementById('showMovesBtn');

        if (engineBtn) {
            if (isEngineConnected) {
                engineBtn.innerHTML = '<i class="fas fa-power-off"></i>Desconectar Motor';
                engineBtn.className = 'btn btn-warning';
            } else {
                engineBtn.innerHTML = '<i class="fas fa-plug"></i>Conectar Motor';
                engineBtn.className = 'btn btn-purple';
            }
        }

        if (analysisBtn) {
            if (isAnalyzing) {
                analysisBtn.innerHTML = '<i class="fas fa-stop"></i>Detener Análisis';
                analysisBtn.className = 'btn btn-danger';
                analysisBtn.disabled = false;
            } else {
                analysisBtn.innerHTML = '<i class="fas fa-play"></i>Analizar';
                analysisBtn.className = 'btn btn-success';
                analysisBtn.disabled = !isEngineConnected || chess.game_over();
            }
        }

        if (showMovesBtn) {
            showMovesBtn.disabled = chess.game_over();
        }
    }

    /* ===================== GESTIÓN DEL MOTOR STOCKFISH ===================== */
    
    /**
     * Conecta al motor Stockfish
     */
    function connectEngine() {
        if (isEngineConnected) return;

        const engineStatus = document.getElementById('engineStatus');
        if (!engineStatus) return;
        
        engineStatus.textContent = 'Conectando motor...';

        fetch(STOCKFISH_URL)
            .then(response => {
                if (!response.ok) {
                    throw new Error('Error al descargar Stockfish');
                }
                return response.text();
            })
            .then(code => {
                blobURL = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
                stockfish = new Worker(blobURL);
                
                stockfish.onmessage = e => handleEngineMessage(e.data);
                stockfish.onerror = err => {
                    console.error('Error en Stockfish:', err);
                    engineStatus.textContent = 'Error en el motor';
                    disconnectEngine();
                };
                
                // Inicializar motor
                stockfish.postMessage('uci');
                stockfish.postMessage('setoption name MultiPV value 1');
                stockfish.postMessage('setoption name Hash value 128');
                stockfish.postMessage('isready');
                
                isEngineConnected = true;
                engineStatus.textContent = 'Motor conectado y listo';
                updateButtonStates();
                
                // Iniciar análisis automáticamente si hay una posición válida
                if (!chess.game_over()) {
                    setTimeout(startAnalysis, 500);
                }
            })
            .catch(err => {
                console.error('Error conectando motor:', err);
                engineStatus.textContent = `Error: ${err.message}`;
                isEngineConnected = false;
                updateButtonStates();
            });
    }

    /**
     * Desconecta el motor Stockfish
     */
    function disconnectEngine() {
        if (!isEngineConnected) return;
        
        if (isAnalyzing) {
            stopAnalysis();
        }
        
        if (stockfish) {
            stockfish.terminate();
            stockfish = null;
        }
        
        if (blobURL) {
            URL.revokeObjectURL(blobURL);
            blobURL = null;
        }
        
        isEngineConnected = false;
        const engineStatus = document.getElementById('engineStatus');
        if (engineStatus) engineStatus.textContent = 'Motor desconectado';
        
        // Limpiar displays
        resetAnalysisDisplay();
        updateButtonStates();
    }

    /**
     * Inicia el análisis de la posición actual
     */
    function startAnalysis() {
        if (!isEngineConnected || isAnalyzing || chess.game_over()) return;

        const engineStatus = document.getElementById('engineStatus');
        if (!engineStatus) return;
        
        const fen = chess.fen();
        let searchCommand = 'go infinite';
        
        // Configurar análisis fractal si está activo
        if (fractalAnalysisActive && fractalEngine) {
            try {
                const complexity = fractalEngine.calculateFractalComplexity(fen);
                const depth = fractalEngine.calculateOptimalDepth(complexity);
                searchCommand = `go depth ${depth}`;
                engineStatus.textContent = `Analizando con profundidad fractal (D=${depth})...`;
            } catch (error) {
                console.warn('Error en análisis fractal:', error);
                engineStatus.textContent = 'Analizando...';
            }
        } else {
            engineStatus.textContent = 'Analizando...';
        }

        // Enviar comandos al motor
        stockfish.postMessage(`position fen ${fen}`);
        stockfish.postMessage(searchCommand);
        
        isAnalyzing = true;
        updateButtonStates();
        
        const pvLine = document.getElementById('pvLine');
        if (pvLine) pvLine.textContent = 'Analizando...';
        
        // Intervalo para actualizar estadísticas
        analysisInterval = setInterval(() => {
            updateMemoryStats();
            updateFractalDisplay();
        }, 1000);
    }

    /**
     * Detiene el análisis actual
     */
    function stopAnalysis() {
        if (!isAnalyzing) return;
        
        if (stockfish) {
            stockfish.postMessage('stop');
        }
        
        if (analysisInterval) {
            clearInterval(analysisInterval);
            analysisInterval = null;
        }
        
        isAnalyzing = false;
        const engineStatus = document.getElementById('engineStatus');
        if (engineStatus) {
            const statusText = fractalAnalysisActive ? 
                'Motor conectado - Análisis fractal detenido' : 
                'Motor conectado - Análisis detenido';
            engineStatus.textContent = statusText;
        }
        updateButtonStates();
    }

    /* ===================== PROCESAMIENTO DE MENSAJES UCI ===================== */
    
    /**
     * Maneja los mensajes del motor Stockfish
     */
    function handleEngineMessage(line) {
        if (typeof line !== 'string') return;

        if (line.startsWith('bestmove')) {
            processBestMove(line);
        } else if (line.startsWith('info')) {
            parseInfoLine(line);
        }
    }

    /**
     * Procesa el mensaje de mejor movimiento
     */
    function processBestMove(line) {
        const parts = line.split(' ');
        const bestMove = parts[1];
        
        if (bestMove && bestMove !== '(none)') {
            lastStats.bestMove = bestMove;
            lastStats.bestMoveSan = uciToSan(bestMove);
            
            const moveText = fractalAnalysisActive ? 
                `🌀 Mejor: ${lastStats.bestMoveSan}` : 
                `Mejor: ${lastStats.bestMoveSan}`;
            
            const bestMoveEl = document.getElementById('bestMove');
            if (bestMoveEl) bestMoveEl.textContent = moveText;
            
            // Redibujar tablero con flecha
            const chessboard = document.getElementById('chessboard');
            if (chessboard) chessboard.innerHTML = generateChessboardSVG();
        }
    }

    /**
     * Parsea la línea de información del motor
     */
    function parseInfoLine(line) {
        const parts = line.split(' ');
        
        // Obtener nodos y tiempo para calcular NPS
        const nodesIndex = parts.indexOf('nodes');
        const timeIndex = parts.indexOf('time');
        if (nodesIndex !== -1 && timeIndex !== -1) {
            const nodes = parseInt(parts[nodesIndex + 1]);
            const time = parseInt(parts[timeIndex + 1]) / 1000;
            if (time > 0) {
                lastStats.nps = Math.round(nodes / time);
            }
        }
        
        // Obtener profundidad
        const depthIndex = parts.indexOf('depth');
        if (depthIndex !== -1) {
            lastStats.depth = parseInt(parts[depthIndex + 1]);
        }

        // Obtener evaluación
        const scoreIndex = parts.indexOf('score');
        if (scoreIndex !== -1) {
            parseScore(parts, scoreIndex);
        }

        // Obtener variante principal
        const pvIndex = parts.indexOf('pv');
        if (pvIndex !== -1 && parts.length > pvIndex + 1) {
            const pvMoves = parts.slice(pvIndex + 1, pvIndex + 10);
            lastStats.pv = convertPVToSAN(pvMoves);
        }

        updateEvaluationDisplay();
    }

    /**
     * Parsea la puntuación del motor
     */
    function parseScore(parts, scoreIndex) {
        const type = parts[scoreIndex + 1];
        const value = parseInt(parts[scoreIndex + 2]);
        
        if (type === 'cp') {
            let adjustedEval = chess.turn() === 'w' ? value : -value;
            
            // Aplicar ajuste fractal
            if (fractalAnalysisActive && currentComplexity > 0) {
                const fractalAdjustment = Math.min(0.1, 
                    Math.max(0, Math.pow(currentComplexity / 10, 1/fractalDimension) * 0.05)
                );
                adjustedEval *= (1 + fractalAdjustment);
            }
            
            lastStats.evaluation = { value: adjustedEval, type: 'cp' };
        } else if (type === 'mate') {
            const adjustedMate = chess.turn() === 'w' ? value : -value;
            lastStats.evaluation = { value: adjustedMate, type: 'mate' };
        }
    }

    /**
     * Convierte la variante principal UCI a notación SAN
     */
    function convertPVToSAN(pvMoves) {
        try {
            const tempChess = new Chess(chess.fen()); // Usar FEN de la instancia global
            const sanMoves = [];
            
            for (const uciMove of pvMoves) {
                if (uciMove.length >= 4) {
                    const from = uciMove.substring(0, 2);
                    const to = uciMove.substring(2, 4);
                    const promotion = uciMove.length > 4 ? uciMove[4] : undefined;
                    
                    const move = tempChess.move({ from, to, promotion });
                    if (move) {
                        sanMoves.push(move.san);
                    } else {
                        break;
                    }
                }
            }
            
            if (sanMoves.length > 0) {
                let pvText = '';
                let fullMoveNumber = parseInt(chess.fen().split(' ')[5]);
                let isWhiteTurn = chess.turn() === 'w';
                
                for (let i = 0; i < sanMoves.length; i++) {
                    if (i === 0 && !isWhiteTurn) {
                        pvText += `${fullMoveNumber}... ${sanMoves[i]} `;
                    } else if (i === 0 && isWhiteTurn) {
                        pvText += `${fullMoveNumber}. ${sanMoves[i]} `;
                    } else if ((i + (isWhiteTurn ? 1 : 0)) % 2 === 0) {
                        if (!isWhiteTurn || i > 0) {
                            fullMoveNumber++;
                        }
                        pvText += `${fullMoveNumber}. ${sanMoves[i]} `;
                    } else {
                        pvText += `${sanMoves[i]} `;
                    }
                }
                
                return fractalAnalysisActive ? `🌀 ${pvText.trim()}` : pvText.trim();
            }
        } catch (error) {
            console.warn('Error convirtiendo PV a SAN:', error);
        }
        
        return pvMoves.join(' ');
    }

    /**
     * Actualiza la pantalla de evaluación
     */
    function updateEvaluationDisplay() {
        const evalEl = document.getElementById('evaluation');
        const engineStatsEl = document.getElementById('engineStats');
        const pvLineEl = document.getElementById('pvLine');

        // Actualizar evaluación
        if (lastStats.evaluation !== null && evalEl) {
            const evalData = lastStats.evaluation;
            const isMate = evalData.type === 'mate';
            const score = evalData.value;
            
            evalEl.textContent = formatEvaluation(score, isMate);
            evalEl.className = 'evaluation';
            
            if (isMate) {
                evalEl.classList.add(score > 0 ? 'eval-positive' : 'eval-negative');
            } else {
                if (score > 50) {
                    evalEl.classList.add('eval-positive');
                } else if (score < -50) {
                    evalEl.classList.add('eval-negative');
                } else {
                    evalEl.classList.add('eval-neutral');
                }
            }
        }

        // Actualizar variante principal
        if (lastStats.pv && pvLineEl) {
            pvLineEl.textContent = lastStats.pv;
        }

        // Actualizar estadísticas del motor
        if (engineStatsEl) {
            const depthText = fractalAnalysisActive && fractalEngine ?
                `Profundidad: ${lastStats.depth}/${fractalEngine.calculateOptimalDepth(currentComplexity)}` :
                `Profundidad: ${lastStats.depth}`;
            
            const npsText = lastStats.nps > 0 ? ` | ${lastStats.nps.toLocaleString()} nodos/s` : '';
            engineStatsEl.textContent = depthText + npsText;
        }
    }

    /**
     * Resetea los displays de análisis
     */
    function resetAnalysisDisplay() {
        const evaluation = document.getElementById('evaluation');
        const bestMove = document.getElementById('bestMove');
        const engineStats = document.getElementById('engineStats');
        const pvLine = document.getElementById('pvLine');
        
        if (evaluation) evaluation.textContent = '--';
        if (bestMove) bestMove.textContent = '--';
        if (engineStats) engineStats.textContent = '--';
        if (pvLine) pvLine.textContent = 'Motor desconectado';
    }

    /* ===================== GESTIÓN DE MOVIMIENTOS ===================== */
    
    /**
     * Muestra los movimientos legales de la posición actual
     */
    function showLegalMoves() {
        if (chess.game_over()) return;
        
        const listEl = document.getElementById('legalMovesList');
        const panel = document.getElementById('legalMoves');
        const headerEl = document.getElementById('legalMovesHeader');
        
        if (!listEl || !panel || !headerEl) return;
        
        const moves = chess.moves({ verbose: true });
        
        headerEl.innerHTML = `<i class="fas fa-chess-knight"></i> Movimientos Legales (${moves.length})`;
        
        if (moves.length === 0) {
            listEl.innerHTML = '<div style="text-align: center; padding: 20px; color: #9ca3af;">No hay movimientos legales</div>';
        } else {
            listEl.innerHTML = moves.map(move => {
                return `<div class="move-item" onclick="window.chessApp.makeMove('${move.san}')">
                    <span class="move-notation">${move.san}</span>
                    <span class="move-coords">${move.from}-${move.to}</span>
                </div>`;
            }).join('');
        }
        
        panel.style.display = 'block';
    }

    /**
     * Oculta el panel de movimientos legales
     */
    function hideLegalMoves() {
        const panel = document.getElementById('legalMoves');
        if (panel) panel.style.display = 'none';
    }

    /**
     * Ejecuta un movimiento en el tablero
     */
    function makeMove(moveStr) {
        try {
            const moveResult = chess.move(moveStr);
            if (!moveResult) {
                console.warn('Movimiento inválido:', moveStr);
                return;
            }
            
            lastMove = moveResult;
            
            // Actualizar FEN input
            const fenInput = document.getElementById('fenInput');
            if (fenInput) fenInput.value = chess.fen();
            
            // Redibujar tablero y actualizar estado
            drawBoard();
            showLegalMoves();
            
            // Reiniciar análisis si está conectado
            if (isAnalyzing) {
                stopAnalysis();
            }
            
            // Reiniciar estadísticas
            resetStats();
            resetAnalysisDisplay();
            
            // Reanudar análisis automáticamente
            if (isEngineConnected && !chess.game_over()) {
                setTimeout(startAnalysis, 500);
            }
            
        } catch (error) {
            console.error('Error al hacer movimiento:', error);
        }
    }

    /**
     * Reinicia las estadísticas de análisis
     */
    function resetStats() {
        lastStats = {
            nps: 0,
            pv: '',
            evaluation: null,
            depth: 0,
            bestMove: '',
            bestMoveSan: '',
            fractalComplexity: 0,
            optimalDepth: 0,
            fractalConfidence: 0,
            searchEfficiency: 0
        };
    }

    /* ===================== FUNCIONES PRINCIPALES DEL TABLERO ===================== */
    
    /**
     * Dibuja el tablero con la posición actual
     */
    function drawBoard() {
        const fenInput = document.getElementById('fenInput');
        if (!fenInput) return;
        
        const fen = fenInput.value.trim();
        if (!fen || fen.length > 100) {
            alert('Por favor, ingresa una posición FEN válida.');
            return;
        }
        
        try {
            parseFEN(fen);
            
            const chessboard = document.getElementById('chessboard');
            if (chessboard) chessboard.innerHTML = generateChessboardSVG();
            
            const legalMoves = document.getElementById('legalMoves');
            if (legalMoves) legalMoves.style.display = 'none';
            
            showGameStatus();
            updateButtonStates();
            updateMemoryStats();
            updateFractalDisplay();
            
            // Reiniciar análisis si ya estaba corriendo
            if (isAnalyzing) {
                stopAnalysis();
            }
            
            resetStats();
            resetAnalysisDisplay();
            
        } catch (error) {
            alert(error.message);
        }
    }

    /* ===================== CONTROLES FRACTALES ===================== */
    
    /**
     * Configura los controles de la sección fractal
     */
    function setupFractalControls() {
        fractalEngine = new FractalChessEngine(fractalDimension);

        const dimSlider = document.getElementById('dimensionSlider');
        const intSlider = document.getElementById('intensitySlider');
        const dimVal = document.getElementById('dimensionValue');
        const intVal = document.getElementById('intensityValue');
        const enableChk = document.getElementById('enableFractal');

        // Control de dimensión fractal
        if (dimSlider && dimVal) {
            dimSlider.addEventListener('input', e => {
                fractalDimension = parseFloat(e.target.value);
                dimVal.textContent = fractalDimension.toFixed(3);
                if (fractalEngine) fractalEngine.updateDimension(fractalDimension);
                updateFractalDisplay();
            });
        }

        // Control de intensidad fractal
        if (intSlider && intVal) {
            intSlider.addEventListener('input', e => {
                fractalIntensity = parseInt(e.target.value, 10) / 100;
                intVal.textContent = `${e.target.value}%`;
                updateFractalDisplay();
            });
        }

        // Toggle de análisis fractal
        if (enableChk) {
            enableChk.addEventListener('change', e => {
                fractalAnalysisActive = e.target.checked;
                const fractalSection = document.querySelector('.fractal-section');
                if (fractalSection) {
                    if (fractalAnalysisActive) {
                        fractalSection.classList.add('fractal-active');
                    } else {
                        fractalSection.classList.remove('fractal-active');
                    }
                }
                updateFractalDisplay();
                
                // Si está analizando, reiniciar con nueva configuración
                if (isAnalyzing) {
                    stopAnalysis();
                    setTimeout(startAnalysis, 300);
                }
            });
        }
    }

    /* ===================== FUNCIONES DE TOGGLE ===================== */
    
    /**
     * Toggle del motor de ajedrez
     */
    function toggleEngine() {
        if (isEngineConnected) {
            disconnectEngine();
        } else {
            connectEngine();
        }
    }

    /**
     * Toggle del análisis
     */
    function toggleAnalysis() {
        if (isAnalyzing) {
            stopAnalysis();
        } else {
            startAnalysis();
        }
    }

    /* ===================== LIMPIEZA Y MANTENIMIENTO ===================== */
    
    /**
     * Limpia todos los recursos utilizados
     */
    function cleanup() {
        if (stockfish) {
            stockfish.terminate();
            stockfish = null;
        }
        
        if (blobURL) {
            URL.revokeObjectURL(blobURL);
            blobURL = null;
        }
        
        if (analysisInterval) {
            clearInterval(analysisInterval);
            analysisInterval = null;
        }
        
        if (pvObserver) {
            pvObserver.disconnect();
            pvObserver = null;
        }

        if (fractalEngine) {
            fractalEngine.clearCache();
        }
    }

    /**
     * Gestiona las animaciones de la sección fractal
     */
    function manageFractalAnimations() {
        setInterval(() => {
            const fractalSection = document.querySelector('.fractal-section');
            if (fractalSection) {
                if (fractalAnalysisActive && isAnalyzing) {
                    fractalSection.classList.add('fractal-active');
                } else if (!fractalAnalysisActive) {
                    fractalSection.classList.remove('fractal-active');
                }
            }
        }, 100);
    }

    /* ===================== INICIALIZACIÓN ===================== */
    
    /**
     * Inicializa la aplicación
     */
    function initializeApp() {
        try {
            console.log('Inicializando Analizador de Ajedrez Fractal...');
            
            setupFractalControls();
            drawBoard();
            updateButtonStates();
            updateMemoryStats();
            updateFractalDisplay();
            manageFractalAnimations();
            
        /**
         * Inicializa todos los componentes de la aplicación
         */
        function initializeApp() {
            try {
                console.log('🔧 Configurando componentes...');
                
                setupFractalControls();
                drawBoard();
                updateButtonStates();
                updateMemoryStats();
                updateFractalDisplay();
                manageFractalAnimations();
                
                console.log('✅ Aplicación inicializada correctamente');
                console.log('📐 Dimensión fractal por defecto: D =', fractalDimension);
                console.log('⚡ Intensidad fractal por defecto:', (fractalIntensity * 100) + '%');
                
            } catch (error) {
                console.error('💥 Error en inicialización:', error);
                const chessboard = document.getElementById('chessboard');
                if (chessboard) {
                    chessboard.innerHTML = `
                        <div class="loading">
                            <i class="fas fa-exclamation-triangle" style="color: #ef4444;"></i>
                            <p>Error al inicializar la aplicación</p>
                            <p style="font-size: 0.8rem; color: #6b7280;">${error.message}</p>
                        </div>
                    `;
                }
            }
        }

        // Inicializar la aplicación
        initializeApp();
        
    } // Fin de startChessApplication

    /* ===================== API PÚBLICA ===================== */
    
    // Exponer funciones públicas - declarar después de que las funciones estén definidas
    function exposePublicAPI() {
        window.chessApp = {
            // Funciones principales
            drawBoard,
            showLegalMoves,
            hideLegalMoves,
            makeMove,
            
            // Controles del motor
            toggleEngine,
            toggleAnalysis,
            
            // Funciones de utilidad (para debugging)
            getStats: () => ({ ...lastStats }),
            getComplexity: () => currentComplexity,
            getFractalEngine: () => fractalEngine,
            getChessInstance: () => chess, // Para debugging
            
            // Estado de la aplicación
            isEngineConnected: () => isEngineConnected,
            isAnalyzing: () => isAnalyzing,
            isFractalActive: () => fractalAnalysisActive
        };
    }

    /* ===================== EVENT LISTENERS GLOBALES ===================== */
    
    // Cleanup al cerrar ventana
    window.addEventListener('beforeunload', () => {
        if (stockfish) {
            stockfish.terminate();
            stockfish = null;
        }
        
        if (blobURL) {
            URL.revokeObjectURL(blobURL);
            blobURL = null;
        }
        
        if (analysisInterval) {
            clearInterval(analysisInterval);
            analysisInterval = null;
        }
        
        if (pvObserver) {
            pvObserver.disconnect();
            pvObserver = null;
        }

        if (fractalEngine) {
            fractalEngine.clearCache();
        }
    });
    
    // Manejo de errores globales
    window.addEventListener('error', (event) => {
        console.error('💥 Error global capturado:', event.error);
    });

    // Detectar cambios de visibilidad para pausar análisis
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && isAnalyzing) {
            console.log('👁️ Pestaña oculta, pausando análisis...');
            // Opcional: pausar análisis cuando la pestaña no es visible
        }
    });

    /* ===================== PUNTO DE ENTRADA ===================== */
    
    // Inicializar cuando el DOM esté listo
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeChessApp);
    } else {
        // DOM ya está listo
        initializeChessApp();
    }

    // Log inicial
    console.log('🎮 Analizador de Ajedrez Fractal v1.1 - Iniciando...');

})(); // Fin del closure principal

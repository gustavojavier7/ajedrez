/**
 * Motor de Ajedrez basado en Stockfish con modo de análisis adaptativo
 */

(function () {
    'use strict';

    /* ===================== VARIABLES GLOBALES PRINCIPALES ===================== */
    let chess;
    let board = [];
    let lastMove = null;
    let stockfish = null;
    let blobURL = null;
    let isEngineConnected = false;
    let isAnalyzing = false;
    let analysisInterval = null;
    let pvObserver = null;
    let previousHighlightedSquares = [];
    let adaptiveEngine = null;

    // Variables de adaptación dinámica
    let evaluationHistory = [];
    let predictedDepth = 1;
    let predictedTimeMs = 2000;
    let averageNPS = 0;
    let timerInterval = null;
    let analysisStartTimestamp = 0;

    // Variables adicionales para modo adaptativo
    let cpuAnalysisMode = 'adaptive'; // 'adaptive', 'full', 'balanced'
    let multiPVLines = [];
    let targetEvaluation = 0;
    let adaptiveAnalysisDepth = 15;
    let adaptiveEnabled = true;

    let lastStats = {
        nps: 0,
        pv: '',
        evaluation: null,
        depth: 0,
        bestMove: '',
        bestMoveSan: '',
        memoryUsage: 0
    };

    let gameMode = 'edit';
    let playerColor = 'white';
    let selectedSquare = null;
    let possibleMoves = [];

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

    /* ===================== VERIFICACIÓN Y CARGA DE CHESS.JS ===================== */
    
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

    class AdaptiveChessEngine {
        constructor() {
            this.evaluationThreshold = 50;
            this.multiPVCount = 5;
        }

        determineAnalysisMode(currentEval) {
            const absEval = Math.abs(currentEval);

            if (currentEval > this.evaluationThreshold) {
                return {
                    mode: 'seek_balance',
                    targetRange: [-this.evaluationThreshold, this.evaluationThreshold],
                    depth: adaptiveAnalysisDepth + 3,
                    multiPV: this.multiPVCount
                };
            } else if (currentEval < -this.evaluationThreshold) {
                return {
                    mode: 'seek_improvement',
                    targetRange: [-this.evaluationThreshold, this.evaluationThreshold],
                    depth: adaptiveAnalysisDepth + 5,
                    multiPV: this.multiPVCount + 2
                };
            }
            return {
                mode: 'maintain_balance',
                targetRange: [-this.evaluationThreshold, this.evaluationThreshold],
                depth: adaptiveAnalysisDepth,
                multiPV: 3
            };
        }

        selectAdaptiveMove(pvLines, analysisConfig) {
            if (!pvLines || pvLines.length === 0) return null;

            const validLines = pvLines.filter(line =>
                line && line.moves && line.moves.length > 0 &&
                line.evaluation !== undefined
            );

            if (validLines.length === 0) return null;

            const sortedLines = validLines.map(line => {
                const evalScore = line.evaluation;
                let distance;

                if (evalScore < analysisConfig.targetRange[0]) {
                    distance = analysisConfig.targetRange[0] - evalScore;
                } else if (evalScore > analysisConfig.targetRange[1]) {
                    distance = evalScore - analysisConfig.targetRange[1];
                } else {
                    distance = 0;
                }

                return {
                    ...line,
                    targetDistance: distance,
                    inTargetRange: distance === 0
                };
            }).sort((a, b) => {
                if (a.inTargetRange && !b.inTargetRange) return -1;
                if (!a.inTargetRange && b.inTargetRange) return 1;
                return a.targetDistance - b.targetDistance;
            });

            console.log('🎯 Análisis Adaptativo:', {
                mode: analysisConfig.mode,
                targetRange: analysisConfig.targetRange,
                currentEval: validLines[0].evaluation,
                movesAnalyzed: sortedLines.length,
                selectedMove: sortedLines[0].moves[0],
                selectedEval: sortedLines[0].evaluation
            });

            return sortedLines[0];
        }

    }

    /* ===================== FUNCIONES UTILITARIAS ===================== */
    
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

    function uciToSan(uciMove) {
        if (!uciMove || uciMove.length < 4) return uciMove;
        
        try {
            const from = uciMove.substring(0, 2);
            const to = uciMove.substring(2, 4);
            const promotion = uciMove.length > 4 ? uciMove[4] : undefined;
            
            const tempChess = new Chess(chess.fen());
            const move = tempChess.move({ from, to, promotion });
            return move ? move.san : uciMove;
        } catch (e) {
            return uciMove;
        }
    }

    function convertPVToSAN(pvMoves) {
        try {
            const tempChess = new Chess(chess.fen());
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
                
                return pvText.trim();
            }
        } catch (error) {
            console.warn('Error convirtiendo PV a SAN:', error);
        }
        
        return pvMoves.join(' ');
    }

    function formatEvaluation(score, isMate) {
        if (isMate) {
            return score > 0 ? `+M${Math.abs(score)}` : `-M${Math.abs(score)}`;
        }
        const pawns = score / 100;
        return pawns > 0 ? `+${pawns.toFixed(2)}` : pawns.toFixed(2);
    }

    function highlightBestLine() {
        resetHighlights();

        const bestLineEl = document.getElementById('pvLine');
        if (!bestLineEl) return;

        const bestLine = bestLineEl.textContent.trim();
        if (bestLine === 'Inicia el análisis para ver la mejor línea' ||
            bestLine === 'Analizando...' || !bestLine || bestLine.length < 3) {
            return;
        }

        try {
            const moves = bestLine.split(/\s+/).filter(m =>
                /^[a-h1-8KQRBNOX+#=\-]+$/.test(m) && !/^\d+\.+$/.test(m)
            );
            if (moves.length === 0) return;

            const tempChess = new Chess(chess.fen());
            const squares = [];
            const movesToProcess = moves.slice(0, 4);

            movesToProcess.forEach(move => {
                try {
                    const mv = tempChess.move(move, { sloppy: true });
                    if (mv) {
                        squares.push(mv.from);
                        squares.push(mv.to);
                    }
                } catch (e) {
                    console.warn(`Movimiento inválido en línea principal: ${move}`);
                }
            });

            squares.forEach(square => {
                const elements = document.querySelectorAll(`[data-square="${square}"]`);
                elements.forEach(el => {
                    if (el && el.tagName === 'rect') {
                        const file = square.charCodeAt(0) - 97;
                        const rank = parseInt(square[1]) - 1;
                        const isDark = (file + rank) % 2 === 1;
                        el.classList.add('square-highlight');
                        if (isDark) el.classList.add('dark');
                        previousHighlightedSquares.push(el);
                    }
                });
            });
        } catch (err) {
            console.warn('Error al destacar la mejor línea:', err);
        }
    }

    function resetHighlights() {
        previousHighlightedSquares.forEach(el => {
            el.classList.remove('square-highlight', 'dark');
        });
        previousHighlightedSquares = [];
    }

    function setupPVObserver() {
        if (pvObserver) {
            pvObserver.disconnect();
        }
        const pvEl = document.getElementById('pvLine');
        if (pvEl) {
            pvObserver = new MutationObserver(() => {
                setTimeout(highlightBestLine, 100);
            });
            pvObserver.observe(pvEl, { childList: true, characterData: true, subtree: true });
        }
    }

    function generateChessboardSVG() {
        const { squareSize, boardSize } = BOARD_CONFIG;
        const svgParts = [
            `<svg viewBox="0 0 ${boardSize + 40} ${boardSize + 40}" width="100%" height="auto" xmlns="http://www.w3.org/2000/svg" role="grid" aria-label="Tablero de ajedrez">`
        ];
        
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const x = col * squareSize + 20;
                const y = row * squareSize + 20;
                const fill = (row + col) % 2 === 0 ? '#F5F5DC' : '#C19A6B';
                const squareName = String.fromCharCode(97 + col) + (8 - row);
                
                svgParts.push(
                    `<rect x="${x}" y="${y}" width="${squareSize}" height="${squareSize}" ` +
                    `fill="${fill}" class="square" data-square="${squareName}" ` +
                    `onclick="window.chessApp.handleSquare('${squareName}')" ` +
                    `role="gridcell" aria-label="Casilla ${squareName}" />`
                );
            }
        }
        
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
            
            const arrowColor = "#3B82F6";
            
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
        
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = board[7 - row][col];
                if (piece) {
                    const x = col * squareSize + squareSize / 2 + 20;
                    const y = row * squareSize + squareSize / 2 + squareSize / 4 + 20;
                    const symbol = PIECE_SYMBOLS[piece] || '';
                    
                    svgParts.push(
                        `<text x="${x}" y="${y}" font-size="48" text-anchor="middle" ` +
                        `class="piece" fill="#000" data-square="${String.fromCharCode(97 + col) + (8 - row)}" ` +
                        `onclick="window.chessApp.handleSquare('${String.fromCharCode(97 + col) + (8 - row)}')" ` +
                        `aria-label="Pieza ${piece}">${symbol}</text>`
                    );
                }
            }
        }
        
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

    function updateMemoryStats() {
        const memoryStats = document.getElementById('memoryStats');
        const memoryEl = document.getElementById('engineMemory');

        if (window.performance && window.performance.memory) {
            const memory = window.performance.memory;
            const memoryMB = Math.round(memory.usedJSHeapSize / (1024 * 1024));
            if (memoryStats) memoryStats.textContent = `Memoria: ${memoryMB}MB`;
            if (memoryEl) memoryEl.textContent = `${memoryMB}MB`;
            lastStats.memoryUsage = memoryMB;
        } else {
            if (memoryStats) memoryStats.textContent = 'Memoria: N/A';
            if (memoryEl) memoryEl.textContent = 'N/A';
            lastStats.memoryUsage = 0;
        }
    }


    function updateButtonStates() {
        const engineBtn = document.getElementById('engineToggleBtn');
        const analysisBtn = document.getElementById('analysisToggleBtn');
        const forceMoveBtn = document.getElementById('forceMoveBtn');
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
                analysisBtn.disabled = !isEngineConnected || chess.game_over() || gameMode === 'cpu';
            }
        }

        if (forceMoveBtn) {
            const cpuTurn = gameMode === 'cpu' && chess.turn() !== (playerColor === 'white' ? 'w' : 'b');
            forceMoveBtn.style.display = gameMode === 'cpu' ? 'inline-flex' : 'none';
            forceMoveBtn.disabled = !cpuTurn || !isEngineConnected || !lastStats.bestMoveSan;
        }

        if (showMovesBtn) {
            showMovesBtn.disabled = chess.game_over();
        }
    }

    function computeAdaptiveParameters() {
        let baseDepth = 12;


        if (evaluationHistory.length >= 2) {
            const lastEval = evaluationHistory[evaluationHistory.length - 1].value;
            const prevEval = evaluationHistory[evaluationHistory.length - 2].value;
            if (lastEval < prevEval) {
                predictedDepth = Math.min(baseDepth + 2, 40);
            } else {
                predictedDepth = Math.max(baseDepth - 1, 6);
            }
        } else {
            predictedDepth = baseDepth;
        }

        if (averageNPS > 0) {
            predictedTimeMs = Math.max(1000, Math.round((predictedDepth * 1000000) / averageNPS));
        } else {
            predictedTimeMs = predictedDepth * 1000;
        }

        const depthEl = document.getElementById('depthValue');
        if (depthEl) {
            depthEl.textContent = predictedDepth.toString();
            depthEl.className = 'indicator-value' + (predictedDepth > 30 ? ' high-depth-warning' : '');
        }

        const timeEl = document.getElementById('timeValue');
        if (timeEl) timeEl.textContent = (predictedTimeMs / 1000).toFixed(1) + 's';
    }

    function updateAnalysisTimer() {
        const timerEl = document.getElementById('analysisTimer');
        if (!timerEl) return;
        const elapsed = Date.now() - analysisStartTimestamp;
        timerEl.textContent = (elapsed / 1000).toFixed(1) + 's / ' + (predictedTimeMs / 1000).toFixed(1) + 's';
        if (elapsed >= predictedTimeMs) {
            forceBestMove();
        }
    }

    function forceBestMove() {
        if (!isAnalyzing) return;
        stopAnalysis();
        if (lastStats.bestMoveSan) {
            makeMove(lastStats.bestMoveSan);
        } else {
            makeCpuMove();
        }
    }

    function startEngineTurnIfNeeded() {
        const cpuTurn = gameMode === 'cpu' && chess.turn() !== (playerColor === 'white' ? 'w' : 'b');
        if (!cpuTurn || chess.game_over()) return;

        if (isEngineConnected) {
            if (adaptiveEnabled) {
                startAdaptiveAnalysis();
            } else {
                startAnalysis();
            }
        } else {
            console.log('🔌 Conectando motor...');
            connectEngine();
        }
    }

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
                
                stockfish.postMessage('uci');
                stockfish.postMessage('setoption name MultiPV value 1');
                stockfish.postMessage('setoption name Hash value 128');
                stockfish.postMessage('isready');
                
                isEngineConnected = true;
                engineStatus.textContent = 'Motor conectado y listo';
                updateButtonStates();
                
                if (gameMode === 'cpu' && chess.turn() !== (playerColor === 'white' ? 'w' : 'b') && !chess.game_over()) {
                    setTimeout(() => {
                        if (adaptiveEnabled) {
                            startAdaptiveAnalysis();
                        } else {
                            startAnalysis();
                        }
                    }, 500);
                }
            })
            .catch(err => {
                console.error('Error conectando motor:', err);
                engineStatus.textContent = `Error: ${err.message}`;
                isEngineConnected = false;
                updateButtonStates();
            });
    }

    function addAdaptiveControls() {
        const adaptiveConfig = {
            threshold: 50,
            depthBonus: 3,
            multiPVBase: 5
        };

        return adaptiveConfig;
    }

    function logAdaptiveAnalysis(config, result) {
        console.group('🎮 Análisis Adaptativo');
        console.log('Configuración:', config);
        console.log('Líneas analizadas:', multiPVLines.length);
        console.log('Evaluación actual:', lastStats.evaluation);
        console.log('Movimiento seleccionado:', result);
        console.groupEnd();
    }

    function disconnectEngine() {
        if (!isEngineConnected) return;
        
        if (isAnalyzing) {
            stopAnalysis();
        }
        
        try {
            if (stockfish) {
                stockfish.terminate();
                stockfish = null;
            }
            
            if (blobURL) {
                URL.revokeObjectURL(blobURL);
                blobURL = null;
            }
        } catch (error) {
            console.warn('Error desconectando motor:', error);
        }
        
        isEngineConnected = false;
        const engineStatus = document.getElementById('engineStatus');
        if (engineStatus) engineStatus.textContent = 'Motor desconectado';
        
        resetAnalysisDisplay();
        updateButtonStates();
    }

    function startAnalysis() {
        if (!isEngineConnected || isAnalyzing || chess.game_over()) return;
        if (gameMode === 'cpu' && chess.turn() === (playerColor === 'white' ? 'w' : 'b')) return;

        const engineStatus = document.getElementById('engineStatus');
        if (!engineStatus) return;

        computeAdaptiveParameters();

        const fen = chess.fen();
        const searchCommand = `go depth ${predictedDepth}`;
        engineStatus.textContent = `Analizando (d=${predictedDepth})...`;

        stockfish.postMessage(`position fen ${fen}`);
        stockfish.postMessage(searchCommand);

        isAnalyzing = true;
        updateButtonStates();
        
        const pvLine = document.getElementById('pvLine');
        if (pvLine) pvLine.textContent = 'Analizando...';
        
        analysisStartTimestamp = Date.now();
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(updateAnalysisTimer, 100);

        analysisInterval = setInterval(() => {
            updateMemoryStats();
        }, 1000);
    }

    function startAdaptiveAnalysis() {
        if (!isEngineConnected || isAnalyzing || chess.game_over()) return;
        if (gameMode === 'cpu' && chess.turn() === (playerColor === 'white' ? 'w' : 'b')) return;

        const engineStatus = document.getElementById('engineStatus');
        if (!engineStatus) return;

        const currentEval = lastStats.evaluation ? lastStats.evaluation.value : 0;
        const analysisConfig = adaptiveEngine.determineAnalysisMode(currentEval);


        stockfish.postMessage(`setoption name MultiPV value ${analysisConfig.multiPV}`);

        const fen = chess.fen();
        engineStatus.textContent = `Análisis adaptativo (modo: ${analysisConfig.mode}, d=${analysisConfig.depth})...`;

        multiPVLines = [];

        stockfish.postMessage(`position fen ${fen}`);
        stockfish.postMessage(`go depth ${analysisConfig.depth}`);

        isAnalyzing = true;
        updateButtonStates();

        const pvLine = document.getElementById('pvLine');
        if (pvLine) pvLine.textContent = `Analizando (${analysisConfig.mode})...`;

        analysisStartTimestamp = Date.now();
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(updateAnalysisTimer, 100);

        window.currentAnalysisConfig = analysisConfig;
    }

    function stopAnalysis() {
        if (!isAnalyzing) return;
        
        try {
            if (stockfish) {
                stockfish.postMessage('stop');
            }

            if (analysisInterval) {
                clearInterval(analysisInterval);
                analysisInterval = null;
            }
            if (timerInterval) {
                clearInterval(timerInterval);
                timerInterval = null;
            }
        } catch (error) {
            console.warn('Error deteniendo análisis:', error);
        }
        
        isAnalyzing = false;
        const engineStatus = document.getElementById('engineStatus');
        if (engineStatus) {
            engineStatus.textContent = 'Motor conectado - Análisis detenido';
        }
        const timerEl = document.getElementById('analysisTimer');
        if (timerEl) timerEl.textContent = '--';
        updateButtonStates();
    }

    function handleEngineMessage(line) {
        if (typeof line !== 'string') return;

        try {
            if (line.startsWith('bestmove')) {
                processAdaptiveBestMove(line);
            } else if (line.startsWith('info')) {
                parseAdaptiveInfoLine(line);
            }
        } catch (error) {
            console.warn('Error procesando mensaje UCI:', error);
        }
    }

    function processBestMove(line) {
        const parts = line.split(' ');
        const bestMove = parts[1];

        if (bestMove && bestMove !== '(none)') {
            lastStats.bestMove = bestMove;
            lastStats.bestMoveSan = uciToSan(bestMove);
            
            const moveText = `Mejor: ${lastStats.bestMoveSan}`;
            
            const bestMoveEl = document.getElementById('bestMove');
            if (bestMoveEl) bestMoveEl.textContent = moveText;
            
            const chessboard = document.getElementById('chessboard');
            if (chessboard) chessboard.innerHTML = generateChessboardSVG();
            highlightSelection();

            if (lastStats.evaluation) {
                evaluationHistory.push(lastStats.evaluation);
            }
            if (lastStats.nps > 0) {
                averageNPS = averageNPS === 0 ? lastStats.nps : Math.round((averageNPS + lastStats.nps) / 2);
            }
            if (timerInterval) {
                clearInterval(timerInterval);
                timerInterval = null;
            }

            if (gameMode === 'cpu') {
                stopAnalysis();
                if (lastStats.bestMoveSan) {
                    makeMove(lastStats.bestMoveSan);
                } else {
                    makeCpuMove();
                }
            }
        }
    }

    function parseInfoLine(line) {
        const parts = line.split(' ');
        
        const nodesIndex = parts.indexOf('nodes');
        const timeIndex = parts.indexOf('time');
        if (nodesIndex !== -1 && timeIndex !== -1) {
            const nodes = parseInt(parts[nodesIndex + 1]);
            const time = parseInt(parts[timeIndex + 1]) / 1000;
            if (time > 0) {
                lastStats.nps = Math.round(nodes / time);
            }
        }
        
        const depthIndex = parts.indexOf('depth');
        if (depthIndex !== -1) {
            lastStats.depth = parseInt(parts[depthIndex + 1]);
        }

        const scoreIndex = parts.indexOf('score');
        if (scoreIndex !== -1) {
            parseScore(parts, scoreIndex);
        }

        const pvIndex = parts.indexOf('pv');
        if (pvIndex !== -1 && parts.length > pvIndex + 1) {
            const pvMoves = parts.slice(pvIndex + 1, pvIndex + 10);
            lastStats.pv = convertPVToSAN(pvMoves);
        }

        updateEvaluationDisplay();
    }

    function parseAdaptiveInfoLine(line) {
        const parts = line.split(' ');

        const multipvIndex = parts.indexOf('multipv');
        const pvIndex = parts.indexOf('pv');
        const scoreIndex = parts.indexOf('score');
        const depthIndex = parts.indexOf('depth');

        if (multipvIndex !== -1 && pvIndex !== -1 && scoreIndex !== -1) {
            const pvNumber = parseInt(parts[multipvIndex + 1]) - 1;
            const moves = parts.slice(pvIndex + 1);

            let evaluation = 0;
            const scoreType = parts[scoreIndex + 1];
            const scoreValue = parseInt(parts[scoreIndex + 2]);

            if (scoreType === 'cp') {
                evaluation = chess.turn() === 'w' ? scoreValue : -scoreValue;
            } else if (scoreType === 'mate') {
                evaluation = chess.turn() === 'w'
                    ? (scoreValue > 0 ? 100000 : -100000)
                    : (scoreValue > 0 ? -100000 : 100000);
            }

            multiPVLines[pvNumber] = {
                moves: moves,
                evaluation: evaluation,
                depth: depthIndex !== -1 ? parseInt(parts[depthIndex + 1]) : 0,
                san: convertPVToSAN(moves.slice(0, 5))
            };

            if (pvNumber === 0) {
                updateEvaluationDisplay();
                lastStats.evaluation = { value: evaluation, type: scoreType };
                lastStats.pv = multiPVLines[0].san;
            }
        }

        parseInfoLine(line);
    }

    function processAdaptiveBestMove(line) {
        if (!window.currentAnalysisConfig || multiPVLines.length === 0) {
            processBestMove(line);
            return;
        }

        const adaptiveResult = adaptiveEngine.selectAdaptiveMove(
            multiPVLines,
            window.currentAnalysisConfig
        );

        if (adaptiveResult && adaptiveResult.moves && adaptiveResult.moves.length > 0) {
            const bestMove = adaptiveResult.moves[0];
            lastStats.bestMove = bestMove;
            lastStats.bestMoveSan = uciToSan(bestMove);

            const bestMoveEl = document.getElementById('bestMove');
            if (bestMoveEl) {
                const modeIcon = window.currentAnalysisConfig.mode === 'seek_balance' ? '⚖️' :
                               window.currentAnalysisConfig.mode === 'seek_improvement' ? '📈' : '🎯';
                bestMoveEl.textContent = `${modeIcon} ${lastStats.bestMoveSan} (${formatEvaluation(adaptiveResult.evaluation, false)})`;
            }

            const engineStatus = document.getElementById('engineStatus');
            if (engineStatus) {
                engineStatus.textContent = `Movimiento adaptativo seleccionado (${window.currentAnalysisConfig.mode})`;
            }

            const chessboard = document.getElementById('chessboard');
            if (chessboard) chessboard.innerHTML = generateChessboardSVG();
            highlightSelection();

            if (gameMode === 'cpu') {
                stopAnalysis();
                setTimeout(() => {
                    makeMove(lastStats.bestMoveSan);
                }, 500);
            }
        } else {
            processBestMove(line);
        }

        window.currentAnalysisConfig = null;
    }

    function parseScore(parts, scoreIndex) {
        const type = parts[scoreIndex + 1];
        const value = parseInt(parts[scoreIndex + 2]);
        
        if (type === 'cp') {
            const adjustedEval = chess.turn() === 'w' ? value : -value;
            lastStats.evaluation = { value: adjustedEval, type: 'cp' };
        } else if (type === 'mate') {
            const adjustedMate = chess.turn() === 'w' ? value : -value;
            lastStats.evaluation = { value: adjustedMate, type: 'mate' };
        }
    }

    function updateEvaluationDisplay() {
        const evalEl = document.getElementById('evaluation');
        const engineStatsEl = document.getElementById('engineStats');
        const pvLineEl = document.getElementById('pvLine');

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

        if (lastStats.pv && pvLineEl) {
            pvLineEl.textContent = lastStats.pv;
        }

        if (engineStatsEl) {
            const depthText = `Profundidad: ${lastStats.depth}`;
            
            const npsText = lastStats.nps > 0 ? ` | ${lastStats.nps.toLocaleString()} nodos/s` : '';
            engineStatsEl.textContent = depthText + npsText;
        }
    }

    function resetAnalysisDisplay() {
        const evaluation = document.getElementById('evaluation');
        const bestMove = document.getElementById('bestMove');
        const engineStats = document.getElementById('engineStats');
        const pvLine = document.getElementById('pvLine');
        const timerEl = document.getElementById('analysisTimer');

        if (evaluation) evaluation.textContent = '--';
        if (bestMove) bestMove.textContent = '--';
        if (engineStats) engineStats.textContent = '--';
        if (pvLine) pvLine.textContent = 'Motor desconectado';
        if (timerEl) timerEl.textContent = '--';
    }

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

    function hideLegalMoves() {
        const panel = document.getElementById('legalMoves');
        if (panel) panel.style.display = 'none';
    }

    function setGameMode(mode) {
        gameMode = mode;
        const select = document.getElementById('modeSelect');
        if (select && select.value !== mode) select.value = mode;
        clearSelection();
    }

    function handleSquare(square) {
        if (gameMode === 'edit') return;

        if (!selectedSquare) {
            const piece = chess.get(square);
            if (piece && canSelectPiece(piece)) {
                selectedSquare = square;
                possibleMoves = chess.moves({ square, verbose: true });
            }
        } else {
            const moveObj = possibleMoves.find(m => m.to === square);
            if (moveObj) {
                chess.move(moveObj);
                lastMove = moveObj;
                const fenInput = document.getElementById('fenInput');
                if (fenInput) fenInput.value = chess.fen();
                selectedSquare = null;
                possibleMoves = [];
                drawBoard();
                if (gameMode === 'cpu' && chess.turn() !== (playerColor === 'white' ? 'w' : 'b')) {
                    setTimeout(startEngineTurnIfNeeded, 300);
                }
                return;
            }
            const piece = chess.get(square);
            if (piece && canSelectPiece(piece)) {
                selectedSquare = square;
                possibleMoves = chess.moves({ square, verbose: true });
            } else {
                selectedSquare = null;
                possibleMoves = [];
            }
        }
        highlightSelection();
    }

    function canSelectPiece(piece) {
        if (!piece) return false;
        if (gameMode === 'human') {
            return piece.color === chess.turn();
        }
        if (gameMode === 'cpu') {
            return piece.color === (playerColor === 'white' ? 'w' : 'b') && piece.color === chess.turn();
        }
        return false;
    }

    function highlightSelection() {
        const squares = document.querySelectorAll('.square');
        squares.forEach(el => el.classList.remove('selected', 'possible-move', 'possible-capture'));

        if (selectedSquare) {
            document.querySelectorAll(`[data-square="${selectedSquare}"]`).forEach(el => el.classList.add('selected'));
        }

        possibleMoves.forEach(m => {
            document.querySelectorAll(`[data-square="${m.to}"]`).forEach(el => {
                if (chess.get(m.to)) {
                    el.classList.add('possible-capture');
                } else {
                    el.classList.add('possible-move');
                }
            });
        });
    }

    function clearSelection() {
        selectedSquare = null;
        possibleMoves = [];
        highlightSelection();
    }

    function makeCpuMove() {
        if (!isEngineConnected) {
            console.warn('Motor no conectado, conectando automáticamente...');
            connectEngine();
            return;
        }

        if (adaptiveEnabled) {
            startAdaptiveAnalysis();
        } else {
            startAnalysis();
        }
    }

    function makeMove(moveStr) {
        try {
            const moveResult = chess.move(moveStr);
            if (!moveResult) {
                console.warn('Movimiento inválido:', moveStr);
                return;
            }
            
            lastMove = moveResult;
            
            const fenInput = document.getElementById('fenInput');
            if (fenInput) fenInput.value = chess.fen();
            
            drawBoard();
            showLegalMoves();
            
            if (isAnalyzing) {
                stopAnalysis();
            }
            
            resetStats();
            resetAnalysisDisplay();
            
            if (isEngineConnected && !chess.game_over()) {
                setTimeout(startEngineTurnIfNeeded, 500);
            }
            
        } catch (error) {
            console.error('Error al hacer movimiento:', error);
        }
    }

    function resetStats() {
        lastStats = {
            nps: 0,
            pv: '',
            evaluation: null,
            depth: 0,
            bestMove: '',
            bestMoveSan: '',
            memoryUsage: 0
        };
    }

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
            
            if (isAnalyzing) {
                stopAnalysis();
            }
            
            resetStats();
            resetAnalysisDisplay();
            
        } catch (error) {
            alert(error.message);
        }
    }


    function toggleEngine() {
        if (isEngineConnected) {
            disconnectEngine();
        } else {
            connectEngine();
        }
    }

    function toggleAnalysis() {
        if (isAnalyzing) {
            stopAnalysis();
        } else {
            if (gameMode === 'cpu') {
                startEngineTurnIfNeeded();
            } else {
                startAnalysis();
            }
        }
    }


    async function initializeChessApp() {
        try {
            await checkChessAvailability();
            
            console.log('🚀 Iniciando Analizador de Ajedrez...');
            
            chess = new Chess();
            console.log('✅ Chess.js inicializado correctamente');
            
            startChessApplication();
            
            exposePublicAPI();
            console.log('🔌 API pública expuesta correctamente');
            
        } catch (error) {
            console.error('💥 Error al inicializar:', error);
            showChessJsError();
        }
    }

    function startChessApplication() {
        console.log('🎯 Configurando aplicación principal...');

        function initializeApp() {
            try {
                console.log('🔧 Configurando componentes...');

                adaptiveEngine = new AdaptiveChessEngine();

                drawBoard();
                updateButtonStates();
                updateMemoryStats();
                setupPVObserver();

                const modeSelect = document.getElementById('modeSelect');
                if (modeSelect) {
                    modeSelect.addEventListener('change', e => setGameMode(e.target.value));
                }

                const adaptiveToggle = document.getElementById('adaptiveToggle');
                if (adaptiveToggle) {
                    adaptiveEnabled = adaptiveToggle.checked;
                    adaptiveToggle.addEventListener('change', e => {
                        adaptiveEnabled = e.target.checked;
                    });
                }

                setGameMode('edit');
                
                console.log('✅ Aplicación inicializada correctamente');
                
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

        initializeApp();
    }

    function exposePublicAPI() {
        window.chessApp = {
            drawBoard,
            showLegalMoves,
            hideLegalMoves,
            makeMove,
            handleSquare,
            setGameMode,
            toggleEngine,
            toggleAnalysis,
            forceBestMove,
            getStats: () => ({ ...lastStats }),
            getChessInstance: () => chess,
            isEngineConnected: () => isEngineConnected,
            isAnalyzing: () => isAnalyzing,
            resetStats,
            resetAnalysisDisplay,
            updateMemoryStats
        };
        
        console.log('🔌 API pública expuesta correctamente');
    }

    window.addEventListener('beforeunload', () => {
        console.log('🧹 Limpiando recursos del motor...');
        
        try {
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

        } catch (error) {
            console.warn('Error durante limpieza del motor:', error);
        }
    });
    
    window.addEventListener('error', (event) => {
        console.error('💥 Error global en motor:', event.error);
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden && isAnalyzing) {
            console.log('👁️ Pestaña oculta, pausando análisis...');
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeChessApp);
    } else {
        initializeChessApp();
    }

    console.log('🎮 Motor de Ajedrez v2.0 - Iniciando...');

})();

/**
 * Motor de Ajedrez con Análisis Fractal - Versión Optimizada
 * Sistema híbrido que combina Stockfish con algoritmos fractales
 * para análisis adaptativos de posiciones de ajedrez
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
        memoryUsage: 0
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

        findKingSquare(chess, color) {
            for (let rank = 0; rank < 8; rank++) {
                for (let file = 0; file < 8; file++) {
                    const square = String.fromCharCode(97 + file) + (rank + 1);
                    const piece = chess.get(square);
                    if (piece && piece.type.toLowerCase() === 'k' && piece.color === color) {
                        return square;
                    }
                }
            }
            return null;
        }

        calculateFractalComplexity(fen) {
            if (this.cache.has(fen)) {
                return this.cache.get(fen);
            }
            
            try {
                const pieces = this.countPieces(fen);
                const mobility = this.estimateMobility(fen);
                const centerControl = Math.abs(this.evaluateCenterControl(fen));
                const kingSafety = this.evaluateKingSafety(fen);

                const piecesNorm = Math.pow(Math.max(pieces / 32, 0.1), 1 / this.D);
                const mobilityNorm = Math.pow(Math.max(mobility / 60, 0.1), 1 / this.D);
                const centerControlNorm = Math.pow(Math.max(centerControl / 40, 0.1), 1 / this.D);
                const kingSafetyNorm = Math.pow(Math.max((kingSafety + 50) / 100, 0.1), 1 / this.D);

                const sumNorm = piecesNorm + mobilityNorm + centerControlNorm + kingSafetyNorm;
                const maxSum = 4;
                const complexity = 1 + 49 * (sumNorm / maxSum);

                const result = Math.max(1.0, complexity);
                
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

        countPieces(fen) {
            const position = fen.split(' ')[0];
            return position.replace(/[0-8\/]/g, '').length;
        }

        estimateMobility(fen) {
            try {
                const tempChess = new Chess(fen);
                return tempChess.moves().length;
            } catch (e) {
                return 20;
            }
        }

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

        evaluateKingSafety(fen) {
            try {
                const tempChess = new Chess(fen);
                let safety = 0;

                const kingSquare = tempChess.turn() === 'w' ? 
                    this.findKingSquare(tempChess, 'w') : this.findKingSquare(tempChess, 'b');
                
                if (!kingSquare) {
                    throw new Error('King not found on board');
                }

                const [file, rank] = [kingSquare.charCodeAt(0) - 97, parseInt(kingSquare[1]) - 1];
                const isCentral = (file >= 3 && file <= 4 && rank >= 3 && rank <= 4);
                const isEnroque = (file <= 2 || file >= 5) && (rank <= 1 || rank >= 6);
                safety += isCentral ? -10 : 0;
                safety += isEnroque ? 10 : 0;

                const totalPieces = this.countPieces(fen);
                const pieceFactor = Math.min(1, totalPieces / 32);
                safety += 10 * (1 - pieceFactor);

                const materialBalance = this.evaluateMaterialBalance(tempChess);
                safety += materialBalance * 0.5;

                const opponentColor = tempChess.turn() === 'w' ? 'b' : 'w';
                const attackers = this.getAttackers(tempChess, kingSquare, opponentColor);
                safety -= attackers * 5;

                const pawnShield = this.evaluatePawnShield(tempChess, kingSquare, tempChess.turn());
                safety += pawnShield * 5;

                if (tempChess.in_check()) {
                    safety -= 20;
                }
                const threats = this.countThreats(tempChess, kingSquare, opponentColor);
                safety -= threats * 10;

                return Math.max(-50, Math.min(50, safety));
            } catch (e) {
                console.warn('Error calculating king safety:', e);
                return 0;
            }
        }

        evaluateMaterialBalance(chess) {
            const pieceValues = this.pieceValues;
            let balance = 0;
            
            for (let rank = 0; rank < 8; rank++) {
                for (let file = 0; file < 8; file++) {
                    const square = String.fromCharCode(97 + file) + (rank + 1);
                    const piece = chess.get(square);
                    if (piece) {
                        const value = pieceValues[piece.type.toLowerCase()];
                        balance += piece.color === 'w' ? value : -value;
                    }
                }
            }
            
            return balance / 900;
        }

        getAttackers(chess, kingSquare, opponentColor) {
            const [kingFile, kingRank] = [
                kingSquare.charCodeAt(0) - 97,
                parseInt(kingSquare[1]) - 1
            ];
            let attackers = 0;
            
            for (let rank = 0; rank < 8; rank++) {
                for (let file = 0; file < 8; file++) {
                    const square = String.fromCharCode(97 + file) + (rank + 1);
                    const piece = chess.get(square);
                    if (piece && piece.color === opponentColor && 
                        ['q', 'r', 'b', 'n'].includes(piece.type.toLowerCase())) {
                        const distance = Math.max(Math.abs(file - kingFile), Math.abs(rank - kingRank));
                        if (distance <= 3) {
                            attackers++;
                        }
                    }
                }
            }
            
            return attackers;
        }

        evaluatePawnShield(chess, kingSquare, color) {
            const [kingFile, kingRank] = [
                kingSquare.charCodeAt(0) - 97,
                parseInt(kingSquare[1]) - 1
            ];
            let shield = 0;
            
            const direction = color === 'w' ? 1 : -1;
            const pawnRanks = [kingRank + direction, kingRank + 2 * direction];
            const pawnFiles = [Math.max(0, kingFile - 1), kingFile, Math.min(7, kingFile + 1)];
            
            for (const rank of pawnRanks) {
                if (rank < 0 || rank > 7) continue;
                for (const file of pawnFiles) {
                    const square = String.fromCharCode(97 + file) + (rank + 1);
                    const piece = chess.get(square);
                    if (piece && piece.type.toLowerCase() === 'p' && piece.color === color) {
                        shield += 1;
                    }
                }
            }
            
            return shield;
        }

        countThreats(chess, kingSquare, opponentColor) {
            const opponentMoves = chess.moves({ verbose: true, legal: false })
                .filter(move => move.color === opponentColor && move.to === kingSquare);
            return opponentMoves.length;
        }

        calculateOptimalDepth(complexity) {
            const baseDepth = 12;
            const complexityFactor = Math.pow(complexity / 10, 1/this.D);
            const optimalDepth = Math.round(baseDepth + complexityFactor * 6);
            return Math.max(optimalDepth, 8);
        }

        updateDimension(newDimension) {
            this.D = Math.max(1.0, Math.min(2.0, newDimension));
            this.cache.clear();
        }

        clearCache() {
            this.cache.clear();
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
                
                return fractalAnalysisActive ? `🌀 ${pvText.trim()}` : pvText.trim();
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

    function generateChessboardSVG() {
        const { squareSize, boardSize } = BOARD_CONFIG;
        const svgParts = [
            `<svg width="${boardSize + 40}" height="${boardSize + 40}" xmlns="http://www.w3.org/2000/svg" role="grid" aria-label="Tablero de ajedrez">`
        ];
        
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

    function updateFractalDisplay() {
        const complexityEl = document.getElementById('fractalComplexity');
        const depthEl = document.getElementById('depthValue');
        const confidenceEl = document.getElementById('fractalConfidence');
        const memoryEl = document.getElementById('engineMemory');
        
        if (!fractalAnalysisActive || !fractalEngine) {
            if (complexityEl) complexityEl.textContent = '--';
            if (depthEl) depthEl.textContent = '--';
            if (confidenceEl) confidenceEl.textContent = '--';
            if (memoryEl) memoryEl.textContent = '--';
            lastStats.fractalComplexity = 0;
            lastStats.optimalDepth = 0;
            lastStats.fractalConfidence = 0;
            return;
        }
        
        try {
            const fen = chess.fen();
            const complexity = fractalEngine.calculateFractalComplexity(fen);
            const optimalDepth = fractalEngine.calculateOptimalDepth(complexity);
            currentComplexity = complexity;
            lastStats.fractalComplexity = complexity;
            lastStats.optimalDepth = optimalDepth;
            
            if (complexityEl) {
                complexityEl.textContent = complexity.toFixed(2);
                complexityEl.className = 'value' + (complexity > 50 ? ' high-complexity-warning' : '');
            }
            if (depthEl) {
                depthEl.textContent = optimalDepth.toString();
                depthEl.className = 'indicator-value' + (optimalDepth > 30 ? ' high-depth-warning' : '');
            }
            
            const confidenceValue = 60 + (complexity / 20 * 35);
            if (confidenceEl) confidenceEl.textContent = confidenceValue.toFixed(1) + '%';
            lastStats.fractalConfidence = confidenceValue;

            if (memoryEl) {
                if (lastStats.memoryUsage > 0) {
                    memoryEl.textContent = `${lastStats.memoryUsage}MB`;
                } else {
                    memoryEl.textContent = 'N/A';
                }
            }
        } catch (error) {
            console.warn('Error updating fractal display:', error);
        }
    }

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

        const engineStatus = document.getElementById('engineStatus');
        if (!engineStatus) return;
        
        const fen = chess.fen();
        let searchCommand = 'go infinite';
        
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

        stockfish.postMessage(`position fen ${fen}`);
        stockfish.postMessage(searchCommand);
        
        isAnalyzing = true;
        updateButtonStates();
        
        const pvLine = document.getElementById('pvLine');
        if (pvLine) pvLine.textContent = 'Analizando...';
        
        analysisInterval = setInterval(() => {
            updateMemoryStats();
            updateFractalDisplay();
        }, 1000);
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
        } catch (error) {
            console.warn('Error deteniendo análisis:', error);
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

    function handleEngineMessage(line) {
        if (typeof line !== 'string') return;

        try {
            if (line.startsWith('bestmove')) {
                processBestMove(line);
            } else if (line.startsWith('info')) {
                parseInfoLine(line);
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
            
            const moveText = fractalAnalysisActive ? 
                `🌀 Mejor: ${lastStats.bestMoveSan}` : 
                `Mejor: ${lastStats.bestMoveSan}`;
            
            const bestMoveEl = document.getElementById('bestMove');
            if (bestMoveEl) bestMoveEl.textContent = moveText;
            
            const chessboard = document.getElementById('chessboard');
            if (chessboard) chessboard.innerHTML = generateChessboardSVG();
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

    function parseScore(parts, scoreIndex) {
        const type = parts[scoreIndex + 1];
        const value = parseInt(parts[scoreIndex + 2]);
        
        if (type === 'cp') {
            let adjustedEval = chess.turn() === 'w' ? value : -value;
            
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
            const depthText = fractalAnalysisActive && fractalEngine ?
                `Profundidad: ${lastStats.depth}/${fractalEngine.calculateOptimalDepth(currentComplexity)}` :
                `Profundidad: ${lastStats.depth}`;
            
            const npsText = lastStats.nps > 0 ? ` | ${lastStats.nps.toLocaleString()} nodos/s` : '';
            engineStatsEl.textContent = depthText + npsText;
        }
    }

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
                setTimeout(startAnalysis, 500);
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
            fractalComplexity: 0,
            optimalDepth: 0,
            fractalConfidence: 0,
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
            updateFractalDisplay();
            
            if (isAnalyzing) {
                stopAnalysis();
            }
            
            resetStats();
            resetAnalysisDisplay();
            
        } catch (error) {
            alert(error.message);
        }
    }

    function setupFractalControls() {
        fractalEngine = new FractalChessEngine(fractalDimension);

        const dimSlider = document.getElementById('dimensionSlider');
        const intSlider = document.getElementById('intensitySlider');
        const dimVal = document.getElementById('dimensionValue');
        const intVal = document.getElementById('intensityValue');
        const enableChk = document.getElementById('enableFractal');

        if (dimSlider && dimVal) {
            dimSlider.addEventListener('input', e => {
                fractalDimension = parseFloat(e.target.value);
                dimVal.textContent = fractalDimension.toFixed(3);
                if (fractalEngine) fractalEngine.updateDimension(fractalDimension);
                updateFractalDisplay();
            });
        }

        if (intSlider && intVal) {
            intSlider.addEventListener('input', e => {
                fractalIntensity = parseInt(e.target.value, 10) / 100;
                intVal.textContent = `${e.target.value}%`;
                updateFractalDisplay();
            });
        }

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
                
                if (isAnalyzing) {
                    stopAnalysis();
                    setTimeout(startAnalysis, 300);
                }
            });
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
            startAnalysis();
        }
    }

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

    async function initializeChessApp() {
        try {
            await checkChessAvailability();
            
            console.log('🚀 Iniciando Analizador de Ajedrez Fractal...');
            
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

        initializeApp();
    }

    function exposePublicAPI() {
        window.chessApp = {
            drawBoard,
            showLegalMoves,
            hideLegalMoves,
            makeMove,
            toggleEngine,
            toggleAnalysis,
            getStats: () => ({ ...lastStats }),
            getComplexity: () => currentComplexity,
            getFractalEngine: () => fractalEngine,
            getChessInstance: () => chess,
            isEngineConnected: () => isEngineConnected,
            isAnalyzing: () => isAnalyzing,
            isFractalActive: () => fractalAnalysisActive,
            resetStats,
            resetAnalysisDisplay,
            updateFractalDisplay,
            updateMemoryStats
        };
        
        console.log('🔌 API pública del motor fractal expuesta correctamente');
    }

    window.addEventListener('beforeunload', () => {
        console.log('🧹 Limpiando recursos del motor fractal...');
        
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

            if (fractalEngine) {
                fractalEngine.clearCache();
            }
        } catch (error) {
            console.warn('Error durante limpieza del motor fractal:', error);
        }
    });
    
    window.addEventListener('error', (event) => {
        console.error('💥 Error global en motor fractal:', event.error);
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden && isAnalyzing) {
            console.log('👁️ Pestaña oculta, pausando análisis fractal...');
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeChessApp);
    } else {
        initializeChessApp();
    }

    console.log('🎮 Motor de Ajedrez Fractal v2.0 - Iniciando...');
    console.log('🌀 Dimensión fractal D ≈ 1.247 | Análisis híbrido Stockfish + Geometría Fractal');

})();

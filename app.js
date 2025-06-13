/**
 * Ajedrez Interactivo - Motor Fractal v2.0
 * Sitio Web Completo con Funcionalidades Avanzadas
 */

(function () {
    'use strict';

    /* ======================= VARIABLES GLOBALES ======================= */
    let currentMode = 'edit';
    let selectedSquare = null;
    let possibleMoves = [];
    let gameHistory = [];
    let isGameActive = false;
    let playerColor = 'white';
    let cpuLevel = 3;
    let moveCount = 0;
    
    // Tablero demo para funcionalidad
    let demoBoard = [
        ['r','n','b','q','k','b','n','r'],
        ['p','p','p','p','p','p','p','p'],
        [null,null,null,null,null,null,null,null],
        [null,null,null,null,null,null,null,null],
        [null,null,null,null,null,null,null,null],
        [null,null,null,null,null,null,null,null],
        ['P','P','P','P','P','P','P','P'],
        ['R','N','B','Q','K','B','N','R']
    ];

    /* ======================= CONSTANTES ======================= */
    const PIECE_SYMBOLS = {
        'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
        'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟'
    };

    const BOARD_CONFIG = {
        squareSize: 65,
        get boardSize() { return this.squareSize * 8; }
    };

    const PRESET_POSITIONS = {
        'opening': {
            fen: 'rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/2N2N2/PP2PPPP/R1BQKB1R b KQkq - 0 4',
            name: 'Gambito de Dama',
            description: 'Apertura clásica con desarrollo rápido'
        },
        'middlegame': {
            fen: 'r1bq1rk1/ppp2ppp/2n1bn2/2bpp3/3PP3/2N1BN2/PPP1BPPP/R2Q1RK1 w - - 0 8',
            name: 'Medio Juego Complejo',
            description: 'Posición táctica con múltiples amenazas'
        },
        'endgame': {
            fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
            name: 'Final de Torres',
            description: 'Final técnico de torres y peones'
        }
    };

    /* ======================= GESTIÓN DE MODOS DE JUEGO ======================= */
    function setGameMode(mode) {
        console.log(`Cambiando modo de juego a: ${mode}`);
        
        clearSelection();
        currentMode = mode;
        updateModeButtons();
        updateGameModeDisplay();
        updateControlsVisibility();
        
        switch (mode) {
            case 'edit':
                setupEditMode();
                break;
            case 'human':
                setupHumanMode();
                break;
            case 'cpu':
                setupCpuMode();
                break;
        }
        
        updateGameStatus();
        logAction(`Modo cambiado a: ${getModeDisplayName(mode)}`);
    }

    function updateModeButtons() {
        const buttons = ['editModeBtn', 'humanModeBtn', 'cpuModeBtn'];
        buttons.forEach(btnId => {
            const btn = document.getElementById(btnId);
            if (btn) {
                btn.classList.remove('active');
            }
        });
        
        const activeBtn = document.getElementById(currentMode + 'ModeBtn');
        if (activeBtn) {
            activeBtn.classList.add('active');
        }
    }

    function updateGameModeDisplay() {
        const modeDisplay = document.getElementById('currentMode');
        if (modeDisplay) {
            modeDisplay.textContent = getModeDisplayName(currentMode);
        }
    }

    function getModeDisplayName(mode) {
        const modeNames = {
            'edit': 'Edición',
            'human': 'Humano vs Humano',
            'cpu': 'Versus CPU'
        };
        return modeNames[mode] || mode;
    }

    function updateControlsVisibility() {
        const cpuControls = document.getElementById('cpuControls');
        
        if (cpuControls) {
            cpuControls.style.display = currentMode === 'cpu' ? 'block' : 'none';
        }
    }

    function setupEditMode() {
        isGameActive = false;
        logAction('Modo edición activado - Analiza posiciones libremente');
    }

    function setupHumanMode() {
        isGameActive = true;
        logAction('Modo Humano vs Humano activado - ¡Que comience la partida!');
    }

    function setupCpuMode() {
        isGameActive = true;
        const colorSelect = document.getElementById('playerColor');
        playerColor = colorSelect ? colorSelect.value : 'white';
        
        const levelSelect = document.getElementById('cpuLevel');
        cpuLevel = levelSelect ? parseInt(levelSelect.value) : 3;
        
        logAction(`Modo CPU activado - Juegas como ${playerColor === 'white' ? 'Blancas' : 'Negras'}, Nivel: ${cpuLevel}`);
    }

    /* ======================= GESTIÓN DEL TABLERO ======================= */
    function generateChessboardSVG() {
        const size = BOARD_CONFIG.boardSize;
        const squareSize = BOARD_CONFIG.squareSize;
        
        let svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">`;
        
        // Generar casillas
        for (let rank = 0; rank < 8; rank++) {
            for (let file = 0; file < 8; file++) {
                const x = file * squareSize;
                const y = rank * squareSize;
                const isLight = (rank + file) % 2 === 0;
                const color = isLight ? '#f0d9b5' : '#b58863';
                const square = String.fromCharCode(97 + file) + (8 - rank);
                
                svg += `<rect x="${x}" y="${y}" width="${squareSize}" height="${squareSize}" 
                        fill="${color}" class="square" data-square="${square}" 
                        onclick="onSquareClick('${square}')" 
                        role="button" tabindex="0" 
                        aria-label="Casilla ${square}"/>`;
                
                // Agregar pieza si existe
                const piece = demoBoard[rank][file];
                if (piece) {
                    const symbol = PIECE_SYMBOLS[piece];
                    const fontSize = squareSize * 0.7;
                    const textX = x + squareSize / 2;
                    const textY = y + squareSize / 2 + fontSize / 3;
                    const pieceName = getPieceName(piece);
                    
                    svg += `<text x="${textX}" y="${textY}" font-size="${fontSize}" 
                            text-anchor="middle" class="piece" data-square="${square}"
                            onclick="onSquareClick('${square}')" 
                            aria-label="${pieceName} en ${square}">${symbol}</text>`;
                }
            }
        }
        
        // Agregar coordenadas
        for (let i = 0; i < 8; i++) {
            // Archivos (a-h)
            const file = String.fromCharCode(97 + i);
            const x = i * squareSize + squareSize - 8;
            const y = size - 2;
            svg += `<text x="${x}" y="${y}" font-size="10" fill="#8b5a2b" font-weight="bold">${file}</text>`;
            
            // Rangos (1-8)
            const rank = 8 - i;
            const rankX = 2;
            const rankY = i * squareSize + 12;
            svg += `<text x="${rankX}" y="${rankY}" font-size="10" fill="#8b5a2b" font-weight="bold">${rank}</text>`;
        }
        
        svg += '</svg>';
        return svg;
    }

    function getPieceName(piece) {
        const names = {
            'K': 'Rey blanco', 'Q': 'Dama blanca', 'R': 'Torre blanca', 
            'B': 'Alfil blanco', 'N': 'Caballo blanco', 'P': 'Peón blanco',
            'k': 'Rey negro', 'q': 'Dama negra', 'r': 'Torre negra', 
            'b': 'Alfil negro', 'n': 'Caballo negro', 'p': 'Peón negro'
        };
        return names[piece] || 'Pieza';
    }

    function onSquareClick(square) {
        console.log(`Clic en casilla: ${square}, modo: ${currentMode}`);
        
        if (currentMode === 'edit') {
            logAction(`Casilla ${square} seleccionada en modo edición`);
            return;
        }
        
        if (!isGameActive) {
            logAction('Inicia una partida para poder mover las piezas');
            return;
        }
        
        const piece = getPieceAt(square);
        
        if (selectedSquare === null) {
            // Seleccionar pieza
            if (piece) {
                selectSquare(square);
                logAction(`${getPieceName(piece)} seleccionada en ${square}`);
            } else {
                logAction(`Casilla ${square} vacía - Selecciona una pieza primero`);
            }
        } else {
            // Intentar mover o cambiar selección
            if (square === selectedSquare) {
                clearSelection();
                logAction('Selección cancelada');
            } else if (piece && canSelectPiece(piece)) {
                selectSquare(square);
                logAction(`${getPieceName(piece)} seleccionada en ${square}`);
            } else {
                attemptMove(selectedSquare, square);
            }
        }
    }

    function selectSquare(square) {
        clearSelection();
        selectedSquare = square;
        possibleMoves = getPossibleMoves(square);
        updateSquareHighlights();
    }

    function clearSelection() {
        selectedSquare = null;
        possibleMoves = [];
        updateSquareHighlights();
    }

    function attemptMove(from, to) {
        const piece = getPieceAt(from);
        const targetPiece = getPieceAt(to);
        
        // Simulación de movimiento válido
        if (isValidMove(from, to)) {
            executeMove(from, to);
            const moveNotation = generateMoveNotation(from, to, piece, targetPiece);
            logAction(`Movimiento: ${moveNotation}`);
        } else {
            logAction(`Movimiento inválido: ${from} a ${to}`);
            clearSelection();
        }
    }

    function executeMove(from, to) {
        const fromFile = from.charCodeAt(0) - 97;
        const fromRank = 8 - parseInt(from[1]);
        const toFile = to.charCodeAt(0) - 97;
        const toRank = 8 - parseInt(to[1]);
        
        // Mover pieza en el tablero demo
        const piece = demoBoard[fromRank][fromFile];
        demoBoard[toRank][toFile] = piece;
        demoBoard[fromRank][fromFile] = null;
        
        // Actualizar historial
        moveCount++;
        gameHistory.push({
            from: from,
            to: to,
            piece: piece,
            moveNumber: Math.ceil(moveCount / 2),
            isWhite: moveCount % 2 === 1
        });
        
        clearSelection();
        drawBoard();
        updateGameStatus();
        
        // Simular respuesta del CPU en modo CPU
        if (currentMode === 'cpu' && moveCount % 2 === 1) {
            setTimeout(makeCpuMove, 1000 + (cpuLevel * 200));
        }
    }

    function makeCpuMove() {
        logAction('CPU pensando...');
        
        // Simulación simple de movimiento del CPU
        setTimeout(() => {
            const cpuMoves = ['e7-e5', 'd7-d6', 'g8-f6', 'b8-c6'];
            const randomMove = cpuMoves[Math.floor(Math.random() * cpuMoves.length)];
            const [from, to] = randomMove.split('-');
            
            if (getPieceAt(from)) {
                executeMove(from, to);
                logAction(`CPU jugó: ${randomMove}`);
            }
        }, 500 + (cpuLevel * 300));
    }

    /* ======================= FUNCIONES DE UTILIDAD ======================= */
    function getPieceAt(square) {
        const file = square.charCodeAt(0) - 97;
        const rank = 8 - parseInt(square[1]);
        return demoBoard[rank] && demoBoard[rank][file] ? demoBoard[rank][file] : null;
    }

    function canSelectPiece(piece) {
        if (currentMode === 'human') {
            // En modo humano, alternar entre blancas y negras
            const isWhitePiece = piece === piece.toUpperCase();
            return (moveCount % 2 === 0 && isWhitePiece) || (moveCount % 2 === 1 && !isWhitePiece);
        } else if (currentMode === 'cpu') {
            // En modo CPU, solo permitir piezas del jugador
            const isWhitePiece = piece === piece.toUpperCase();
            return (playerColor === 'white' && isWhitePiece) || (playerColor === 'black' && !isWhitePiece);
        }
        return true;
    }

    function isValidMove(from, to) {
        // Simulación básica de validación
        const piece = getPieceAt(from);
        if (!piece) return false;
        
        const fromFile = from.charCodeAt(0) - 97;
        const fromRank = parseInt(from[1]) - 1;
        const toFile = to.charCodeAt(0) - 97;
        const toRank = parseInt(to[1]) - 1;
        
        // Verificar que no se mueva a la misma casilla
        if (from === to) return false;
        
        // Verificar que esté dentro del tablero
        if (toFile < 0 || toFile > 7 || toRank < 0 || toRank > 7) return false;
        
        // Simulación simple: permitir movimientos de 1-2 casillas
        const fileDiff = Math.abs(toFile - fromFile);
        const rankDiff = Math.abs(toRank - fromRank);
        
        return fileDiff <= 2 && rankDiff <= 2;
    }

    function getPossibleMoves(square) {
        // Simulación de movimientos posibles
        const file = square.charCodeAt(0) - 97;
        const rank = parseInt(square[1]) - 1;
        const moves = [];
        
        // Agregar casillas adyacentes como ejemplo
        for (let f = Math.max(0, file - 1); f <= Math.min(7, file + 1); f++) {
            for (let r = Math.max(0, rank - 1); r <= Math.min(7, rank + 1); r++) {
                if (f !== file || r !== rank) {
                    moves.push(String.fromCharCode(97 + f) + (r + 1));
                }
            }
        }
        
        return moves;
    }

    function generateMoveNotation(from, to, piece, captured) {
        const pieceLetter = piece.toUpperCase() === 'P' ? '' : piece.toUpperCase();
        const captureSymbol = captured ? 'x' : '';
        return `${pieceLetter}${captureSymbol}${to}`;
    }

    function updateSquareHighlights() {
        // Limpiar highlights anteriores
        const squares = document.querySelectorAll('.square');
        squares.forEach(sq => {
            sq.classList.remove('selected', 'possible-move', 'possible-capture');
        });
        
        if (selectedSquare) {
            const selectedElement = document.querySelector(`[data-square="${selectedSquare}"]`);
            if (selectedElement) {
                selectedElement.classList.add('selected');
            }
        }
        
        // Agregar highlights para movimientos posibles
        possibleMoves.forEach(moveSquare => {
            const square = document.querySelector(`[data-square="${moveSquare}"]`);
            if (square) {
                const targetPiece = getPieceAt(moveSquare);
                if (targetPiece) {
                    square.classList.add('possible-capture');
                } else {
                    square.classList.add('possible-move');
                }
            }
        });
    }

    /* ======================= GESTIÓN DEL ESTADO DEL JUEGO ======================= */
    function updateGameStatus() {
        const statusElement = document.getElementById('gameStatus');
        const currentPlayerElement = document.getElementById('currentPlayer');
        
        if (!statusElement) return;
        
        let message = '';
        let currentPlayer = '';
        
        switch (currentMode) {
            case 'edit':
                message = 'Modo edición activo';
                currentPlayer = 'Editor';
                break;
            case 'human':
                currentPlayer = moveCount % 2 === 0 ? 'Blancas' : 'Negras';
                message = `${currentPlayer} por mover`;
                break;
            case 'cpu':
                if (moveCount % 2 === 0) {
                    currentPlayer = playerColor === 'white' ? 'Tu turno' : 'CPU';
                } else {
                    currentPlayer = playerColor === 'white' ? 'CPU' : 'Tu turno';
                }
                message = currentPlayer === 'CPU' ? 'CPU pensando...' : 'Tu turno - Mueve las piezas';
                break;
        }
        
        statusElement.innerHTML = message;
        
        if (currentPlayerElement) {
            currentPlayerElement.textContent = currentPlayer;
        }
    }

    /* ======================= FUNCIONES PRINCIPALES ======================= */
    function drawBoard() {
        const chessboard = document.getElementById('chessboard');
        if (chessboard) {
            chessboard.innerHTML = generateChessboardSVG();
        }
        
        updateGameStatus();
        logAction('Tablero actualizado');
    }

    function showDemo() {
        setGameMode('human');
        drawBoard();
        logAction('Demo interactivo iniciado - ¡Haz clic en las piezas para jugar!');
        
        // Simular algunos movimientos en el historial
        setTimeout(() => {
            logAction('Ejemplo: 1. e4 - Apertura del rey');
        }, 1000);
        
        setTimeout(() => {
            logAction('Ejemplo: 1... e5 - Respuesta simétrica');
        }, 2000);
        
        setTimeout(() => {
            logAction('¡Ahora es tu turno! Haz clic en una pieza blanca');
        }, 3000);
    }

    function startNewGame() {
        // Reiniciar tablero
        demoBoard = [
            ['r','n','b','q','k','b','n','r'],
            ['p','p','p','p','p','p','p','p'],
            [null,null,null,null,null,null,null,null],
            [null,null,null,null,null,null,null,null],
            [null,null,null,null,null,null,null,null],
            [null,null,null,null,null,null,null,null],
            ['P','P','P','P','P','P','P','P'],
            ['R','N','B','Q','K','B','N','R']
        ];
        
        gameHistory = [];
        moveCount = 0;
        clearSelection();
        
        const fenInput = document.getElementById('fenInput');
        if (fenInput) {
            fenInput.value = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
        }
        
        drawBoard();
        clearMovesHistory();
        logAction('Nueva partida iniciada - ¡Buena suerte!');
        
        if (currentMode === 'cpu') {
            setupCpuMode();
        }
    }

    function undoMove() {
        if (gameHistory.length === 0) {
            logAction('No hay movimientos para deshacer');
            return;
        }
        
        const lastMove = gameHistory.pop();
        moveCount--;
        
        // Revertir movimiento en el tablero
        const fromFile = lastMove.from.charCodeAt(0) - 97;
        const fromRank = 8 - parseInt(lastMove.from[1]);
        const toFile = lastMove.to.charCodeAt(0) - 97;
        const toRank = 8 - parseInt(lastMove.to[1]);
        
        demoBoard[fromRank][fromFile] = lastMove.piece;
        demoBoard[toRank][toFile] = null;
        
        clearSelection();
        drawBoard();
        logAction(`Movimiento deshecho: ${lastMove.from}-${lastMove.to}`);
    }

    function resetGame() {
        if (confirm('¿Estás seguro de que quieres reiniciar la partida?')) {
            startNewGame();
        }
    }

    function loadPresetPosition(type) {
        const position = PRESET_POSITIONS[type];
        if (!position) return;
        
        const fenInput = document.getElementById('fenInput');
        if (fenInput) {
            fenInput.value = position.fen;
        }
        
        // Parsear FEN básico para el demo
        parseBasicFEN(position.fen);
        drawBoard();
        logAction(`Posición cargada: ${position.name} - ${position.description}`);
    }

    function parseBasicFEN(fen) {
        // Implementación básica para el demo
        const ranks = fen.split(' ')[0].split('/');
        demoBoard = [];
        
        for (let rank = 0; rank < 8; rank++) {
            demoBoard[rank] = [];
            let file = 0;
            
            for (let char of ranks[rank]) {
                if (isNaN(char)) {
                    demoBoard[rank][file] = char;
                    file++;
                } else {
                    const emptySquares = parseInt(char);
                    for (let i = 0; i < emptySquares; i++) {
                        demoBoard[rank][file] = null;
                        file++;
                    }
                }
            }
        }
    }

    /* ======================= GESTIÓN DEL HISTORIAL ======================= */
    function logAction(message) {
        const historyContainer = document.getElementById('movesHistory');
        if (!historyContainer) return;
        
        const timestamp = new Date().toLocaleTimeString();
        const entry = document.createElement('div');
        entry.className = 'move-entry';
        entry.innerHTML = `
            <span class="move-number">${timestamp}</span>
            <span class="move-notation">${message}</span>
        `;
        
        // Remover mensaje de bienvenida si existe
        const welcomeMessage = historyContainer.querySelector('.welcome-message');
        if (welcomeMessage) {
            welcomeMessage.remove();
        }
        
        historyContainer.appendChild(entry);
        historyContainer.scrollTop = historyContainer.scrollHeight;
    }

    function clearMovesHistory() {
        const historyContainer = document.getElementById('movesHistory');
        if (historyContainer) {
            historyContainer.innerHTML = '<div class="welcome-message"><p>Historial limpio</p><p>Los movimientos aparecerán aquí</p></div>';
        }
    }

    /* ======================= MODALES ======================= */
    function showAbout() {
        const modal = document.getElementById('aboutModal');
        if (modal) {
            modal.style.display = 'block';
        }
    }

    function showHelp() {
        const modal = document.getElementById('helpModal');
        if (modal) {
            modal.style.display = 'block';
        }
    }

    function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
        }
    }

    /* ======================= EVENT LISTENERS ======================= */
    function setupEventListeners() {
        // Configurar eventos de los controles del CPU
        const playerColorSelect = document.getElementById('playerColor');
        if (playerColorSelect) {
            playerColorSelect.addEventListener('change', (e) => {
                playerColor = e.target.value;
                if (currentMode === 'cpu') {
                    logAction(`Color cambiado a: ${playerColor === 'white' ? 'Blancas' : 'Negras'}`);
                }
            });
        }

        const cpuLevelSelect = document.getElementById('cpuLevel');
        if (cpuLevelSelect) {
            cpuLevelSelect.addEventListener('change', (e) => {
                cpuLevel = parseInt(e.target.value);
                logAction(`Nivel CPU cambiado a: ${cpuLevel}`);
            });
        }

        // Cerrar modales al hacer clic fuera
        window.addEventListener('click', (event) => {
            const modals = document.querySelectorAll('.modal');
            modals.forEach(modal => {
                if (event.target === modal) {
                    modal.style.display = 'none';
                }
            });
        });

        // Soporte para teclado
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                const modals = document.querySelectorAll('.modal');
                modals.forEach(modal => {
                    modal.style.display = 'none';
                });
            }
        });
    }

    /* ======================= INICIALIZACIÓN ======================= */
    function initializeApp() {
        console.log('🚀 Inicializando Ajedrez Interactivo v2.0...');
        
        // Configurar modo inicial
        setGameMode('edit');
        
        // Dibujar tablero inicial
        drawBoard();
        
        // Configurar event listeners
        setupEventListeners();
        
        // Mensaje de bienvenida
        logAction('¡Bienvenido al Ajedrez Interactivo v2.0!');
        logAction('Selecciona un modo de juego para comenzar');
        
        console.log('✅ Aplicación inicializada correctamente');
    }

    /* ======================= EXPOSICIÓN DE API PÚBLICA ======================= */
    window.setGameMode = setGameMode;
    window.onSquareClick = onSquareClick;
    window.drawBoard = drawBoard;
    window.showDemo = showDemo;
    window.startNewGame = startNewGame;
    window.undoMove = undoMove;
    window.resetGame = resetGame;
    window.loadPresetPosition = loadPresetPosition;
    window.showAbout = showAbout;
    window.showHelp = showHelp;
    window.closeModal = closeModal;

    /* ======================= INICIALIZACIÓN AUTOMÁTICA ======================= */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeApp);
    } else {
        initializeApp();
    }

})();


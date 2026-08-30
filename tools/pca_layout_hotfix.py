from pathlib import Path
import re

path = Path('index.html')
s = path.read_text(encoding='utf-8')


def rep(old, new, n=1, label='replacement'):
    global s
    found = s.count(old)
    if found != n:
        raise SystemExit(f'{label}: expected {n} occurrence(s), found {found}')
    s = s.replace(old, new, n)

# Use the available desktop width instead of capping the application at the old two-column layout.
rep(
    '            max-width: 1600px;\n',
    '            max-width: 1900px;\n',
    label='container width'
)

rep(
'''        .main-layout {
            display: flex;
            gap: 20px;
            flex: 1;
            min-height: 0;
        }

        .board-container-wrapper {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
''',
'''        .main-layout {
            display: grid;
            grid-template-columns: minmax(520px, 560px) minmax(360px, 420px) minmax(430px, 1fr);
            grid-template-areas: "board controls metrics";
            gap: 16px;
            align-items: start;
            flex: 1;
            min-height: 0;
        }

        .board-container-wrapper {
            grid-area: board;
            display: flex;
            flex-direction: column;
            gap: 12px;
            min-width: 0;
        }
''',
label='desktop grid'
)

rep(
'''        .right-panel {
            width: 400px;
            min-width: 400px;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
''',
'''        .right-panel {
            grid-area: controls;
            width: auto;
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .pca-metrics-sidebar {
            grid-area: metrics;
            min-width: 0;
            align-self: start;
            position: sticky;
            top: 12px;
            max-height: calc(100vh - 24px);
            overflow: auto;
        }

        .pca-metrics-card {
            border-left: 4px solid #2563eb;
            background: #ffffff;
        }

        .pca-metrics-card > .section-title {
            margin-bottom: 10px;
            font-size: 0.95rem;
        }

        .pca-selected-summary {
            margin: 8px 0 10px;
            padding: 8px;
            border: 1px solid #dbeafe;
            border-radius: 6px;
            background: #ffffff;
        }

        .pca-selected-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 5px;
        }

        .pca-selected-grid .metric-item {
            padding: 5px 6px;
            background: #f8fbff;
        }

        .pca-selected-grid .metric-label {
            font-size: 0.62rem;
        }

        .pca-selected-grid .metric-value {
            font-size: 0.76rem;
        }
''',
label='metrics sidebar css'
)

rep(
'''        .pca-evaluation-overview {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 5px;
            margin: 7px 0;
        }
''',
'''        .pca-evaluation-overview {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 5px;
            margin: 7px 0;
        }
''',
label='overview columns'
)

rep(
'''        .pca-evaluation-table {
            min-width: 850px;
        }
''',
'''        .pca-evaluation-table {
            min-width: 850px;
        }

        .pca-ranking-compact {
            min-width: 610px;
        }

        .pca-ranking-compact th:nth-child(2),
        .pca-ranking-compact td:nth-child(2),
        .pca-ranking-compact th:nth-child(3),
        .pca-ranking-compact td:nth-child(3),
        .pca-ranking-compact th:nth-child(4),
        .pca-ranking-compact td:nth-child(4),
        .pca-ranking-compact th:nth-child(11),
        .pca-ranking-compact td:nth-child(11),
        .pca-ranking-compact th:nth-child(12),
        .pca-ranking-compact td:nth-child(12) {
            display: none;
        }
''',
label='compact ranking css'
)

# Replace the old responsive two-column collapse with board | controls/metrics, then one-column mobile.
pattern = re.compile(r'''        @media \(max-width: 1200px\) \{.*?        \}\n\n        @media \(max-width: 768px\) \{.*?        \}\n''', re.S)
match = pattern.search(s)
if not match:
    raise SystemExit('responsive media blocks not found')
responsive = '''        @media (max-width: 1350px) {
            .main-layout {
                grid-template-columns: minmax(480px, 540px) minmax(0, 1fr);
                grid-template-areas:
                    "board controls"
                    "board metrics";
            }

            .board-container-wrapper {
                align-self: start;
            }

            .right-panel,
            .pca-metrics-sidebar {
                width: 100%;
                min-width: 0;
            }

            .pca-metrics-sidebar {
                position: static;
                max-height: none;
                overflow: visible;
            }

            .analysis-panel {
                display: flex;
            }
        }

        @media (max-width: 900px) {
            .container {
                padding: 12px;
            }

            .main-layout {
                grid-template-columns: minmax(0, 1fr);
                grid-template-areas:
                    "board"
                    "controls"
                    "metrics";
            }

            .board-container-wrapper {
                align-self: center;
                max-width: 100%;
            }

            .input-row {
                flex-direction: column;
            }

            .input-group {
                min-width: unset;
                width: 100%;
            }

            .button-group {
                width: 100%;
            }

            .button-group .btn {
                flex: 1 1 auto;
                justify-content: center;
            }

            .analysis-panel {
                display: flex;
            }

            .right-panel,
            .pca-metrics-sidebar {
                width: 100%;
            }

            .pca-selected-grid,
            .metric-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
        }
'''
s = s[:match.start()] + responsive + s[match.end():]

# Move detailed PCA metrics and Pulse Evaluation out of the central control card.
metrics_start = '                        <div class="metric-grid">'
central_close = '\n                    </div>\n\n                    <div class="analysis-section analysis-card analysis-card-control">'
start = s.find(metrics_start)
if start < 0:
    raise SystemExit('metric block start not found')
end = s.find(central_close, start)
if end < 0:
    raise SystemExit('primary card end not found')
metrics_block = s[start:end]
s = s[:start] + s[end:]

# Give the first evaluation table a compact ranking presentation.
old_table = '<table class="pca-regression-table pca-evaluation-table">'
first_eval = metrics_block.find(old_table)
if first_eval < 0:
    raise SystemExit('ranking table not found')
metrics_block = (
    metrics_block[:first_eval]
    + '<table class="pca-regression-table pca-evaluation-table pca-ranking-compact">'
    + metrics_block[first_eval + len(old_table):]
)

# Add a selected-move summary between execution telemetry and ranking.
overview_tail = '''                            </div>
                            <div class="pca-evaluation-table-wrap">'''
selected_summary = '''                            </div>
                            <div class="pca-selected-summary">
                                <div class="pca-regression-header">
                                    <span class="pca-regression-title">Movimiento seleccionado</span>
                                    <strong id="pcaSelectedMove">—</strong>
                                </div>
                                <div class="pca-selected-grid">
                                    <div class="metric-item"><span class="metric-label">FIRST_PULSE</span><span id="pcaSelectedFirstPulse" class="metric-value">—</span></div>
                                    <div class="metric-item"><span class="metric-label">LAST_DEPTH</span><span id="pcaSelectedDepth" class="metric-value">—</span></div>
                                    <div class="metric-item"><span class="metric-label">ESTADO</span><span id="pcaSelectedCompleteness" class="metric-value">—</span></div>
                                    <div class="metric-item"><span class="metric-label">BALANCE</span><span id="pcaSelectedBalance" class="metric-value">—</span></div>
                                    <div class="metric-item"><span class="metric-label">RESOLUTION</span><span id="pcaSelectedResolution" class="metric-value">—</span></div>
                                    <div class="metric-item"><span class="metric-label">SIGNED_PULSE</span><span id="pcaSelectedSignedPulse" class="metric-value">—</span></div>
                                    <div class="metric-item"><span class="metric-label">H_OUTCOME</span><span id="pcaSelectedEntropy" class="metric-value">—</span></div>
                                    <div class="metric-item"><span class="metric-label">CONFLICTS</span><span id="pcaSelectedConflicts" class="metric-value">—</span></div>
                                    <div class="metric-item"><span class="metric-label">PCA_SCORE</span><span id="pcaSelectedScore" class="metric-value">—</span></div>
                                </div>
                            </div>
                            <div class="pca-evaluation-table-wrap">'''
if metrics_block.count(overview_tail) < 1:
    raise SystemExit('overview insertion point not found')
metrics_block = metrics_block.replace(overview_tail, selected_summary, 1)

# Put the metrics block into a dedicated third column after the controls column.
right_panel_tail = '''                    <div id="legalMovesList" class="moves-list"></div>
                </div>
            </div>
        </div>'''
if s.count(right_panel_tail) != 1:
    raise SystemExit(f'right panel tail expected once, found {s.count(right_panel_tail)}')
sidebar = '''                    <div id="legalMovesList" class="moves-list"></div>
                </div>
            </div>

            <aside class="pca-metrics-sidebar" aria-label="Métricas PCA en vivo">
                <div class="analysis-card pca-metrics-card">
                    <div class="section-title">
                        <i class="fas fa-chart-line"></i>
                        MÉTRICAS PCA
                        <span class="section-subtitle">telemetría en vivo</span>
                    </div>
''' + metrics_block + '''
                </div>
            </aside>
        </div>'''
s = s.replace(right_panel_tail, sidebar, 1)

# Populate the selected-move summary whenever the temporal signature is rendered.
old_render_head = '''            if (!body || !label) return;
            body.replaceChildren();
            label.textContent = move ? move.san : '—';
'''
new_render_head = '''            if (!body || !label) return;
            const setSelectedText = (id, value) => {
                const element = document.getElementById(id);
                if (element) element.textContent = value;
            };
            setSelectedText('pcaSelectedMove', move ? move.san : '—');
            setSelectedText('pcaSelectedFirstPulse', move && move.firstPulseDepth != null ? move.firstPulseDepth : '—');
            setSelectedText('pcaSelectedDepth', move ? (move.lastComputedDepth || move.depth || 0) : '—');
            setSelectedText(
                'pcaSelectedCompleteness',
                move ? (move.partial ? 'PARTIAL' : (move.complete ? 'COMPLETE' : 'RUNNING')) : '—'
            );
            setSelectedText('pcaSelectedBalance', move ? pcaFormatSigned(move.balance) : '—');
            setSelectedText('pcaSelectedResolution', move ? ((move.resolution || 0) * 100).toFixed(1) + '%' : '—');
            setSelectedText('pcaSelectedSignedPulse', move ? pcaFormatSigned(move.signedPulse) : '—');
            setSelectedText('pcaSelectedEntropy', move ? Number(move.outcomeUncertainty || 0).toFixed(3) : '—');
            setSelectedText('pcaSelectedConflicts', move ? Number(move.outcomeConflicts || 0).toLocaleString() : '—');
            setSelectedText('pcaSelectedScore', move ? pcaFormatSigned(move.pcaScore) : '—');
            body.replaceChildren();
            label.textContent = move ? move.san : '—';
'''
rep(old_render_head, new_render_head, label='selected move render')

# The sidebar ranking is intentionally a compact Top-10 view; the full evaluation object remains untouched.
rep(
    '            moves.forEach((move, index) => {\n',
    '            const rankingMoves = moves.slice(0, 10);\n            rankingMoves.forEach((move, index) => {\n',
    label='top10 ranking'
)

# Sanity checks: keep every functional ID exactly once.
for element_id in [
    'pcaInitialCandidates', 'pcaEvaluationPanel', 'pcaEvaluationBody',
    'pcaPulseTemporalBody', 'pcaSelectedMove', 'pcaEvaluationNodes'
]:
    count = s.count(f'id="{element_id}"')
    if count != 1:
        raise SystemExit(f'{element_id}: expected one id, found {count}')

path.write_text(s, encoding='utf-8')
print('PCA desktop metrics layout patch applied successfully')

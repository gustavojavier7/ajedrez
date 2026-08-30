from pathlib import Path

path = Path('index.html')
s = path.read_text(encoding='utf-8')
old = '''        }

            .input-row {
                flex-direction: column;
            }

            .input-group {
                min-width: unset;
            }

            .button-group {
                flex-direction: column;
            }

            .analysis-panel {
                grid-template-columns: 1fr;
            }

            .right-panel {
                width: 100%;
            }
        }
    </style>'''
new = '''        }
    </style>'''
count = s.count(old)
if count != 1:
    raise SystemExit(f'legacy responsive fragment: expected 1, found {count}')
s = s.replace(old, new, 1)
path.write_text(s, encoding='utf-8')
print('Legacy responsive fragment removed')

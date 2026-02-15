import re
import sys
from collections import defaultdict

INPUT_FILE = sys.argv[1] if len(sys.argv) > 1 else 'ts-errors.txt'

try:
    with open(INPUT_FILE, 'r') as f:
        errors = f.read()
except FileNotFoundError:
    print(f"Error: '{INPUT_FILE}' not found. Run 'npx tsc --noEmit 2> {INPUT_FILE}' first.", file=sys.stderr)
    sys.exit(1)

# Group by error type
error_types = defaultdict(list)
for line in errors.split('\n'):
    match = re.search(r'error (TS\d+)', line)
    if match:
        code = match.group(1)
        error_types[code].append(line)

for code, lines in sorted(error_types.items(), key=lambda x: -len(x[1])):
    print(f'{code}: {len(lines)} errors')

print("\n" + "="*60)
print("Files with most errors:")
file_errors = defaultdict(list)
for line in errors.split('\n'):
    match = re.search(r'^([^\(]+)\(', line)
    if match:
        filepath = match.group(1)
        file_errors[filepath].append(line)

for filepath, lines in sorted(file_errors.items(), key=lambda x: -len(x[1]))[:20]:
    if not filepath.startswith('node_modules'):
        print(f'{filepath}: {len(lines)} errors')

import re
from collections import defaultdict

with open('ts-errors.txt', 'r') as f:
    errors = f.read()

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

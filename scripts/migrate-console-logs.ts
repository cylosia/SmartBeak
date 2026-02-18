#!/usr/bin/env ts-node
/**
 * Console.log to Structured Logger Migration Script
 * 
 * Usage:
 *   npx ts-node scripts/migrate-console-logs.ts [options] [file-pattern]
 * 
 * Examples:
 *   npx ts-node scripts/migrate-console-logs.ts "apps/api/src/routes/*.ts"
 *   npx ts-node scripts/migrate-console-logs.ts --dry-run "apps/api/**/*.ts"
 *   npx ts-node scripts/migrate-console-logs.ts --service="BillingService" "apps/api/src/billing/*.ts"
 */

import { glob } from 'glob';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, basename, extname } from 'path';
import { argv } from 'process';

// ============================================================================
// Types
// ============================================================================

interface MigrationOptions {
  dryRun: boolean;
  verbose: boolean;
  service?: string;
  filePattern: string;
}

interface MigrationResult {
  file: string;
  success: boolean;
  changes: number;
  addedImport: boolean;
  serviceName: string;
  errors: string[];
  before: string;
  after: string;
}

/** P3-2 FIX: Proper type for pattern replacement functions (removes `as any` cast). */
type ReplacementFn = (match: string, ...groups: string[]) => string;

interface MigrationPattern {
  name: string;
  regex: RegExp;
  replacement: ReplacementFn;
}

// ============================================================================
// Configuration
// ============================================================================

const LOGGER_IMPORT = `import { getLogger } from '@kernel/logger';\n`;

/**
 * P1-29 FIX: Escape single quotes inside a string that will be placed
 * inside single-quoted output. Without this, messages like "can't connect"
 * become `logger.error('can't connect')` which is broken syntax.
 */
function escapeSingleQuotes(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

const MIGRATION_PATTERNS: MigrationPattern[] = [
  // Pattern: console.error('message', error) with service prefix
  {
    name: 'error-with-service-prefix',
    regex: /console\.error\(\s*\[([^\]]+)\]\s+(['"`][^'"`]*['"`]),\s*(\w+)\s*\)/g,
    replacement: (_match: string, _service: string, message: string, errorVar: string) => {
      return `logger.error(${message}, ${errorVar})`;
    },
  },
  // Pattern: console.error('message', error)
  {
    name: 'error-with-error',
    regex: /console\.error\(\s*['"`]([^'"]*)['"`],\s*(\w+)\s*\)/g,
    replacement: (_match: string, message: string, errorVar: string) => {
      return `logger.error('${escapeSingleQuotes(message)}', ${errorVar})`;
    },
  },
  // Pattern: console.error('[Service] message:', var)
  {
    name: 'error-with-prefix',
    regex: /console\.error\(\s*\[([^\]]+)\]\s+(['"`][^'"`]*['"`]\s*:\s*),\s*(.+)\s*\)/g,
    replacement: (_match: string, _service: string, message: string, data: string) => {
      const cleanMessage = message.replace(/[:\s]*$/, '').replace(/['"`]/g, '');
      return `logger.error('${escapeSingleQuotes(cleanMessage)}', { data: ${data} })`;
    },
  },
  // Pattern: console.error(`[Service] message ${var}`)
  {
    name: 'error-template-literal',
    regex: /console\.error\(\s*`\[([^\]]+)\]\s+([^`]+)`\s*\)/g,
    replacement: (_match: string, _service: string, template: string) => {
      // Extract variables from template
      const vars = template.match(/\$\{([^}]+)\}/g) || [];
      if (vars.length === 0) {
        return `logger.error('${escapeSingleQuotes(template)}')`;
      }

      const message = template.replace(/\$\{([^}]+)\}/g, '${$1}');
      const metadata = vars.map((v, i) => `var${i}: ${v.slice(2, -1)}`).join(', ');
      return `logger.error('${escapeSingleQuotes(message)}', { ${metadata} })`;
    },
  },
  // Pattern: console.warn('[Service] message')
  {
    name: 'warn-with-service-prefix',
    regex: /console\.warn\(\s*\[([^\]]+)\]\s+(['"`][^'"`]*['"`])\s*\)/g,
    replacement: (_match: string, _service: string, message: string) => {
      return `logger.warn(${message})`;
    },
  },
  // Pattern: console.warn('message')
  {
    name: 'warn-simple',
    regex: /console\.warn\(\s*['"`]([^'"]*)['"`]\s*\)/g,
    replacement: (_match: string, message: string) => {
      return `logger.warn('${escapeSingleQuotes(message)}')`;
    },
  },
  // Pattern: console.warn('[Service] message:', data)
  {
    name: 'warn-with-data',
    regex: /console\.warn\(\s*\[([^\]]+)\]\s+(['"`][^'"`]*['"`]\s*:\s*),\s*(.+)\s*\)/g,
    replacement: (_match: string, _service: string, message: string, data: string) => {
      const cleanMessage = message.replace(/[:\s]*$/, '').replace(/['"`]/g, '');
      return `logger.warn('${escapeSingleQuotes(cleanMessage)}', { data: ${data} })`;
    },
  },
  // Pattern: console.log('[Service] message')
  {
    name: 'log-with-service-prefix',
    regex: /console\.log\(\s*\[([^\]]+)\]\s+(['"`][^'"`]*['"`])\s*\)/g,
    replacement: (_match: string, _service: string, message: string) => {
      return `logger.info(${message})`;
    },
  },
  // Pattern: console.log('message', data)
  {
    name: 'log-with-data',
    regex: /console\.log\(\s*['"`]([^'"]*)['"`],\s*(.+)\s*\)/g,
    replacement: (_match: string, message: string, data: string) => {
      return `logger.info('${escapeSingleQuotes(message)}', { data: ${data} })`;
    },
  },
  // Pattern: console.log('message')
  {
    name: 'log-simple',
    regex: /console\.log\(\s*['"`]([^'"]*)['"`]\s*\)/g,
    replacement: (_match: string, message: string) => {
      return `logger.info('${escapeSingleQuotes(message)}')`;
    },
  },
  // Pattern: console.log(`[Service] message ${var}`)
  {
    name: 'log-template-literal',
    regex: /console\.log\(\s*`\[([^\]]+)\]\s+([^`]+)`\s*\)/g,
    replacement: (_match: string, _service: string, template: string) => {
      const vars = template.match(/\$\{([^}]+)\}/g) || [];
      if (vars.length === 0) {
        return `logger.info('${escapeSingleQuotes(template)}')`;
      }

      const message = template.replace(/\$\{([^}]+)\}/g, (_m: string, v: string) => `{${v}}`);
      const metadata = vars.map((v, _i) => {
        const varName = v.slice(2, -1).replace(/\..+$/, ''); // Remove property access
        return `${varName}: ${v.slice(2, -1)}`;
      }).join(', ');
      return `logger.info('${escapeSingleQuotes(message)}', { ${metadata} })`;
    },
  },
  // Pattern: console.info('message')
  {
    name: 'info-simple',
    regex: /console\.info\(\s*['"`]([^'"]*)['"`]\s*\)/g,
    replacement: (_match: string, message: string) => {
      return `logger.info('${escapeSingleQuotes(message)}')`;
    },
  },
];

// ============================================================================
// Helper Functions
// ============================================================================

function extractServiceName(filePath: string, provided?: string): string {
  if (provided) return provided;
  
  const base = basename(filePath, extname(filePath));
  // Remove suffixes like .test, .spec
  const clean = base.replace(/\.(test|spec)$/, '');
  // Convert kebab-case or snake_case to PascalCase
  return clean
    .split(/[-_]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function hasLoggerImport(content: string): boolean {
  return /import\s+.*{\s*getLogger\s*}\s+from\s+['"]@kernel\/logger['"]/.test(content);
}

function hasLoggerInstance(content: string): boolean {
  return /const\s+logger\s*=\s*getLogger\(/.test(content);
}

function findInsertionPoint(content: string): number {
  // Find last import statement
  const importRegex = /^import\s+.*?;?\s*$/gm;
  let lastMatch: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  
  while ((match = importRegex.exec(content)) !== null) {
    lastMatch = match;
  }
  
  if (lastMatch) {
    return lastMatch.index + lastMatch[0].length;
  }
  
  return 0;
}

// ============================================================================
// Migration Function
// ============================================================================

async function migrateFile(filePath: string, options: MigrationOptions): Promise<MigrationResult> {
  const result: MigrationResult = {
    file: filePath,
    success: false,
    changes: 0,
    addedImport: false,
    serviceName: '',
    errors: [],
    before: '',
    after: '',
  };
  
  try {
    const fullPath = resolve(filePath);
    if (!existsSync(fullPath)) {
      result.errors.push('File does not exist');
      return result;
    }
    
    let content = await readFile(fullPath, 'utf8');
    result.before = content;
    let modified = content;
    
    // Determine service name
    result.serviceName = extractServiceName(filePath, options.service);
    
    // Check for existing logger
    const alreadyHasLogger = hasLoggerImport(modified) && hasLoggerInstance(modified);
    
    // Apply migration patterns
    for (const pattern of MIGRATION_PATTERNS) {
      // P2-34 FIX: Reset lastIndex before .match() to avoid stale state
      // from a previous iteration or usage. RegExp objects with the /g flag
      // maintain lastIndex across calls — .match() consumes it, so a
      // subsequent .replace() could start from the wrong position.
      pattern.regex.lastIndex = 0;
      const matches = modified.match(pattern.regex);
      if (matches) {
        // P2-34 FIX: Reset lastIndex again before .replace() because
        // .match() with /g leaves lastIndex in an undefined state.
        pattern.regex.lastIndex = 0;
        // P3-2 FIX: The replacement function is now properly typed as
        // ReplacementFn via the MigrationPattern interface, eliminating
        // the need for the previous `as any` cast.
        modified = modified.replace(pattern.regex, pattern.replacement);
        result.changes += matches.length;
      }
    }
    
    // Add logger import and instance if needed
    if (result.changes > 0 && !alreadyHasLogger) {
      // Add import
      if (!hasLoggerImport(modified)) {
        const insertPoint = findInsertionPoint(modified);
        const before = modified.slice(0, insertPoint);
        const after = modified.slice(insertPoint);
        modified = before + '\n' + LOGGER_IMPORT + after;
        result.addedImport = true;
      }
      
      // Add logger instance after imports
      if (!hasLoggerInstance(modified)) {
        const importEnd = modified.lastIndexOf('import');
        const lineEnd = modified.indexOf('\n', importEnd);
        const afterImports = lineEnd > 0 ? lineEnd + 1 : 0;
        const before = modified.slice(0, afterImports);
        const after = modified.slice(afterImports);
        const loggerInstance = `\nconst logger = getLogger('${result.serviceName}');\n`;
        modified = before + loggerInstance + after;
      }
    }
    
    result.after = modified;
    
    // Write file if not dry run
    if (!options.dryRun && modified !== content) {
      await writeFile(fullPath, modified, 'utf8');
    }
    
    result.success = true;
    
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : 'Unknown error');
  }
  
  return result;
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(): MigrationOptions {
  const args = argv.slice(2);
  const options: MigrationOptions = {
    dryRun: false,
    verbose: false,
    filePattern: '',
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg.startsWith('--service=')) {
      options.service = arg.split('=')[1];
    } else if (!arg.startsWith('--')) {
      options.filePattern = arg;
    }
  }
  
  if (!options.filePattern) {
    console.error('Usage: npx ts-node scripts/migrate-console-logs.ts [options] <file-pattern>');
    console.error('');
    console.error('Options:');
    console.error('  --dry-run         Preview changes without modifying files');
    console.error('  --verbose, -v     Show detailed output');
    console.error('  --service=<name>  Override service name for logger');
    console.error('');
    console.error('Examples:');
    console.error('  npx ts-node scripts/migrate-console-logs.ts "apps/api/src/routes/*.ts"');
    console.error('  npx ts-node scripts/migrate-console-logs.ts --dry-run "**/*.ts"');
    process.exit(1);
  }
  
  return options;
}

async function main() {
  const options = parseArgs();
  
  console.log(`🔍 Finding files matching: ${options.filePattern}`);
  if (options.dryRun) {
    console.log('📝 DRY RUN - No files will be modified');
  }
  console.log('');
  
  const files = await glob(options.filePattern, {
    ignore: ['node_modules/**', 'dist/**', '**/*.d.ts', '**/*.test.ts'],
  });
  
  console.log(`📁 Found ${files.length} files`);
  console.log('');
  
  const results: MigrationResult[] = [];
  const startTime = Date.now();
  
  for (const file of files) {
    if (options.verbose) {
      process.stdout.write(`Processing ${file}... `);
    }
    
    const result = await migrateFile(file, options);
    results.push(result);
    
    if (options.verbose) {
      if (result.success) {
        console.log(`${result.changes} changes${result.errors.length > 0 ? ' (with errors)' : ''}`);
      } else {
        console.log(`ERROR: ${result.errors.join(', ')}`);
      }
    }
  }
  
  const duration = Date.now() - startTime;
  
  // Summary
  console.log('');
  console.log('='.repeat(60));
  console.log('📊 MIGRATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total files processed: ${results.length}`);
  console.log(`Files modified: ${results.filter(r => r.changes > 0).length}`);
  console.log(`Total console.log replacements: ${results.reduce((sum, r) => sum + r.changes, 0)}`);
  console.log(`Files with errors: ${results.filter(r => r.errors.length > 0).length}`);
  console.log(`Duration: ${duration}ms`);
  console.log('');
  
  // List files with changes
  const filesWithChanges = results.filter(r => r.changes > 0);
  if (filesWithChanges.length > 0) {
    console.log('📝 Files with changes:');
    for (const result of filesWithChanges) {
      const action = options.dryRun ? 'Would modify' : 'Modified';
      console.log(`  ${action} ${result.file} (${result.changes} changes, service: ${result.serviceName})`);
    }
    console.log('');
  }
  
  // List errors
  const filesWithErrors = results.filter(r => r.errors.length > 0);
  if (filesWithErrors.length > 0) {
    console.log('❌ Files with errors:');
    for (const result of filesWithErrors) {
      console.log(`  ${result.file}:`);
      result.errors.forEach(e => console.log(`    - ${e}`));
    }
    console.log('');
  }
  
  // Sample diff (first file with changes)
  if (options.dryRun && filesWithChanges.length > 0) {
    const sample = filesWithChanges[0];
    console.log('🔍 Sample diff (first changed file):');
    console.log(`File: ${sample.file}`);
    console.log('--- BEFORE ---');
    console.log(sample.before.slice(0, 500) + '...');
    console.log('--- AFTER ---');
    console.log(sample.after.slice(0, 500) + '...');
    console.log('');
  }
  
  // Next steps
  console.log('='.repeat(60));
  console.log('🚀 NEXT STEPS');
  console.log('='.repeat(60));
  if (options.dryRun) {
    console.log('1. Review the changes above');
    console.log('2. Run without --dry-run to apply changes:');
    console.log(`   npx ts-node scripts/migrate-console-logs.ts "${options.filePattern}"`);
  }
  console.log('3. Run ESLint to check for remaining console statements:');
  console.log('   npm run lint');
  console.log('4. Run tests to verify:');
  console.log('   npm test');
  console.log('5. Review migrated files for:');
  console.log('   - Correct service names');
  console.log('   - Proper metadata objects');
  console.log('   - No sensitive data in logs');
  console.log('');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

# Quick Start: Fix All Issues

Follow these steps to fix the workspace issues and get the project running.

---

## Step 1: Choose Your Package Manager

### Option A: Use pnpm (Recommended - Fastest)

```bash
# Install pnpm
npm install -g pnpm

# Install dependencies
pnpm install

# Run type check
pnpm run type-check
```

### Option B: Upgrade npm

```bash
# Check version
npm --version

# Upgrade to v9
npm install -g npm@9

# Install dependencies
npm install

# Run type check
npm run type-check
```

### Option C: Fix workspace:* protocol (npm 6 compatible)

```bash
# Run the fix script
node fix-workspace-protocol.js

# Clean install
rm -rf node_modules package-lock.json
npm install

# Run type check
npm run type-check
```

---

## Step 2: Fix Remaining TypeScript Errors

### Fix 1: Module Path Aliases

Update `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@kernel/*": ["./packages/kernel/*"],
      "@kernel/logger": ["./packages/kernel/logger.ts"],
      "@config/*": ["./packages/config/*"],
      "@database": ["./packages/database/index.ts"],
      "@database/*": ["./packages/database/*"],
      "@utils/*": ["./packages/utils/*"],
      "@types/*": ["./packages/types/*"],
      "@errors": ["./packages/errors/index.ts"],
      "@security/*": ["./packages/security/*"],
      "@monitoring/*": ["./packages/monitoring/*"],
      "@cache/*": ["./packages/cache/*"],
      "@shutdown": ["./packages/shutdown/index.ts"]
    }
  }
}
```

### Fix 2: Error Type Issues

For files with `Error & { event?: string }` errors, create a utility type:

```typescript
// packages/errors/index.ts
export class AppError extends Error {
  constructor(
    message: string,
    public code?: string,
    public event?: string,
    public metadata?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }
}
```

Then update files:

```typescript
// BEFORE:
const error = new Error('message') as Error & { event?: string };
error.event = 'value';

// AFTER:
import { AppError } from '@errors';
const error = new AppError('message', undefined, 'value');
```

### Fix 3: Install Missing Dependencies

```bash
# Install AWS SDK
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner

# Install other missing deps
npm install async-mutex
```

---

## Step 3: Run Tests

```bash
# Run all tests
npm run test:unit

# Run specific tests
npm run test:unit -- --testPathPattern=csrf
npm run test:unit -- --testPathPattern=security

# Run integration tests
npm run test:integration
```

---

## Step 4: Verify Security Fixes

```bash
# Run security lint
npm run lint:security

# Run type check
npm run type-check

# Run all lints
npm run lint
```

---

## Complete Fix Script

Save as `complete-fix.sh` (Linux/Mac) or `complete-fix.bat` (Windows):

### Linux/Mac (complete-fix.sh)

```bash
#!/bin/bash
set -e

echo "🔧 Fixing workspace protocol..."
node fix-workspace-protocol.js

echo "📦 Installing dependencies..."
rm -rf node_modules package-lock.json
npm install

echo "📦 Installing missing AWS SDK..."
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner --save
npm install async-mutex --save

echo "🔍 Running type check..."
npm run type-check || true

echo "✅ Done! Review any remaining errors above."
```

### Windows (complete-fix.bat)

```batch
@echo off
echo Fixing workspace protocol...
node fix-workspace-protocol.js

echo Installing dependencies...
rd /s /q node_modules 2>nul
del package-lock.json 2>nul
npm install

echo Installing missing AWS SDK...
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner --save
npm install async-mutex --save

echo Running type check...
npm run type-check

echo Done! Review any remaining errors above.
pause
```

---

## Troubleshooting

### "Cannot find module" errors

1. Check `tsconfig.json` has correct paths
2. Ensure files exist at the specified locations
3. Try restarting TypeScript language server in IDE

### "workspace:* still present" errors

1. Run `node fix-workspace-protocol.js` again
2. Check that all `packages/*/package.json` files were updated
3. Clear npm cache: `npm cache clean --force`

### Test failures

1. Ensure all dependencies installed
2. Check that test database is running
3. Verify environment variables are set

---

## Expected Results

After running the fixes:

| Check | Expected |
|-------|----------|
| `npm install` | Success ✅ |
| `npm run type-check` | 0-5 minor errors (not critical) |
| `npm run test:unit` | 100+ tests passing |
| Security fixes | All applied ✅ |

---

## Next Steps

1. **Review security fixes** - Check `SECURITY_FIXES_COMPLETE_SUMMARY.md`
2. **Run security tests** - `npm run test:unit -- --testPathPattern=security`
3. **Deploy to staging** - Test in production-like environment
4. **Security review** - Have security team review changes

---

## Need Help?

1. Check `WORKSPACE_FIX_GUIDE.md` for detailed workspace troubleshooting
2. Review `VERIFICATION_STATUS.md` for fix status
3. Check individual fix documentation in `docs/` folder

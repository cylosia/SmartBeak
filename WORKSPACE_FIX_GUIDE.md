# NPM Workspace Fix Guide

**Error:** `npm error Unsupported URL Type "workspace:": workspace:*`

---

## 🔍 Root Cause

The project uses npm workspaces with `workspace:*` protocol in `packages/*/package.json` files. This requires:
- **npm v7+** (workspaces support added in npm 7)
- Proper `workspaces` configuration in root `package.json`
- Correct dependency linking

---

## ✅ Solution 1: Upgrade npm (Recommended)

```bash
# Check current npm version
npm --version

# If < 7.0.0, upgrade npm
npm install -g npm@latest

# Verify upgrade
npm --version  # Should be 7.x.x or higher

# Now install works
npm install
```

**Requirements:**
- npm >= 7.0.0
- Node.js >= 14.0.0

---

## ✅ Solution 2: Use pnpm (Best for Monorepos)

pnpm has better workspace support and is faster:

```bash
# Install pnpm
npm install -g pnpm

# Install dependencies
pnpm install

# Run scripts
pnpm run type-check
pnpm run test:unit
```

**Benefits:**
- Better workspace support
- Faster installs
- Disk space efficient
- Built-in monorepo features

---

## ✅ Solution 3: Use Yarn (Alternative)

```bash
# Install Yarn
npm install -g yarn

# Install dependencies
yarn install

# Run scripts
yarn type-check
yarn test:unit
```

---

## ✅ Solution 4: Remove workspace: Protocol (Quick Fix)

If you can't upgrade npm, replace `workspace:*` with relative paths:

### Step 1: Update Root package.json

```json
{
  "name": "acp",
  "private": true,
  "workspaces": [
    "packages/*",
    "apps/*"
  ]
}
```

### Step 2: Replace in Package Files

For each `packages/*/package.json`, change:

```json
// BEFORE:
{
  "dependencies": {
    "@config/index": "workspace:*",
    "@kernel/logger": "workspace:*"
  }
}

// AFTER:
{
  "dependencies": {
    "@config/index": "file:../config",
    "@kernel/logger": "file:../kernel"
  }
}
```

### Step 3: Reinstall

```bash
rm -rf node_modules package-lock.json
npm install
```

---

## 🔧 Quick Fix Script

Create `fix-workspace.js`:

```javascript
const fs = require('fs');
const path = require('path');

const packagesDir = './packages';
const packages = fs.readdirSync(packagesDir).filter(p => 
  fs.statSync(path.join(packagesDir, p)).isDirectory()
);

// Map package names to relative paths
const packageMap = {};
for (const pkg of packages) {
  const pkgJson = JSON.parse(fs.readFileSync(
    path.join(packagesDir, pkg, 'package.json'), 'utf8'
  ));
  packageMap[pkgJson.name] = `file:../${pkg}`;
  // Also map @scope/name patterns
  if (pkgJson.name.startsWith('@')) {
    const shortName = pkgJson.name.split('/')[1];
    packageMap[`@${pkgJson.name.split('/')[0]}/${shortName}`] = `file:../${pkg}`;
  }
}

// Update each package.json
for (const pkg of packages) {
  const pkgPath = path.join(packagesDir, pkg, 'package.json');
  const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  
  let modified = false;
  
  // Update dependencies
  if (pkgJson.dependencies) {
    for (const [dep, version] of Object.entries(pkgJson.dependencies)) {
      if (version === 'workspace:*' && packageMap[dep]) {
        pkgJson.dependencies[dep] = packageMap[dep];
        modified = true;
      }
    }
  }
  
  // Update devDependencies
  if (pkgJson.devDependencies) {
    for (const [dep, version] of Object.entries(pkgJson.devDependencies)) {
      if (version === 'workspace:*' && packageMap[dep]) {
        pkgJson.devDependencies[dep] = packageMap[dep];
        modified = true;
      }
    }
  }
  
  if (modified) {
    fs.writeFileSync(pkgPath, JSON.stringify(pkgJson, null, 2) + '\n');
    console.log(`Updated ${pkgPath}`);
  }
}

console.log('Done! Run npm install');
```

Run:
```bash
node fix-workspace.js
npm install
```

---

## 📊 Package Manager Comparison

| Feature | npm 6 | npm 7+ | pnpm | Yarn |
|---------|-------|--------|------|------|
| Workspaces | ❌ | ✅ | ✅ | ✅ |
| workspace:* | ❌ | ✅ | ✅ | ✅ |
| Speed | Slow | Medium | Fast | Fast |
| Disk Usage | High | High | Low | Medium |
| Monorepo Features | Basic | Good | Excellent | Good |

---

## 🎯 Recommended Approach

### For Development (Quick Start)

```bash
# Install pnpm
npm install -g pnpm

# Install dependencies
pnpm install

# Run type check
pnpm run type-check

# Run tests
pnpm run test:unit
```

### For CI/CD

```bash
# Use npm 7+
npm install -g npm@9

# Install dependencies
npm ci

# Run checks
npm run type-check
npm run test:unit
```

---

## ⚠️ Common Issues

### Issue 1: "Cannot find module '@kernel/logger'"

**Fix:** Update tsconfig.json paths:

```json
{
  "compilerOptions": {
    "paths": {
      "@kernel/*": ["./packages/kernel/*"],
      "@kernel/logger": ["./packages/kernel/logger.ts"],
      "@config/*": ["./packages/config/*"],
      "@database": ["./packages/database/index.ts"]
    }
  }
}
```

### Issue 2: "Module not found" in tests

**Fix:** Use jest moduleNameMapper:

```javascript
// jest.config.js
module.exports = {
  moduleNameMapper: {
    '^@kernel/(.*)$': '<rootDir>/packages/kernel/$1',
    '^@config/(.*)$': '<rootDir>/packages/config/$1',
  }
};
```

### Issue 3: "workspace:* not supported"

**Fix:** Upgrade npm or use pnpm/yarn.

---

## ✅ Verification

After fixing:

```bash
# Should succeed
npm install

# Or with pnpm
pnpm install

# Then run type check
npm run type-check
```

---

## 📚 Resources

- [npm Workspaces Documentation](https://docs.npmjs.com/cli/v7/using-npm/workspaces)
- [pnpm Workspaces](https://pnpm.io/workspaces)
- [Yarn Workspaces](https://classic.yarnpkg.com/en/docs/workspaces/)

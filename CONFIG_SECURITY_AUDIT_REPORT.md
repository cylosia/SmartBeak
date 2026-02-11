# FRESH HOSTILE CONFIGURATION AUDIT REPORT
## SmartBeak Project - TypeScript & Configuration Security Audit
**Date:** 2026-02-10
**Auditor:** Automated Security Scan
**Scope:** ALL TypeScript configs, package manifests, environment files, CI/CD, and security settings

---

## EXECUTIVE SUMMARY

| Severity | Count | Status |
|----------|-------|--------|
| 🔴 CRITICAL | 1 | 1 UNFIXED |
| 🟡 HIGH | 3 | 3 UNFIXED |
| 🟢 MEDIUM | 4 | 4 UNFIXED |
| ⚪ LOW | 3 | 3 UNFIXED |

**Overall Security Posture:** WEAK - Critical secrets committed to repository

---

## CRITICAL FINDINGS

### 🔴 CRITICAL-001: Master Encryption Key Committed to Repository
- **File:** `.master_key`
- **Severity:** CRITICAL
- **Issue:** Production encryption key committed to version control
- **Status:** UNFIXED
- **Evidence:** 
  ```
  YMAcJ6m+WXUEBFZPrdiIDzJ3Ki/C944LyFfHUrUtrz4=
  ```
- **Risk:** Complete compromise of encrypted data, token forgery, authentication bypass
- **Fix Required:**
  ```bash
  # 1. Remove from git history (immediately!)
  git filter-branch --force --index-filter "git rm --cached --ignore-unmatch .master_key" HEAD
  
  # 2. Rotate the master key immediately (all encrypted data must be re-encrypted)
  # Generate new key: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  
  # 3. Add to .gitignore (already present but file still committed)
  # Verify .master_key is in .gitignore
  
  # 4. Distribute new key through secure channel (not git)
  # Use: environment variables, HashiCorp Vault, AWS Secrets Manager, etc.
  ```

---

## HIGH SEVERITY FINDINGS

### 🟡 HIGH-001: Missing .npmrc Security Settings
- **File:** `.npmrc`
- **Severity:** HIGH
- **Issue:** Missing security-hardening npm configurations
- **Status:** UNFIXED
- **Current Content:**
  ```
  package-lock=true
  save-exact=true
  engine-strict=true
  audit=true
  fund=false
  ```
- **Missing Settings:**
  - `ignore-scripts=true` - Prevents postinstall script attacks (supply chain)
  - `save-prefix=""` - Ensures exact versions (reproducible builds)
- **Fix Required:**
  ```ini
  # Security-hardened .npmrc
  package-lock=true
  save-exact=true
  engine-strict=true
  audit=true
  fund=false
  
  # Security: Prevent postinstall script attacks
  ignore-scripts=true
  
  # Security: Exact versions only
  save-prefix=""
  
  # Security: Audit on install
  audit-level=moderate
  
  # Security: Require https for registry
  registry=https://registry.npmjs.org/
  ```

### 🟡 HIGH-002: Minimal CI/CD Security Scanning
- **File:** `.github/workflows/ci-guards.yml`
- **Severity:** HIGH
- **Issue:** CI only checks for auto-publish/auto-merge patterns; missing security scans
- **Status:** UNFIXED
- **Current Workflow:** Only greps for "autoPublish" and "autoMerge" strings
- **Missing:**
  - `npm audit` - Dependency vulnerability scanning
  - TypeScript strict type checking
  - Secret scanning (though the secret is already committed)
  - Dependency license checking
- **Fix Required:**
  ```yaml
  name: CI Guards
  
  on: [push, pull_request]
  
  permissions:
    contents: read
  
  jobs:
    security:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
          with:
            persist-credentials: false
        
        - name: Setup Node.js
          uses: actions/setup-node@v4
          with:
            node-version: '20'
            cache: 'npm'
        
        - name: Install dependencies
          run: npm ci --ignore-scripts
        
        - name: Run npm audit
          run: npm audit --audit-level=moderate
        
        - name: Type check
          run: npx tsc --noEmit
        
        - name: Block auto-publish
          run: |
            if grep -R "autoPublish" -n apps/api/src; then
              echo "Auto-publish detected" && exit 1
            fi
        
        - name: Block auto-merge experiments
          run: |
            if grep -R "autoMerge" -n apps/api/src; then
              echo "Auto-merge detected" && exit 1
            fi
        
        - name: Check for committed secrets
          run: |
            if [ -f .master_key ]; then
              echo "CRITICAL: .master_key file committed to repository!" && exit 1
            fi
  ```

### 🟡 HIGH-003: Source Maps Enabled in Base Config
- **File:** `tsconfig.base.json`
- **Severity:** HIGH
- **Issue:** sourceMap: true in base configuration may expose source code in production
- **Status:** UNFIXED
- **Current Setting:** `"sourceMap": true` (line 32)
- **Risk:** Source maps in production expose original TypeScript source code, making it easier for attackers to find vulnerabilities
- **Fix Required:**
  ```json
  {
    "compilerOptions": {
      /* Development only - DO NOT use in production */
      // "sourceMap": true,
      
      /* Production: Disable source maps */
      "sourceMap": false
    }
  }
  ```
  OR create separate configs:
  ```json
  // tsconfig.production.json
  {
    "extends": "./tsconfig.base.json",
    "compilerOptions": {
      "sourceMap": false,
      "declarationMap": false
    }
  }
  ```

---

## MEDIUM SEVERITY FINDINGS

### 🟢 MEDIUM-001: Theme Configurations Missing Security Headers
- **Files:** 
  - `themes/affiliate-comparison/next.config.js`
  - `themes/authority-site/next.config.js`
  - `themes/landing-leadgen/next.config.js`
  - `themes/local-business/next.config.js`
  - `themes/media-newsletter/next.config.js`
- **Severity:** MEDIUM
- **Issue:** Theme configurations only have reactStrictMode, missing security headers
- **Status:** UNFIXED
- **Current Config:**
  ```javascript
  module.exports = {
    reactStrictMode: true
  };
  ```
- **Fix Required:** Apply security headers from apps/web/next.config.js to all theme configs

### 🟢 MEDIUM-002: Missing engine constraints in package.json for themes
- **Files:** All theme directories
- **Severity:** MEDIUM
- **Issue:** No package.json in themes to enforce Node.js/npm versions
- **Status:** UNFIXED
- **Risk:** Themes may be built with incompatible Node.js versions causing runtime errors
- **Fix Required:** Add package.json to each theme:
  ```json
  {
    "name": "@smartbeak/theme-affiliate",
    "private": true,
    "engines": {
      "node": ">=20.0.0 <21.0.0",
      "npm": ">=10.0.0"
    },
    "engineStrict": true
  }
  ```

### 🟢 MEDIUM-003: Root tsconfig.json Disables Composite/Declaration Settings
- **File:** `tsconfig.json` (root)
- **Severity:** MEDIUM
- **Issue:** Overrides base config to disable composite and declaration settings
- **Status:** UNFIXED (but may be intentional for specific build)
- **Current Settings:**
  ```json
  {
    "compilerOptions": {
      "composite": false,
      "declaration": false,
      "declarationMap": false
    }
  }
  ```
- **Risk:** May cause incremental build issues in monorepo
- **Recommendation:** Verify this is intentional; document why if so

### 🟢 MEDIUM-004: No Explicit CSP in Theme Configs
- **Files:** All theme next.config.js files
- **Severity:** MEDIUM
- **Issue:** Content Security Policy headers not configured for themes
- **Status:** UNFIXED
- **Fix Required:** Add CSP headers similar to apps/web configuration

---

## LOW SEVERITY FINDINGS

### ⚪ LOW-001: install.sh Downloads Script Without Verification
- **File:** `install.sh`
- **Severity:** LOW
- **Issue:** Downloads and executes shell script from astral.sh without checksum verification
- **Status:** UNFIXED
- **Code:**
  ```bash
  curl -fsSL https://astral.sh/uv/install.sh | sh
  ```
- **Risk:** Supply chain attack if astral.sh is compromised
- **Fix Required:** 
  ```bash
  # Download and verify checksum (example)
  curl -fsSL https://astral.sh/uv/install.sh -o /tmp/uv-install.sh
  # Verify checksum against known good value
  echo "<expected_checksum>  /tmp/uv-install.sh" | sha256sum -c -
  sh /tmp/uv-install.sh
  rm /tmp/uv-install.sh
  ```

### ⚪ LOW-002: Missing .editorconfig
- **File:** N/A (missing)
- **Severity:** LOW
- **Issue:** No .editorconfig file for consistent coding standards
- **Status:** UNFIXED
- **Fix Required:**
  ```ini
  root = true
  
  [*]
  charset = utf-8
  end_of_line = lf
  indent_style = space
  indent_size = 2
  insert_final_newline = true
  trim_trailing_whitespace = true
  
  [*.md]
  trim_trailing_whitespace = false
  ```

### ⚪ LOW-003: Missing ESLint/Prettier Configuration
- **File:** N/A (missing at root)
- **Severity:** LOW
- **Issue:** No root ESLint or Prettier configuration for code quality enforcement
- **Status:** UNFIXED
- **Fix Required:** Add .eslintrc.js and .prettierrc.js at project root

---

## CORRECT CONFIGURATIONS (PASS)

### ✅ TypeScript Strict Settings (tsconfig.base.json)
| Setting | Status |
|---------|--------|
| strict: true | ✅ ENABLED |
| noUncheckedIndexedAccess | ✅ ENABLED |
| exactOptionalPropertyTypes | ✅ ENABLED |
| noImplicitOverride | ✅ ENABLED |
| noPropertyAccessFromIndexSignature | ✅ ENABLED |
| forceConsistentCasingInFileNames | ✅ ENABLED |
| isolatedModules | ✅ ENABLED |
| skipLibCheck | ✅ DISABLED (good!) |

### ✅ Root package.json Engine Constraints
```json
{
  "engines": {
    "node": ">=20.0.0 <21.0.0",
    "npm": ">=10.0.0"
  },
  "engineStrict": true
}
```

### ✅ apps/web/next.config.js Security Headers
- ✅ poweredByHeader: false
- ✅ reactStrictMode: true
- ✅ X-Frame-Options: DENY
- ✅ X-Content-Type-Options: nosniff
- ✅ Referrer-Policy: strict-origin-when-cross-origin
- ✅ X-XSS-Protection: 1; mode=block
- ✅ Strict-Transport-Security with preload
- ✅ Content-Security-Policy configured
- ✅ Permissions-Policy configured

### ✅ CI/CD Version
- ✅ Uses actions/checkout@v4 (current, not outdated)

### ✅ .gitignore Configuration
- ✅ .master_key listed (though file is still committed)
- ✅ .env files ignored
- ✅ node_modules ignored
- ✅ dist/build ignored

---

## IMMEDIATE ACTION ITEMS (Priority Order)

### 1. CRITICAL - Rotate Master Key (Do First!)
```bash
# Generate new master key
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Remove .master_key from git history
git filter-branch --force --index-filter "git rm --cached --ignore-unmatch .master_key" HEAD

# Force push (coordinate with team)
git push origin --force --all

# Distribute new key via secure channel
```

### 2. HIGH - Update .npmrc
Add to `.npmrc`:
```ini
ignore-scripts=true
save-prefix=""
audit-level=moderate
registry=https://registry.npmjs.org/
```

### 3. HIGH - Disable Source Maps for Production
Update `tsconfig.base.json` or create separate production config

### 4. HIGH - Enhance CI/CD
Add security scanning to `.github/workflows/ci-guards.yml`

### 5. MEDIUM - Update Theme Configs
Apply security headers from apps/web to all theme configs

---

## AUDIT METHODOLOGY

This audit checked for:
1. ✅ TypeScript strict mode and all strict options
2. ✅ noUncheckedIndexedAccess enabled
3. ✅ exactOptionalPropertyTypes enabled
4. ✅ Committed secrets (.master_key, .env) - **FOUND CRITICAL ISSUE**
5. ✅ Dev dependencies in production - **PASS**
6. ✅ Missing engine constraints - **PASS** (root only)
7. ✅ skipLibCheck: true - **PASS** (correctly set to false)
8. ✅ Missing .npmrc security settings - **FOUND ISSUE**
9. ✅ Outdated actions in CI/CD - **PASS**
10. ✅ Source maps in production - **FOUND ISSUE**

---

## FILES AUDITED

| File | Status |
|------|--------|
| tsconfig.json (root) | ✅ Reviewed |
| tsconfig.base.json | ✅ Reviewed |
| packages/*/tsconfig.json (14 files) | ✅ Reviewed |
| package.json (root) | ✅ Reviewed |
| packages/shutdown/package.json | ✅ Reviewed |
| .master_key | 🔴 CRITICAL ISSUE |
| .env.example | ✅ Reviewed (safe) |
| .npmrc | 🟡 Missing settings |
| .github/workflows/ci-guards.yml | 🟡 Needs enhancement |
| apps/web/next.config.js | ✅ Secure |
| themes/*/next.config.js (5 files) | 🟢 Missing headers |
| install.sh | ⚪ Low risk |
| .gitignore | ✅ Correct |

---

**END OF AUDIT REPORT**

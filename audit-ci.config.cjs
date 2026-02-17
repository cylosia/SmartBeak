'use strict';

module.exports = {
  moderate: true,
  allowlist: [
    // ajv vulnerability via eslint > @eslint/eslintrc > ajv (dev tooling only).
    // fixAvailable: false — no patched ajv v6 exists; ESLint 8.x unconditionally
    // requires ajv v6 for config schema validation. The risk is negligible: the
    // vulnerable code path is only exercised when ESLint parses .eslintrc files
    // written by developers, not by external/untrusted input at runtime.
    // Upgrading to ESLint v9 (flat config) would remove this dependency but is a
    // separate, unrelated major change outside the scope of this PR.
    'GHSA-2g4f-4pwh-qvx6',
  ],
};

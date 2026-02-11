/**
 * Bundle Analysis Utilities
 * 
 * P2 OPTIMIZATION: Provides bundle size analysis and optimization:
 * - Size tracking
 * - Import analysis
 * - Duplication detection
 * - Optimization recommendations
 */

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface BundleSize {
  name: string;
  size: number;
  gzipSize: number;
  parsedSize: number;
}

export interface ImportAnalysis {
  module: string;
  imports: string[];
  importType: 'default' | 'named' | 'namespace' | 'side-effect';
  line: number;
}

export interface DuplicationReport {
  module: string;
  locations: string[];
  totalSize: number;
  suggestion: string;
}

export interface BundleReport {
  totalSize: number;
  gzipSize: number;
  chunks: BundleSize[];
  largestModules: BundleSize[];
  duplications: DuplicationReport[];
  recommendations: string[];
}

// ============================================================================
// Bundle Size Limits
// ============================================================================

export const BUNDLE_SIZE_LIMITS = {
  /** Maximum initial JS size (KB) */
  INITIAL_JS: 200,
  /** Maximum initial CSS size (KB) */
  INITIAL_CSS: 50,
  /** Maximum chunk size (KB) */
  CHUNK: 500,
  /** Maximum image size (KB) */
  IMAGE: 100,
  /** Warning threshold (KB) */
  WARNING: 150,
  /** Error threshold (KB) */
  ERROR: 250,
} as const;

// ============================================================================
// Import Analysis
// ============================================================================

export class ImportAnalyzer {
  /**
   * Analyze imports in code
   */
  analyzeImports(code: string, filename: string): ImportAnalysis[] {
    const imports: ImportAnalysis[] = [];
    const lines = code.split('\n');

    lines.forEach((line, index) => {
      const importMatch = this.parseImport(line);
      if (importMatch) {
        imports.push({
          ...importMatch,
          line: index + 1,
        });
      }
    });

    return imports;
  }

  private parseImport(line: string): Omit<ImportAnalysis, 'line'> | null {
    // Match default import: import React from 'react'
    const defaultMatch = line.match(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
    if (defaultMatch) {
      return {
        module: defaultMatch[2]!,
        imports: [defaultMatch[1]!],
        importType: 'default',
      };
    }

    // Match named imports: import { useState, useEffect } from 'react'
    const namedMatch = line.match(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
    if (namedMatch) {
      return {
        module: namedMatch[2]!,
        imports: namedMatch[1]!.split(',').map(s => s.trim()),
        importType: 'named',
      };
    }

    // Match namespace import: import * as React from 'react'
    const namespaceMatch = line.match(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
    if (namespaceMatch) {
      return {
        module: namespaceMatch[2]!,
        imports: [namespaceMatch[1]!],
        importType: 'namespace',
      };
    }

    // Match side-effect import: import 'some-module'
    const sideEffectMatch = line.match(/import\s+['"]([^'"]+)['"]/);
    if (sideEffectMatch) {
      return {
        module: sideEffectMatch[1]!,
        imports: [],
        importType: 'side-effect',
      };
    }

    return null;
  }

  /**
   * Detect suboptimal imports
   */
  detectSuboptimalImports(imports: ImportAnalysis[]): string[] {
    const issues: string[] = [];
    const moduleImports = new Map<string, ImportAnalysis[]>();

    // Group imports by module
    imports.forEach(imp => {
      const existing = moduleImports.get(imp.module) || [];
      existing.push(imp);
      moduleImports.set(imp.module, existing);
    });

    // Check for issues
    for (const [module, moduleImportsList] of moduleImports) {
      // Multiple import statements for same module
      if (moduleImportsList.length > 1) {
        issues.push(`Multiple imports from '${module}' - combine into single import statement`);
      }

      // Check for potential tree-shaking issues
      moduleImportsList.forEach(imp => {
        if (imp.importType === 'namespace') {
          issues.push(`Namespace import from '${module}' may prevent tree-shaking`);
        }
      });
    }

    return issues;
  }
}

// ============================================================================
// Bundle Size Analysis
// ============================================================================

export class BundleAnalyzer {
  private sizes: Map<string, BundleSize> = new Map();

  /**
   * Add module size
   */
  addModule(name: string, size: number, gzipSize?: number): void {
    this.sizes.set(name, {
      name,
      size,
      gzipSize: gzipSize ?? Math.round(size * 0.3), // Estimate gzip size
      parsedSize: size,
    });
  }

  /**
   * Get total size
   */
  getTotalSize(): number {
    return Array.from(this.sizes.values()).reduce((sum, m) => sum + m.size, 0);
  }

  /**
   * Get largest modules
   */
  getLargestModules(limit = 10): BundleSize[] {
    return Array.from(this.sizes.values())
      .sort((a, b) => b.size - a.size)
      .slice(0, limit);
  }

  /**
   * Check if size is within limits
   */
  checkSizeLimits(): { withinLimits: boolean; violations: string[] } {
    const violations: string[] = [];
    let totalSize = 0;

    for (const [name, size] of this.sizes) {
      totalSize += size.size;

      if (size.size > BUNDLE_SIZE_LIMITS.CHUNK * 1024) {
        violations.push(`Module '${name}' exceeds chunk size limit (${this.formatBytes(size.size)})`);
      }
    }

    if (totalSize > BUNDLE_SIZE_LIMITS.INITIAL_JS * 1024) {
      violations.push(`Total size exceeds limit: ${this.formatBytes(totalSize)}`);
    }

    return {
      withinLimits: violations.length === 0,
      violations,
    };
  }

  /**
   * Generate bundle report
   */
  generateReport(): BundleReport {
    const modules = Array.from(this.sizes.values());
    const totalSize = this.getTotalSize();
    const gzipSize = modules.reduce((sum, m) => sum + m.gzipSize, 0);

    const limitCheck = this.checkSizeLimits();

    return {
      totalSize,
      gzipSize,
      chunks: modules,
      largestModules: this.getLargestModules(10),
      duplications: [], // Would be populated by duplication detection
      recommendations: [
        ...limitCheck.violations,
        ...this.generateOptimizationRecommendations(modules),
      ],
    };
  }

  /**
   * Generate optimization recommendations
   */
  private generateOptimizationRecommendations(modules: BundleSize[]): string[] {
    const recommendations: string[] = [];

    // Check for large dependencies
    const largeModules = modules.filter(m => m.size > 50 * 1024);
    if (largeModules.length > 0) {
      recommendations.push(
        `Consider code splitting for large modules: ${largeModules.map(m => m.name).join(', ')}`
      );
    }

    // Check total size
    const totalSize = modules.reduce((sum, m) => sum + m.size, 0);
    if (totalSize > 500 * 1024) {
      recommendations.push('Total bundle size is large - consider lazy loading more components');
    }

    return recommendations;
  }

  /**
   * Format bytes to human readable
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }
}

// ============================================================================
// Duplication Detection
// ============================================================================

export class DuplicationDetector {
  private moduleLocations = new Map<string, Set<string>>();

  /**
   * Track module usage
   */
  trackModule(module: string, location: string): void {
    const locations = this.moduleLocations.get(module) || new Set();
    locations.add(location);
    this.moduleLocations.set(module, locations);
  }

  /**
   * Detect duplications
   */
  detectDuplications(): DuplicationReport[] {
    const duplications: DuplicationReport[] = [];

    for (const [module, locations] of this.moduleLocations) {
      if (locations.size > 1) {
        // This is a simplified check - real implementation would check versions
        duplications.push({
          module,
          locations: Array.from(locations),
          totalSize: 0, // Would be calculated from actual sizes
          suggestion: `Consolidate '${module}' usage to single location`,
        });
      }
    }

    return duplications;
  }
}

// ============================================================================
// Performance Budget
// ============================================================================

export interface PerformanceBudget {
  js?: number;
  css?: number;
  images?: number;
  fonts?: number;
}

export class PerformanceBudgetChecker {
  constructor(private budget: PerformanceBudget) {}

  /**
   * Check if bundle is within budget
   */
  checkBudget(actual: PerformanceBudget): {
    withinBudget: boolean;
    overages: Array<{ type: string; budget: number; actual: number }>;
  } {
    const overages: Array<{ type: string; budget: number; actual: number }> = [];

    for (const [type, budgetValue] of Object.entries(this.budget)) {
      const actualValue = actual[type as keyof PerformanceBudget];
      if (actualValue && budgetValue && actualValue > budgetValue) {
        overages.push({
          type,
          budget: budgetValue,
          actual: actualValue,
        });
      }
    }

    return {
      withinBudget: overages.length === 0,
      overages,
    };
  }
}

// ============================================================================
// CI/CD Integration
// ============================================================================

export interface BundleSizeConfig {
  /** Maximum size increase percentage */
  maxIncreasePercent?: number;
  /** Maximum absolute size increase in bytes */
  maxIncreaseBytes?: number;
  /** Fail build on budget violation */
  failOnViolation?: boolean;
}

export class BundleSizeCI {
  constructor(private config: BundleSizeConfig = {}) {}

  /**
   * Compare bundle sizes
   */
  compareBundles(
    baseline: BundleSize[],
    current: BundleSize[]
  ): {
    changed: boolean;
    increases: Array<{ name: string; before: number; after: number; diff: number }>;
    newModules: string[];
    removedModules: string[];
  } {
    const baselineMap = new Map(baseline.map(b => [b.name, b]));
    const currentMap = new Map(current.map(c => [c.name, c]));

    const increases: Array<{ name: string; before: number; after: number; diff: number }> = [];
    const newModules: string[] = [];
    const removedModules: string[] = [];

    // Check for size increases
    for (const [name, currentSize] of currentMap) {
      const baselineSize = baselineMap.get(name);
      if (baselineSize) {
        const diff = currentSize.size - baselineSize.size;
        if (diff > 0) {
          increases.push({
            name,
            before: baselineSize.size,
            after: currentSize.size,
            diff,
          });
        }
      } else {
        newModules.push(name);
      }
    }

    // Check for removed modules
    for (const name of baselineMap.keys()) {
      if (!currentMap.has(name)) {
        removedModules.push(name);
      }
    }

    const changed = increases.length > 0 || newModules.length > 0 || removedModules.length > 0;

    return {
      changed,
      increases,
      newModules,
      removedModules,
    };
  }

  /**
   * Check if size increase is acceptable
   */
  isAcceptable(increase: number, totalSize: number): boolean {
    const { maxIncreasePercent = 5, maxIncreaseBytes = 10 * 1024 } = this.config;

    const percentIncrease = (increase / totalSize) * 100;

    if (percentIncrease > maxIncreasePercent) {
      return false;
    }

    if (increase > maxIncreaseBytes) {
      return false;
    }

    return true;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

export function formatBundleSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

export function calculateSavings(original: number, optimized: number): string {
  const savings = original - optimized;
  const percent = ((savings / original) * 100).toFixed(1);
  return `${formatBundleSize(savings)} (${percent}%)`;
}

// ============================================================================
// Predefined Budgets
// ============================================================================

export const performanceBudgets = {
  /** Conservative budget for fast loading */
  conservative: {
    js: 100 * 1024, // 100 KB
    css: 30 * 1024, // 30 KB
    images: 200 * 1024, // 200 KB
    fonts: 50 * 1024, // 50 KB
  },
  /** Balanced budget for most applications */
  balanced: {
    js: 200 * 1024, // 200 KB
    css: 50 * 1024, // 50 KB
    images: 500 * 1024, // 500 KB
    fonts: 100 * 1024, // 100 KB
  },
  /** Relaxed budget for complex applications */
  relaxed: {
    js: 500 * 1024, // 500 KB
    css: 100 * 1024, // 100 KB
    images: 1000 * 1024, // 1 MB
    fonts: 200 * 1024, // 200 KB
  },
};

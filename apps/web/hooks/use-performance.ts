/**
 * Performance Monitoring Hooks
 * 
 * P2 OPTIMIZATION: React hooks for monitoring and optimizing component performance:
 * - Render time tracking
 * - Memory usage monitoring
 * - Interaction tracking
 * - Web Vitals reporting
 */

import { useEffect, useRef, useCallback, useState } from 'react';

// ============================================================================
// Types & Interfaces
// ============================================================================

/** Network Information API - Experimental */
interface NetworkInformation {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
  type?: string;
}

export interface PerformanceMetrics {
  renderCount: number;
  averageRenderTime: number;
  lastRenderTime: number;
  totalRenderTime: number;
  memoryUsage?: number;
}

export interface WebVitalsMetrics {
  /** Largest Contentful Paint */
  lcp?: number;
  /** First Input Delay */
  fid?: number;
  /** Cumulative Layout Shift */
  cls?: number;
  /** First Contentful Paint */
  fcp?: number;
  /** Time to First Byte */
  ttfb?: number;
  /** Interaction to Next Paint */
  inp?: number;
}

export interface InteractionMetrics {
  type: 'click' | 'input' | 'scroll' | 'keypress';
  duration: number;
  target: string;
  timestamp: number;
}

// ============================================================================
// Render Performance Hook
// ============================================================================

export function useRenderPerformance(componentName: string): PerformanceMetrics {
  const renderCount = useRef(0);
  const renderStartTime = useRef<number>(0);
  const totalRenderTime = useRef(0);
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    renderCount: 0,
    averageRenderTime: 0,
    lastRenderTime: 0,
    totalRenderTime: 0,
  });

  useEffect(() => {
    renderStartTime.current = performance.now();
  });

  useEffect(() => {
    const endTime = performance.now();
    const renderTime = endTime - renderStartTime.current;
    
    renderCount.current++;
    totalRenderTime.current += renderTime;

    const newMetrics: PerformanceMetrics = {
      renderCount: renderCount.current,
      averageRenderTime: totalRenderTime.current / renderCount.current,
      lastRenderTime: renderTime,
      totalRenderTime: totalRenderTime.current,
    };

    setMetrics(newMetrics);

    // Log slow renders in development
    if (process.env.NODE_ENV === 'development' && renderTime > 16) {
      console.warn(
        `[Performance] Slow render detected in ${componentName}: ${renderTime.toFixed(2)}ms`
      );
    }

    // Report to performance monitoring service in production
    if (process.env.NODE_ENV === 'production') {
      reportRenderTime(componentName, renderTime);
    }
  });

  return metrics;
}

// ============================================================================
// Web Vitals Hook
// ============================================================================

export function useWebVitals(onReport?: (metrics: WebVitalsMetrics) => void): WebVitalsMetrics {
  const [vitals, setVitals] = useState<WebVitalsMetrics>({});

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Largest Contentful Paint
    const observeLCP = () => {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const lastEntry = entries[entries.length - 1] as PerformanceEntry & { startTime: number };
        if (lastEntry) {
          const lcp = lastEntry.startTime;
          setVitals(prev => ({ ...prev, lcp }));
          onReport?.({ ...vitals, lcp });
        }
      });
      observer.observe({ entryTypes: ['largest-contentful-paint'] });
      return () => observer.disconnect();
    };

    // First Input Delay
    const observeFID = () => {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries() as Array<PerformanceEntry & { processingStart: number; startTime: number }>;
        entries.forEach(entry => {
          const fid = entry.processingStart - entry.startTime;
          setVitals(prev => ({ ...prev, fid }));
          onReport?.({ ...vitals, fid });
        });
      });
      observer.observe({ entryTypes: ['first-input'] });
      return () => observer.disconnect();
    };

    // Cumulative Layout Shift
    const observeCLS = () => {
      let clsValue = 0;
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>;
        entries.forEach(entry => {
          if (!entry.hadRecentInput) {
            clsValue += entry.value;
          }
        });
        setVitals(prev => ({ ...prev, cls: clsValue }));
        onReport?.({ ...vitals, cls: clsValue });
      });
      observer.observe({ entryTypes: ['layout-shift'] });
      return () => observer.disconnect();
    };

    // First Contentful Paint
    const observeFCP = () => {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries() as Array<PerformanceEntry & { startTime: number }>;
        entries.forEach(entry => {
          if (entry.name === 'first-contentful-paint') {
            setVitals(prev => ({ ...prev, fcp: entry.startTime }));
            onReport?.({ ...vitals, fcp: entry.startTime });
          }
        });
      });
      observer.observe({ entryTypes: ['paint'] });
      return () => observer.disconnect();
    };

    // Time to First Byte
    const measureTTFB = () => {
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      if (navigation) {
        const ttfb = navigation.responseStart - navigation.startTime;
        setVitals(prev => ({ ...prev, ttfb }));
        onReport?.({ ...vitals, ttfb });
      }
    };

    const cleanupLCP = observeLCP();
    const cleanupFID = observeFID();
    const cleanupCLS = observeCLS();
    const cleanupFCP = observeFCP();
    measureTTFB();

    return () => {
      cleanupLCP();
      cleanupFID();
      cleanupCLS();
      cleanupFCP();
    };
  }, [onReport]);

  return vitals;
}

// ============================================================================
// Interaction Tracking Hook
// ============================================================================

export function useInteractionTracking(
  onInteraction?: (metrics: InteractionMetrics) => void
): {
  trackInteraction: (type: InteractionMetrics['type']) => (event: React.SyntheticEvent) => void;
  interactions: InteractionMetrics[];
} {
  const [interactions, setInteractions] = useState<InteractionMetrics[]>([]);
  const interactionStartTime = useRef<Map<string, number>>(new Map());

  const trackInteraction = useCallback(
    (type: InteractionMetrics['type']) => (event: React.SyntheticEvent) => {
      const target = event.target as HTMLElement;
      const targetName = target.tagName + (target.id ? `#${target.id}` : '');
      const key = `${type}-${targetName}`;

      const startTime = interactionStartTime.current.get(key) || performance.now();
      const duration = performance.now() - startTime;

      const metrics: InteractionMetrics = {
        type,
        duration,
        target: targetName,
        timestamp: Date.now(),
      };

      setInteractions(prev => [...prev.slice(-99), metrics]);
      onInteraction?.(metrics);

      // Reset start time
      interactionStartTime.current.delete(key);

      // Log slow interactions
      if (process.env.NODE_ENV === 'development' && duration > 100) {
        console.warn(`[Performance] Slow ${type} interaction: ${duration.toFixed(2)}ms`);
      }
    },
    [onInteraction]
  );

  const _startTracking = useCallback(
    (type: InteractionMetrics['type']) => (event: React.SyntheticEvent) => {
      const target = event.target as HTMLElement;
      const targetName = target.tagName + (target.id ? `#${target.id}` : '');
      const key = `${type}-${targetName}`;
      interactionStartTime.current.set(key, performance.now());
    },
    []
  );

  return { trackInteraction, interactions };
}

// ============================================================================
// Memory Usage Hook
// ============================================================================

export function useMemoryUsage(pollInterval = 5000): number | undefined {
  const [memoryUsage, setMemoryUsage] = useState<number | undefined>();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('memory' in performance)) return;

    const measureMemory = () => {
      const memory = (performance as unknown as { memory: { usedJSHeapSize: number } }).memory;
      if (memory) {
        setMemoryUsage(memory.usedJSHeapSize);
      }
    };

    measureMemory();
    const interval = setInterval(measureMemory, pollInterval);

    return () => clearInterval(interval);
  }, [pollInterval]);

  return memoryUsage;
}

// ============================================================================
// Visibility Change Hook (for pausing expensive operations)
// ============================================================================

export function useVisibilityChange(
  onVisibilityChange?: (isVisible: boolean) => void
): boolean {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const visible = document.visibilityState === 'visible';
      setIsVisible(visible);
      onVisibilityChange?.(visible);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [onVisibilityChange]);

  return isVisible;
}

// ============================================================================
// Network Status Hook
// ============================================================================

export function useNetworkStatus(): {
  isOnline: boolean;
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
} {
  const [status, setStatus] = useState({
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => setStatus(prev => ({ ...prev, isOnline: true }));
    const handleOffline = () => setStatus(prev => ({ ...prev, isOnline: false }));

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Get connection info if available
    const connection = (navigator as unknown as { connection?: NetworkInformation }).connection;
    if (connection) {
      setStatus(prev => ({
        ...prev,
        effectiveType: connection.effectiveType,
        downlink: connection.downlink,
        rtt: connection.rtt,
      }));
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return status;
}

// ============================================================================
// Utility Functions
// ============================================================================

function reportRenderTime(componentName: string, duration: number): void {
  // Send to analytics or monitoring service
  if (typeof window !== 'undefined' && 'gtag' in window) {
    (window as unknown as { gtag: (event: string, name: string, params: object) => void }).gtag(
      'event',
      'render_performance',
      {
        event_category: 'Performance',
        event_label: componentName,
        value: Math.round(duration),
      }
    );
  }

  // Send to custom endpoint
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    navigator.sendBeacon(
      '/api/performance/render',
      JSON.stringify({ componentName, duration, timestamp: Date.now() })
    );
  }
}

// ============================================================================
// Performance Budget Hook
// ============================================================================

export function usePerformanceBudget(budgets: {
  renderTime?: number;
  bundleSize?: number;
}): {
  isWithinBudget: boolean;
  violations: string[];
} {
  const metrics = useRenderPerformance('budget-check');
  const [violations, setViolations] = useState<string[]>([]);

  useEffect(() => {
    const newViolations: string[] = [];

    if (budgets.renderTime && metrics.averageRenderTime > budgets.renderTime) {
      newViolations.push(
        `Average render time (${metrics.averageRenderTime.toFixed(2)}ms) exceeds budget (${budgets.renderTime}ms)`
      );
    }

    setViolations(newViolations);
  }, [metrics, budgets]);

  return {
    isWithinBudget: violations.length === 0,
    violations,
  };
}

// ============================================================================
// Resource Preloading Hook
// ============================================================================

export function useResourcePreload(): {
  preloadImage: (src: string) => void;
  preloadFont: (url: string, type?: string) => void;
  prefetchRoute: (route: string) => void;
} {
  const preloadImage = useCallback((src: string) => {
    if (typeof window === 'undefined') return;

    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = src;
    document.head.appendChild(link);
  }, []);

  const preloadFont = useCallback((url: string, type = 'font/woff2') => {
    if (typeof window === 'undefined') return;

    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'font';
    link.href = url;
    link.type = type;
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  }, []);

  const prefetchRoute = useCallback((route: string) => {
    if (typeof window === 'undefined') return;

    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = route;
    document.head.appendChild(link);
  }, []);

  return { preloadImage, preloadFont, prefetchRoute };
}

// ============================================================================
// Export all hooks
// ============================================================================

export const performanceHooks = {
  useRenderPerformance,
  useWebVitals,
  useInteractionTracking,
  useMemoryUsage,
  useVisibilityChange,
  useNetworkStatus,
  usePerformanceBudget,
  useResourcePreload,
};

export default performanceHooks;

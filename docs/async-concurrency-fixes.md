# P1 Async/Concurrency Fixes Documentation

## Overview

This document describes the P1 (Priority 1) async/concurrency fixes applied to the SmartBeak codebase. These fixes address race conditions, unhandled promise rejections, and signal propagation issues that could cause instability in production.

## Fixed Issues

### 1. Unhandled Promise Rejection in Worker

**File**: `apps/api/src/jobs/worker.ts:50`

**Problem**: The unhandled promise rejection handler logged the error but did not exit the process, leaving the worker in an undefined state.

**Fix**: Added `process.exit(1)` after logging to ensure the worker terminates when an unhandled rejection occurs.

```typescript
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', reason instanceof Error ? reason : new Error(String(reason)));
  // P1-FIX: Exit process after logging to prevent undefined state
  process.exit(1);
});
```

**Impact**: Prevents zombie worker processes and ensures proper process management in production.

---

### 2. Circuit Breaker State Read Race

**File**: `apps/api/src/utils/resilience.ts:152-158`

**Problem**: The `getState()` method accessed mutable state variables (`this.open`, `this.failures`) without mutex protection, leading to potential race conditions where concurrent reads could observe inconsistent state during transitions.

**Fix**: Converted `getState()` to an async method that acquires the mutex lock before reading state:

```typescript
async getState(): Promise<'closed' | 'open' | 'half-open'> {
  return this.stateLock.runExclusive(() => {
    if (this.open)
      return 'open';
    if (this.failures > 0)
      return 'half-open';
    return 'closed';
  });
}
```

**Impact**: Ensures thread-safe state reads and prevents race conditions between state transitions and state queries.

---

### 3. Worker Error Event Not Handled

**File**: `apps/api/src/jobs/JobScheduler.ts:330-389`

**Problem**: The Worker instances created by BullMQ could emit `error` events (for connection issues, etc.) that were not being handled, potentially causing unhandled promise rejections.

**Fix**: 
1. Added `error` event handler to `WorkerEventHandlers` type
2. Implemented error handler in `attachWorkerHandlers()` that emits a `workerError` event
3. Added cleanup for error handler in `stop()` method

```typescript
export type WorkerEventHandlers = {
  completed: (job: Job) => void;
  failed: (job: Job | undefined, error: Error) => void;
  error: (error: Error) => void;  // P1-FIX: Added error handler
};

// In attachWorkerHandlers:
const errorHandler = (err: Error) => {
  logger.error(`Worker error in queue ${queueName}`, err);
  this.emit('workerError', queueName, err);
};
worker.on('error', errorHandler);
```

**Impact**: Proper handling of worker-level errors and prevention of unhandled promise rejections.

---

### 4. Transaction Timeout Race Condition

**File**: `packages/database/transactions/index.ts:81-99`

**Problem**: The `AbortController` was created but not linked to the timeout cleanup, and the timeout could fire after the transaction completed successfully.

**Fix**: Linked abortController to timeout and restructured to ensure proper cleanup:

```typescript
const abortController = new AbortController();

// P1-FIX: Link abortController to timeout cleanup
const timeoutPromise = new Promise<never>((_, reject) => {
  timeoutId = setTimeout(() => {
    if (!abortController.signal.aborted) {
      abortController.abort();
      reject(new Error(`Transaction timeout after ${timeoutMs}ms`));
    }
  }, timeoutMs);
});
```

**Impact**: Prevents race conditions between transaction completion and timeout firing.

---

### 5. Transaction Timeout Not Cleared

**File**: `packages/database/transactions/index.ts:91-99`

**Problem**: The timeout cleanup was not guaranteed in all code paths, potentially leaving dangling timeouts.

**Fix**: Added `finally` block to ensure timeout is always cleared and abortController is aborted:

```typescript
let result: T;
try {
  result = await Promise.race([
    fn(client),
    timeoutPromise,
  ]);

  await client.query('COMMIT');
  return result;
} finally {
  // P1-FIX: Always clear timeout and abort in finally block
  clearTimeoutSafe();
  abortController.abort();
}
```

**Impact**: Prevents memory leaks from uncleared timeouts and ensures proper resource cleanup.

---

### 6. Missing AbortSignal Propagation

**File**: `apps/api/src/jobs/JobScheduler.ts:391-443`

**Problem**: The job handlers were not receiving the `AbortSignal`, meaning jobs could not be properly cancelled when the scheduler was stopped or when a job timeout occurred.

**Fix**: 
1. Create AbortController for each job
2. Pass signal to `executeWithTimeout`
3. Clean up abort controller in finally block

```typescript
// P1-FIX: Create AbortController for this job and pass signal to handler
const abortController = new AbortController();
this.abortControllers.set(job.id || `job-${Date.now()}`, abortController);

return runWithContext(requestContext, async () => {
  try {
    // P1-FIX: Invoke handler with abort signal for cancellation support
    const result = await this.executeWithTimeout(
      handler(job.data, job),
      config.timeout || jobConfig.defaultTimeoutMs,
      abortController.signal
    );
    this.emit('jobCompleted', job, result);
    return result;
  } catch (error) {
    this.emit('jobFailed', job, error);
    throw error;
  } finally {
    // P1-FIX: Clean up abort controller
    this.abortControllers.delete(job.id || '');
  }
});
```

**Impact**: Enables proper job cancellation and timeout handling.

---

## Test Coverage

### Created Test Files

1. **`apps/api/src/jobs/__tests__/worker.concurrency.test.ts`**
   - Tests unhandled promise rejection handling
   - Verifies process exit on critical errors
   - Tests signal handling (SIGTERM, SIGINT)

2. **`apps/api/src/utils/__tests__/resilience.concurrency.test.ts`**
   - Tests mutex protection for state reads
   - Verifies race condition prevention
   - Tests thread-safe state transitions

3. **`apps/api/src/jobs/__tests__/JobScheduler.concurrency.test.ts`**
   - Tests worker error event handling
   - Verifies AbortSignal propagation
   - Tests race condition prevention
   - Tests timeout and cancellation behavior

4. **`packages/database/__tests__/transactions.concurrency.test.ts`**
   - Tests transaction timeout race conditions
   - Verifies AbortController linked to timeout cleanup
   - Tests proper timeout cleanup in all paths
   - Tests concurrent transaction handling

### Running the Tests

```bash
# Run all async/concurrency tests
npm test -- apps/api/src/jobs/__tests__/worker.concurrency.test.ts
npm test -- apps/api/src/utils/__tests__/resilience.concurrency.test.ts
npm test -- apps/api/src/jobs/__tests__/JobScheduler.concurrency.test.ts
npm test -- packages/database/__tests__/transactions.concurrency.test.ts

# Or run all tests
npm test
```

---

## Best Practices Applied

1. **Process Management**: Always exit the process after handling fatal errors to prevent undefined states.

2. **Mutex Protection**: Use mutex locks for all state reads and writes in concurrent environments.

3. **Event Handling**: Register handlers for all possible events from external libraries to prevent unhandled promise rejections.

4. **Resource Cleanup**: Use `finally` blocks to ensure resources are always cleaned up, regardless of success or failure paths.

5. **Signal Propagation**: Pass AbortSignal through the call chain to enable cooperative cancellation.

6. **Timeout Management**: Always link timeouts to abort controllers and ensure cleanup in all code paths.

---

## Migration Guide

### For Existing Code Using CircuitBreaker

The `getState()` method is now async. Update your code:

```typescript
// Before
const state = breaker.getState();

// After
const state = await breaker.getState();
```

### For Custom Job Handlers

To support cancellation, update your handlers to accept an AbortSignal:

```typescript
scheduler.register({
  name: 'my-job',
  queue: 'my-queue',
}, async (data, job, signal) => {
  // Check for cancellation
  if (signal?.aborted) {
    throw new Error('Job was cancelled');
  }
  
  // Or use with fetch/axios
  const response = await fetch(url, { signal });
  
  return result;
});
```

---

## Monitoring

These fixes include additional event emissions for monitoring:

- `workerError` - Emitted when a worker encounters an error
- `circuit_half_open` - Emitted when circuit breaker transitions to half-open
- `circuit_closed` - Emitted when circuit breaker closes
- `circuit_open` - Emitted when circuit breaker opens

Configure alerts for these events to detect issues early.

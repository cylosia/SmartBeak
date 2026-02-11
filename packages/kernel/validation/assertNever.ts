/**
 * Exhaustiveness Checking - P2-MEDIUM FIX: Add assertNever usage
 */

/**
 * Assert that a value is never (for exhaustiveness checking)
 * P2-MEDIUM FIX: Add assertNever usage for exhaustiveness
 *
 * Usage:
 * ```typescript
 * type Animal = 'dog' | 'cat';
 * function handleAnimal(animal: Animal) {
 *   switch(animal) {
 *     case 'dog': return 'woof';
 *     case 'cat': return 'meow';
 *     default: return assertNever(animal); // Compile error if new type added
 *   }
 * }
 * ```
 *
 * @param value - The value that should never occur
 * @param message - Optional error message
 * @throws Error always
 */
export function assertNever(value: never, message?: string): never {
  throw new Error(message || `Unexpected value: ${JSON.stringify(value)}`);
}

/**
 * Assert that a value is never (returns void for use in if/else chains)
 * P2-MEDIUM FIX: Add assertNever usage for exhaustiveness
 *
 * @param value - The value that should never occur
 * @throws Error always
 */
export function assertNeverVoid(value: never): void {
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
  throw new Error(`Unhandled case: ${value}`);
}

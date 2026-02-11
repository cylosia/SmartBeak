/**
* Safe division utility to prevent division by zero errors
*/

/**
* Safely divide two numbers, returning a default value if divisor is zero
* @param dividend - The number being divided
* @param divisor - The number to divide by
* @param defaultValue - Value to return if divisor is zero (default: 0)
* @returns Result of division or default value
*/
export function safeDivide(dividend: number, divisor: number, defaultValue: number = 0): number {
  if (divisor === 0 || !isFinite(divisor)) {
    return defaultValue;
  }
  return dividend / divisor;
}

/**
* Safely calculate percentage, returning a default value if base is zero
* @param value - The value to calculate percentage for
* @param total - The total/base value
* @param defaultValue - Value to return if total is zero (default: 0)
* @returns Percentage value or default value
*/
export function safePercentage(value: number, total: number, defaultValue: number = 0): number {
  if (total === 0 || !isFinite(total)) {
    return defaultValue;
  }
  return (value / total) * 100;
}

/**
* Safely calculate ratio, returning a default value if denominator is zero
* @param numerator - The numerator
* @param denominator - The denominator
* @param defaultValue - Value to return if denominator is zero (default: 0)
* @returns Ratio or default value
*/
export function safeRatio(numerator: number, denominator: number, defaultValue: number = 0): number {
  if (denominator === 0 || !isFinite(denominator)) {
    return defaultValue;
  }
  return numerator / denominator;
}

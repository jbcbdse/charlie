/** Returns the current time in milliseconds, to some sub-ms precision */
export function getCurrentTime(): number {
  const now = Date.now(); // Current time in milliseconds
  const hrtimeInNanoseconds = process.hrtime.bigint(); // High precision in nanoseconds
  const highPrecisionInMillis = Number(hrtimeInNanoseconds) / 1e6; // Convert nanoseconds to milliseconds
  const processStartTime = now - highPrecisionInMillis; // Estimate process start time

  return processStartTime + highPrecisionInMillis; // Combine to get the high-precision absolute time
}

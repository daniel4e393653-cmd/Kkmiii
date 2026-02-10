// Shim for @mysten/bcs compatibility with Cetus SDK
// The Cetus SDK uses fromHEX which was renamed to fromHex in newer versions

export * from '@mysten/bcs';

// Re-export fromHex as fromHEX for backward compatibility
export { fromHex as fromHEX, toHex as toHEX } from '@mysten/bcs';

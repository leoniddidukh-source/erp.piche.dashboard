import { NormalizedModuleFederationOptions } from './normalizeModuleFederationOptions';
/**
 * Resolves the public path for remote entries
 * @param options - Module Federation options
 * @param viteBase - Vite's base config value
 * @param originalBase - Original base config before any transformations
 * @returns The resolved public path
 */
export declare function resolvePublicPath(options: NormalizedModuleFederationOptions, viteBase: string, originalBase?: string): string;

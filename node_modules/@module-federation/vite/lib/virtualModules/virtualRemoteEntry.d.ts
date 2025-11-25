import { NormalizedModuleFederationOptions } from '../utils/normalizeModuleFederationOptions';
export declare function getUsedShares(): Set<string>;
export declare function addUsedShares(pkg: string): void;
export declare function getLocalSharedImportMapPath(): string;
export declare function writeLocalSharedImportMap(): void;
export declare function generateLocalSharedImportMap(): string;
export declare const REMOTE_ENTRY_ID = "virtual:mf-REMOTE_ENTRY_ID";
export declare function generateRemoteEntry(options: NormalizedModuleFederationOptions): string;
/**
 * Inject entry file, automatically init when used as host,
 * and will not inject remoteEntry
 */
export declare const HOST_AUTO_INIT_TAG = "__H_A_I__";
export declare function writeHostAutoInit(): void;
export declare function getHostAutoInitImportId(): string;
export declare function getHostAutoInitPath(): string;

export declare function getSuffix(name: string): string;
/**
 * Physically generate files as virtual modules under node_modules/__mf__virtual/*
 */
export declare function assertModuleFound(tag: string, str?: string): VirtualModule;
export default class VirtualModule {
    name: string;
    tag: string;
    suffix: string;
    inited: boolean;
    /**
     * Set the root path for finding node_modules
     * @param root - Root path
     */
    static setRoot(root: string): void;
    /**
     * Ensure virtual package directory exists
     */
    static ensureVirtualPackageExists(): void;
    static findModule(tag: string, str?: string): VirtualModule | undefined;
    constructor(name: string, tag?: string, suffix?: string);
    getPath(): string;
    getImportId(): string;
    writeSync(code: string, force?: boolean): void;
    write(code: string): void;
}

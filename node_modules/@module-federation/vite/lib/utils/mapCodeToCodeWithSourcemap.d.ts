export declare function mapCodeToCodeWithSourcemap(code?: string | Promise<string>): Promise<{
    code: string;
    map: import("magic-string").SourceMap;
} | undefined>;

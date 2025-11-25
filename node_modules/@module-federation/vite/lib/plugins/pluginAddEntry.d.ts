import { Plugin } from 'vite';
import { NormalizedModuleFederationOptions } from '../utils/normalizeModuleFederationOptions';
interface AddEntryOptions {
    entryName: string;
    entryPath: string;
    fileName?: string;
    inject?: NormalizedModuleFederationOptions['hostInitInjectLocation'];
}
declare const addEntry: ({ entryName, entryPath, fileName, inject, }: AddEntryOptions) => Plugin[];
export default addEntry;

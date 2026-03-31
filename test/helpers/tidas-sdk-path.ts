import path from 'node:path';

export function resolveTidasSdkPath(...parts: string[]): string {
  const explicitRoot = process.env.TIANGONG_LCA_TIDAS_SDK_DIR?.trim();
  const sdkRoot = explicitRoot
    ? path.resolve(explicitRoot)
    : path.resolve(process.cwd(), '../tidas-sdk');
  return path.resolve(sdkRoot, ...parts);
}

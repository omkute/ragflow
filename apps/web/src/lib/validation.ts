export function isSupportedDocument(filename: string): boolean {
  return /\.(md|txt)$/i.test(filename);
}

/**
 * Printed card text as effect scripts store it: reminder text dropped,
 * curly apostrophes straightened, whitespace folded. Kept free of any
 * Vite-only import so the Node script generator can share it.
 */
export function scriptText(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/\([^)]*\)/g, '')
    .replace(/’/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

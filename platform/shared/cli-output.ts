import pc from 'picocolors';

export const cli = {
  success: (text: string) => pc.green(`✓ ${text}`),
  error: (text: string) => pc.red(`✗ ${text}`),
  warn: (text: string) => pc.yellow(`⚠ ${text}`),
  info: (text: string) => pc.blue(`ℹ ${text}`),
  dim: (text: string) => pc.dim(text),
  bold: (text: string) => pc.bold(text),
  green: pc.green,
  red: pc.red,
  yellow: pc.yellow,
  blue: pc.blue,
  cyan: pc.cyan,
  magenta: pc.magenta,
  gray: pc.gray,
} as const;

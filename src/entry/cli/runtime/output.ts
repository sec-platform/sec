import pc from 'picocolors';

export const cli = {
  error: (text: string) => pc.red(`✗ ${text}`),
  dim: (text: string) => pc.dim(text),
} as const;

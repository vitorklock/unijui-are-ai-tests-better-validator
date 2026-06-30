export interface SmellResult {
  total: number;
  byType: Record<string, number>;
}

export function detectSmells(code: string): SmellResult;

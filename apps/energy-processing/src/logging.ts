export function log(
  severity: 'INFO' | 'WARNING' | 'ERROR',
  data: Record<string, unknown>,
): void {
  console.log(JSON.stringify({severity, ...data}));
}

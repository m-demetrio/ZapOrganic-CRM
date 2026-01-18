export function resolveDelaySec(
  step: { delaySec?: number; delayExpr?: string },
  defaultDelaySec = 0
): number {
  if (typeof step.delaySec === "number") {
    return step.delaySec;
  }

  const expr = step.delayExpr?.trim();
  if (!expr) {
    return defaultDelaySec;
  }

  const randMatch = expr.match(/^rand\((\d+),(\d+)\)$/);
  if (randMatch) {
    const min = Number(randMatch[1]);
    const max = Number(randMatch[2]);
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  const rangeMatch = expr.match(/^(\d+)\.\.(\d+)$/);
  if (rangeMatch) {
    const min = Number(rangeMatch[1]);
    const max = Number(rangeMatch[2]);
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  if (/^\d+$/.test(expr)) {
    return Number(expr);
  }

  return defaultDelaySec;
}

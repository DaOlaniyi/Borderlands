export const sum = (o: Record<string, number>) => Object.values(o).reduce((n, v) => n + v, 0)

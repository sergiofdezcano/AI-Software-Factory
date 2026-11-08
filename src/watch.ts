// Issues con la etiqueta factory que todavía tienen trabajo pendiente.
// En PR, mergeados o atascados ya no se tocan: los atascados se reactivan
// borrando runs/<app>-<issue>/ y quitando la etiqueta factory:stuck.
const DONE = new Set(['factory:pr', 'factory:merged', 'factory:stuck']);

export function pendingIssues(issues: { number: number; labels: string[] }[]): number[] {
  return issues.filter((i) => !i.labels.some((l) => DONE.has(l))).map((i) => i.number);
}

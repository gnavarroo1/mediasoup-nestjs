export function pluck<T, K>(array: T[], key: string): K[] {
  return array.map((a) => a[key]);
}

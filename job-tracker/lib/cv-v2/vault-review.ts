export function vaultReviewEnabled(value: string | undefined): boolean {
  return value === '1' || value?.toLocaleLowerCase() === 'true';
}

// A file size as a chip shows it: `75 B`, `15.0 KiB`, `3.5 MiB`.

const units = ['B', 'KiB', 'MiB', 'GiB'];

export const formatBytes = (size: number): string => {
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit] ?? 'B'}`;
};

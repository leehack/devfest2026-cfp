const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function normaliseThemeColor(value: unknown): string | null {
  const color = typeof value === 'string' ? value.trim() : '';
  if (!color) return '';
  return HEX_COLOR.test(color) ? color.toLowerCase() : null;
}

export function themeForeground(color: string): '#111827' | '#ffffff' {
  const red = Number.parseInt(color.slice(1, 3), 16) / 255;
  const green = Number.parseInt(color.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(color.slice(5, 7), 16) / 255;
  const linear = (channel: number) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  const luminance = 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
  const whiteContrast = 1.05 / (luminance + 0.05);
  const darkContrast = (luminance + 0.05) / 0.057;
  return whiteContrast >= darkContrast ? '#ffffff' : '#111827';
}

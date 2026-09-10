/**
 * The Cliff Heroes mark: the pixel heart from the game's own favicon.
 *
 * Drawn as a grid rather than fetched as an image so it inherits `currentColor`
 * and stays crisp at any size - a 32px favicon scaled up in the rail would be a
 * blur, and a heart made of stroke paths would stop looking pixelled at exactly
 * the size it matters.
 *
 * `shapeRendering="crispEdges"` is the whole trick: the cells are integers in
 * the viewBox, so turning off antialiasing keeps the steps hard however the
 * browser scales them.
 */

/** One row per pixel line, `#` where the heart is filled. The classic 8-bit shape. */
const ROWS = [
  '..##...##..',
  '.####.####.',
  '###########',
  '###########',
  '###########',
  '.#########.',
  '..#######..',
  '...#####...',
  '....###....',
  '.....#.....',
];

/** Horizontal runs of filled cells, so the heart is a handful of rects, not 70. */
function runs(row: string): { x: number; width: number }[] {
  const spans: { x: number; width: number }[] = [];
  let start: number | null = null;
  for (let x = 0; x <= row.length; x += 1) {
    const filled = row[x] === '#';
    if (filled && start === null) start = x;
    if (!filled && start !== null) {
      spans.push({ x: start, width: x - start });
      start = null;
    }
  }
  return spans;
}

interface PixelHeartProps {
  size?: number;
  className?: string;
  /** Pass when the heart is the only thing naming what it marks. */
  title?: string;
}

export function PixelHeart({ size = 18, className, title }: PixelHeartProps) {
  return (
    <svg
      width={size}
      height={(size * ROWS.length) / ROWS[0].length}
      viewBox={`0 0 ${ROWS[0].length} ${ROWS.length}`}
      fill="currentColor"
      shapeRendering="crispEdges"
      className={className}
      role={title === undefined ? 'presentation' : 'img'}
      aria-hidden={title === undefined ? true : undefined}
    >
      {title !== undefined && <title>{title}</title>}
      {ROWS.flatMap((row, y) =>
        runs(row).map((span) => (
          <rect key={`${y}-${span.x}`} x={span.x} y={y} width={span.width} height={1} />
        )),
      )}
    </svg>
  );
}

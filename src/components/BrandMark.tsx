// The course's mark: a C drawn in seven square cells, like bits on a grid, with one cell in the data hue (the "current" cell).
// It uses currentColor for the cells, so it follows the text colour in both themes. The favicon in index.html draws the same cells.
const CELLS: ReadonlyArray<readonly [number, number]> = [[0, 0], [5, 0], [0, 5], [0, 10], [5, 10], [10, 10]];

export function BrandMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 15 15" shapeRendering="crispEdges" focusable="false" aria-hidden="true">
      {CELLS.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="4" height="4" fill="currentColor" />)}
      <rect x="10" y="0" width="4" height="4" fill="var(--data)" />
    </svg>
  );
}

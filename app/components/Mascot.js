// Dumpling, picky's mascot: an unimpressed pixel dumpling. Drawn as crisp SVG pixels, no image file.
const SPRITES = {
  meh: [
    "......oooooo......",
    "....oowpwwpwoo....",
    "...owwpwwwwpwwo...",
    "..owwwwwwwwwwwwo..",
    ".owwwwwwwwwwwwwwo.",
    ".owwEEwwwwwwEEwwo.",
    ".owwewwwwwwwwewwo.",
    "owbbwwwwwwwwwwbbwo",
    "owwwwwwmmmmwwwwwwo",
    "owwwwwwwwwwwwwwwwo",
    "osswwwwwwwwwwwwsso",
    ".osssssssssssssso.",
    "..oooooooooooooo..",
  ],
  happy: [
    "......oooooo......",
    "....oowpwwpwoo....",
    "...owwpwwwwpwwo...",
    "..owwwwwwwwwwwwo..",
    ".owwwwwwwwwwwwwwo.",
    ".owwwEwwwwwwEwwwo.",
    ".owwEwEwwwwEwEwwo.",
    "owbbwwwwwwwwwwbbwo",
    "owwwwwmwwwwmwwwwwo",
    "owwwwwwmmmmwwwwwwo",
    "osswwwwwwwwwwwwsso",
    ".osssssssssssssso.",
    "..oooooooooooooo..",
  ],
  side: [
    "......oooooo......",
    "....oowpwwpwoo....",
    "...owwpwwwwpwwo...",
    "..owwwwwwwwwwwwo..",
    ".owwwwwwwwwwwwwwo.",
    ".owwEEwwwwwwEEwwo.",
    ".owwwewwwwwwwewwo.",
    "owbbwwwwwwwwwwbbwo",
    "owwwwwwwwmmmmwwwwo",
    "owwwwwwwwwwwwwwwwo",
    "osswwwwwwwwwwwwsso",
    ".osssssssssssssso.",
    "..oooooooooooooo..",
  ],
};
const COLORS = { o: "#2b1d14", w: "#fff8ec", p: "#e3cfae", s: "#ead8bf", E: "#2b1d14", e: "#2b1d14", b: "#ff9d7c", m: "#2b1d14" };

export default function Mascot({ mood = "meh", size = 72, className = "", title }) {
  const rows = SPRITES[mood] || SPRITES.meh;
  const rects = [];
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== ".") rects.push(<rect key={`${x}-${y}`} x={x} y={y} width="1.02" height="1.02" fill={COLORS[ch]} />);
  }));
  return (
    <svg className={className} width={size} height={(size * rows.length) / rows[0].length} viewBox={`0 0 ${rows[0].length} ${rows.length}`}
      shapeRendering="crispEdges" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      {rects}
    </svg>
  );
}

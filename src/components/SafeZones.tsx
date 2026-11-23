import { EXPORT_PRESETS } from '../../shared/presets';
import { useT } from '../i18n';

/**
 * How the frame will look on a platform: the part a "fill" export keeps (the rest is dimmed) and, inside it,
 * the edges the app's own buttons and captions cover. Drawn over the stage, in screen pixels.
 */
export function SafeZones({ W, H, fit, presetId }: { W: number; H: number; fit: number; presetId: string }) {
  const { isHe } = useT();
  const preset = EXPORT_PRESETS.find((p) => p.id === presetId);
  if (!preset) return null;
  const a = preset.width / preset.height;
  // The centred crop of the project frame with the platform's shape.
  const cw = Math.min(W, H * a);
  const ch = Math.min(H, W / a);
  const x0 = ((W - cw) / 2) * fit;
  const y0 = ((H - ch) / 2) * fit;
  const w = cw * fit;
  const h = ch * fit;
  const s = preset.safe;
  const sx = s ? x0 + s.left * w : x0;
  const sy = s ? y0 + s.top * h : y0;
  const sw = s ? w * (1 - s.left - s.right) : w;
  const sh = s ? h * (1 - s.top - s.bottom) : h;
  const reshaped = Math.abs(a - W / H) > 0.01;
  const FW = W * fit;
  const FH = H * fit;
  return (
    <>
      <svg className="safe-zones" width={FW} height={FH} viewBox={`0 0 ${FW} ${FH}`} aria-hidden>
        <defs>
          <pattern id="sz-stripes" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="4" height="8" className="sz-stripe" />
          </pattern>
        </defs>
        {reshaped && <path className="sz-outside" fillRule="evenodd" d={`M0 0H${FW}V${FH}H0Z M${x0} ${y0}h${w}v${h}h${-w}Z`} />}
        {s && <path className="sz-ui" fill="url(#sz-stripes)" fillRule="evenodd" d={`M${x0} ${y0}h${w}v${h}h${-w}Z M${sx} ${sy}h${sw}v${sh}h${-sw}Z`} />}
        <rect className="sz-crop" x={x0} y={y0} width={w} height={h} />
        {s && <rect className="sz-safe" x={sx} y={sy} width={sw} height={sh} rx={4} />}
      </svg>
      {/* HTML, not SVG text, so a Hebrew label keeps its direction. */}
      <div className="sz-label" dir="auto" style={{ left: x0 + 8, top: y0 + 8 }}>
        {isHe ? preset.labelHe : preset.label}
        {reshaped ? (isHe ? ' · מה שנשאר במילוי' : ' · what a fill keeps') : ''}
      </div>
    </>
  );
}

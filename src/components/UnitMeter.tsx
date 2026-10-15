import type { UnitRating } from '@/server/learner';
import './UnitMeter.css';

// Размеры графика в единицах viewBox; на экране — те же пиксели (UnitMeter.css).
const W = 80;
const H = 24;

function tipOf(r: UnitRating): string {
    return [
        `Рейтинг   ${Math.round(r.progress)}/100`,
        `Освоение  ${Math.round(r.mastery)}/100`,
        `Держится  ${r.intervalDays} дн. (ступень ${r.stage}/${r.stageMax})`,
    ].join('\n');
}

/** График рейтинга по дням: шкала 0–100 одна на все строки, чтобы графики были сравнимы. */
export function MeterSpark({ rating, className = '' }: { rating: UnitRating; className?: string }) {
    const n = rating.history.length;
    const pts = rating.history.flatMap((v, i) => (v == null ? [] : [[(i / (n - 1)) * W, H - 1 - (v / 100) * (H - 2)] as const]));
    const tip = tipOf(rating);
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
    const [ex, ey] = pts[pts.length - 1] ?? [W, H - 1];
    const area = pts.length ? `${line}L${ex.toFixed(1)},${H}L${pts[0][0].toFixed(1)},${H}Z` : '';
    return (
        <span className={`meter ${className}`} data-tip={tip} role="img" aria-label={tip}>
            <svg className="meter__spark" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
                <line className="meter__base" x1="0" y1={H - 0.5} x2={W} y2={H - 0.5} />
                <path className="meter__area" d={area} />
                <path className="meter__line" d={line} />
                <circle className="meter__dot" cx={ex} cy={ey} r="2" />
            </svg>
        </span>
    );
}

/** Интервал стабильности и полоса освоения — одной строкой под графиком. */
export function MeterHold({ rating, className = '' }: { rating: UnitRating; className?: string }) {
    const tip = tipOf(rating);
    return (
        <span className={`meter meter--hold ${className}`} data-tip={tip} aria-hidden="true">
            <span className="meter__days">{rating.intervalDays}<small>дн</small></span>
            <span className="meter__bar"><span style={{ width: `${Math.min(100, rating.mastery)}%` }} /></span>
        </span>
    );
}

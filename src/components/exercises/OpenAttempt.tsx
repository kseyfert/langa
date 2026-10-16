'use client';

import { jump } from '@/components/jump';
import type { OpenEvaluation } from '@/server/exercises/types';

// Разбор попытки — вариант C макета: сначала итог, потом что исправить, потом как лучше.

const VERDICT = {
    correct_target: { text: 'Верно', mod: 'ok' },
    correct_non_target: { text: 'Верно, но без нужной конструкции', mod: 'plain' },
    incorrect: { text: 'Есть ошибки', mod: 'bad' },
} as const;

const TARGET_STATUS = { correct: 'верно', error: 'ошибка', partial: 'частично', not_used: 'не использован' } as const;

/** Одна правка в списке «Исправь». */
type Fix = {
    fragment: string; fix: string; comment: string;
    unit: string | null;
    /** id побочного юнита — его название ссылка на строку каталога; у целевого null: он и так перед глазами. */
    unitId: number | null;
    score: number | null;
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function Change({ fragment, fix }: { fragment: string; fix: string }) {
    if (fix && !same(fix, fragment)) return <><del>{fragment}</del> → <ins>{fix}</ins></>;
    return <>«{fragment}»</>;
}

type Props = {
    label: string | null;
    answer: string;
    evaluation: OpenEvaluation;
    units: Record<number, string>;
    targetName: string;
    /** Эталон: есть, когда задание закончено или разбор открыт. */
    references: string[];
    /** Что заметить в задании (target_note_ru перевода) — приходит вместе с эталоном. */
    note: string;
    /** Ждёт следующей попытки: всё, что подсказывает, как надо, скрыто. */
    concealed: boolean;
};

/** Разбор одной попытки открытого задания. */
export function OpenAttempt({ label, answer, evaluation: ev, units, targetName, references, note, concealed }: Props) {
    const v = VERDICT[ev.verdict];
    const t = ev.target;
    const name = (id: number) => units[id] ?? String(id);

    // Все ошибки одним списком: целевой юнит первым, дальше побочные от худшего, потом вне юнитов.
    // Пока разбор скрыт, правки по целевому юниту не показываются (exercise-spec §8).
    const targetFix: Fix[] = !concealed && t.fragment && t.status !== 'correct'
        ? [{ fragment: t.fragment, fix: t.fix, comment: t.comment_ru, unit: targetName, unitId: null, score: null }]
        : [];
    const bad = ev.others.filter((o) => o.status !== 'correct').sort((a, b) => a.score - b.score);
    const fixes: Fix[] = [
        ...targetFix,
        ...bad.map((o) => ({ fragment: o.fragment, fix: o.fix, comment: o.comment_ru, unit: name(o.unit_id), unitId: o.unit_id, score: o.score })),
        ...ev.issues.map((x) => ({ ...x, comment: x.comment_ru, unit: null, unitId: null, score: null })),
    ].filter((f) => f.fragment || f.comment);

    // Засчитано по целевому юниту, но правки есть — так и сказать, иначе «Верно» над списком ошибок путает.
    const verdictText = ev.verdict === 'correct_target' && fixes.length ? 'Верно, есть другие ошибки' : v.text;

    const good = ev.others.filter((o) => o.status === 'correct');
    const notable = good.filter((o) => o.notable);
    const plain = good.filter((o) => !o.notable);

    const better = [
        { label: 'Твой', text: answer, mine: true },
        { label: 'Исправлено', text: same(ev.corrected_answer, answer) ? '' : ev.corrected_answer },
        { label: 'Носитель', text: ev.natural_version },
        ...references.map((r) => ({ label: 'Эталон', text: r })),
        { label: 'Заметь', text: note },
    ].filter((b) => b.text);

    return (
        <section className="open__attempt">
            {label && <p className="open__cap">{label}</p>}
            <div className="open__band">
                <div>
                    <p className={`open__verdict open--${v.mod}`}>{verdictText}</p>
                    {/* Пока разбор скрыт, на месте итога — сам ответ: summary подсказал бы, как надо. */}
                    <p className="open__summary">{concealed ? answer : ev.summary_ru}</p>
                </div>
                <div className="open__score">
                    {/* «Не использован» при ошибках рейтинг считает нулём (rating-model §3.1) — так и показываем.
                        Прочерк — только когда свидетельства нет: «верно, но без нужной конструкции». */}
                    <b className={concealed ? 'muted' : undefined}>{concealed ? '—' : (t.score ?? 0)}</b>
                    <span>целевой юнит · {TARGET_STATUS[concealed ? 'not_used' : t.status]}</span>
                </div>
            </div>

            {fixes.length > 0 && (
                <>
                    <p className="open__cap open__title">Исправь</p>
                    <ol className="open__fixes">
                        {fixes.map((f, i) => (
                            <li key={i}>
                                <span className="open__num mono">{String(i + 1).padStart(2, '0')}</span>
                                {f.fragment && <span className="open__fix"><Change fragment={f.fragment} fix={f.fix} /></span>}
                                <span className="open__why">
                                    {f.comment}
                                    {f.unit && ' '}
                                    {f.unitId != null ? (
                                        <a className="linklike open__unit" href={`#unit-${f.unitId}`} onClick={(e) => jump(e, `#unit-${f.unitId}`)}>{f.unit}</a>
                                    ) : (
                                        f.unit && <span className="open__unit">{f.unit}</span>
                                    )}
                                    {f.score != null && <> · <span className="mono">{f.score}</span></>}
                                </span>
                            </li>
                        ))}
                    </ol>
                </>
            )}

            {!concealed && (
                <div className="open__better">
                    <p className="open__cap">Как лучше</p>
                    <dl>
                        {better.map((b, i) => (
                            <div key={i} className="open__better-row">
                                <dt className="open__cap">{b.label}</dt>
                                <dd className={'mine' in b ? 'muted' : undefined}>{b.text}</dd>
                            </div>
                        ))}
                    </dl>
                </div>
            )}

            {notable.map((o) => (
                <p key={o.unit_id} className="open__fine">
                    <span className="open--ok">Отлично</span>{o.fragment && <> «{o.fragment}»</>}{o.comment_ru && <> — {o.comment_ru}</>} · {name(o.unit_id)}
                </p>
            ))}
            {plain.length > 0 && (
                <p className="open__fine">Без ошибок: {plain.map((o) => name(o.unit_id)).join(' · ')}</p>
            )}
        </section>
    );
}

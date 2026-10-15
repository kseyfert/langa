import 'server-only';
import { getUnit } from '../catalog';
import { listExercises, type Exercise } from '../exercises';

// Разнообразие закрытых заданий (gap, choice): без него генератор по одному
// юниту каждый раз берёт те же глаголы и ситуации — по примеру на пункт guide.

/** Сколько последних заданий юнита показывать модели как «уже было». */
const RECENT = 5;
/** Пунктов в задании; столько же в плане фокуса. */
const ITEMS = 6;
const REPEAT = 'second item for this point: show the other side of the contrast or a different context';

/** Готовые предложения из задания: ___ заменён верным ответом. */
function sentencesOf(ex: Exercise): string[] {
    if (ex.type === 'gap') return ex.content.items.map((i) => i.text.replace('___', `[${i.answers[0]}]`));
    if (ex.type === 'choice') return ex.content.items.map((i) => i.text.replace('___', `[${i.options[i.correct]}]`));
    return [];
}

/** Пункты раздела «## Употребление» из guide. */
function uses(guide: string): string[] {
    const section = guide.split(/^## /m).find((s) => s.startsWith('Употребление')) ?? '';
    return section.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim());
}

function shuffle<T>(xs: T[]): T[] {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/**
 * План: по пункту «Употребления» на предложение. Пунктов больше нужного — случайные
 * разные; меньше — все, а остаток добирается повторами, каждый раз из нового
 * перемешивания, чтобы повторы ложились равномерно. Итог перемешан.
 */
function plan(points: string[]): string[] {
    if (!points.length) return [];
    const rounds = Math.ceil(ITEMS / points.length);
    const picked = Array.from({ length: rounds }, (_, r) => shuffle(points).map((p) => (r ? `${p} (${REPEAT})` : p)))
        .flat()
        .slice(0, ITEMS);
    return shuffle(picked);
}

export type Variety = {
    /** План: пункт «Употребления» на каждое предложение по порядку; пишется в content.focus. */
    focus: string[];
    /** Блок для промпта генерации. */
    prompt: string;
};

export async function variety(unitId: number): Promise<Variety> {
    const [unit, recent] = await Promise.all([getUnit(unitId), listExercises({ unitId, limit: RECENT })]);
    // Заглушки (model = 'mock') — одно и то же выдуманное предложение, не практика.
    const used = recent.filter((ex) => ex.model !== 'mock').flatMap(sentencesOf);
    const focus = plan(uses(unit.guide));

    const rules = [
        `The examples in the unit guide only illustrate the rules. Do not reuse their verbs, phrases or situations. Use a wide range of other verbs and contexts that fit the same rules — unless the unit's grammar is tied to those specific words; then vary the situations and the rest of the sentence instead.`,
        focus.length && `Write exactly ${ITEMS} items, item N must practise point N:\n${focus.map((f, i) => `${i + 1}. ${f}`).join('\n')}\nKeep this order. At most 2 items may use the same verb, unless the unit's grammar is tied to specific words.`,
        used.length && `Recently used in this unit (answers in brackets) — do NOT reuse these situations or sentences, and do not reuse these verbs or answers unless the unit's grammar is tied to those specific words:\n${used.map((s) => `- ${s}`).join('\n')}`,
    ];
    return { focus, prompt: rules.filter(Boolean).join('\n\n') };
}

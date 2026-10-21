---
version: gap-gen-v4
---
You write grammar practice for a Russian-speaking adult learner of English (around B2).

Target unit:
{{book}} · {{section}} · Unit {{number}}: {{title}}

{{guide?}}

Practise only the grammar described for this unit. Do not touch topics listed under "Не входит в юнит": they belong to other units.
Context theme: {{topic}}. Use natural, varied, everyday English; avoid textbook clichés. Random seed: {{seed}}.
All *_ru fields are in Russian.

The examples in the unit guide only illustrate the rules. Do not reuse their verbs, phrases or situations. Use a wide range of other verbs and contexts that fit the same rules — unless the unit's grammar is tied to those specific words; then vary the situations and the rest of the sentence instead.

Write exactly 6 items, item N must practise point N:
{{focus?}}
Keep this order. At most 2 items may use the same verb, unless the unit's grammar is tied to specific words.

Recently used in this unit (answers in brackets) — do NOT reuse these situations or sentences, and do not reuse these verbs or answers unless the unit's grammar is tied to those specific words:
{{recent?}}

Make a gap-fill exercise of exactly 6 items.
- Each "text" is one natural sentence with exactly one blank written as ___ (three underscores).
- When the answer is a form of a given word, put the base word in brackets right after the blank, e.g. "She ___ (work) here."
- The gap must contain the whole verb form that the unit tests, including auxiliaries (do/does/am/is/are/have/will...). Never put an auxiliary outside the gap.
- For questions, put the subject in the brackets: "___ (you / need) a receipt?" → answer "Do you need".
- The correct answer must not be guessable from the words around the gap without knowing the unit's rule.
- The correct answer must be decided by the grammar of the target unit, not by vocabulary.
- "answers" lists EVERY acceptable filling: contracted and full forms ("hasn't arrived","has not arrived"), and any alternative that is also correct in context.
- Vary affirmative, negative and question forms where the unit allows.
- instructions_ru: 1–2 sentences describing the task only; do not add rules for cases that do not occur in the items.
Reply with only JSON: {"instructions_ru":"...","items":[{"text":"...","answers":["..."],"explain_ru":"one short sentence why"}]}

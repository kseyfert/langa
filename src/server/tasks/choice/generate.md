---
version: choice-gen-v4
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

Make a multiple-choice exercise of exactly 6 items.
- Each "text" is one natural sentence with exactly one blank written as ___ (three underscores).
- The gap must contain the whole verb form that the unit tests, including auxiliaries (do/does/am/is/are/have/will...), in every option. Never put an auxiliary outside the gap.
- For questions, the options include the subject: "___ a receipt?" → options "Do you need", "Are you needing".
- The correct option must not be guessable from the words around the gap without knowing the unit's rule.
- 2 or 3 options; exactly one is correct in context. Distractors are typical mistakes of Russian speakers on this unit. Vary the position of the correct option.
Reply with only JSON: {"instructions_ru":"...","items":[{"text":"...","options":["...","..."],"correct":0,"explain_ru":"one short sentence why"}]}

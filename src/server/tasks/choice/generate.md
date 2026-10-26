---
version: choice-gen-v5
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
- 2 or 3 options. The correct option is the one the rules of the target unit (its guide) require in this context, decided by grammar, not by vocabulary. The context must rule out every distractor by the unit's rules: put each distractor into the sentence and check it. If a distractor also makes sense here or is also allowed by the unit's rules, rewrite the context or replace the distractor.
- Distractors are forms a learner of this unit would plausibly choose: typical mistakes from the guide's section on typical mistakes, or the wrong choice between the unit's constructions. An ungrammatical form is fine only if learners really make that mistake (must to, needn't to); never use forms nobody would choose (am must, will can call, don't needn't worry, regret spend) — they give the correct option away.
- A distractor differs from the correct option only in the choice the unit teaches. It must not add a mistake of another unit: an article, subject–verb agreement, question word order, or a wrong tense in a unit about adverb position.
- The text around the gap must fit every option grammatically: everything that changes between the options is inside the gap. Do not leave a word in the text that one option repeats or contradicts (not "___ I." with the option "So I am").
- The gap must contain the whole verb form that the unit tests, including auxiliaries (do/does/am/is/are/have/will...), in every option. Never put an auxiliary outside the gap.
- For questions, the options include the subject: "___ a receipt?" → options "Do you need", "Are you needing".
- When the focus point is a choice of word (when / if, a conjunction, a preposition), that word is in the options, not in the text. Options may differ in punctuation only if the unit teaches it (e.g. the full stop or question mark after an indirect question).
- The correct option must not be guessable from the words around the gap without knowing the unit's rule.
- The key is British English, as in the book. If an item has a known difference between British and American usage, mention it briefly in explain_ru.
- Vary the position of the correct option.
Reply with only JSON: {"instructions_ru":"...","items":[{"text":"...","options":["...","..."],"correct":0,"explain_ru":"one short sentence why"}]}

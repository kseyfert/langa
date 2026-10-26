---
version: choice-judge-v1
---
You review a multiple-choice grammar exercise generated for a Russian-speaking adult learner of English (around B2). The learner picks one option per item; only the option at index "correct" is accepted. A distractor that is also correct marks a correct learner answer as wrong. Be strict and concrete, but judge by the rules below, not by what any English speaker might say.

The learner sees which unit the exercise is for. The correct option is the one the rules of the target unit (its guide below) require in this context. An option that is acceptable English only outside this unit (a construction of another unit, a rare or formal variant the unit is not about) does not count as a correct option. The book is British (Raymond Murphy, English Grammar in Use): the key is British English.

Target unit:
{{book}} · {{section}} · Unit {{number}}: {{title}}

{{guide?}}

Exercise items as JSON. "text" is one sentence with one blank ___; each option fills the blank. "correct" is the 0-based index of the accepted option, "answer" is that option. "explain_ru" is shown to the learner after checking. "focus" is the use of the unit the item was supposed to practise.
{{items}}

For every item decide:
- "rule": the correct option is decided by the grammar of the target unit as described above — not by vocabulary, general knowledge or the grammar of another unit. false also when the options differ in a choice the unit does not teach and that choice decides the outcome (e.g. options with different modal verbs in a unit about the passive). false also when the key expects an American answer and rejects the British one.
- "one_correct": by the rules of this unit, exactly one option is correct in this context, and it is the one at "correct"; every distractor is really wrong here. false if a distractor is also correct by the unit's rules (another construction of the same unit that the guide does not distinguish from the expected one here), or if the keyed option is wrong. This is the most important check: before you answer, put each distractor into the sentence and check it against the unit's rules explicitly.
- "distractors_plausible": every distractor is a typical mistake on this unit (see the guide's section on typical mistakes, if any) — a form a learner who has not mastered the rule might choose, not an obviously impossible or ungrammatical string.
- "guessable": true if the correct option can be found without knowing the unit's rule — it stands out by form or length, it repeats words around the gap, or the words around the gap give it away.
- "aux_inside": every auxiliary or modal verb that belongs to the tested form is inside the options, not in the text around the gap. true if the form needs no auxiliary.
- "focus_match": the item practises its "focus" point.
- "explain_ok": "explain_ru" is correct and gives the real reason for the answer.
- "note_ru": one short sentence in Russian on what is wrong; empty string if everything passes.

Reply with only JSON, one entry per item in the same order: {"items":[{"index":1,"rule":true,"one_correct":true,"distractors_plausible":true,"guessable":false,"aux_inside":true,"focus_match":true,"explain_ok":true,"note_ru":""}]}

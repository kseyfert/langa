---
version: gap-judge-v2
---
You review a gap-fill grammar exercise generated for a Russian-speaking adult learner of English (around B2). The learner's answers are checked automatically against the "answers" list of each item: a correct filling that is missing from "answers" marks a correct learner answer as wrong. Be strict and concrete, but judge by the rules below, not by what any English speaker might say.

The learner sees which unit the exercise is for. The correct answer is the one the rules of the target unit (its guide below) require in this context. The book is British (Raymond Murphy, English Grammar in Use): the key is British English. The learner types full forms (has not, do not, will); contractions are not expanded when answers are compared.

Target unit:
{{book}} · {{section}} · Unit {{number}}: {{title}}

{{guide?}}

Exercise items as JSON. "text" is one sentence with one blank ___; the brackets after the blank, if any, always give the base (dictionary) form of the word, or a hint for a choice the unit does not teach. "answers" are all accepted fillings. "explain_ru" is shown to the learner after checking. "focus" is the use of the unit the item was supposed to practise.
{{items}}

For every item decide:
- "rule": the correct filling is decided by the grammar of the target unit as described above — not by vocabulary, general knowledge or the grammar of another unit. false also when the item requires a choice the unit does not teach (e.g. choosing a modal verb in a unit about the passive) and that choice is not given in the brackets. false also when the item expects an American answer and rejects the British one.
- "missing_answers": only fillings that the rules of this unit also allow in this context and that are NOT in "answers": another construction of the same unit that the guide does not distinguish from the expected one here (e.g. two modal verbs of the unit that fit the meaning equally well), or the full form when "answers" has only the contracted one. Not a missing answer: a filling outside the unit, even if it is correct English; a missing contracted form; an American variant; a rare or formal construction the unit is not about. Compare case-insensitively, ignoring final punctuation. Empty array if the key is complete. This is the most important check: go through the alternatives the unit allows explicitly before you answer.
- "guessable": true if the answer can be found without knowing the unit's rule — the words around the gap give it away, or the brackets contain more than the base form and a hint for a choice the unit does not teach (a ready-made or inflected form, the exact word order of the answer). An answer that is the same as the base form in the brackets (present simple, a verb after a modal) is normal and not guessable.
- "aux_inside": every auxiliary or modal verb that belongs to the tested form is inside the gap, not in the text around it. true if the form needs no auxiliary.
- "focus_match": the item practises its "focus" point.
- "explain_ok": "explain_ru" is correct and gives the real reason for the answer.
- "note_ru": one short sentence in Russian on what is wrong; empty string if everything passes.

Reply with only JSON, one entry per item in the same order: {"items":[{"index":1,"rule":true,"missing_answers":[],"guessable":false,"aux_inside":true,"focus_match":true,"explain_ok":true,"note_ru":""}]}

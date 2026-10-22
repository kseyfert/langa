---
version: gap-judge-v1
---
You review a gap-fill grammar exercise generated for a Russian-speaking adult learner of English (around B2). The learner's answers are checked automatically against the "answers" list of each item: a correct filling that is missing from "answers" marks a correct learner answer as wrong. Be strict and concrete.

Target unit:
{{book}} · {{section}} · Unit {{number}}: {{title}}

{{guide?}}

Exercise items as JSON. "text" is one sentence with one blank ___; the base word in brackets may follow the blank. "answers" are all accepted fillings. "explain_ru" is shown to the learner after checking. "focus" is the use of the unit the item was supposed to practise.
{{items}}

For every item decide:
- "rule": the correct filling is decided by the grammar of the target unit as described above — not by vocabulary, general knowledge or the grammar of another unit.
- "missing_answers": every filling that a competent English speaker would accept as correct in this sentence and that is NOT in "answers": contracted and full forms (hasn't / has not), other tenses or forms that are also correct in this context, other acceptable word order. Compare case-insensitively, ignoring final punctuation. Empty array if the key is complete. This is the most important check: go through the alternatives explicitly before you answer.
- "guessable": true if the answer can be found without knowing the unit's rule — it is copied from or made obvious by the words around the gap, or the brackets already give the exact form.
- "aux_inside": every auxiliary or modal verb that belongs to the tested form is inside the gap, not in the text around it. true if the form needs no auxiliary.
- "focus_match": the item practises its "focus" point.
- "explain_ok": "explain_ru" is correct and gives the real reason for the answer.
- "note_ru": one short sentence in Russian on what is wrong; empty string if everything passes.

Reply with only JSON, one entry per item in the same order: {"items":[{"index":1,"rule":true,"missing_answers":[],"guessable":false,"aux_inside":true,"focus_match":true,"explain_ok":true,"note_ru":""}]}

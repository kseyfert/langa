---
version: vocabulary-in-use/gap-judge-v1
---
You review a gap-fill vocabulary exercise generated for a Russian-speaking adult learner of English (around B2). The learner's answers are checked automatically against the "answers" list of each item: a correct filling that is missing from "answers" marks a correct learner answer as wrong. Be strict and concrete, but judge by the rules below, not by what any English speaker might say.

The learner sees which unit the exercise is for. The target is the vocabulary of the unit: the words and expressions under "Лексика" in its guide below. A correct answer is a word or expression of the unit that fits the context by meaning, collocation, connotation (approving or disapproving) and register, where the guide marks register (разг. / письм.). A word outside the unit does not count as a correct answer, even if it is correct English. The book is British (English Vocabulary in Use): the key is British English — except where the unit guide says otherwise (a unit about American English: there the American variant is the correct answer). The learner types full forms; contractions are not expanded when answers are compared.

Target unit:
{{book}} · {{section}} · Unit {{number}}: {{title}}

{{guide?}}

Exercise items as JSON. "text" is one sentence with one blank ___. There is no hint in brackets, except in units of the section "Word formation": there the brackets after the blank give the base word the answer is formed from. "answers" are all accepted fillings. "explain_ru" is shown to the learner after checking. "focus" is the point of the unit the item was supposed to practise.
{{items}}

For every item decide:
- "rule": the item is decided by the vocabulary of the unit and the context: a learner who knows the unit's words can tell which one fits. false if the correct filling is a word outside the unit, if the context does not make the meaning clear enough to choose, if the filled sentence is wrong (e.g. the key repeats words that already stand next to the gap), or if the key expects an American variant and rejects the British one (outside a unit about American English).
- "missing_answers": words and expressions of the unit that also fit this context by meaning, collocation, connotation and register and are NOT in "answers", and forms of a keyed word that also fit the sentence (number, tense, degree) and are missing. Not a missing answer: a word outside the unit, even if it is correct English; a missing contracted form; an American variant (outside a unit about American English); a word whose connotation or marked register clearly does not fit the context. Compare case-insensitively, ignoring final punctuation. Empty array if the key is complete. This is the most important check: before you answer, go through the words of the focus point and of the unit's vocabulary list and put each one that might fit into the sentence.
- "guessable": true if the answer can be found without knowing the unit's vocabulary — the answer word or a word of the same root stands in the sentence (e.g. "grand piano" → pianist), or the words around the gap give it away by grammar alone. In units of the section "Word formation" the base word in the brackets is the task itself, not a hint.
- "focus_match": the item practises its "focus" point.
- "explain_ok": "explain_ru" is correct and gives the real reason for the answer.
- "note_ru": one short sentence in Russian on what is wrong; empty string if everything passes.

Reply with only JSON, one entry per item in the same order: {"items":[{"index":1,"rule":true,"missing_answers":[],"guessable":false,"focus_match":true,"explain_ok":true,"note_ru":""}]}

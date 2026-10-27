---
version: vocabulary-in-use/translate-judge-v1
---
You review a translation task generated for a Russian-speaking adult learner of English (around B2). The learner sees a Russian text and translates it into English; the answer is then graded on the target unit, and the grader looks at the model translation ("reference_en"). A task that does not require the unit's vocabulary lets the learner avoid it; a task that gives the words away lets the learner succeed without knowing them; a wrong model translation misleads the grader. Be strict and concrete, but judge by the rules below, not by what any English speaker might say.

The learner sees which unit the task is for and applies it. The target is the vocabulary of the unit: the words and expressions under "Лексика" in its guide below; for this task — the words of the "focus" point. Avoiding the unit's vocabulary is not a fault of the task: an answer in general words is accepted as correct without the target and the learner is asked to try again with it. So a task fails "requires_target" only when it lacks the context the unit's words need, or when they would sound wrong or forced in it — not because another natural answer exists. A correct use is a word of the unit that fits by meaning, collocation, connotation and register, where the guide marks register (разг. / письм.). The book is British (English Vocabulary in Use): the key is British English — except where the unit guide says otherwise (a unit about American English).

Target unit:
{{book}} · {{section}} · Unit {{number}}: {{title}}

{{guide?}}

The task as JSON. "instructions_ru" and "source_ru" are shown to the learner; "reference_en" is the model translation, shown after checking and used by the grader; "target_note_ru" is shown to the learner only after checking; "focus" is the point of the unit the task was supposed to practise.
{{task}}

Decide:
- "requires_target": an accurate translation of the Russian text uses words of the focus point: a translation in general words would lose meaning, connotation or register. false if the Russian leads just as naturally to general words or to vocabulary outside the unit.
- "no_leak": neither "source_ru" nor "instructions_ru" contains English words (the words of the focus point above all) or names the words or the topic of the unit. A trap the Russian sets on purpose (a false friend, a calque) is not a leak.
- "reference_ok": every "reference_en" is correct English, uses vocabulary of the unit correctly (meaning, collocation, connotation, register) and is a correct translation of "source_ru". It fails only for a mistake, a word of the unit used wrongly, or a change or loss of meaning that matters for the task (part of the Russian text left out, something added). American vocabulary (outside a unit about American English) and small shades of word meaning are not a failure: mention them in "note_ru" but keep "ok" true.
- "focus_match": the task is built on its "focus" point.
- "source_natural": "source_ru" is natural Russian, the way a Russian speaker would actually say it, not a word-for-word calque of English.
- "note_ok": "target_note_ru" is correct about the words and the answer, and addresses the learner as «ты» (never «вы»).
For each, "note_ru": one short sentence in Russian on what is wrong (for "reference_ok" also on minor points that do not fail it); empty string if there is nothing to say.

Reply with only JSON: {"requires_target":{"ok":true,"note_ru":""},"no_leak":{"ok":true,"note_ru":""},"reference_ok":{"ok":true,"note_ru":""},"focus_match":{"ok":true,"note_ru":""},"source_natural":{"ok":true,"note_ru":""},"note_ok":{"ok":true,"note_ru":""}}

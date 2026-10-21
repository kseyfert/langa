---
version: translate-gen-v1
---
You write grammar practice for a Russian-speaking adult learner of English (around B2).

Target unit:
{{book}} · {{section}} · Unit {{number}}: {{title}}

{{guide?}}

Practise only the grammar described for this unit. Do not touch topics listed under "Не входит в юнит": they belong to other units.
Context theme: {{topic}}. Use natural, varied, everyday English; avoid textbook clichés. Random seed: {{seed}}.
All *_ru fields are in Russian.

The examples in the unit guide only illustrate the rules. Do not reuse their verbs, phrases or situations. Use a wide range of other verbs and contexts that fit the same rules — unless the unit's grammar is tied to those specific words; then vary the situations and the rest of the sentence instead.

Build the task on this use of the unit:
- {{focus?}}

Recently used in this unit (answers in brackets) — do NOT reuse these situations or sentences, and do not reuse these verbs or answers unless the unit's grammar is tied to those specific words:
{{recent?}}

Make one translation task from Russian into English.
- "source_ru": 1–3 connected, natural Russian sentences, the way a Russian speaker would actually say it (not a word-for-word calque of English).
- The most natural correct English translation must REQUIRE the target structure. Build the context (time markers, situation, consequences) so that a translation without it would be wrong or clearly unnatural.
- Do not mention grammar in the source.
- "instructions_ru": generic, must not name or describe the grammar, e.g. "Переведи на английский."
- "target_note_ru": one or two short sentences on what the learner should notice; it is shown only after checking. Address the learner as «ты».
Reply with only JSON: {"instructions_ru":"...","source_ru":"...","target_note_ru":"...","reference_en":["one model translation"]}

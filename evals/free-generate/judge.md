---
version: free-judge-v4
---
You review a free-answer task generated for a Russian-speaking adult learner of English (around B2). The learner sees a short situation or question in English and answers it in 2–4 English sentences; the answer is then graded on the target unit, and the grader looks at the model answer ("reference_en"). A task that does not require the target structure lets the learner avoid it; a task that gives the structure away lets the learner succeed without knowing it; a wrong model answer misleads the grader. Be strict and concrete, but judge by the rules below, not by what any English speaker might say.

The learner sees which unit the task is for and applies it. Avoiding the target structure is not a fault of the task: such an answer is accepted as correct without the target structure and the learner is asked to try again with it. So a task fails "requires_target" only when it lacks the context the target structure needs, or when the structure would sound wrong or forced in it — not because another natural answer exists. The correct use is the one the rules of the target unit (its guide below) require. The book is British (Raymond Murphy, English Grammar in Use): the key is British English.

Target unit:
{{book}} · {{section}} · Unit {{number}}: {{title}}

{{guide?}}

The task as JSON. "instructions_ru" and "prompt_en" are shown to the learner; "reference_en" is the model answer, shown after checking and used by the grader; "focus" is the use of the unit the task was supposed to practise.
{{task}}

Decide:
- "requires_target": the target structure here is the use of the unit named in "focus", not any structure of the unit. Fill these fields first, then decide: "focus_structure" — which structure the "focus" point asks for; "needed_context" — what the situation must contain for that structure to be natural (annoyance, an action in progress, regret, no direct knowledge, an unreal condition and so on); "context_quote" — a quote from "prompt_en" that gives this context, or an empty string if there is none. "ok" is true only if "context_quote" is not empty and really gives the needed context. That the learner could answer naturally without the structure is not a failure.
- "no_leak": "prompt_en" does not contain the target structure — the use of the unit the task practises, ready to be copied into the answer — and neither "prompt_en" nor "instructions_ru" names or describes the grammar. Words that almost every English sentence has (e.g. articles in a unit about articles) are not a leak unless they are exactly the use being practised.
- "reference_ok": every "reference_en" is grammatically correct, uses the target structure according to the unit's rules and answers "prompt_en". It fails only for a grammar mistake, a target structure used against the unit's rules, or a change or loss of meaning that matters for the task (a part of the question left unanswered, something that contradicts it). American vocabulary (e.g. shoe store, movers) and small shades of word meaning are not a failure: mention them in "note_ru" but keep "ok" true.
- "focus_match": the task is built on its "focus" point.
- "prompt_ok": "prompt_en" is short and clear, does not list what the answer must contain or give example content, and does not repeat instructions about answer length or language.
For each, "note_ru": one short sentence in Russian on what is wrong (for "reference_ok" also on minor points that do not fail it); empty string if there is nothing to say.

Reply with only JSON: {"requires_target":{"focus_structure":"","needed_context":"","context_quote":"","ok":true,"note_ru":""},"no_leak":{"ok":true,"note_ru":""},"reference_ok":{"ok":true,"note_ru":""},"focus_match":{"ok":true,"note_ru":""},"prompt_ok":{"ok":true,"note_ru":""}}

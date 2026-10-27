# Типы заданий: определение и общий код

Как устроен тип задания в коде, что за него делает общий код, что лежит в содержимом области и что нужно, чтобы добавить тип или подключить его к области. Содержимое, оценка и общие правила промптов типов — в `exercise-spec.md`; правила конкретной области — в её `content/<key>/README.md`.

## Что такое тип

Тип — одно определение `TaskType<T>` (`src/server/tasks/types.ts`) в `src/server/tasks/<type>/index.ts`; там только код. Промпты типа — у каждой области свои, в `content/<key>/<type>/` (ниже). Определение держит только то, чем типы различаются:

| поле | что это |
|---|---|
| `type` | имя типа — значение `exercises.type` |
| `items` | сколько пунктов в плане фокуса: 6 у gap и choice (по пункту на предложение), 1 у открытых |
| `outputSchema` | JSON-схема ответа модели при генерации (structured outputs); держит только форму. Модель заполняет поля по порядку схемы, поэтому поля-пояснения (`target_note_ru`, `explain_ru`) идут после эталона или ключа, с которым должны сходиться |
| `generateValues` | необязательное: значения `generate.md`, нужные только этому типу (у free — `min` / `max` из `FREE_LENGTH`) |
| `normalize(raw, plan)` | ответ генерации → `content`: отбраковка, `focus` из плана (у gap/choice прорежен вместе с пунктами); не собрать задание — `TaskError` |
| `publicContent(c)` | что уходит клиенту до проверки: без ключей, эталонов, объяснений и `focus` |
| `sentences(c)` | готовые предложения задания с ответом в скобках — генератору как «уже было» |
| `parseAnswer(raw, c)` | ответ клиента → ответ типа; не той формы — `TaskError` с текстом для пользователя |
| `check` | `{ by: 'key', score(c, answer) }` — верно/неверно по пунктам (gap, choice) или `{ by: 'model', task(c) }` — значения описания задания для `grade-user.md`, с эталоном (rephrase, translate, free) |

Связь «тип ↔ форма данных» — в `src/server/exercises/types.ts`: `ContentByType`, `PublicContentByType`, `AnswerByType`.

## Что делает общий код

- **Реестр** (`tasks/registry.ts`, `typeOf(type)`) — единственный список определений. Из него берут конвейер, проверка, `publicContent` и `addAttempt` в `exercises` и `variety`.
- **Конвейер генерации** (`tasks/generate.ts`, `generate(type, unitId, { topic?, recent? })`) — один на все типы: юнит и его область (тип должен быть в её `types`), тема (случайная из `topics` области или из evals; тем нет — пустая строка), недавние задания (`variety.recent`, или из evals), план фокуса на `items` пунктов (с `focus-repeat.md`, если `items > 1`), загрузка промптов типа из `content/<key>/<type>/`, вызов модели со схемой типа, `normalize`, версия промпта. В `generate.md` подставляет общие значения — `book`, `section`, `number`, `title`, `guide`, `topic`, `seed`, `focus` (при `items > 1` — нумерованный план, иначе сам пункт), `recent` — и `generateValues` типа.
- **Проверка** (`tasks/grade.ts`, `grade(def, unitId, content, answer)`) — выбор по `check.by`. По ключу — `ClosedEvaluation` из `score`. Моделью — вызов с `grade-system.md` (каталог книги) и `grade-user.md` (юнит, `check.task(c)`, ответ) из области юнита, общая схема ответа и нормализация в `OpenEvaluation`.
- **Задания** (`tasks/index.ts`) — заготовка и выдача, `parseAnswer` → `grade` → запись попытки; трейсы и ошибки вызовов — `tasks/claude.ts`.
- **Содержимое области** (`src/server/content/`) — чтение и проверка `workspace.yaml` (`readSettings`, `workspaceContent(workspaceId)`), пути внутри `content/<key>/`, проверка при старте (`checkContent`).

## Содержимое области

Всё, что относится к области, — в одной папке `content/<key>/` (`key` — `workspaces.key`); в `src/server/tasks` только код, в `evals/` — только код наборов и `reports/`.

```
content/<key>/
  workspace.yaml            настройки области (ниже)
  README.md                 правила области: что требуют её промпты и почему
  <type>/                   по папке на каждый тип из types
    generate.md             генерация — всегда
    focus-repeat.md         генерация, items > 1 — пометка повторного пункта плана ({{point}})
    grade-system.md         проверка, check.by: 'model' — инструкции с {{catalog}}
    grade-user.md           проверка, check.by: 'model' — значения check.task и {{answer}}
    evals/
      generate-cases.yaml   случаи набора <type>-generate
      generate-judge.md     судья набора <type>-generate
      grade-cases.yaml      случаи набора <type>-grade (check.by: 'model')
```

Файлы в корне `<type>/` — промпты вызовов приложения; в `evals/` — набор `<type>-<вид>`: `<вид>-cases.yaml` и `<вид>-judge.md`. У всех файлов одного вызова — одна версия во front matter; имена версий уникальны глобально (`exercise-spec.md` §7). Общих текстов между типами и областями нет.

**`workspace.yaml`:**
- `types` — лестница типов области по нарастанию сложности: `{ type, fromM, difficulty, levelCap, memoryWeight, easy }`. Планировщик выдаёт только эти типы: тип юнита — по верхнему `fromM`, не выше освоения (у первого `fromM: 0`). Соседние типы с одинаковым `fromM` — **группа**: планировщик их чередует (давнее всего данный юниту тип — первым), константы у них совпадают; группа с первым типом невозможна (`planner.md` §4; у Grammar In Use — translate и free). `difficulty`, `levelCap`, `memoryWeight`, `easy` — константы типа в модели ученика (`DIFFICULTY`, `LEVEL_CAP`, `MEMORY_WEIGHT`, `EASY_TYPES`, `rating-model.md` §0). Эти же типы предлагает выбор у ▶ в строке юнита. Пустой список (`types: []`) допустим — область без заданий (ниже, «Подключить тип к области»).
- `topics` — темы контекста заданий. Пустой список допустим: тема не выбирается, в `exercises.topic` пишется пустая строка, а промпты генерации области `{{topic}}` не используют (проверка при старте) — так у Vocabulary In Use, где ситуация задана в каждом пункте «## Употребление».
- `rating` — переопределения общих констант модели (`rating-model.md` §0); пусто — умолчания из `learner/model.ts` (`DEFAULTS`).

Конфиг модели ученика и планировщика области — общие умолчания плюс `workspace.yaml` (`learner/config.ts`, `learnerConfig`); состояния юнитов считаются по конфигу их области.

**Проверка при старте** (`checkContent`, из `src/instrumentation.node.ts`): у каждой области из базы есть `content/<key>/workspace.yaml`, значения — в диапазонах `rating-model.md` §0 (лестница пустая или: `fromM` и `difficulty` по неубыванию, `levelCap` выше `difficulty`; у типов группы совпадают `difficulty`, `levelCap`, `memoryWeight`, `easy`; `fromM` 0 — только у первого типа), у каждого типа из `types` — нужные md с одной версией на вызов, имена версий не повторяются; при пустом `topics` в промптах генерации нет `{{topic}}`. Иначе — сообщение со всеми проблемами и выход с кодом 1: сервер не стартует.

## Добавить новый тип

1. **Формы данных** — в `exercises/types.ts`: имя в `EXERCISE_TYPES`, `ContentByType`, `PublicContentByType`, `AnswerByType`. Порядок в `EXERCISE_TYPES` ничего не значит — порядок сложности задаёт область.
2. **Миграция** — значение в `exercises_type_check` таблицы `exercises` (`npm run db:generate`, затем `db:migrate`).
3. **Определение типа** — `tasks/<type>/index.ts` с полями выше; строка в реестре `tasks/registry.ts`.
4. **Компонент** — `src/components/exercises/<Type>Exercise.tsx` и ветка в карте `AnyExercise`.
5. **Код наборов evals** — `evals/<type>-generate/index.ts` (и `evals/<type>-grade/index.ts` у проверки моделью) и строка в `SUITES` (`evals/run.ts`); случаи и судьи — у областей.
6. **Тесты** — `npm test`.

В выдачу тип попадает, только когда его подключат к области.

## Подключить тип к области

Область может существовать без типов: `types: []` (и `topics: []`) в `workspace.yaml`. Она видна в каталоге — юниты, guide, отметка «в работе», — но заданий по ней нет: планировщик возвращает null, плеера сессии и ▶ с выбором типа у юнитов нет. Так заводят область, у которой юниты и guide появляются в базе раньше промптов и evals (`content/vocabulary-in-use/`). Первый подключённый тип — с `fromM: 0`.

1. **`workspace.yaml`** — строка в `types` на место по сложности: `fromM` (с какого освоения его давать; тот же, что у соседа, — группа с ним, константы те же) и константы `difficulty`, `levelCap`, `memoryWeight`, `easy` в диапазонах `rating-model.md` §0; соседям при необходимости поправить `fromM`.
2. **Промпты** — `content/<key>/<type>/`: `generate.md` (и `focus-repeat.md` при `items > 1`, `grade-system.md` и `grade-user.md` у проверки моделью) под материал области; версии — с префиксом области (`<key>/<type>-gen-v1`). Правила, которые они требуют, — в `content/<key>/README.md`.
3. **Evals и судья** — `content/<key>/<type>/evals/`: `generate-cases.yaml` и `generate-judge.md`, у проверки моделью — `grade-cases.yaml` (задания и ответы с ожиданиями); порядок — `architecture.md`, «Evals».
4. **Проверка** — `npm run build` и старт сервера: `checkContent` скажет, чего не хватает; `npm run eval -- <набор> <key> --dry-run` — случаи читаются.
5. **Базовый прогон** — `npm run eval -- <набор> <key> --repeat 3 --report` по каждому набору; отчёт — база, с которой сравниваются следующие версии.

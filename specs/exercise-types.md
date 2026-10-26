# Типы заданий: определение и общий код

Как устроен тип задания в коде, что за него делает общий код и что нужно, чтобы добавить тип или подключить его к области. Содержимое, оценка и правила промптов каждого типа — в `exercise-spec.md`.

## Что такое тип

Тип — одно определение `TaskType<T>` (`src/server/tasks/types.ts`) в `src/server/tasks/<type>/index.ts`, рядом md-файлы его промптов. Определение держит только то, чем типы различаются:

| поле | что это |
|---|---|
| `type` | имя типа — значение `exercises.type` |
| `items` | сколько пунктов в плане фокуса: 6 у gap и choice (по пункту на предложение), 1 у открытых |
| `outputSchema` | JSON-схема ответа модели при генерации (structured outputs); держит только форму |
| `generateValues` | необязательное: значения `generate.md`, нужные только этому типу (у free — `min` / `max` из `FREE_LENGTH`) |
| `normalize(raw, plan)` | ответ генерации → `content`: отбраковка, `focus` из плана (у gap/choice прорежен вместе с пунктами); не собрать задание — `TaskError` |
| `publicContent(c)` | что уходит клиенту до проверки: без ключей, эталонов, объяснений и `focus` |
| `sentences(c)` | готовые предложения задания с ответом в скобках — генератору как «уже было» |
| `parseAnswer(raw, c)` | ответ клиента → ответ типа; не той формы — `TaskError` с текстом для пользователя |
| `check` | `{ by: 'key', score(c, answer) }` — верно/неверно по пунктам (gap, choice) или `{ by: 'model', task(c) }` — значения описания задания для `grade-user.md`, с эталоном (rephrase, translate, free) |

Связь «тип ↔ форма данных» — в `src/server/exercises/types.ts`: `ContentByType`, `PublicContentByType`, `AnswerByType`.

## Что делает общий код

- **Реестр** (`tasks/registry.ts`, `typeOf(type)`) — единственный список определений. Из него берут конвейер, проверка, `publicContent` и `addAttempt` в `exercises` и `variety`.
- **Конвейер генерации** (`tasks/generate.ts`, `generate(type, unitId, { topic?, recent? })`) — один на все типы: юнит, тема (случайная или из evals), недавние задания (`variety.recent`, или из evals), план фокуса на `items` пунктов (с `focus-repeat.md`, если `items > 1`), загрузка промптов типа, вызов модели со схемой типа, `normalize`, версия промпта. В `generate.md` подставляет общие значения — `book`, `section`, `number`, `title`, `guide`, `topic`, `seed`, `focus` (при `items > 1` — нумерованный план, иначе сам пункт), `recent` — и `generateValues` типа.
- **Проверка** (`tasks/grade.ts`, `grade(def, unitId, content, answer)`) — выбор по `check.by`. По ключу — `ClosedEvaluation` из `score`. Моделью — вызов с `grade-system.md` (каталог книги) и `grade-user.md` (юнит, `check.task(c)`, ответ), общая схема ответа и нормализация в `OpenEvaluation`.
- **Задания** (`tasks/index.ts`) — заготовка и выдача, `parseAnswer` → `grade` → запись попытки; трейсы и ошибки вызовов — `tasks/claude.ts`.

## Что лежит у типа в промптах

| файл | когда нужен |
|---|---|
| `generate.md` | всегда — промпт генерации целиком |
| `focus-repeat.md` | `items > 1` — пометка повторного пункта плана (`{{point}}`) |
| `grade-system.md`, `grade-user.md` | `check.by: 'model'` — инструкции с `{{catalog}}`; описание задания со значениями `check.task` и `{{answer}}` |

У всех файлов одного вызова — одна версия во front matter. Общих текстов между типами нет (`exercise-spec.md` §7).

## Добавить новый тип

1. **Формы данных** — в `exercises/types.ts`: имя в `EXERCISE_TYPES` (по нарастанию сложности — так его выбирает планировщик), `ContentByType`, `PublicContentByType`, `AnswerByType`.
2. **Миграция** — значение в `exercises_type_check` таблицы `exercises` (`npm run db:generate`, затем `db:migrate`).
3. **Определение типа** — `tasks/<type>/index.ts` с полями выше и md-файлы промптов; строка в реестре `tasks/registry.ts`. Готов к выдаче — в `READY_TYPES` (`tasks/types.ts`).
4. **Компонент** — `src/components/exercises/<Type>Exercise.tsx` и ветка в карте `AnyExercise`.
5. **Рейтинг и планировщик** — значения типа в `CONFIG` (`DIFFICULTY`, `LEVEL_CAP`, `MEMORY_WEIGHT`, `EASY_TYPES`; `learner/model.ts`, `rating-model.md`) и порог в `PLANNER_CONFIG.TYPE_THRESHOLDS` (`planner.md`).
6. **Тесты** — `npm test`: тесты модели и планировщика дополнить новым типом.

## Подключить тип к области

1. **Промпты** — `generate.md` (и `grade-*.md` у проверки моделью) под материал области.
2. **Evals и судья** — наборы `evals/<type>-generate/` (`index.ts`, `judge.md`, `cases/<область>.yaml`) и, у проверки моделью, `evals/<type>-grade/` (задания и ответы с ожиданиями); порядок — `architecture.md`, «Evals».
3. **Базовый прогон** — `npm run eval -- <набор> <область> --repeat 3 --report` по каждому набору; отчёт — база, с которой сравниваются следующие версии.

## Константы рейтинга по типам

`DIFFICULTY`, `LEVEL_CAP`, `MEMORY_WEIGHT`, `EASY_TYPES` пока в `CONFIG` (`learner/model.ts`) и в определение типа не входят: следующим шагом они переедут в настройки области. Пороги выбора типа — `TYPE_THRESHOLDS` в `PLANNER_CONFIG`.

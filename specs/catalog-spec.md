# Модуль «Каталог»: спецификация

Часть тренажёра грамматики (см. `architecture.md`). Каталог хранит юниты книг: названия, порядок, описание для генерации заданий и зависимости. Остальные модули ссылаются на юниты только по `id`.

## 1. Что входит в модуль

- Таблица `units` в Supabase Postgres.
- Начальный импорт оглавления English Grammar in Use, 5th edition (145 юнитов) из CSV.
- Скрипт генерации описаний (`summary_ru`, `guide`, `builds_on`) через Claude API.
- Валидатор каталога.
- Серверный модуль доступа: чтение юнитов и их представления для промптов.
- Экспорт каталога в JSON для бэкапа.

Не входит: интерфейс правки каталога (правка через Supabase Table Editor), прогресс пользователя, отметки «в работе» и «прочитал теорию» — это другие модули.

## 2. Схема

Миграция Supabase:

```sql
create table public.units (
  id           bigint generated always as identity primary key,
  book         text      not null,                 -- "English Grammar in Use"
  section      text      not null,                 -- "Present and past", точно как в книге
  number       integer,                            -- номер в книге; null для своих юнитов вне книги
  position     integer   not null unique,          -- общий порядок всех юнитов, шаг 10
  title        text      not null,                 -- точно как в книге
  summary_ru   text      not null default '',      -- одна строка для интерфейса
  guide        text      not null default '',      -- markdown по шаблону из раздела 3
  builds_on    integer[] not null default '{}',    -- id юнитов, которые желательно знать до этого
  reviewed     boolean   not null default false,   -- описание сверено с книгой
  updated_at   timestamptz not null default now(),
  unique (book, number)
);

create index units_book_idx on public.units (book);

-- updated_at при любой правке, в том числе из Table Editor
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

create trigger units_touch before update on public.units
for each row execute function public.touch_updated_at();

-- приложение однопользовательское, читает каталог только сервер (service role)
alter table public.units enable row level security;
```

### Правила полей

| Поле | Правило |
|---|---|
| `id` | выдаёт база, никогда не меняется и не переиспользуется. На него ссылаются лог попыток и состояния модели ученика. Юниты не удаляются (при необходимости можно добавить флаг архива) |
| `book`, `section` | строки, точно как в книге. Отдельных таблиц книг и разделов нет; порядок разделов выводится из `position` их юнитов |
| `number` | номер из оглавления; пара `(book, number)` уникальна. `null` — свой юнит, которого нет в книге |
| `position` | глобальный уникальный порядок, шаг 10. Книга EGU5 занимает 10–1450 (`number × 10`). Свой юнит между 190 и 200 получает 195. Порядок между книгами значения не имеет, он только для отображения |
| `title` | точно как в оглавлении, не переводится и не сокращается |
| `summary_ru` | одна строка до ~100 символов, по-русски, о чём юнит. Для списка юнитов в интерфейсе |
| `guide` | markdown по шаблону раздела 3. Целиком уходит в промпт генерации и проверки заданий |
| `builds_on` | id юнитов (любой книги), которые желательно знать до этого. Только прямые зависимости, обычно 0–3 |
| `reviewed` | `true`, когда вы сверили `summary_ru`, `guide` и `builds_on` с книгой. Генератор описаний не трогает проверенные юниты |

## 3. Шаблон guide

Пять разделов, заголовки точно такие, в этом порядке. Пишется по-русски, примеры на английском.

```markdown
## Фокус
Одно-два предложения: что именно тренирует юнит.

## Формы
- ключевые формы и конструкции юнита

## Употребление
- случаи употребления с короткими примерами на английском

## Типичные ошибки
- типичные ошибки русскоязычных в этой теме (что говорят неправильно и как правильно)

## Не входит в юнит
- соседние темы, которые генератор не должен смешивать с этим юнитом, со ссылкой на номер юнита
```

Пример для юнита 19:

```markdown
## Фокус
Present continuous для договорённостей и present simple для расписаний, когда речь о будущем.

## Формы
- am/is/are + -ing с указанием времени в будущем
- present simple для расписаний и программ

## Употребление
- личные договорённости: I'm meeting Tom tomorrow.
- расписания транспорта, кино, мероприятий: The train leaves at 9.

## Типичные ошибки
- will вместо present continuous для уже договорённого: *I will meet Tom tomorrow* → I'm meeting Tom tomorrow.
- present continuous для расписаний: *The film is starting at 8* → The film starts at 8.

## Не входит в юнит
- going to — юнит 20
- will и shall — юниты 21–22
```

## 4. Типы и интерфейс

```ts
export type Unit = {
  id: number;
  book: string;
  section: string;
  number: number | null;
  position: number;
  title: string;
  summaryRu: string;
  guide: string;
  buildsOn: number[];
  reviewed: boolean;
  updatedAt: string;
};
```

Серверный модуль `catalog` (только на сервере, через service role):

| Функция | Что делает |
|---|---|
| `listUnits(book?)` | юниты в порядке `position` |
| `getUnit(id)` | юнит или ошибка «не найден» |
| `getUnits(ids)` | несколько юнитов по id |
| `findByNumber(book, number)` | юнит по номеру в книге |
| `searchUnits(query)` | по номеру, названию, `summary_ru`, разделу; без учёта регистра |
| `unitForPrompt(id)` | текст для промпта генерации: книга, раздел, номер, название, `guide` |
| `catalogForPrompt(ids)` | компактный список `id. title` для промпта проверки — только переданные юниты |

`catalogForPrompt` принимает список id, а не книгу. По решению из `architecture.md` проверка получает только юниты, по которым пользователь прочёл теорию. Пока этой отметки нет, передаются все юниты книги.

Каталог читается часто и меняется редко: допустим кэш в памяти процесса с коротким временем жизни (например, 60 секунд), чтобы правки из Table Editor подхватывались без перезапуска.

## 5. Валидатор

Скрипт `npm run catalog:validate` читает таблицу и выводит все нарушения (а не только первое). Ошибки:

1. `title`, `book`, `section` не пустые.
2. Номера юнитов внутри книги идут подряд от 1, без пропусков (юниты с `number = null` не учитываются).
3. Все id в `builds_on` существуют; юнит не ссылается сам на себя; в графе `builds_on` нет циклов.
4. Для EGU5: `title` и `section` совпадают с исходным CSV оглавления.

Предупреждения (не ошибки):

5. Пустой `summary_ru` или `guide`.
6. В непустом `guide` нет одного из пяти разделов, разделы не в том порядке или какой-то пустой.
7. `summary_ru` длиннее 120 символов.
8. Юнит раздела идёт по `position` не подряд с остальными юнитами раздела.

## 6. Импорт оглавления

Скрипт `npm run catalog:import -- data/egu5-units.csv`. CSV: `unit,section,title`.

- Для каждой строки: `book = "English Grammar in Use"`, `section`, `number = unit`, `position = unit × 10`, `title`, остальное по умолчанию.
- Идемпотентно: если юнит с таким `(book, number)` уже есть, обновляются только `section` и `title`; `id`, `summary_ru`, `guide`, `builds_on`, `reviewed` не трогаются.
- После импорта запускается валидатор.

## 7. Генерация описаний

Скрипт `npm run catalog:describe` заполняет `summary_ru`, `guide` и `builds_on` через Claude API.

- Обрабатывает только юниты с `reviewed = false`. Флаги: `--book`, `--from`/`--to` (по номеру), `--only-empty` (пропускать юниты, где `guide` уже заполнен).
- Модель — самая сильная доступная (на момент написания `claude-opus-5-5`); задаётся через `CATALOG_MODEL`. Разовая задача, ~145 запросов.
- **Сначала dry run:** результат пишется в `out/catalog-describe-<дата>.json` (по юниту: было → стало). В базу пишет только флаг `--apply`, который берёт этот файл.
- Ответ модели проверяется до записи: валидный JSON, все пять разделов `guide`, `builds_on` — только существующие id. Ошибочные юниты пропускаются и перечисляются в конце.
- Каталог книги (id, номер, раздел, название) кэшируется в system prompt (prompt caching): он одинаков для всех запросов.

### Промпт

System (кэшируется):

```
You write reference notes for a grammar trainer used by a Russian-speaking adult learner of English (around B2).
The trainer generates and grades exercises for one unit of Raymond Murphy's "English Grammar in Use" (5th edition) at a time; your notes are given to the exercise generator and the grader.

Catalog of the book (id. [section] number — title):
{{для каждого юнита: `${id}. [${section}] ${number} — ${title}`}}

For the unit you are given, reply with only JSON:
{
  "summary_ru": "one line in Russian, up to 100 characters: what the unit is about",
  "guide": "markdown in Russian with exactly these headings in this order: ## Фокус, ## Формы, ## Употребление, ## Типичные ошибки, ## Не входит в юнит",
  "builds_on": [ids from the catalog]
}

Rules for "guide":
- Describe the grammar this unit covers in the book, in your own words. Do not quote the book.
- ## Фокус: 1–2 sentences.
- ## Формы: the key forms and patterns, as a list.
- ## Употребление: the uses covered by this unit, each with a short English example.
- ## Типичные ошибки: 2–4 mistakes typical for Russian speakers on this topic, each as a wrong English phrase and the correct one.
- ## Не входит в юнит: nearby topics that belong to other units, each with the unit number, so the generator does not mix them in.
- Russian text, English examples. No other headings.

Rules for "builds_on":
- Only direct prerequisites: units whose grammar a learner needs to handle this unit's exercises.
- Usually 0–3 ids, normally earlier units of the book. Empty array if none.
```

User (на каждый юнит):

```
Unit id {{id}}: [{{section}}] {{number}} — {{title}}
Neighbouring units in the section: {{номер и название двух предыдущих и двух следующих юнитов}}
```

## 8. Экспорт

Скрипт `npm run catalog:export` пишет всю таблицу в `data/catalog.json` (по `position`, с отступами), чтобы правки каталога были видны в git и был бэкап. Источник истины — база.

## 9. Подключение к модулю заданий

- Генерация задания берёт описание юнита через `unitForPrompt(unitId)` вместо прежней однострочной `desc`.
- Проверка получает каталог через `catalogForPrompt(ids)`; модель в ответе ссылается на эти `id`.
- В прототипе (`grammar-drill.html`) юниты идентифицировались номером в книге. При переносе номера переводятся в `id` через `findByNumber("English Grammar in Use", number)`. Совпадение `id` и `number` после импорта не предполагать.

## 10. Тесты

- Валидатор: на фикстурах ловит каждое правило из раздела 5 (пропуск номера, несуществующий `builds_on`, цикл, отсутствующий раздел `guide` и т. д.).
- Импорт: повторный запуск не меняет `id` и не затирает `guide` и `reviewed`.
- `searchUnits`: по номеру («19»), по части названия («perfect»), по разделу, без учёта регистра.
- `catalogForPrompt`: только переданные id, в порядке `position`.
- Разбор ответа генератора описаний: валидный ответ принимается, ответ без раздела или с чужим id отклоняется.

## 11. Шаги и критерии готовности

1. **Миграция** — таблица, триггер, RLS. Готово: таблица видна в Supabase.
2. **Импорт** — 145 юнитов EGU5. Готово: валидатор без ошибок (только предупреждения о пустых описаниях).
3. **Модуль доступа и тесты.** Готово: тесты проходят.
4. **Генерация описаний** — dry run на 5 юнитах, просмотр результата, затем на всех. Готово: валидатор без предупреждений по `guide`.
5. **Экспорт.** Готово: `data/catalog.json` в репозитории.
6. **Подключение к заданиям.** Готово: генерация и проверка используют `guide` и `id` из базы.
7. **Сверка с книгой** — ваша работа, по мере прохождения разделов: правка в Table Editor и `reviewed = true`.

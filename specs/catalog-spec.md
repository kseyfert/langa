# Модуль «Каталог»: спецификация

Часть тренажёра грамматики (см. `architecture.md`). Каталог хранит юниты книг: названия, порядок, описание для генерации заданий и зависимости. Остальные модули ссылаются на юниты только по `id`.

## 1. Что входит в модуль

- Таблица `units` в Supabase Postgres: схема в Drizzle, миграция через drizzle-kit.
- Серверный модуль доступа: чтение юнитов и их представления для промптов.
- Страница просмотра каталога.

Не входит: интерфейс правки каталога (правка через Supabase Table Editor), прогресс пользователя, отметки «в работе» и «прочитал теорию» — это другие модули.

Позже, отдельными шагами: импорт оглавления EGU5 из `data/egu5-units.csv`, генерация описаний (`summary_ru`, `guide`, `builds_on`) через Claude API.

## 2. Подключение

- Supabase в облаке используется как обычный Postgres: Drizzle ORM + драйвер `postgres` (postgres-js).
- Одна переменная `DATABASE_URL` — строка **session pooler** Supabase (`<region>.pooler.supabase.com:5432`). Ею пользуются и приложение, и миграции. Transaction pooler (6543) не нужен: процесс один и долгоживущий. Прямое подключение (`db.<project>.supabase.co`) доступно только по IPv6.
- Пул клиента небольшой (`max: 5`): у session pooler ограничено число соединений.
- Подключение и ключи только на сервере.

## 3. Схема

Источник истины — схема Drizzle в TypeScript. Миграция должна дать в базе следующее:

```sql
create table public.units (
  id           bigint generated always as identity primary key,
  book         text      not null,                 -- "English Grammar in Use"
  section      text      not null,                 -- "Present and past", точно как в книге
  number       integer,                            -- номер в книге; null для своих юнитов вне книги
  position     integer   not null unique,          -- общий порядок всех юнитов, шаг 10
  title        text      not null,                 -- точно как в книге
  summary_ru   text      not null default '',      -- одна строка для интерфейса
  guide        text      not null default '',      -- markdown для промптов генерации и проверки
  builds_on    bigint[]  not null default '{}',    -- id юнитов, которые желательно знать до этого
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

-- приложение однопользовательское, читает каталог только сервер
alter table public.units enable row level security;
```

Триггер и RLS drizzle-kit сам не генерирует: они дописываются SQL-ом в миграцию вручную. `$onUpdate` из Drizzle не годится — правки из Table Editor идут мимо приложения.

`bigint`-поля в Drizzle объявляются с `mode: "number"`, чтобы в JS приходил обычный `number`.

### Правила полей

| Поле | Правило |
|---|---|
| `id` | выдаёт база, никогда не меняется и не переиспользуется. На него ссылаются лог попыток и состояния модели ученика. Юниты не удаляются (при необходимости можно добавить флаг архива) |
| `book`, `section` | строки, точно как в книге. Отдельных таблиц книг и разделов нет; порядок разделов выводится из `position` их юнитов |
| `number` | номер из оглавления; пара `(book, number)` уникальна. `null` — свой юнит, которого нет в книге |
| `position` | глобальный уникальный порядок, шаг 10. Книга EGU5 занимает 10–1450 (`number × 10`). Свой юнит между 190 и 200 получает 195. Порядок между книгами значения не имеет, он только для отображения |
| `title` | точно как в оглавлении, не переводится и не сокращается |
| `summary_ru` | одна строка по-русски, о чём юнит. Для списка юнитов в интерфейсе |
| `guide` | markdown, целиком уходит в промпт генерации и проверки заданий. Формат определим вместе с генерацией описаний |
| `builds_on` | id юнитов (любой книги), которые желательно знать до этого. Только прямые зависимости, обычно 0–3 |
| `reviewed` | `true`, когда описание сверено с книгой |

## 4. Типы и модуль доступа

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

Серверный модуль `catalog` (только на сервере):

| Функция | Что делает |
|---|---|
| `listUnits(book?)` | юниты в порядке `position` |
| `getUnit(id)` | юнит или ошибка «не найден» |
| `getUnits(ids)` | несколько юнитов по id, в порядке `position` |
| `findByNumber(book, number)` | юнит по номеру в книге или `null` |
| `searchUnits(query)` | по номеру, названию, `summary_ru`, разделу; без учёта регистра |
| `unitForPrompt(id)` | текст для промпта генерации: книга, раздел, номер, название, `guide` (пока `guide` пуст — `summary_ru`) |
| `catalogForPrompt(ids)` | компактный список `id. title` для промпта проверки — только переданные юниты, в порядке `position` |

`catalogForPrompt` принимает список id, а не книгу. По решению из `architecture.md` проверка получает только юниты, по которым пользователь прочёл теорию. Пока этой отметки нет, передаются все юниты книги.

## 5. Страница каталога

`/catalog` — просмотр, без правки. Вид — по `design.md`.

- Заголовок «Каталог», под ним строка `.muted`: сколько юнитов, сколько разделов.
- Юниты сгруппированы по разделам в порядке `position`: подзаголовок раздела капителью, ниже список строк через линейку. Строка: номер (`.mono`), название (вес 550), `summary_ru` (`.muted --t-xs`).
- Пустой каталог: «Каталог пуст. Загрузи юниты: npm run import:units -- файл.csv».

## 6. Подключение к модулю заданий

- Генерация задания берёт описание юнита через `unitForPrompt(unitId)` вместо прежней однострочной `desc`.
- Проверка получает каталог через `catalogForPrompt(ids)`; модель в ответе ссылается на эти `id`.
- В прототипе (`reference/grammar-drill.html`) юниты идентифицировались номером в книге. При переносе номера переводятся в `id` через `findByNumber("English Grammar in Use", number)`. Совпадение `id` и `number` после импорта не предполагать.

## 7. Шаги и критерии готовности

1. **Каркас** — Next.js + TypeScript, стили и шрифты по `design.md`, Drizzle, `.env.example`. Готово: `npm run dev` поднимает приложение.
2. **Миграция** — таблица, триггер, RLS. Готово: таблица видна в Supabase.
3. **Модуль доступа.** Готово: функции из раздела 4 работают на базе.
4. **Страница каталога.** Готово: `/catalog` показывает юниты из базы (или пустое состояние).

# Photo Composer (Node.js + sharp)

HTTP-сервис для n8n: принимает данные и фото, обрезает фото в формат 4:5, накладывает на шаблон, добавляет текст (капслок, чёрный шрифт Helvetica/альтернатива) и возвращает готовый JPEG бинарником.

## Быстрый старт

1) Установите зависимости:

```bash
npm install
```

2) Положите файл шаблона изображения по пути `assets/templates/default.png` (или задайте `TEMPLATE_PATH`).

3) Запустите сервис:

```bash
npm run start
```

Проверка:

```bash
curl -f http://localhost:3000/healthz
```

## Эндпоинт

POST `/compose` (multipart/form-data)
- `photo` (file, обязательное)
- `name` (string)
- `agentNumber` (string)
- `city` (string)
- `eyeColor` (string)
- `cover` (string)
- `recruitmentDate` (string)

Ответ: `image/jpeg` (бинарник). Заголовок `Content-Disposition: inline; filename="composed.jpg"`.

Пример:

```bash
curl -X POST http://localhost:3000/compose \
  -F "photo=@/path/to/photo.jpg" \
  -F "name=Иван Иванов" \
  -F "agentNumber=007" \
  -F "city=Москва" \
  -F "eyeColor=ЗЕЛЁНЫЕ" \
  -F "cover=ДИПЛОМАТ" \
  -F "recruitmentDate=2024-01-10" \
  -o composed.jpg
```

## Координаты и шаблон

Координаты и размеры заданы в `src/server.js` (объект `LAYOUT`).
- `photoBox` определяет позицию и размер окна под фото (соотношение 4:5).
- Текстовые поля (`name`, `agentNumber`, `city`, `eyeColor`, `cover`, `recruitmentDate`) имеют координаты `x`, `y` и `fontSize`.

Отрегулируйте значения под ваш шаблон (размер шаблона, положение фото и надписей).

## Шрифты

По умолчанию используется `FONT_FAMILY="Helvetica, \"Liberation Sans\", Arial, sans-serif"`.
- Helvetica требует лицензию и наличия шрифта в системе/контейнере.
- Альтернативы без лицензии: Liberation Sans, Nimbus Sans, DejaVu Sans.

В Dockerfile добавлены свободные шрифты. Можно изменить `FONT_FAMILY` через переменные окружения.

## Переменные окружения

- `PORT` (по умолчанию `3000`)
- `HOST` (по умолчанию `0.0.0.0`)
- `TEMPLATE_PATH` (путь к картинке-шаблону)
- `TEMPLATE_NAME` (имя файла шаблона в `assets/templates/` без расширения)
- `FONT_FAMILY` (CSS-стек шрифтов для SVG-текста)
- `JPEG_QUALITY` (качество JPEG 1–100, по умолчанию 90)

## Docker

Сборка и запуск:

```bash
docker build -t photo-composer .
docker run --rm -p 3000:3000 \
  -e TEMPLATE_PATH=/app/assets/templates/default.png \
  -v $(pwd)/assets/templates:/app/assets/templates \
  photo-composer
```

Убедитесь, что в томе присутствует `default.png`.

## n8n подсказки

- Отправляйте `multipart/form-data` с полем `photo` + остальные поля как текст.
- Имя полей должно совпадать с перечисленными выше.

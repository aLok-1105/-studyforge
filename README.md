# Studyforge

Studyforge is a locally hosted assessment builder for teachers, professors, and other educators. It uses a local Ollama model to draft classroom questions from supplied course material, previews the assessment in the browser, and exports a print-ready PDF.

Generated content is an AI draft. Review questions, answer keys, and age or course suitability before using an assessment with students.

## Features

- Generate multiple-choice, short-answer, and long-answer questions.
- Set an assessment title, course or subject, grade or level, student instructions, question counts, and difficulty.
- Preview the generated questions and answer key in the browser.
- Download a PDF with student name and date fields.
- Choose whether the PDF includes a teacher answer key on a separate page.
- Run the language model locally with Docker Compose and Ollama.

## Requirements

- Node.js 18 or newer
- npm
- Docker Desktop with Docker Compose

## Run locally

Open a terminal in the project folder and start the Ollama service:

```powershell
docker compose up -d
```

The Compose service starts Ollama and pulls the default `gemma3:270m` model. The first model download can take a while. Follow the container logs to see when it is ready:

```powershell
docker compose logs -f ollama
```

Once the model has finished downloading, open another terminal in the project folder, install the Node.js dependencies, and start Studyforge:

```powershell
npm install
npm start
```

Open [http://localhost:8000](http://localhost:8000) in a browser.

For development with automatic server restarts:

```powershell
npm run dev
```

To stop the model service:

```powershell
docker compose down
```

The `ollama_data` Docker volume keeps the downloaded model between restarts. To remove that volume and the downloaded model as well:

```powershell
docker compose down --volumes
```

## Configuration

The server loads environment variables from a `.env` file in the project folder. All settings are optional for the default local setup.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8000` | Port for the Studyforge web app and API. |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | OpenAI-compatible Ollama API URL. |
| `OLLAMA_API_KEY` | `ollama` | API key sent to the local Ollama endpoint. Ollama's local endpoint does not require a real key by default. |
| `OLLAMA_MODEL` | `gemma3:270m` | Model name to use for question generation. The model must be available in Ollama. |
| `FRONTEND_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated origins allowed by the API CORS policy. The bundled UI is served by Express and does not need a separate frontend origin. |

Example `.env`:

```dotenv
PORT=8000
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_API_KEY=ollama
OLLAMA_MODEL=gemma3:270m
```

If the Studyforge server itself is later run inside Docker on the same Compose network as Ollama, set `OLLAMA_BASE_URL` to `http://ollama:11434/v1` instead of `localhost`.

To use another model, change `OLLAMA_MODEL` and make sure that model is pulled into Ollama. The current Compose file pulls `gemma3:270m` on startup.

## Prepare an assessment

1. Enter an assessment title and, optionally, a course or subject and grade or level.
2. Paste source material, lecture notes, learning objectives, or a topic.
3. Optionally add instructions that should appear on the student copy.
4. Choose how many multiple-choice, short-answer, and long-answer questions to generate. Set a type to `0` to omit it.
5. Select the desired difficulty and choose **Generate assessment**.
6. Review the questions and answer key in the preview. Edit or verify the generated content before administering the test.
7. Choose **Include answer key in PDF** for a teacher copy, or turn it off for a student copy, then select **Download test PDF**.

The assessment PDF uses the assessment title as its filename and includes course and grade details when provided, student name/date fields, and any student instructions.

## API

The Express server also exposes these endpoints:

### `POST /api/ask`

Generates an assessment draft. Example request:

```json
{
  "assessmentTitle": "Unit 3: Cell Biology",
  "course": "Biology 101",
  "gradeLevel": "Grade 10",
  "instructions": "Answer all questions.",
  "chapter": "Photosynthesis converts light energy into chemical energy...",
  "type": {
    "mcq": 5,
    "short_question": 3,
    "long_question": 1
  },
  "difficulty": "medium"
}
```

Supported question type keys are `mcq`, `short_question`, and `long_question`. Each included count must be an integer from 1 to 50. Difficulty must be `easy`, `medium`, or `hard`. The response contains the generated assessment in the `answer` property.

### `POST /api/download-pdf`

Creates a PDF from the assessment text. Provide `markdown` with the generated assessment and optionally provide `assessmentTitle`, `course`, `gradeLevel`, `instructions`, and `includeAnswerKey` (a boolean, defaulting to `true`). The response is an `application/pdf` attachment.

## Project layout

```text
.
├── docker-compose.yml   # Local Ollama service and persistent model volume
├── index.js             # Express API, Ollama integration, and PDF generation
├── public/
│   ├── app.js           # Assessment form and API interactions
│   ├── index.html       # Educator-facing interface
│   └── styles.css       # Responsive UI styles
├── package.json
└── package-lock.json
```

## Deployment and privacy

The included Compose file runs Ollama locally; the Node.js app is started separately on the host. Source material is sent to the configured model endpoint when generating questions. With the default configuration, that endpoint is the local Ollama service.

The current application does not provide teacher accounts, saved assessment history, or access control. Do not expose it to a public network or use it to process sensitive student information without first adding appropriate authentication, authorization, and data-protection controls.

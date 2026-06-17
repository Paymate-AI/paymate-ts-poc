# WhatsApp Bot Webhook Service

A Fastify-based TypeScript webhook service that serves as the entry point and handler for a WhatsApp bot. It integrates with the Meta Cloud WhatsApp API to receive and send messages, and bridges to a Python AI service to determine responses and process actions.

## Project Structure

- `src/index.ts` — Application entry point. Configures and starts the Fastify server on port 8080.
- `src/routes/webhook.ts` — GET & POST route handlers for `/webhook`.
- `src/services/whatsapp.ts` — Client for sending text messages via Meta Cloud API.
- `src/services/python-bridge.ts` — Client for communication with the Python AI service.
- `src/types/index.ts` — Shared TypeScript interfaces for webhook payloads and service schemas.
- `.env.example` — Environment variables template.
- `Dockerfile` — Production multi-stage Docker build.

---

## Prerequisites

- Node.js (v20.x recommended)
- npm or yarn
- Meta WhatsApp Business Developer account with a verified phone number ID and access token.

---

## Setup & Local Development

1. **Clone the repository and install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   Copy the example environment file and fill in your details:
   ```bash
   cp .env.example .env
   ```

   Configure the following parameters in `.env`:
   - `WHATSAPP_TOKEN`: Meta Cloud API Access Token.
   - `PHONE_NUMBER_ID`: WhatsApp Phone Number ID from the App dashboard.
   - `VERIFY_TOKEN`: A custom string token used to verify your webhook during setup.
   - `PYTHON_SERVICE_URL`: URL of the running Python AI service (e.g. `http://localhost:5000`).
   - `INTERNAL_SECRET`: Authentication token shared between the webhook and the Python service.
   - `PORT`: Server port (defaults to `8080`).

3. **Start the development server:**
   Uses `tsx watch` to auto-restart on changes:
   ```bash
   npm run dev
   ```

4. **Verify compilation:**
   Compile TS files to check for type errors:
   ```bash
   npm run build
   ```

---

## Webhook Verification (GET /webhook)

When registering your webhook URL in the Meta developer dashboard, configure:
- **Callback URL**: `https://<your-domain>/webhook`
- **Verify Token**: Must match the value of `VERIFY_TOKEN` in your `.env`.

The GET handler verifies this matching value and returns the challenge.

---

## Docker Support

To build the Docker image locally:
```bash
docker build -t whatsapp-webhook-service .
```

To run the container locally on port 8080:
```bash
docker run -p 8080:8080 --env-file .env whatsapp-webhook-service
```

---

## Deploying to Google Cloud Run

To build and deploy the service directly to Google Cloud Run:

```bash
gcloud run deploy whatsapp-webhook-service \
  --source . \
  --port 8080 \
  --region us-central1 \
  --allow-unauthenticated
```

During deployment, Cloud Run will automatically use the `Dockerfile` in the root directory. You will be prompted to set or provide environment variables, or you can supply them via command-line arguments or Secret Manager.

# Contributing to Kalamio

Thanks for your interest in Kalamio! Bug fixes, features, docs, tests, and design
feedback are all welcome. This guide gets you from zero to a merged pull request.

## Before you start

- **Read the [Code of Conduct](CODE_OF_CONDUCT.md).** We expect everyone to follow it.
- **Sign the [CLA](CLA.md).** When you open your first pull request, the CLA Assistant bot
  comments with a link. Signing takes one click with your GitHub account, and you only do
  it once. You keep the copyright to your work — the CLA explains exactly what you grant.
- **Pick something to work on.** Issues labeled
  [`good first issue`](https://github.com/kalamiohq/kalamio/labels/good%20first%20issue) are
  a great start. Comment on the issue to say you're taking it, so two people don't build the same thing.
- **Discuss big changes first, and wait for the `accepted` label.** For a new feature or a
  large refactor, open an issue before writing code, so we can agree on the approach. Once we
  agree it fits Kalamio and how it should be built, a maintainer adds the
  [`accepted`](https://github.com/kalamiohq/kalamio/labels/accepted) label — that's your go-ahead.
  Ticking "I'd like to work on this myself" on the issue doesn't count as the go-ahead. Pull
  requests for features without an accepted issue may be closed. Bug fixes, docs, and tests
  don't need the label.
- **Found a security problem?** Don't open a public issue — follow [SECURITY.md](SECURITY.md).

## Local setup

You don't need any cloud accounts. Docker runs a local database, Redis, S3-compatible
image storage, and an email inbox for you.

**Prerequisites:** [Node.js 22](https://nodejs.org/) (see `.nvmrc`), and
[Docker](https://docs.docker.com/get-docker/) with Compose.

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/kalamio.git
cd kalamio

# 2. Start the local services (MongoDB, Redis, storage, email)
docker compose up -d

# 3. Create env files — the examples already work with the local services
cp server/.env.example server/.env
cp frontend/.env.example frontend/.env

# 4. Install dependencies
cd server && npm install && cd ..
cd frontend && npm install && cd ..

# 5. Fill the local database with demo users and articles
cd server && npm run seed && cd ..

# 6. Run the API and the app (two terminals)
cd server && npm run dev        # API on http://localhost:8080
cd frontend && npm run dev      # app on http://localhost:5173
```

Open http://localhost:5173 and log in as **`demo@example.com`** with password **`Demo1234`**.
The seed creates six writers (all with that password), twelve articles across every home page
topic, comments, likes, follows, a publication and a draft. Log in as two different users in
two browsers to test likes, follows and chat. The welcome article lists every account.

You can also sign up with your own email: the verification code is "emailed" to the local
inbox at **http://localhost:8025**.

| What | Where |
|---|---|
| App | http://localhost:5173 |
| API | http://localhost:8080 |
| Email inbox (Mailpit) | http://localhost:8025 |
| Uploaded images (RustFS console) | http://localhost:9001 — login `kalamio` / `kalamio-dev-secret` |
| MongoDB | `mongodb://localhost:27017/kalamio` (use MongoDB Compass to browse) |

**Useful commands**

```bash
docker compose ps         # check the services are running
docker compose down       # stop them (your data is kept)
docker compose down -v    # stop and wipe all local data
npm run seed -- --reset   # (in server/) wipe the local database and seed it again
```

The seed only runs against local services: it refuses to touch MongoDB Atlas, real AWS S3,
or anything with `NODE_ENV=production`.

**Optional features** — Google sign-in and Upstash response caching are off by default.
The app works fine without them. See `server/.env.example` if you want to turn them on.

### Troubleshooting

- **API calls go to `undefinedapi/v1/...`** — `frontend/.env` is missing. Create it (step 3)
  and restart `npm run dev`; Vite only reads env files at startup.
- **"Missing required environment variables"** — `server/.env` is missing (step 3).
- **Port already in use** — something else uses 27017, 6379, 9000, 9001, 1025 or 8025.
  Stop it, or change the left-hand port in `docker-compose.yml`.

## Project structure

```
frontend/          React 18 + Vite, Tailwind CSS, TipTap editor, TanStack Query
  src/pages/       one component per route
  src/components/  shared UI components
  src/common/      API client, upload, socket and other helpers
  src/hooks/       custom React hooks
server/            Node.js + Express REST API, MongoDB via Mongoose, Socket.IO
  routes/          URL → controller mapping (all under /api/v1)
  controllers/     request handlers
  services/        business logic (email, tokens, OTP, …)
  Schema/          Mongoose models
  validators/      Zod request schemas
  middleware/      auth, rate limits, caching, validation, errors
  config/          database, S3, Redis, Socket.IO, env checks
docker-compose.yml local development services
```

## Making a change

1. **Create a branch** from `main`, named `<type>/<short-description>`, for example
   `fix/comment-reply-crash` or `feat/draft-autosave`.
2. **Make your change.** Keep pull requests focused — one fix or feature per PR is much
   easier to review.
3. **Add or update tests** when you change behavior. Both apps use Vitest:
   ```bash
   cd server && npm test
   cd frontend && npm test && npm run build
   ```
4. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/):
   `feat: add draft autosave`, `fix: crash when replying to a deleted comment`.
   Common types are `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, and `chore`.
5. **Never commit secrets** — real `.env` files, API keys, passwords, or tokens.

## Opening a pull request

1. Push your branch to your fork and open a pull request against `main`.
2. Give it a Conventional Commits title (`fix: …`, `feat(editor): …`). PRs are
   squash-merged, so the title becomes the commit on `main`. If the PR has a
   single commit, that commit's message has to follow the format too.
3. Fill in the pull request template: what changed, why, and how you tested it.
   Add screenshots or a short video for UI changes.
4. Make sure:
   - the CLA check is green (sign via the bot's comment if it isn't),
   - CI passes (frontend build + tests, server tests),
   - the PR title, CodeQL and dependency review checks pass. Dependency review
     fails if the PR adds a package with a known high-severity vulnerability or
     a license that isn't compatible with AGPL-3.0.
5. CodeRabbit (an AI reviewer) leaves a first review within a few minutes. You can
   reply to it in the PR. Its comments are suggestions, not requirements.
6. A maintainer will review it. We may ask for changes — that's a normal part of the process.

## Questions?

Open an issue and we'll help. Thanks for helping build Kalamio!

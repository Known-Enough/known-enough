# Development setup

## Requirements

Use Git, Node.js **24.21.0**, npm **11.19.0**, and a current browser. The repository enforces exact Node/npm versions. Initial dependency installation requires network access. The examples use Bash on Linux, macOS, or Windows with WSL.

With nvm installed:

```sh
nvm install
nvm use
npm install --global npm@11.19.0
npm ci
```

Alternatively, install the pinned Node/npm versions directly, then run `npm ci` from the repository root.

## Local demo

Leave the six connected-app settings below unset. Start the frontend with `npm run dev`. In a second terminal using the same Node version, run:

```sh
PORT=8788 node scripts/run-local-api.mjs
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173) and select a fictional user, such as Maya or Leo. Port **8788** matches the frontend; the API's standalone default is 8787. Stop both processes with Ctrl+C.

This mode runs the earlier Christmas and TeamTable examples with in-memory state, fictional sessions, and injected model responses. Restarting the API clears state. It requires no AWS account, model key, or email. Current group management, durable chat, Cognito sign-in, and live Bedrock use the connected application. See the [local account guide](ke11-local-test-auth.md) for sample invitations and session handling.

## Connected application configuration

Obtain an existing backend's public settings from its operator, then copy the template:

```sh
cp apps/web/.env.example apps/web/.env.local
```

Replace all six values:

| Variable | Value |
| --- | --- |
| `VITE_COGNITO_REGION` | Cognito region, currently `us-east-1` |
| `VITE_COGNITO_USER_POOL_ID` | User pool ID |
| `VITE_COGNITO_DOMAIN` | Cognito hosted domain, including `https://` |
| `VITE_COGNITO_PARTICIPANT_CLIENT_ID` | Public participant app-client ID |
| `VITE_COGNITO_DISPLAY_CLIENT_ID` | Separate public display app-client ID |
| `VITE_API_BASE_URL` | HTTPS API base URL, without `/mcp` |

Vite reads these values at startup and build time. Restart the development server after changing them. These are public browser settings; AWS credentials, client secrets, participant tokens, and private runtime packages do not belong in the web build.

The backend must authorize the frontend's exact origin. The existing service allows only its two published sites; localhost is not automatically authorized. See [deployment](deployment.md) for CORS and Cognito configuration.

## Production build

With valid connected settings configured:

```sh
npm run build
npm run preview --workspace @deal-table/web -- --port 4173
```

The build output is `apps/web/dist`. Preview at [http://127.0.0.1:4173](http://127.0.0.1:4173) also requires backend origin authorization. A production build without valid connected configuration displays an unavailable page; use the development server for the local demo.

See [contributing](../CONTRIBUTING.md) for checks and [testing](testing.md) for recorded limitations.

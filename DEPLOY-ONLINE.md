# Deploy Blacksite Five Online

This build includes a Render Blueprint. Once deployed, every player uses the same public HTTPS address and can join from any internet connection.

## One-time deployment

1. Create a new GitHub repository for Blacksite Five.
2. Add the extracted project files to the repository. Include `render.yaml` and `.node-version`; do not add the ZIP itself.
3. In the Render dashboard, choose **New → Blueprint**.
4. Connect the GitHub repository and select its `render.yaml` Blueprint.
5. Review the proposed `blacksite-five` web service and choose **Deploy Blueprint**.
6. When the deployment reports **Live**, open its `https://...onrender.com` address.

The Blueprint runs the automated tests during each build, starts the server with `npm start`, and checks `/api/health` before routing players to it.

## Playing online

Create a room at the hosted address and press **Copy invitation**. The copied HTTPS link includes the room code. Friends can open it from any network; they do not need Node.js or the project files.

The browser sends a small authenticated presence request while a game is open. This keeps an active party responsive on hosts that suspend idle services. Inactive rooms are removed after 12 hours, and completed rooms after one hour.

## Render free-service behavior

The included Blueprint uses Render's Free plan. The first visit after a long idle period can take about a minute while the service starts. A paid always-on instance removes that delay.

Active room state currently lives in one Node process. A host restart, redeploy, or unexpected process replacement clears ongoing rooms. Keep the service at one instance. Database-backed recovery can be added later if matches must survive infrastructure restarts.

## Manual web-service settings

If you create a Render Web Service instead of using the Blueprint, use:

- Runtime: **Node**
- Build command: `npm install && npm test`
- Start command: `npm start`
- Health check path: `/api/health`
- Node version: `22.22.0`

The server reads Render's assigned `PORT` automatically and listens on `0.0.0.0`.

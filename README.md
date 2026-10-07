# Blacksite Five

A live, browser-based hidden-bunker strategy game for 2–4 players. Every player joins a room from their own browser and submits one secret order per day.

## Play online from any network

Build 0.5.0 includes a production server mode and a Render Blueprint. See [`DEPLOY-ONLINE.md`](DEPLOY-ONLINE.md) for the one-time deployment steps. Once live, create a room at the public HTTPS address and share the invitation; friends do not need Node.js or the project files.

Hosted mode provides public invitation links, authenticated active-session presence, admission rate limiting, inactive-room cleanup, security headers, and an HTTP health check. The included free deployment keeps active games awake, although the first visit after a long idle period can take about a minute.

## Run locally

Requirements: Node.js 20 or newer.

### Windows — easiest option

1. Extract the ZIP file completely.
2. Double-click `START-BLACKSITE-FIVE.bat`.
3. Keep the server window open while playing. It now runs the server directly, and your browser opens only after the server successfully starts at <http://localhost:4173>.

If Windows warns about the downloaded file, choose **More info → Run anyway** only if you downloaded this project directly from this conversation.

### macOS or Linux

From the extracted folder:

```bash
chmod +x start-blacksite-five.sh
./start-blacksite-five.sh
```

### Manual option

```bash
npm start
```

On Windows, the browser opens automatically after the server starts. Otherwise open <http://localhost:4173>. Create a room in one browser tab, then use **Copy invitation**.

`localhost` works only on the computer running the server. For another phone, tablet, or computer:

1. Connect both devices to the same Wi-Fi or local network.
2. Use the **Same-Wi-Fi invitation** shown in the lobby (it begins with an address such as `http://192.168...`, not `localhost`).
3. Keep the server window open. If the other device still cannot connect, allow Node.js through Windows Firewall on **Private networks** and make sure the Wi-Fi does not isolate devices from one another.

No package installation is required; the server uses only Node's standard library.

## Test

```bash
npm test
```

Normal days use a 45-second order clock; Day 1 uses 90 seconds. For a faster manual test, shorten either timer:

```bash
ORDER_SECONDS=8 FIRST_ORDER_SECONDS=12 npm start
```

## MVP coverage

- Room-code create/join flow for 2–4 players
- Private two-of-five bunker deployment with optional starting defenders and a one-time troop exchange
- Randomized free-for-all target ring
- Simultaneous timed orders
- 90-second opening day, 45-second later days, and three-second between-day cutaways
- Platoon attacks, scouts, one- or two-troop fortification, travel, return, combat, and attrition
- Hologram, UAV, Minefield, Napalm, Body Enhancers, Teleporter, Signal Interceptor, and immediate-contact Air Raid cards
- Eligible-only site choices for every location-based technology
- Twenty plainly named troop types with illustrated card portraits
- Original procedural mystery-command background music with a varied long-form sequence and an on/off control
- Troop and technology reinforcements with 8-troop and 2-tech hand limits
- Personalized multi-day activity logs, three-missed-order forfeits, bunker-only 30-day scoring and draws, and live per-player state updates
- Confirmed exits with synchronized quit and forfeit end screens

Game state is currently held in one server process. Restarting or redeploying the hosted service clears active rooms, so keep the deployment at one instance. Inactive rooms are automatically cleaned up after 12 hours and completed rooms after one hour.

## Troubleshooting

- Always extract the ZIP before launching; do not run files from inside the ZIP preview.
- If a previous server is open, close its window before starting a newer build.
- If the page appears stale, press `Ctrl+Shift+R` once to reload its scripts without cache.
- The Create and Join forms preserve typed values during interface refreshes and show their connection status directly below their buttons.
- Build 0.5.0 supports both local/LAN play and hosted HTTPS play. Hosted lobbies display an online invitation that works across different networks.

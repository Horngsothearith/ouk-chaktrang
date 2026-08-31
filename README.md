# Ouk Chaktrang — អុកចត្រង្គ

A browser implementation of Khmer chess (Ouk Chaktrang), the Cambodian relative
of chess. Vanilla JavaScript, **zero runtime dependencies**, no build step: the
files you edit are the files the browser runs.

## Running it

```bash
node scripts/dev-server.js
```

Then open <http://localhost:5173>. Set `PORT` to serve elsewhere.

With Docker:

```bash
docker compose up
```

The compose file publishes the port on **all interfaces**, so the app is
reachable from other machines on the network — see
[Network exposure](#network-exposure) for what that means. It also bind-mounts
the working tree read-only so edits show up without a rebuild, which means the
container serves *your files*, not the image's. For a self-contained
deployment, run the image on its own:

```bash
docker run -d -p 0.0.0.0:5173:5173 ouk-chaktrong:latest
```

The image runs as the unprivileged `node` user and ships a healthcheck.

## Tests

```bash
node --test
```

117 tests, `node:test` only — no framework, no install. In Docker:
`docker compose run --rm test`.

## The rules it implements

Ouk Chaktrang differs from international chess in ways the engine models
directly:

- **Neang (Queen)** moves one square diagonally. On its first move it may
  instead advance two squares straight ahead — but only while no capture has
  yet been made by either side.
- **Koul (Bishop)** moves one square diagonally, or one square straight forward.
- **Sdaach (King)** may make a single knight-like jump, subject to the same
  conditions: the king has not moved, no capture has been made yet, and the
  king is not currently in check. This implementation lets that jump capture —
  a judgment call recorded in the design docs.
- **Trey (Pawn)** promotes to Neang on reaching the rank the opponent's pawns
  started from — the sixth rank for White, the third for Black — not the last.
- **Counting rules** end drawn-out endgames: both the bare-king count and the
  no-progress count are implemented, with the board showing the budget and how
  much of it has elapsed. `applyMove` resolves a spent count into the game
  status, so the search sees counting-forced draws as draws.

## Playing features

- **2-player** on one board, **vs Computer** at three difficulties, or **vs AI**
  — the same board played against the language model you configure, rather than
  against the local search.
- **💡 Hint** (`H`) — the engine searches your position and draws its suggested
  move on the board. Fixed strength, independent of the opponent's difficulty:
  a hint from the "Easy" engine would be bad advice.
- **Undo** (`U` / `Ctrl+Z`), move list, and arrow-key navigation through history.
- **AI Move Review** — an optional LLM pass that explains a move in English,
  Khmer, or both, and draws the line it would rather have played. It needs an
  API key; without one, a built-in **Simulation** mode generates reviews
  offline from the local engine's own evaluation.
- Themes, board styles, and five hand-drawn piece skins.

## Configuring the AI

The settings dialog (⚙) accepts any OpenAI-compatible endpoint — OpenAI,
OpenRouter, Groq, DeepSeek, Ollama, or LM Studio. **The API key is stored in
your browser's `localStorage` and sent only to the endpoint you configure.** It
never reaches this repository's server unless you tick *Use Local Dev Server
Proxy*, which exists to get around browsers refusing cross-origin requests to
endpoints that send no CORS headers.

**Load models** asks the endpoint which models it offers (`GET /models`) and
fills the Model field's picker with the answer, so the name does not have to be
typed from memory. The field stays free text: an endpoint that will not list
its models, or a model released since you last loaded, is still typeable. The
list belongs to the endpoint it came from, so changing preset or reopening the
dialog clears it. Loading goes through the same allowlist as everything else on
the proxy path.

### Playing against the model

*vs AI* uses that same endpoint, key and language setting — the model is asked
to play rather than to comment, so there is nothing extra to configure.

The prompt hands the model the board, the recent moves, and **the complete list
of its legal moves**, and asks it to pick one. That list is what makes the mode
work at all: asked to invent a move in a variant this obscure, a model guesses;
asked to choose a line out of a list, it is doing something it is reliably good
at.

Every reply is still checked against the real legal move list before it is
played, and **anything that fails falls back to the local engine** — an illegal
move, unparseable JSON, a failed request, or no configured endpoint. The board
says so when that happens, naming the cause, so an engine move is never passed
off as the model's. Difficulty picks the strength of that fallback.

The consequence worth knowing: in *vs AI* every move costs an API call against
your own key.

### Proxy security

`/api/proxy` forwards a request to a URL the caller supplies, along with the
caller's `Authorization` header. Unrestricted, that is an open relay and a way
into whatever network the server can reach. It is therefore restricted to an
**allowlist of hosts** ([scripts/proxy-guard.js](scripts/proxy-guard.js));
anything else is refused with a 403.

The allowlist ships with the public API hosts behind the presets. To permit
others — including a local Ollama or LM Studio, which are deliberately *not*
allowed by default:

```bash
PROXY_ALLOWED_HOSTS=localhost,127.0.0.1 node scripts/dev-server.js
```

Inside a container, a loopback address points at the container itself, so
allowlisting one there is rarely what you want. The allowlist is the whole
control: whatever is on it is reachable, so add to it deliberately.

### Network exposure

The server binds all interfaces and **has no authentication of its own**.
Anyone who can reach the port can browse the app and use `/api/proxy` against
the allowlisted hosts — with their own credentials, not yours, since the key
travels in the caller's own `Authorization` header. Nothing here is a secret:
the sources are public and the container mounts them read-only.

Still, an unauthenticated relay is worth bounding. On an untrusted network, put
it behind a reverse proxy that requires auth, restrict the port with a firewall
rule, or go back to loopback-only:

```yaml
ports:
  - "127.0.0.1:${PORT:-5173}:5173"
```

## Layout

| Path | What it is |
|------|------------|
| `src/engine.js` | Rules, move generation, counting, game status. No DOM. |
| `src/ai.js` | Negamax with alpha-beta, iterative deepening, and the hint search. |
| `src/pieces.js` | Piece artwork — five skins, drawn as inline SVG. |
| `src/review.js` | Prompt building and response parsing for LLM review, plus the offline simulation. |
| `src/opponent.js` | The LLM opponent behind *vs AI*: prompt, reply parsing, legality check, engine fallback. |
| `src/ui.js` | Board rendering, interaction, controls. Browser only. |
| `scripts/dev-server.js` | Static server and API proxy. Also the container's entrypoint. |
| `scripts/build-artifact.js` | Inlines everything into `artifact/ouk-chaktrong.html`. |

`artifact/ouk-chaktrong.html` is generated — edit the sources and rebuild:

```bash
node scripts/build-artifact.js
```

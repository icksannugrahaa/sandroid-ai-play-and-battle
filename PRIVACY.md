# Privacy

## What the server stores

Only when **“Contribute to leaderboard”** is on (default) and the run did not fail because of your own key/request:

| Stored | Example |
|---|---|
| Model name as you typed it + canonical key + family | `vendor/Qwen3.8-Max` → `qwen38max` / `qwen38` |
| Provider **host** | `api.openai.com` |
| Modality, mode, arena strategy | `chat`, `arena`, `parallel` |
| Metrics | TTFT, total time, prompt/completion token counts (+ “estimated” flag), throughput, cost, status |
| Error **category** only | `auth`, `rate_limit`, `server`, `network`, `timeout` |
| Timestamp | |

**Challenge results** (Arena → Challenges, standard settings only): the challenge id, level and seed, the checked score (0–100), solved yes/no, the number of moves, whether the time limit ran out, the time limit, plus the run's model, provider host, time, tokens and cost. Never the puzzle text or the model's answer. Each result must carry a ticket the server signed for that run (kept in server memory only, expires after 4 h, usable once), so results can't be posted for runs that never happened.

Also stored: public price data and the log of Research runs (which sources succeeded, how many entries changed).

## What the server never stores

- API keys, tokens, or any credential
- Prompts, system prompts, images, outputs, chat history
- IP addresses (used in memory for rate limiting only; logs show a masked form like `203.0.113.x`), user agents, accounts, cookies
- Raw upstream error messages (they can contain internal URLs)

## What the server exposes

The leaderboard API returns **aggregates only** (averages, percentiles, counts per model or family; for challenges: per model per challenge × level). No endpoint returns individual runs, so activity patterns cannot be correlated by timestamp. With these rules the leaderboard is, privacy-wise, equivalent to a public benchmark table.

**Private model names:** if you test an internal fine-tune whose name you don't want public, turn **Contribute to leaderboard** off for that run — nothing is recorded.

## Your browser

- Credentials: memory only, cleared on refresh.
- History: only if you choose “Keep results: This browser” — saved in localStorage on your device (max 200 runs, oldest dropped first), never uploaded. Export/import is a local JSON file (`sandroid-playground-export@v1`); any key-like field is stripped on save, export and import.
- Session cache (optional, off by default): “Keep session” 1–24 h saves chats, arena rounds, form settings, game saves, endpoint label + URL and fetched model lists in IndexedDB on your device, so a refresh doesn't lose your work. API keys are never included (restored endpoints show “needs key”). The timer restarts on every change; expired or switched-off caches are deleted.
- Preferences (language, retention choice, contribute default) are saved in localStorage.

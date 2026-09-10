# Notice

The MIT licence in `LICENSE` covers **this project's own source code only**.

## Riot Games content

Riftforge is an unofficial fan project. It is not affiliated with, endorsed,
sponsored, or specifically approved by Riot Games, Inc.

Riftbound and League of Legends are trademarks of Riot Games, Inc. All card
names, card text, rules text and artwork are the property of Riot Games and are
**not** covered by this project's licence.

| Content | How it is handled |
|---|---|
| Card data | Vendored in `public/data/`, fetched from [Riftcodex](https://riftcodex.com) by `npm run fetch-cards`. Committed, because the API sits behind Cloudflare and is unreachable from CI and hosting build runners; a build that cannot fetch it produces an empty card database. |
| Card art | Hotlinked from Riot's own CDN at render time. Never copied or rehosted. |
| Rules text | Downloaded from Riot's [Rules Hub](https://playriftbound.com/en-us/rules-hub/) by `scripts/extract-rules.py`, for local development reference only. **Not committed** — this repository does not redistribute Riot's rules documents. |

Card art is the largest asset and is never copied; it is served from Riot's own
CDN on every render.

If you fork this, keep it non-commercial, keep the art hotlinked, and keep
Riot's rules documents out of the repository.

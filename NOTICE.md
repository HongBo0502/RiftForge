# Notice

The MIT licence in `LICENSE` covers **this project's own source code only**.

## Riot Games content

Riftforge is an unofficial fan project. It is not affiliated with, endorsed,
sponsored, or specifically approved by Riot Games, Inc.

Riftbound and League of Legends are trademarks of Riot Games, Inc. All card
names, card text, rules text and artwork are the property of Riot Games and are
**not** covered by this project's licence.

This repository is deliberately built so that it redistributes none of it:

| Content | How it is obtained |
|---|---|
| Card data | Fetched at build time from [Riftcodex](https://riftcodex.com) by `npm run fetch-cards`. Not committed. |
| Card art | Hotlinked from Riot's own CDN at render time. Never copied or rehosted. |
| Rules text | Downloaded from Riot's [Rules Hub](https://playriftbound.com/en-us/rules-hub/) by `scripts/extract-rules.py`, for local development reference. Not committed. |

If you fork this, keep it that way, and keep the project non-commercial.

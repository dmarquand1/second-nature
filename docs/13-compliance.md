# 13 Putting it online responsibly (compliance checklist)

What the website version does to follow the rules of the services it uses, and
the few things only you can decide. Written 2026-11-27 and checked against
iNaturalist's Terms of Use (revised 11 July 2023, read 2026-11-27). This is a
practical checklist, not legal advice.

## What the app already does

| Area | Rule | How the app follows it |
|---|---|---|
| iNaturalist API | Max 100 requests/min, asked to stay at 60/min or lower; may block heavy use without notice; the API is for building apps, not scraping ([developers page](https://www.inaturalist.org/pages/developers)) | Each browser makes **at most 1 request per second** (60/min). Every answer is cached. **Daily budget per browser**: background work stops at 7,000 requests a day and everything at 9,000, under iNaturalist's guidance of 10,000 a day. Only fetches what a deck needs. |
| iNaturalist media | Downloading over 5 GB of media an hour or 24 GB a day can lead to a block | Photos load one question at a time (medium size first, about 100-200 KB); the warm-up preloads only the next 15 species' photos. |
| Photo licences | Each photographer chooses a licence. "All rights reserved" photos can't be shown on a public site. Creative Commons licences require credit (photographer, licence, link) | The website shows **only CC0 / CC licensed photos** (iNat's `photo_license` filter plus a second check per photo), with no setting to turn it off. **Photographer and licence (linked) are shown under every photo** and in the zoom viewer; the link to the original observation comes after you answer (before would give the species away). |
| CC "NonCommercial" (NC) | No commercial use | The site is free with no adverts, payments or sponsorship. **Keep it that way** (see below). |
| CC "NoDerivatives" (ND) | Don't share altered versions | Photos are shown as they are, loaded from iNaturalist's own servers. Nothing is edited, re-saved or re-hosted. |
| iNaturalist name and logo | Their name is a trademark; use must not imply iNaturalist endorses you ([help article](https://help.inaturalist.org/en/support/solutions/articles/151000169920-can-i-use-the-inaturalist-logo-when-linking-to-inaturalist-)) | The app is called **Second Nature** (no "iNat" in the name), no iNaturalist logo is used, and the footer and Settings say it's **not made or endorsed by iNaturalist**. |
| OpenStreetMap map tiles | Use `https://tile.openstreetmap.org/...` exactly, keep the credit visible and linked, no bulk download or prefetching ([tile policy](https://operations.osmfoundation.org/policies/tiles/)) | Exact tile address, visible "© OpenStreetMap contributors" linked to the copyright page, one small map per question, no prefetching. Browsers send the normal Referer and User-Agent. |
| Privacy (UK GDPR / PECR) | Say what's collected; cookies need consent unless strictly necessary | No accounts, cookies, analytics or adverts. Browser storage holds only your own decks and answers, needed for the app to work (exempt from cookie consent). **Settings → Privacy** lists the services the browser connects to (GitHub Pages, iNaturalist, Amazon Web Services for photos, OpenStreetMap, cdnjs). |
| Location privacy | Don't reveal hidden locations | Only the public (already obscured where the observer chose) coordinates from the API are shown, marked "Location obscured". |

## iNaturalist Terms of Use, section by section

| Section | What it says (short) | Second Nature |
|---|---|---|
| Intro | Covers the website, apps **and API**; the Platform is for people aged 13+ (or with parental permission) | Visitors' browsers use the API, so Settings → About says under-13s need a parent's permission. |
| 2 Contributors | Content is owned by its contributors; default licence CC BY-NC unless they chose otherwise | Each photo is used under its own licence, shown with it; only open licences. |
| 3 Visitors | iNaturalist doesn't guarantee content is accurate | Settings → About says identifications are occasionally wrong. |
| 4 Inappropriate use | No illegal, unauthorised, spam, harassing or impersonating use | None of these. |
| 6 Intellectual property | **iNATURALIST, iNATURALIST.ORG, iNAT** and the bird logo are trademarks; using the Platform gives no right to use them | Renamed to **Second Nature**, no logo. "iNaturalist" is only used to say where photos and data come from, and that it isn't endorsed. **Rename the GitHub repository too** (see below), because its name becomes the public web address. |
| 7 Commercial AI training | No using iNaturalist data to train AI or machine-learning systems for commercial purposes | Nothing is trained on iNaturalist data. The spaced repetition only uses *your own* answers, in your browser. Keep it that way, and non-commercial. |
| 8 Changes | Terms can change; check them now and then | Re-read them once a year, or before big changes. |
| 9 Termination | iNaturalist can cut off access at any time | The site depends on their API; the rate limits and daily budget keep it a good citizen. |
| 12 Laws and privacy | Follow applicable laws and their privacy policy | See the privacy row above. |

## What only you can decide or do

1. **The name.** Done: renamed from "iNat Quiz" to **Second Nature** (2026-11-27),
   because "iNat" is one of iNaturalist's trademarks (Terms section 6). Before
   publishing, do a quick web search to check no similar nature app uses the name.
   **Also rename the GitHub repository** from `inat-quiz` to `second-nature`,
   otherwise the site's address would be `.../inat-quiz/` (steps in
   [12 The website version](12-website.md)). Your folder on the laptop can keep its name.
2. **Keep it non-commercial.** Many photos are CC BY-NC. No adverts, paid tiers,
   donations buttons or sponsored versions without revisiting the photo licences.
3. **iNaturalist's Terms of Use**: checked (table above). Re-read them now and
   then: https://www.inaturalist.org/pages/terms
4. **Your employer.** If you build this on a work computer or in work time,
   check your employer's rules on personal projects and publishing first, and
   publish from your personal GitHub account.
5. **If it gets popular**, tell iNaturalist about it (their forum or help pages)
   so they know where the traffic comes from.
6. **Optional: a licence for your own code** (e.g. MIT) if you want others to be
   able to reuse it. Without one, the code is public to read but not to reuse.

## When things change

* Adding sign-in or a server that stores answers → write a proper privacy notice
  (what's stored, where, how long, how to delete) before launch.
* Adding analytics → needs consent under PECR unless it's a cookieless, privacy-
  friendly kind; update Settings → Privacy either way.
* Showing photos from somewhere other than iNaturalist → check those licences.

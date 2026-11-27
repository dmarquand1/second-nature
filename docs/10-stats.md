# 10 Stats

Open **Stats** in the top bar. Pick **All decks** or one deck in the top-right
(each deck page also has a **Stats** button). Code: `app/stats.py`, `static/views/stats.js`.

| Section | Meaning |
|---|---|
| Answers | Total answers given (and today). |
| Accuracy | Share of answers that were right (and today). |
| Study streak | Days in a row you've studied, up to today (or yesterday if you haven't studied yet today). A day starts at 4 am. |
| Known species | Species in review (young + mature), out of all species. |
| Progress bar | **New** (never seen), **Learning** (in the 1/5/10-minute steps), **Young** (in review, remembered for under 3 weeks), **Mature** (3+ weeks). |
| Answers per day | Last 30 days. Hover a bar for accuracy. "Show as table" for exact numbers. |
| Coming up | How many species are due each day for the next 2 weeks. Today includes anything overdue. |
| Species you struggle with | Species answered at least twice with at least one mistake, worst accuracy first. "Forgotten" counts lapses (known, then forgotten). |
| Species you mix up | "It was X, you picked Y", most frequent first. These pairs are also fed back into the quiz: Y becomes more likely to appear as a wrong answer when X is shown, and vice versa. |
| Your strongest species | Highest FSRS stability: days until your recall is expected to drop to 90%. |
| Decks | Per-deck summary (All decks view only). |

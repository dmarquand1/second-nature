# 01 Getting started

These steps are for **Windows + VS Code + Git Bash**. Commands go in the
Git Bash terminal inside VS Code (**Terminal > New Terminal**, then pick
**Git Bash** from the `+ v` dropdown on the right of the terminal panel).

## Step 1. Install the tools (one time only)

1. **Python 3.11 or newer** from <https://www.python.org/downloads/>.
   In the installer, tick **"Add python.exe to PATH"**.
2. **Git for Windows** (includes Git Bash) from <https://git-scm.com/download/win>.
3. **VS Code** from <https://code.visualstudio.com/>, then install the
   **Python** extension (VS Code will suggest it when you open the project).

Check they work, in Git Bash:

```bash
py --version      # should print Python 3.11 or newer
git --version
```

> If `py` is not found, try `python --version` and use `python` instead of
> `py` in the commands below.

## Step 2. Put the project in a folder

1. Create a folder for your projects, e.g. `C:\Users\<you>\Projects`.
2. Unzip `inat-quiz.zip` there, so you have `C:\Users\<you>\Projects\inat-quiz\README.md`.
3. In VS Code: **File > Open Folder...** and choose the `inat-quiz` folder.

In Git Bash (inside VS Code the terminal already opens in the project folder):

```bash
cd ~/Projects/inat-quiz
ls        # you should see app/ docs/ static/ tests/ README.md run.py ...
```

## Step 3. Create a virtual environment (one time only)

A virtual environment ("venv") keeps this project's packages separate from
everything else on your computer. It lives in the `.venv` folder, which git ignores.

```bash
py -m venv .venv
```

## Step 4. Activate the virtual environment (every new terminal)

```bash
source .venv/Scripts/activate
```

Your prompt now starts with `(.venv)`. VS Code may also ask
"We noticed a new environment... select it?" Click **Yes**.

## Step 5. Install the packages

```bash
python -m pip install --upgrade pip
pip install -r requirements-dev.txt
```

(`requirements-dev.txt` installs the app packages plus `pytest` for tests.
Run this again whenever `requirements*.txt` changes.)

## Step 6. Run the app

```bash
python run.py
```

Your browser opens <http://127.0.0.1:8000>. Leave the terminal open while
you use the app. Press `Ctrl+C` in the terminal to stop it.

Options:

```bash
python run.py --reload        # auto-restart when you edit code
python run.py --port 8080     # use another port
python run.py --no-browser    # don't open a browser tab
```

## Step 7. Make your first deck and study

1. Click **New deck**.
2. Give it a name, e.g. `UK thrushes`.
3. Choose how to build it:
   - **A species list**: paste names, one per line (scientific or common).
   - **A group (taxon)**: search e.g. `Turdus` and pick it.
   - **Common species in a place**: search a place, optionally limit to a group (e.g. `Odonata`).
4. Optionally pick a **place** so photos and distractors come from that region.
5. Click **Create deck**, then **Study this deck**.
6. Answer with the mouse or keys `1`-`6`; press `Enter` for the next question.

The **first question for each species takes a few seconds** because the app
fetches photos and look-alikes from iNaturalist at 1 request per second.
After that, everything is cached in `data/inat_quiz.db` and is fast.

## Step 8. Run the tests

```bash
pytest
```

All tests should pass. They use a fake iNaturalist, so they work offline.

## Troubleshooting

| Problem | Fix |
|---|---|
| `py: command not found` | Use `python` instead, or reinstall Python with "Add to PATH" ticked. |
| `source: .venv/Scripts/activate: No such file` | You're not in the project folder (`cd ~/Projects/inat-quiz`) or skipped Step 3. |
| `ModuleNotFoundError: fastapi` | The venv isn't active (Step 4) or packages aren't installed (Step 5). |
| `address already in use` | The app is already running in another terminal, or use `python run.py --port 8080`. |
| "Could not reach iNaturalist" | Check your internet connection. Cached decks still work offline. |
| Want a fresh start | Stop the app and delete `data/inat_quiz.db` (you lose your decks and history). |

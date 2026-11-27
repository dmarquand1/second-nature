# 03 Everyday git workflow

Every time something changes, save it to GitHub with these three steps.

## Stage, commit, push

```bash
cd ~/Projects/inat-quiz
git status                       # 1. see what changed
git add .                        # 2. stage everything
git commit -m "Short description of the change"   # 3. commit
git push                         # 4. upload to GitHub
```

## Good commit messages

Start with a verb, say what changed: `Add FSRS scheduler`, `Fix map on
obscured observations`, `Docs: explain distractor scoring`.

## Getting changes that were made elsewhere (e.g. merged on GitHub)

```bash
git pull
```

## Working on a feature branch (optional, recommended for bigger steps)

```bash
git switch -c feature/fsrs       # create and switch to a new branch
# ... make changes ...
git add .
git commit -m "Add FSRS scheduler"
git push -u origin feature/fsrs  # then open a Pull Request on GitHub
```

After the pull request is merged on GitHub:

```bash
git switch main
git pull
```

## Undo helpers

```bash
git restore path/to/file         # throw away uncommitted edits to one file
git restore --staged path/to/file  # unstage a file (keep the edits)
git log --oneline -10            # see the last 10 commits
```

## Never commit

`.venv/`, `data/*.db`, `.env`: these are already in `.gitignore`.

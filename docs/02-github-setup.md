# 02 GitHub setup (one time only)

This puts the project on GitHub so it's backed up and versioned.

## Step 1. Tell git who you are (once per computer)

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
git config --global init.defaultBranch main
```

Use the email of your GitHub account.

## Step 2. Create an empty repository on GitHub

1. Go to <https://github.com/new>.
2. **Repository name**: `inat-quiz`
3. Choose **Private** or **Public**.
4. **Do not** tick "Add a README", ".gitignore" or "license" (the project already has them).
5. Click **Create repository**. Keep the page open; you need its URL,
   e.g. `https://github.com/YOUR-USERNAME/inat-quiz.git`.

## Step 3. First commit and push

In Git Bash, in the project folder (replace `YOUR-USERNAME`):

```bash
cd ~/Projects/inat-quiz
git init
git add .
git status                      # check: no .venv/ or data/*.db in the list
git commit -m "Initial version: FastAPI + SQLite iNat quiz (steps 1-5)"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/inat-quiz.git
git push -u origin main
```

The first push opens a browser window asking you to sign in to GitHub. Approve it.

## Step 4. Check

Refresh the GitHub page. You should see the README and folders.

## Optional: let Claude push to the repo directly

If you connect GitHub to Claude (<https://claude.ai/connect-github>) and tell
the project the repo name (`YOUR-USERNAME/inat-quiz`), future changes can be
opened as pull requests for you to review, instead of you copying files.

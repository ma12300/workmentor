name: gov-feed-collect

on:
  schedule:
    - cron: "*/30 * * * *"
  workflow_dispatch: {}

permissions:
  contents: write

jobs:
  collect:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: collect-feeds
        run: node scripts/collect-govfeed.mjs

      - name: commit-if-changed
        run: |
          git config user.name "workmentor-bot"
          git config user.email "bot@workmentor.co.kr"
          git add gov-feeds.json
          git diff --cached --quiet || git commit -m "auto: gov feeds update [skip ci]"
          git push

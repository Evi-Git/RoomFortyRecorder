# Analyze presets from WoWAnalyzer

`src/renderer/logs/specPresets.ts` is generated from WoWAnalyzer's source
(github.com/WoWAnalyzer/WoWAnalyzer): each spec's graded abilities
(cast efficiency suggestions, cooldowns, charges, recommended efficiency),
the talent entry IDs from its talent tables, and its guide's section names.
Only facts (spell IDs, names, cooldowns) are taken.

To regenerate after WoWAnalyzer updates for a new patch:

```
git clone --depth 1 --filter=blob:none --sparse https://github.com/WoWAnalyzer/WoWAnalyzer ../WoWAnalyzer
git -C ../WoWAnalyzer sparse-checkout set src/analysis/retail src/common src/game
WA_DIR=../WoWAnalyzer python3 tools/analyze-presets/extract.py
WA_DIR=../WoWAnalyzer python3 tools/analyze-presets/gen.py
npx eslint --fix src/renderer/logs/specPresets.ts
```

The guild preset (shared on the server) overrides these for a spec.

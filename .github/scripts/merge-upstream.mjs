// Merges upstream Warcraft Recorder (aza547/wow-recorder) into the current
// branch and auto-resolves the conflicts that happen on every upstream
// release but need no judgement:
//
//   CHANGELOG.md                 keep ours (upstream notes go in the PR text)
//   .github/workflows/*          keep ours
//   release/app/package.json     take upstream's dependencies, keep our
//                                name / version / description / author / licence /
//                                scripts (our install scripts apply the engine patch)
//   release/app/package-lock.json  same idea for the lockfile header
//
// Exit codes: 0 = merged cleanly (not committed), 3 = nothing new upstream,
// 2 = real conflicts remain (listed in conflicts.txt), anything else = error.
//
// Usage: node .github/scripts/merge-upstream.mjs <upstream-ref>

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const ref = process.argv[2] || 'upstream/main';
const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const ahead = Number(git('rev-list', '--count', `HEAD..${ref}`));
if (ahead === 0) {
  console.log('Upstream has nothing new.');
  process.exit(3);
}
console.log(`Upstream has ${ahead} new commit(s). Merging ${ref}...`);

// Snapshot our identity fields before merging.
const ourApp = JSON.parse(fs.readFileSync('release/app/package.json', 'utf8'));
const identity = ['name', 'version', 'description', 'author', 'license', 'scripts'];

try {
  git('merge', '--no-commit', '--no-ff', ref);
} catch {
  // Conflicts are expected; handled below.
}

const conflicted = () =>
  git('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);

const keepOurs = (file) => {
  git('checkout', '--ours', '--', file);
  git('add', '--', file);
  console.log(`  auto-resolved (kept ours): ${file}`);
};

for (const file of conflicted()) {
  if (file === 'CHANGELOG.md' || file.startsWith('.github/')) {
    keepOurs(file);
  } else if (file === 'release/app/package.json') {
    const theirs = JSON.parse(git('show', `${ref}:${file}`));
    for (const key of identity) {
      if (ourApp[key] !== undefined) theirs[key] = ourApp[key];
    }
    fs.writeFileSync(file, `${JSON.stringify(theirs, null, 2)}\n`);
    git('add', '--', file);
    console.log(`  auto-resolved (upstream deps, our identity): ${file}`);
  } else if (file === 'release/app/package-lock.json') {
    const theirs = JSON.parse(git('show', `${ref}:${file}`));
    theirs.name = ourApp.name;
    theirs.version = ourApp.version;
    if (theirs.packages?.['']) {
      theirs.packages[''].name = ourApp.name;
      theirs.packages[''].version = ourApp.version;
      theirs.packages[''].license = ourApp.license;
    }
    fs.writeFileSync(file, `${JSON.stringify(theirs, null, 2)}\n`);
    git('add', '--', file);
    console.log(`  auto-resolved (upstream lock, our identity): ${file}`);
  }
}

// A clean merge can still silently bring in upstream's version/name for
// release/app/package.json if only upstream touched it. Re-assert ours.
const merged = JSON.parse(fs.readFileSync('release/app/package.json', 'utf8'));
if (identity.some((k) => JSON.stringify(merged[k]) !== JSON.stringify(ourApp[k]))) {
  for (const key of identity) merged[key] = ourApp[key];
  fs.writeFileSync('release/app/package.json', `${JSON.stringify(merged, null, 2)}\n`);
  git('add', '--', 'release/app/package.json');
}

const remaining = conflicted();
fs.writeFileSync('conflicts.txt', remaining.join('\n'));
if (remaining.length > 0) {
  console.log(`\n${remaining.length} file(s) need a human:\n  ${remaining.join('\n  ')}`);
  process.exit(2);
}
console.log('\nMerged cleanly.');

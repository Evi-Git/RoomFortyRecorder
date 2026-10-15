// Pre-flight checks for the Release workflow. Fails the run early, with a
// plain-English message, instead of producing an installer that updates from
// the wrong place or overwrites an existing release.

import { execSync } from 'node:child_process';
import fs from 'node:fs';

const fail = (message) => {
  console.error(`\n::error::${message}\n`);
  process.exit(1);
};

const root = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const app = JSON.parse(fs.readFileSync('release/app/package.json', 'utf8'));
const publish = root.build?.publish ?? {};
const [repoOwner, repoName] = (process.env.GITHUB_REPOSITORY || '/').split('/');

if (JSON.stringify(root).includes('YOUR_GITHUB_USERNAME')) {
  fail(
    'package.json still contains YOUR_GITHUB_USERNAME. Replace every occurrence ' +
      'with your GitHub username (see TAKEOVER.md, step 3).',
  );
}

if (
  publish.provider !== 'github' ||
  String(publish.owner).toLowerCase() !== repoOwner.toLowerCase() ||
  String(publish.repo).toLowerCase() !== repoName.toLowerCase()
) {
  fail(
    `package.json "build.publish" points at ${publish.owner}/${publish.repo}, ` +
      `but this workflow is running in ${repoOwner}/${repoName}. Installed apps ` +
      'would look for updates in the wrong repository. Fix build.publish in package.json.',
  );
}

const version = app.version;
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  fail(`release/app/package.json has an invalid version: "${version}". Use e.g. 1.4.1.`);
}

const tag = `v${version}`;
const existing = execSync(`git ls-remote --tags origin refs/tags/${tag}`, {
  encoding: 'utf8',
}).trim();
if (existing) {
  fail(
    `${tag} is already released. Bump "version" in release/app/package.json ` +
      'before running the Release workflow again.',
  );
}

console.log(`OK: building ${tag}, updates will be served from ${repoOwner}/${repoName}.`);

#!/usr/bin/env node
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

function safeRun(cmd) {
  try { return run(cmd); } catch (e) { return ''; }
}

async function getReleaseNotes(tag) {
  if (!token || !repo) return null;
  const url = `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.body || null;
  } catch (e) {
    return null;
  }
}

function commitsBetween(oldRef, newRef) {
  // If oldRef is falsy, show all commits up to newRef
  let range = newRef;
  if (oldRef) range = `${oldRef}..${newRef}`;
  const out = safeRun(`git log --pretty=format:"- %s (%h)" ${range}`);
  return out ? out.split('\n').filter(Boolean).join('\n') : '';
}

function tagDate(tag) {
  return safeRun(`git log -1 --format=%aI ${tag}`) || '';
}

async function buildChangelog() {
  const tagsRaw = safeRun('git tag --sort=-creatordate');
  const tags = tagsRaw ? tagsRaw.split('\n').filter(Boolean) : [];

  let md = '# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n';

  // Unreleased section (HEAD..latestTag)
  const latest = tags[0];
  md += '## Unreleased\n\n';
  if (latest) {
    const unreleased = commitsBetween(latest, 'HEAD');
    md += unreleased ? `${unreleased}\n\n` : 'No unreleased changes.\n\n';
  } else {
    const all = commitsBetween('', 'HEAD');
    md += all ? `${all}\n\n` : 'No changes found.\n\n';
  }

  // For each tag, include release notes or commits
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    const prev = tags[i + 1];
    const date = tagDate(tag);
    md += `## ${tag}${date ? ` - ${date}` : ''}\n\n`;
    const releaseNotes = await getReleaseNotes(tag);
    if (releaseNotes) {
      md += `${releaseNotes}\n\n`;
    } else {
      const commits = commitsBetween(prev, tag);
      md += commits ? `${commits}\n\n` : 'No changes listed.\n\n';
    }
  }

  return md;
}

async function main() {
  const changelog = await buildChangelog();
  const outPath = path.resolve(process.cwd(), 'CHANGELOG.md');
  const args = process.argv.slice(2);
  const localOnly = args.includes('--local') || args.includes('--write-only');
  const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
  if (existing.trim() === changelog.trim()) {
    console.log('No changelog changes detected.');
    return 0;
  }

  fs.writeFileSync(outPath, changelog, 'utf8');
  console.log('Wrote CHANGELOG.md');

  if (localOnly) {
    console.log('Local mode: not creating PR or pushing changes.');
    return 0;
  }

  // Detect if HEAD is a release commit or already tagged. If so, do not create an
  // automated changelog PR because the release commit should already include the
  // changelog. Allow an explicit override via CREATE_CHANGELOG_PR=true.
  const lastCommitMsg = safeRun('git log -1 --pretty=%B');
  const tagsAtHead = safeRun('git tag --points-at HEAD');
  if ((tagsAtHead || /chore\(release\):/.test(lastCommitMsg)) && process.env.CREATE_CHANGELOG_PR !== 'true') {
    console.log('Detected release commit or tag at HEAD; skipping automatic changelog PR creation.');
    return 0;
  }

  // Commit & push using GITHUB_TOKEN
  try {
    run('git add CHANGELOG.md');
    run('git config user.name "github-actions[bot]"');
    run('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"');
    run('git commit -m "chore: update changelog (auto) [skip ci]"');

    // By default we do NOT create a changelog PR. This avoids an automated loop where
    // a changelog PR itself appears in subsequent changelogs. To enable PR creation
    // set the environment variable CREATE_CHANGELOG_PR=true in the workflow that
    // intentionally wants this behavior.
    if (!token || !repo) {
      console.log('No GITHUB_TOKEN or GITHUB_REPOSITORY provided; skipping push/PR creation.');
      return 0;
    }

    // Require explicit opt-in to create a PR: an env var, a CLI flag, and the
    // GitHub Action event must be a release/manual trigger. This prevents
    // accidental PR creation from ordinary push events.
    const cliArgs = process.argv.slice(2);
    const cliCreatePr = cliArgs.includes('--create-pr');
    const ghEvent = process.env.GITHUB_EVENT_NAME || '';
    const allowedEvents = ['release', 'workflow_dispatch', 'repository_dispatch'];
    const eventAllowed = allowedEvents.includes(ghEvent);

    if (!(process.env.CREATE_CHANGELOG_PR === 'true' && cliCreatePr && eventAllowed)) {
      console.log('Automatic changelog PR creation disabled. To enable, set CREATE_CHANGELOG_PR=true, pass --create-pr to the script, and trigger from a release or manual workflow.');
      return 0;
    }

    // Create a branch name based on date and short sha
    const date = new Date().toISOString().replace(/[:.]/g, '-');
    const short = safeRun('git rev-parse --short HEAD') || 'head';
    const branch = `chore/update-changelog-${date}-${short}`;

    // Create local branch and push to remote using token-authenticated URL
    run(`git checkout -b ${branch}`);
    const remoteUrl = `https://x-access-token:${token}@github.com/${repo}.git`;
    run(`git push ${remoteUrl} HEAD:${branch}`);
    console.log(`Pushed changelog branch: ${branch}`);

    // Create a Pull Request
    const prTitle = `chore: update CHANGELOG.md (auto)`;
    const prBody = `This PR was generated automatically to update the changelog.\n\nGenerated by tools/generate_changelog.js`;

    const apiUrl = `https://api.github.com/repos/${repo}/pulls`;
    async function tryCreatePR(tok) {
      return await fetch(apiUrl, {
        method: 'POST',
        headers: { Authorization: `token ${tok}`, Accept: 'application/vnd.github.v3+json' },
        body: JSON.stringify({ title: prTitle, head: branch, base: 'master', body: prBody }),
      });
    }

    let res = await tryCreatePR(token);
    if (!res.ok) {
      const txt = await res.text();
      console.error('Failed to create PR with GITHUB_TOKEN:', res.status, txt);
      // If a stronger token is available in GH_PUBLISH_TOKEN, try that as a fallback.
      const alt = process.env.GH_PUBLISH_TOKEN;
      if (alt && alt !== token) {
        console.log('Attempting PR creation with GH_PUBLISH_TOKEN fallback...');
        res = await tryCreatePR(alt, 'GH_PUBLISH_TOKEN');
        if (!res.ok) {
          const txt2 = await res.text();
          console.error('Failed to create PR with GH_PUBLISH_TOKEN fallback:', res.status, txt2);
          return 1;
        }
      } else {
        // No fallback token available — return the original error code 1 so the job fails visibly.
        return 1;
      }
    }

    const pr = await res.json();
    console.log('Created PR:', pr.html_url || pr.url);
  } catch (e) {
    console.error('Failed to commit/push changelog or create PR:', e);
    return 1;
  }

  return 0;
}

main().then((code) => process.exit(code)).catch((err) => { console.error(err); process.exit(2); });


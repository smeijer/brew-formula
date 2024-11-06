import { Octokit } from '@octokit/rest';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;

const octokit = new Octokit({ auth: GITHUB_TOKEN });

type Options = {
  name: string;
  version: string;
  filepath: string;
  contents: string;
  baseBranch: string;
  branchName: string;
  repo: string;
}

async function fetchMainBranchSha(options: Options) {
  const [owner, repo] = options.repo.split('/');

  const response = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${options.baseBranch}`,
  });

  return response.data.object.sha;
}

async function ensureBranchFromMain(options: Options) {
  const mainBranchSha = await fetchMainBranchSha(options);
  const [owner, repo] = options.repo.split('/');

  try {
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${options.branchName}`,
      sha: mainBranchSha,
    });
    console.log(`Branch ${options.branchName} created successfully.`);
  } catch (error: any) {
    if (error.status === 422 && error.message.includes('Reference already exists')) {
      console.log(`Branch ${options.branchName} already exists. Ensuring it's up to date.`);
      await octokit.git.updateRef({
        owner,
        repo,
        ref: `heads/${options.branchName}`,
        sha: mainBranchSha,
        force: true,
      });
    } else {
      throw error;
    }
  }
}

async function fetchFileContent(options: Options) {
  const [owner, repo] = options.repo.split('/');

  try {
    const response = await octokit.repos.getContent({
      owner,
      repo,
      path: options.filepath,
      ref: options.branchName,
    });

    if (!('content' in response.data)) throw new Error('unexpected response, content missing');
    const fileContent = Buffer.from(response.data.content, 'base64').toString('utf-8');
    return { content: fileContent, sha: response.data.sha, exists: true };
  } catch (error: any) {
    if (error.status === 404) {
      return { content: '', sha: '', exists: false };
    } else {
      throw error;
    }
  }
}

async function updateFile(options: Options, content: string, sha: string) {
  const [owner, repo] = options.repo.split('/');
  const updatedContent = Buffer.from(content).toString('base64');

  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: options.filepath,
    message: `update ${options.filepath}`,
    content: updatedContent,
    branch: options.branchName,
    sha: sha || undefined, // only include sha if it exists
  });
}

async function findOrCreatePullRequest(options: Options) {
  const [owner, repo] = options.repo.split('/');

  const { data: pullRequests } = await octokit.pulls.list({
    owner,
    repo,
    state: 'open',
    head: `${owner}:${options.branchName}`,
    base: options.baseBranch,
  });

  const payload = {
    owner,
    repo,
    title: `publish \`${options.name}@${options.version}\``.toLowerCase(),
    body: `Publish [\`${options.name}@${options.version}\`](https://npmjs.com/package/${options.name}/v/${options.version}).`,
  }

  if (pullRequests.length > 0) {
    const pr = pullRequests[0];
    console.log(`Pull request #${pr.number} already exists. Updating...`);

    await octokit.pulls.update({
      pull_number: pr.number,
      ...payload,
    });
  } else {
    console.log('Creating new pull request.');
    await octokit.pulls.create({
      head: options.branchName,
      base: options.baseBranch,
      ...payload,
    });
  }
}

export async function createOrUpdatePR(options: Options) {
  if (!GITHUB_TOKEN) {
    throw new Error(`GITHUB_TOKEN env var not set`);
  }

  await ensureBranchFromMain(options);

  const { content, sha, exists } = await fetchFileContent(options);
  if (content.trim() === options.contents.trim()) return;

  await updateFile(options, options.contents, exists ? sha : '');
  await findOrCreatePullRequest(options);
  console.log('Pull request processed successfully.');
}


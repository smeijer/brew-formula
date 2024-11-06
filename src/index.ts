import { Command } from 'commander';
import pkg from '../package.json';
import * as formula from './formula.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import stripIndent from 'strip-indent';
import ora from 'ora';
import { createOrUpdatePR } from './github.js';

async function exec(name: string, cmd: Promise<{ ok: boolean, message?: string }>) {
  const spinner = ora(`running ${name}`).start();
  const result = await cmd;

  if (result.ok) {
    spinner.succeed(`passed ${name}`);
  } else {
    spinner.fail(`failed ${name}`);
    console.log(result.message);
    process.exit(1);
  }
}

import * as brew from './brew.js';

const program = new Command()
  .name(pkg.name)
  .description('Brew on GitHub from the command line')
  .version(pkg.version, '-v, --version', 'Show version')
  .argument('<package>', 'Package name')
  .argument('[outdir]', 'Destination directory', '.')
  .option('--test-command <string>', 'Test command to add')
  .option('--test-output <string>', 'Output that test command should produce')
  .option('--no-install', 'Skip install', true)
  .option('--no-test', 'Skip tests', true)
  .option('--no-audit', 'Skip audit', false)
  .option('--no-livecheck', 'Skip livecheck', false)
  .action(async (pkg, outdir, opts) => {
    const spinner = ora('Generating formula...').start();

    try {
      spinner.text = 'fetching release info...';
      const release = await formula.fetchReleaseInfo(pkg);
      const name = formula.name(release);
      const filename = formula.filename(release);
      const outfile = path.join(outdir, filename);
      const isPublished = await formula.isPublished(release);

      spinner.text = 'fetching tarball...';
      release.dist.sha256 = await formula.createHashForTarball(release.dist.tarball);

      spinner.text = 'generating formula...';
      const contents = await formula.generate(release, {
        command: opts.testCommand,
        output: opts.testOutput,
      });

      await fs.writeFile(outfile, contents);

      spinner.succeed(`created \`${filename}\``);

      const successMessage = isPublished
        ? stripIndent(`
          Done! Publish a new version with:
          
          brew bump-formula-pr
        `)
        : stripIndent(`
          Done! Commit the formula with:
          
          git add ${outfile}
          git commit -m '${formula.commitMessage(release, !isPublished)}'
      `);

      if (!opts.install) {
        console.log(successMessage);
        return;
      }

      await exec('\`brew install\`', brew.install(outfile));

      if (opts.test) {
        await exec('\`brew test\`', brew.test(outfile));
      }

      if (opts.audit) {
        await exec('\`brew audit\`', brew.audit(name));
      }

      if (opts.livecheck) {
        await exec('\`brew livecheck\`', brew.livecheck(outfile));
      }

      console.log(successMessage);
    } catch (e) {
      spinner.fail('Failed to generate formula');
      console.log(e);
      process.exit(1);
    }
  });

program.command('install')
  .argument('formula', 'Formula file')
  .action(async (formula) => {
    await exec('\`brew install\`', brew.install(formula))
  });

program.command('test')
  .argument('formula', 'Formula file')
  .action(async (formula) => {
    await exec('\`brew test\`', brew.test(formula));
  });

program.command('audit')
  .argument('formula', 'Formula file')
  .action(async (formula) => {
    await exec('\`brew audit\`', brew.audit(formula));
  });

program.command('livecheck')
  .argument('formula', 'Formula file')
  .action(async (formula) => {
    await exec('\`brew livecheck\`', brew.livecheck(formula));
  });

program.command('github')
  .argument('<package>', 'Package name')
  .argument('<repo>', 'GitHub repository')
  .option('--test-command <string>', 'Test command to add')
  .option('--test-output <string>', 'Output that test command should produce')
  .action(async (pkg, repo, opts, cmd) => {
    // need to take the globals, as default cmd excludes them from sub command
    opts = cmd.optsWithGlobals();

    const spinner = ora('Generating formula...').start();
    try {
      spinner.text = 'fetching release info...';
      const release = await formula.fetchReleaseInfo(pkg);
      const name = formula.name(release);
      const filename = formula.filename(release);

      spinner.text = 'fetching tarball...';
      release.dist.sha256 = await formula.createHashForTarball(release.dist.tarball);

      spinner.text = 'generating formula...';
      const contents = await formula.generate(release, {
        command: opts.testCommand,
        output: opts.testOutput,
      });

      spinner.text = 'creating pull-request';

      await createOrUpdatePR({
        name: release.name,
        version: release.version,
        branchName: `update-${name}-formula`,
        baseBranch: 'main',
        filepath: path.join('Formula', filename),
        repo: repo,
        contents,
      })

      spinner.succeed('done');
    } catch (e) {
      spinner.fail('Failed to generate formula');
      console.log(e);
      process.exit(1);
    }
  });

program.parse();

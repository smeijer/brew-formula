import child, { execSync } from 'node:child_process';
import util from 'node:util';
const exec = util.promisify(child.exec);

export async function install(formula: string) {
  try {
    await exec(`brew install --build-from-source --formula ${formula}`);
    return { ok: true };
  } catch (err) {
    const message = [
      err.stdout || err.message,
      err.stderr
    ];

    return { ok: false, message: message.join('\n') };
  }
}

export async function test(formula: string) {
  try {
    await exec(`brew test ${formula}`);
    return { ok: true };
  } catch (err) {
    const message = [
      err.stdout || err.message,
      err.stderr
    ];

    return { ok: false, message: message.join('\n') };
  }
}

export async function audit(formula: string) {
  try {
    await exec(`brew audit --strict --online --formula ${formula}`);
    return { ok: true };
  } catch (err) {
    const lines = err.stdout.split('\n');
    const taps = lines.filter(x => /^[a-z]/i.test(x));

    const message = [
      err.stdout || err.message,
      err.stderr
    ];

    if (taps.includes('homebrew/core')) {
      message.push(`It looks like your homebrew-core is outdated. It's a git repo that needs to be updated. You can find the location of the repo with \`brew --repo homebrew/core\``);
    }

    return { ok: false, message: message.join('\n') };
  }
}

export async function livecheck(formula: string) {
  try {
    const { stdout } = await exec(`brew livecheck --formula ${formula}`);
    return { ok: true, message: stdout };
  } catch (err) {
    const message = [
      err.stdout || err.message,
      err.stderr
    ];

    return { ok: false, message: message.join('\n') };
  }
}

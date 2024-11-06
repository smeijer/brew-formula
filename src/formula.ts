import {  pascalCase, paramCase } from 'change-case';
import got from 'got';
import { createHash } from 'node:crypto'
// @ts-ignore
import spdx from 'spdx-license-ids';

// see audit: https://github.com/Homebrew/brew/blob/a41a1fd782daf95a1ecdfcbcfe6127ca027c4d37/Library/Homebrew/rubocops/shared/desc_helper.rb#L49
function fixDescription(content) {
  return content
    .replace(/(command ?line)/ig, 'command-line')
    .replace(/^(the|an?)(?=\s)/i, '')
    .trim()
}

//bottle do
//  sha256 cellar: :any_skip_relocation, all: "e453bf6b7d26b06fd7d28a39a75e55dbd91a3a0eeded160fa6899a916d6382ae"
//end

const template = `
require "language/node"

class {{formula}} < Formula
  desc "{{description}}"
  homepage "{{homepage}}"
  url "{{url}}"
  sha256 "{{sha256}}"
  license {{license}}

  livecheck do
    url "{{livecheck_url}}"
    regex(/["']version["']:\\s*?["']([^"']+)["']/i)
  end

  depends_on "node"

  def install
    system "npm", "install", *Language::Node.std_npm_args(libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match(version.to_s, shell_output("#{bin}/{{bin}} --version"))
    assert_match({{test_output}}, shell_output("#{bin}/{{test_command}}"))
  end
end
`;

export async function fetchReleaseInfo(name: string) {
  const response = await got(`https://registry.npmjs.org/${name}`).json<any>();

  // fetch package metadata
  const latest = response['dist-tags'].latest;
  return response.versions[latest];
}

/**
 * fetch the tarball and compute the sha256, metadata only contains sha512
 */
export async function createHashForTarball(url: string) {
  const buffer = await got(url).buffer();
  return createHash('sha-256').update(buffer).digest('hex')
}

export async function generate(release: any, test?: { command: string, output: string }) {
  const [binary] = Object.keys(release.bin);

  // description requires to pass audit checks
  const description = fixDescription(release.description);

  let formula = template;

  // license must be valid spdx, remove the line if it isn't.
  release.license = spdx.includes(release.license)
    ? `"${release.license}"`
    : `:cannot_represent # ${release.license}`;

  if (!test) {
    formula = formula.replace(/^ +assert_match {{test_output}}.*/gm, '');
  }

  const latestUrl = `https://registry.npmjs.org/${release.name}/latest`;

  return formula
    // generic
    .replaceAll('{{formula}}', pascalCase(release.name))
    .replaceAll('{{name}}', release.name)
    .replaceAll('{{license}}', release.license)
    .replaceAll('{{description}}', description)
    .replaceAll('{{homepage}}', release.homepage)
    .replaceAll('{{license}}', release.license)
    // release
    .replaceAll('{{version}}', release.version)
    .replaceAll('{{url}}', release.dist.tarball)
    .replaceAll('{{livecheck_url}}', latestUrl)
    .replaceAll('{{sha256}}', release.dist.sha256)
    .replaceAll('{{bin}}', binary)
    .replaceAll('{{test_command}}', test?.command)
    .replaceAll('{{test_output}}', test?.output)
    .trim() + '\n';
}

export function filename(release: any) {
  return `${paramCase(release.name)}.rb`;
}

export function name(release: any) {
  return `${paramCase(release.name)}`;
}

export function commitMessage(release: any, isNew) {
  const name = paramCase(release.name);
  const version = release.version;
  const suffix = isNew ? '(new formula)' : '';
  return [name, version, suffix].filter(Boolean).join(' ').trim();
}

export async function isPublished(release: any) {
  try {
    const file = filename(release);
    await got(`https://api.github.com/repos/homebrew/homebrew-core/contents/Formula/${file}`).json();
    return true;
  } catch (e) {
    if (e.response.statusCode === 404) return false;
    throw e;
  }
}

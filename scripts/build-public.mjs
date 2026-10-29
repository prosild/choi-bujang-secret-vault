import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deploymentIdentity } from './deployment-identity.mjs';

const root = resolve(import.meta.dirname, '..');
const publicDir = resolve(root, 'public');
const config = JSON.parse(await readFile(resolve(root, 'aleph.config.json'), 'utf8'));
if (config.step !== 2) throw new Error('2단계 빌드 구성이 아닙니다.');
await mkdir(publicDir, { recursive: true });
await rm(resolve(publicDir, 'data.json'), { force: true });
if (!process.argv.includes('--local')) {
  const identity = deploymentIdentity(process.env, config);
  await writeFile(resolve(publicDir, 'aleph.json'), `${JSON.stringify(identity, null, 2)}\n`, 'utf8');
}

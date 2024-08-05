import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import simpleGit from 'simple-git';
import type { PullRequestInfo, TaskData } from '../types';

export class TaskCache {
  private cacheFile: string;
  private cache: Record<string, TaskData> = {};

  constructor(projectPath: string) {
    const cacheDir = path.join(os.homedir(), '.codewhisper');
    fs.ensureDirSync(cacheDir);
    const projectHash = Buffer.from(projectPath).toString('base64');
    this.cacheFile = path.join(cacheDir, `${projectHash}-task-cache.json`);
    this.loadCache();
  }

  private loadCache(): void {
    if (fs.existsSync(this.cacheFile)) {
      this.cache = fs.readJSONSync(this.cacheFile);
    }
  }

  private saveCache(): void {
    fs.writeJSONSync(this.cacheFile, this.cache);
  }

  setTaskData(
    basePath: string,
    data: Omit<TaskData, 'basePath' | 'timestamp'>,
  ): void {
    const key = this.getKey(basePath);
    this.cache[key] = { ...data, basePath, timestamp: Date.now() };
    this.saveCache();
  }

  getLastTaskData(basePath: string): TaskData | null {
    const key = this.getKey(basePath);
    return this.cache[key] || null;
  }

  private getKey(basePath: string): string {
    return path.resolve(basePath);
  }

  async getRepoInfo(): Promise<{ owner: string; repo: string } | null> {
    const git = simpleGit();
    try {
      const remotes = await git.getRemotes(true);
      const originRemote = remotes.find((remote) => remote.name === 'origin');
      if (!originRemote) {
        return null;
      }
      const match = originRemote.refs.fetch.match(
        /github\.com[:/]([^/]+)\/([^.]+)\.git/,
      );
      if (!match) {
        return null;
      }
      return { owner: match[1], repo: match[2] };
    } catch (error) {
      console.error('Error getting repository information:', error);
      return null;
    }
  }

  async getCurrentBranch(): Promise<string> {
    const git = simpleGit();
    try {
      const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
      return branch.trim();
    } catch (error) {
      console.error('Error getting current branch:', error);
      throw error;
    }
  }

  async setPRInfo(prInfo: PullRequestInfo): Promise<void> {
    const repoInfo = await this.getRepoInfo();
    if (!repoInfo) {
      throw new Error('Unable to determine repository information');
    }
    const { owner, repo } = repoInfo;
    const branch = await this.getCurrentBranch();
    const key = `${owner}/${repo}/${branch}`;
    this.cache[key] = { ...this.cache[key], prInfo };
    this.saveCache();
  }

  async getPRInfo(): Promise<PullRequestInfo | null> {
    const repoInfo = await this.getRepoInfo();
    if (!repoInfo) {
      return null;
    }
    const { owner, repo } = repoInfo;
    const branch = await this.getCurrentBranch();
    const key = `${owner}/${repo}/${branch}`;
    return this.cache[key]?.prInfo || null;
  }
}

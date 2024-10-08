import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import simpleGit from 'simple-git';
import type { PullRequestInfo, RevisionAttempt, TaskData } from '../types';

export class TaskCache {
  private cacheFile: string;
  private cache: Record<string, TaskData> = {};
  private revisionAttempts: Record<string, RevisionAttempt[]> = {};

  constructor(projectPath: string) {
    const cacheDir = path.join(os.homedir(), '.codewhisper');
    fs.ensureDirSync(cacheDir);
    const projectHash = Buffer.from(projectPath).toString('base64');
    this.cacheFile = path.join(cacheDir, `${projectHash}-task-cache.json`);
    this.loadCache();
  }

  private loadCache(): void {
    if (fs.existsSync(this.cacheFile)) {
      const loadedCache = fs.readJSONSync(this.cacheFile);
      this.cache = loadedCache.taskData || {};
      this.revisionAttempts = loadedCache.revisionAttempts || {};
    }
  }

  private saveCache(): void {
    fs.writeJSONSync(this.cacheFile, {
      taskData: this.cache,
      revisionAttempts: this.revisionAttempts,
    });
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

  async getRepoInfo(basePath='.'): Promise<{ owner: string; repo: string } | null> {
    const git = simpleGit(basePath);
    try {
      const remotes = await git.getRemotes(true);
      const originRemote = remotes.find((remote) => remote.name === 'origin');
      if (!originRemote) {
        return null;
      }
      const match = this.parseGitHubUrl(originRemote.refs.fetch);
      if (!match) {
        return null;
      }
      return match;
    } catch (error) {
      console.error('Error getting repository information:', error);
      return null;
    }
  }

  parseGitHubUrl(url: string) {
    const sshRegex = /^git@github\.com:([^/]+)\/(.+?)(\.git)?$/;
    const httpsRegex = /^https:\/\/github\.com\/([^/]+)\/(.+?)(\.git)?$/;

    const match = url.match(sshRegex) || url.match(httpsRegex);

    if (!match) {
      return null;
    }

    return {
      owner: match[1],
      repo: match[2],
    };
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

  async getRevisionAttempts(key: string): Promise<RevisionAttempt[]> {
    return this.revisionAttempts[key] || [];
  }

  async addRevisionAttempt(
    key: string,
    attempt: RevisionAttempt,
  ): Promise<void> {
    if (!this.revisionAttempts[key]) {
      this.revisionAttempts[key] = [];
    }
    this.revisionAttempts[key].push(attempt);
    this.saveCache();
  }
}

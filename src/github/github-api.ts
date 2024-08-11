import { Octokit } from '@octokit/rest';
import type {
  AIParsedResponse,
  GitHubIssue,
  PullRequestDetails,
  PullRequestInfo,
  LabeledItem,
} from '../types';
import { ensureValidBranchName, ensureBranch, createBranchAndCommit, getGitHubRepoInfo, findOriginalBranch } from '../utils/git-tools';
import simpleGit, { SimpleGit } from 'simple-git';

export class GitHubAPI {
  private octokit: Octokit;

  constructor() {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      console.warn(
        'GITHUB_TOKEN not set. GitHub API calls may be rate-limited.',
      );
    }
    this.octokit = new Octokit({ auth: token });
  }

  async getRepositoryIssues(
    owner: string,
    repo: string,
    filters: string,
  ): Promise<GitHubIssue[]> {
    try {
      const filterObj = this.parseAndMergeFilters(filters);
      const response = await this.octokit.issues.listForRepo({
        owner,
        repo,
        ...filterObj,
      });

      return response.data.map((issue) => ({
        number: issue.number,
        title: issue.title,
        body: issue.body || '',
        html_url: issue.html_url,
      }));
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        'status' in error &&
        'headers' in error &&
        typeof error.status === 'number' &&
        error.status === 403 &&
        typeof error.headers === 'object' &&
        error.headers !== null &&
        'x-ratelimit-remaining' in error.headers &&
        error.headers['x-ratelimit-remaining'] === '0'
      ) {
        throw new Error(
          'GitHub API rate limit exceeded. Please try again later or use an API token.',
        );
      }
      if (
        error instanceof Error &&
        'status' in error &&
        typeof error.status === 'number' &&
        error.status === 404
      ) {
        throw new Error(`Repository not found: ${owner}/${repo}`);
      }
      if (error instanceof Error) {
        console.error('Error fetching GitHub issues:', error);
        throw new Error(`Failed to fetch GitHub issues: ${error.message}`);
      }
      console.error('Unknown error fetching GitHub issues:', error);
      throw new Error('Failed to fetch GitHub issues: Unknown error');
    }
  }

  parseAndMergeFilters(filters: string): Record<string, string> {
    let filterObj = {
      state: 'open',
      sort: 'updated',
      direction: 'desc',
    };
    if (filters) {
      const parsedFilters: Record<string, string> = filters.split(',').reduce(
        (acc, filter) => {
          const [key, value] = filter.split(':');
          if (!key || !value) {
            throw new Error(
              `Invalid filter format: ${filter}. Expected format: key:value`,
            );
          }
          acc[key.trim()] = value.trim();
          return acc;
        },
        {} as Record<string, string>,
      );

      filterObj = {
        ...filterObj,
        ...parsedFilters,
      };
    }

    return filterObj;
  }

  async getIssueDetails(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<GitHubIssue> {
    try {
      const response = await this.octokit.issues.get({
        owner,
        repo,
        issue_number: issueNumber,
      });

      return {
        number: response.data.number,
        title: response.data.title,
        body: response.data.body || '',
        html_url: response.data.html_url,
      };
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        'status' in error &&
        'headers' in error &&
        typeof error.status === 'number' &&
        error.status === 403 &&
        typeof error.headers === 'object' &&
        error.headers !== null &&
        'x-ratelimit-remaining' in error.headers &&
        error.headers['x-ratelimit-remaining'] === '0'
      ) {
        throw new Error(
          'GitHub API rate limit exceeded. Please try again later or use an API token.',
        );
      }
      if (
        error instanceof Error &&
        'status' in error &&
        typeof error.status === 'number' &&
        error.status === 404
      ) {
        throw new Error(
          `Issue #${issueNumber} not found in repository ${owner}/${repo}`,
        );
      }
      if (error instanceof Error) {
        console.error('Error fetching GitHub issue details:', error);
        throw new Error(
          `Failed to fetch GitHub issue details: ${error.message}`,
        );
      }
      console.error('Unknown error fetching GitHub issue details:', error);
      throw new Error('Failed to fetch GitHub issue details: Unknown error');
    }
  }

  async getPullRequestDetails(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<PullRequestDetails> {
    try {
      const { data: pr } = await this.octokit.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });

      const { data: files } = await this.octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
      });

      const { data: comments } = await this.octokit.issues.listComments({
        owner,
        repo,
        issue_number: prNumber,
      });

      const { data: reviewComments } =
        await this.octokit.pulls.listReviewComments({
          owner,
          repo,
          pull_number: prNumber,
        });

      return {
        title: pr.title,
        body: pr.body || '',
        comments: comments.map((comment) => ({
          user: comment.user?.login || 'unknown',
          body: comment.body || '',
          created_at: comment.created_at,
        })),
        reviewComments: reviewComments.map((reviewComment) => ({
          user: reviewComment.user?.login || 'unknown',
          body: reviewComment.body || '',
          updated_at: reviewComment.updated_at,
          commentContext: reviewComment.diff_hunk,
          line: reviewComment.line,
          path: reviewComment.path,
        })),
      };
    } catch (error) {
      console.error('Error fetching pull request details:', error);
      throw new Error('Failed to fetch pull request details');
    }
  }

  async applyChangesToPR(
    owner: string,
    repo: string,
    prNumber: number,
    changes: AIParsedResponse,
  ): Promise<void> {
    try {
      // This is a placeholder implementation. In a real scenario, you would:
      // 1. Create a new commit with the changes
      // 2. Update the pull request branch with the new commit
      console.log(`Applying changes to PR #${prNumber}`);
      console.log('Changes:', JSON.stringify(changes, null, 2));
    } catch (error) {
      console.error('Error applying changes to pull request:', error);
      throw new Error('Failed to apply changes to pull request');
    }
  }

  async addCommentToPR(
    owner: string,
    repo: string,
    prNumber: number,
    selectedFiles: string[],
    parsedResponse: AIParsedResponse,
  ): Promise<void> {
    const comment = `
## Summary
${parsedResponse.summary}

## Files we looked at:
${selectedFiles.map((file) => `- ${file}`).join('\n')}

## Potential Issues:
${parsedResponse.potentialIssues}
    `.trim();
    try {
      await this.octokit.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: comment,
      });
    } catch (error) {
      console.error('Error adding comment to pull request:', error);
      throw new Error('Failed to add comment to pull request');
    }
  }

  async checkForExistingPR(
    owner: string,
    repo: string,
    branchName: string,
    prNumber?: number,
  ): Promise<PullRequestInfo | null> {
    try {
      if (prNumber) {
        const { data: pr } = await this.octokit.pulls.get({
          owner,
          repo,
          pull_number: prNumber,
        });
        return {
          number: pr.number,
          title: pr.title,
          html_url: pr.html_url,
        };
      } else {
        const { data: pullRequests } = await this.octokit.pulls.list({
          owner,
          repo,
          head: `${owner}:${branchName}`,
          state: 'open',
        });

        if (pullRequests.length > 0) {
          const pr = pullRequests[0];
          return {
            number: pr.number,
            title: pr.title,
            html_url: pr.html_url,
          };
        }
      }

      return null;
    } catch (error) {
      if (error instanceof Error && 'status' in error && error.status === 404) {
        console.error(`Pull request not found: ${prNumber}`);
        return {
          number: prNumber || 0,
          title: 'Not Found',
          html_url: '',
        };
      }
      console.error('Error checking for existing pull request:', error);
      throw new Error('Failed to check for existing pull request');
    }
  }

  async createPullRequest(
    owner: string,
    repo: string,
    branchName: string,
    title: string,
    body: string,
    baseBranch = 'main',
    issueNumber?: number,
  ): Promise<PullRequestInfo> {
    try {
      const validBranchName = ensureValidBranchName(branchName);
      await ensureBranch('.', validBranchName);

      const { data: pullRequest } = await this.octokit.pulls.create({
        owner,
        repo,
        title,
        head: validBranchName,
        base: baseBranch,
        body,
        issue: issueNumber,
      });

      return {
        number: pullRequest.number,
        title: pullRequest.title,
        html_url: pullRequest.html_url,
      };
    } catch (error) {
      console.error('Error creating pull request:', error);
      throw new Error('Failed to create pull request');
    }
  }

  async getCodeWhisperLabeledItems(owner: string, repo: string): Promise<LabeledItem[]> {
    try {
      const issues = await this.octokit.paginate(this.octokit.issues.listForRepo, {
        owner,
        repo,
        labels: 'codewhisper',
        state: 'open',
      });

      return issues.map(item => ({
        number: item.number,
        title: item.title,
        body: item.body || '',
        html_url: item.html_url,
        updated_at: item.updated_at,
        pull_request: item.pull_request ? { url: item.pull_request.url } : undefined,
      }));
    } catch (error) {
      console.error('Error fetching CodeWhisper labeled items:', error);
      throw new Error('Failed to fetch CodeWhisper labeled items');
    }
  }

  async getLastInteraction(owner: string, repo: string, number: number): Promise<string> {
    try {
      const { data: comments } = await this.octokit.issues.listComments({
        owner,
        repo,
        issue_number: number,
      });

      if (comments.length === 0) {
        return '';
      }

      const lastComment = comments[comments.length - 1];
      return lastComment.user?.login || '';
    } catch (error) {
      console.error('Error fetching last interaction:', error);
      throw new Error('Failed to fetch last interaction');
    }
  }

  async createCommitOnPR(owner: string, repo: string, prNumber: number, commitMessage: string, changes: AIParsedResponse): Promise<void> {
    try {
      // Get the PR details
      const { data: pr } = await this.octokit.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });

      await this.createCommitOnBranch(owner, repo, pr.head.ref, commitMessage, changes);

      console.log(`Successfully created commit on PR #${prNumber}`);
    } catch (error) {
      console.error('Error creating commit on PR:', error);
      if (error instanceof Error) {
        throw new Error(`Failed to create commit on PR: ${error.message}`);
      } else {
        throw new Error('Failed to create commit on PR: Unknown error');
      }
    }
  }

  async createCommitOnBranch(owner: string, repo: string, branchName: string, commitMessage: string, changes: AIParsedResponse): Promise<void> {
    try {
      const repoInfo = await getGitHubRepoInfo('.');
      if (!repoInfo) {
        throw new Error('Unable to get GitHub repository information');
      }

      const git: SimpleGit = simpleGit('.');
      await ensureBranch('.', branchName);

      // Apply changes to files
      for (const file of changes.files) {
        await git.add(file.path);
      }

      // Create commit
      await createBranchAndCommit('.', branchName, commitMessage);

      // Push changes to remote
      await git.push('origin', branchName);

      console.log(`Successfully created commit on branch ${branchName}`);
    } catch (error) {
      console.error('Error creating commit on branch:', error);
      if (error instanceof Error) {
        throw new Error(`Failed to create commit on branch: ${error.message}`);
      } else {
        throw new Error('Failed to create commit on branch: Unknown error');
      }
    }
  }

  async getDefaultBranch(owner: string, repo: string): Promise<string> {
    try {
      const { data: repository } = await this.octokit.repos.get({
        owner,
        repo,
      });
      return repository.default_branch;
    } catch (error) {
      console.error('Error getting default branch:', error);
      if (error instanceof Error) {
        throw new Error(`Failed to get default branch: ${error.message}`);
      } else {
        throw new Error('Failed to get default branch: Unknown error');
      }
    }
  }

  async createBranch(owner: string, repo: string, branchName: string, baseBranch: string): Promise<void> {
    try {
      const git: SimpleGit = simpleGit('.');

      // Fetch the latest changes from the remote
      await git.fetch('origin');

      // Ensure we're on the base branch
      await git.checkout(baseBranch);
      await git.pull('origin', baseBranch);

      // Create and checkout the new branch
      await ensureBranch('.', branchName);

      // Push the new branch to the remote
      await git.push('origin', branchName);

      console.log(`Successfully created and pushed branch ${branchName} based on ${baseBranch}`);
    } catch (error) {
      console.error('Error creating/updating branch:', error);
      if (error instanceof Error) {
        throw new Error(`Failed to create/update branch: ${error.message}`);
      } else {
        throw new Error('Failed to create/update branch: Unknown error');
      }
    }
  }

  async createCommitOnPR(owner: string, repo: string, prNumber: number, commitMessage: string, changes: AIParsedResponse): Promise<void> {
    try {
      const { data: pr } = await this.octokit.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });

      await this.createCommitOnBranch(owner, repo, pr.head.ref, commitMessage, changes);

      console.log(`Successfully created commit on PR #${prNumber}`);
    } catch (error) {
      console.error('Error creating commit on PR:', error);
      if (error instanceof Error) {
        throw new Error(`Failed to create commit on PR: ${error.message}`);
      } else {
        throw new Error('Failed to create commit on PR: Unknown error');
      }
    }
  }
}

import { Octokit } from '@octokit/rest';
import type {
  AIParsedResponse,
  GitHubIssue,
  PullRequestDetails,
  PullRequestInfo,
} from '../types';

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
    comment: string,
  ): Promise<void> {
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
  ): Promise<PullRequestInfo | null> {
    try {
      const { data: pullRequests } = await this.octokit.pulls.list({
        owner,
        repo,
        head: `${branchName}`,
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

      return null;
    } catch (error) {
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
  ): Promise<PullRequestInfo> {
    try {
      const { data: pullRequest } = await this.octokit.pulls.create({
        owner,
        repo,
        title,
        head: `${branchName}`,
        base: baseBranch,
        body,
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
}

import { Octokit } from '@octokit/rest';
import simpleGit, { type SimpleGit } from 'simple-git';
import type {
  AIParsedResponse,
  GitHubIssue,
  Issue,
  PullRequestDetails,
  PullRequestInfo,
} from '../types';
import {
  createBranchAndCommit,
  ensureBranch,
  ensureValidBranchName,
  findOriginalBranch,
  getGitHubRepoInfo,
} from '../utils/git-tools';

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

      // Filter only comments that happened since the last AI generated revision
      const lastAIRevision = comments.findLast((comment) =>
        comment?.body?.startsWith('AI-generated'),
      );
      const lastAIRevisionDate = new Date(
        lastAIRevision?.created_at || pr.created_at,
      );
      const commentsSinceLastAIRevision = comments.filter(
        (comment) => new Date(comment.created_at) > lastAIRevisionDate,
      );
      const reviewCommentsSinceLastAIRevision = reviewComments.filter(
        (comment) => new Date(comment.updated_at) > lastAIRevisionDate,
      );

      return {
        number: pr.number,
        title: pr.title,
        body: pr.body || '',
        head: pr.head,
        comments: commentsSinceLastAIRevision.map((comment) => ({
          user: comment.user?.login || 'unknown',
          body: comment.body || '',
          created_at: comment.created_at,
        })),
        reviewComments: reviewCommentsSinceLastAIRevision.map(
          (reviewComment) => ({
            user: reviewComment.user?.login || 'unknown',
            body: reviewComment.body || '',
            updated_at: reviewComment.updated_at,
            commentContext: reviewComment.diff_hunk,
            line: reviewComment.line,
            path: reviewComment.path,
          }),
        ),
        pull_request: true,
      };
    } catch (error) {
      console.error('Error fetching pull request details:', error);
      throw new Error('Failed to fetch pull request details');
    }
  }

  async addCommentToIssue(
    owner: string,
    repo: string,
    number: number,
    selectedFiles: string[],
    parsedResponse: AIParsedResponse,
  ): Promise<void> {
    const comment = `AI-generated commit information

## Summary
${parsedResponse.summary}

## Files we looked at
${selectedFiles.map((file) => `- ${file}`).join('\n')}

## Potential Issues
${parsedResponse.potentialIssues}

## Next steps
You can reply with instructions such as:
- "Revert the last commit"  
- "Fix the typo in line 10"
- "Add a new function to the file"
    `.trim();
    try {
      await this.octokit.issues.createComment({
        owner,
        repo,
        issue_number: number,
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
      }

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
    issueNumber: number,
    branchName: string,
    issueTitle: string,
    issueBody: string,
    parsedResponse: AIParsedResponse,
    baseBranch = 'main',
  ): Promise<PullRequestInfo> {
    const title = `Issue #${issueNumber}: ${issueTitle} [AI-generated]`;
    let body = `AI-generated implementation by CodeWhisper\n\nfix: #${issueNumber}\n\n`;
    if (issueBody) {
      body += `Issue description:\n${issueBody}`;
    }
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
      });

      // Add the CodeWhisper label to the PR
      await this.octokit.issues.addLabels({
        owner,
        repo,
        issue_number: pullRequest.number,
        labels: ['codewhisper'],
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

  async getCodeWhisperLabeledItems(
    owner: string,
    repo: string,
  ): Promise<Issue[]> {
    try {
      const issues = await this.octokit.paginate(
        this.octokit.issues.listForRepo,
        {
          owner,
          repo,
          labels: 'codewhisper',
          state: 'open',
        },
      );

      // Filter out issues for which we have started PRs
      const fixedIssues = issues
        .filter(
          (issue) =>
            issue.pull_request !== undefined && issue?.body?.includes('fix:'),
        )
        .map((issue) => issue?.body?.match(/fix: #(\d+)/)?.[1]);

      return issues
        .filter((issue) => !fixedIssues.includes(issue.number.toString()))
        .map((item) => ({
          number: item.number,
          title: item.title,
          body: item.body || '',
          html_url: item.html_url,
          updated_at: item.updated_at,
          pull_request: item.pull_request
            ? { url: item.pull_request.url }
            : undefined,
        }));
    } catch (error) {
      console.error('Error fetching CodeWhisper labeled items:', error);
      throw new Error('Failed to fetch CodeWhisper labeled items');
    }
  }

  async getLastComment(
    owner: string,
    repo: string,
    item: Issue,
  ): Promise<string> {
    try {
      const { data: comments } = await this.octokit.issues.listComments({
        owner,
        repo,
        issue_number: item.number,
      });

      if (item.pull_request) {
        const { data: reviewComments } =
          await this.octokit.pulls.listReviewComments({
            owner,
            repo,
            pull_number: item.number,
          });

        comments.push(...reviewComments);
      }
      if (comments.length === 0) {
        return '';
      }
      comments.sort((a, b) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return dateA - dateB;
      });
      const lastComment = comments[comments.length - 1];
      return lastComment.body || '';
    } catch (error) {
      console.error('Error fetching last interaction:', error);
      throw new Error('Failed to fetch last interaction');
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
      }
      throw new Error('Failed to get default branch: Unknown error');
    }
  }

  async createBranch(
    basePath: string,
    owner: string,
    repo: string,
    branchName: string,
    baseBranch: string,
  ): Promise<string> {
    try {
      const git: SimpleGit = simpleGit(basePath);

      // Fetch the latest changes from the remote
      await git.fetch('origin');

      // Ensure we're on the base branch
      await git.checkout(baseBranch);
      await git.pull('origin', baseBranch);

      // Create and checkout the new branch
      const newBranchName = await ensureBranch('.', branchName);

      // Push the new branch to the remote
      await git.push('origin', branchName);

      console.log(
        `Successfully created and pushed branch ${branchName} based on ${baseBranch}`,
      );

      return newBranchName;
    } catch (error) {
      console.error('Error creating/updating branch:', error);
      if (error instanceof Error) {
        throw new Error(`Failed to create/update branch: ${error.message}`);
      }
      throw new Error('Failed to create/update branch: Unknown error');
    }
  }

  async pushChanges(
    basePath: string,
    branchName: string,
  ): Promise<void> {
    try {
      const git: SimpleGit = simpleGit(basePath);
      await git.push('origin', branchName);
    } catch (error) {
      console.error('Error pushing changes:', error);
      if (error instanceof Error) {
        throw new Error(`Failed to push changes: ${error.message}`);
      }
      throw new Error('Failed to push changes: Unknown error');
    }
  }

  async addCustomCommentToPR(
    owner: string,
    repo: string,
    prNumber: number,
    commentBody: string,
  ): Promise<void> {
    try {
      await this.octokit.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: commentBody,
      });
    } catch (error) {
      console.error('Error adding custom comment to pull request:', error);
      throw new Error('Failed to add custom comment to pull request');
    }
  }
}

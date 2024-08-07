import path from 'node:path';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyChanges } from '../../src/git/apply-changes';
import type { AIParsedResponse } from '../../src/types';

vi.mock('fs-extra');
vi.mock('simple-git');
vi.mock('../../src/utils/git-tools');

describe('applyChanges', () => {
  const mockBasePath = '/mock/base/path';

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create new files and modify existing ones', async () => {
    const mockParsedResponse: AIParsedResponse = {
      fileList: ['new-file.js', 'existing-file.js'],
      files: [
        {
          path: 'new-file.js',
          language: 'javascript',
          content: 'console.log("New file");',
          status: 'new',
        },
        {
          path: 'existing-file.js',
          language: 'javascript',
          content: 'console.log("Modified file");',
          status: 'modified',
        },
      ],
      gitBranchName: 'feature/new-branch',
      gitCommitMessage: 'Add and modify files',
      summary: 'Created a new file and modified an existing one',
      potentialIssues: 'None',
    };

    await applyChanges({
      basePath: mockBasePath,
      parsedResponse: mockParsedResponse,
      dryRun: false,
    });

    expect(fs.ensureDir).toHaveBeenCalledTimes(1);
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
  });

  it('should not apply changes in dry run mode', async () => {
    const mockParsedResponse: AIParsedResponse = {
      fileList: ['new-file.js'],
      files: [
        {
          path: 'new-file.js',
          language: 'javascript',
          content: 'console.log("New file");',
          status: 'new',
        },
      ],
      gitBranchName: 'feature/dry-run',
      gitCommitMessage: 'This should not be committed',
      summary: 'This is a dry run',
      potentialIssues: 'None',
    };

    await applyChanges({
      basePath: mockBasePath,
      parsedResponse: mockParsedResponse,
      dryRun: true,
    });

    expect(fs.ensureDir).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('should handle errors during file operations', async () => {
    const mockParsedResponse: AIParsedResponse = {
      fileList: ['error-file.js'],
      files: [
        {
          path: 'error-file.js',
          language: 'javascript',
          content: 'console.log("Error");',
          status: 'new',
        },
      ],
      gitBranchName: 'feature/error-branch',
      gitCommitMessage: 'This should fail',
      summary: 'This operation should fail',
      potentialIssues: 'None',
    };

    vi.mocked(fs.ensureDir).mockRejectedValueOnce(
      new Error('Failed to create directory'),
    );

    await expect(
      applyChanges({
        basePath: mockBasePath,
        parsedResponse: mockParsedResponse,
        dryRun: false,
      }),
    ).rejects.toThrow('Failed to create directory');
  });

  it('should handle mixed operations (create, modify, delete)', async () => {
    const mockParsedResponse: AIParsedResponse = {
      fileList: ['new-file.js', 'modified-file.js', 'deleted-file.js'],
      files: [
        {
          path: 'new-file.js',
          language: 'javascript',
          content: 'console.log("New file");',
          status: 'new',
        },
        {
          path: 'modified-file.js',
          language: 'javascript',
          content: 'console.log("Modified file");',
          status: 'modified',
        },
        {
          path: 'deleted-file.js',
          language: '',
          content: '',
          status: 'deleted',
        },
      ],
      gitBranchName: 'feature/mixed-changes',
      gitCommitMessage: 'Mixed file operations',
      summary: 'Created, modified, and deleted files',
      potentialIssues: 'None',
    };

    await applyChanges({
      basePath: mockBasePath,
      parsedResponse: mockParsedResponse,
      dryRun: false,
    });

    expect(fs.ensureDir).toHaveBeenCalledTimes(1); // Changed from 2 to 1
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
    expect(fs.remove).toHaveBeenCalledTimes(1);
  });

  it('should handle empty file list', async () => {
    const mockParsedResponse: AIParsedResponse = {
      fileList: [],
      files: [],
      gitBranchName: 'feature/no-changes',
      gitCommitMessage: 'No changes',
      summary: 'No files were changed',
      potentialIssues: 'None',
    };

    await applyChanges({
      basePath: mockBasePath,
      parsedResponse: mockParsedResponse,
      dryRun: false,
    });

    expect(fs.ensureDir).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(fs.remove).not.toHaveBeenCalled();
  });

  it('should handle file path with subdirectories', async () => {
    const mockParsedResponse: AIParsedResponse = {
      fileList: ['deep/nested/file.js'],
      files: [
        {
          path: 'deep/nested/file.js',
          language: 'javascript',
          content: 'console.log("Nested file");',
          status: 'new',
        },
      ],
      gitBranchName: 'feature/nested-file',
      gitCommitMessage: 'Add nested file',
      summary: 'Added a file in nested directories',
      potentialIssues: 'None',
    };

    await applyChanges({
      basePath: mockBasePath,
      parsedResponse: mockParsedResponse,
      dryRun: false,
    });

    expect(fs.ensureDir).toHaveBeenCalledWith(
      expect.stringContaining(path.join('deep', 'nested')),
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(path.join('deep', 'nested', 'file.js')),
      'console.log("Nested file");',
    );
  });

  it('should apply diffs for modified files when provided', async () => {
    const mockParsedResponse: AIParsedResponse = {
      fileList: ['modified-file.js'],
      files: [
        {
          path: 'modified-file.js',
          language: 'javascript',
          diff: {
            oldFileName: 'modified-file.js',
            newFileName: 'modified-file.js',
            hunks: [
              {
                oldStart: 1,
                oldLines: 1,
                newStart: 1,
                newLines: 1,
                lines: [
                  '-console.log("Old content");',
                  '+console.log("New content");',
                ],
              },
            ],
          },
          status: 'modified',
        },
      ],
      gitBranchName: 'feature/diff-modification',
      gitCommitMessage: 'Apply diff to file',
      summary: 'Modified a file using diff',
      potentialIssues: 'None',
    };

    vi.mocked(fs.readFile).mockImplementation(() =>
      Promise.resolve('console.log("Old content");'),
    );

    await applyChanges({
      basePath: mockBasePath,
      parsedResponse: mockParsedResponse,
      dryRun: false,
    });

    expect(fs.readFile).toHaveBeenCalledTimes(1);
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('modified-file.js'),
      expect.stringContaining('console.log("New content");'),
    );
  });
});

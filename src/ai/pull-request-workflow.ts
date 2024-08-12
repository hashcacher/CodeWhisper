<<<<<<< SEARCH
=======
async function checkForRevertRequest(
  owner: string,
  repo: string,
  prNumber: number,
  githubAPI: GitHubAPI,
): Promise<boolean> {
  const comments = await githubAPI.getPRComments(owner, repo, prNumber);
  const lastComment = comments[comments.length - 1];
  return lastComment && lastComment.body.toLowerCase().includes('revert the last commit');
}

async function revertLastCommit(
  owner: string,
  repo: string,
  prNumber: number,
  options: AiAssistedTaskOptions,
  githubAPI: GitHubAPI,
) {
  const basePath = path.resolve(options.path ?? '.');
  const prDetails = await githubAPI.getPullRequestDetails(owner, repo, prNumber);

  // Checkout the PR branch
  await checkoutBranch(basePath, prDetails.head.ref);

  // Revert the last commit
  const revertMessage = await revertCommit(basePath);

  // Push the revert commit
  await githubAPI.createCommitOnPR(
    owner,
    repo,
    prNumber,
    `Revert: ${revertMessage}`,
    { files: [], summary: 'Reverted last commit', potentialIssues: '' },
  );

  // Add a comment to the PR
  await githubAPI.addCommentToPR(
    owner,
    repo,
    prNumber,
    [],
    { files: [], summary: 'Reverted last commit as requested', potentialIssues: '' },
  );
}

>>>>>>> REPLACE
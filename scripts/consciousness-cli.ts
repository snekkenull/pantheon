import {
  extractConsciousnessProposal,
  suggestConsciousnessProposal,
} from "../consciousness/extractor.js";
import {
  applyProposal,
  evolveConsciousness,
  formatProposalReview,
  readProposalFile,
  readReviewFile,
  resolveReviewPath,
  reviewProposal,
  resolveProposalPath,
  writeProposalFile,
} from "../consciousness/workflow.js";
import { resolveWorkspace } from "../consciousness/workspace.js";

type CommandOptions = {
  workspace?: string;
  proposal?: string;
  review?: string;
  decisionsFile?: string;
  agentId?: string;
  apiBaseUrl?: string;
};

function parseCommandOptions(argv: string[]): CommandOptions {
  const options: CommandOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const nextValue = argv[index + 1];

    if (!argument.startsWith("--")) {
      continue;
    }

    if (!nextValue || nextValue.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }

    if (argument === "--workspace") {
      options.workspace = nextValue;
    } else if (argument === "--proposal") {
      options.proposal = nextValue;
    } else if (argument === "--review") {
      options.review = nextValue;
    } else if (argument === "--decisions-file") {
      options.decisionsFile = nextValue;
    } else if (argument === "--agent-id") {
      options.agentId = nextValue;
    } else if (argument === "--api-base-url") {
      options.apiBaseUrl = nextValue;
    } else {
      throw new Error(`Unknown option ${argument}`);
    }

    index += 1;
  }

  return options;
}

function printUsage() {
  console.log(`Usage:
  pnpm consciousness extract --workspace <dir> [--agent-id <id>]
  pnpm consciousness suggest --workspace <dir> [--agent-id <id>]
  pnpm consciousness evolve --workspace <dir> [--agent-id <id>] [--api-base-url <url>]
  pnpm consciousness review --workspace <dir> [--proposal <path>] [--agent-id <id>] [--decisions-file <path>]
  pnpm consciousness apply --workspace <dir> [--proposal <path>] [--review <path>] [--agent-id <id>] [--api-base-url <url>]`);
}

async function run() {
  const [command, ...argv] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  const options = parseCommandOptions(argv);

  if (!options.workspace) {
    throw new Error("--workspace is required");
  }

  if (command === "extract") {
    const proposal = extractConsciousnessProposal({
      workspace: options.workspace,
      agentId: options.agentId,
    });
    const workspace = resolveWorkspace(options.workspace, options.agentId);
    const proposalPath = writeProposalFile(proposal, workspace.proposalsDirectory);
    const reviewPath = `${workspace.reviewsDirectory}/${proposal.proposalId}.json`;

    console.log(`Wrote proposal ${proposal.proposalId}`);
    console.log(`Proposal: ${proposalPath}`);
    console.log(`Review: ${reviewPath}`);
    console.log(
      `${proposal.changes.filter((change) => change.suggestedDecision === "accept").length} accepted changes, ${proposal.changes.filter((change) => change.suggestedDecision === "hold").length} held changes`,
    );
    return;
  }

  if (command === "suggest") {
    const proposal = suggestConsciousnessProposal({
      workspace: options.workspace,
      agentId: options.agentId,
    });
    const workspace = resolveWorkspace(options.workspace, options.agentId);
    const proposalPath = writeProposalFile(proposal, workspace.proposalsDirectory);
    const reviewPath = `${workspace.reviewsDirectory}/${proposal.proposalId}.json`;

    console.log(`Wrote proposal ${proposal.proposalId}`);
    console.log(`Proposal: ${proposalPath}`);
    console.log(`Review: ${reviewPath}`);
    console.log(
      `${proposal.changes.filter((change) => change.suggestedDecision === "accept").length} accepted changes, ${proposal.changes.filter((change) => change.suggestedDecision === "hold").length} held changes`,
    );
    return;
  }

  if (command === "review") {
    if (options.decisionsFile) {
      const result = reviewProposal({
        workspace: options.workspace,
        proposalPath: options.proposal,
        decisionsPath: options.decisionsFile,
        agentId: options.agentId,
      });

      console.log(`Wrote review ${result.review.reviewId}`);
      console.log(`Proposal: ${result.proposalPath}`);
      console.log(`Review: ${result.reviewPath}`);
      console.log(formatProposalReview(result.proposal, result.review));
      return;
    }

    const proposalPath = resolveProposalPath(options.workspace, options.proposal, options.agentId);
    const proposal = readProposalFile(proposalPath);
    const reviewPath = resolveReviewPath({
      workspace: options.workspace,
      proposalId: proposal.proposalId,
      reviewPath: options.review,
      agentId: options.agentId,
      required: false,
    });
    const review = reviewPath ? readReviewFile(reviewPath) : null;
    console.log(formatProposalReview(proposal, review));
    return;
  }

  if (command === "evolve") {
    const result = await evolveConsciousness({
      workspace: options.workspace,
      agentId: options.agentId,
      apiBaseUrl: options.apiBaseUrl,
    });

    console.log(`Evolved proposal ${result.proposal.proposalId}`);
    console.log(`Proposal: ${result.proposalPath}`);
    console.log(`History: ${result.historyPath}`);
    if (result.noOp) {
      console.log("No autonomous changes crossed the mutation threshold.");
    }
    if (result.published) {
      console.log(`Published at ${result.publishedAt}`);
    }
    return;
  }

  if (command === "apply") {
    const result = await applyProposal({
      workspace: options.workspace,
      proposalPath: options.proposal,
      reviewPath: options.review,
      apiBaseUrl: options.apiBaseUrl,
      agentId: options.agentId,
    });

    console.log(`Applied proposal ${result.proposal.proposalId}`);
    console.log(`Review: ${result.reviewPath}`);
    if (result.historyPath) {
      console.log(`History: ${result.historyPath}`);
    }
    if (result.noOp) {
      console.log("No accepted changes mutated CONSCIOUSNESS.md.");
    }
    if (result.published) {
      console.log(`Published at ${result.publishedAt}`);
    }
    return;
  }

  throw new Error(`Unknown command ${command}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});

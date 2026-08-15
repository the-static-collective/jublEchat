const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const path = 'src/App.tsx';
const expectedBlob = 'fb480a6f9e760922cb984247e2be090c054d3b1b';
const actualBlob = execFileSync('git', ['hash-object', path], { encoding: 'utf8' }).trim();
if (actualBlob !== expectedBlob) {
  throw new Error(`Refusing UI patch: expected App blob ${expectedBlob}, found ${actualBlob}.`);
}

let source = fs.readFileSync(path, 'utf8');

const ledgerImport = "import { resolveWhyCurrentChain, getTamperFixtures, reduceEvents, verifyStrictAncestryPath } from './lib/ledger';";
const nearbyImport = `${ledgerImport}\nimport { deriveNearbyGrowth } from './lib/nearby-growth';`;
if (!source.includes(ledgerImport) || source.includes("from './lib/nearby-growth'")) {
  throw new Error('Refusing UI patch: Nearby Growth import seam is missing or already patched.');
}
source = source.replace(ledgerImport, nearbyImport);

const proposalSeam = `                const activeProposalObj = messages\n                  .flatMap((m) => (m.content.proposals || []).map((p, idx) => ({ ...p, msgId: m.id, idx })))\n                  .find((p) => p.type === 'evolve_idea' && p.idea_id === idea.id && !rejectedProposals[\`\${p.msgId}-\${p.idx}\`]);\n\n                return (`;
const projectionSeam = `                const activeProposalObj = messages\n                  .flatMap((m) => (m.content.proposals || []).map((p, idx) => ({ ...p, msgId: m.id, idx })))\n                  .find((p) => p.type === 'evolve_idea' && p.idea_id === idea.id && !rejectedProposals[\`\${p.msgId}-\${p.idx}\`]);\n\n                const nearbyGrowth = deriveNearbyGrowth({\n                  selectedIdeaId: idea.id,\n                  ideas,\n                  versions: allIdeaVersions,\n                  artifacts,\n                  edges,\n                });\n\n                return (`;
if (!source.includes(proposalSeam)) {
  throw new Error('Refusing UI patch: proposal/projection seam not found exactly once.');
}
source = source.replace(proposalSeam, projectionSeam);

const blockMarker = '                                      {/* Sibling Ideas */}';
const blockStart = source.indexOf(blockMarker);
if (blockStart === -1) throw new Error('Refusing UI patch: sibling block start not found.');
if (source.indexOf(blockMarker, blockStart + 1) !== -1) {
  throw new Error('Refusing UI patch: sibling block start is ambiguous.');
}
const closeSequence = '\n                                      </div>\n                                    </div>';
const closeStart = source.indexOf(closeSequence, blockStart);
if (closeStart === -1) throw new Error('Refusing UI patch: sibling block close not found.');
const blockEnd = closeStart + '\n                                      </div>'.length;

const replacement = `                                      {/* Evidence-backed nearby ideas */}\n                                      <div className="p-2.5 bg-slate-900/20 rounded-xl border border-slate-850 space-y-1.5">\n                                        <p className="text-[8px] font-mono text-emerald-400 uppercase font-bold tracking-wider">\n                                          Evidenced Neighbor Nodes\n                                        </p>\n                                        {nearbyGrowth.length > 0 ? (\n                                          <div className="flex flex-col gap-2">\n                                            {nearbyGrowth.map((neighbor) => (\n                                              <div key={neighbor.idea.id} className="space-y-1 rounded-lg border border-slate-900 bg-slate-950/30 p-2">\n                                                <div className="flex items-center justify-between gap-2 text-[10px]">\n                                                  <span className="font-medium text-slate-300 truncate max-w-[150px]">{neighbor.idea.title}</span>\n                                                  <span className="text-[8px] font-mono text-slate-500 bg-slate-950 px-1 rounded uppercase">\n                                                    {neighbor.idea.taxonomy_level}\n                                                  </span>\n                                                </div>\n                                                <div className="flex flex-wrap gap-1">\n                                                  {neighbor.evidence.map((evidence) => (\n                                                    <span\n                                                      key={evidence}\n                                                      className="text-[7px] font-mono text-emerald-300 bg-emerald-950/50 border border-emerald-900/30 px-1 py-0.5 rounded uppercase"\n                                                    >\n                                                      {evidence === 'direct_relation'\n                                                        ? 'direct relation'\n                                                        : evidence === 'shared_ancestor'\n                                                          ? 'shared ancestor'\n                                                          : 'shared friction'}\n                                                    </span>\n                                                  ))}\n                                                </div>\n                                              </div>\n                                            ))}\n                                          </div>\n                                        ) : (\n                                          <p className="text-[9px] text-slate-555 italic">\n                                            No evidenced nearby growth yet.\n                                          </p>\n                                        )}\n                                      </div>`;

source = `${source.slice(0, blockStart)}${replacement}${source.slice(blockEnd)}`;

if (source.includes('const siblingIdeas = ideas.filter')) {
  throw new Error('Refusing UI patch: same-taxonomy heuristic survived replacement.');
}
if (!source.includes('Evidenced Neighbor Nodes') || !source.includes('No evidenced nearby growth yet.')) {
  throw new Error('Refusing UI patch: expected evidence UI was not materialized.');
}

fs.writeFileSync(path, source, 'utf8');
console.log('Nearby Growth UI patch applied deterministically.');

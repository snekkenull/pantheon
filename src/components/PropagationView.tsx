import type { MorphologyBridge, MorphologyFamily } from "../api";

type PropagationViewProps = {
  bridges: MorphologyBridge[];
  families: MorphologyFamily[];
  selectedFamily: MorphologyFamily | null;
  onFamilySelect: (familyId: string) => void;
};

export default function PropagationView({
  bridges,
  families,
  selectedFamily,
  onFamilySelect,
}: PropagationViewProps) {
  const leaders = [...families]
    .sort((left, right) => {
      if (right.propagationDepth !== left.propagationDepth) {
        return right.propagationDepth - left.propagationDepth;
      }

      return right.lastSeenAt.localeCompare(left.lastSeenAt);
    })
    .slice(0, 8);

  const scopedBridges = selectedFamily
    ? bridges.filter((bridge) => bridge.familyId === selectedFamily.familyId)
    : bridges;

  return (
    <section className="view-panel">
      <div className="view-panel-header">
        <div>
          <p className="eyebrow">Propagation</p>
          <h2>Bridge Paths and Carry Chains</h2>
        </div>
      </div>

      <div className="propagation-grid">
        <article className="propagation-column">
          <div className="timeline-column-header">
            <h3>Bridge Paths</h3>
            <span>{scopedBridges.length}</span>
          </div>
          <div className="timeline-list">
            {scopedBridges.map((bridge) => (
              <div key={`${bridge.agentId}:${bridge.familyId}:${bridge.fromPairId}:${bridge.toPairId}`} className="propagation-card">
                <div className="timeline-card-head">
                  <strong>{bridge.anchorSequence}</strong>
                  <span className={`status-badge ${bridge.status}`}>{bridge.status}</span>
                </div>
                <p>{bridge.agentId}</p>
                <p>{bridge.fromPairId} → {bridge.toPairId}</p>
              </div>
            ))}
            {scopedBridges.length === 0 && <div className="empty-note">No bridge paths in the current observer window.</div>}
          </div>
        </article>

        <article className="propagation-column">
          <div className="timeline-column-header">
            <h3>Propagation Leaders</h3>
            <span>{leaders.length}</span>
          </div>
          <div className="timeline-list">
            {leaders.map((family) => (
              <button key={family.familyId} type="button" className="propagation-family-card" onClick={() => onFamilySelect(family.familyId)}>
                <div className="timeline-card-head">
                  <strong>{family.anchorSequence}</strong>
                  <span>{family.state}</span>
                </div>
                <p>{family.propagationDepth} pair contexts · {family.variantSequences.length} variants</p>
                <p>origin {family.originPairId}</p>
              </button>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

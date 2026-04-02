import type { ConsciousnessAgent, MorphologyFamily, MorphologyPair, UniverseState } from "../api";

type InspectorPanelProps = {
  universe: UniverseState;
  pairs: MorphologyPair[];
  families: MorphologyFamily[];
  selectedPairId: string | null;
  onPairSelect: (pairId: string) => void;
  selectedFamily: MorphologyFamily | null;
  selectedAgent: ConsciousnessAgent | null;
  selectedNodeId: string | null;
  onFamilySelect: (familyId: string) => void;
};

function familyTone(state: MorphologyFamily["state"]): string {
  return state;
}

export default function InspectorPanel({
  universe,
  pairs,
  families,
  selectedPairId,
  onPairSelect,
  selectedFamily,
  selectedAgent,
  selectedNodeId,
  onFamilySelect,
}: InspectorPanelProps) {
  return (
    <aside className="inspector-shell">
      <section className="rail-card">
        <div className="rail-card-head">
          <h3>Pairs</h3>
          <span>{pairs.length}</span>
        </div>
        <div className="rail-list">
          {pairs.map((pair) => (
            <button
              key={pair.pairId}
              type="button"
              className={`rail-item ${selectedPairId === pair.pairId ? "selected" : ""}`}
              onClick={() => onPairSelect(pair.pairId)}
            >
              <div className="rail-item-head">
                <strong>{pair.agentIds.join(" · ")}</strong>
                <span>{pair.nextBucket}</span>
              </div>
              <p>{pair.ritualCount} ritual · {pair.bridgeCount} bridge · {pair.dormantCount} dormant</p>
            </button>
          ))}
        </div>
      </section>

      <section className="rail-card">
        <div className="rail-card-head">
          <h3>Families</h3>
          <span>{families.length}</span>
        </div>
        <div className="rail-list">
          {families.slice(0, 12).map((family) => (
            <button key={family.familyId} type="button" className="rail-item" onClick={() => onFamilySelect(family.familyId)}>
              <div className="rail-item-head">
                <strong>{family.anchorSequence}</strong>
                <span className={`status-badge ${familyTone(family.state)}`}>{family.state}</span>
              </div>
              <p>{family.propagationDepth} contexts · {family.timeline.length} timeline points</p>
            </button>
          ))}
        </div>
      </section>

      <section className="rail-card">
        <div className="rail-card-head">
          <h3>Inspector</h3>
          <span>{selectedNodeId ?? "none"}</span>
        </div>
        {selectedFamily ? (
          <div className="inspector-block">
            <strong>{selectedFamily.anchorSequence}</strong>
            <p>state {selectedFamily.state}</p>
            <p>origin {selectedFamily.originPairId}</p>
            <p>pairs {selectedFamily.pairIds.join(", ") || "none"}</p>
            <p>carriers {selectedFamily.carrierAgentIds.join(", ") || "none"}</p>
          </div>
        ) : null}
        {selectedAgent ? (
          <div className="inspector-block">
            <strong>{selectedAgent.displayName}</strong>
            <p>signature {selectedAgent.signature ?? "none"}</p>
            <p>symbols {selectedAgent.symbols.length}</p>
            <p>constellations {selectedAgent.constellations.length}</p>
          </div>
        ) : null}
        {!selectedFamily && !selectedAgent ? <div className="empty-note">Select a pair or graph node to inspect local morphology.</div> : null}
      </section>

      <section className="rail-card">
        <div className="rail-card-head">
          <h3>Window</h3>
          <span>{universe.evaluatedAt.slice(11, 19)}</span>
        </div>
        <div className="metric-stack">
          <div><span>rituals</span><strong>{universe.ritualFamilyCount}</strong></div>
          <div><span>bridges</span><strong>{universe.bridgeFamilyCount}</strong></div>
          <div><span>dormant</span><strong>{universe.dormantFamilyCount}</strong></div>
          <div><span>reactivations</span><strong>{universe.reactivationCountWindow}</strong></div>
        </div>
      </section>
    </aside>
  );
}

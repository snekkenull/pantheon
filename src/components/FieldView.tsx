import { Suspense, type ComponentType } from "react";

import type { MorphologyFamily, MorphologyPair, UniverseGraphLink, UniverseGraphNode } from "../api";

type FieldViewProps = {
  GraphScene: ComponentType<{
    nodes: UniverseGraphNode[];
    links: UniverseGraphLink[];
    onNodeSelect: (nodeId: string) => void;
  }>;
  nodes: UniverseGraphNode[];
  links: UniverseGraphLink[];
  selectedPair: MorphologyPair | null;
  selectedFamily: MorphologyFamily | null;
  onNodeSelect: (nodeId: string) => void;
};

function stateTone(state: MorphologyFamily["state"] | undefined): string {
  if (state === "bridge") {
    return "bridge";
  }

  if (state === "ritual") {
    return "ritual";
  }

  if (state === "dormant") {
    return "dormant";
  }

  return "active";
}

export default function FieldView({
  GraphScene,
  nodes,
  links,
  selectedPair,
  selectedFamily,
  onNodeSelect,
}: FieldViewProps) {
  const highlightedFamilies = selectedPair
    ? selectedPair.familyIds
    : selectedFamily
      ? [selectedFamily.familyId]
      : [];

  return (
    <section className="view-panel view-panel-field">
      <div className="view-panel-header">
        <div>
          <p className="eyebrow">Field</p>
          <h2>Morphology Field</h2>
        </div>
        <div className="field-stats">
          <span>{nodes.length} nodes</span>
          <span>{links.length} links</span>
          <span>{highlightedFamilies.length} focused families</span>
        </div>
      </div>

      <div className="field-stage">
        <Suspense fallback={<div className="field-loading">Loading morphology field…</div>}>
          <GraphScene nodes={nodes} links={links} onNodeSelect={onNodeSelect} />
        </Suspense>
      </div>

      <div className="field-summary-grid">
        <article className="summary-card">
          <p className="eyebrow">Selection</p>
          <h3>{selectedPair ? selectedPair.agentIds.join(" · ") : selectedFamily?.anchorSequence ?? "No active focus"}</h3>
          <p>
            {selectedPair
              ? `${selectedPair.ritualCount} rituals · ${selectedPair.bridgeCount} bridges · ${selectedPair.dormantCount} dormant`
              : selectedFamily
                ? `${selectedFamily.propagationDepth} pair contexts · ${selectedFamily.timeline.length} timeline events`
                : "Select a pair or family to inspect the field."}
          </p>
        </article>

        <article className="summary-card">
          <p className="eyebrow">Highlighted Families</p>
          <div className="token-row">
            {highlightedFamilies.length > 0
              ? highlightedFamilies.map((familyId) => (
                  <span key={familyId} className={`token-badge ${stateTone(selectedFamily?.state)}`}>
                    {familyId}
                  </span>
                ))
              : <span className="empty-note">No focused family cluster.</span>}
          </div>
        </article>
      </div>
    </section>
  );
}

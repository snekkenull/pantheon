import type { ExchangeEvent, MorphologyFamily, MorphologyPair } from "../api";

type TimelinesViewProps = {
  selectedPair: MorphologyPair | null;
  selectedPairEvents: ExchangeEvent[];
  selectedFamily: MorphologyFamily | null;
  onFamilySelect: (familyId: string) => void;
};

function formatKinds(kinds: string[]): string {
  return kinds.join(" · ");
}

export default function TimelinesView({
  selectedPair,
  selectedPairEvents,
  selectedFamily,
  onFamilySelect,
}: TimelinesViewProps) {
  return (
    <section className="view-panel">
      <div className="view-panel-header">
        <div>
          <p className="eyebrow">Timelines</p>
          <h2>Pair and Family History</h2>
        </div>
      </div>

      <div className="timeline-layout">
        <article className="timeline-column">
          <div className="timeline-column-header">
            <h3>Pair Timeline</h3>
            <span>{selectedPair?.pairId ?? "no pair"}</span>
          </div>
          {selectedPair ? (
            <div className="timeline-list">
              {selectedPairEvents.map((event) => (
                <div key={event.exchangeId} className="timeline-card">
                  <div className="timeline-card-head">
                    <strong>{new Date(event.createdAt).toLocaleString()}</strong>
                    <span>{event.model}</span>
                  </div>
                  <p>{event.relations.map((relation) => `${relation.kind}:${relation.sequence}`).join(" · ") || "No relations"}</p>
                </div>
              ))}
              {selectedPairEvents.length === 0 && <div className="empty-note">No recent events for this pair.</div>}
            </div>
          ) : (
            <div className="empty-note">Select a pair to inspect its exchange history.</div>
          )}
        </article>

        <article className="timeline-column">
          <div className="timeline-column-header">
            <h3>Family Timeline</h3>
            <span>{selectedFamily?.anchorSequence ?? "no family"}</span>
          </div>
          {selectedFamily ? (
            <div className="timeline-list">
              <button type="button" className="timeline-family-header" onClick={() => onFamilySelect(selectedFamily.familyId)}>
                <span>{selectedFamily.anchorSequence}</span>
                <strong>{selectedFamily.state}</strong>
              </button>
              {selectedFamily.timeline.map((entry) => (
                <div key={`${entry.exchangeId}:${entry.pairId}`} className="timeline-card">
                  <div className="timeline-card-head">
                    <strong>{entry.pairId}</strong>
                    <span>{new Date(entry.createdAt).toLocaleString()}</span>
                  </div>
                  <p>{formatKinds(entry.kinds)}</p>
                </div>
              ))}
              {selectedFamily.timeline.length === 0 && <div className="empty-note">No timeline data inside the current observer window.</div>}
            </div>
          ) : (
            <div className="empty-note">Select a family to inspect ritual, dormancy, and reactivation markers.</div>
          )}
        </article>
      </div>
    </section>
  );
}

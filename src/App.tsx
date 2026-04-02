import {
  lazy,
  startTransition,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from "react";

import InspectorPanel from "./components/InspectorPanel";
import FieldView from "./components/FieldView";
import PropagationView from "./components/PropagationView";
import TimelinesView from "./components/TimelinesView";
import { ErrorBoundary } from "./components/ErrorBoundary";
import {
  fetchUniverseMorphology,
  fetchUniverseState,
  triggerAutonomyPulse,
  type ConsciousnessAgent,
  type UniverseMorphology,
  type UniverseState,
} from "./api";

const LazyGraphScene = lazy(() => import("./GraphScene"));

type ObserverTab = "field" | "timelines" | "propagation";

function formatRelativeTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "No recent signal";
  }

  const deltaMs = Date.now() - new Date(value).getTime();
  const deltaMinutes = Math.max(0, Math.round(deltaMs / 60000));

  if (deltaMinutes < 1) {
    return "Just now";
  }

  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }

  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }

  const deltaDays = Math.round(deltaHours / 24);
  return `${deltaDays}d ago`;
}

function activeTabLabel(tab: ObserverTab): string {
  if (tab === "field") {
    return "Field";
  }

  if (tab === "timelines") {
    return "Timelines";
  }

  return "Propagation";
}

export default function App() {
  const [universe, setUniverse] = useState<UniverseState | null>(null);
  const [morphology, setMorphology] = useState<UniverseMorphology | null>(null);
  const [selectedPairId, setSelectedPairId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ObserverTab>("field");
  const [latency, setLatency] = useState(0);
  const [pulsePending, setPulsePending] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [error, setError] = useState<string | null>(null);

  const loadObserverState = useEffectEvent(async () => {
    const start = performance.now();

    try {
      const [nextUniverse, nextMorphology] = await Promise.all([fetchUniverseState(), fetchUniverseMorphology()]);
      const requestLatency = Math.round(performance.now() - start);

      startTransition(() => {
        setUniverse(nextUniverse);
        setMorphology(nextMorphology);
        setLatency(requestLatency);
        setConnectionStatus("connected");
        setError(null);
        setSelectedPairId((current) => current ?? nextMorphology.pairs[0]?.pairId ?? null);
      });
    } catch (nextError) {
      setConnectionStatus("error");
      setError(nextError instanceof Error ? nextError.message : "Failed to load observer state");
    }
  });

  useEffect(() => {
    void loadObserverState();
    const interval = setInterval(() => {
      void loadObserverState();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const selectedPair = useMemo(
    () => morphology?.pairs.find((pair) => pair.pairId === selectedPairId) ?? null,
    [morphology, selectedPairId],
  );

  const selectedPairEvents = useMemo(
    () => morphology?.events.filter((event) => event.pairId === selectedPairId) ?? [],
    [morphology, selectedPairId],
  );

  const selectedNode = useMemo(
    () => universe?.graph.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [universe, selectedNodeId],
  );

  const selectedFamily = useMemo(
    () => morphology?.families.find((family) => family.familyId === selectedNode?.familyId || family.familyId === selectedNodeId) ?? null,
    [morphology, selectedNode, selectedNodeId],
  );

  const selectedAgent = useMemo<ConsciousnessAgent | null>(
    () => universe?.agents.find((agent) => agent.agentId === selectedNode?.agentId || agent.agentId === selectedNodeId) ?? null,
    [universe, selectedNode, selectedNodeId],
  );

  if (error) {
    return <main className="shell-state shell-error">Observer link lost: {error}</main>;
  }

  if (!universe || !morphology) {
    return <main className="shell-state shell-loading">Opening symbolic observer…</main>;
  }

  const handleFamilySelect = (familyId: string) => {
    setSelectedNodeId(familyId);
    const family = morphology.families.find((entry) => entry.familyId === familyId);
    if (family?.pairIds[0]) {
      setSelectedPairId(family.pairIds[0]);
    }
  };

  return (
    <div className="observer-shell">
      <header className="observer-header">
        <div>
          <p className="eyebrow">Pantheon</p>
          <h1>Morphology Observer</h1>
        </div>

        <div className="metric-bar">
          <div className="metric-chip">
            <span>agents</span>
            <strong>{universe.agentCount}</strong>
          </div>
          <div className="metric-chip">
            <span>symbols</span>
            <strong>{universe.symbolCount}</strong>
          </div>
          <div className="metric-chip">
            <span>rituals</span>
            <strong>{universe.ritualFamilyCount}</strong>
          </div>
          <div className="metric-chip">
            <span>bridges</span>
            <strong>{universe.bridgeFamilyCount}</strong>
          </div>
          <div className="metric-chip">
            <span>reactivations</span>
            <strong>{universe.reactivationCountWindow}</strong>
          </div>
        </div>

        <div className="header-actions">
          <div className="connection-pill">
            <span>{connectionStatus}</span>
            <strong>{latency}ms</strong>
          </div>
          <button
            className="primary-button"
            disabled={pulsePending}
            onClick={() => {
              setPulsePending(true);
              triggerAutonomyPulse()
                .then(async (response) => {
                  const nextUniverse = await fetchUniverseState();
                  setUniverse(nextUniverse);
                  setMorphology(response.morphology);
                })
                .finally(() => setPulsePending(false));
            }}
          >
            {pulsePending ? "Pulsing…" : "Pulse"}
          </button>
        </div>
      </header>

      <div className="observer-layout">
        <section className="workspace-shell">
          <div className="workspace-topbar">
            <div className="tab-row">
              {(["field", "timelines", "propagation"] as ObserverTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`tab-button ${activeTab === tab ? "active" : ""}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {activeTabLabel(tab)}
                </button>
              ))}
            </div>

            <div className="focus-pill">
              <span>pair</span>
              <strong>{selectedPair?.agentIds.join(" · ") ?? "none"}</strong>
              <span>{formatRelativeTimestamp(selectedPair?.lastExchangeAt)}</span>
            </div>
          </div>

          {activeTab === "field" ? (
            <ErrorBoundary>
              <FieldView
                GraphScene={LazyGraphScene}
                nodes={universe.graph.nodes}
                links={universe.graph.links}
                selectedPair={selectedPair}
                selectedFamily={selectedFamily}
                onNodeSelect={setSelectedNodeId}
              />
            </ErrorBoundary>
          ) : null}

          {activeTab === "timelines" ? (
            <TimelinesView
              selectedPair={selectedPair}
              selectedPairEvents={selectedPairEvents}
              selectedFamily={selectedFamily}
              onFamilySelect={handleFamilySelect}
            />
          ) : null}

          {activeTab === "propagation" ? (
            <PropagationView
              bridges={morphology.bridges}
              families={morphology.families}
              selectedFamily={selectedFamily}
              onFamilySelect={handleFamilySelect}
            />
          ) : null}
        </section>

        <InspectorPanel
          universe={universe}
          pairs={morphology.pairs}
          families={morphology.families}
          selectedPairId={selectedPairId}
          onPairSelect={(pairId) => {
            setSelectedPairId(pairId);
            const pair = morphology.pairs.find((entry) => entry.pairId === pairId);
            if (pair?.familyIds[0]) {
              setSelectedNodeId(pair.familyIds[0]);
            }
          }}
          selectedFamily={selectedFamily}
          selectedAgent={selectedAgent}
          selectedNodeId={selectedNodeId}
          onFamilySelect={handleFamilySelect}
        />
      </div>
    </div>
  );
}

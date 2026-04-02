declare module "react-force-graph-3d" {
  import { ComponentType } from "react";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type AnyRecord = Record<string, any>;

  interface ForceGraphProps<N extends AnyRecord = AnyRecord, L extends AnyRecord = AnyRecord> {
    ref?: any;
    graphData?: { nodes: N[]; links: L[] };
    backgroundColor?: string;
    nodeLabel?: string | ((node: N) => string);
    nodeColor?: string | ((node: N) => string | undefined);
    nodeVal?: number | string | ((node: N) => number);
    nodeThreeObject?: (node: N) => object;
    nodeThreeObjectExtend?: boolean;
    linkColor?: string | ((link: L) => string);
    linkOpacity?: number;
    linkWidth?: number | ((link: L) => number);
    linkDirectionalParticles?: number | ((link: L) => number);
    linkDirectionalParticleWidth?: number | ((link: L) => number);
    linkCurvature?: number | ((link: L) => number);
    warmupTicks?: number;
    cooldownTicks?: number;
    onNodeClick?: (node: N, event: MouseEvent) => void;
    showNavInfo?: boolean;
    enableNodeDrag?: boolean;
    cooldownTime?: number;
    d3AlphaDecay?: number;
    d3VelocityDecay?: number;
    dagMode?: "td" | "bu" | "lr" | "rl" | "zin" | "zout" | "radialout" | "radialin";
    dagLevelDistance?: number;
    linkDirectionalParticleSpeed?: number | ((link: L) => number);
  }

  function ForceGraph3D<N extends AnyRecord = AnyRecord, L extends AnyRecord = AnyRecord>(
    props: ForceGraphProps<N, L>,
  ): JSX.Element;

  export default ForceGraph3D;
}

import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import { useEffect, useMemo, useRef } from "react";

import type { UniverseGraphLink, UniverseGraphNode } from "./api";

type GraphSceneProps = {
  nodes: UniverseGraphNode[];
  links: UniverseGraphLink[];
  onNodeSelect: (nodeId: string) => void;
};

const STATE_COLORS: Record<string, string> = {
  seed: "#d8f3dc",
  active: "#95d5b2",
  ritual: "#f4a261",
  bridge: "#e76f51",
  dormant: "#6c757d",
};

function nodeColor(node: UniverseGraphNode): string {
  if (node.kind === "agent") {
    return "#7dd3fc";
  }

  return STATE_COLORS[node.state ?? "active"] ?? "#95d5b2";
}

function nodeScale(node: UniverseGraphNode): number {
  if (node.kind === "agent") {
    return 7;
  }

  if (node.state === "bridge") {
    return 6;
  }

  if (node.state === "ritual") {
    return 5.5;
  }

  if (node.state === "dormant") {
    return 3.8;
  }

  return 4.4;
}

function linkColor(kind: UniverseGraphLink["kind"]): string {
  if (kind === "carries") {
    return "#e76f51";
  }

  if (kind === "ritualizes") {
    return "#f4a261";
  }

  return "#8ecae6";
}

export default function GraphScene({ links, nodes, onNodeSelect }: GraphSceneProps) {
  const fgRef = useRef<any>(null);
  
  const graphData = useMemo(() => ({ nodes, links }), [nodes, links]);

  // Cache THREE objects to prevent re-creating them on every frame/render
  const nodeMeshCache = useRef<Map<string, THREE.Group>>(new Map());

  useEffect(() => {
    if (!fgRef.current) {
      return;
    }

    fgRef.current.d3Force("charge").strength(-240);
    fgRef.current.d3Force("link").distance(120);
    fgRef.current.cameraPosition({ z: 520 });

    const controls = fgRef.current.controls();
    if (controls) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.6;
      controls.enableZoom = true;
      controls.minDistance = 120;
      controls.maxDistance = 1800;
    }
  }, []);

  return (
    <ForceGraph3D<UniverseGraphNode, UniverseGraphLink>
      ref={fgRef}
      backgroundColor="#020308"
      showNavInfo={false}
      graphData={graphData}
      nodeLabel={(node) =>
        `<div style="background: rgba(10,12,20,0.92); padding: 12px; border-radius: 8px; border: 1px solid ${nodeColor(node)}80; box-shadow: 0 12px 30px rgba(0,0,0,0.45);">
          <div style="color: rgba(255,255,255,0.56); font-size: 10px; text-transform: uppercase; letter-spacing: 0.16em; margin-bottom: 4px;">${node.kind}</div>
          <div style="color: #fff; font-weight: 600; font-size: 16px; margin-bottom: 6px;">${node.label}</div>
          <div style="font-size: 13px; color: rgba(255,255,255,0.74);">state: ${node.state ?? "n/a"}</div>
        </div>`
      }
      nodeThreeObject={(node) => {
        // Simple caching based on node ID and state/kind which affect appearance
        const cacheKey = `${node.id}:${node.kind}:${node.state}`;
        if (nodeMeshCache.current.has(cacheKey)) {
          return nodeMeshCache.current.get(cacheKey)!;
        }

        const group = new THREE.Group();
        const color = nodeColor(node);
        const scale = nodeScale(node);
        const geometry = node.kind === "agent"
          ? new THREE.OctahedronGeometry(1.2, 0)
          : new THREE.IcosahedronGeometry(1, 1);
        const material = new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: node.kind === "agent" ? 0.8 : 0.45,
          roughness: 0.35,
          metalness: 0.2,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.scale.setScalar(scale);
        group.add(mesh);

        if (node.kind === "family" && (node.state === "ritual" || node.state === "bridge")) {
          const halo = new THREE.Mesh(
            new THREE.TorusGeometry(scale * 1.25, 0.18, 12, 48),
            new THREE.MeshBasicMaterial({
              color,
              transparent: true,
              opacity: 0.4,
            }),
          );
          halo.rotation.x = Math.PI / 2;
          group.add(halo);
        }

        nodeMeshCache.current.set(cacheKey, group);
        return group;
      }}
      linkColor={(link: UniverseGraphLink) => linkColor(link.kind)}
      linkWidth={(link: UniverseGraphLink) => link.kind === "carries" ? 2.8 : link.kind === "ritualizes" ? 2.2 : 1.2}
      linkDirectionalParticles={(link: UniverseGraphLink) => link.kind === "holds" ? 1 : 3}
      linkDirectionalParticleWidth={(link: UniverseGraphLink) => link.kind === "carries" ? 3 : 2}
      linkDirectionalParticleSpeed={(link: UniverseGraphLink) => link.kind === "carries" ? 0.012 : 0.007}
      onNodeClick={(node) => {
        const n = node as UniverseGraphNode & { x?: number; y?: number; z?: number };
        const distance = 180;
        const nodeDistance = Math.hypot(n.x || 0, n.y || 0, n.z || 0);
        const pos = nodeDistance < 1
          ? { x: 0, y: 0, z: distance }
          : {
              x: (n.x || 0) * (1 + distance / nodeDistance),
              y: (n.y || 0) * (1 + distance / nodeDistance),
              z: (n.z || 0) * (1 + distance / nodeDistance),
            };

        fgRef.current.cameraPosition(pos, n, 1800);
        onNodeSelect(node.id);
      }}
      cooldownTicks={120}
    />
  );
}

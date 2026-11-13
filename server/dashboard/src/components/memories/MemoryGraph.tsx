/**
 * Memory Relationship Graph
 * 
 * Visualizes relationships between memories using ReactFlow.
 * Shows linked, derived, contradicts, and supersedes relationships.
 */

'use client';

import React, { useCallback, useMemo } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  ConnectionMode,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface MemoryGraphData {
  nodes: Array<{
    id: string;
    label: string;
    layer: string;
    importance: number;
    type: 'center' | 'linked' | 'derived';
  }>;
  edges: Array<{
    source: string;
    target: string;
    type: 'linked' | 'derived' | 'contradicts' | 'supersedes';
  }>;
  center: string;
}

interface MemoryGraphProps {
  data: MemoryGraphData;
  onNodeClick?: (nodeId: string) => void;
}

const LAYER_COLORS = {
  L0: '#9333ea', // purple-600
  L1: '#2563eb', // blue-600
  L2: '#16a34a', // green-600
  L3: '#ca8a04', // yellow-600
  L4: '#4b5563', // gray-600
};

const EDGE_COLORS = {
  linked: '#6b7280',      // gray-500
  derived: '#3b82f6',     // blue-500
  contradicts: '#ef4444', // red-500
  supersedes: '#f59e0b',  // amber-500
};

export function MemoryGraph({ data, onNodeClick }: MemoryGraphProps) {
  // Convert data to ReactFlow format
  const initialNodes: Node[] = useMemo(() => {
    return data.nodes.map((node, index) => ({
      id: node.id,
      type: 'default',
      position: {
        x: node.type === 'center' ? 400 : 200 + (index * 150),
        y: node.type === 'center' ? 200 : 100 + (index % 3) * 150,
      },
      data: {
        label: (
          <div className="text-center">
            <div className="font-semibold text-sm">{node.layer}</div>
            <div className="text-xs opacity-75 mt-1">{node.label.substring(0, 30)}...</div>
            <div className="text-xs mt-1">★ {node.importance.toFixed(1)}</div>
          </div>
        ),
      },
      style: {
        background: LAYER_COLORS[node.layer as keyof typeof LAYER_COLORS] || '#6b7280',
        color: '#ffffff',
        border: node.type === 'center' ? '3px solid #ffffff' : '1px solid rgba(255,255,255,0.3)',
        borderRadius: '8px',
        padding: '12px',
        width: 150,
        fontSize: '12px',
      },
    }));
  }, [data.nodes]);

  const initialEdges: Edge[] = useMemo(() => {
    return data.edges.map((edge, index) => ({
      id: `edge-${index}`,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      animated: edge.type === 'derived',
      style: {
        stroke: EDGE_COLORS[edge.type as keyof typeof EDGE_COLORS] || '#6b7280',
        strokeWidth: 2,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: EDGE_COLORS[edge.type as keyof typeof EDGE_COLORS] || '#6b7280',
      },
      label: edge.type,
      labelStyle: {
        fontSize: 10,
        fontWeight: 500,
      },
    }));
  }, [data.edges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onNodeClick?.(node.id);
    },
    [onNodeClick]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Memory Relationships</CardTitle>
      </CardHeader>
      <CardContent>
        <div style={{ height: '500px', width: '100%' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            connectionMode={ConnectionMode.Loose}
            fitView
            attributionPosition="bottom-left"
          >
            <Controls />
            <Background />
          </ReactFlow>
        </div>
        
        {/* Legend */}
        <div className="mt-4 pt-4 border-t">
          <div className="text-sm font-semibold mb-2">Relationship Types:</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {Object.entries(EDGE_COLORS).map(([type, color]) => (
              <div key={type} className="flex items-center gap-2">
                <div
                  className="w-4 h-0.5"
                  style={{ backgroundColor: color }}
                />
                <span className="capitalize">{type}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

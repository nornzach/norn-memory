/**
 * Memory Hierarchy Pyramid Visualization
 * 
 * Displays the five-layer memory pyramid with counts and percentages.
 */

'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface LayerData {
  layer: string;
  count: number;
  label: string;
  color: string;
}

interface HierarchyPyramidProps {
  stats: {
    total_memories: number;
    by_layer: {
      L0: { count: number; avg_importance: number };
      L1: { count: number; avg_importance: number };
      L2: { count: number; avg_importance: number };
      L3: { count: number; avg_importance: number };
      L4: { count: number; avg_importance: number };
    };
  };
  onLayerClick?: (layer: string) => void;
}

const LAYER_COLORS = {
  L0: 'bg-purple-600 hover:bg-purple-700',
  L1: 'bg-blue-600 hover:bg-blue-700',
  L2: 'bg-green-600 hover:bg-green-700',
  L3: 'bg-yellow-600 hover:bg-yellow-700',
  L4: 'bg-gray-600 hover:bg-gray-700',
};

const LAYER_LABELS = {
  L0: 'Canonical',
  L1: 'Core',
  L2: 'Episodic',
  L3: 'Working',
  L4: 'Transient',
};

export function HierarchyPyramid({ stats, onLayerClick }: HierarchyPyramidProps) {
  const total = stats.total_memories;
  
  const layers: LayerData[] = [
    { layer: 'L0', count: stats.by_layer.L0.count, label: LAYER_LABELS.L0, color: LAYER_COLORS.L0 },
    { layer: 'L1', count: stats.by_layer.L1.count, label: LAYER_LABELS.L1, color: LAYER_COLORS.L1 },
    { layer: 'L2', count: stats.by_layer.L2.count, label: LAYER_LABELS.L2, color: LAYER_COLORS.L2 },
    { layer: 'L3', count: stats.by_layer.L3.count, label: LAYER_LABELS.L3, color: LAYER_COLORS.L3 },
    { layer: 'L4', count: stats.by_layer.L4.count, label: LAYER_LABELS.L4, color: LAYER_COLORS.L4 },
  ];

  const calculateWidth = (count: number, index: number) => {
    const baseWidth = 20 + (index * 16); // L0 = 20%, L4 = 84%
    return `${baseWidth}%`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Memory Hierarchy</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-2 py-4">
          {layers.map((layer, index) => {
            const percentage = total > 0 ? ((layer.count / total) * 100).toFixed(1) : '0.0';
            const width = calculateWidth(layer.count, index);
            const avgImportance = stats.by_layer[layer.layer as keyof typeof stats.by_layer].avg_importance;
            
            return (
              <div
                key={layer.layer}
                className="flex flex-col items-center w-full"
              >
                <button
                  onClick={() => onLayerClick?.(layer.layer)}
                  className={`
                    ${layer.color}
                    text-white rounded-lg shadow-md
                    transition-all duration-200
                    cursor-pointer
                    py-3 px-4
                    flex flex-col items-center justify-center
                    group
                  `}
                  style={{ width }}
                  title={`Click to filter ${layer.label} memories`}
                >
                  <div className="font-bold text-lg">{layer.layer}</div>
                  <div className="text-sm opacity-90">{layer.label}</div>
                  <div className="text-xs mt-1 font-semibold">
                    {layer.count} ({percentage}%)
                  </div>
                  <div className="text-xs opacity-75 mt-0.5">
                    Avg: {avgImportance.toFixed(1)}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
        
        <div className="mt-6 pt-4 border-t">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Total Memories:</span>
              <span className="ml-2 font-semibold">{total}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Avg Importance:</span>
              <span className="ml-2 font-semibold">
                {stats.total_memories > 0 
                  ? ((
                      stats.by_layer.L0.count * stats.by_layer.L0.avg_importance +
                      stats.by_layer.L1.count * stats.by_layer.L1.avg_importance +
                      stats.by_layer.L2.count * stats.by_layer.L2.avg_importance +
                      stats.by_layer.L3.count * stats.by_layer.L3.avg_importance +
                      stats.by_layer.L4.count * stats.by_layer.L4.avg_importance
                    ) / total).toFixed(1)
                  : '0.0'
                }
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Enhanced Memory Detail View
 * 
 * Shows layer, importance, weight, evolution timeline, and relationship graph.
 */

'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Calendar, TrendingUp, Link2, Star } from 'lucide-react';

interface MemoryDetailViewProps {
  memory: {
    id: string;
    memory: string;
    layer: string;
    importance: number;
    weight?: number;
    context: string;
    created_at: string;
    last_accessed_at?: string;
    access_count?: number;
    evolution_history?: Array<{
      from_layer: string;
      to_layer: string;
      reason: string;
      timestamp: string;
    }>;
  };
  onViewGraph?: () => void;
}

const LAYER_INFO = {
  L0: { label: 'Canonical', color: 'bg-purple-600', description: 'Core principles and ground truth' },
  L1: { label: 'Core', color: 'bg-blue-600', description: 'Stable preferences and skills' },
  L2: { label: 'Episodic', color: 'bg-green-600', description: 'Specific events and experiences' },
  L3: { label: 'Working', color: 'bg-yellow-600', description: 'Current tasks and context' },
  L4: { label: 'Transient', color: 'bg-gray-600', description: 'Temporary state and cache' },
};

export function MemoryDetailView({ memory, onViewGraph }: MemoryDetailViewProps) {
  const layerInfo = LAYER_INFO[memory.layer as keyof typeof LAYER_INFO] || LAYER_INFO.L3;
  
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const getImportanceColor = (importance: number) => {
    if (importance >= 8) return 'text-red-600';
    if (importance >= 5) return 'text-orange-600';
    return 'text-gray-600';
  };

  return (
    <div className="space-y-4">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge className={`${layerInfo.color} text-white`}>
                  {memory.layer} - {layerInfo.label}
                </Badge>
                <Badge variant="outline">{memory.context}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{layerInfo.description}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-base leading-relaxed">{memory.memory}</p>
        </CardContent>
      </Card>

      {/* Metrics Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Memory Metrics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Importance */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Star className="h-3 w-3" />
                <span>Importance</span>
              </div>
              <div className={`text-2xl font-bold ${getImportanceColor(memory.importance)}`}>
                {memory.importance.toFixed(1)}
              </div>
            </div>

            {/* Weight */}
            {memory.weight !== undefined && (
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <TrendingUp className="h-3 w-3" />
                  <span>Weight</span>
                </div>
                <div className="text-2xl font-bold">
                  {memory.weight.toFixed(2)}
                </div>
              </div>
            )}

            {/* Access Count */}
            {memory.access_count !== undefined && (
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Link2 className="h-3 w-3" />
                  <span>Accessed</span>
                </div>
                <div className="text-2xl font-bold">
                  {memory.access_count}
                </div>
              </div>
            )}

            {/* Age */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Calendar className="h-3 w-3" />
                <span>Age</span>
              </div>
              <div className="text-sm font-medium">
                {Math.floor(
                  (Date.now() - new Date(memory.created_at).getTime()) / (1000 * 60 * 60 * 24)
                )} days
              </div>
            </div>
          </div>

          <Separator />

          {/* Timestamps */}
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Created:</span>
              <span className="font-medium">{formatDate(memory.created_at)}</span>
            </div>
            {memory.last_accessed_at && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last Accessed:</span>
                <span className="font-medium">{formatDate(memory.last_accessed_at)}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Evolution Timeline */}
      {memory.evolution_history && memory.evolution_history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Evolution Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {memory.evolution_history.map((event, index) => (
                <div key={index} className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-2 h-2 mt-2 rounded-full bg-blue-500" />
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {event.from_layer} → {event.to_layer}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(event.timestamp)}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{event.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* View Graph Button */}
      {onViewGraph && (
        <Card>
          <CardContent className="pt-6">
            <button
              onClick={onViewGraph}
              className="w-full py-3 px-4 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium"
            >
              View Relationship Graph
            </button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

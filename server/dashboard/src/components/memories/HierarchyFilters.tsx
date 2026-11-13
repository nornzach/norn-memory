/**
 * Memory Hierarchy Filters
 * 
 * Multi-select filters for layers, importance range, and context.
 */

'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface HierarchyFilters {
  layers: string[];
  importanceRange: [number, number];
  context?: string;
}

interface HierarchyFiltersProps {
  filters: HierarchyFilters;
  contexts: string[];
  onChange: (filters: HierarchyFilters) => void;
}

const LAYERS = [
  { value: 'L0', label: 'L0 - Canonical', color: 'text-purple-600' },
  { value: 'L1', label: 'L1 - Core', color: 'text-blue-600' },
  { value: 'L2', label: 'L2 - Episodic', color: 'text-green-600' },
  { value: 'L3', label: 'L3 - Working', color: 'text-yellow-600' },
  { value: 'L4', label: 'L4 - Transient', color: 'text-gray-600' },
];

export function HierarchyFiltersComponent({ filters, contexts, onChange }: HierarchyFiltersProps) {
  const handleLayerToggle = (layer: string) => {
    const newLayers = filters.layers.includes(layer)
      ? filters.layers.filter(l => l !== layer)
      : [...filters.layers, layer];
    
    onChange({ ...filters, layers: newLayers });
  };

  const handleImportanceChange = (value: number[]) => {
    onChange({ ...filters, importanceRange: [value[0], value[1]] });
  };

  const handleContextChange = (value: string) => {
    onChange({ ...filters, context: value === 'all' ? undefined : value });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Filters</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Layer Selection */}
        <div className="space-y-3">
          <Label className="text-base font-semibold">Layers</Label>
          <div className="space-y-2">
            {LAYERS.map(layer => (
              <div key={layer.value} className="flex items-center space-x-2">
                <Checkbox
                  id={`layer-${layer.value}`}
                  checked={filters.layers.includes(layer.value)}
                  onCheckedChange={() => handleLayerToggle(layer.value)}
                />
                <label
                  htmlFor={`layer-${layer.value}`}
                  className={`text-sm font-medium leading-none cursor-pointer ${layer.color}`}
                >
                  {layer.label}
                </label>
              </div>
            ))}
          </div>
        </div>

        {/* Importance Range */}
        <div className="space-y-3">
          <Label className="text-base font-semibold">
            Importance Range: {filters.importanceRange[0]} - {filters.importanceRange[1]}
          </Label>
          <Slider
            min={1}
            max={10}
            step={0.5}
            value={filters.importanceRange}
            onValueChange={handleImportanceChange}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Low (1)</span>
            <span>High (10)</span>
          </div>
        </div>

        {/* Context Selection */}
        <div className="space-y-3">
          <Label className="text-base font-semibold">Context</Label>
          <Select
            value={filters.context || 'all'}
            onValueChange={handleContextChange}
          >
            <SelectTrigger>
              <SelectValue placeholder="All contexts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All contexts</SelectItem>
              {contexts.map(context => (
                <SelectItem key={context} value={context}>
                  {context}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Active Filters Summary */}
        <div className="pt-4 border-t">
          <div className="text-sm text-muted-foreground">
            Active: {filters.layers.length} layer{filters.layers.length !== 1 ? 's' : ''}
            {filters.context && ` • ${filters.context}`}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

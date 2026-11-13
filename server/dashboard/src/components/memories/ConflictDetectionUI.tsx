/**
 * Conflict Detection UI
 * 
 * Displays detected conflicts between memories with side-by-side comparison
 * and resolution options.
 */

'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

interface Conflict {
  id: string;
  type: 'contradiction' | 'superseded' | 'duplicate';
  new_memory: {
    id: string;
    text: string;
    importance: number;
    created_at: string;
  };
  existing_memory: {
    id: string;
    text: string;
    importance: number;
    created_at: string;
  };
  detected_at: string;
}

interface ConflictDetectionUIProps {
  conflicts: Conflict[];
  onResolve: (conflictId: string, action: 'keep_new' | 'keep_existing' | 'merge') => Promise<void>;
}

const CONFLICT_COLORS = {
  contradiction: 'bg-red-100 text-red-800 border-red-300',
  superseded: 'bg-amber-100 text-amber-800 border-amber-300',
  duplicate: 'bg-blue-100 text-blue-800 border-blue-300',
};

const CONFLICT_ICONS = {
  contradiction: <AlertTriangle className="h-5 w-5" />,
  superseded: <XCircle className="h-5 w-5" />,
  duplicate: <CheckCircle2 className="h-5 w-5" />,
};

export function ConflictDetectionUI({ conflicts, onResolve }: ConflictDetectionUIProps) {
  const [resolving, setResolving] = useState<string | null>(null);

  const handleResolve = async (conflictId: string, action: 'keep_new' | 'keep_existing' | 'merge') => {
    setResolving(conflictId);
    try {
      await onResolve(conflictId, action);
    } finally {
      setResolving(null);
    }
  };

  if (conflicts.length === 0) {
    return (
      <Alert>
        <CheckCircle2 className="h-4 w-4" />
        <AlertDescription>
          No conflicts detected. All memories are consistent.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Detected Conflicts ({conflicts.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            The following memories have potential conflicts. Review and resolve them to maintain consistency.
          </p>
        </CardContent>
      </Card>

      {conflicts.map((conflict) => (
        <Card key={conflict.id} className={`border-2 ${CONFLICT_COLORS[conflict.type]}`}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {CONFLICT_ICONS[conflict.type]}
                <CardTitle className="text-base">
                  {conflict.type.charAt(0).toUpperCase() + conflict.type.slice(1)}
                </CardTitle>
              </div>
              <Badge variant="outline" className="text-xs">
                {new Date(conflict.detected_at).toLocaleDateString()}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Side-by-side comparison */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Existing Memory */}
              <div className="space-y-2 p-4 bg-white rounded-lg border">
                <div className="flex items-center justify-between mb-2">
                  <Badge variant="secondary">Existing</Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(conflict.existing_memory.created_at).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-sm">{conflict.existing_memory.text}</p>
                <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                  <span>Importance: {conflict.existing_memory.importance.toFixed(1)}</span>
                </div>
              </div>

              {/* New Memory */}
              <div className="space-y-2 p-4 bg-white rounded-lg border border-blue-300">
                <div className="flex items-center justify-between mb-2">
                  <Badge>New</Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(conflict.new_memory.created_at).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-sm">{conflict.new_memory.text}</p>
                <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                  <span>Importance: {conflict.new_memory.importance.toFixed(1)}</span>
                </div>
              </div>
            </div>

            {/* Resolution Actions */}
            <div className="flex flex-wrap gap-2 pt-4 border-t">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleResolve(conflict.id, 'keep_existing')}
                disabled={resolving === conflict.id}
              >
                Keep Existing
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleResolve(conflict.id, 'keep_new')}
                disabled={resolving === conflict.id}
              >
                Keep New
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={() => handleResolve(conflict.id, 'merge')}
                disabled={resolving === conflict.id}
              >
                Merge Both
              </Button>
            </div>

            {resolving === conflict.id && (
              <div className="text-sm text-muted-foreground">
                Resolving...
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
